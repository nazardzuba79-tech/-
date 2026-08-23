import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { WithdrawalService, WithdrawalRequestError } from '../../services/WithdrawalService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * Manual withdrawal fulfillment — the mirror of adminDeposits.ts. A client's
 * request already locked their balance (see WithdrawalService); the flow is
 * PENDING -> APPROVED (admin has reviewed, still locked) -> SENT (admin has
 * actually broadcast the transaction from the treasury wallet by hand and
 * records its txHash here, which releases the lock) — or REJECTED at any
 * point before SENT, which returns the funds to the client's available
 * balance.
 */
export function adminWithdrawalsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const service = new WithdrawalService(prisma);

  router.get('/admin/withdrawals', requireAuth, requireAdmin(prisma), async (_req, res) => {
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { email: true } } },
    });
    res.json(
      withdrawals.map((w) => ({
        id: w.id,
        userId: w.userId,
        userEmail: w.user.email,
        asset: w.asset,
        network: w.network,
        toAddress: w.toAddress,
        amount: w.amount.toString(),
        status: w.status,
        txHash: w.txHash,
        rejectionReason: w.rejectionReason,
        performedByAdminId: w.performedByAdminId,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }))
    );
  });

  router.post('/admin/withdrawals/:id/approve', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    try {
      const result = await service.approveWithdrawal({ withdrawalId: req.params.id, performedByAdminId: req.userId! });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
  });

  const markSentSchema = z.object({ txHash: z.string().trim().min(1).max(256) });

  router.post('/admin/withdrawals/:id/mark-sent', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = markSentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const result = await service.markSent({
        withdrawalId: req.params.id,
        performedByAdminId: req.userId!,
        txHash: parsed.data.txHash,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to mark withdrawal as sent' });
    }
  });

  const rejectSchema = z.object({ reason: z.string().optional() });

  router.post('/admin/withdrawals/:id/reject', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const result = await service.rejectWithdrawal({
        withdrawalId: req.params.id,
        performedByAdminId: req.userId!,
        reason: parsed.data.reason,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to reject withdrawal' });
    }
  });

  return router;
}
