import { barReturns, commonTimes, correlation, formatPercent, lineValueAt, percentSeries, relativeStrength } from '../chartCompare';
import type { Candle } from '../indicators';

const t0 = Date.UTC(2026, 1, 18) / 1000;
const closes = (values: number[], skip: number[] = []): Candle[] =>
  values.map((close, i) => ({ time: t0 + i * 3600, open: close, high: close, low: close, close, volume: 1 })).filter((_, i) => !skip.includes(i));

describe('percent comparison on common bars', () => {
  it('normalises every series to the first common bar: Return = (Close/Close₀ − 1) × 100', () => {
    const out = percentSeries([{ id: 'BTC', candles: closes([100, 112, 108]) }, { id: 'ETH', candles: closes([50, 59, 48]) }]);
    expect(out.baseTime).toBe(t0);
    expect(out.common).toBe(3);
    expect(out.lines[0].points.map(p => +p.value.toFixed(2))).toEqual([0, 12, 8]);
    expect(out.lines[1].points.map(p => +p.value.toFixed(2))).toEqual([0, 18, -4]);
    expect(out.lines[1].last).toBeCloseTo(-4);
  });
  it('uses only bars every series has, and never interpolates a missing one', () => {
    const out = percentSeries([{ id: 'A', candles: closes([100, 110, 120, 130]) }, { id: 'B', candles: closes([10, 11, 12, 13], [2]) }]);
    expect(commonTimes([{ id: 'A', candles: closes([100, 110, 120, 130]) }, { id: 'B', candles: closes([10, 11, 12, 13], [2]) }])).toEqual([t0, t0 + 3600, t0 + 10800]);
    expect(out.lines[0].points.map(p => p.time)).toEqual([t0, t0 + 3600, t0 + 10800]);
    expect(lineValueAt(out.lines[0], t0 + 7200)).toBeNull();
    expect(lineValueAt(out.lines[0], t0 + 10800)).toBeCloseTo(30);
  });
  it('takes the base from the chosen period start, not from before it', () => {
    const out = percentSeries([{ id: 'A', candles: closes([100, 200, 220, 242]) }], { from: t0 + 3600 });
    expect(out.baseTime).toBe(t0 + 3600);
    expect(out.lines[0].points.map(p => +p.value.toFixed(1))).toEqual([0, 10, 21]);
    expect(percentSeries([{ id: 'A', candles: closes([100, 200]) }], { from: t0 + 99999 })).toMatchObject({ baseTime: null, common: 0 });
  });
  it('drops bars whose close is not a positive number', () => {
    const broken = closes([100, 110, 120]);
    broken[1] = { ...broken[1], close: NaN };
    expect(percentSeries([{ id: 'A', candles: broken }]).common).toBe(2);
  });
});

describe('relative strength', () => {
  it('reports each return, the spread in percentage points and a ratio only for a shared quote', () => {
    const a = { id: 'BTC', candles: closes([100, 110, 121]) }, b = { id: 'ETH', candles: closes([50, 50, 55]) };
    const rs = relativeStrength(a, b, { sameQuote: true, minimum: 2 });
    expect(rs.returns).toEqual({ BTC: expect.closeTo(21, 6), ETH: expect.closeTo(10, 6) });
    expect(rs.spread).toBeCloseTo(11);
    expect(rs.ratio).toBeCloseTo(121 / 55);
    expect(rs.common).toBe(3);
    expect(relativeStrength(a, b, { sameQuote: false, minimum: 2 }).ratio).toBeNull();
  });
  it('computes correlation of bar returns only with enough points, and bounds it', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    // Alternating returns in opposite phase: b's returns are a linear function of a's with slope −1.
    const zig = Array.from({ length: 30 }, (_, i) => (i % 2 ? 110 : 100)), zag = Array.from({ length: 30 }, (_, i) => (i % 2 ? 100 : 110));
    const a = { id: 'A', candles: closes(zig) }, b = { id: 'B', candles: closes(zag) };
    expect(barReturns(a.candles, a.candles.map(c => c.time))).toHaveLength(29);
    expect(relativeStrength({ id: 'U', candles: closes(up) }, { id: 'C', candles: closes(up) }).correlation).toBeCloseTo(1);
    expect(relativeStrength(a, b).correlation).toBeCloseTo(-1);
    expect(relativeStrength({ id: 'A', candles: closes(zig.slice(0, 10)) }, { id: 'B', candles: closes(zag.slice(0, 10)) }).correlation).toBeNull();
    expect(correlation([1, 1, 1], [1, 2, 3], 2)).toBeNull(); // a flat series has no correlation
    expect(correlation([], [], 0)).toBeNull();
  });
});

describe('formatting', () => {
  it('prints a signed percentage with two decimals, or a dash', () => {
    expect(formatPercent(12.345, 'en')).toBe('+12.35%');
    expect(formatPercent(-4, 'en')).toBe('−4.00%');
    expect(formatPercent(0, 'en')).toBe('0.00%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(1234.5, 'ru')).toMatch(/^\+1.234,50%$/);
  });
});
