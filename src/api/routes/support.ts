import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma, PrismaClient, SupportSubject } from '@prisma/client';
import { optionalAuth, requireAuth, AuthedRequest } from '../middleware/auth';

/**
 * Live-chat support widget backend. A conversation belongs either to a
 * logged-in user (userId set) or a guest (userId null, identified only by
 * knowing the conversation's own unguessable UUID — see the schema comment
 * on SupportConversation).
 *
 * Every USER message is written together with its SupportNotification row
 * in ONE transaction: the message and the promise to email the admin
 * mailbox commit or roll back together. The email itself is sent by
 * SupportNotificationOutbox (kicked right after the commit, retried on its
 * own schedule), so a relay that is down or unconfigured never fails the
 * user's request and never loses the message. An admin's reply comes back
 * in via /support/webhook/inbound-email, matched to the conversation by the
 * `[Ticket #<id>]` marker their mail client preserves in the subject.
 */

export interface SupportOutboxKick {
  kick(): void;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LINE_BREAKS_AND_CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** A display name: one line, no control characters. */
const nameField = z.string().transform((value) => value.replace(LINE_BREAKS_AND_CONTROL, ' ').replace(/\s{2,}/g, ' ').trim())
  .pipe(z.string().min(1).max(100));
/** Message text: keeps line breaks, drops other control characters. */
const bodyField = z.string().transform((value) => value.replace(CONTROL_CHARS, '').trim()).pipe(z.string().min(1).max(2000));

const startSchema = z.object({
  name: nameField,
  email: z.string().max(254).email(),
  subject: z.nativeEnum(SupportSubject),
  message: bodyField,
});

const messageSchema = z.object({
  body: bodyField,
});

const inboundWebhookSchema = z.object({
  subject: z.string().max(998),
  text: z.string().min(1).max(5000),
  /** The provider's Message-ID, when it forwards one: makes a retried delivery a no-op. */
  messageId: z.string().min(1).max(998).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches the `[Ticket #<uuid>]` marker SupportEmailService puts in every
// outbound notification subject — most mail clients preserve it verbatim
// when the admin hits reply, even after prefixing "Re: ".
const TICKET_ID_PATTERN = /\[Ticket #([0-9a-fA-F-]{36})\]/;

/** A reply with the same text on the same ticket this recently is a provider retry, not a new reply. */
const INBOUND_DUPLICATE_WINDOW_MS = 15 * 60_000;

function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const tooMany = { error: 'Слишком много сообщений. Попробуйте через несколько минут.' };

/** Express 4 does not catch a rejected async handler: pass it to the error middleware (500), never an unhandled rejection. */
function safe<T extends Request>(handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: T, res: Response, next: NextFunction) => { handler(req, res, next).catch(next); };
}

export function supportRouter(prisma: PrismaClient, outbox: SupportOutboxKick, options: { rateLimit?: boolean } = {}): Router {
  const router = Router();

  // Per-IP limits on top of the app-wide 120/min: a new conversation is a
  // rare act, a follow-up message less so. Each accepted message becomes
  // one admin email, so these are also the cap on mail volume.
  const limited = options.rateLimit !== false;
  const startLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: tooMany, skip: () => !limited });
  const messageLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: tooMany, skip: () => !limited });

  async function loadOwnedConversation(id: string, requesterId?: string) {
    if (!UUID.test(id)) return { status: 404 as const };
    const conversation = await prisma.supportConversation.findUnique({ where: { id } });
    if (!conversation) return { status: 404 as const };
    // A conversation tied to a user account is only visible to that user;
    // a guest conversation (userId null) is visible to anyone holding its
    // id, since the id itself is the guest's only credential.
    if (conversation.userId && conversation.userId !== requesterId) return { status: 403 as const };
    return { status: 200 as const, conversation };
  }

  router.post('/support/conversations', startLimiter, optionalAuth, safe(async (req: AuthedRequest, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, email, subject, message } = parsed.data;

    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.supportConversation.create({
        data: {
          userId: req.userId ?? null,
          guestName: name,
          guestEmail: email,
          subject,
          unreadByAdmin: true,
          messages: { create: { sender: 'USER', body: message } },
        },
        include: { messages: true },
      });
      await tx.supportNotification.create({
        data: { conversationId: created.id, messageId: created.messages[0].id },
      });
      return created;
    });

    outbox.kick();
    res.status(201).json(conversation);
  }));

  // Resume the logged-in user's most recent conversation (if any) without
  // needing a localStorage id — guests don't get this, they have no
  // account-level identity to look one up by.
  router.get('/support/conversations/mine', requireAuth(prisma), safe(async (req: AuthedRequest, res) => {
    const conversation = await prisma.supportConversation.findFirst({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ conversation });
  }));

  router.get('/support/conversations/:id', optionalAuth, safe(async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    const messages = await prisma.supportMessage.findMany({
      where: { conversationId: result.conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ conversation: result.conversation, messages });
  }));

  // Lightweight poll for the floating button's unread badge — deliberately
  // has no side effects (unlike the full thread fetch above, this must be
  // safe to call every few seconds without marking anything read).
  router.get('/support/conversations/:id/status', optionalAuth, safe(async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    res.json({ unreadByUser: result.conversation.unreadByUser });
  }));

  router.post('/support/conversations/:id/messages', messageLimiter, optionalAuth, safe(async (req: AuthedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    const { conversation } = result;

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: { conversationId: conversation.id, sender: 'USER', body: parsed.data.body },
      });
      await tx.supportConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date(), unreadByAdmin: true } });
      await tx.supportNotification.create({ data: { conversationId: conversation.id, messageId: created.id } });
      return created;
    });

    outbox.kick();
    res.status(201).json(message);
  }));

  router.post('/support/conversations/:id/read', optionalAuth, safe(async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    await prisma.supportConversation.update({ where: { id: result.conversation.id }, data: { unreadByUser: false } });
    res.status(204).end();
  }));

  // Inbound-email ingestion: the deployer's mail provider (SendGrid Inbound
  // Parse, Resend inbound webhook, or a small relay function in front of
  // either) should translate its own native payload into this shape and
  // POST it here. Not tied to one vendor's exact webhook format since
  // there isn't a universal one — this is the stable, documented contract
  // on our side (see .env.example for SUPPORT_WEBHOOK_SECRET). A retried
  // delivery (same Message-ID, or the same text on the same ticket within
  // 15 minutes) is acknowledged without posting the reply twice.
  router.post('/support/webhook/inbound-email', safe(async (req, res) => {
    const secret = process.env.SUPPORT_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Inbound email webhook is not configured' });
    if (!secretMatches(req.headers['x-webhook-secret'], secret)) return res.status(401).json({ error: 'Invalid webhook secret' });

    const parsed = inboundWebhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const match = parsed.data.subject.match(TICKET_ID_PATTERN);
    if (!match) return res.status(400).json({ error: 'No ticket id found in subject' });

    const conversation = await prisma.supportConversation.findUnique({ where: { id: match[1] } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const externalId = parsed.data.messageId
      ? `inbound:${createHash('sha256').update(parsed.data.messageId.trim()).digest('hex')}`
      : null;
    const text = parsed.data.text.replace(CONTROL_CHARS, '');

    try {
      const duplicate = await prisma.$transaction(async (tx) => {
        const recent = await tx.supportMessage.findFirst({
          where: {
            conversationId: conversation.id,
            sender: 'ADMIN',
            ...(externalId
              ? { externalId }
              : { body: text, createdAt: { gte: new Date(Date.now() - INBOUND_DUPLICATE_WINDOW_MS) } }),
          },
          select: { id: true },
        });
        if (recent) return true;
        await tx.supportMessage.create({
          data: { conversationId: conversation.id, sender: 'ADMIN', body: text, externalId },
        });
        await tx.supportConversation.update({
          where: { id: conversation.id },
          data: { unreadByUser: true, updatedAt: new Date() },
        });
        return false;
      });
      if (duplicate) return res.status(200).json({ duplicate: true });
    } catch (error) {
      // Two deliveries of one Message-ID racing: the unique externalId let exactly one in.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(200).json({ duplicate: true });
      }
      throw error;
    }

    res.status(204).end();
  }));

  return router;
}
