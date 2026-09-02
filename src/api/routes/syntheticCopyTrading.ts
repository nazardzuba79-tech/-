import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { SyntheticCopyTradingService } from '../../services/copyTrading/SyntheticCopyTradingService';
import { PrismaSyntheticStateStore } from '../../services/copyTrading/PrismaSyntheticStateStore';

const advanceSchema = z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]) });
const modeSchema = z.object({ mode: z.enum(['REAL_TIME', 'FAST_FORWARD']) });
const followerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NEW'), displayName: z.string().min(1).max(40), allocatedCapital: z.number().positive().max(10_000_000) }),
  z.object({ type: z.literal('INCREASE'), followerId: z.string(), amount: z.number().positive().max(10_000_000) }),
  z.object({ type: z.literal('DECREASE'), followerId: z.string(), amount: z.number().positive().max(10_000_000) }),
  z.object({ type: z.literal('STOP'), followerId: z.string() }),
]);

/**
 * Internal synthetic Copy Trading data only. This router never receives a
 * MatchingEngine or an OrderService and the persistence row has no relation
 * to User, Balance, Order, Deposit, Withdrawal or Trade.
 */
export function syntheticCopyTradingRouter(prisma: PrismaClient) {
  const router = Router();
  const service = new SyntheticCopyTradingService(new PrismaSyntheticStateStore(prisma));

  router.get('/copy-trading/synthetic', requireAuth(prisma), async (_req, res, next) => {
    try { res.json(await service.get()); } catch (error) { next(error); }
  });

  router.post('/admin/copy-trading/synthetic/advance', requireAuth(prisma), requireAdmin(prisma), async (req, res, next) => {
    try {
      const parsed = advanceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      res.json(await service.advance(parsed.data.days));
    } catch (error) { next(error); }
  });

  router.post('/admin/copy-trading/synthetic/reset', requireAuth(prisma), requireAdmin(prisma), async (_req, res, next) => {
    try { res.json(await service.reset()); } catch (error) { next(error); }
  });

  router.post('/admin/copy-trading/synthetic/mode', requireAuth(prisma), requireAdmin(prisma), async (req, res, next) => {
    try {
      const parsed = modeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      res.json(await service.setMode(parsed.data.mode));
    } catch (error) { next(error); }
  });

  router.post('/admin/copy-trading/synthetic/follower-event', requireAuth(prisma), requireAdmin(prisma), async (req, res, next) => {
    try {
      const parsed = followerEventSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      res.json(await service.followerEvent(parsed.data));
    } catch (error) { next(error); }
  });

  return router;
}
