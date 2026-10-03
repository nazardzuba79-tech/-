import type { CanonicalAsset } from './api';

/**
 * Seven-day returns for the market lists — the SAME verified source the
 * Futures pair list reads (FuturesPairList's `useChange7d`): the catalogue's
 * `market.changePercent7d`, one ref-counted bulk request per tab, refreshed
 * slowly because the backend caches it for 20 minutes. Not the old
 * 500-coin rankings download with its sparklines.
 *
 * Only a UNIQUE catalogue identity contributes a value. A ticker the
 * catalogue marks ambiguous, or that collides with another asset's id,
 * stays absent — rendered as «—» and sorted last — rather than borrowing a
 * different coin's week (the base-ticker collision PR #175 removed).
 *
 * Reference data only: nothing here can add, remove or rename a market.
 * Pure: the subscription lives in lib/useChange7d.
 */
export function change7dBySymbol(assets: readonly CanonicalAsset[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const asset of assets) {
    if (asset.ambiguous || asset.collidingIds.length > 0) continue;
    const change = asset.market?.changePercent7d;
    if (typeof change === 'number' && Number.isFinite(change)) values.set(asset.symbol.toUpperCase(), change);
  }
  return values;
}

/**
 * The catalogue's week is the asset's return in USD. It is the pair's own
 * return only when the pair is quoted in USD or a dollar stablecoin; a
 * BTC/EUR or ETH/BTC row would otherwise show a figure that is not its own
 * price's change, so those read «—».
 */
const USD_QUOTES = new Set(['USD', 'USDT', 'USDC']);

export function pairChange7d(pair: string, values: ReadonlyMap<string, number>): number | null {
  const [base, quote] = pair.split('/');
  if (!base || !quote || !USD_QUOTES.has(quote.toUpperCase())) return null;
  return values.get(base.toUpperCase()) ?? null;
}
