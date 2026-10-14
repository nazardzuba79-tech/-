import { ANALYTICS_PERIODS, barAt, barStats, barsPerYear, lineValueAtTime, periodBars, periodStats, volatilityStats } from '../chartCandleStats';
import { computeATR, type Candle } from '../indicators';

const t0 = Date.UTC(2026, 1, 18) / 1000;
const bar = (i: number, open: number, high: number, low: number, close: number, volume = 1): Candle => ({ time: t0 + i * 3600, open, high, low, close, volume });

describe('one bar', () => {
  it('reports OHLCV, the move, its percent, the body and both wicks from the bar alone', () => {
    const s = barStats(bar(0, 100, 112, 95, 108, 7), '1h', (t0 + 7200) * 1000);
    expect(s).toMatchObject({ open: 100, high: 112, low: 95, close: 108, volume: 7, change: 8, body: 8, upperWick: 4, lowerWick: 5, forming: false });
    expect(s.changePct).toBeCloseTo(8);
    const down = barStats(bar(0, 100, 101, 90, 94), '1h', (t0 + 7200) * 1000);
    expect(down).toMatchObject({ change: -6, body: 6, upperWick: 1, lowerWick: 4 });
  });
  it('knows a bar whose interval has not ended is still forming', () => {
    expect(barStats(bar(0, 1, 1, 1, 1), '1h', (t0 + 1800) * 1000).forming).toBe(true);
    expect(barStats(bar(0, 1, 1, 1, 1), '1h', (t0 + 3600) * 1000).forming).toBe(false);
    expect(barStats(bar(0, 1, 1, 1, 1)).forming).toBe(false);
  });
  it('finds a bar or a line value by exact time only', () => {
    const bars = [bar(0, 1, 1, 1, 1), bar(1, 2, 2, 2, 2), bar(3, 4, 4, 4, 4)];
    expect(barAt(bars, t0 + 3600)?.open).toBe(2);
    expect(barAt(bars, t0 + 7200)).toBeNull();
    expect(lineValueAtTime([{ time: t0, value: 5 }, { time: t0 + 3600, value: 6 }], t0 + 3600)).toBe(6);
    expect(lineValueAtTime([{ time: t0, value: 5 }], t0 + 1)).toBeNull();
  });
});

describe('a period', () => {
  const bars = [bar(0, 100, 105, 99, 104, 10), bar(1, 104, 110, 103, 101, 20), bar(2, 101, 103, 96, 102, 5), bar(3, 102, 120, 101, 118, 30)];
  it('sums and ranks the loaded bars, counting the forming one apart', () => {
    const s = periodStats(bars, '1h', (t0 + 3 * 3600 + 60) * 1000)!;
    expect(s).toMatchObject({ bars: 4, completed: 3, hasForming: true, firstOpen: 100, lastClose: 118, change: 18, high: 120, low: 96, range: 24, volume: 65 });
    expect(s.changePct).toBeCloseTo(18);
    expect(s.rangePct).toBeCloseTo(25);
    expect(s.bestBar).toEqual({ time: t0 + 3 * 3600, changePct: expect.closeTo((118 - 102) / 102 * 100, 6) });
    expect(s.worstBar).toEqual({ time: t0 + 3600, changePct: expect.closeTo((101 - 104) / 104 * 100, 6) });
    expect(periodStats([], '1h')).toBeNull();
    expect(periodStats(bars, '1h', (t0 + 10 * 3600) * 1000)!.completed).toBe(4);
  });
  it('cuts a window by time or by the visible index range', () => {
    expect(ANALYTICS_PERIODS).toEqual(['visible', 'all', '1d', '1w', '1M']);
    expect(periodBars(bars, 'all')).toHaveLength(4);
    expect(periodBars(bars, 'visible', { from: 1.2, to: 2.4 }).map(b => b.time)).toEqual([t0 + 3600, t0 + 7200, t0 + 10800]);
    expect(periodBars(bars, 'visible', null)).toHaveLength(4);
    const days = Array.from({ length: 50 }, (_, i) => ({ ...bar(0, 1, 1, 1, 1), time: t0 + i * 86400 }));
    expect(periodBars(days, '1w')).toHaveLength(7);
    expect(periodBars(days, '1M')).toHaveLength(30);
    expect(periodBars(days, '1d')).toHaveLength(1);
  });
});

describe('volatility', () => {
  const series = Array.from({ length: 40 }, (_, i) => { const c = 100 * Math.exp(Math.sin(i / 3) * 0.02); return { time: t0 + i * 3600, open: c * 0.995, high: c * 1.01, low: c * 0.99, close: c, volume: 1 }; });
  it('states ATR from Wilder\'s true range and σ of log returns with its annualised figure', () => {
    const v = volatilityStats(series, '1h', { nowMs: (t0 + 100 * 3600) * 1000 });
    const atr = computeATR(series, 14);
    expect(v.atr).toBeCloseTo(atr[atr.length - 1].value, 10);
    expect(v.atrPct).toBeCloseTo((v.atr! / series[series.length - 1].close) * 100, 10);
    const logs = series.slice(1).map((b, i) => Math.log(b.close / series[i].close));
    const mean = logs.reduce((s, x) => s + x, 0) / logs.length;
    const sigma = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / (logs.length - 1)) * 100;
    expect(v.realized).toBeCloseTo(sigma, 10);
    expect(v.realizedBars).toBe(39);
    expect(v.barsPerYear).toBe(8760);
    expect(v.annualized).toBeCloseTo(sigma * Math.sqrt(8760), 8);
    expect(v.averageRangePct).toBeCloseTo(series.map(b => ((b.high - b.low) / b.close) * 100).reduce((s, x) => s + x, 0) / series.length, 10);
  });
  it('leaves the forming bar out and says so with nulls when there is too little history', () => {
    const v = volatilityStats(series, '1h', { nowMs: (t0 + 39 * 3600 + 1) * 1000 });
    expect(v.realizedBars).toBe(38);
    const short = volatilityStats(series.slice(0, 5), '1h', { nowMs: (t0 + 100 * 3600) * 1000 });
    expect(short.atr).toBeNull();
    expect(short.realized).not.toBeNull();
    expect(volatilityStats([], '1h')).toMatchObject({ atr: null, realized: null, annualized: null, averageRangePct: null });
    expect(barsPerYear('1d')).toBe(365);
    expect(barsPerYear('1M')).toBe(12);
    expect(barsPerYear('1w')).toBe(52);
  });
});
