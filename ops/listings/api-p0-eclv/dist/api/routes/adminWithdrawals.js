"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminWithdrawalsRouter = adminWithdrawalsRouter;
const asyncRoute_1 = require("../asyncRoute");
const express_1 = require("express");
const zod_1 = require("zod");
const WithdrawalService_1 = require("../../services/WithdrawalService");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
/**
 * Manual withdrawal fulfillment — the mirror of adminDeposits.ts. A client's
 * request already locked their balance (see WithdrawalService); the flow is
 * PENDING -> APPROVED (admin has reviewed, still locked) -> SENT (admin has
 * actually broadcast the transaction from the treasury wallet by hand and
 * records its txHash here, which releases the lock) — or REJECTED at any
 * point before SENT, which returns the funds to the client's available
 * balance.
 */
function adminWithdrawalsRouter(prisma) {
    const router = (0, express_1.Router)();
    // An unheld (demo-valued) request is never approved or sent, whatever the demo switches; it can be rejected.
    const service = new WithdrawalService_1.WithdrawalService(prisma);
    router.get('/admin/withdrawals', (0, auth_1.requireAuth)(prisma), (0, admin_1.requireAdmin)(prisma), (0, asyncRoute_1.asyncRoute)(async (_req, res) => {
        const withdrawals = await prisma.withdrawal.findMany({
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { user: { select: { email: true } } },
        });
        res.json(withdrawals.map((w) => ({
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
        })));
    }));
    router.post('/admin/withdrawals/:id/approve', (0, auth_1.requireAuth)(prisma), (0, admin_1.requireAdmin)(prisma), async (req, res) => {
        try {
            const result = await service.approveWithdrawal({ withdrawalId: req.params.id, performedByAdminId: req.userId });
            res.json(result);
        }
        catch (err) {
            if (err instanceof WithdrawalService_1.DemoFundsNotWithdrawableError)
                return res.status(403).json({ error: err.message, code: err.code });
            if (err instanceof WithdrawalService_1.WithdrawalRequestError)
                return res.status(400).json({ error: err.message });
            console.error(err);
            res.status(500).json({ error: 'Failed to approve withdrawal' });
        }
    });
    const markSentSchema = zod_1.z.object({ txHash: zod_1.z.string().trim().min(1).max(256) });
    router.post('/admin/withdrawals/:id/mark-sent', (0, auth_1.requireAuth)(prisma), (0, admin_1.requireAdmin)(prisma), async (req, res) => {
        const parsed = markSentSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        try {
            const result = await service.markSent({
                withdrawalId: req.params.id,
                performedByAdminId: req.userId,
                txHash: parsed.data.txHash,
            });
            res.json(result);
        }
        catch (err) {
            if (err instanceof WithdrawalService_1.DemoFundsNotWithdrawableError)
                return res.status(403).json({ error: err.message, code: err.code });
            if (err instanceof WithdrawalService_1.WithdrawalRequestError)
                return res.status(400).json({ error: err.message });
            console.error(err);
            res.status(500).json({ error: 'Failed to mark withdrawal as sent' });
        }
    });
    const rejectSchema = zod_1.z.object({ reason: zod_1.z.string().optional() });
    router.post('/admin/withdrawals/:id/reject', (0, auth_1.requireAuth)(prisma), (0, admin_1.requireAdmin)(prisma), async (req, res) => {
        const parsed = rejectSchema.safeParse(req.body ?? {});
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        try {
            const result = await service.rejectWithdrawal({
                withdrawalId: req.params.id,
                performedByAdminId: req.userId,
                reason: parsed.data.reason,
            });
            res.json(result);
        }
        catch (err) {
            if (err instanceof WithdrawalService_1.WithdrawalRequestError)
                return res.status(400).json({ error: err.message });
            console.error(err);
            res.status(500).json({ error: 'Failed to reject withdrawal' });
        }
    });
    return router;
}
//# sourceMappingURL=adminWithdrawals.js.map