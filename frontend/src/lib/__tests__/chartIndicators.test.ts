/**
 * Indicator math on deterministic OHLCV fixtures, the catalogue's instance
 * schema and the per-browser store (Issue #502, 2026-10-10). Nothing here
 * touches a server, an order or a provider: every input is a fixed candle
 * list, every expectation a hand-checkable number.
 */
import {
  computeADX, computeATR, computeCCI, computeEMA, computeOBV, computeSMA, computeStochRSI, computeStochastic, computeSupertrend,
  computeVWAP, computeWMA, computeWilliamsR, type Candle,
} from '../indicators';
import {
  CHART_INDICATORS_KEY, DEFAULT_CHART_INDICATORS, INDICATOR_CATALOGUE, MAX_CHART_INDICATORS, computeIndicator, getChartIndicators,
  getSavedChartIndicators, indicatorDefinition, indicatorInstanceLabel, newIndicatorInstance, normalizeIndicatorInstances,
  previewChartIndicators, resetChartIndicatorsCache, revertChartIndicators, saveChartIndicators, subscribeChartIndicators,
} from '../chartIndicators';

const bar = (i: number, open: number, high: number, low: number, close: number, volume: number): Candle => ({ time: 1_700_000_000 + i * 3600, open, high, low, close, volume });
/** Ten hourly bars inside one UTC day: a rise, a dip, a rise. */
const FIX: Candle[] = [
  bar(0, 10, 11, 9, 10, 100), bar(1, 10, 12, 10, 11, 120), bar(2, 11, 13, 10, 12, 80), bar(3, 12, 12.5, 11, 11.5, 90), bar(4, 11.5, 12, 10, 10.5, 150),
  bar(5, 10.5, 11, 9.5, 10, 110), bar(6, 10, 11.5, 10, 11, 130), bar(7, 11, 12.5, 11, 12, 140), bar(8, 12, 13, 11.5, 12.5, 60), bar(9, 12.5, 14, 12, 13.5, 200),
];
const closes = FIX.map(c => c.close);
const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('indicator math on a fixed candle set', () => {
  it('WMA weights the newest close the most and starts after a full window', () => {
    const wma = computeWMA(FIX, 3);
    expect(wma).toHaveLength(FIX.length - 2);
    // (10×1 + 11×2 + 12×3) / 6
    near(wma[0].value, (10 + 22 + 36) / 6);
    expect(wma[0].time).toBe(FIX[2].time);
    const sma = computeSMA(FIX, 3);
    expect(sma[0].time).toBe(wma[0].time);
  });

  it('VWAP is the volume-weighted typical price, restarted at a UTC day boundary', () => {
    const vwap = computeVWAP(FIX.slice(0, 2));
    const tp = (c: Candle) => (c.high + c.low + c.close) / 3;
    near(vwap[0].value, tp(FIX[0]));
    near(vwap[1].value, (tp(FIX[0]) * 100 + tp(FIX[1]) * 120) / 220);
    const nextDay = { ...FIX[2], time: FIX[1].time + 86400 };
    const reset = computeVWAP([FIX[0], FIX[1], nextDay]);
    near(reset[2].value, tp(nextDay));
    // No volume: nothing to average yet.
    expect(computeVWAP([{ ...FIX[0], volume: 0 }])).toEqual([]);
  });

  it('ATR seeds with the average true range and then smooths as Wilder does', () => {
    const atr = computeATR(FIX, 3);
    const tr = (i: number) => i === 0 ? FIX[0].high - FIX[0].low : Math.max(FIX[i].high - FIX[i].low, Math.abs(FIX[i].high - FIX[i - 1].close), Math.abs(FIX[i].low - FIX[i - 1].close));
    const seed = (tr(0) + tr(1) + tr(2)) / 3;
    near(atr[0].value, seed);
    near(atr[1].value, (seed * 2 + tr(3)) / 3);
    expect(atr[0].time).toBe(FIX[2].time);
  });

  it('Stochastic %K sits between 0 and 100 and %D lags it by its own window', () => {
    const s = computeStochastic(FIX, 3, 1, 2);
    // Bar 2: highest high 13, lowest low 9, close 12 → 75.
    near(s.k[0].value, 75);
    expect(s.k[0].time).toBe(FIX[2].time);
    expect(s.d[0].time).toBe(FIX[3].time);
    for (const p of [...s.k, ...s.d]) { expect(p.value).toBeGreaterThanOrEqual(0); expect(p.value).toBeLessThanOrEqual(100); }
  });

  it('Stochastic RSI needs an RSI window plus a stochastic window and stays in 0–100', () => {
    const long: Candle[] = Array.from({ length: 60 }, (_, i) => bar(i, 100 + Math.sin(i / 3) * 5, 106 + Math.sin(i / 3) * 5, 94 + Math.sin(i / 3) * 5, 100 + Math.sin((i + 1) / 3) * 5, 50 + i));
    const s = computeStochRSI(long, 14, 14, 3, 3);
    expect(s.k.length).toBeGreaterThan(0);
    expect(s.k[0].time).toBe(long[14 + 13 + 2].time);
    for (const p of [...s.k, ...s.d]) { expect(p.value).toBeGreaterThanOrEqual(0); expect(p.value).toBeLessThanOrEqual(100); }
  });

  it('OBV adds volume on an up close, subtracts it on a down close and holds on a flat one', () => {
    const obv = computeOBV([FIX[0], FIX[1], { ...FIX[2], close: 11 }, FIX[3]]);
    expect(obv.map(p => p.value)).toEqual([100, 220, 220, 310]);
  });

  it('ADX and both DI lines are 0–100 and start after Wilder\'s double warm-up', () => {
    const long: Candle[] = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i, 102 + i, 99 + i, 101 + i, 10));
    const a = computeADX(long, 5);
    expect(a.plusDi[0].time).toBe(long[4].time);
    expect(a.adx[0].time).toBe(long[8].time);
    // A straight rise: +DI dominates −DI and ADX climbs towards 100.
    expect(a.plusDi.at(-1)!.value).toBeGreaterThan(a.minusDi.at(-1)!.value);
    expect(a.adx.at(-1)!.value).toBeGreaterThan(50);
    for (const p of [...a.adx, ...a.plusDi, ...a.minusDi]) { expect(p.value).toBeGreaterThanOrEqual(0); expect(p.value).toBeLessThanOrEqual(100); }
  });

  it('Supertrend rides below a rising market in the up colour and flips above it after a break', () => {
    const rise: Candle[] = Array.from({ length: 20 }, (_, i) => bar(i, 100 + i, 101 + i, 99 + i, 100.5 + i, 10));
    const crash = [...rise, bar(20, 120, 120, 80, 81, 10), bar(21, 81, 82, 79, 80, 10)];
    const st = computeSupertrend(crash, 3, 1, { up: '#0f0', down: '#f00' });
    expect(st[0].time).toBe(crash[2].time);
    const beforeBreak = st[st.length - 3];
    expect(beforeBreak.color).toBe('#0f0');
    expect(beforeBreak.value).toBeLessThan(crash[crash.length - 3].close);
    const after = st[st.length - 1];
    expect(after.color).toBe('#f00');
    expect(after.value).toBeGreaterThan(after.value - 1);
    expect(after.value).toBeGreaterThan(crash[crash.length - 1].close);
  });

  it('CCI is zero on a flat typical price and Williams %R is −100…0', () => {
    const flat: Candle[] = Array.from({ length: 25 }, (_, i) => bar(i, 10, 11, 9, 10, 1));
    expect(computeCCI(flat, 20).every(p => p.value === 0)).toBe(true);
    const w = computeWilliamsR(FIX, 3);
    expect(w[0].time).toBe(FIX[2].time);
    // Bar 2: (13 − 12) / (13 − 9) × −100 = −25.
    near(w[0].value, -25);
    for (const p of w) { expect(p.value).toBeGreaterThanOrEqual(-100); expect(p.value).toBeLessThanOrEqual(0); }
  });

  it('EMA still seeds from a simple average, unchanged', () => {
    const ema = computeEMA(FIX, 3);
    near(ema[0].value, (closes[0] + closes[1] + closes[2]) / 3);
  });
});

describe('the catalogue and its instances', () => {
  it('lists fifteen real indicators, each with a computation', () => {
    expect(INDICATOR_CATALOGUE.map(d => d.type)).toEqual(['ma', 'ema', 'wma', 'vwap', 'bollinger', 'supertrend', 'rsi', 'macd', 'atr', 'stochastic', 'stochrsi', 'obv', 'adx', 'cci', 'williams']);
    const long: Candle[] = Array.from({ length: 260 }, (_, i) => bar(i, 100 + Math.sin(i / 5), 101 + Math.sin(i / 5), 99 + Math.sin(i / 5), 100 + Math.sin((i + 1) / 5), 10 + (i % 7)));
    for (const def of INDICATOR_CATALOGUE) {
      const out = computeIndicator(newIndicatorInstance(def.type), long);
      for (const line of def.lines) {
        if (def.type === 'supertrend' && line.key === 'down') continue;
        expect(out.lines[line.key].length).toBeGreaterThan(0);
        for (const p of out.lines[line.key]) expect(Number.isFinite(p.value)).toBe(true);
      }
      if (def.histogram) expect(out.histogram!.length).toBeGreaterThan(0);
    }
  });

  it('opens with the one SMA 200 the chart always had', () => {
    expect(DEFAULT_CHART_INDICATORS).toEqual([{ id: 'ma-200', type: 'ma', params: { period: 200 }, colors: ['#f7d51d'], lineWidth: 1, visible: true }]);
    expect(indicatorInstanceLabel(DEFAULT_CHART_INDICATORS[0])).toBe('SMA 200');
    expect(indicatorInstanceLabel(newIndicatorInstance('macd'))).toBe('MACD 12 · 26 · 9');
    expect(indicatorInstanceLabel(newIndicatorInstance('vwap'))).toBe('VWAP');
  });

  it('re-checks every stored field: bad types drop, bad params clamp, bad colours fall back, duplicates and overflow are cut', () => {
    const list = normalizeIndicatorInstances([
      { id: 'a', type: 'rsi', params: { period: 9999 }, colors: ['red'], lineWidth: 9, visible: 'yes' },
      { id: 'a', type: 'rsi' },
      { id: 'b', type: 'hurricane' },
      { id: 'c', type: 'bollinger', params: { period: 20, mult: 0.30000000000000004 }, colors: ['#ABCDEF'], lineWidth: 3, visible: false },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, type: 'ema', params: { period: i + 1 } })),
    ]);
    expect(list[0]).toEqual({ id: 'a', type: 'rsi', params: { period: 500 }, colors: ['#c084fc'], lineWidth: 1, visible: true });
    expect(list[1]).toEqual({ id: 'c', type: 'bollinger', params: { period: 20, mult: 0.5 }, colors: ['#abcdef', '#5b8def', '#5b8def'], lineWidth: 3, visible: false });
    expect(list).toHaveLength(MAX_CHART_INDICATORS);
    expect(normalizeIndicatorInstances('nonsense')).toEqual(DEFAULT_CHART_INDICATORS);
    expect(indicatorDefinition('stochastic').bounds).toEqual([0, 100]);
  });
});

describe('the per-browser indicator store', () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(),
    } });
  });
  beforeEach(() => { store.clear(); resetChartIndicatorsCache(); });

  it('previews a draft, puts the kept list back on revert and persists on save', () => {
    const seen: number[] = [];
    const off = subscribeChartIndicators(list => seen.push(list.length));
    expect(getChartIndicators()).toEqual(DEFAULT_CHART_INDICATORS);
    previewChartIndicators([...getSavedChartIndicators(), newIndicatorInstance('rsi')]);
    expect(getChartIndicators()).toHaveLength(2);
    expect(store.has(CHART_INDICATORS_KEY)).toBe(false);
    revertChartIndicators();
    expect(getChartIndicators()).toHaveLength(1);
    saveChartIndicators([newIndicatorInstance('ema'), newIndicatorInstance('macd')]);
    expect(JSON.parse(store.get(CHART_INDICATORS_KEY)!)).toHaveLength(2);
    resetChartIndicatorsCache();
    expect(getChartIndicators().map(i => i.type)).toEqual(['ema', 'macd']);
    off();
    expect(seen).toEqual([2, 1, 2]);
  });
});
