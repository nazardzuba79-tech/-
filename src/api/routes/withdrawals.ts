import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { WithdrawalService, WithdrawalRequestError } from '../../services/WithdrawalService';
import { requireAuth, AuthedRequest } from '../middleware/auth';

const requestSchema = z.object({
  asset: z.string().min(1),
  network: z.string().min(1),
  toAddress: z.string().min(1),
  amount: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'amount must be > 0'),
});

export function withdrawalsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const service = new WithdrawalService(prisma);

  // The account's own withdrawal-request history, scoped to the caller —
  // same pattern as GET /deposits/me.
  router.get('/withdrawals/me', requireAuth, async (req: AuthedRequest, res) => {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      withdrawals.map((w) => ({
        id: w.id,
        asset: w.asset,
        network: w.network,
        toAddress: w.toAddress,
        amount: w.amount.toString(),
        status: w.status,
        rejectionReason: w.rejectionReason,
        createdAt: w.createdAt,
      }))
    );
  });

  router.post('/withdrawals', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const result = await service.requestWithdrawal({ userId: req.userId!, ...parsed.data });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }
  });

  return router;
}
