import {
  CHART_TIMEFRAMES, DEFAULT_QUICK_TIMEFRAMES, LEGACY_TIMEFRAMES, WEEK_EPOCH_OFFSET, aggregateCandles, availableTimeframes, derivedRawLimit,
  normalizeQuickTimeframes, timeframeBucketEnd, timeframeBucketStart, timeframeDivides, timeframeDurationMs, timeframePlan, timeframeSeconds,
} from '../chartTimeframes';
import type { Candle } from '../indicators';

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 1): Candle => ({ time, open, high, low, close, volume });
/** Contiguous base bars from `start`, `count` of them, `step` seconds apart. */
const series = (start: number, step: number, count: number, price = 100): Candle[] =>
  Array.from({ length: count }, (_, i) => bar(start + i * step, price + i, price + i + 2, price + i - 2, price + i + 1, 10));

describe('the timeframe catalogue', () => {
  it('lists thirteen intervals from one minute to one month, with the six legacy ones among them', () => {
    expect(CHART_TIMEFRAMES).toEqual(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M']);
    for (const tf of LEGACY_TIMEFRAMES) expect(CHART_TIMEFRAMES).toContain(tf);
    expect(timeframeSeconds('1m')).toBe(60);
    expect(timeframeSeconds('1M')).toBe(30 * 86400); // nominal; never confused with a minute
    expect(timeframeSeconds('10m')).toBeNull();
  });
  it('keeps the quick list inside the catalogue, ordered and bounded', () => {
    expect(normalizeQuickTimeframes(undefined)).toEqual(DEFAULT_QUICK_TIMEFRAMES);
    expect(normalizeQuickTimeframes(['1d', 'bogus', '1m', '1m', '4h'])).toEqual(['1m', '4h', '1d']);
    expect(normalizeQuickTimeframes([])).toEqual(DEFAULT_QUICK_TIMEFRAMES);
    expect(normalizeQuickTimeframes(CHART_TIMEFRAMES)).toHaveLength(9);
  });
});

describe('bucket boundaries on the UTC calendar', () => {
  const t = Date.UTC(2026, 1, 18, 13, 47, 21) / 1000; // Wednesday 18 Feb 2026
  it('aligns fixed intervals to the epoch grid, which is the UTC day grid', () => {
    expect(timeframeBucketStart(t, '1h')).toBe(Date.UTC(2026, 1, 18, 13) / 1000);
    expect(timeframeBucketStart(t, '4h')).toBe(Date.UTC(2026, 1, 18, 12) / 1000);
    expect(timeframeBucketStart(t, '1d')).toBe(Date.UTC(2026, 1, 18) / 1000);
    expect(timeframeBucketEnd(Date.UTC(2026, 1, 18) / 1000, '1d')).toBe(Date.UTC(2026, 1, 19) / 1000);
  });
  it('starts weeks on Monday 00:00 UTC, as Bybit and TradingView do', () => {
    expect(new Date(WEEK_EPOCH_OFFSET * 1000).getUTCDay()).toBe(1);
    expect(timeframeBucketStart(t, '1w')).toBe(Date.UTC(2026, 1, 16) / 1000); // Monday 16 Feb
    expect(timeframeBucketStart(Date.UTC(2026, 1, 16) / 1000, '1w')).toBe(Date.UTC(2026, 1, 16) / 1000);
    expect(timeframeBucketStart(Date.UTC(2026, 1, 15, 23, 59) / 1000, '1w')).toBe(Date.UTC(2026, 1, 9) / 1000);
  });
  it('starts months on the first at 00:00 UTC and measures their real length', () => {
    expect(timeframeBucketStart(t, '1M')).toBe(Date.UTC(2026, 1, 1) / 1000);
    expect(timeframeBucketEnd(Date.UTC(2026, 1, 1) / 1000, '1M')).toBe(Date.UTC(2026, 2, 1) / 1000);
    expect(timeframeDurationMs('1M', t)).toBe(28 * 86400000);
    expect(timeframeDurationMs('1M', Date.UTC(2026, 0, 10) / 1000)).toBe(31 * 86400000);
    expect(timeframeDurationMs('1M')).toBe(30 * 86400000);
    expect(timeframeDurationMs('4h')).toBe(4 * 3600000);
  });
});

describe('what each source serves natively', () => {
  it('Bybit linear carries every interval; Kraken spot and the test market derive the rest', () => {
    for (const tf of CHART_TIMEFRAMES) expect(timeframePlan('futures-public', tf)).toEqual({ kind: 'native' });
    expect(timeframePlan('spot-public', '15m')).toEqual({ kind: 'native' });
    expect(timeframePlan('spot-public', '3m')).toEqual({ kind: 'derived', base: '1m', factor: 3 });
    expect(timeframePlan('spot-public', '30m')).toEqual({ kind: 'derived', base: '15m', factor: 2 });
    expect(timeframePlan('spot-public', '2h')).toEqual({ kind: 'derived', base: '1h', factor: 2 });
    expect(timeframePlan('spot-public', '6h')).toEqual({ kind: 'derived', base: '1h', factor: 6 });
    expect(timeframePlan('spot-public', '12h')).toEqual({ kind: 'derived', base: '4h', factor: 3 });
    expect(timeframePlan('spot-public', '1M')).toEqual({ kind: 'derived', base: '1d', factor: 30 });
    expect(timeframePlan('test-market', '1m')).toEqual({ kind: 'unavailable' });
    expect(timeframePlan('test-market', '3m')).toEqual({ kind: 'unavailable' });
    expect(timeframePlan('test-market', '30m')).toEqual({ kind: 'derived', base: '15m', factor: 2 });
    expect(availableTimeframes('legacy')).toEqual(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M']);
  });
  it('never derives a week or a month from a calendar bar, nor from an uneven divisor', () => {
    expect(timeframeDivides('1w', '1M')).toBe(false);
    expect(timeframeDivides('4h', '6h')).toBe(false);
    expect(timeframeDivides('4h', '1w')).toBe(true);
    expect(timeframeDivides('6h', '1M')).toBe(true);
    expect(timeframeDivides('1h', '1h')).toBe(false);
  });
  it('asks for enough base bars, within the source limit', () => {
    expect(derivedRawLimit({ base: '1h', factor: 6 }, '6h', 100, 'spot-public')).toBe(606);
    expect(derivedRawLimit({ base: '1h', factor: 6 }, '6h', 500, 'spot-public')).toBe(720);
    expect(derivedRawLimit({ base: '1d', factor: 30 }, '1M', 12, 'spot-public')).toBe(12 * 31 + 31);
  });
});

describe('aggregation builds real bars from real bars', () => {
  const start = Date.UTC(2026, 1, 18) / 1000;
  it('takes first open, highest high, lowest low, last close and the volume sum', () => {
    const base = [bar(start, 10, 12, 9, 11, 5), bar(start + 900, 11, 15, 10, 14, 7), bar(start + 1800, 14, 14.5, 8, 9, 1), bar(start + 2700, 9, 13, 8.5, 12.5, 2)];
    const out = aggregateCandles(base, '15m', '1h', start + 7200);
    expect(out).toEqual({ candles: [{ time: start, open: 10, high: 15, low: 8, close: 12.5, volume: 15 }], partialLast: false, dropped: 0 });
  });
  it('drops a leading partial bucket and a historical bucket with a gap, never pads them', () => {
    const base = [...series(start + 1800, 900, 2), ...series(start + 3600, 900, 4), ...series(start + 7200, 900, 4).filter((_, i) => i !== 2), ...series(start + 10800, 900, 4)];
    const out = aggregateCandles(base, '15m', '1h', start + 20000);
    expect(out.candles.map(c => c.time)).toEqual([start + 3600, start + 10800]);
    expect(out.dropped).toBe(2);
    expect(out.partialLast).toBe(false);
  });
  it('emits the newest bucket while it is still forming, flagged, only when it opens on its own boundary', () => {
    const forming = aggregateCandles([...series(start, 900, 4), ...series(start + 3600, 900, 2)], '15m', '1h', start + 3600 + 1700);
    expect(forming.candles.map(c => c.time)).toEqual([start, start + 3600]);
    expect(forming.partialLast).toBe(true);
    // Same bars, but the clock says that hour has ended: it is a gap, not a forming bar.
    const ended = aggregateCandles([...series(start, 900, 4), ...series(start + 3600, 900, 2)], '15m', '1h', start + 7200 + 1);
    expect(ended.candles.map(c => c.time)).toEqual([start]);
    expect(ended.dropped).toBe(1);
    // A forming bucket that starts mid-way (its open is unknown) is not emitted either.
    const lateStart = aggregateCandles([...series(start, 900, 4), ...series(start + 3600 + 900, 900, 2)], '15m', '1h', start + 3600 + 2700);
    expect(lateStart.candles.map(c => c.time)).toEqual([start]);
  });
  it('builds Monday-based weeks from seven daily bars and calendar months from their real day counts', () => {
    const monday = Date.UTC(2026, 1, 9) / 1000;
    const weeks = aggregateCandles(series(monday - 2 * 86400, 86400, 2 + 14), '1d', '1w', monday + 15 * 86400);
    expect(weeks.candles.map(c => c.time)).toEqual([monday, monday + 7 * 86400]);
    expect(weeks.dropped).toBe(1); // the two days before Monday
    const jan = Date.UTC(2026, 0, 1) / 1000;
    const months = aggregateCandles(series(jan, 86400, 31 + 28 + 10), '1d', '1M', Date.UTC(2026, 2, 11) / 1000);
    expect(months.candles.map(c => c.time)).toEqual([jan, Date.UTC(2026, 1, 1) / 1000, Date.UTC(2026, 2, 1) / 1000]);
    expect(months.candles[1].volume).toBe(28 * 10);
    expect(months.partialLast).toBe(true);
    const short = aggregateCandles(series(jan, 86400, 31 + 27), '1d', '1M', Date.UTC(2026, 3, 1) / 1000);
    expect(short.candles.map(c => c.time)).toEqual([jan]); // February is missing a day
  });
  it('ignores off-grid rows and refuses an impossible pair', () => {
    const base = [...series(start, 900, 4), bar(start + 100, 1, 1, 1, 1)];
    expect(aggregateCandles(base, '15m', '1h', start + 7200).candles).toHaveLength(1);
    expect(() => aggregateCandles(base, '4h', '6h')).toThrow(RangeError);
  });
});
