import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient, SupportSubject } from '@prisma/client';
import { optionalAuth, requireAuth, AuthedRequest } from '../middleware/auth';
import { SupportEmailService } from '../../services/SupportEmailService';

/**
 * Live-chat support widget backend. A conversation belongs either to a
 * logged-in user (userId set) or a guest (userId null, identified only by
 * knowing the conversation's own unguessable UUID — see the schema comment
 * on SupportConversation). Every user-sent message triggers an email to
 * the admin mailbox (SupportEmailService); an admin's reply comes back in
 * via /support/webhook/inbound-email, matched to the conversation by the
 * `[Ticket #<id>]` marker their mail client preserves in the subject on
 * reply.
 */

const SUBJECT_LABELS: Record<SupportSubject, string> = {
  TECHNICAL: 'Техническая проблема',
  KYC: 'Вопрос по KYC',
  CARD: 'Вопрос по карте',
  OTHER: 'Другое',
};

const startSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  subject: z.nativeEnum(SupportSubject),
  message: z.string().min(1).max(2000),
});

const messageSchema = z.object({
  body: z.string().min(1).max(2000),
});

const inboundWebhookSchema = z.object({
  subject: z.string(),
  text: z.string().min(1).max(5000),
});

// Matches the `[Ticket #<uuid>]` marker SupportEmailService puts in every
// outbound notification subject — most mail clients preserve it verbatim
// when the admin hits reply, even after prefixing "Re: ".
const TICKET_ID_PATTERN = /\[Ticket #([0-9a-fA-F-]{36})\]/;

export function supportRouter(prisma: PrismaClient, emailService: SupportEmailService): Router {
  const router = Router();

  async function loadOwnedConversation(id: string, requesterId?: string) {
    const conversation = await prisma.supportConversation.findUnique({ where: { id } });
    if (!conversation) return { status: 404 as const };
    // A conversation tied to a user account is only visible to that user;
    // a guest conversation (userId null) is visible to anyone holding its
    // id, since the id itself is the guest's only credential.
    if (conversation.userId && conversation.userId !== requesterId) return { status: 403 as const };
    return { status: 200 as const, conversation };
  }

  router.post('/support/conversations', optionalAuth, async (req: AuthedRequest, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, email, subject, message } = parsed.data;

    const conversation = await prisma.supportConversation.create({
      data: {
        userId: req.userId ?? null,
        guestName: name,
        guestEmail: email,
        subject,
        messages: { create: { sender: 'USER', body: message } },
      },
      include: { messages: true },
    });

    emailService
      .notifyNewMessage({
        conversationId: conversation.id,
        subjectLabel: SUBJECT_LABELS[subject],
        name,
        email,
        body: message,
      })
      .catch(() => {}); // best-effort — see SupportEmailService

    res.status(201).json(conversation);
  });

  // Resume the logged-in user's most recent conversation (if any) without
  // needing a localStorage id — guests don't get this, they have no
  // account-level identity to look one up by.
  router.get('/support/conversations/mine', requireAuth, async (req: AuthedRequest, res) => {
    const conversation = await prisma.supportConversation.findFirst({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ conversation });
  });

  router.get('/support/conversations/:id', optionalAuth, async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    const messages = await prisma.supportMessage.findMany({
      where: { conversationId: result.conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ conversation: result.conversation, messages });
  });

  // Lightweight poll for the floating button's unread badge — deliberately
  // has no side effects (unlike the full thread fetch above, this must be
  // safe to call every few seconds without marking anything read).
  router.get('/support/conversations/:id/status', optionalAuth, async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    res.json({ unreadByUser: result.conversation.unreadByUser });
  });

  router.post('/support/conversations/:id/messages', optionalAuth, async (req: AuthedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    const { conversation } = result;

    const message = await prisma.supportMessage.create({
      data: { conversationId: conversation.id, sender: 'USER', body: parsed.data.body },
    });
    await prisma.supportConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    emailService
      .notifyNewMessage({
        conversationId: conversation.id,
        subjectLabel: SUBJECT_LABELS[conversation.subject],
        name: conversation.guestName,
        email: conversation.guestEmail,
        body: parsed.data.body,
      })
      .catch(() => {});

    res.status(201).json(message);
  });

  router.post('/support/conversations/:id/read', optionalAuth, async (req: AuthedRequest, res) => {
    const result = await loadOwnedConversation(req.params.id, req.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: 'Not found' });
    await prisma.supportConversation.update({ where: { id: result.conversation.id }, data: { unreadByUser: false } });
    res.status(204).end();
  });

  // Inbound-email ingestion: the deployer's mail provider (SendGrid Inbound
  // Parse, Resend inbound webhook, or a small relay function in front of
  // either) should translate its own native payload into this shape and
  // POST it here. Not tied to one vendor's exact webhook format since
  // there isn't a universal one — this is the stable, documented contract
  // on our side (see .env.example for SUPPORT_WEBHOOK_SECRET).
  router.post('/support/webhook/inbound-email', async (req, res) => {
    const secret = process.env.SUPPORT_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Inbound email webhook is not configured' });
    if (req.headers['x-webhook-secret'] !== secret) return res.status(401).json({ error: 'Invalid webhook secret' });

    const parsed = inboundWebhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const match = parsed.data.subject.match(TICKET_ID_PATTERN);
    if (!match) return res.status(400).json({ error: 'No ticket id found in subject' });

    const conversation = await prisma.supportConversation.findUnique({ where: { id: match[1] } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    await prisma.supportMessage.create({
      data: { conversationId: conversation.id, sender: 'ADMIN', body: parsed.data.text },
    });
    await prisma.supportConversation.update({
      where: { id: conversation.id },
      data: { unreadByUser: true, updatedAt: new Date() },
    });

    res.status(204).end();
  });

  return router;
}
