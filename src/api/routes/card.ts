import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { CardApplicationError, CardApplicationService, CardUsdPriceSource } from '../../services/CardApplicationService';

/**
 * Authenticated eligibility and persisted requests, with no issuance effects.
 */
export function cardRouter(prisma: PrismaClient, prices: CardUsdPriceSource): Router {
  const router = Router();
  const applications = new CardApplicationService(prisma, prices);
  const applicationInput = z.object({ product: z.enum(['TITANIUM', 'BLACK_SIGNATURE']) }).strict();
  router.use(['/card/application', '/card/application/me'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/card/application/me', requireAuth(prisma), async (req: AuthedRequest, res, next) => {
    try {
      res.json(await applications.getSnapshot(req.userId!));
    } catch (error) {
      if (error instanceof CardApplicationError) return res.status(error.statusCode).json({ error: error.code });
      next(error);
    }
  });

  router.post('/card/application', requireAuth(prisma), async (req: AuthedRequest, res, next) => {
    const parsed = applicationInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_CARD_PRODUCT' });
    try {
      res.json(await applications.submit(req.userId!, parsed.data.product));
    } catch (error) {
      if (error instanceof CardApplicationError) {
        return res.status(error.statusCode).json({ error: error.code, ...error.snapshot });
      }
      next(error);
    }
  });

  // Read-only legacy history remains intact; it is never a card application.
  router.get('/card/waitlist/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ joined: user.cardWaitlistJoinedAt != null, joinedAt: user.cardWaitlistJoinedAt, kycStatus: user.kycStatus });
  });

  router.post('/card/waitlist/join', requireAuth(prisma), (_req, res) => {
    res.status(410).json({ error: 'CARD_APPLICATION_REQUIRED' });
  });

  return router;
}
