process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { supportRouter } from '../support';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any = {}, emailService: any = { notifyNewMessage: jest.fn().mockResolvedValue(undefined) }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', supportRouter(prisma, emailService));
  return app;
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
    it('creates a guest conversation and notifies the admin', async () => {
      const created = { id: 'conv-1', userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'TECHNICAL', messages: [{ id: 'm-1', sender: 'USER', body: 'Не працює вивід' }] };
      const createMock = jest.fn().mockResolvedValue(created);
      const emailService = { notifyNewMessage: jest.fn().mockResolvedValue(undefined) };
      const app = buildApp({ supportConversation: { create: createMock } }, emailService);

      const res = await request(app)
        .post('/api/v1/support/conversations')
        .send({ name: 'Іван', email: 'ivan@example.com', subject: 'TECHNICAL', message: 'Не працює вивід' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'TECHNICAL' }) })
      );
      expect(emailService.notifyNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-1', name: 'Іван', email: 'ivan@example.com', body: 'Не працює вивід' })
      );
    });

    it('ties the conversation to the logged-in user when authenticated', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: 'conv-2', userId: 'user-1' });
      const app = buildApp({ supportConversation: { create: createMock } });

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
      const res = await request(app).get('/api/v1/support/conversations/nope');
      expect(res.status).toBe(404);
    });

    it("403s when a different logged-in user requests someone else's conversation", async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', userId: 'owner' }) } });
      const res = await request(app).get('/api/v1/support/conversations/conv-1').set('Authorization', authHeader('someone-else'));
      expect(res.status).toBe(403);
    });

    it('allows an unauthenticated request for a guest conversation by id', async () => {
      const app = buildApp({
        supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', userId: null }) },
        supportMessage: { findMany: jest.fn().mockResolvedValue([{ id: 'm-1', sender: 'USER', body: 'hi' }]) },
      });
      const res = await request(app).get('/api/v1/support/conversations/conv-1');
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
    });
  });

  describe('GET /support/conversations/:id/status', () => {
    it('reports unread without mutating anything', async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', userId: null, unreadByUser: true }) } });
      const res = await request(app).get('/api/v1/support/conversations/conv-1/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadByUser: true });
    });
  });

  describe('POST /support/conversations/:id/messages', () => {
    it('adds a message and notifies the admin', async () => {
      const conversation = { id: 'conv-1', userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'OTHER' };
      const createMessageMock = jest.fn().mockResolvedValue({ id: 'm-2', sender: 'USER', body: 'Ще одне питання' });
      const emailService = { notifyNewMessage: jest.fn().mockResolvedValue(undefined) };
      const app = buildApp(
        {
          supportConversation: { findUnique: jest.fn().mockResolvedValue(conversation), update: jest.fn().mockResolvedValue(conversation) },
          supportMessage: { create: createMessageMock },
        },
        emailService
      );

      const res = await request(app).post('/api/v1/support/conversations/conv-1/messages').send({ body: 'Ще одне питання' });

      expect(res.status).toBe(201);
      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: { conversationId: 'conv-1', sender: 'USER', body: 'Ще одне питання' } })
      );
      expect(emailService.notifyNewMessage).toHaveBeenCalled();
    });

    it('403s on someone else\'s conversation', async () => {
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', userId: 'owner' }) } });
      const res = await request(app)
        .post('/api/v1/support/conversations/conv-1/messages')
        .set('Authorization', authHeader('someone-else'))
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /support/conversations/:id/read', () => {
    it('clears the unread flag', async () => {
      const updateMock = jest.fn().mockResolvedValue({});
      const app = buildApp({ supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', userId: null, unreadByUser: true }), update: updateMock } });
      const res = await request(app).post('/api/v1/support/conversations/conv-1/read');
      expect(res.status).toBe(204);
      expect(updateMock).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { unreadByUser: false } });
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
        supportMessage: { create: createMessageMock },
      });

      const res = await request(app)
        .post('/api/v1/support/webhook/inbound-email')
        .set('x-webhook-secret', 'right-secret')
        .send({ subject: `Re: [Ticket #${id}] Технічна проблема`, text: 'Ось відповідь' });

      expect(res.status).toBe(204);
      expect(createMessageMock).toHaveBeenCalledWith({ data: { conversationId: id, sender: 'ADMIN', body: 'Ось відповідь' } });
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id }, data: expect.objectContaining({ unreadByUser: true }) }));
    });
  });
});
