import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncRoute } from '../asyncRoute';
import { CopyDemoError, CopyDemoService, copyDemoEnabled } from '../../services/copyTrading/CopyDemoService';

const risk = z.object({ traderId: z.enum(['VX-001', 'VX-KSENIA']), ratio: z.string().max(22),
  maxOrderUsdt: z.string().max(22), maxExposureUsdt: z.string().max(22) }).strict();
export function copyDemoRouter(db: PrismaClient, service: CopyDemoService, enabled = copyDemoEnabled) {
  const router = Router();
  router.use('/copy-trading/demo', requireAuth(db), (req: AuthedRequest, res, next) => {
    if (!enabled()) return res.status(403).json({ code: 'COPY_DEMO_OFF' });
    if (!req.sessionId) return res.status(401).json({ code: 'SESSION_REQUIRED' });
    next();
  });
  router.get('/copy-trading/demo', asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.json(await service.snapshot(req.userId!));
  }));
  router.put('/copy-trading/demo/subscription', asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = risk.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'INVALID_RISK' });
    const { traderId, ...limits } = parsed.data;
    await service.subscribe(req.userId!, traderId, limits);
    res.json(await service.snapshot(req.userId!));
  }));
  router.delete('/copy-trading/demo/subscription', asyncRoute(async (req: AuthedRequest, res) => {
    res.json(await service.stop(req.userId!));
  }));
  router.use((error: unknown, _req: unknown, res: any, next: (e: unknown) => void) => {
    if (error instanceof CopyDemoError) return res.status(error.status).json({ code: error.code, error: error.code });
    next(error);
  });
  return router;
}
