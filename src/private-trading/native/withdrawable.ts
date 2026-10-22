import BigNumber from 'bignumber.js';
import type { PrismaClient } from '@prisma/client';
import type { PrivateTradingService } from '../service';
import type { OwnerSession } from '../serviceTypes';
import { NativeDemoService } from './service';
import { PrismaNativeRepository } from './store';

/**
 * What a Cross trading account can withdraw, per asset, from one valuation:
 * the `available` of the same wallet rows the Wallet page prints (the row's
 * own margin in use already taken out). The settle asset is further capped
 * by the account's `available` — its free margin — so a request can never
 * claim margin that backs an open position. `null` when the account has not
 * been opened.
 *
 * `undefined` without market data: no valuation is possible, and those
 * accounts then withdraw from the spot ledger like everyone else.
 */
export function nativeWithdrawableRows(prisma: PrismaClient, service: PrivateTradingService) {
  if (!service.market) return undefined;
  const native = new NativeDemoService(new PrismaNativeRepository(prisma, service.store?.config), service.market);
  return async (actor: OwnerSession) => {
    const wallet = await native.wallet(actor);
    return wallet ? withdrawableRows(wallet) : null;
  };
}

/** The projection itself, apart from the valuation that feeds it. */
export function withdrawableRows(wallet: {
  account: { available: string };
  collateral: { settleAsset: string };
  rows: { asset: string; available: string }[];
}): { asset: string; available: string }[] {
  const settle = wallet.collateral.settleAsset;
  return wallet.rows.map((row) => ({
    asset: row.asset,
    available: row.asset === settle
      ? BigNumber.max(BigNumber.min(row.available, wallet.account.available), 0).toFixed()
      : row.available,
  }));
}
