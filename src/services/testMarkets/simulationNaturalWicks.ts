/**
 * Natural candle shadows, version 1. This layer changes only the extrema of
 * existing canonical ticks: their prices, volumes and timestamps stay put.
 * Every interval therefore observes the same intratick ranges, and executable
 * marks / the trade tape keep their original values.
 */
import { seededRandom } from './simulationRandom';

export const NATURAL_WICK_WINDOW_MS = 15 * 60_000;

export interface NaturalWickConfig {
  /** Explicitly authorized retrospective window; only buckets ending by this instant. */
  historicalUntil?: number;
  /** First complete UTC 15m bucket allowed to use the model going forward. */
  futureFrom: number;
}

export interface NaturalWickTick {
  price: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}

export interface NaturalWickCandle {
  index: number;
  open: number;
  close: number;
  /** Bounds apply to added ranges; existing wider ranges are never reduced. */
  maxWick: number;
  ticks: NaturalWickTick[];
}

/** Whole buckets only: fixed cutoffs never drift with the request's clock. */
export function naturalWickWindowAllowed(config: NaturalWickConfig, openTime: number): boolean {
  return (Number.isFinite(config.historicalUntil) && openTime + NATURAL_WICK_WINDOW_MS <= config.historicalUntil!)
    || (Number.isFinite(config.futureFrom) && openTime >= config.futureFrom);
}

/** Four randomly positioned windows per eight, without a regular alternating pattern. */
export function naturalWickWindowSelected(seed: string, offset: number, index: number): boolean {
  const block = Math.floor(index / 8);
  const random = seededRandom(seed, 'natural-wicks-v1', offset, 'selection', block);
  const order = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, 4).includes(index - block * 8);
}

/** A little room beyond the original profile, with a finite common upper bound. */
export function naturalWickLimit(profileMaxWick: number | undefined): number {
  return Math.min(0.16, (profileMaxWick ?? 0.1) * 1.25);
}

/**
 * Add one-sided or asymmetric two-sided rejection to a selected 15m window.
 * The scale follows its existing body/range. Already wick-heavy windows get
 * smaller additions; no fixed percentage is applied to every candle.
 * Each extension belongs to an existing extreme tick, not to a future close.
 */
export function naturalWickCandles(seed: string, offset: number, index: number, candles: NaturalWickCandle[]): NaturalWickCandle[] {
  if (!candles.length) return candles;
  const open = candles[0].open, close = candles[candles.length - 1].close;
  let high = Math.max(open, close), low = Math.min(open, close);
  for (const candle of candles) for (const tick of candle.ticks) {
    high = Math.max(high, tick.high);
    low = Math.min(low, tick.low);
  }
  const range = high - low;
  if (!(range > 0) || !(low > 0)) return candles;
  const body = Math.abs(close - open);
  const localBody = candles.reduce((sum, candle) => sum + Math.abs(candle.close - candle.open), 0) / candles.length;
  const bodyShare = Math.min(1, body / range);
  const scale = Math.max(body * 0.45, Math.min(range * 0.4, Math.max(localBody, range * 0.18)))
    * (0.55 + 0.45 * bodyShare);
  const random = seededRandom(seed, 'natural-wicks-v1', offset, 'shape', index);
  const strength = (0.3 + 1.2 * random() ** 1.6) * (random() < 0.12 ? 1.65 : 1);
  const extension = Math.min(scale * strength, range * 0.75, Math.min(open, close) * 0.06);
  const kind = random();
  let upper: number, lower: number;
  if (kind < 0.33) {
    upper = extension;
    lower = random() < 0.35 ? extension * (0.05 + random() * 0.2) : 0;
  } else if (kind < 0.66) {
    lower = extension;
    upper = random() < 0.35 ? extension * (0.05 + random() * 0.2) : 0;
  } else {
    upper = extension * (0.25 + random() * 0.75);
    lower = extension * (0.25 + random() * 0.75);
  }
  const result = candles.map((candle) => ({ ...candle, ticks: candle.ticks.slice() }));
  const extend = (side: 'upper' | 'lower', amount: number): boolean => {
    if (!(amount > 0)) return false;
    let chosen: { candle: number; tick: number; bound: number } | null = null;
    let best = side === 'upper' ? -Infinity : Infinity;
    for (let c = 0; c < candles.length; c += 1) {
      const candle = candles[c];
      const bound = side === 'upper' ? Math.max(candle.open, candle.close) * Math.exp(candle.maxWick)
        : Math.min(candle.open, candle.close) * Math.exp(-candle.maxWick);
      if (side === 'upper' ? bound <= high * (1 + 2e-8) : bound >= low * (1 - 2e-8)) continue;
      for (let t = 0; t < candle.ticks.length; t += 1) {
        const extreme = side === 'upper' ? candle.ticks[t].high : candle.ticks[t].low;
        if (side === 'upper' ? extreme > best : extreme < best) {
          best = extreme; chosen = { candle: c, tick: t, bound };
        }
      }
    }
    if (!chosen) return false;
    const tick = result[chosen.candle].ticks[chosen.tick];
    result[chosen.candle].ticks[chosen.tick] = side === 'upper'
      ? { ...tick, high: Math.max(tick.high, Math.min(high + amount, chosen.bound)) }
      : { ...tick, low: Math.min(tick.low, Math.max(low - amount, chosen.bound)) };
    return true;
  };
  const raised = extend('upper', upper);
  const lowered = extend('lower', lower);
  // A profile may already be at its bound on the chosen side. Use the other
  // available side instead of exceeding its cap or reshaping an existing wick.
  if (!raised && !lowered) {
    if (upper > 0) extend('lower', extension * 0.6);
    else extend('upper', extension * 0.6);
  }
  return result;
}
