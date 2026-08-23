import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';

export class WithdrawalRequestError extends Error {}

export interface WithdrawalResult {
  id: string;
  asset: string;
  network: string;
  toAddress: string;
  amount: string;
  status: string;
}

/**
 * Manual withdrawal requests — the reverse of DepositService's manual
 * crediting flow. Requesting one immediately moves the amount from
 * `available` to `locked` (same available/locked mechanics OrderService
 * uses to hold funds against a resting order), so it can't also be spent
 * placing an order or withdrawn twice while pending. An admin then sends
 * the crypto by hand from the treasury wallet and marks the request
 * completed (locked hold released, nothing returns to available — the
 * funds actually left) or rejected (locked hold released back to
 * available — nothing left, so nothing to send).
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
    const amount = new BigNumber(params.amount);
    if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
      throw new WithdrawalRequestError('Amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const balance = await tx.balance.findUnique({
        where: { userId_asset: { userId: params.userId, asset: params.asset } },
      });
      const available = new BigNumber(balance?.available.toString() ?? '0');
      if (available.isLessThan(amount)) {
        throw new WithdrawalRequestError(`Insufficient ${params.asset} balance`);
      }

      await tx.balance.update({
        where: { userId_asset: { userId: params.userId, asset: params.asset } },
        data: {
          available: available.minus(amount).toString(),
          locked: new BigNumber(balance!.locked.toString()).plus(amount).toString(),
        },
      });

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

  /** Admin confirms they've manually sent the funds — releases the locked
   * hold without returning anything to `available`, since the funds
   * genuinely left the treasury wallet. */
  async completeWithdrawal(params: { withdrawalId: string; performedByAdminId: string }): Promise<WithdrawalResult> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requirePending(tx, params.withdrawalId);

      const balance = await tx.balance.findUnique({
        where: { userId_asset: { userId: withdrawal.userId, asset: withdrawal.asset } },
      });
      await tx.balance.update({
        where: { userId_asset: { userId: withdrawal.userId, asset: withdrawal.asset } },
        data: {
          locked: new BigNumber(balance!.locked.toString()).minus(withdrawal.amount.toString()).toString(),
        },
      });

      const updated = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'COMPLETED', performedByAdminId: params.performedByAdminId },
      });

      await tx.auditLog.create({
        data: {
          userId: withdrawal.userId,
          action: 'WITHDRAWAL_COMPLETED',
          metadata: { withdrawalId: withdrawal.id, performedByAdminId: params.performedByAdminId },
        },
      });

      return this.toResult(updated);
    });
  }

  /** Admin declines the request — releases the locked hold back to
   * `available`, since nothing was actually sent. */
  async rejectWithdrawal(params: {
    withdrawalId: string;
    performedByAdminId: string;
    reason?: string;
  }): Promise<WithdrawalResult> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requirePending(tx, params.withdrawalId);

      const balance = await tx.balance.findUnique({
        where: { userId_asset: { userId: withdrawal.userId, asset: withdrawal.asset } },
      });
      await tx.balance.update({
        where: { userId_asset: { userId: withdrawal.userId, asset: withdrawal.asset } },
        data: {
          available: new BigNumber(balance!.available.toString()).plus(withdrawal.amount.toString()).toString(),
          locked: new BigNumber(balance!.locked.toString()).minus(withdrawal.amount.toString()).toString(),
        },
      });

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

  private async requirePending(tx: Prisma.TransactionClient, withdrawalId: string) {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new WithdrawalRequestError('Withdrawal request not found');
    if (withdrawal.status !== 'PENDING') {
      throw new WithdrawalRequestError(`Withdrawal request is already ${withdrawal.status}`);
    }
    return withdrawal;
  }

  private toResult(w: { id: string; asset: string; network: string; toAddress: string; amount: unknown; status: string }): WithdrawalResult {
    return {
      id: w.id,
      asset: w.asset,
      network: w.network,
      toAddress: w.toAddress,
      amount: (w.amount as { toString(): string }).toString(),
      status: w.status,
    };
  }
}
