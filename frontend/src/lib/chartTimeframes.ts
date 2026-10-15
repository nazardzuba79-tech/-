/**
 * Chart timeframes for the VOLTEX chart workspace (2026-10-13).
 *
 * The chart used to offer six intervals, every one of them a native
 * interval of its candle source. This module is the catalogue of thirteen
 * (minutes, hours, days, a week and a calendar month), what each source can
 * serve natively, and the deterministic aggregation that builds the rest
 * from REAL lower candles:
 *
 *   open   = the first base candle's open
 *   high   = the highest base high
 *   low    = the lowest base low
 *   close  = the last base candle's close
 *   volume = the sum of base volumes
 *
 * A derived candle is emitted only when every base candle of its bucket is
 * present (counted against the bucket's length on the UTC calendar: days,
 * Monday-based weeks, calendar months). Two exceptions, both honest: the
 * newest bucket, still forming, is emitted when its first base candle is the
 * bucket's own open, and flagged `partialLast`; and the first bucket of an
 * instrument's whole history (a listing's first day, week or month, when the
 * caller says where the history starts) is emitted from that first bar on,
 * exactly as the server builds the listing's own first daily bar. A
 * historical bucket with a gap is dropped, never padded — nothing here
 * invents history.
 *
 * Pure arithmetic over epoch seconds; no DOM, no network, no storage.
 */
import type { Candle } from './indicators';

export type ChartTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '1w' | '1M';
export type TimeframeGroup = 'minutes' | 'hours' | 'days' | 'months';

export interface TimeframeSpec {
  id: ChartTimeframe;
  /** Nominal length in seconds. A calendar month is counted as 30 days here;
   *  bucket boundaries use the real calendar (see `timeframeBucketStart`). */
  seconds: number;
  group: TimeframeGroup;
  /** Buckets that follow the UTC calendar rather than the epoch grid. */
  calendar?: 'week' | 'month';
}

const MINUTE = 60, HOUR = 3600, DAY = 86400, WEEK = 7 * DAY;
/** 1970-01-05 00:00 UTC was a Monday: weekly bars (Bybit, TradingView) start there. */
export const WEEK_EPOCH_OFFSET = 4 * DAY;

export const TIMEFRAME_SPECS: readonly TimeframeSpec[] = Object.freeze([
  { id: '1m', seconds: MINUTE, group: 'minutes' },
  { id: '3m', seconds: 3 * MINUTE, group: 'minutes' },
  { id: '5m', seconds: 5 * MINUTE, group: 'minutes' },
  { id: '15m', seconds: 15 * MINUTE, group: 'minutes' },
  { id: '30m', seconds: 30 * MINUTE, group: 'minutes' },
  { id: '1h', seconds: HOUR, group: 'hours' },
  { id: '2h', seconds: 2 * HOUR, group: 'hours' },
  { id: '4h', seconds: 4 * HOUR, group: 'hours' },
  { id: '6h', seconds: 6 * HOUR, group: 'hours' },
  { id: '12h', seconds: 12 * HOUR, group: 'hours' },
  { id: '1d', seconds: DAY, group: 'days' },
  { id: '1w', seconds: WEEK, group: 'days', calendar: 'week' },
  { id: '1M', seconds: 30 * DAY, group: 'months', calendar: 'month' },
]);

export const CHART_TIMEFRAMES: readonly ChartTimeframe[] = TIMEFRAME_SPECS.map(spec => spec.id);
const SPEC_BY_ID = new Map<string, TimeframeSpec>(TIMEFRAME_SPECS.map(spec => [spec.id, spec]));

/** The six intervals the chart offered before the workspace; the plain
 *  (non-terminal) chart keeps exactly these. */
export const LEGACY_TIMEFRAMES: readonly ChartTimeframe[] = Object.freeze(['5m', '15m', '1h', '4h', '1d', '1w']);
/** What the toolbar shows without a menu: the most used seven. */
export const DEFAULT_QUICK_TIMEFRAMES: readonly ChartTimeframe[] = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
export const MAX_QUICK_TIMEFRAMES = 9;
export const DEFAULT_CHART_TIMEFRAME: ChartTimeframe = '1h';

export const isChartTimeframe = (value: unknown): value is ChartTimeframe => typeof value === 'string' && SPEC_BY_ID.has(value);
export const timeframeSpec = (tf: ChartTimeframe): TimeframeSpec => SPEC_BY_ID.get(tf)!;
/** Nominal seconds of an interval, or null for a name the catalogue does not know. */
export const timeframeSeconds = (tf: string): number | null => SPEC_BY_ID.get(tf)?.seconds ?? null;
export const timeframeGroup = (tf: ChartTimeframe): TimeframeGroup => timeframeSpec(tf).group;
/** The translation key of an interval's short label («1м», «1ч», «1Д»…). */
export const timeframeLabelKey = (tf: ChartTimeframe): `chart.tf.${ChartTimeframe}` => `chart.tf.${tf}`;

/** Keep only catalogue members, deduplicated, in catalogue order, at most MAX_QUICK_TIMEFRAMES. */
export function normalizeQuickTimeframes(raw: unknown): ChartTimeframe[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_TIMEFRAMES];
  const wanted = new Set(raw.filter(isChartTimeframe));
  const list = CHART_TIMEFRAMES.filter(tf => wanted.has(tf)).slice(0, MAX_QUICK_TIMEFRAMES);
  return list.length ? list : [...DEFAULT_QUICK_TIMEFRAMES];
}

const utcMonthStart = (seconds: number): number => {
  const date = new Date(seconds * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
};
const utcNextMonthStart = (seconds: number): number => {
  const date = new Date(seconds * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
};

/** The start (epoch seconds, UTC) of the bucket that contains `time`. */
export function timeframeBucketStart(time: number, tf: ChartTimeframe): number {
  const spec = timeframeSpec(tf);
  if (spec.calendar === 'month') return utcMonthStart(time);
  if (spec.calendar === 'week') return Math.floor((time - WEEK_EPOCH_OFFSET) / WEEK) * WEEK + WEEK_EPOCH_OFFSET;
  return Math.floor(time / spec.seconds) * spec.seconds;
}

/** The exclusive end of the bucket that starts at `start`. */
export function timeframeBucketEnd(start: number, tf: ChartTimeframe): number {
  const spec = timeframeSpec(tf);
  if (spec.calendar === 'month') return utcNextMonthStart(start);
  return start + spec.seconds;
}

/** Real length in milliseconds of the bar that contains `atSeconds` (a
 *  calendar month differs per bar); the nominal length without a time. */
export function timeframeDurationMs(tf: ChartTimeframe, atSeconds?: number): number {
  const spec = timeframeSpec(tf);
  if (spec.calendar === 'month' && atSeconds !== undefined && Number.isFinite(atSeconds)) {
    const start = utcMonthStart(atSeconds);
    return (utcNextMonthStart(start) - start) * 1000;
  }
  return spec.seconds * 1000;
}

// ── Sources ─────────────────────────────────────────────────────────────

/**
 * Where a chart's candles come from. The kind decides which intervals are
 * requested as they are and which are built from a lower one:
 *
 *   futures-public  Futures (Bybit linear perpetuals): every interval is native.
 *   spot-public   Spot (Kraken OHLC, Bybit spot behind the market edge):
 *                 1m 5m 15m 1h 4h 1d 1w; the rest are derived.
 *   test-market   VOLTEX test assets (the server simulation behind the API
 *                 host for VTA and the market edge for NRX and the managed
 *                 listings): 1m straight from the ticks, then 5m 15m 1h 4h
 *                 1d 1w (verified against both hosts on 2026-10-14: every
 *                 other code answers HTTP 400); the rest are derived.
 *   legacy        The plain chart's own endpoint: the six intervals only.
 */
export type CandleSourceKind = 'futures-public' | 'spot-public' | 'test-market' | 'legacy';

/** What the test-market simulation serves as it is (src/services/testMarkets/testMarketSimulation SIM_INTERVALS). */
export const TEST_MARKET_TIMEFRAMES: readonly ChartTimeframe[] = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);

export const NATIVE_TIMEFRAMES: Record<CandleSourceKind, readonly ChartTimeframe[]> = Object.freeze({
  'futures-public': CHART_TIMEFRAMES,
  'spot-public': Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const),
  'test-market': TEST_MARKET_TIMEFRAMES,
  legacy: LEGACY_TIMEFRAMES,
});

/** The most raw candles one request to the source can return. */
export const SOURCE_RAW_LIMIT: Record<CandleSourceKind, number> = Object.freeze({ 'futures-public': 1000, 'spot-public': 720, 'test-market': 1000, legacy: 1000 });

export type TimeframePlan =
  | { kind: 'native' }
  /** Built from `base` candles; `factor` base bars per target bar (nominal for a calendar month). */
  | { kind: 'derived'; base: ChartTimeframe; factor: number }
  | { kind: 'unavailable' };

/** Whether `base` bars tile `target` bars exactly. */
export function timeframeDivides(base: ChartTimeframe, target: ChartTimeframe): boolean {
  const b = timeframeSpec(base), t = timeframeSpec(target);
  if (b.calendar) return false;
  if (b.seconds >= t.seconds) return false;
  if (t.calendar === 'month') return DAY % b.seconds === 0; // whole days of whole base bars
  return t.seconds % b.seconds === 0;
}

/** How to serve `tf` from `source`: as is, from the largest native divisor, or not at all. */
export function timeframePlan(source: CandleSourceKind, tf: ChartTimeframe): TimeframePlan {
  const native = NATIVE_TIMEFRAMES[source];
  if (native.includes(tf)) return { kind: 'native' };
  const bases = native.filter(base => timeframeDivides(base, tf)).sort((a, b) => timeframeSpec(b).seconds - timeframeSpec(a).seconds);
  const base = bases[0];
  if (!base) return { kind: 'unavailable' };
  return { kind: 'derived', base, factor: Math.round(timeframeSpec(tf).seconds / timeframeSpec(base).seconds) };
}

/** Every interval the source can show (natively or derived), in catalogue order. */
export const availableTimeframes = (source: CandleSourceKind): ChartTimeframe[] =>
  CHART_TIMEFRAMES.filter(tf => timeframePlan(source, tf).kind !== 'unavailable');

/** How many base bars to request so that `limit` derived bars can be built. */
export function derivedRawLimit(plan: { base: ChartTimeframe; factor: number }, target: ChartTimeframe, limit: number, source: CandleSourceKind): number {
  const perBar = timeframeSpec(target).calendar === 'month' ? Math.ceil(31 * DAY / timeframeSpec(plan.base).seconds) : plan.factor;
  return Math.max(1, Math.min(SOURCE_RAW_LIMIT[source], limit * perBar + perBar));
}

// ── Aggregation ─────────────────────────────────────────────────────────

export interface AggregationResult {
  candles: Candle[];
  /** The newest emitted bar is still forming (its bucket ends in the future). */
  partialLast: boolean;
  /** Historical buckets left out because a base candle was missing. */
  dropped: number;
}

const finite = (c: Candle) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite);

export interface AggregationOptions {
  /** Epoch seconds of the instrument's first trade (a listing): the bucket holding it may open there. */
  historyStart?: number;
}

/**
 * Build `target` candles from `base` candles. `now` (epoch seconds) decides
 * whether the newest bucket is still forming; it defaults to the clock.
 */
export function aggregateCandles(base: readonly Candle[], baseTf: ChartTimeframe, target: ChartTimeframe, now = Date.now() / 1000, options: AggregationOptions = {}): AggregationResult {
  if (!timeframeDivides(baseTf, target)) throw new RangeError(`${baseTf} does not tile ${target}`);
  const step = timeframeSpec(baseTf).seconds;
  const rows = base.filter(finite).slice().sort((a, b) => a.time - b.time);
  // The first base bar is the instrument's first bar ever when it is the bar that holds the listing instant.
  const firstOfHistory = options.historyStart !== undefined && rows.length > 0 && rows[0].time <= options.historyStart && options.historyStart < rows[0].time + step;
  const buckets = new Map<number, Candle[]>();
  for (const row of rows) {
    if (row.time % step !== 0) continue; // off-grid base bar: not one of ours
    const start = timeframeBucketStart(row.time, target);
    const list = buckets.get(start);
    if (list) { if (list[list.length - 1].time !== row.time) list.push(row); }
    else buckets.set(start, [row]);
  }
  const starts = [...buckets.keys()].sort((a, b) => a - b);
  const candles: Candle[] = [];
  let dropped = 0, partialLast = false;
  starts.forEach((start, index) => {
    const list = buckets.get(start)!;
    const end = timeframeBucketEnd(start, target);
    const expected = Math.round((end - start) / step);
    const opensAtStart = list[0].time === start;
    // No gap between the bars on hand (from the first of them, which is the bucket's open unless the listing is inside the bucket).
    const packed = list.every((row, i) => row.time === list[0].time + i * step);
    const complete = list.length === expected && opensAtStart && packed;
    const newest = index === starts.length - 1;
    const forming = newest && end > now;
    // A listing's first bucket: real from its first bar to the bucket's end (or to now while it forms).
    const fromListing = index === 0 && firstOfHistory && packed && (forming || list[list.length - 1].time + step === end);
    if (!complete && !fromListing && !(forming && opensAtStart && packed)) { dropped++; return; }
    let high = -Infinity, low = Infinity, volume = 0;
    for (const row of list) { if (row.high > high) high = row.high; if (row.low < low) low = row.low; volume += row.volume; }
    candles.push({ time: start, open: list[0].open, high, low, close: list[list.length - 1].close, volume });
    // Still forming: the newest bucket whose end is ahead of the clock (a closed first bucket of a listing is whole).
    if (forming && !complete) partialLast = true;
  });
  return { candles, partialLast, dropped };
}
