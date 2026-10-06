import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { blockedContactEmails, normalizeContactEmail, contactEmailHash, CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED } from '../../services/ContactEmailPolicy';

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export function contactPolicyRouter(prisma: PrismaClient) {
  const router = Router();
  router.get('/admin/spam-emails', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ emails: await blockedContactEmails(prisma) });
  }));
  for (const [operation, action] of [['block', CONTACT_EMAIL_BLOCKED], ['unblock', CONTACT_EMAIL_UNBLOCKED]]) {
    router.post('/admin/spam-emails/' + operation, requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });
      const email = normalizeContactEmail(parsed.data.email);
      await prisma.auditLog.create({ data: { userId: req.userId!, action, metadata: { email, emailHash: contactEmailHash(email) } } });
      res.set('Cache-Control', 'private, no-store').json({ ok: true });
    }));
  }
  return router;
}
