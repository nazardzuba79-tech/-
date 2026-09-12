import type { CanonicalAsset } from './api';
import type { LiveQuote } from './liveMarketTypes';

export interface ReferenceAsset extends CanonicalAsset {
  referenceActive?: boolean;
  referenceMarkets?: string[];
  liveQuote?: LiveQuote;
}
/** Join by a unique canonical identity only. Never use the registry's
 * best-effort symbol resolver for a reference asset. No metadata fetch. */
export function joinReferenceAssets(catalogue: CanonicalAsset[], quotes: ReadonlyMap<string, LiveQuote>): ReferenceAsset[] {
  if (!quotes.size) return catalogue;
  const matches = new Map<string, CanonicalAsset[]>();
  for (const asset of catalogue) matches.set(asset.symbol, [...(matches.get(asset.symbol) ?? []), asset]);
  const grouped = new Map<string, LiveQuote[]>();
  for (const quote of quotes.values()) grouped.set(quote.baseAsset, [...(grouped.get(quote.baseAsset) ?? []), quote]);
  const out = new Map<string, ReferenceAsset>(catalogue.map(asset => [asset.id,asset]));
  for (const [symbol, markets] of grouped) {
    const candidates = matches.get(symbol) ?? [];
    const candidate = candidates.length === 1 && candidates[0].providers.coingecko && !candidates[0].ambiguous && !candidates[0].collidingIds.length ? candidates[0] : null;
    const asset: ReferenceAsset = candidate ?? { id: `bybit:${symbol}`, symbol, name: symbol,
      logoUrl: null, providers: {}, tradingPairs: [], tradable: false, metadataSource: 'bybit',
      rank: null, ambiguous: candidates.length > 0, collidingIds: candidates.map(a => a.id), market: null };
    // USDT is labelled USDT, never silently equated with USD. Prefer spot;
    // do not turn dated contracts or differently denominated prices into USD.
    const liveQuote = markets.filter(q => q.quoteAsset === 'USDT' && ['spot','linear_perpetual'].includes(q.marketType) && !q.stale)
      .sort((a,b) => Number(a.marketType !== 'spot') - Number(b.marketType !== 'spot') || a.id.localeCompare(b.id))[0];
    out.set(asset.id, { ...asset, referenceActive: true, referenceMarkets: markets.map(m => m.id), liveQuote });
  }
  return [...out.values()];
}
export function referenceValues(asset: ReferenceAsset) {
  const q = asset.liveQuote;
  return {
    price: q?.lastPrice ?? asset.market?.priceUsd ?? null,
    change: q?.changePercent24h ?? asset.market?.changePercent24h ?? null,
    volume: q?.quoteVolume24h ?? asset.market?.volume24hUsd ?? null,
    priceQuote: q?.lastPrice != null ? q.quoteAsset : 'USD',
    volumeQuote: q?.quoteVolume24h != null ? q.quoteAsset : 'USD',
  };
}
