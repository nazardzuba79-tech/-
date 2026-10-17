/**
 * Figures the «Данные» window and the «Аналитика» panel print (2026-10-13).
 *
 * Everything is computed from the OHLCV bars the chart has already loaded;
 * nothing is requested, estimated or filled in. A bar's own numbers (change,
 * body, wicks), a period's numbers (change, extremes, range, volume, bar
 * counts, the biggest moves) and two volatility figures whose formulas are
 * stated next to them in the UI:
 *
 *   ATR(n)      Wilder's average true range (lib/indicators.computeATR)
 *   realised σ  standard deviation of per-bar log returns of closes, with
 *               the annualised figure σ × √(bars per year)
 */
import { computeATR, type Candle } from './indicators';
import { timeframeDurationMs, timeframeSeconds, type ChartTimeframe } from './chartTimeframes';

export interface BarStats {
  time: number;
  open: number; high: number; low: number; close: number; volume: number;
  /** close − open and the same in percent of the open. */
  change: number; changePct: number;
  /** |close − open| */
  body: number;
  upperWick: number;
  lowerWick: number;
  /** true when the bar's interval has not ended yet. */
  forming: boolean;
}

/** The bar's own figures; `forming` needs the timeframe and the clock. */
export function barStats(bar: Candle, timeframe?: ChartTimeframe, nowMs = Date.now()): BarStats {
  const body = Math.abs(bar.close - bar.open);
  const top = Math.max(bar.open, bar.close), bottom = Math.min(bar.open, bar.close);
  const forming = timeframe ? bar.time * 1000 + timeframeDurationMs(timeframe, bar.time) > nowMs : false;
  return {
    time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    change: bar.close - bar.open, changePct: bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0,
    body, upperWick: Math.max(0, bar.high - top), lowerWick: Math.max(0, bottom - bar.low), forming,
  };
}

/** The bar at `time`, by binary search over ascending bars. */
export function barAt(candles: readonly Candle[], time: number): Candle | null {
  let lo = 0, hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, bar = candles[mid];
    if (bar.time === time) return bar;
    if (bar.time < time) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/** The value of a line (ascending points) at exactly `time`. */
export function lineValueAtTime(points: readonly { time: number; value: number }[], time: number): number | null {
  let lo = 0, hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, point = points[mid];
    if (point.time === time) return Number.isFinite(point.value) ? point.value : null;
    if (point.time < time) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

export interface PeriodStats {
  from: number; to: number;
  bars: number;
  /** Completed bars only; the forming bar is counted apart. */
  completed: number;
  hasForming: boolean;
  firstOpen: number; lastClose: number;
  change: number; changePct: number;
  high: number; low: number; range: number; rangePct: number;
  volume: number;
  bestBar: { time: number; changePct: number } | null;
  worstBar: { time: number; changePct: number } | null;
}

/** Period figures over `candles` (ascending). Returns null for an empty period. */
export function periodStats(candles: readonly Candle[], timeframe?: ChartTimeframe, nowMs = Date.now()): PeriodStats | null {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const hasForming = timeframe ? last.time * 1000 + timeframeDurationMs(timeframe, last.time) > nowMs : false;
  let high = -Infinity, low = Infinity, volume = 0;
  let best: PeriodStats['bestBar'] = null, worst: PeriodStats['worstBar'] = null;
  for (const bar of candles) {
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    volume += bar.volume;
    const pct = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
    if (!best || pct > best.changePct) best = { time: bar.time, changePct: pct };
    if (!worst || pct < worst.changePct) worst = { time: bar.time, changePct: pct };
  }
  const firstOpen = candles[0].open, lastClose = last.close;
  return {
    from: candles[0].time, to: last.time, bars: candles.length, completed: candles.length - (hasForming ? 1 : 0), hasForming,
    firstOpen, lastClose, change: lastClose - firstOpen, changePct: firstOpen > 0 ? ((lastClose - firstOpen) / firstOpen) * 100 : 0,
    high, low, range: high - low, rangePct: low > 0 ? ((high - low) / low) * 100 : 0, volume, bestBar: best, worstBar: worst,
  };
}

export interface VolatilityStats {
  /** ATR(period) at the last bar, in price units, or null before the warm-up. */
  atr: number | null;
  atrPct: number | null;
  atrPeriod: number;
  /** σ of per-bar log returns over the window (percent), bars used, annualised figure. */
  realized: number | null;
  realizedBars: number;
  annualized: number | null;
  barsPerYear: number | null;
  /** Mean (high − low) / close over the window, percent. */
  averageRangePct: number | null;
}

/** How many bars of a timeframe make a year (calendar month: 12). */
export function barsPerYear(timeframe: ChartTimeframe): number {
  if (timeframe === '1M') return 12;
  const seconds = timeframeSeconds(timeframe);
  return seconds ? Math.round((365 * 86400) / seconds) : 0;
}

/** Volatility over `candles` (ascending), using completed bars only when a forming one is marked. */
export function volatilityStats(candles: readonly Candle[], timeframe?: ChartTimeframe, options: { atrPeriod?: number; nowMs?: number } = {}): VolatilityStats {
  const atrPeriod = options.atrPeriod ?? 14;
  const nowMs = options.nowMs ?? Date.now();
  const last = candles[candles.length - 1];
  const forming = last && timeframe ? last.time * 1000 + timeframeDurationMs(timeframe, last.time) > nowMs : false;
  const completed = forming ? candles.slice(0, -1) : candles.slice();
  const atrPoints = completed.length >= atrPeriod ? computeATR(completed, atrPeriod) : [];
  const atr = atrPoints.length ? atrPoints[atrPoints.length - 1].value : null;
  const lastClose = completed.length ? completed[completed.length - 1].close : null;
  const logReturns: number[] = [];
  for (let i = 1; i < completed.length; i++) {
    const a = completed[i - 1].close, b = completed[i].close;
    if (a > 0 && b > 0) logReturns.push(Math.log(b / a));
  }
  let realized: number | null = null;
  if (logReturns.length >= 2) {
    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
    realized = Math.sqrt(variance) * 100;
  }
  const perYear = timeframe ? barsPerYear(timeframe) : null;
  const ranges = completed.filter(bar => bar.close > 0).map(bar => ((bar.high - bar.low) / bar.close) * 100);
  return {
    atr, atrPct: atr !== null && lastClose ? (atr / lastClose) * 100 : null, atrPeriod,
    realized, realizedBars: logReturns.length,
    annualized: realized !== null && perYear ? realized * Math.sqrt(perYear) : null, barsPerYear: perYear,
    averageRangePct: ranges.length ? ranges.reduce((s, v) => s + v, 0) / ranges.length : null,
  };
}

export type AnalyticsPeriod = 'visible' | 'all' | '1d' | '1w' | '1M';
export const ANALYTICS_PERIODS: readonly AnalyticsPeriod[] = Object.freeze(['visible', 'all', '1d', '1w', '1M']);

/** The bars of a period: a time window back from the last bar, or an explicit index range. */
export function periodBars(candles: readonly Candle[], period: AnalyticsPeriod, visible?: { from: number; to: number } | null): Candle[] {
  if (!candles.length) return [];
  if (period === 'visible') {
    if (!visible) return candles.slice();
    const from = Math.max(0, Math.floor(visible.from)), to = Math.min(candles.length - 1, Math.ceil(visible.to));
    return from <= to ? candles.slice(from, to + 1) : [];
  }
  if (period === 'all') return candles.slice();
  const seconds = period === '1d' ? 86400 : period === '1w' ? 7 * 86400 : 30 * 86400;
  const cutoff = candles[candles.length - 1].time - seconds;
  return candles.filter(bar => bar.time > cutoff);
}
