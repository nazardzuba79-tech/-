import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { NrxDemoSales, NrxDemoError } from '../../services/testMarkets/NrxDemoSales';

/** Private simulation endpoints only. No allocation, migration, reset or real
 * Spot route is exposed here. Missing authorization always fails closed.
 * Production passes the existing deletion-gated seller as submit. */
export function nrxDemoRouter(prisma: PrismaClient, sales = new NrxDemoSales(prisma), submit: NrxDemoSales['sell'] = params => sales.sell(params)): Router {
  const router = Router();
  const auth = requireAuth(prisma), admin = requireAdmin(prisma);
  router.get('/demo/nrx', auth, admin, async (req: AuthedRequest, res, next) => {
    try { res.json(await sales.snapshot(req.userId!)); }
    catch (error) { if (error instanceof NrxDemoError) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  router.get('/demo/nrx/sales/:requestId', auth, admin, async (req: AuthedRequest, res, next) => {
    const id = z.string().uuid().safeParse(req.params.requestId);
    if (!id.success) return res.status(400).json({ error: 'Invalid request ID' });
    try { res.json(await sales.operation(req.userId!, id.data)); }
    catch (error) { if (error instanceof NrxDemoError) return res.status(error.status).json({ error: error.message }); next(error); }
  });
  const schema = z.object({ requestId: z.string().uuid(), quantity: z.string().min(1).max(40) }).strict();
  router.post('/demo/nrx/sell', auth, admin, async (req: AuthedRequest, res, next) => {
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Некорректный запрос продажи.', simulationOutcome: 'REJECTED' });
    try { res.json(await submit({ userId: req.userId!, ...input.data })); }
    catch (error) {
      if (error instanceof NrxDemoError) return res.status(error.status).json({ error: error.message,
        ...(error.status === 400 ? { simulationOutcome: 'REJECTED' } : {}) });
      next(error);
    }
  });
  return router;
}
