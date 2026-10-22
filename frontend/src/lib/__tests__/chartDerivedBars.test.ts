import { CHART_BAR_TYPES, OHLC_BAR_TYPES, heikinAshi, hollowCandles, isChartBarType, ohlcBars } from '../chartDerivedBars';
import type { Candle } from '../indicators';

const t0 = Date.UTC(2026, 1, 18) / 1000;
const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({ time: t0 + i * 3600, open, high, low, close, volume: 3 });

describe('Heikin Ashi', () => {
  it('follows the standard recursion and seeds the first open from the first bar', () => {
    const bars = [bar(0, 10, 14, 8, 12), bar(1, 12, 20, 11, 18), bar(2, 18, 19, 9, 10)];
    const ha = heikinAshi(bars);
    expect(ha[0]).toEqual({ time: t0, open: 11, high: 14, low: 8, close: 11, volume: 3 });
    // HA open₁ = (HA open₀ + HA close₀) / 2 = 11; HA close₁ = (12+20+11+18)/4 = 15.25
    expect(ha[1]).toEqual({ time: t0 + 3600, open: 11, high: 20, low: 11, close: 15.25, volume: 3 });
    // HA open₂ = (11 + 15.25) / 2 = 13.125; HA close₂ = (18+19+9+10)/4 = 14; high = max(19, 13.125, 14) = 19; low = min(9, …) = 9
    expect(ha[2]).toEqual({ time: t0 + 7200, open: 13.125, high: 19, low: 9, close: 14, volume: 3 });
    expect(heikinAshi(bars)).toEqual(ha); // deterministic
    expect(heikinAshi([])).toEqual([]);
  });
  it('never alters the real bars it reads', () => {
    const bars = [bar(0, 10, 14, 8, 12)];
    const copy = JSON.stringify(bars);
    heikinAshi(bars);
    expect(JSON.stringify(bars)).toBe(copy);
  });
});

describe('hollow candles', () => {
  const colors = { up: '#0f0', down: '#f00', hollow: '#000' };
  it('colours the outline by the move from the previous close and fills only a bar that closes below its open', () => {
    const bars = [bar(0, 10, 11, 9, 10.5), bar(1, 10.5, 12, 10, 11), bar(2, 11, 11.5, 9, 9.5), bar(3, 9.5, 10.2, 9.4, 9.8), bar(4, 9.8, 10, 9, 9.6)];
    const painted = hollowCandles(bars, colors);
    // bar 1: close 11 ≥ previous close 10.5 → up outline; close ≥ open → hollow body
    expect(painted[1]).toMatchObject({ color: '#000', borderColor: '#0f0', wickColor: '#0f0' });
    // bar 2: close 9.5 < 11 → down outline; close < open → filled with it
    expect(painted[2]).toMatchObject({ color: '#f00', borderColor: '#f00', wickColor: '#f00' });
    // bar 3: close 9.8 ≥ 9.5 → up outline; close ≥ open → hollow
    expect(painted[3]).toMatchObject({ color: '#000', borderColor: '#0f0' });
    // bar 4: close 9.6 < 9.8 → down outline; close 9.6 < open 9.8 → filled
    expect(painted[4]).toMatchObject({ color: '#f00', borderColor: '#f00' });
    // first bar compares with its own open
    expect(painted[0]).toMatchObject({ color: '#000', borderColor: '#0f0' });
  });
});

describe('OHLC bars and the type list', () => {
  it('paints bars by their own direction and lists every type once', () => {
    expect(ohlcBars([bar(0, 10, 11, 9, 10.5), bar(1, 10, 11, 9, 9.5)], { up: 'u', down: 'd' }).map(b => b.color)).toEqual(['u', 'd']);
    expect(CHART_BAR_TYPES).toEqual(['candles', 'bars', 'hollow', 'heikin', 'line', 'area']);
    expect(OHLC_BAR_TYPES).toEqual(['candles', 'bars', 'hollow', 'heikin']);
    expect(isChartBarType('heikin')).toBe(true);
    expect(isChartBarType('renko')).toBe(false);
  });
});
