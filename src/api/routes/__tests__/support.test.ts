process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { supportRouter } from '../support';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

const CONV = '11111111-2222-4333-8444-555555555555';

/** The routes' Prisma surface; `$transaction` runs the callback against the same mocks. */
function withTx(prisma: any) {
  return { ...prisma, $transaction: jest.fn(async (fn: (tx: any) => unknown) => fn(prisma)) };
}

function buildApp(prisma: any = {}, outbox: any = { kick: jest.fn() }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', supportRouter(withTx(prisma), outbox));
  return app;
}

function notificationMock() {
  return { create: jest.fn().mockResolvedValue({ id: 'n-1' }) };
}

const OLD_ENV = process.env;

describe('support routes', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('POST /support/conversations', () => {
    it('creates a guest conversation, its message and exactly one notification in one transaction, then kicks the outbox', async () => {
      const created = { id: CONV, userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'TECHNICAL', messages: [{ id: 'm-1', sender: 'USER', body: 'Не працює вивід' }] };
      const createMock = jest.fn().mockResolvedValue(created);
      const notification = notificationMock();
      const outbox = { kick: jest.fn() };
      const prisma = { supportConversation: { create: createMock }, supportNotification: notification };
      const app = buildApp(prisma, outbox);

      const res = await request(app)
        .post('/api/v1/support/conversations')
        .send({ name: 'Іван', email: 'ivan@example.com', subject: 'TECHNICAL', message: 'Не працює вивід' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'TECHNICAL', unreadByAdmin: true }) })
      );
      expect(notification.create).toHaveBeenCalledTimes(1);
      expect(notification.create).toHaveBeenCalledWith({ data: { conversationId: CONV, messageId: 'm-1' } });
      expect(outbox.kick).toHaveBeenCalledTimes(1);
    });

    it('if the notification row cannot be written, nothing is committed and the user gets an error (no silent loss)', async () => {
      const app = express();
      app.use(express.json());
      const prisma = {
        $transaction: jest.fn(async () => { throw new Error('tx rolled back'); }),
      };
      const outbox = { kick: jest.fn() };
      app.use('/api/v1', supportRouter(prisma as any, outbox));
      app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: 'Internal server error' }); });
      const res = await request(app).post('/api/v1/support/conversations')
        .send({ name: 'Іван', email: 'ivan@example.com', subject: 'TECHNICAL', message: 'Не працює вивід' });
      expect(res.status).toBe(500);
      expect(outbox.kick).not.toHaveBeenCalled();
    });

    it('a name with line breaks is stored as one line; message keeps its own line breaks', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: CONV, userId: null, messages: [{ id: 'm-1' }] });
      const app = buildApp({ supportConversation: { create: createMock }, supportNotification: notificationMock() });
      const res = await request(app).post('/api/v1/support/conversations')
        .send({ name: ' Eve\r\nBcc: x@example.com ', email: 'eve@example.com', subject: 'OTHER', message: 'line one\nline two\u0000' });
      expect(res.status).toBe(201);
      const data = createMock.mock.calls[0][0].data;
      expect(data.guestName).toBe('Eve Bcc: x@example.com');
      expect(data.messages.create.body).toBe('line one\nline two');
    });

    it('rejects an over-long message and a blank one', async () => {
      const create = jest.fn();
      const app = buildApp({ supportConversation: { create } });
      for (const message of ['x'.repeat(2001), '   ']) {
        const res = await request(app).post('/api/v1/support/conversations').send({ name: 'A', email: 'a@example.com', subject: 'OTHER', message });
        expect(res.status).toBe(400);
      }
      expect(create).not.toHaveBeenCalled();
    });

    it('rate-limits new conversations per IP', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: CONV, userId: null, messages: [{ id: 'm-1' }] });
      const app = buildApp({ supportConversation: { create: createMock }, supportNotification: notificationMock() });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await request(app).post('/api/v1/support/conversations').send({ name: 'A', email: 'a@example.com', subject: 'OTHER', message: `hi ${i}` })).status);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
      expect(createMock).toHaveBeenCalledTimes(5);
    });

    it('ties the conversation to the logged-in user when authenticated', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: CONV, userId: 'user-1', messages: [{ id: 'm-1' }] });
      const app = buildApp({ supportConversation: { create: createMock }, supportNotification: notificationMock() });

      await request(app)
        .post('/api/v1/support/conversations')
        .set('Authorization', authHeader('user-1'))
        .send({ name: 'Олена', email: 'olena@example.com', subject: 'KYC', message: 'Питання по верифікації' });

      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }));
    });

    it('rejects an invalid subject', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/support/conversations')
        .send({ name: 'X', email: 'x@example.com', subject: 'NOT_A_SUBJECT', message: 'hi' });
      expect(res.status).toBe(400);
    });

    it.each([
      'not-an-email',
      'group:member@example.com;',
      'outer:inner:member@example.com;;',
      'Display Name <member@example.com>',
      'member@example.com\r\nBcc:other@example.com',
      'member@example.com\n',
      'member@example.com\u0000',
      '"member@other.example"@example.com',
    ])('rejects malformed/group-style address %j before persistence or mail notification', async (email) => {
      const create = jest.fn();
      const kick = jest.fn();
      const app = buildApp({ supportConversation: { create } }, { kick });
      const res = await request(app).post('/api/v1/support/conversations')
        .send({ name: 'Local Test', email, subject: 'TECHNICAL', message: 'Local validation only' });
      expect(res.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
      expect(kick).not.toHaveBeenCalled();
    });

    it('preserves valid plus-address email while dropping arbitrary mail options from the public request', async () => {
      const create = jest.fn().mockResolvedValue({ id: CONV, userId: null, messages: [{ id: 'm-1' }] });
      const notification = notificationMock();
      const app = buildApp({ supportConversation: { create }, supportNotification: notification });
      const res = await request(app).post('/api/v1/support/conversations').send({
        name: 'Local Test', email: 'member+support@example.com', subject: 'TECHNICAL', message: 'Local validation only',
        raw: { href: 'https://blocked.example.invalid/mail' }, href: 'https://blocked.example.invalid/',
        path: '/not-an-allowed-file', to: 'untrusted@example.com',
        envelope: { size: 'untrusted' }, attachments: [{ path: '/not-an-allowed-file' }],
      });
      expect(res.status).toBe(201);
      // The outbox row names only the conversation and message: recipient, headers and body are the server's.
      expect(notification.create).toHaveBeenCalledWith({ data: { conversationId: CONV, messageId: 'm-1' } });
      expect(create).toHaveBeenCalledWith({
        data: { userId: null, guestName: 'Local Test', guestEmail: 'member+support@example.com',
          subject: 'TECHNICAL', unreadByAdmin: true, messages: { create: { sender: 'USER', body: 'Local validation only' } } },
        include: { messages: true },
      });
    });
  });

  describe('GET /support/conversations/mine', () => {
    it('requires authentication', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/support/conversations/mine');
      expect(res.status).toBe(401);
    });

    it("returns the user's most recent conversation", async () => {
      const conv = { id: 'conv-1', userId: 'user-1', messages: [] };
      const findFirstMock = jest.fn().mockResolvedValue(conv);
      const app = buildApp({ supportConversation: { findFirst: findFirstMock } });

      const res = await request(app).get('/api/v1/support/conversations/mine').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.conversation).toEqual(conv);
      expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    });
  });

  describe('GET /support/conversations/:id', () => {
    it('404s for a missing conversation', async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue(null) } });
      const res = await request(app).get(`/api/v1/support/conversations/${CONV}`);
      expect(res.status).toBe(404);
    });

    it('404s for a non-UUID id without touching the database', async () => {
      const findUnique = jest.fn();
      const app = buildApp({ supportConversation: { findUnique } });
      const res = await request(app).get('/api/v1/support/conversations/nope');
      expect(res.status).toBe(404);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("403s when a different logged-in user requests someone else's conversation", async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV, userId: 'owner' }) } });
      const res = await request(app).get(`/api/v1/support/conversations/${CONV}`).set('Authorization', authHeader('someone-else'));
      expect(res.status).toBe(403);
    });

    it('allows an unauthenticated request for a guest conversation by id', async () => {
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV, userId: null }) },
        supportMessage: { findMany: jest.fn().mockResolvedValue([{ id: 'm-1', sender: 'USER', body: 'hi' }]) },
      });
      const res = await request(app).get(`/api/v1/support/conversations/${CONV}`);
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
    });
  });

  describe('GET /support/conversations/:id/status', () => {
    it('reports unread without mutating anything', async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV, userId: null, unreadByUser: true }) } });
      const res = await request(app).get(`/api/v1/support/conversations/${CONV}/status`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadByUser: true });
    });
  });

  describe('POST /support/conversations/:id/messages', () => {
    it('adds a message with its own notification row, flags the conversation for the admin and kicks the outbox', async () => {
      const conversation = { id: CONV, userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'OTHER' };
      const createMessageMock = jest.fn().mockResolvedValue({ id: 'm-2', sender: 'USER', body: 'Ще одне питання' });
      const update = jest.fn().mockResolvedValue(conversation);
      const notification = notificationMock();
      const outbox = { kick: jest.fn() };
      const app = buildApp(
        {
          supportConversation: { findUnique: jest.fn().mockResolvedValue(conversation), update },
          supportMessage: { create: createMessageMock },
          supportNotification: notification,
        },
        outbox
      );

      const res = await request(app).post(`/api/v1/support/conversations/${CONV}/messages`).send({ body: 'Ще одне питання' });

      expect(res.status).toBe(201);
      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: { conversationId: CONV, sender: 'USER', body: 'Ще одне питання' } })
      );
      expect(update).toHaveBeenCalledWith({ where: { id: CONV }, data: expect.objectContaining({ unreadByAdmin: true }) });
      expect(notification.create).toHaveBeenCalledWith({ data: { conversationId: CONV, messageId: 'm-2' } });
      expect(outbox.kick).toHaveBeenCalledTimes(1);
    });

    it('two messages make two notifications, one per message', async () => {
      const conversation = { id: CONV, userId: null, subject: 'OTHER' };
      let n = 0;
      const notification = notificationMock();
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue(conversation), update: jest.fn() },
        supportMessage: { create: jest.fn(async () => ({ id: `m-${++n}` })) },
        supportNotification: notification,
      });
      await request(app).post(`/api/v1/support/conversations/${CONV}/messages`).send({ body: 'one' });
      await request(app).post(`/api/v1/support/conversations/${CONV}/messages`).send({ body: 'two' });
      expect(notification.create.mock.calls.map(([arg]: any[]) => arg.data.messageId)).toEqual(['m-1', 'm-2']);
    });

    it('403s on someone else\'s conversation', async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV, userId: 'owner' }) } });
      const res = await request(app)
        .post(`/api/v1/support/conversations/${CONV}/messages`)
        .set('Authorization', authHeader('someone-else'))
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /support/conversations/:id/read', () => {
    it('clears the unread flag', async () => {
      const updateMock = jest.fn().mockResolvedValue({});
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: CONV, userId: null, unreadByUser: true }), update: updateMock } });
      const res = await request(app).post(`/api/v1/support/conversations/${CONV}/read`);
      expect(res.status).toBe(204);
      expect(updateMock).toHaveBeenCalledWith({ where: { id: CONV }, data: { unreadByUser: false } });
    });
  });

  describe('POST /support/webhook/inbound-email', () => {
    it('rejects when the webhook secret is not configured', async () => {
      delete process.env.SUPPORT_WEBHOOK_SECRET;
      const app = buildApp();
      const res = await request(app).post('/api/v1/support/webhook/inbound-email').send({ subject: '[Ticket #x]', text: 'hi' });
      expect(res.status).toBe(503);
    });

    it('rejects a wrong secret', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/support/webhook/inbound-email')
        .set('x-webhook-secret', 'wrong-secret')
        .send({ subject: '[Ticket #x]', text: 'hi' });
      expect(res.status).toBe(401);
    });

    it('400s when the subject has no ticket id', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/support/webhook/inbound-email')
        .set('x-webhook-secret', 'right-secret')
        .send({ subject: 'Re: no ticket here', text: 'hi' });
      expect(res.status).toBe(400);
    });

    it('404s when the ticket id does not match a conversation', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const id = '11111111-1111-1111-1111-111111111111';
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue(null) } });
      const res = await request(app)
        .post('/api/v1/support/webhook/inbound-email')
        .set('x-webhook-secret', 'right-secret')
        .send({ subject: `Re: [Ticket #${id}] Технічна проблема`, text: 'Ось відповідь' });
      expect(res.status).toBe(404);
    });

    it('appends an ADMIN message and marks the conversation unread on success', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const id = '22222222-2222-2222-2222-222222222222';
      const createMessageMock = jest.fn().mockResolvedValue({ id: 'm-3', sender: 'ADMIN', body: 'Ось відповідь' });
      const updateMock = jest.fn().mockResolvedValue({});
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue({ id, userId: null }), update: updateMock },
        supportMessage: { create: createMessageMock, findFirst: jest.fn().mockResolvedValue(null) },
      });

      const res = await request(app)
        .post('/api/v1/support/webhook/inbound-email')
        .set('x-webhook-secret', 'right-secret')
        .send({ subject: `Re: [Ticket #${id}] Технічна проблема`, text: 'Ось відповідь' });

      expect(res.status).toBe(204);
      expect(createMessageMock).toHaveBeenCalledWith({ data: { conversationId: id, sender: 'ADMIN', body: 'Ось відповідь', externalId: null } });
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id }, data: expect.objectContaining({ unreadByUser: true }) }));
    });

    it('a repeated delivery of the same Message-ID is acknowledged without a second reply', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const id = '22222222-2222-2222-2222-222222222222';
      const stored: any[] = [];
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue({ id, userId: null }), update: jest.fn() },
        supportMessage: {
          create: jest.fn(async ({ data }: any) => { stored.push(data); return data; }),
          findFirst: jest.fn(async ({ where }: any) => stored.find((m) => m.externalId === where.externalId) ?? null),
        },
      });
      const send = () => request(app).post('/api/v1/support/webhook/inbound-email').set('x-webhook-secret', 'right-secret')
        .send({ subject: `Re: [Ticket #${id}] Тема`, text: 'Ось відповідь', messageId: '<abc@mail.example>' });
      expect((await send()).status).toBe(204);
      const again = await send();
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ duplicate: true });
      expect(stored).toHaveLength(1);
      expect(stored[0].externalId).toMatch(/^inbound:[0-9a-f]{64}$/);
    });

    it('without a Message-ID, the same text on the same ticket within 15 minutes is a duplicate', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const id = '22222222-2222-2222-2222-222222222222';
      const findFirst = jest.fn().mockResolvedValue({ id: 'm-earlier' });
      const create = jest.fn();
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue({ id, userId: null }), update: jest.fn() },
        supportMessage: { create, findFirst },
      });
      const res = await request(app).post('/api/v1/support/webhook/inbound-email').set('x-webhook-secret', 'right-secret')
        .send({ subject: `Re: [Ticket #${id}] Тема`, text: 'Ось відповідь' });
      expect(res.status).toBe(200);
      expect(create).not.toHaveBeenCalled();
      expect(findFirst.mock.calls[0][0].where).toMatchObject({ conversationId: id, sender: 'ADMIN', body: 'Ось відповідь', createdAt: { gte: expect.any(Date) } });
    });

    it('a missing secret header is rejected like a wrong one', async () => {
      process.env.SUPPORT_WEBHOOK_SECRET = 'right-secret';
      const app = buildApp();
      const res = await request(app).post('/api/v1/support/webhook/inbound-email').send({ subject: '[Ticket #x]', text: 'hi' });
      expect(res.status).toBe(401);
    });
  });
});
