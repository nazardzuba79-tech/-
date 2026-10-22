import { Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';

type Tx = Prisma.TransactionClient;
type Delta = { available?: BigNumber; locked?: BigNumber };
export class InsufficientWalletBalance extends Error {}

/** Change the CURRENT row, never totals calculated from an earlier SELECT.
 * Negative deltas are conditional debits. The caller must also claim the
 * owning order/withdrawal/reservation state exactly once in this transaction.
 * No retry, external request, extra read or independent transaction here.
 */
export async function mutateSpotBalance(tx: Tx, userId: string, asset: string, delta: Delta) {
  const available = delta.available ?? new BigNumber(0);
  const locked = delta.locked ?? new BigNumber(0);
  if (!available.isFinite() || !locked.isFinite()) throw new Error('Invalid wallet delta');
  if (available.isZero() && locked.isZero()) return;
  const data = { available: { increment: available.toFixed() }, locked: { increment: locked.toFixed() } };
  if (available.isNegative() || locked.isNegative()) {
    const changed = await tx.balance.updateMany({
      where: { userId, asset,
        ...(available.isNegative() ? { available: { gte: available.negated().toFixed() } } : {}),
        ...(locked.isNegative() ? { locked: { gte: locked.negated().toFixed() } } : {}),
      }, data,
    });
    if (changed.count !== 1) throw new InsufficientWalletBalance(`Insufficient ${asset} balance or reserved funds`);
  } else {
    await tx.balance.upsert({ where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: available.toFixed(), locked: locked.toFixed() }, update: data });
  }
}

/** Futures settlement/funding can legitimately debit available below zero.
 * Admissions/transfers pass spend=true and must have sufficient available.
 * A hold can never be released from somebody else's missing/negative total.
 * Existing P&L, funding and margin quantities are supplied unchanged by callers.
 */
export async function mutateFuturesBalance(tx: Tx, userId: string, asset: string, delta: Delta, spend = false) {
  const available = delta.available ?? new BigNumber(0);
  const locked = delta.locked ?? new BigNumber(0);
  if (!available.isFinite() || !locked.isFinite()) throw new Error('Invalid wallet delta');
  if (available.isZero() && locked.isZero()) return;
  const data = { available: { increment: available.toFixed() }, locked: { increment: locked.toFixed() } };
  if ((spend && available.isNegative()) || locked.isNegative()) {
    const changed = await tx.futuresBalance.updateMany({ where: { userId, asset,
      ...(spend && available.isNegative() ? { available: { gte: available.negated().toFixed() } } : {}),
      ...(locked.isNegative() ? { locked: { gte: locked.negated().toFixed() } } : {}),
    }, data });
    if (changed.count !== 1) throw new InsufficientWalletBalance(`Insufficient ${asset} margin balance or reserved funds`);
  } else {
    await tx.futuresBalance.upsert({ where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: available.toFixed(), locked: locked.toFixed() }, update: data });
  }
}
