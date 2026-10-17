/**
 * Asset comparison math for the chart workspace (2026-10-13).
 *
 * Every function here works on bars that are already loaded, on the time
 * points the compared series SHARE, and nowhere else:
 *
 *   Return(t) = (Close(t) / Close(t0) − 1) × 100 %
 *
 * t0 is the first common bar at or after the chosen base time. A bar one
 * series has and another lacks is left out of the comparison rather than
 * filled from a neighbour; no value is read from a later bar. Correlation is
 * computed over bar-to-bar returns on common points and only when there are
 * enough of them. None of this is a forecast, and nothing here is ever used
 * to price an order.
 */
import type { Candle } from './indicators';

export interface ComparePoint { time: number; value: number }
export interface CompareSeriesInput { id: string; candles: readonly Candle[] }
export interface CompareLine { id: string; points: ComparePoint[]; last: number | null }
export interface CompareResult {
  /** The common base bar every percentage is measured from. */
  baseTime: number | null;
  lines: CompareLine[];
  /** How many common bars took part. */
  common: number;
}

/** Bars whose close is a positive finite number, keyed by time. */
const closeMap = (candles: readonly Candle[]): Map<number, number> => {
  const out = new Map<number, number>();
  for (const bar of candles) if (Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0) out.set(bar.time, bar.close);
  return out;
};

/** The bar times every series has, ascending. */
export function commonTimes(series: readonly CompareSeriesInput[]): number[] {
  if (!series.length) return [];
  const maps = series.map(s => closeMap(s.candles));
  const [first, ...rest] = maps;
  return [...first.keys()].filter(time => rest.every(map => map.has(time))).sort((a, b) => a - b);
}

/**
 * Percentage returns of every series against one common base bar. `from`
 * (epoch seconds) picks the base: the first common bar at or after it; with
 * no `from`, the first common bar. `to` limits the window.
 */
export function percentSeries(series: readonly CompareSeriesInput[], options: { from?: number; to?: number } = {}): CompareResult {
  const times = commonTimes(series).filter(time => (options.from === undefined || time >= options.from) && (options.to === undefined || time <= options.to));
  if (!times.length) return { baseTime: null, lines: series.map(s => ({ id: s.id, points: [], last: null })), common: 0 };
  const baseTime = times[0];
  const lines = series.map(s => {
    const closes = closeMap(s.candles);
    const base = closes.get(baseTime)!;
    const points = times.map(time => ({ time, value: (closes.get(time)! / base - 1) * 100 }));
    return { id: s.id, points, last: points.length ? points[points.length - 1].value : null };
  });
  return { baseTime, lines, common: times.length };
}

/** Bar-to-bar simple returns on the common points of one series. */
export function barReturns(candles: readonly Candle[], times: readonly number[]): number[] {
  const closes = closeMap(candles);
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const previous = closes.get(times[i - 1]), current = closes.get(times[i]);
    if (previous === undefined || current === undefined) continue;
    out.push(current / previous - 1);
  }
  return out;
}

export const MIN_CORRELATION_POINTS = 20;

/** Pearson correlation of two equally long return series; null when too short or flat. */
export function correlation(a: readonly number[], b: readonly number[], minimum = MIN_CORRELATION_POINTS): number | null {
  const n = Math.min(a.length, b.length);
  if (n < minimum) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  if (va === 0 || vb === 0) return null;
  const r = cov / Math.sqrt(va * vb);
  return Math.max(-1, Math.min(1, r));
}

export interface RelativeStrength {
  /** Each series' return over the window, in percent. */
  returns: Record<string, number | null>;
  /** Return of `a` minus return of `b`, in percentage points. */
  spread: number | null;
  /** Correlation of bar returns on common points, or null when not statistically usable. */
  correlation: number | null;
  /** Common points behind the figures. */
  common: number;
  /** Close(a) / Close(b) at the last common bar, when the units are compatible. */
  ratio: number | null;
}

/**
 * Relative strength of `a` against `b` over the common window. `sameQuote`
 * says both are quoted in the same unit, which is the only case a price
 * ratio means anything.
 */
export function relativeStrength(a: CompareSeriesInput, b: CompareSeriesInput, options: { from?: number; to?: number; sameQuote?: boolean; minimum?: number } = {}): RelativeStrength {
  const result = percentSeries([a, b], options);
  const [la, lb] = result.lines;
  const times = la.points.map(point => point.time);
  const corr = correlation(barReturns(a.candles, times), barReturns(b.candles, times), options.minimum);
  const lastTime = times[times.length - 1];
  const ca = closeMap(a.candles).get(lastTime), cb = closeMap(b.candles).get(lastTime);
  return {
    returns: { [a.id]: la.last, [b.id]: lb.last },
    spread: la.last !== null && lb.last !== null ? la.last - lb.last : null,
    correlation: corr,
    common: result.common,
    ratio: options.sameQuote && ca !== undefined && cb !== undefined && cb > 0 ? ca / cb : null,
  };
}

/** The value of a compare line at a time (exact bar only; no interpolation). */
export function lineValueAt(line: CompareLine, time: number): number | null {
  let lo = 0, hi = line.points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, point = line.points[mid];
    if (point.time === time) return point.value;
    if (point.time < time) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/** «+12.34%» with a sign and two decimals; «—» for nothing. */
export function formatPercent(value: number | null, locale = 'ru', digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toLocaleString(locale === 'ru' ? 'ru-RU' : locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${text}%`;
}

/** Line colours for compared series, in the order they are added. */
export const COMPARE_COLORS: readonly string[] = Object.freeze(['#60a5fa', '#f472b6', '#34d399']);
export const MAX_COMPARE_SERIES = 3;
