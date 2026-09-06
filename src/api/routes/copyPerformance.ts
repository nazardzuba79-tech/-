import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { CopyPerformanceService } from '../../services/copyTrading/CopyPerformanceService';
import { PUBLIC_STRATEGIES, resolveStrategyOwner } from '../../services/copyTrading/strategyOwner';

/** Modeled strategy read endpoints; existing production session auth preserved.
 * The normal production backend owns persistence and same-environment identity.
 * The existing legacy synthetic/admin and real account routes remain separate. */
export function copyPerformanceRouter(prisma: PrismaClient, service = new CopyPerformanceService(prisma)) {
  const router = Router();
  for (const strategy of ['nazar', 'ksenia'] as const) {
    router.get(`/copy-trading/${strategy}`, requireAuth(prisma), async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try { res.json(await service.get(strategy)); }
      catch { res.status(503).json({ error: 'Strategy performance temporarily unavailable' }); }
    });
  }
  router.get('/copy-trading/identities', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ identities: await Promise.all(PUBLIC_STRATEGIES.map(id => resolveStrategyOwner(prisma, id))) }); }
    catch { res.status(503).json({ error: 'Strategy identity temporarily unavailable' }); }
  });
  router.get('/copy-trading/identity/:traderId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await resolveStrategyOwner(prisma, req.params.traderId);
      if (!identity) { res.status(404).json({ error: 'Strategy unavailable' }); return; }
      res.json(identity);
    } catch { res.status(503).json({ error: 'Strategy identity temporarily unavailable' }); }
  });
  return router;
}
