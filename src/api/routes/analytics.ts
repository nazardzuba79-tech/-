import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { AnalyticsDataService } from '../../services/AnalyticsDataService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * The analytics data surface. Admin-only, matching the page it exists for:
 * /analytics is gated behind useAdminGate on the frontend and this is the
 * server-side half of the same gate — the frontend guard closes the route,
 * this one closes the data. That permission model is unchanged by this
 * file; it just reuses the existing requireAuth + requireAdmin pair every
 * other admin route already uses.
 *
 * The payload deliberately carries availability metadata rather than
 * zeros: a section is `available: true` with real values, or
 * `available: false` with a reason. See AnalyticsDataService for which
 * metrics are genuinely backed and which are explicitly unsupported.
 *
 * Nothing here is public. It includes provider health, which is
 * operational detail an ordinary client has no business seeing.
 */
export function analyticsRouter(prisma: PrismaClient, analyticsService: AnalyticsDataService): Router {
  const router = Router();

  router.get('/analytics/overview', requireAuth(prisma), requireAdmin(prisma), async (_req: AuthedRequest, res) => {
    try {
      res.json(await analyticsService.getSnapshot());
    } catch (err) {
      // A snapshot builds each section independently, so reaching here
      // means something structural failed rather than one provider being
      // down — that is a 500, not a degraded 200.
      console.error('[analytics] snapshot failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
