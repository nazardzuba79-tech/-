import BigNumber from 'bignumber.js';
import { createHash } from 'crypto';
import { DEPOSIT_PRICE_MAX_AGE_MS, DEPOSIT_USD_PEGGED_ASSETS, MIN_DEPOSIT_USD } from '../../config/limits';

/**
 * Deposit state is several independent facts, never one flag:
 *   network   — verifiedAt / confirmations / finalized / verifyError (the chain)
 *   owner     — userId (an admin's attribution; a client claim is only a hint)
 *   minimum   — a property of a user's PACKAGE (sum of eligible transfers)
 *   decision  — status CREDITED + batchId (an admin's confirmation, only)
 * The admin-facing state below is derived from them, not stored.
 */
export type DepositRowState =
  | 'CREDITED'                // Зачислен
  | 'NEEDS_REVIEW'            // Требует уточнения
  | 'UNATTRIBUTED'            // Не привязан
  | 'AWAITING_CONFIRMATIONS'  // Ожидает подтверждений сети
  | 'AWAITING_TOPUP'          // Ожидает доплаты
  | 'READY'                   // Готов к проверке
  | 'IGNORED';                // Игнорированные (not a client deposit; kept, restorable)

export interface DepositFacts {
  id: string;
  userId: string | null;
  chain: string;
  asset: string;
  amount: { toString(): string };
  confirmations: number;
  status: string;
  verifiedAt: Date | null;
  finalized: boolean;
  verifyError: string | null;
  batchId: string | null;
  revision: number;
  /** Set when an admin ignored the transfer; absent on legacy callers = not ignored. */
  ignoredAt?: Date | null;
}

/** Network confirmation only: proven, not flagged, deep enough, and (where the
 * chain reports it) in an irreversible block. */
export function isNetworkConfirmed(row: DepositFacts, minConfirmations: number): boolean {
  return row.verifiedAt !== null && row.verifyError === null && row.finalized && row.confirmations >= minConfirmations;
}

/** May this transfer be part of its owner's package? Never decides a credit. */
export function isPackageEligible(row: DepositFacts, minConfirmations: number): boolean {
  return row.status !== 'CREDITED' && row.batchId === null && row.userId !== null && !row.ignoredAt && isNetworkConfirmed(row, minConfirmations);
}

/** Row state before the package minimum is applied. */
export function baseRowState(row: DepositFacts, minConfirmations: number): DepositRowState | 'PACKAGE' {
  if (row.status === 'CREDITED') return 'CREDITED';
  if (row.ignoredAt) return 'IGNORED';
  if (row.verifyError) return 'NEEDS_REVIEW';
  if (!row.userId) return 'UNATTRIBUTED';
  if (!isNetworkConfirmed(row, minConfirmations)) return 'AWAITING_CONFIRMATIONS';
  return 'PACKAGE';
}

export type UsdPolicy = 'USD_PEGGED_POLICY' | 'MARKET_PRICE';
export interface UsdValuation {
  usd: BigNumber | null;
  policy: UsdPolicy | null;
  priceUsd: BigNumber | null;
  pricedAt: Date | null;
  /** Why usd is null: the package needs review, it never passes by default. */
  reason: 'PRICE_UNAVAILABLE' | 'PRICE_STALE' | null;
}

export interface PriceSourceWithMeta {
  getTicker(pair: string): Promise<{ lastPrice: string } | null>;
  getTickerWithMeta?(pair: string): Promise<{ value: { lastPrice: string } | null; fetchedAt: number; stale: boolean }>;
}

export function isUsdPegged(asset: string): boolean {
  return (DEPOSIT_USD_PEGGED_ASSETS as readonly string[]).includes(asset.toUpperCase());
}

/** USD value for the MINIMUM CHECK only. Pegged assets use the explicit 1:1
 * evaluation policy. Anything else needs a price with a known, recent fetch
 * time; unknown or old → null (review), never an assumed pass. */
export async function valueInUsd(asset: string, amount: BigNumber, prices: PriceSourceWithMeta, now = Date.now()): Promise<UsdValuation> {
  if (isUsdPegged(asset)) return { usd: amount, policy: 'USD_PEGGED_POLICY', priceUsd: new BigNumber(1), pricedAt: null, reason: null };
  if (typeof prices.getTickerWithMeta !== 'function') return { usd: null, policy: null, priceUsd: null, pricedAt: null, reason: 'PRICE_UNAVAILABLE' };
  let meta;
  try { meta = await prices.getTickerWithMeta(`${asset.toUpperCase()}/USDT`); }
  catch { return { usd: null, policy: null, priceUsd: null, pricedAt: null, reason: 'PRICE_UNAVAILABLE' }; }
  const price = new BigNumber(meta?.value?.lastPrice ?? 'NaN');
  if (!price.isFinite() || !price.isGreaterThan(0)) return { usd: null, policy: null, priceUsd: null, pricedAt: null, reason: 'PRICE_UNAVAILABLE' };
  const pricedAt = new Date(meta.fetchedAt);
  if (meta.stale || !Number.isFinite(meta.fetchedAt) || now - meta.fetchedAt > DEPOSIT_PRICE_MAX_AGE_MS || meta.fetchedAt > now + 60_000) {
    return { usd: null, policy: null, priceUsd: price, pricedAt, reason: 'PRICE_STALE' };
  }
  return { usd: amount.times(price), policy: 'MARKET_PRICE', priceUsd: price, pricedAt, reason: null };
}

/** Exact, unrounded comparison: 299.999999 is below 300. */
export function meetsMinimum(usd: BigNumber | null): boolean {
  return usd !== null && usd.isFinite() && usd.isGreaterThanOrEqualTo(MIN_DEPOSIT_USD);
}

export function sumAmounts(rows: { amount: { toString(): string } }[]): BigNumber {
  return rows.reduce((sum, r) => sum.plus(r.amount.toString()), new BigNumber(0));
}

/** Fingerprint of exactly what an admin reviewed. Any change in composition,
 * owner, amount or proof revision changes it. */
export function packageToken(userId: string, chain: string, asset: string, rows: { id: string; revision: number; amount: { toString(): string } }[]): string {
  const parts = rows.map((r) => `${r.id}:${r.revision}:${new BigNumber(r.amount.toString()).toFixed()}`).sort();
  return createHash('sha256').update(JSON.stringify([userId, chain, asset.toUpperCase(), parts])).digest('hex');
}

export function packageKey(userId: string, chain: string, asset: string): string {
  return `${userId}|${chain}|${asset.toUpperCase()}`;
}
