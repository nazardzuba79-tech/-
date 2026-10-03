import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';

export class BalanceAdjustmentError extends Error {}
export class BalanceAdjustmentConflict extends BalanceAdjustmentError {}

export interface BalanceAdjustmentIntent {
  userId: string;
  asset: string;
  amount: string;
  reason: string;
  performedByAdminId: string;
  idempotencyKey: string;
}
export interface BalanceAdjustmentReceipt extends BalanceAdjustmentResult {
  status: 'APPLIED';
  operationId: string;
  userId: string;
  account: 'SPOT';
  amount: string;
  reason: string;
  availableBefore: string;
  createdAt: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalIntent(input: BalanceAdjustmentIntent): BalanceAdjustmentIntent {
  const asset = input.asset.trim().toUpperCase(), reason = input.reason.trim(), delta = new BigNumber(input.amount);
  if (!UUID.test(input.idempotencyKey)) throw new BalanceAdjustmentError('Invalid operation key');
  if (!input.userId || !input.performedByAdminId || !/^[A-Z0-9]{1,10}$/.test(asset)) throw new BalanceAdjustmentError('Invalid correction target');
  if (isTestAssetPairOrSymbol(asset)) throw new BalanceAdjustmentError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
  if (!delta.isFinite() || delta.isZero() || delta.decimalPlaces()! > 18 || delta.abs().gte('1e18')) throw new BalanceAdjustmentError('Amount must be a non-zero number with at most 18 decimal places');
  if (!reason || reason.length > 500) throw new BalanceAdjustmentError('A reason of 1 to 500 characters is required');
  return { ...input, asset, reason, amount: delta.toFixed(), idempotencyKey: input.idempotencyKey.toLowerCase() };
}

function receiptOf(row: { id: string; userId: string | null; action: string; metadata: Prisma.JsonValue; createdAt: Date }): BalanceAdjustmentReceipt | null {
  const meta = row.metadata as Record<string, unknown> | null;
  if (row.action !== 'BALANCE_ADJUSTED' || !row.userId || !meta || meta.receiptVersion !== 1 || meta.idempotencyKey !== row.id || meta.account !== 'SPOT') return null;
  if (['asset', 'delta', 'reason', 'beforeAvailable', 'newAvailable', 'locked', 'performedByAdminId'].some(key => typeof meta[key] !== 'string')) return null;
  return { status: 'APPLIED', operationId: row.id, userId: row.userId, account: 'SPOT', asset: meta.asset as string, amount: meta.delta as string, reason: meta.reason as string,
    availableBefore: meta.beforeAvailable as string, available: meta.newAvailable as string, locked: meta.locked as string, createdAt: row.createdAt.toISOString() };
}

export interface BalanceAdjustmentResult {
  asset: string;
  available: string;
  locked: string;
}

/**
 * Manual correction to a user's available balance — the deliberately narrow
 * escape hatch for fixing something by hand (a missed credit, a
 * reconciliation error, ...) rather than a general-purpose balance editor.
 * Every call requires a reason and is written to AuditLog with the exact
 * signed delta and the admin who made it, so it's always traceable after
 * the fact — see the admin panel's audit log viewer.
 */
export class BalanceAdjustmentService {
  constructor(private prisma: PrismaClient) {}

  /** Additive admin path. The unique AuditLog ID is the durable operation receipt;
   * the advisory lock serializes attempts before any wallet mutation. Both the
   * delta and receipt commit together, with no automatic transaction retry. */
  async adjustOnce(input: BalanceAdjustmentIntent): Promise<BalanceAdjustmentReceipt> {
    const intent = canonicalIntent(input);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Namespaced, parameterized, transaction-scoped; no persistent DB object.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voltex:admin-balance-adjustment:${intent.idempotencyKey}`}, 0))`;
      const previous = await tx.auditLog.findUnique({ where: { id: intent.idempotencyKey } });
      if (previous) {
        const receipt = receiptOf(previous);
        const actor = (previous.metadata as Record<string, unknown> | null)?.performedByAdminId;
        if (!receipt || actor !== intent.performedByAdminId || receipt.userId !== intent.userId || receipt.asset !== intent.asset || receipt.amount !== intent.amount || receipt.reason !== intent.reason) {
          throw new BalanceAdjustmentConflict('Operation key already belongs to another correction');
        }
        return receipt;
      }
      const delta = new BigNumber(intent.amount);
      try { await mutateSpotBalance(tx, intent.userId, intent.asset, { available: delta }); }
      catch (error) {
        if (error instanceof InsufficientWalletBalance) throw new BalanceAdjustmentError('Adjustment would make the available balance negative');
        throw error;
      }
      const updated = await tx.balance.findUniqueOrThrow({ where: { userId_asset: { userId: intent.userId, asset: intent.asset } } });
      // mutateSpotBalance holds the row lock until commit. The new path rejects
      // sub-column precision, so subtracting the exact signed delta gives the
      // authoritative prior available amount without an unsafe pre-lock read.
      const available = new BigNumber(updated.available.toString());
      const row = await tx.auditLog.create({ data: { id: intent.idempotencyKey, userId: intent.userId, action: 'BALANCE_ADJUSTED', metadata: {
        receiptVersion: 1, idempotencyKey: intent.idempotencyKey, account: 'SPOT', asset: intent.asset,
        delta: intent.amount, beforeAvailable: available.minus(delta).toFixed(), newAvailable: available.toFixed(), locked: updated.locked.toString(),
        reason: intent.reason, performedByAdminId: intent.performedByAdminId,
      } } });
      return receiptOf(row)!;
    });
  }

  /** Read only: a missing receipt is unknown/not committed, never an instruction
   * to replace the original key. A different operator cannot inspect it. */
  async findReceipt(userId: string, operationId: string, performedByAdminId: string): Promise<BalanceAdjustmentReceipt | null> {
    if (!UUID.test(operationId)) throw new BalanceAdjustmentError('Invalid operation key');
    const row = await this.prisma.auditLog.findUnique({ where: { id: operationId.toLowerCase() } });
    if (!row || row.userId !== userId || (row.metadata as Record<string, unknown> | null)?.performedByAdminId !== performedByAdminId) return null;
    return receiptOf(row);
  }

  /** `amount` is a signed delta applied to `available` — e.g. "10" credits,
   * "-5" debits. `locked` is never touched here; that's exclusively managed
   * by the order/withdrawal flows that actually hold funds. */
  async adjust(params: {
    userId: string;
    asset: string;
    amount: string;
    reason: string;
    performedByAdminId: string;
  }): Promise<BalanceAdjustmentResult> {
    // A test asset never has a balance, not even one an admin writes in.
    if (isTestAssetPairOrSymbol(params.asset)) throw new BalanceAdjustmentError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const delta = new BigNumber(params.amount);
    if (!delta.isFinite() || delta.isZero()) {
      throw new BalanceAdjustmentError('Amount must be a non-zero number');
    }
    if (!params.reason.trim()) {
      throw new BalanceAdjustmentError('A reason is required');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      try {
        await mutateSpotBalance(tx, params.userId, params.asset, { available: delta });
      } catch (error) {
        if (error instanceof InsufficientWalletBalance) throw new BalanceAdjustmentError('Adjustment would make the available balance negative');
        throw error;
      }
      const updated = await tx.balance.findUniqueOrThrow({ where: { userId_asset: { userId: params.userId, asset: params.asset } } });
      const newAvailable = new BigNumber(updated.available.toString());

      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: 'BALANCE_ADJUSTED',
          metadata: {
            asset: params.asset,
            delta: delta.toString(),
            newAvailable: newAvailable.toString(),
            reason: params.reason,
            performedByAdminId: params.performedByAdminId,
          },
        },
      });

      return { asset: updated.asset, available: updated.available.toString(), locked: updated.locked.toString() };
    });
  }
}
