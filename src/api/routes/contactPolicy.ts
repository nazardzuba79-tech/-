import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { blockedContactEmails, normalizeContactEmail, contactEmailHash, CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED } from '../../services/ContactEmailPolicy';

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export function contactPolicyRouter(prisma: PrismaClient) {
  const router = Router();
  router.get('/admin/spam-emails', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ entries: await blockedContactEmails(prisma) });
  }));
  for (const [operation, action] of [['block', CONTACT_EMAIL_BLOCKED], ['unblock', CONTACT_EMAIL_UNBLOCKED]]) {
    router.post('/admin/spam-emails/' + operation, requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });
      const email = normalizeContactEmail(parsed.data.email);
      const actor = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
      // Serialize changes for one address; same-email clicks cannot race.
      await prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
        const previous = await tx.auditLog.findFirst({ where: { action: { in: [CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED] }, metadata: { path: ['emailHash'], equals: contactEmailHash(email) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } });
        const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1));
        await tx.auditLog.create({ data: { userId: req.userId!, action, createdAt, metadata: { email, emailHash: contactEmailHash(email), actorEmail: actor?.email || req.userId! } } });
        if (action === CONTACT_EMAIL_BLOCKED) {
          await tx.session.updateMany({ where: { revokedAt: null, user: { email: { equals: email, mode: 'insensitive' } } }, data: { revokedAt: new Date() } });
        }
      });
      res.set('Cache-Control', 'private, no-store').json({ ok: true });
    }));
  }
  return router;
}
