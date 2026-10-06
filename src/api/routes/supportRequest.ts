import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { isBlockedContactEmail } from '../../services/ContactEmailPolicy';

const form = z.object({ name: z.string().trim().min(1).max(100), subject: z.enum(['TECHNICAL', 'KYC', 'CARD', 'OTHER']), message: z.string().trim().min(1).max(2000), website: z.string().max(100).optional() });
export function supportRequestRouter(prisma: PrismaClient, send: typeof fetch = fetch) {
  const router = Router();
  const supportLimiter = rateLimit({ windowMs: 10 * 60_000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req: AuthedRequest) => req.userId! });
  router.post('/support/request', requireAuth(prisma), supportLimiter, asyncRoute(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true, blockedAt: true } });
    if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (user.blockedAt || await isBlockedContactEmail(prisma, user.email)) return res.status(403).json({ ok: false, error: 'not_allowed' });
    const parsed = form.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid' });
    const key = process.env.SUPPORT_RELAY_KEY;
    if (!key) return res.status(503).json({ ok: false, error: 'not_configured' });
    try {
      const upstream = await send('https://support.voltextech.net/v1/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://voltextech.net', 'X-Voltex-Support-Key': key, 'X-Voltex-Support-User': req.userId! },
        body: JSON.stringify({ ...parsed.data, email: user.email }), signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      const result = await upstream.json() as { ok?: boolean; error?: string };
      if (upstream.ok && result.ok === true) return res.json({ ok: true });
      const status = [400, 403, 413, 415, 429, 503].includes(upstream.status) ? upstream.status : 502;
      return res.status(status).json({ ok: false, error: status === 429 ? 'rate_limited' : 'delivery_failed' });
    } catch { return res.status(502).json({ ok: false, error: 'delivery_failed' }); }
  }));
  return router;
}
