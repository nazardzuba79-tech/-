// Pure technical-indicator math, computed client-side from the same real
// candle data (Kraken mirror) the chart already renders — no separate
// data source, no fabricated values. Every function only emits a point
// once it has a full warm-up window, same convention real charting
// platforms use (a partial-window "average" would be misleading).

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export function computeSMA(candles: Candle[], period: number): LinePoint[] {
  const points: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) points.push({ time: candles[i].time, value: sum / period });
  }
  return points;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (prev === null) {
      // Seed with a simple average of the first window, standard EMA bootstrap.
      const window = values.slice(i - period + 1, i + 1);
      prev = window.reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

export function computeEMA(candles: Candle[], period: number): LinePoint[] {
  const closes = candles.map((c) => c.close);
  const values = ema(closes, period);
  return candles.map((c, i) => ({ time: c.time, value: values[i] })).filter((p) => !Number.isNaN(p.value));
}

/** Bollinger Bands: a 20-period SMA (middle) plus/minus k standard
 * deviations (default k=2, the universal default every platform uses). */
export function computeBollingerBands(
  candles: Candle[],
  period = 20,
  k = 2
): { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1).map((c) => c.close);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const stddev = Math.sqrt(variance);
    const time = candles[i].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + k * stddev });
    lower.push({ time, value: mean - k * stddev });
  }
  return { upper, middle, lower };
}

/** RSI (Wilder's smoothing), period 14 by convention. Values 0-100. */
export function computeRSI(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length < period + 1) return [];
  const points: LinePoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  points.push({ time: candles[period].time, value: rsiFromAverages(avgGain, avgLoss) });

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    points.push({ time: candles[i].time, value: rsiFromAverages(avgGain, avgLoss) });
  }
  return points;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD(12,26,9): fast EMA minus slow EMA, a 9-period EMA of that as the
 * signal line, and their difference as the histogram — the standard
 * default periods every platform ships. */
export function computeMACD(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: LinePoint[]; signal: LinePoint[]; histogram: (LinePoint & { color: string })[] } {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const macdValues = closes.map((_, i) => (Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? NaN : fast[i] - slow[i]));
  const signalValues = ema(
    macdValues.map((v) => (Number.isNaN(v) ? 0 : v)),
    signalPeriod
  );

  const macd: LinePoint[] = [];
  const signal: LinePoint[] = [];
  const histogram: (LinePoint & { color: string })[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(macdValues[i]) || Number.isNaN(signalValues[i])) continue;
    // signalValues only becomes meaningful once macdValues has been
    // non-NaN for a full signalPeriod window.
    const firstMacdIndex = fast.findIndex((v, idx) => !Number.isNaN(v) && !Number.isNaN(slow[idx]));
    if (i < firstMacdIndex + signalPeriod - 1) continue;
    const time = candles[i].time;
    macd.push({ time, value: macdValues[i] });
    signal.push({ time, value: signalValues[i] });
    const hist = macdValues[i] - signalValues[i];
    histogram.push({ time, value: hist, color: hist >= 0 ? 'rgba(0,214,143,0.6)' : 'rgba(255,77,106,0.6)' });
  }
  return { macd, signal, histogram };
}
