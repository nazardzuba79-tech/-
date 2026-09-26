import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { supportRouter } from '../../api/routes/support';
import { SupportNotificationOutbox, SUPPORT_RETRY_DELAYS_MS } from '../SupportNotificationOutbox';
import type { SupportSendResult } from '../SupportEmailService';

/**
 * The support outbox against real PostgreSQL: the message and its
 * notification commit or roll back together, one notification per message,
 * retry state transitions, two workers never sending one row twice, and an
 * inbound reply stored once. Runs only against a disposable localhost
 * database named voltex_support_test (CI: .github/workflows/support-email.yml).
 */

const url = process.env.SUPPORT_TEST_DATABASE_URL;
const pg = url ? describe : describe.skip;

pg('support notifications on real PostgreSQL', () => {
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_support_test') throw new Error('disposable localhost test database required');
  }
  const db = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://localhost/disabled' } } });
  const kicks: number[] = [];
  const app = express();
  app.use(express.json());
  // Per-IP limits are covered in support.test.ts; here one client sends many.
  app.use('/api/v1', supportRouter(db, { kick: () => kicks.push(Date.now()) }, { rateLimit: false }));
  app.use((_e: Error, _q: express.Request, res: express.Response, _n: express.NextFunction) => { res.status(500).json({ error: 'Internal server error' }); });

  function worker(results: SupportSendResult[], clock: { now: number }) {
    const sent: string[] = [];
    const email = {
      isConfigured: () => true,
      status: () => ({ smtpConfigured: true, recipient: 'voltex.crypto@gmail.com', inboundConfigured: false }),
      send: jest.fn(async (input: { messageId: string }) => {
        sent.push(input.messageId);
        await new Promise((r) => setTimeout(r, 20)); // a relay round trip, so racing workers overlap
        return results.shift() ?? { ok: true as const, recipient: 'voltex.crypto@gmail.com' };
      }),
    };
    const outbox = new SupportNotificationOutbox(db, email as any, { now: () => new Date(clock.now), setTimer: () => 0 as any, clearTimer: () => {}, log: () => {} });
    return { outbox, email, sent };
  }

  async function clean() {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS support_outbox_probe ON "SupportNotification"');
    await db.supportNotification.deleteMany({});
    await db.supportMessage.deleteMany({});
    await db.supportConversation.deleteMany({});
  }

  const start = (message: string) => request(app).post('/api/v1/support/conversations')
    .send({ name: 'VOLTEX Support QA', email: 'qa-support@example.invalid', subject: 'TECHNICAL', message });

  beforeEach(clean);
  afterAll(async () => { await clean(); await db.$disconnect(); });

  test('a new conversation commits the conversation, the message and exactly one PENDING notification', async () => {
    const res = await start('Production support email delivery test.\nNo action required.');
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const messages = await db.supportMessage.findMany({ where: { conversationId: id } });
    expect(messages).toHaveLength(1);
    const notifications = await db.supportNotification.findMany({ where: { conversationId: id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ messageId: messages[0].id, status: 'PENDING', attempts: 0, recipient: null });
    expect((await db.supportConversation.findUniqueOrThrow({ where: { id } })).unreadByAdmin).toBe(true);
    expect(kicks.length).toBeGreaterThan(0);
  });

  test('a follow-up message gets its own notification; a second one for the same message is refused by the database', async () => {
    const id = (await start('first')).body.id as string;
    const res = await request(app).post(`/api/v1/support/conversations/${id}/messages`).send({ body: 'second' });
    expect(res.status).toBe(201);
    expect(await db.supportNotification.count({ where: { conversationId: id } })).toBe(2);
    await expect(db.supportNotification.create({ data: { conversationId: id, messageId: res.body.id } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('if the notification insert fails, the message is rolled back too (nothing half-written)', async () => {
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION support_outbox_probe_fn() RETURNS trigger AS $$
      BEGIN
        IF (SELECT body FROM "SupportMessage" WHERE id = NEW."messageId") = 'ROLLBACK-PROBE' THEN
          RAISE EXCEPTION 'probe: outbox insert refused';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER support_outbox_probe BEFORE INSERT ON "SupportNotification" FOR EACH ROW EXECUTE FUNCTION support_outbox_probe_fn()');
    const res = await start('ROLLBACK-PROBE');
    expect(res.status).toBe(500);
    expect(await db.supportMessage.count({ where: { body: 'ROLLBACK-PROBE' } })).toBe(0);
    expect(await db.supportConversation.count()).toBe(0);
    expect(await db.supportNotification.count()).toBe(0);
  });

  test('retry state transitions: CONNECTION failure → PENDING +1 min → SENT; the message survives the failure', async () => {
    const id = (await start('retry me')).body.id as string;
    const clock = { now: Date.now() + 1_000 };
    const { outbox, email } = worker([{ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'CONNECTION', code: null, permanent: false }], clock);

    await outbox.run();
    let row = await db.supportNotification.findFirstOrThrow({ where: { conversationId: id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, failureCategory: 'CONNECTION', claimedUntil: null, recipient: 'voltex.crypto@gmail.com' });
    expect(row.nextAttemptAt.getTime()).toBe(clock.now + SUPPORT_RETRY_DELAYS_MS[0]);
    expect(await db.supportMessage.count({ where: { conversationId: id } })).toBe(1);

    await outbox.run(); // not due yet
    expect(email.send).toHaveBeenCalledTimes(1);

    clock.now += SUPPORT_RETRY_DELAYS_MS[0];
    await outbox.run();
    row = await db.supportNotification.findFirstOrThrow({ where: { conversationId: id } });
    expect(row).toMatchObject({ status: 'SENT', attempts: 2, failureCategory: null });
    expect(row.sentAt).not.toBeNull();
  });

  test('a permanent rejection ends FAILED after one attempt, with only a category stored', async () => {
    const id = (await start('bad recipient')).body.id as string;
    const { outbox } = worker([{ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'RECIPIENT_REJECTED', code: 550, permanent: true }], { now: Date.now() + 1_000 });
    await outbox.run();
    const row = await db.supportNotification.findFirstOrThrow({ where: { conversationId: id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 1, failureCategory: 'RECIPIENT_REJECTED', failureCode: 550 });
  });

  test('two workers (e.g. old and new instance during a deploy) send each notification exactly once', async () => {
    for (let i = 0; i < 6; i++) await start(`race ${i}`);
    const clock = { now: Date.now() + 1_000 };
    const a = worker([], clock);
    const b = worker([], clock);
    await Promise.all([a.outbox.run(), b.outbox.run()]);
    const all = [...a.sent, ...b.sent];
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
    expect(await db.supportNotification.count({ where: { status: 'SENT' } })).toBe(6);
  });

  test('an inbound reply delivered twice (same Message-ID) is stored once', async () => {
    process.env.SUPPORT_WEBHOOK_SECRET = 'integration-secret';
    const id = (await start('need help')).body.id as string;
    const send = () => request(app).post('/api/v1/support/webhook/inbound-email').set('x-webhook-secret', 'integration-secret')
      .send({ subject: `Re: [Ticket #${id}] Техническая проблема`, text: 'Відповідь підтримки', messageId: '<reply-1@mail.example>' });
    const [first, second] = await Promise.all([send(), send()]);
    expect([first.status, second.status].sort()).toEqual([200, 204]);
    expect(await db.supportMessage.count({ where: { conversationId: id, sender: 'ADMIN' } })).toBe(1);
    delete process.env.SUPPORT_WEBHOOK_SECRET;
  });
});
