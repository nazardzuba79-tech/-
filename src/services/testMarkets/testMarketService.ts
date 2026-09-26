/**
 * What the API serves for a test asset, in the shapes the rest of VOLTEX
 * already speaks: candles as `{ time (s), open, high, low, close, volume }`
 * and a public asset record carrying the market state and the
 * not-tradable flags. All numbers are read off the one simulation, so the
 * chart, the ticker and the 24h statistics can never disagree.
 */
import type { TestAssetConfig } from './testAssetConfig';
import {
  SIM_INTERVALS, SIM_INTERVAL_OFFSETS, aggregateCandles, getCurrentTestMarketState, simulationFor,
  type TestMarketState,
} from './testMarketSimulation';

export const TEST_ASSET_STATUS_LABEL = 'TEST · NOT TRADABLE';

export interface PublicTestAsset {
  pair: string;
  symbol: string;
  name: string;
  quote: string;
  isTestAsset: true;
  isTradable: false;
  status: string;
  listingAt: string;
  initialPrice: number;
  state: TestMarketState;
}

export function publicTestAsset(asset: TestAssetConfig, now: number): PublicTestAsset {
  return {
    pair: asset.pair,
    symbol: asset.symbol,
    name: asset.name,
    quote: asset.quote,
    isTestAsset: true,
    isTradable: false,
    status: TEST_ASSET_STATUS_LABEL,
    listingAt: new Date(asset.listingAt).toISOString(),
    initialPrice: asset.initialPrice,
    state: getCurrentTestMarketState(simulationFor(asset), now),
  };
}

export interface ChartCandle { time: number; open: number; high: number; low: number; close: number; volume: number }

export class UnsupportedTestIntervalError extends Error {}

/**
 * The last `limit` candles of `interval` at `now`, oldest first. Before the
 * listing there are none; nothing after `now` is ever included.
 */
export function testMarketCandles(asset: TestAssetConfig, interval: string, now: number, limit = 300): ChartCandle[] {
  const size = SIM_INTERVALS[interval];
  if (!size) throw new UnsupportedTestIntervalError(`Unsupported interval: ${interval}`);
  const offset = SIM_INTERVAL_OFFSETS[interval] ?? 0;
  const count = Math.max(1, Math.min(Math.floor(limit) || 300, 1000));
  const currentBucket = Math.floor((now - offset) / size) * size + offset;
  const from = Math.max(asset.listingAt, currentBucket - (count - 1) * size);
  const fiveMinute = simulationFor(asset).candles5m(now, from);
  return aggregateCandles(fiveMinute, size, offset)
    .filter((candle) => candle.openTime >= currentBucket - (count - 1) * size)
    .slice(-count)
    .map((candle) => ({
      time: Math.floor(candle.openTime / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
}

/**
 * The simulation clock. Always the real time in production. A preview
 * time is honoured only when BOTH the environment is not production AND
 * TEST_MARKET_SIMULATION_PREVIEW=1 is set explicitly — so a forgotten flag
 * on a staging box, or a query string on the live site, changes nothing.
 */
export function resolveSimulationNow(
  requested: unknown,
  clock: () => number = Date.now,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const real = clock();
  if (env.NODE_ENV === 'production' || env.TEST_MARKET_SIMULATION_PREVIEW !== '1') return real;
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > 40) return real;
  const parsed = /^\d{10,16}$/.test(requested) ? Number(requested) : Date.parse(requested);
  return Number.isFinite(parsed) ? parsed : real;
}
