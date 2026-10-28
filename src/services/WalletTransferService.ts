import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { mutateFuturesBalance, mutateSpotBalance } from './WalletMutation';
import { isSimulationSettled } from './testMarkets/testAssetConfig';

/** One transaction: conditional debit plus atomic credit, no stale absolute totals. */
export async function transferWalletBalance(prisma: PrismaClient, userId: string, asset: string,
  amount: BigNumber, direction: 'TO_FUTURES' | 'TO_SPOT') {
  if (!amount.isFinite() || !amount.isGreaterThan(0)) throw new Error('Invalid transfer amount');
  // SIMUSDT-settled value (History20 private test) never leaves the Spot ledger. Every other asset is unchanged.
  if (isSimulationSettled(asset)) throw new Error('This asset cannot be transferred');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-transfer:${userId}`}, 0))::text`;
    if (direction === 'TO_FUTURES') {
      await mutateSpotBalance(tx, userId, asset, { available: amount.negated() });
      await mutateFuturesBalance(tx, userId, asset, { available: amount });
    } else {
      await mutateFuturesBalance(tx, userId, asset, { available: amount.negated() }, true);
      await mutateSpotBalance(tx, userId, asset, { available: amount });
    }
  });
}
