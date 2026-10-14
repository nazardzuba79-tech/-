/**
 * 2026-10-13 audit: independent reference values for the indicators the Spot
 * suite (spotIndicators.test.ts) does not cover. Every reference below is a
 * plain, deliberately naive implementation of the textbook definition — no
 * code is shared with lib/indicators.ts — evaluated on one synthetic series.
 */
import {
  computeADX, computeATR, computeCCI, computeOBV, computeStochastic, computeStochRSI, computeSupertrend,
  computeVWAP, computeWMA, computeWilliamsR, computeRSI, type Candle,
} from '../indicators';

// A deterministic, non-trivial series: a drifting sine with pseudo-random wicks and volume.
const candles: Candle[] = (() => {
  const out: Candle[] = []; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let close = 100;
  for (let i = 0; i < 120; i++) {
    const open = close; close = 100 + 12 * Math.sin(i / 7) + i * 0.15 + (rnd() - 0.5) * 3;
    const high = Math.max(open, close) + rnd() * 2, low = Math.min(open, close) - rnd() * 2;
    out.push({ time: 1_700_000_000 + i * 3600, open, high, low, close, volume: 50 + Math.round(rnd() * 100) });
  }
  return out;
})();
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const tp = (c: Candle) => (c.high + c.low + c.close) / 3;
const trueRange = (i: number) => i === 0 ? candles[0].high - candles[0].low : Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
/** Wilder's smoothing: first value = simple average of the first `period`, then (prev*(p-1)+x)/p. */
const wilderRef = (xs: number[], period: number): number[] => { const out: number[] = []; let prev = NaN; for (let i = 0; i < xs.length; i++) { if (i < period - 1) { out.push(NaN); continue; } if (i === period - 1) prev = xs.slice(0, period).reduce((a, b) => a + b, 0) / period; else prev = (prev * (period - 1) + xs[i]) / period; out.push(prev); } return out; };
const byTime = (points: { time: number; value: number }[]) => new Map(points.map(p => [p.time, p.value]));

test('WMA weights the newest close most: sum(close_k * (p-k)) / (p(p+1)/2)', () => {
  const p = 9; const got = byTime(computeWMA(candles, p));
  expect(got.size).toBe(candles.length - p + 1);
  for (let i = p - 1; i < candles.length; i++) {
    let num = 0; for (let k = 0; k < p; k++) num += candles[i - k].close * (p - k);
    expect(near(got.get(candles[i].time)!, num / (p * (p + 1) / 2))).toBe(true);
  }
});

test('VWAP is Σ(typical×volume)/Σvolume since the start of each UTC day', () => {
  const got = byTime(computeVWAP(candles)); let day = -1, pv = 0, vol = 0;
  for (const c of candles) { const d = Math.floor(c.time / 86400); if (d !== day) { day = d; pv = 0; vol = 0; } pv += tp(c) * c.volume; vol += c.volume; expect(near(got.get(c.time)!, pv / vol)).toBe(true); }
  // the day boundary really resets: the first candle of the second day equals its own typical price
  const firstOfDay2 = candles.find((c, i) => i > 0 && Math.floor(c.time / 86400) !== Math.floor(candles[i - 1].time / 86400))!;
  expect(near(got.get(firstOfDay2.time)!, tp(firstOfDay2))).toBe(true);
});

test('ATR is Wilder-smoothed true range, first value after `period` bars', () => {
  const p = 14; const ref = wilderRef(candles.map((_, i) => trueRange(i)), p); const got = byTime(computeATR(candles, p));
  expect(got.size).toBe(candles.length - p + 1);
  for (let i = p - 1; i < candles.length; i++) expect(near(got.get(candles[i].time)!, ref[i])).toBe(true);
});

test('Stochastic %K is the smoothed raw ratio of close inside the high/low window, %D smooths %K', () => {
  const kP = 14, kS = 3, dP = 3; const raw: number[] = [];
  for (let i = 0; i < candles.length; i++) { if (i < kP - 1) { raw.push(NaN); continue; } let hi = -Infinity, lo = Infinity; for (let j = i - kP + 1; j <= i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); } raw.push(((candles[i].close - lo) / (hi - lo)) * 100); }
  const smaRef = (xs: number[], n: number) => xs.map((_, i) => { const w = xs.slice(i - n + 1, i + 1); return i < n - 1 || w.some(Number.isNaN) ? NaN : w.reduce((a, b) => a + b, 0) / n; });
  const k = smaRef(raw, kS), d = smaRef(k, dP); const got = computeStochastic(candles, kP, kS, dP); const gk = byTime(got.k), gd = byTime(got.d);
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isNaN(k[i])) expect(near(gk.get(candles[i].time)!, k[i])).toBe(true); else expect(gk.has(candles[i].time)).toBe(false);
    if (!Number.isNaN(d[i])) expect(near(gd.get(candles[i].time)!, d[i])).toBe(true); else expect(gd.has(candles[i].time)).toBe(false);
  }
  for (const p of [...got.k, ...got.d]) { expect(p.value).toBeGreaterThanOrEqual(0); expect(p.value).toBeLessThanOrEqual(100); }
});

test('StochRSI applies the stochastic formula to the RSI series itself', () => {
  const rsi = computeRSI(candles, 14); const sp = 14, kS = 3, dP = 3;
  const raw = rsi.map((p, i) => { if (i < sp - 1) return NaN; let hi = -Infinity, lo = Infinity; for (let j = i - sp + 1; j <= i; j++) { hi = Math.max(hi, rsi[j].value); lo = Math.min(lo, rsi[j].value); } return hi === lo ? 0 : ((p.value - lo) / (hi - lo)) * 100; });
  const smaRef = (xs: number[], n: number) => xs.map((_, i) => { const w = xs.slice(i - n + 1, i + 1); return i < n - 1 || w.some(Number.isNaN) ? NaN : w.reduce((a, b) => a + b, 0) / n; });
  const k = smaRef(raw, kS); const got = byTime(computeStochRSI(candles, 14, sp, kS, dP).k);
  rsi.forEach((p, i) => { if (!Number.isNaN(k[i])) expect(near(got.get(p.time)!, k[i])).toBe(true); });
  expect(got.size).toBe(rsi.length - sp - kS + 2);
});

test('OBV adds volume on an up close, subtracts on a down close, holds on an unchanged close', () => {
  const got = computeOBV(candles); let obv = candles[0].volume; expect(got[0].value).toBe(obv);
  for (let i = 1; i < candles.length; i++) { if (candles[i].close > candles[i - 1].close) obv += candles[i].volume; else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume; expect(got[i].value).toBe(obv); }
  const flat: Candle[] = candles.slice(0, 3).map(c => ({ ...c, close: 100 }));
  expect(computeOBV(flat).map(p => p.value)).toEqual([flat[0].volume, flat[0].volume, flat[0].volume]);
});

test('ADX: +DI/−DI from Wilder-smoothed directional movement over smoothed TR; ADX is Wilder-smoothed DX', () => {
  const p = 14; const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 0; i < candles.length; i++) { tr.push(trueRange(i)); if (i === 0) { pdm.push(0); mdm.push(0); continue; } const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const trS = wilderRef(tr, p), pS = wilderRef(pdm, p), mS = wilderRef(mdm, p);
  const pdi = trS.map((t, i) => Number.isNaN(t) ? NaN : (pS[i] / t) * 100), mdi = trS.map((t, i) => Number.isNaN(t) ? NaN : (mS[i] / t) * 100);
  const dx = pdi.map((a, i) => Number.isNaN(a) ? NaN : (a + mdi[i] === 0 ? 0 : (Math.abs(a - mdi[i]) / (a + mdi[i])) * 100));
  const first = dx.findIndex(v => !Number.isNaN(v)); const adxTail = wilderRef(dx.slice(first), p);
  const got = computeADX(candles, p); const gp = byTime(got.plusDi), gm = byTime(got.minusDi), ga = byTime(got.adx);
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isNaN(pdi[i])) { expect(near(gp.get(candles[i].time)!, pdi[i])).toBe(true); expect(near(gm.get(candles[i].time)!, mdi[i])).toBe(true); }
    const a = i >= first ? adxTail[i - first] : NaN; if (!Number.isNaN(a)) expect(near(ga.get(candles[i].time)!, a)).toBe(true); else expect(ga.has(candles[i].time)).toBe(false);
  }
  for (const pt of [...got.adx, ...got.plusDi, ...got.minusDi]) { expect(pt.value).toBeGreaterThanOrEqual(0); expect(pt.value).toBeLessThanOrEqual(100 + 1e-9); }
});

test('Supertrend follows the textbook final bands and flips only on a close through the active band', () => {
  const p = 10, m = 3; const atr = wilderRef(candles.map((_, i) => trueRange(i)), p);
  let fu = NaN, fl = NaN, up = true; const ref: { time: number; value: number; up: boolean }[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(atr[i])) continue; const c = candles[i], mid = (c.high + c.low) / 2, bu = mid + m * atr[i], bl = mid - m * atr[i], prevClose = i > 0 ? candles[i - 1].close : c.close;
    fu = Number.isNaN(fu) || bu < fu || prevClose > fu ? bu : fu; fl = Number.isNaN(fl) || bl > fl || prevClose < fl ? bl : fl;
    if (up && c.close < fl) up = false; else if (!up && c.close > fu) up = true;
    ref.push({ time: c.time, value: up ? fl : fu, up });
  }
  const got = computeSupertrend(candles, p, m, { up: 'U', down: 'D' });
  expect(got.length).toBe(ref.length);
  got.forEach((pt, i) => { expect(pt.time).toBe(ref[i].time); expect(near(pt.value, ref[i].value)).toBe(true); expect(pt.color).toBe(ref[i].up ? 'U' : 'D'); });
  // the line is a support below price in an up-trend and a resistance above it in a down-trend
  got.forEach((pt, i) => { const c = candles.find(x => x.time === pt.time)!; if (ref[i].up) expect(pt.value).toBeLessThanOrEqual(c.close + 1e-9); else expect(pt.value).toBeGreaterThanOrEqual(c.close - 1e-9); });
  expect(new Set(got.map(pt => pt.color)).size).toBe(2);
});

test('CCI = (typical − SMA(typical)) / (0.015 × mean absolute deviation)', () => {
  const p = 20; const got = byTime(computeCCI(candles, p)); const t = candles.map(tp);
  for (let i = p - 1; i < candles.length; i++) { const w = t.slice(i - p + 1, i + 1); const mean = w.reduce((a, b) => a + b, 0) / p; const md = w.reduce((a, b) => a + Math.abs(b - mean), 0) / p; expect(near(got.get(candles[i].time)!, (t[i] - mean) / (0.015 * md))).toBe(true); }
  expect(got.size).toBe(candles.length - p + 1);
});

test('Williams %R = (highest high − close) / (highest high − lowest low) × −100, in [−100, 0]', () => {
  const p = 14; const got = byTime(computeWilliamsR(candles, p));
  for (let i = p - 1; i < candles.length; i++) { let hi = -Infinity, lo = Infinity; for (let j = i - p + 1; j <= i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); } const v = got.get(candles[i].time)!; expect(near(v, ((hi - candles[i].close) / (hi - lo)) * -100)).toBe(true); expect(v).toBeLessThanOrEqual(0); expect(v).toBeGreaterThanOrEqual(-100); }
});

test('every indicator stays aligned to candle times and never emits NaN or Infinity', () => {
  const all = [computeWMA(candles, 9), computeVWAP(candles), computeATR(candles), computeOBV(candles), computeCCI(candles), computeWilliamsR(candles), computeSupertrend(candles), ...Object.values(computeStochastic(candles)), ...Object.values(computeStochRSI(candles)), ...Object.values(computeADX(candles))];
  const times = new Set(candles.map(c => c.time));
  for (const series of all) for (const p of series) { expect(times.has(p.time)).toBe(true); expect(Number.isFinite(p.value)).toBe(true); }
});
