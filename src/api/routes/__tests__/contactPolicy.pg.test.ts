import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { contactPolicyRouter } from '../contactPolicy';
import { requireAuth } from '../../middleware/auth';
import { blockedContactEmails, isBlockedContactEmail } from '../../../services/ContactEmailPolicy';

// Never run against an arbitrary DATABASE_URL or a production database.
const url = process.env.EMAIL_POLICY_TEST_URL;
const safe = /^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_email_policy_test$/.test(url ?? '');
const run = safe ? test : test.skip;

run('durable blacklist, session revocation, atomic rollback and financial preservation in PostgreSQL', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const nonce = randomUUID();
  const email = `spam-${nonce}@example.invalid`;
  const ids: string[] = [];
  function appFor(client: PrismaClient) {
    const app = express(); app.use(express.json()); app.use('/api/v1', contactPolicyRouter(client));
    app.get('/private', requireAuth(client), (_req, res) => res.json({ ok: true }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(503).json({ error: 'unavailable' }));
    return app;
  }
  try {
    const admin = await db.user.create({ data: { email: `admin-${nonce}@example.invalid`, passwordHash: 'fixture', role: 'ADMIN', referralCode: randomUUID() } }); ids.push(admin.id);
    const user = await db.user.create({ data: { email, passwordHash: 'fixture', referralCode: randomUUID() } }); ids.push(user.id);
    await db.balance.create({ data: { userId: user.id, asset: 'USDT', available: '123.123456789012345678', locked: '7.25' } });
    await db.order.create({ data: { userId: user.id, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '100', originalQuantity: '0.01', remainingQuantity: '0.01', status: 'OPEN' } });
    const history = await db.auditLog.create({ data: { userId: user.id, action: 'FIXTURE_HISTORY', metadata: { preserved: true } } });
    const sessions = await Promise.all([0, 1].map(() => db.session.create({ data: { userId: user.id } })));
    const token = (sub: string, sid?: string) => 'Bearer ' + jwt.sign({ sub, ...(sid ? { sid } : {}) }, process.env.JWT_SECRET!);
    const app = appFor(db), headers = { Authorization: token(admin.id) };
    const snapshot = async () => JSON.stringify(await Promise.all([
      db.user.findUnique({ where: { id: user.id } }), db.balance.findMany({ where: { userId: user.id } }),
      db.order.findMany({ where: { userId: user.id } }), db.auditLog.findUnique({ where: { id: history.id } }),
    ]));
    const before = await snapshot();
    const block = await request(app).post('/api/v1/admin/spam-emails/block').set(headers).send({ email: ' ' + email.toUpperCase() + ' ' });
    expect(block.status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await snapshot()).toBe(before);
    // A new client proves state is in PostgreSQL, not process memory.
    const fresh = new PrismaClient({ datasources: { db: { url } } });
    try { expect(await isBlockedContactEmail(fresh, email)).toBe(true); } finally { await fresh.$disconnect(); }
    expect((await blockedContactEmails(db)).find(row => row.email === email)).toMatchObject({ addedBy: admin.email, addedAt: expect.any(Date) });
    expect((await request(app).get('/private').set('Authorization', token(user.id))).status).toBe(403);
    for (const session of sessions) expect((await request(app).get('/private').set('Authorization', token(user.id, session.id))).status).toBe(401);
    expect((await request(app).post('/api/v1/admin/spam-emails/unblock').set(headers).send({ email })).status).toBe(200);
    expect(await isBlockedContactEmail(db, email)).toBe(false);
    expect((await request(app).get('/private').set('Authorization', token(user.id))).status).toBe(401);
    expect(await db.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await snapshot()).toBe(before);
    const newSession = await db.session.create({ data: { userId: user.id } });
    expect((await request(app).get('/private').set('Authorization', token(user.id, newSession.id))).status).toBe(200);
    // Force failure after audit insert. The real transaction must roll it back.
    const broken = {
      user: db.user, auditLog: db.auditLog, session: db.session,
      $transaction: (fn: any) => db.$transaction(tx => fn({
        auditLog: tx.auditLog, $executeRaw: tx.$executeRaw.bind(tx),
        session: { updateMany: async () => { throw new Error('fixture revoke failure'); } },
      })),
    } as unknown as PrismaClient;
    const brokenApp = appFor(broken);
    expect((await request(brokenApp).post('/api/v1/admin/spam-emails/block').set(headers).send({ email })).status).toBe(503);
    expect(await isBlockedContactEmail(db, email)).toBe(false);
    expect((await request(brokenApp).get('/health')).status).toBe(200);
    expect(await snapshot()).toBe(before);
    // Blocking an address without a User still persists; no User is invented.
    const absent = `absent-${nonce}@example.invalid`;
    expect((await request(app).post('/api/v1/admin/spam-emails/block').set(headers).send({ email: absent })).status).toBe(200);
    expect(await isBlockedContactEmail(db, absent)).toBe(true);
    expect(await db.user.findUnique({ where: { email: absent } })).toBeNull();
  } finally {
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.order.deleteMany({ where: { userId: { in: ids } } });
    await db.balance.deleteMany({ where: { userId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}, 30_000);
