import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import type { SupportEmailService, SupportSendResult } from '../../services/SupportEmailService';
import type { SupportOutboxKick } from './support';

/**
 * Admin → Поддержка: a small support inbox and the email-delivery
 * diagnostics behind it. ADMIN only (role re-checked on every request).
 *
 * Diagnostics never expose SMTP credentials: they say whether a relay is
 * configured, who receives the notifications, and what the outbox has
 * actually done (last SENT, last failure category, pending/failed counts).
 * "Working" is claimed only after a real delivery — a notification SENT or
 * a test letter accepted by the relay — with no failure after it.
 */

const listQuery = z.object({
  filter: z.enum(['all', 'unread', 'attention']).default('all'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const replySchema = z.object({
  body: z.string().transform((value) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()).pipe(z.string().min(1).max(5000)),
});

const PAGE_SIZE = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SupportTestRecord {
  at: string;
  ok: boolean;
  category: string | null;
  code: number | null;
}

/** Express 4 does not catch a rejected async handler: pass it to the error middleware (500), never an unhandled rejection. */
function safe<T extends Request>(handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: T, res: Response, next: NextFunction) => { handler(req, res, next).catch(next); };
}

export function adminSupportRouter(prisma: PrismaClient, email: SupportEmailService, outbox: SupportOutboxKick): Router {
  const router = Router();
  const admin = [requireAuth(prisma), requireAdmin(prisma)];
  // The test button sends real mail: a handful per window is plenty.
  const testLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много тестовых писем. Попробуйте позже.' } });
  // Process-local: the last test is a diagnostic hint, not a record.
  let lastTest: SupportTestRecord | null = null;

  router.get('/admin/support/diagnostics', ...admin, safe(async (_req, res) => {
    const status = email.status();
    const [counts, lastSent, lastFailure] = await Promise.all([
      prisma.supportNotification.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.supportNotification.findFirst({ where: { status: 'SENT' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
      prisma.supportNotification.findFirst({
        where: { failureCategory: { not: null }, lastAttemptAt: { not: null } },
        orderBy: { lastAttemptAt: 'desc' },
        select: { lastAttemptAt: true, failureCategory: true, failureCode: true, status: true },
      }),
    ]);
    const count = (s: string) => counts.find((row) => row.status === s)?._count._all ?? 0;
    const lastSentAt = lastSent?.sentAt ?? null;
    const lastFailedAt = lastFailure?.lastAttemptAt ?? null;
    const lastTestOkAt = lastTest?.ok ? new Date(lastTest.at) : null;
    const lastTestFailAt = lastTest && !lastTest.ok ? new Date(lastTest.at) : null;
    const lastSuccess = [lastSentAt, lastTestOkAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const lastProblem = [lastFailedAt, lastTestFailAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;

    let state: 'working' | 'not_configured' | 'failing' | 'unverified';
    if (!status.smtpConfigured || !status.recipient) state = 'not_configured';
    else if (lastProblem && (!lastSuccess || lastProblem > lastSuccess)) state = 'failing';
    else if (lastSuccess) state = 'working';
    else state = 'unverified';

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      state,
      recipient: status.recipient,
      smtpConfigured: status.smtpConfigured,
      inboundConfigured: status.inboundConfigured,
      lastSentAt,
      lastFailedAt,
      lastFailureCategory: lastFailure?.failureCategory ?? null,
      lastFailureCode: lastFailure?.failureCode ?? null,
      pending: count('PENDING'),
      failed: count('FAILED'),
      sent: count('SENT'),
      lastTest,
    });
  }));

  router.post('/admin/support/test-email', testLimiter, ...admin, safe(async (req: AuthedRequest, res) => {
    const result: SupportSendResult = await email.sendTest();
    lastTest = {
      at: new Date().toISOString(),
      ok: result.ok,
      category: result.ok ? null : result.category,
      code: result.ok ? null : result.code,
    };
    await prisma.auditLog.create({
      data: { userId: req.userId ?? null, action: 'SUPPORT_TEST_EMAIL', metadata: { ok: result.ok, category: lastTest.category } },
    });
    if (result.ok) {
      console.log(`[support] test email SENT recipient=${result.recipient}`);
      return res.json({ ok: true, recipient: result.recipient, at: lastTest.at });
    }
    console.log(`[support] test email FAILED category=${result.category}${result.code ? ` code=${result.code}` : ''}`);
    res.status(result.category === 'NOT_CONFIGURED' ? 503 : 502).json({ ok: false, category: result.category, code: result.code, at: lastTest.at });
  }));

  // After the relay is fixed: give every FAILED notification a fresh set of attempts.
  router.post('/admin/support/notifications/retry-failed', ...admin, safe(async (req: AuthedRequest, res) => {
    const { count } = await prisma.supportNotification.updateMany({
      where: { status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), claimedUntil: null },
    });
    await prisma.auditLog.create({ data: { userId: req.userId ?? null, action: 'SUPPORT_NOTIFICATIONS_RETRIED', metadata: { count } } });
    outbox.kick();
    res.json({ requeued: count });
  }));

  router.get('/admin/support/conversations', ...admin, safe(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { filter, page } = parsed.data;
    const where = filter === 'unread'
      ? { unreadByAdmin: true }
      : filter === 'attention'
        ? { notifications: { some: { status: { in: ['PENDING', 'FAILED'] as ('PENDING' | 'FAILED')[] } } } }
        : {};
    const [total, rows, unread] = await Promise.all([
      prisma.supportConversation.count({ where }),
      prisma.supportConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, userId: true, guestName: true, guestEmail: true, subject: true,
          unreadByAdmin: true, unreadByUser: true, createdAt: true, updatedAt: true,
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, body: true, createdAt: true } },
          notifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, failureCategory: true, sentAt: true, attempts: true } },
        },
      }),
      prisma.supportConversation.count({ where: { unreadByAdmin: true } }),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      page,
      pageSize: PAGE_SIZE,
      total,
      unread,
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.guestName,
        email: row.guestEmail,
        subject: row.subject,
        unreadByAdmin: row.unreadByAdmin,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messageCount: row._count.messages,
        lastMessage: row.messages[0]
          ? { sender: row.messages[0].sender, preview: row.messages[0].body.slice(0, 160), createdAt: row.messages[0].createdAt }
          : null,
        notification: row.notifications[0] ?? null,
      })),
    });
  }));

  router.get('/admin/support/conversations/:id', ...admin, safe(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const conversation = await prisma.supportConversation.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { notification: { select: { status: true, attempts: true, sentAt: true, failureCategory: true, failureCode: true, nextAttemptAt: true } } },
        },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    if (conversation.unreadByAdmin) {
      await prisma.supportConversation.update({ where: { id: conversation.id }, data: { unreadByAdmin: false, updatedAt: conversation.updatedAt } });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      conversation: {
        id: conversation.id,
        userId: conversation.userId,
        name: conversation.guestName,
        email: conversation.guestEmail,
        subject: conversation.subject,
        unreadByUser: conversation.unreadByUser,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: conversation.messages.map((m) => ({
        id: m.id, sender: m.sender, body: m.body, createdAt: m.createdAt, notification: m.notification,
      })),
    });
  }));

  // A reply typed in the admin inbox lands in the user's chat window (their
  // widget polls it), the same way an inbound email reply does.
  router.post('/admin/support/conversations/:id/reply', ...admin, safe(async (req: AuthedRequest, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const conversation = await prisma.supportConversation.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({ data: { conversationId: conversation.id, sender: 'ADMIN', body: parsed.data.body } });
      await tx.supportConversation.update({ where: { id: conversation.id }, data: { unreadByUser: true, unreadByAdmin: false, updatedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: req.userId ?? null, action: 'SUPPORT_ADMIN_REPLY', metadata: { conversationId: conversation.id, messageId: created.id } } });
      return created;
    });
    res.status(201).json({ id: message.id, sender: message.sender, body: message.body, createdAt: message.createdAt, notification: null });
  }));

  return router;
}
