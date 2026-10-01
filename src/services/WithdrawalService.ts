import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';

export class WithdrawalRequestError extends Error {}

export interface WithdrawalResult {
  id: string;
  asset: string;
  network: string;
  toAddress: string;
  amount: string;
  status: string;
  txHash?: string;
  /** False for a request that held nothing (see requestUnheldWithdrawal). */
  balanceHeld: boolean;
}

/** Requests that still claim an unheld amount: open, or already paid out. */
export const UNHELD_CLAIMING_STATUSES = ['PENDING', 'APPROVED', 'SENT'];

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
 * A Cross trading account's request follows the same lifecycle without the
 * lock: see requestUnheldWithdrawal.
 */
export class WithdrawalService {
  constructor(private prisma: PrismaClient) {}

  async requestWithdrawal(params: {
    userId: string;
    asset: string;
    network: string;
    toAddress: string;
    amount: string;
  }): Promise<WithdrawalResult> {
    if (isTestAssetPairOrSymbol(params.asset)) throw new WithdrawalRequestError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const amount = new BigNumber(params.amount);
    if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
      throw new WithdrawalRequestError('Amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      try {
        await mutateSpotBalance(tx, params.userId, params.asset, { available: amount.negated(), locked: amount });
      } catch (error) {
        if (error instanceof InsufficientWalletBalance) throw new WithdrawalRequestError(`Insufficient ${params.asset} balance`);
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
   * configured test account's — whose balance lives in the trading
   * simulation rather than in the spot ledger this service can hold.
   *
   * Nothing is moved. The request is recorded for the admin, who reviews it
   * and pays by hand, exactly as for a held request; it simply has no lock to
   * release or return (`balanceHeld: false`).
   *
   * `available` is what the account can withdraw of this asset right now,
   * read by the caller from the account's own valuation. Unheld requests
   * that are open or already paid out for the same asset count against it,
   * under a lock on the user's row, so neither two requests at once nor a
   * repeat after a payout can claim the same funds twice.
   */
  async requestUnheldWithdrawal(params: {
    userId: string;
    asset: string;
    network: string;
    toAddress: string;
    amount: string;
    available: string;
  }): Promise<WithdrawalResult> {
    if (isTestAssetPairOrSymbol(params.asset)) throw new WithdrawalRequestError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const amount = new BigNumber(params.amount);
    if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
      throw new WithdrawalRequestError('Amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${params.userId} FOR UPDATE`;
      const claimed = await this.unheldClaimed(tx, params.userId, params.asset);
      const withdrawable = BigNumber.max(new BigNumber(params.available).minus(claimed), 0);
      if (!withdrawable.isFinite() || withdrawable.isLessThan(amount)) {
        throw new WithdrawalRequestError(`Insufficient ${params.asset} balance`);
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: params.userId,
          asset: params.asset,
          network: params.network,
          toAddress: params.toAddress,
          amount: amount.toString(),
          status: 'PENDING',
          balanceHeld: false,
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
            balanceHeld: false,
          },
        },
      });

      return this.toResult(withdrawal);
    });
  }

  /** The part of an unheld balance already claimed by this user's requests. */
  async unheldClaimed(db: Prisma.TransactionClient | PrismaClient, userId: string, asset: string): Promise<BigNumber> {
    const sum = await db.withdrawal.aggregate({
      where: { userId, asset, balanceHeld: false, status: { in: UNHELD_CLAIMING_STATUSES } },
      _sum: { amount: true },
    });
    return new BigNumber(sum._sum.amount?.toString() ?? '0');
  }

  /** Admin has reviewed the request and intends to send the funds — the
   * hold stays locked (nothing has actually moved on-chain yet). */
  async approveWithdrawal(params: { withdrawalId: string; performedByAdminId: string }): Promise<WithdrawalResult> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['PENDING']);

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
  async markSent(params: { withdrawalId: string; performedByAdminId: string; txHash: string }): Promise<WithdrawalResult> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['APPROVED']);

      // An unheld request moved nothing, so there is no lock to release.
      if (withdrawal.balanceHeld !== false) {
        await mutateSpotBalance(tx, withdrawal.userId, withdrawal.asset, {
          locked: new BigNumber(withdrawal.amount.toString()).negated(),
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
  async rejectWithdrawal(params: {
    withdrawalId: string;
    performedByAdminId: string;
    reason?: string;
  }): Promise<WithdrawalResult> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['PENDING', 'APPROVED']);

      // An unheld request moved nothing, so there is nothing to give back.
      if (withdrawal.balanceHeld !== false) {
        const amount = new BigNumber(withdrawal.amount.toString());
        await mutateSpotBalance(tx, withdrawal.userId, withdrawal.asset, { available: amount, locked: amount.negated() });
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

  private async requireStatus(tx: Prisma.TransactionClient, withdrawalId: string, allowed: string[]) {
    await tx.$queryRaw`SELECT id FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new WithdrawalRequestError('Withdrawal request not found');
    if (!withdrawal.userId) throw new WithdrawalRequestError('Historical withdrawal belongs to a deleted account');
    if (!allowed.includes(withdrawal.status)) {
      throw new WithdrawalRequestError(`Withdrawal request is already ${withdrawal.status}`);
    }
    return { ...withdrawal, userId: withdrawal.userId };
  }

  private toResult(w: {
    id: string;
    asset: string;
    network: string;
    toAddress: string;
    amount: unknown;
    status: string;
    txHash?: string | null;
    balanceHeld?: boolean | null;
  }): WithdrawalResult {
    return {
      id: w.id,
      asset: w.asset,
      network: w.network,
      toAddress: w.toAddress,
      amount: (w.amount as { toString(): string }).toString(),
      status: w.status,
      txHash: w.txHash ?? undefined,
      balanceHeld: w.balanceHeld !== false,
    };
  }
}
