import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { DemoFundsNotWithdrawableError, WithdrawalService, WithdrawalRequestError } from '../../services/WithdrawalService';
import { FloorPriceSource, PROVENANCE_DECISION, ProvenanceDecisionError, provenanceRecord, recordProvenanceDecision, SyntheticProceedsLockedError } from '../../services/syntheticProceedsFloor';
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
export function adminWithdrawalsRouter(prisma: PrismaClient, prices?: FloorPriceSource): Router {
  const router = Router();
  // An unheld (demo-valued) request is never approved or sent, whatever the demo switches; it can be rejected.
  const service = new WithdrawalService(prisma, prices);

  router.get('/admin/withdrawals', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { email: true } } },
    });
    res.json(
      withdrawals.map((w) => ({
        id: w.id,
        userId: w.userId,
        userEmail: w.user?.email ?? 'Удалённый аккаунт',
        asset: w.asset,
        network: w.network,
        toAddress: w.toAddress,
        amount: w.amount.toString(),
        status: w.status,
        txHash: w.txHash,
        rejectionReason: w.rejectionReason,
        performedByAdminId: w.performedByAdminId,
        balanceHeld: w.balanceHeld,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }))
    );
  }));

  router.post('/admin/withdrawals/:id/approve', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    try {
      const result = await service.approveWithdrawal({ withdrawalId: req.params.id, performedByAdminId: req.userId! });
      res.json(result);
    } catch (err) {
      if (err instanceof DemoFundsNotWithdrawableError || err instanceof SyntheticProceedsLockedError) return res.status(403).json({ error: err.message, code: err.code });
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
  });

  const markSentSchema = z.object({ txHash: z.string().trim().min(1).max(256) });

  router.post('/admin/withdrawals/:id/mark-sent', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
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
      if (err instanceof DemoFundsNotWithdrawableError || err instanceof SyntheticProceedsLockedError) return res.status(403).json({ error: err.message, code: err.code });
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to mark withdrawal as sent' });
    }
  });

  const rejectSchema = z.object({ reason: z.string().optional() });

  router.post('/admin/withdrawals/:id/reject', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
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

  /**
   * Provenance quarantine (#630, owner decision 2026-11-01). Admin-only. Lists only the accounts identified
   * by immutable simulation-sale receipts, with their status and decision history — no balances. A decision
   * appends one audit row (admin, reason, requestId); it never changes a balance, order or withdrawal.
   */
  router.get('/admin/synthetic-provenance', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    const rows = await prisma.auditLog.findMany({ where: { action: { in: ['NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD'] }, userId: { not: null } },
      select: { userId: true }, distinct: ['userId'] });
    const accounts = [];
    for (const { userId } of rows) {
      try {
        const record = await provenanceRecord(prisma, userId!);
        if (record.status !== 'CLEAR') accounts.push({ userId, ...record });
      } catch (err) {
        // An unreadable receipt is itself a finding: listed as UNVERIFIED, never skipped.
        if (err instanceof SyntheticProceedsLockedError) accounts.push({ userId, status: 'UNVERIFIED', decisions: [], receiptError: err.message });
        else throw err;
      }
    }
    res.json({ action: PROVENANCE_DECISION, accounts });
  }));

  const decisionSchema = z.object({
    decision: z.enum(['QUARANTINE', 'RELEASE_TO_FLOOR']),
    reason: z.string().trim().min(10).max(1000),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  });

  router.post('/admin/synthetic-provenance/:userId/decision', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await recordProvenanceDecision(prisma, { userId: req.params.userId, adminId: req.userId!, ...parsed.data }));
    } catch (err) {
      if (err instanceof ProvenanceDecisionError) return res.status(err.code === 'NOT_IDENTIFIED' ? 404 : 409).json({ error: err.message, code: err.code });
      if (err instanceof SyntheticProceedsLockedError) return res.status(409).json({ error: err.message, code: err.code });
      console.error(err);
      res.status(500).json({ error: 'Failed to record decision' });
    }
  });

  return router;
}
