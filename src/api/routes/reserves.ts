import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { getReserves } from '../../services/ReservesService';

/**
 * A self-reported reserves check (see ReservesService's own doc comment for
 * exactly what it does and doesn't prove) — gated behind login like the
 * rest of the app rather than published publicly, since that's a bigger
 * decision than this task covers.
 */
export function reservesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/reserves', requireAuth(prisma), async (_req, res) => {
    const rows = await getReserves(prisma);
    res.json(rows);
  });

  return router;
}
