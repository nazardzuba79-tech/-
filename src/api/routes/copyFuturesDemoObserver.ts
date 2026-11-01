import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncRoute } from '../asyncRoute';
import { FuturesDemoObserverService, FuturesDemoObserverError, futuresDemoObserverEnabled } from '../../services/copyTrading/FuturesDemoObserverService';

const request = z.object({
  traderId: z.enum(['VX-001', 'VX-KSENIA']),
  maxLeverage: z.string().max(32),
  maxFillUsdt: z.string().max(32),
}).strict();

/** Explicit read-only test surface. It cannot place, close, or copy orders.
 * Routes are hard-OFF for ordinary production and remote DB configurations.
 */
export function copyFuturesDemoObserverRouter(
  db: PrismaClient, observer: FuturesDemoObserverService,
  enabled: () => boolean = futuresDemoObserverEnabled,
) {
  const router = Router();
  router.use('/copy-trading/futures-demo-observer',
    (req, res, next) => enabled() ? next() : res.status(403).json({ code: 'FUTURES_DEMO_OBSERVER_OFF' }),
    requireAuth(db),
    (req: AuthedRequest, res, next) => req.sessionId
      ? next() : res.status(401).json({ code: 'SESSION_REQUIRED' }));
  router.get('/copy-trading/futures-demo-observer', asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await observer.snapshot(req.userId!, req.sessionId!));
  }));
  router.put('/copy-trading/futures-demo-observer/subscription', asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = request.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'INVALID_OBSERVER_REQUEST' });
    const { traderId, maxLeverage, maxFillUsdt } = parsed.data;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await observer.subscribe(req.userId!, req.sessionId!, traderId, { maxLeverage, maxFillUsdt }));
  }));
  router.post('/copy-trading/futures-demo-observer/scan', asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await observer.scan(req.userId!, req.sessionId!));
  }));
  router.delete('/copy-trading/futures-demo-observer/subscription', asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await observer.stop(req.userId!, req.sessionId!));
  }));
  router.use((error: unknown, _req: unknown, res: any, next: (e: unknown) => void) => {
    if (error instanceof FuturesDemoObserverError) return res.status(error.status).json({ code: error.code });
    next(error);
  });
  return router;
}
