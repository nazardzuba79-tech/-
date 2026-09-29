import { TestMarketSimulation, aggregateCandles, getCurrentTestMarketState, SIM_INTERVALS, SIM_INTERVAL_OFFSETS } from '../testMarkets/testMarketSimulation';
import { testMarketDepth } from '../testMarkets/testMarketDepth';
import type { ManagedListing } from './schema';

// Reuse the existing simulation algorithm, with an immutable config. Never
// share the legacy pair-only cache with editable administrative previews.
const cache = new Map<string,TestMarketSimulation>();
function simulation(row: ManagedListing) {
  const key = JSON.stringify([row.id,row.revision,row.seed,row.initialPrice,row.listingAt]);
  const prior = cache.get(key); if (prior) return prior;
  const value = new TestMarketSimulation({ symbol: row.ticker, name: row.name, quote: 'USDT', pair: row.pair,
    isTestAsset: true, isTradable: false, listingArmed: true, listingAt: Date.parse(row.listingAt),
    initialPrice: Number(row.initialPrice), seed: row.seed });
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key,value); return value;
}
export function listingMetadata(row: ManagedListing, now: number) {
  return { pair: row.pair, symbol: row.ticker, name: row.name, quote: 'USDT', logo: row.logo,
    isTestAsset: true, isManagedListing: true, isTradable: false, status: 'SIMULATION', listingArmed: true,
    listingAt: row.listingAt, initialPrice: Number(row.initialPrice), revision: row.revision, version: row.version,
    state: getCurrentTestMarketState(simulation(row), now) };
}
export function listingMarket(row: ManagedListing, kind: string, url: URL, now: number): unknown {
  const sim = simulation(row);
  if (kind === 'asset') return listingMetadata(row, now);
  if (kind === 'book') return testMarketDepth(sim, now);
  if (kind === 'trades') return { pair: row.pair, serverTime: now, source: 'simulation',
    trades: sim.recentTrades(now).map(t => ({ ...t, time: t.timestamp })) };
  if (kind === 'ticker') {
    const { state } = listingMetadata(row, now);
    const text = (n: number | null) => n === null ? '' : String(n);
    return { source: 'simulation', serverTime: now, ticker: { pair: row.pair, lastPrice: text(state.lastPrice),
      bidPrice: text(state.lastPrice), askPrice: text(state.lastPrice), high24h: text(state.high24h), low24h: text(state.low24h),
      volume24h: text(state.volume24h), quoteVolume24h: text(state.quoteVolume24h), changePercent24h: text(state.change24hPercent) } };
  }
  const interval = url.searchParams.get('interval') || '5m';
  const size = SIM_INTERVALS[interval];
  if (!size) throw new Error('unsupported_interval');
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(url.searchParams.get('limit'))) || 300));
  const offset = SIM_INTERVAL_OFFSETS[interval] || 0;
  const bucket = Math.floor((now - offset) / size) * size + offset;
  const from = Math.max(sim.asset.listingAt, bucket - (limit - 1) * size);
  // Bound demand-driven work even for long interval requests. Historical 5m
  // bars are immutable; caller can request a smaller window if over budget.
  if (now - from > 366 * 86400_000) throw new Error('window_too_large');
  return { pair: row.pair, interval, source: 'simulation', serverTime: now,
    candles: aggregateCandles(sim.candles5m(now, from), size, offset).slice(-limit).map(c => ({
      time: Math.floor(c.openTime / 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    })) };
}
