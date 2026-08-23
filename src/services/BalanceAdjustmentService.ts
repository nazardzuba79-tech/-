import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';

export class BalanceAdjustmentError extends Error {}

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
    const delta = new BigNumber(params.amount);
    if (!delta.isFinite() || delta.isZero()) {
      throw new BalanceAdjustmentError('Amount must be a non-zero number');
    }
    if (!params.reason.trim()) {
      throw new BalanceAdjustmentError('A reason is required');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.balance.findUnique({
        where: { userId_asset: { userId: params.userId, asset: params.asset } },
      });
      const currentAvailable = new BigNumber(existing?.available.toString() ?? '0');
      const newAvailable = currentAvailable.plus(delta);
      if (newAvailable.isNegative()) {
        throw new BalanceAdjustmentError('Adjustment would make the available balance negative');
      }

      const updated = await tx.balance.upsert({
        where: { userId_asset: { userId: params.userId, asset: params.asset } },
        create: { userId: params.userId, asset: params.asset, available: newAvailable.toString() },
        update: { available: newAvailable.toString() },
      });

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
