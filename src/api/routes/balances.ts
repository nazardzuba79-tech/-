import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuthOrApiKey, ApiAuthedRequest } from '../middleware/apiKeyAuth';

export function balancesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/balances', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
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
