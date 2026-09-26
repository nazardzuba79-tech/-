process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminSupportRouter } from '../adminSupport';
import { SupportEmailService } from '../../../services/SupportEmailService';

const CONV = '11111111-2222-4333-8444-555555555555';
const SECRET = 'smtp-password-that-must-never-leak';

function bearer(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

/** requireAuth reads a session row; requireAdmin reads the role. */
function authPrisma(role: 'ADMIN' | 'USER') {
  return {
    user: { findUnique: jest.fn(async () => ({ id: 'u-1', role, blockedAt: null, tokenVersion: 0 })) },
    session: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
  };
}

function build(prisma: any, email: SupportEmailService, kick = jest.fn()) {
  const app = express();
  app.use(express.json());
  const withTx: any = { ...prisma };
  withTx.$transaction = jest.fn(async (fn: (tx: any) => unknown) => fn(withTx));
  app.use('/api/v1', adminSupportRouter(withTx, email, { kick }));
  app.use((_e: Error, _q: express.Request, res: express.Response, _n: express.NextFunction) => { res.status(500).json({ error: 'Internal server error' }); });
  return { app, kick };
}

function configuredEmail(sendMail = jest.fn().mockResolvedValue({})) {
  return new SupportEmailService({ sendMail } as any, {
    SUPPORT_ADMIN_EMAIL: 'voltex.crypto@gmail.com', SMTP_USER: 'relay@example.com', SMTP_PASS: SECRET,
  } as NodeJS.ProcessEnv);
}

function notificationTable(opts: { counts?: Record<string, number>; lastSent?: Date | null; lastFailure?: { at: Date; category: string; code: number | null } | null } = {}) {
  return {
    groupBy: jest.fn(async () => Object.entries(opts.counts ?? {}).map(([status, n]) => ({ status, _count: { _all: n } }))),
    findFirst: jest.fn(async ({ where }: any) => {
      if (where.status === 'SENT') return opts.lastSent ? { sentAt: opts.lastSent } : null;
      return opts.lastFailure ? { lastAttemptAt: opts.lastFailure.at, failureCategory: opts.lastFailure.category, failureCode: opts.lastFailure.code, status: 'PENDING' } : null;
    }),
    updateMany: jest.fn(async () => ({ count: 2 })),
  };
}

const auditLog = () => ({ create: jest.fn(async () => ({})) });

describe('admin support routes', () => {
  it('are ADMIN only: no token 401, a USER 403, and nothing is sent', async () => {
    const sendMail = jest.fn();
    const { app } = build({ ...authPrisma('USER'), supportNotification: notificationTable(), auditLog: auditLog() }, configuredEmail(sendMail));
    expect((await request(app).get('/api/v1/admin/support/diagnostics')).status).toBe(401);
    for (const [method, path] of [
      ['get', '/api/v1/admin/support/diagnostics'],
      ['post', '/api/v1/admin/support/test-email'],
      ['post', '/api/v1/admin/support/notifications/retry-failed'],
      ['get', '/api/v1/admin/support/conversations'],
      ['get', `/api/v1/admin/support/conversations/${CONV}`],
      ['post', `/api/v1/admin/support/conversations/${CONV}/reply`],
    ] as const) {
      const res = await (request(app) as any)[method](path).set('Authorization', bearer('u-1')).send({ body: 'x' });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  describe('diagnostics', () => {
    const at = (iso: string) => new Date(iso);

    it('not configured: says so, with the recipient that is set and no secret anywhere', async () => {
      const email = new SupportEmailService(undefined, { SUPPORT_ADMIN_EMAIL: 'voltex.crypto@gmail.com', SMTP_PASS: SECRET } as NodeJS.ProcessEnv);
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable({ counts: { PENDING: 3 } }) }, email);
      const res = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ state: 'not_configured', recipient: 'voltex.crypto@gmail.com', smtpConfigured: false, inboundConfigured: false, pending: 3, failed: 0 });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('configured but never delivered: "unverified", never "working"', async () => {
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable() }, configuredEmail());
      const res = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(res.body.state).toBe('unverified');
    });

    it('a SENT notification with no later failure: "working"', async () => {
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable({ counts: { SENT: 4 }, lastSent: at('2026-09-26T10:00:00Z') }) }, configuredEmail());
      const res = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(res.body).toMatchObject({ state: 'working', sent: 4, lastSentAt: '2026-09-26T10:00:00.000Z', lastFailedAt: null });
    });

    it('a failure after the last success: "failing", with a sanitized category', async () => {
      const table = notificationTable({ counts: { SENT: 1, FAILED: 1 }, lastSent: at('2026-09-26T10:00:00Z'), lastFailure: { at: at('2026-09-26T11:00:00Z'), category: 'AUTH', code: 535 } });
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: table }, configuredEmail());
      const res = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(res.body).toMatchObject({ state: 'failing', failed: 1, lastFailureCategory: 'AUTH', lastFailureCode: 535 });
    });
  });

  describe('test email', () => {
    it('sends to SUPPORT_ADMIN_EMAIL, reports Sent, and diagnostics turn "working"', async () => {
      const sendMail = jest.fn().mockResolvedValue({});
      const audit = auditLog();
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable(), auditLog: audit }, configuredEmail(sendMail));
      const res = await request(app).post('/api/v1/admin/support/test-email').set('Authorization', bearer('u-1'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, recipient: 'voltex.crypto@gmail.com' });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0].to).toBe('voltex.crypto@gmail.com');
      expect(audit.create).toHaveBeenCalledWith({ data: { userId: 'u-1', action: 'SUPPORT_TEST_EMAIL', metadata: { ok: true, category: null } } });
      const diag = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(diag.body).toMatchObject({ state: 'working', lastTest: { ok: true, category: null } });
    });

    it('a relay failure answers 502 with a category — no relay text, no password', async () => {
      const sendMail = jest.fn().mockRejectedValue(Object.assign(new Error(`Invalid login 535 ${SECRET}`), { code: 'EAUTH', responseCode: 535 }));
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable(), auditLog: auditLog() }, configuredEmail(sendMail));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const res = await request(app).post('/api/v1/admin/support/test-email').set('Authorization', bearer('u-1'));
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ ok: false, category: 'AUTH', code: 535 });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect(log.mock.calls.flat().join(' ')).not.toContain(SECRET);
      log.mockRestore();
      const diag = await request(app).get('/api/v1/admin/support/diagnostics').set('Authorization', bearer('u-1'));
      expect(diag.body.state).toBe('failing');
    });

    it('unconfigured answers 503 NOT_CONFIGURED', async () => {
      const email = new SupportEmailService(undefined, {} as NodeJS.ProcessEnv);
      const { app } = build({ ...authPrisma('ADMIN'), supportNotification: notificationTable(), auditLog: auditLog() }, email);
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const res = await request(app).post('/api/v1/admin/support/test-email').set('Authorization', bearer('u-1'));
      log.mockRestore();
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    });
  });

  it('retry-failed requeues FAILED rows with fresh attempts and kicks the outbox', async () => {
    const table = notificationTable();
    const { app, kick } = build({ ...authPrisma('ADMIN'), supportNotification: table, auditLog: auditLog() }, configuredEmail());
    const res = await request(app).post('/api/v1/admin/support/notifications/retry-failed').set('Authorization', bearer('u-1'));
    expect(res.body).toEqual({ requeued: 2 });
    expect(table.updateMany).toHaveBeenCalledWith({ where: { status: 'FAILED' }, data: expect.objectContaining({ status: 'PENDING', attempts: 0 }) });
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('lists conversations with name, email, subject, last message, unread and notification state', async () => {
    const row = {
      id: CONV, userId: null, guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'TECHNICAL', unreadByAdmin: true, unreadByUser: false,
      createdAt: new Date('2026-09-26T09:00:00Z'), updatedAt: new Date('2026-09-26T09:05:00Z'), _count: { messages: 2 },
      messages: [{ sender: 'USER', body: 'x'.repeat(400), createdAt: new Date('2026-09-26T09:05:00Z') }],
      notifications: [{ status: 'FAILED', failureCategory: 'CONNECTION', sentAt: null, attempts: 5 }],
    };
    const conv = { count: jest.fn(async () => 1), findMany: jest.fn(async (_args: any) => [row]) };
    const { app } = build({ ...authPrisma('ADMIN'), supportConversation: conv }, configuredEmail());
    const res = await request(app).get('/api/v1/admin/support/conversations?filter=attention').set('Authorization', bearer('u-1'));
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ id: CONV, name: 'Іван', email: 'ivan@example.com', subject: 'TECHNICAL', unreadByAdmin: true, messageCount: 2,
      notification: { status: 'FAILED', failureCategory: 'CONNECTION' } });
    expect(res.body.items[0].lastMessage.preview).toHaveLength(160);
    expect((conv.findMany.mock.calls[0] as any[])[0].where).toEqual({ notifications: { some: { status: { in: ['PENDING', 'FAILED'] } } } });
  });

  it('opening a conversation returns the whole thread with per-message delivery and clears the unread flag', async () => {
    const conversation = {
      id: CONV, userId: 'user-9', guestName: 'Іван', guestEmail: 'ivan@example.com', subject: 'KYC', unreadByAdmin: true, unreadByUser: false,
      createdAt: new Date(), updatedAt: new Date('2026-09-26T09:05:00Z'),
      messages: [{ id: 'm-1', sender: 'USER', body: 'hi', createdAt: new Date(), notification: { status: 'SENT', attempts: 1 } }],
    };
    const update = jest.fn(async () => ({}));
    const { app } = build({ ...authPrisma('ADMIN'), supportConversation: { findUnique: jest.fn(async () => conversation), update } }, configuredEmail());
    const res = await request(app).get(`/api/v1/admin/support/conversations/${CONV}`).set('Authorization', bearer('u-1'));
    expect(res.status).toBe(200);
    expect(res.body.messages[0]).toMatchObject({ id: 'm-1', body: 'hi', notification: { status: 'SENT' } });
    // Reading does not reorder the inbox: updatedAt is kept.
    expect(update).toHaveBeenCalledWith({ where: { id: CONV }, data: { unreadByAdmin: false, updatedAt: conversation.updatedAt } });
  });

  it('an admin reply becomes an ADMIN message the user sees as unread', async () => {
    const create = jest.fn(async ({ data }: any) => ({ id: 'm-9', createdAt: new Date(), ...data }));
    const update = jest.fn(async () => ({}));
    const audit = auditLog();
    const { app } = build({
      ...authPrisma('ADMIN'),
      supportConversation: { findUnique: jest.fn(async () => ({ id: CONV })), update },
      supportMessage: { create },
      auditLog: audit,
    }, configuredEmail());
    const res = await request(app).post(`/api/v1/admin/support/conversations/${CONV}/reply`).set('Authorization', bearer('u-1')).send({ body: '  Відповідь  ' });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: { conversationId: CONV, sender: 'ADMIN', body: 'Відповідь' } });
    expect(update).toHaveBeenCalledWith({ where: { id: CONV }, data: expect.objectContaining({ unreadByUser: true, unreadByAdmin: false }) });
    expect(audit.create).toHaveBeenCalled();
  });
});
