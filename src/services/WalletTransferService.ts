import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { mutateFuturesBalance, mutateSpotBalance } from './WalletMutation';
import { isSimulationSettled } from './testMarkets/testAssetConfig';
import { assertFloor, FloorPriceSource, lockFloor, prepareFloor } from './syntheticProceedsFloor';

/** One transaction: conditional debit plus atomic credit, no stale absolute totals. */
export async function transferWalletBalance(prisma: PrismaClient, userId: string, asset: string,
  amount: BigNumber, direction: 'TO_FUTURES' | 'TO_SPOT', prices?: FloorPriceSource) {
  if (!amount.isFinite() || !amount.isGreaterThan(0)) throw new Error('Invalid transfer amount');
  // SIMUSDT-settled value (History20 private test) never leaves the Spot ledger. Every other asset is unchanged.
  if (isSimulationSettled(asset)) throw new Error('This asset cannot be transferred');
  // Futures collateral is not part of the protected Spot value. Never move the
  // legacy synthetic principal there to fund PnL on the ordinary ledger.
  const floor = direction === 'TO_FUTURES' ? await prepareFloor(prisma, userId, prices) : null;
  await prisma.$transaction(async tx => {
    if (floor) await lockFloor(tx, userId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-transfer:${userId}`}, 0))::text`;
    if (direction === 'TO_FUTURES') {
      await mutateSpotBalance(tx, userId, asset, { available: amount.negated() });
      if (floor) await assertFloor(tx, userId, floor);
      await mutateFuturesBalance(tx, userId, asset, { available: amount });
    } else {
      await mutateFuturesBalance(tx, userId, asset, { available: amount.negated() }, true);
      await mutateSpotBalance(tx, userId, asset, { available: amount });
    }
  });
}
