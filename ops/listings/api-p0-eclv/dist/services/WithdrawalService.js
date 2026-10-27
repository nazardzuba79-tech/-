"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawalService = exports.DemoFundsNotWithdrawableError = exports.WithdrawalRequestError = void 0;
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const testAssetConfig_1 = require("./testMarkets/testAssetConfig");
const WalletMutation_1 = require("./WalletMutation");
class WithdrawalRequestError extends Error {
}
exports.WithdrawalRequestError = WithdrawalRequestError;
/**
 * A demo-valued request: one that holds no `Balance` (`balanceHeld: false`). It is never filed, approved or
 * marked sent, independent of every feature switch (Issue #617); it can still be rejected.
 */
class DemoFundsNotWithdrawableError extends WithdrawalRequestError {
    constructor() {
        super('Demo funds are not withdrawable');
        this.code = 'DEMO_FUNDS_NOT_WITHDRAWABLE';
    }
}
exports.DemoFundsNotWithdrawableError = DemoFundsNotWithdrawableError;
/**
 * Manual withdrawal requests — the reverse of DepositService's manual
 * crediting flow. Requesting one immediately moves the amount from
 * `available` to `locked` (same available/locked mechanics OrderService
 * uses to hold funds against a resting order), so it can't also be spent
 * placing an order or withdrawn twice while pending.
 *
 * Lifecycle: PENDING (locked, awaiting review) -> APPROVED (admin has
 * reviewed and intends to send, still locked) -> SENT (admin actually
 * broadcast the transaction from the treasury wallet and recorded its
 * txHash, lock released — the funds genuinely left) — or PENDING/APPROVED
 * -> REJECTED at any point before SENT (lock released back to `available`,
 * since nothing was actually sent).
 *
 * Only a request that holds `Balance` can be paid. A Cross trading account
 * files none (requestUnheldWithdrawal), and an unheld request that already
 * exists can only be rejected.
 */
class WithdrawalService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * An unheld request held nothing: it is valued from demo funds and is never approved or paid. Decided on the row
     * read FOR UPDATE inside the same transaction as the status change (requireStatus), so it holds for requests filed
     * before this fence existed, under any switch.
     */
    refuseDemoFunds(withdrawal) {
        if (withdrawal.balanceHeld === false)
            throw new DemoFundsNotWithdrawableError();
    }
    async requestWithdrawal(params) {
        if ((0, testAssetConfig_1.isTestAssetPairOrSymbol)(params.asset))
            throw new WithdrawalRequestError(testAssetConfig_1.TEST_ASSET_NOT_TRADABLE_MESSAGE);
        const amount = new bignumber_js_1.default(params.amount);
        if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
            throw new WithdrawalRequestError('Amount must be greater than zero');
        }
        return this.prisma.$transaction(async (tx) => {
            try {
                await (0, WalletMutation_1.mutateSpotBalance)(tx, params.userId, params.asset, { available: amount.negated(), locked: amount });
            }
            catch (error) {
                if (error instanceof WalletMutation_1.InsufficientWalletBalance)
                    throw new WithdrawalRequestError(`Insufficient ${params.asset} balance`);
                throw error;
            }
            const withdrawal = await tx.withdrawal.create({
                data: {
                    userId: params.userId,
                    asset: params.asset,
                    network: params.network,
                    toAddress: params.toAddress,
                    amount: amount.toString(),
                    status: 'PENDING',
                },
            });
            await tx.auditLog.create({
                data: {
                    userId: params.userId,
                    action: 'WITHDRAWAL_REQUESTED',
                    metadata: {
                        withdrawalId: withdrawal.id,
                        asset: params.asset,
                        network: params.network,
                        toAddress: params.toAddress,
                        amount: amount.toString(),
                    },
                },
            });
            return this.toResult(withdrawal);
        });
    }
    /**
     * A withdrawal REQUEST from a Cross trading account — the owner's, or a
     * configured test account's. Permanently refused (Issue #617), whatever
     * the demo switches: that account's balance lives in the trading
     * simulation, whose only sources are DemoBalance and a preview fixture
     * (`NativeAccount.source`), never a ledger this service can hold. Nothing
     * is read or written; there is no exception switch.
     */
    async requestUnheldWithdrawal(_params) {
        throw new DemoFundsNotWithdrawableError();
    }
    /** Admin has reviewed the request and intends to send the funds — the
     * hold stays locked (nothing has actually moved on-chain yet). */
    async approveWithdrawal(params) {
        return this.prisma.$transaction(async (tx) => {
            const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['PENDING']);
            this.refuseDemoFunds(withdrawal);
            const updated = await tx.withdrawal.update({
                where: { id: withdrawal.id },
                data: { status: 'APPROVED', performedByAdminId: params.performedByAdminId },
            });
            await tx.auditLog.create({
                data: {
                    userId: withdrawal.userId,
                    action: 'WITHDRAWAL_APPROVED',
                    metadata: { withdrawalId: withdrawal.id, performedByAdminId: params.performedByAdminId },
                },
            });
            return this.toResult(updated);
        });
    }
    /** Admin confirms they've actually broadcast the transaction from the
     * treasury wallet — releases the locked hold without returning anything
     * to `available`, since the funds genuinely left, and records the txHash. */
    async markSent(params) {
        return this.prisma.$transaction(async (tx) => {
            const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['APPROVED']);
            this.refuseDemoFunds(withdrawal);
            // An unheld request moved nothing, so there is no lock to release.
            if (withdrawal.balanceHeld !== false) {
                await (0, WalletMutation_1.mutateSpotBalance)(tx, withdrawal.userId, withdrawal.asset, {
                    locked: new bignumber_js_1.default(withdrawal.amount.toString()).negated(),
                });
            }
            const updated = await tx.withdrawal.update({
                where: { id: withdrawal.id },
                data: { status: 'SENT', performedByAdminId: params.performedByAdminId, txHash: params.txHash },
            });
            await tx.auditLog.create({
                data: {
                    userId: withdrawal.userId,
                    action: 'WITHDRAWAL_SENT',
                    metadata: { withdrawalId: withdrawal.id, performedByAdminId: params.performedByAdminId, txHash: params.txHash },
                },
            });
            return this.toResult(updated);
        });
    }
    /** Admin declines the request — releases the locked hold back to
     * `available`, since nothing was actually sent. Allowed from PENDING or
     * APPROVED, any time before the funds are actually sent. */
    async rejectWithdrawal(params) {
        return this.prisma.$transaction(async (tx) => {
            const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['PENDING', 'APPROVED']);
            // An unheld request moved nothing, so there is nothing to give back.
            if (withdrawal.balanceHeld !== false) {
                const amount = new bignumber_js_1.default(withdrawal.amount.toString());
                await (0, WalletMutation_1.mutateSpotBalance)(tx, withdrawal.userId, withdrawal.asset, { available: amount, locked: amount.negated() });
            }
            const updated = await tx.withdrawal.update({
                where: { id: withdrawal.id },
                data: { status: 'REJECTED', performedByAdminId: params.performedByAdminId, rejectionReason: params.reason },
            });
            await tx.auditLog.create({
                data: {
                    userId: withdrawal.userId,
                    action: 'WITHDRAWAL_REJECTED',
                    metadata: { withdrawalId: withdrawal.id, performedByAdminId: params.performedByAdminId, reason: params.reason },
                },
            });
            return this.toResult(updated);
        });
    }
    async requireStatus(tx, withdrawalId, allowed) {
        await tx.$queryRaw `SELECT id FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
        const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
        if (!withdrawal)
            throw new WithdrawalRequestError('Withdrawal request not found');
        if (!withdrawal.userId)
            throw new WithdrawalRequestError('Historical withdrawal belongs to a deleted account');
        if (!allowed.includes(withdrawal.status)) {
            throw new WithdrawalRequestError(`Withdrawal request is already ${withdrawal.status}`);
        }
        return { ...withdrawal, userId: withdrawal.userId };
    }
    toResult(w) {
        return {
            id: w.id,
            asset: w.asset,
            network: w.network,
            toAddress: w.toAddress,
            amount: w.amount.toString(),
            status: w.status,
            txHash: w.txHash ?? undefined,
            balanceHeld: w.balanceHeld !== false,
        };
    }
}
exports.WithdrawalService = WithdrawalService;
//# sourceMappingURL=WithdrawalService.js.map