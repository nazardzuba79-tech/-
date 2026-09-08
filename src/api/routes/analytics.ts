import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { AnalyticsDataService } from '../../services/AnalyticsDataService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * The analytics data surface.
 *
 * ── Access policy, and why it changed ────────────────────────────────
 *
 * This route used to be `requireAuth + requireAdmin`, because the page it
 * served was an admin placeholder AND because the payload carried provider
 * circuit state, cooldowns and rate-limit counters — operational detail an
 * ordinary client has no business seeing.
 *
 * Analytics is a normal exchange feature, so the split is now between the
 * two kinds of data rather than between two kinds of page:
 *
 *   GET /analytics/overview     — signed-in users. Market-wide figures,
 *                                 published sentiment, and this venue's own
 *                                 derivatives state. All of it is ordinary
 *                                 exchange market information; every
 *                                 number in it is already visible on
 *                                 /markets or the futures terminal.
 *
 *   GET /analytics/diagnostics  — ADMIN ONLY. Provider circuit state,
 *                                 consecutive failures, cooldowns and
 *                                 rate-limit hits. Same gate, and the same
 *                                 reasoning, as GET /market/status.
 *
 * The user-facing payload is built by `getSnapshot()`, which has no access
 * to the health registry at all — the separation is structural, not a
 * field filter that a future edit could quietly widen.
 *
 * Both carry availability metadata rather than zeros: a section is
 * `available: true` with a value, a source and a fetch time, or
 * `available: false` with a reason and no value-carrying fields.
 */
export function analyticsRouter(prisma: PrismaClient, analyticsService: AnalyticsDataService): Router {
  const router = Router();

  router.get('/analytics/overview', requireAuth(prisma), async (req: AuthedRequest, res) => {
    try {
      // Bounded before it reaches a provider adapter, and validated
      // against the tracked list inside the service — a client cannot
      // steer Binance/OKX requests at an arbitrary symbol from here.
      const asset = typeof req.query.asset === 'string' ? req.query.asset.slice(0, 12) : undefined;
      res.json(await analyticsService.getSnapshot(asset));
    } catch (err) {
      // A snapshot builds each section independently, so reaching here
      // means something structural failed rather than one provider being
      // down — that is a 500, not a degraded 200.
      console.error('[analytics] snapshot failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get(
    '/analytics/diagnostics',
    requireAuth(prisma),
    requireAdmin(prisma),
    async (_req: AuthedRequest, res) => {
      try {
        res.json(analyticsService.getDiagnostics());
      } catch (err) {
        console.error('[analytics] diagnostics failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
