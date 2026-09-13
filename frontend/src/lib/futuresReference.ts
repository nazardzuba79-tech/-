import type { LiveQuote, LiveState } from './liveMarketTypes';

/** Exact contract identity only: a spot or 1x token is never a 1000x perpetual. */
export function futuresReferenceRows(state: LiveState): Map<string, LiveQuote> {
  const result = new Map<string, LiveQuote>();
  if (state.status !== 'live') return result;
  for (const row of state.rows.values()) {
    if (row.marketType !== 'linear_perpetual' || row.quoteAsset !== 'USDT' || row.settleAsset !== 'USDT' ||
        row.stale || row.id !== `linear_perpetual:${row.providerSymbol}` ||
        row.providerSymbol !== `${row.baseAsset}${row.quoteAsset}` ||
        row.pair !== `${row.baseAsset}/${row.quoteAsset}` ||
        row.lastPrice === null || !Number.isFinite(row.lastPrice) || row.lastPrice <= 0) continue;
    result.set(row.pair, row);
  }
  return result;
}

export function referenceNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
