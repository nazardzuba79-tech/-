import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { CopyPerformanceService } from '../../services/copyTrading/CopyPerformanceService';
import { PUBLIC_STRATEGIES, resolveStrategyOwner } from '../../services/copyTrading/strategyOwner';
import { summarizeStrategy } from '../../services/copyTrading/marketplaceSummary';

/** Modeled strategy read endpoints; existing production session auth preserved.
 * The normal production backend owns persistence and same-environment identity.
 * The existing legacy synthetic/admin and real account routes remain separate. */
export function copyPerformanceRouter(prisma: PrismaClient, service = new CopyPerformanceService(prisma)) {
  const router = Router();
  // One authenticated bootstrap; a failed section must not discard its peers.
  // PerformanceService already coalesces and caches each UTC-day projection.
  // Identity/KYC is read afresh: it can legitimately change within the day.
  router.get('/copy-trading/marketplace', requireAuth(prisma), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Statistics from the COMPLETE history; the wire carries the latest ten
    // trade rows for the history table and nothing more. `summarizeStrategy`
    // reads every trade to build `tradeStats`, so no figure is derived from
    // the ten. See services/copyTrading/marketplaceSummary.ts.
    const results = await Promise.allSettled([
      service.get('nazar').then(summarizeStrategy),
      service.get('ksenia').then(summarizeStrategy),
      Promise.all(PUBLIC_STRATEGIES.map(id => resolveStrategyOwner(prisma, id))),
    ]);
    const [nazar, ksenia, identities] = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const errors = Object.fromEntries(results.flatMap((result, index) => result.status === 'rejected'
      ? [[['nazar', 'ksenia', 'identities'][index], 'temporarily_unavailable']] : []));
    res.status(results.every(result => result.status === 'rejected') ? 503 : 200)
      .json({ nazar, ksenia, identities, generatedAt: new Date().toISOString(), errors });
  });
  for (const strategy of ['nazar', 'ksenia'] as const) {
    router.get(`/copy-trading/${strategy}`, requireAuth(prisma), async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try { res.json(summarizeStrategy(await service.get(strategy))); }
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
