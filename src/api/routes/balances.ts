import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';

export function balancesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/balances', requireAuth, async (req: AuthedRequest, res) => {
    const balances = await prisma.balance.findMany({ where: { userId: req.userId } });
    res.json(
      balances.map((b: { asset: string; available: { toString(): string }; locked: { toString(): string } }) => ({
        asset: b.asset,
        available: b.available.toString(),
        locked: b.locked.toString(),
      }))
    );
  });

  return router;
}
