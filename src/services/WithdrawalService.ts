import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';
import { assertFloor, FloorPriceSource, isMintedListingAsset, lockFloor, prepareFloor } from './syntheticProceedsFloor';

export class WithdrawalRequestError extends Error {}

/**
 * A demo-valued request: one that holds no `Balance` (`balanceHeld: false`). It is never filed, approved or
 * marked sent, independent of every feature switch (Issue #617); it can still be rejected.
 */
export class DemoFundsNotWithdrawableError extends WithdrawalRequestError {
  readonly code = 'DEMO_FUNDS_NOT_WITHDRAWABLE';
  constructor() { super('Demo funds are not withdrawable'); }
}

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
export class WithdrawalService {
  /** `prices` values an account that holds legacy simulated-sale proceeds (syntheticProceedsFloor); without it such
   * an account withdraws nothing. No other account is priced. */
  constructor(private prisma: PrismaClient, private prices?: FloorPriceSource) {}

  /** The floor marks of the withdrawal's owner, read before its transaction; null for an ordinary account. */
  private async floorOf(withdrawalId: string) {
    const row = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId }, select: { userId: true } });
    return row?.userId ? prepareFloor(this.prisma, row.userId, this.prices) : null;
  }

  /**
   * An unheld request held nothing: it is valued from demo funds and is never approved or paid. Decided on the row
   * read FOR UPDATE inside the same transaction as the status change (requireStatus), so it holds for requests filed
   * before this fence existed, under any switch.
   */
  private refuseDemoFunds(withdrawal: { balanceHeld: boolean | null }) {
    if (withdrawal.balanceHeld === false) throw new DemoFundsNotWithdrawableError();
  }

  private async requireRealAsset(db: PrismaClient | Prisma.TransactionClient, asset: string) {
    if (isTestAssetPairOrSymbol(asset) || await isMintedListingAsset(db, asset))
      throw new WithdrawalRequestError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
  }

  async requestWithdrawal(params: {
    userId: string;
    asset: string;
    network: string;
    toAddress: string;
    amount: string;
  }): Promise<WithdrawalResult> {
    // A minted listing token stays refused while the in-memory listing registry is cold or stale.
    await this.requireRealAsset(this.prisma, params.asset);
    const amount = new BigNumber(params.amount);
    if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
      throw new WithdrawalRequestError('Amount must be greater than zero');
    }

    const floor = await prepareFloor(this.prisma, params.userId, this.prices);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (floor) await lockFloor(tx, params.userId);
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
      // Judged with this request counted as leaving: the account keeps at least its synthetic proceeds.
      if (floor) await assertFloor(tx, params.userId, floor);

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
  async requestUnheldWithdrawal(_params: {
    userId: string;
    asset: string;
    network: string;
    toAddress: string;
    amount: string;
    available: string;
  }): Promise<never> {
    throw new DemoFundsNotWithdrawableError();
  }

  /** Admin has reviewed the request and intends to send the funds — the
   * hold stays locked (nothing has actually moved on-chain yet). */
  async approveWithdrawal(params: { withdrawalId: string; performedByAdminId: string }): Promise<WithdrawalResult> {
    const floor = await this.floorOf(params.withdrawalId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['PENDING']);
      this.refuseDemoFunds(withdrawal);
      await this.requireRealAsset(tx, withdrawal.asset);
      // Also a request filed before this fence: the account must still cover its synthetic proceeds.
      if (floor) { await lockFloor(tx, withdrawal.userId); await assertFloor(tx, withdrawal.userId, floor); }

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
    const floor = await this.floorOf(params.withdrawalId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const withdrawal = await this.requireStatus(tx, params.withdrawalId, ['APPROVED']);
      this.refuseDemoFunds(withdrawal);
      await this.requireRealAsset(tx, withdrawal.asset);
      if (floor) { await lockFloor(tx, withdrawal.userId); await assertFloor(tx, withdrawal.userId, floor); }

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
