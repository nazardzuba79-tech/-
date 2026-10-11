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
  signalPeriod = 9,
  options: { warmupFromValidMacd?: boolean } = {}
): { macd: LinePoint[]; signal: LinePoint[]; histogram: (LinePoint & { color: string })[] } {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const macdValues = closes.map((_, i) => (Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? NaN : fast[i] - slow[i]));
  const firstMacdIndex = fast.findIndex((v, idx) => !Number.isNaN(v) && !Number.isNaN(slow[idx]));
  // Spot opt-in: seed the signal from its first full window of actual MACD
  // values, never invented pre-warm-up zeroes. Keep the existing default
  // path for unrelated shared-chart consumers in this scoped correction.
  const signalValues = options.warmupFromValidMacd && firstMacdIndex >= 0
    ? [...Array<number>(firstMacdIndex).fill(NaN), ...ema(macdValues.slice(firstMacdIndex), signalPeriod)]
    : ema(macdValues.map((v) => (Number.isNaN(v) ? 0 : v)), signalPeriod);

  const macd: LinePoint[] = [];
  const signal: LinePoint[] = [];
  const histogram: (LinePoint & { color: string })[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(macdValues[i]) || Number.isNaN(signalValues[i])) continue;
    // signalValues only becomes meaningful once macdValues has been
    // non-NaN for a full signalPeriod window.
    if (i < firstMacdIndex + signalPeriod - 1) continue;
    const time = candles[i].time;
    macd.push({ time, value: macdValues[i] });
    signal.push({ time, value: signalValues[i] });
    const hist = macdValues[i] - signalValues[i];
    histogram.push({ time, value: hist, color: hist >= 0 ? 'rgba(0,214,143,0.6)' : 'rgba(255,77,106,0.6)' });
  }
  return { macd, signal, histogram };
}

// ── Added 2026-10-10 (Issue #502): the rest of a working indicator catalogue.
// Every function below is textbook math over the same real OHLCV candles,
// with the same warm-up rule as above: no point is emitted before its window
// is full, and nothing is invented to fill a gap.

/** Weighted moving average: the newest close weighs `period`, the oldest 1. */
export function computeWMA(candles: Candle[], period: number): LinePoint[] {
  const points: LinePoint[] = [];
  const denominator = (period * (period + 1)) / 2;
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += candles[i - k].close * (period - k);
    points.push({ time: candles[i].time, value: sum / denominator });
  }
  return points;
}

/** Typical price (H+L+C)/3 — the bar's price of record for VWAP and CCI. */
const typicalPrice = (c: Candle) => (c.high + c.low + c.close) / 3;

/**
 * Session VWAP: Σ(typical price × volume) / Σ(volume), restarted at every
 * UTC day boundary — the anchor charting platforms use by default for
 * perpetuals. A bar with no volume carries the previous value forward
 * rather than dividing by zero; a day's first bar before any volume emits
 * nothing.
 */
export function computeVWAP(candles: Candle[]): LinePoint[] {
  const points: LinePoint[] = [];
  let day = -1, pv = 0, volume = 0;
  for (const c of candles) {
    const bucket = Math.floor(c.time / 86400);
    if (bucket !== day) { day = bucket; pv = 0; volume = 0; }
    pv += typicalPrice(c) * c.volume;
    volume += c.volume;
    if (volume > 0) points.push({ time: c.time, value: pv / volume });
  }
  return points;
}

/** True range of bar i against bar i-1 (plain range on the first bar). */
function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prev = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
}

/** Wilder's smoothing: first value an average of the first window, then
 *  (prev × (n−1) + x) / n. Returns NaN before the window is full. */
function wilder(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Average true range (Wilder), period 14 by convention. */
export function computeATR(candles: Candle[], period = 14): LinePoint[] {
  const tr = candles.map((_, i) => trueRange(candles, i));
  const atr = wilder(tr, period);
  return candles.map((c, i) => ({ time: c.time, value: atr[i] })).filter(p => !Number.isNaN(p.value));
}

const sma = (values: number[], period: number): number[] => {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) { sum = 0; count = 0; continue; }
    sum += v; count++;
    if (count > period) { sum -= values[i - period]; count = period; }
    if (count === period) out[i] = sum / period;
  }
  return out;
};

/**
 * Stochastic oscillator: raw %K = (close − lowest low) / (highest high −
 * lowest low) × 100 over `kPeriod`, smoothed by an SMA of `kSmooth`; %D is an
 * SMA of %K over `dPeriod`. A flat window (no range) repeats the previous %K.
 */
export function computeStochastic(candles: Candle[], kPeriod = 14, kSmooth = 3, dPeriod = 3): { k: LinePoint[]; d: LinePoint[] } {
  const raw: number[] = new Array(candles.length).fill(NaN);
  let last = 50;
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); }
    raw[i] = hi === lo ? last : ((candles[i].close - lo) / (hi - lo)) * 100;
    last = raw[i];
  }
  const k = sma(raw, kSmooth), d = sma(k, dPeriod);
  const pick = (values: number[]) => candles.map((c, i) => ({ time: c.time, value: values[i] })).filter(p => !Number.isNaN(p.value));
  return { k: pick(k), d: pick(d) };
}

/** Stochastic RSI: the stochastic of the RSI series itself, 0–100. */
export function computeStochRSI(candles: Candle[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dPeriod = 3): { k: LinePoint[]; d: LinePoint[] } {
  const rsi = computeRSI(candles, rsiPeriod);
  const raw: number[] = new Array(rsi.length).fill(NaN);
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) { hi = Math.max(hi, rsi[j].value); lo = Math.min(lo, rsi[j].value); }
    raw[i] = hi === lo ? 0 : ((rsi[i].value - lo) / (hi - lo)) * 100;
  }
  const k = sma(raw, kSmooth), d = sma(k, dPeriod);
  const pick = (values: number[]) => rsi.map((p, i) => ({ time: p.time, value: values[i] })).filter(p => !Number.isNaN(p.value));
  return { k: pick(k), d: pick(d) };
}

/** On-balance volume: a running total of volume, added on an up close and
 *  subtracted on a down close. Starts at the first bar's volume. */
export function computeOBV(candles: Candle[]): LinePoint[] {
  const points: LinePoint[] = [];
  let obv = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) obv = c.volume;
    else if (c.close > candles[i - 1].close) obv += c.volume;
    else if (c.close < candles[i - 1].close) obv -= c.volume;
    points.push({ time: c.time, value: obv });
  }
  return points;
}

/**
 * Average directional index (Wilder): +DM/−DM from consecutive highs and
 * lows, smoothed with the true range into +DI/−DI, DX from their spread,
 * ADX as the smoothed DX. All three lines are 0–100.
 */
export function computeADX(candles: Candle[], period = 14): { adx: LinePoint[]; plusDi: LinePoint[]; minusDi: LinePoint[] } {
  const n = candles.length;
  const tr: number[] = [], plusDm: number[] = [], minusDm: number[] = [];
  for (let i = 0; i < n; i++) {
    tr.push(trueRange(candles, i));
    if (i === 0) { plusDm.push(0); minusDm.push(0); continue; }
    const up = candles[i].high - candles[i - 1].high, down = candles[i - 1].low - candles[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const trS = wilder(tr, period), plusS = wilder(plusDm, period), minusS = wilder(minusDm, period);
  const plusDi: number[] = [], minusDi: number[] = [], dx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(trS[i]) || trS[i] === 0) { plusDi.push(NaN); minusDi.push(NaN); dx.push(NaN); continue; }
    const p = (plusS[i] / trS[i]) * 100, m = (minusS[i] / trS[i]) * 100;
    plusDi.push(p); minusDi.push(m);
    dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
  }
  // ADX smooths DX from its first defined value onwards.
  const first = dx.findIndex(v => !Number.isNaN(v));
  const adxTail = first >= 0 ? wilder(dx.slice(first), period) : [];
  const adx = dx.map((_, i) => (i < first || first < 0 ? NaN : adxTail[i - first]));
  const pick = (values: number[]) => candles.map((c, i) => ({ time: c.time, value: values[i] })).filter(p => !Number.isNaN(p.value));
  return { adx: pick(adx), plusDi: pick(plusDi), minusDi: pick(minusDi) };
}

/**
 * Supertrend: ATR bands around the bar's midpoint ((H+L)/2 ± multiplier ×
 * ATR), carried as final bands that only tighten, the trend flipping when a
 * close crosses the opposite band. One line, coloured by the trend it is in.
 */
export function computeSupertrend(candles: Candle[], period = 10, multiplier = 3, colors: { up: string; down: string } = { up: '#2ebd85', down: '#f6465d' }): (LinePoint & { color: string })[] {
  const tr = candles.map((_, i) => trueRange(candles, i));
  const atr = wilder(tr, period);
  const points: (LinePoint & { color: string })[] = [];
  let finalUpper = NaN, finalLower = NaN, up = true;
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(atr[i])) continue;
    const c = candles[i], mid = (c.high + c.low) / 2;
    const upper = mid + multiplier * atr[i], lower = mid - multiplier * atr[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    finalUpper = Number.isNaN(finalUpper) || upper < finalUpper || prevClose > finalUpper ? upper : finalUpper;
    finalLower = Number.isNaN(finalLower) || lower > finalLower || prevClose < finalLower ? lower : finalLower;
    if (up && c.close < finalLower) up = false;
    else if (!up && c.close > finalUpper) up = true;
    points.push({ time: c.time, value: up ? finalLower : finalUpper, color: up ? colors.up : colors.down });
  }
  return points;
}

/** Commodity channel index: (typical − SMA(typical)) / (0.015 × mean deviation). */
export function computeCCI(candles: Candle[], period = 20): LinePoint[] {
  const tp = candles.map(typicalPrice);
  const points: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = tp.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const deviation = window.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    points.push({ time: candles[i].time, value: deviation === 0 ? 0 : (tp[i] - mean) / (0.015 * deviation) });
  }
  return points;
}

/** Williams %R: (highest high − close) / (highest high − lowest low) × −100, in −100…0. */
export function computeWilliamsR(candles: Candle[], period = 14): LinePoint[] {
  const points: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); }
    points.push({ time: candles[i].time, value: hi === lo ? -50 : ((hi - candles[i].close) / (hi - lo)) * -100 });
  }
  return points;
}
