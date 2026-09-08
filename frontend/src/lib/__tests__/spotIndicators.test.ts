import { computeSMA, computeEMA, computeBollingerBands, computeRSI, computeMACD, Candle } from '../indicators';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const candles = (closes: number[]): Candle[] => closes.map((close, index) => ({
  time: 1700000000 + index * 3600, open: close, high: close + 1, low: close - 1, close, volume: 10,
}));
const ramp = (count: number) => candles(Array.from({ length: count }, (_, index) => index + 1));
const spot = { warmupFromValidMacd: true };

test('SMA200 starts only after 200 real closes and rolls the entire window', () => {
  expect(computeSMA(ramp(199), 200)).toEqual([]);
  const input = ramp(220), before = JSON.stringify(input);
  const result = computeSMA(input, 200);
  expect(result).toHaveLength(21);
  expect(result[0]).toEqual({ time: input[199].time, value: 100.5 });
  expect(result[20]).toEqual({ time: input[219].time, value: 120.5 });
  expect(JSON.stringify(input)).toBe(before);
});

test('EMA seeds with a full SMA window then uses 2/(period+1)', () => {
  const input = candles([2, 4, 6, 8, 10]);
  expect(computeEMA(input.slice(0, 2), 3)).toEqual([]);
  expect(computeEMA(input, 3)).toEqual([
    { time: input[2].time, value: 4 }, { time: input[3].time, value: 6 }, { time: input[4].time, value: 8 },
  ]);
});

test('Bollinger 20/2 bands use actual SMA and population standard deviation', () => {
  expect(computeBollingerBands(ramp(19))).toEqual({ upper: [], middle: [], lower: [] });
  const input = ramp(21), result = computeBollingerBands(input);
  expect(result.middle).toEqual([{ time: input[19].time, value: 10.5 }, { time: input[20].time, value: 11.5 }]);
  for (let i = 0; i < 2; i++) {
    expect(result.upper[i].value).toBeCloseTo(10.5 + i + 2 * Math.sqrt(33.25), 12);
    expect(result.lower[i].value).toBeCloseTo(10.5 + i - 2 * Math.sqrt(33.25), 12);
  }
});

test('flat Bollinger input has zero width; custom period/multiplier is respected', () => {
  const flat = computeBollingerBands(candles(Array(24).fill(100)));
  for (const band of Object.values(flat)) expect(band.every(point => point.value === 100)).toBe(true);
  const custom = computeBollingerBands(ramp(4), 4, 1.5);
  expect(custom.upper[0].value).toBeCloseTo(2.5 + 1.5 * Math.sqrt(1.25), 12);
  expect(custom.lower[0].value).toBeCloseTo(2.5 - 1.5 * Math.sqrt(1.25), 12);
});

test('RSI requires 14 changes, then follows Wilder smoothing without fresh-window reseeding', () => {
  expect(computeRSI(ramp(14))).toEqual([]);
  expect(computeRSI(ramp(15))).toEqual([{ time: ramp(15)[14].time, value: 100 }]);
  const result = computeRSI(candles([10, 11, 10, 12, 11, 13]), 3);
  expect(result).toHaveLength(3);
  expect(result[0].value).toBeCloseTo(75, 12);
  expect(result[1].value).toBeCloseTo(600 / 11, 12);
  expect(result[2].value).toBeCloseTo(75, 12);
  expect(computeRSI(candles(Array.from({ length: 20 }, (_, index) => 100 - index))).every(point => point.value === 0)).toBe(true);
});

test('Spot MACD does not turn the unavailable warm-up into invented zero signal observations', () => {
  const input = ramp(48), before = JSON.stringify(input);
  const result = computeMACD(input, 12, 26, 9, spot);
  expect(result.macd).toHaveLength(15);
  expect(result.signal[0].time).toBe(input[33].time);
  for (let index = 0; index < result.macd.length; index++) {
    expect(result.macd[index].value).toBeCloseTo(7, 12);
    expect(result.signal[index].value).toBeCloseTo(7, 12);
    expect(result.histogram[index].value).toBeCloseTo(0, 12);
  }
  expect(JSON.stringify(input)).toBe(before);
});

test('Spot MACD waits for both actual EMA windows and nine valid signal observations', () => {
  for (const count of [0, 8, 12, 25, 26, 32, 33]) {
    expect(computeMACD(ramp(count), 12, 26, 9, spot)).toEqual({ macd: [], signal: [], histogram: [] });
  }
  expect(computeMACD(ramp(34), 12, 26, 9, spot).signal).toHaveLength(1);
});

test('Spot MACD signal bootstrap and subsequent EMA reconcile to MACD minus histogram', () => {
  const input = candles([1, 2, 4, 3, 7, 9, 8, 11]);
  const result = computeMACD(input, 2, 3, 2, spot);
  expect(result.macd[0].time).toBe(input[3].time);
  expect(result.macd[0].value).toBeCloseTo(7 / 18, 12);
  expect(result.signal[0].value).toBeCloseTo(11 / 18, 12);
  expect(result.histogram[0].value).toBeCloseTo(-2 / 9, 12);
  for (let index = 0; index < result.signal.length; index++) {
    expect(result.histogram[index].value).toBeCloseTo(result.macd[index].value - result.signal[index].value, 12);
    expect(result.histogram[index].color).toBe(result.histogram[index].value >= 0 ? 'rgba(0,214,143,0.6)' : 'rgba(255,77,106,0.6)');
    if (index) expect(result.signal[index].value).toBeCloseTo(result.macd[index].value * 2 / 3 + result.signal[index - 1].value / 3, 12);
  }
});

test('legacy shared MACD is unchanged unless explicitly opted in by the Spot chart', () => {
  const legacy = computeMACD(ramp(48));
  expect(legacy).toEqual(computeMACD(ramp(48), 12, 26, 9, { warmupFromValidMacd: false }));
  expect(legacy.signal[0].value).toBeCloseTo(6.060475904, 10);
  expect(legacy.histogram[0].value).toBeCloseTo(0.939524096, 10);
  const chart = readFileSync(resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8');
  const futures = readFileSync(resolve(__dirname, '../../pages/FuturesPage.tsx'), 'utf8');
  expect(chart).toContain('drawingTools = false');
  expect(chart).toContain('const drawingToolsOn = terminal && drawingTools');
  // The warm-up rides on the SPOT TERMINAL, not on "has a drawing rail".
  // Futures now opts into the same rail, and this gate is what stops that
  // from quietly changing its MACD too.
  expect(chart).toContain("const spotChartRefinements = terminal && market === 'spot'");
  expect(chart).toContain('computeMACD(res.candles, 12, 26, 9, { warmupFromValidMacd: spotChartRefinements })');
  expect(futures).toContain('<PriceChart pair={symbol} chrome="terminal" drawingTools market="futures" />');
  expect(futures).not.toContain('market="spot"');
});
