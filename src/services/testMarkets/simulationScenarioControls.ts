/** Version 2 choreography for the EXISTING canonical scheduled ten-second flow.
 * No timeframe-specific paths, clocks, network calls or persisted candles.
 * Version 1 and all historical market paths deliberately do not call this module.
 */
import type { ListingScenario, ScenarioControlsProgram } from '../../shared/listingScenarioControls';
import type { RealismTick } from './simulationRealism';
import type { HistoricalMoveClip, HistoricalMoveProgram, HistoricalMoveBar } from '../../shared/listingHistoricalReplay';
import type { HistoricalGrowthProgram } from '../../shared/listingHistoricalGrowth';
import { seededRandom } from './simulationRandom';

const HOUR = 3_600_000, MINUTE = 60_000, TICK = 10_000;
type Regime = 'impulse' | 'consolidation' | 'pullback';
export interface ControlledScenarioConfig {
  readonly mode: 'scenario-controls-v2';
  readonly version: 2;
  readonly from: number;
  readonly initialPrice: string;
  readonly controls: ScenarioControlsProgram;
}
const frequencies = { rare: .18, moderate: .5, often: .84 };
const smooth = (x: number) => x * x * (3 - 2 * x);
function noise(seed: string, label: string, at: number, period: number): number {
  const slot = Math.floor(at / period), part = at / period - slot;
  const a = seededRandom(seed, label, slot)() * 2 - 1, b = seededRandom(seed, label, slot + 1)() * 2 - 1;
  return a + (b - a) * smooth(part);
}
function piecewise(u: number, points: readonly (readonly [number, number])[]): number {
  const i = Math.max(0, points.findIndex((point, index) => index > 0 && u <= point[0]) - 1);
  const a = points[i], b = points[Math.min(points.length - 1, i + 1)];
  return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0]));
}
/** These are different movement structures, not ten seeds for the same curve. */
function progress(scenario: ListingScenario | 'AUTO', u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (scenario) {
    case 'WAVES': return u + .09 * Math.sin(6 * Math.PI * u);
    case 'FREQUENT_PULLBACKS': return u + .07 * Math.sin(14 * Math.PI * u) * Math.sin(Math.PI * u);
    case 'COMPRESSION_BREAKOUT': return piecewise(u, [[0, 0], [.55, .075], [.73, .8], [1, 1]]);
    case 'STAIRCASE': return piecewise(u, [[0, 0], [.1, .2], [.28, .2], [.4, .48], [.62, .48], [.73, .8], [.89, .8], [1, 1]]);
    case 'SLOW_START': return u * u;
    case 'FAST_START': return 1 - (1 - u) * (1 - u);
    case 'FALSE_BREAKOUT': return piecewise(u, [[0, 0], [.23, .52], [.42, .18], [.6, .32], [1, 1]]);
    case 'DEEP_RECOVERY': return piecewise(u, [[0, 0], [.39, .76], [.62, .35], [1, 1]]);
    case 'LONG_WICKS': return u + (.055 * Math.sin(10 * Math.PI * u) + .022 * Math.sin(26 * Math.PI * u)) * Math.sin(Math.PI * u);
    default: return u;
  }
}
interface Stage { start: number; end: number; open: number; close: number; regime: Regime; index: number }
function stageAt(config: ControlledScenarioConfig, at: number): Stage {
  let start = config.from, open = Number(config.initialPrice);
  for (const [index, stage] of config.controls.stages.entries()) {
    const end = start + stage.durationHours * HOUR, close = Number(stage.targetPrice);
    if (at < end) return { start, end, open, close, regime: stage.type === 'range' ? 'consolidation' : stage.type === 'pullback' ? 'pullback' : 'impulse', index };
    start = end; open = close;
  }
  return { start, end: Infinity, open, close: open, regime: 'consolidation', index: config.controls.stages.length };
}
function baseline(config: ControlledScenarioConfig, stage: Stage, at: number): number {
  if (stage.open === stage.close) return stage.open;
  const u = (at - stage.start) / (stage.end - stage.start);
  const travelled = progress(config.controls.scenario, u);
  return stage.open * Math.exp(Math.log(stage.close / stage.open) * travelled);
}
/** Smoothly use remaining headroom rather than clipping peaks into a flat shelf. */
function displaced(base: number, shift: number, cap: number): number {
  const odds = base / (cap - base);
  const next = odds * Math.exp(shift);
  return cap * next / (1 + next);
}
function priceAt(config: ControlledScenarioConfig, seed: string, at: number): number {
  if (at <= config.from) return Number(config.initialPrice);
  const p = stageAt(config, at);
  if (at === p.start) return p.open;
  const c = config.controls, t = at - p.start, cap = Number(c.maxPrice);
  const label = `scenario-controls-v2:${p.index}`;
  const envelope = Math.min(1, t / (5 * MINUTE), (p.end - at) / (5 * MINUTE));
  let base = baseline(config, p, at);
  // An episode is a local peak -> local percentage drawdown -> recovery, all
  // part of the same price flow. It cannot leak across a configured endpoint.
  const duration = c.pullbacks.durationMinutes * MINUTE;
  const spacing = duration * ({ rare: 5, moderate: 3, often: 1.4 }[c.pullbacks.frequency]);
  const slot = Math.floor(t / spacing), eventStart = p.start + slot * spacing + 2 * MINUTE;
  const random = seededRandom(seed, label, 'drawdown', slot);
  // "Rare" must still include occasional real counter-moves, not a possible
  // all-green launch caused by missing every seeded event in the first day.
  const occurs = random() < frequencies[c.pullbacks.frequency] || (c.pullbacks.frequency === 'rare' && slot % 6 === 1);
  if (occurs && eventStart + duration < p.end - 5 * MINUTE) {
    const u = (at - eventStart) / duration;
    if (u > 0 && u < 1) {
      const peak = baseline(config, p, eventStart);
      const depth = (Number(c.pullbacks.minDepthPercent) + random() * (Number(c.pullbacks.maxDepthPercent) - Number(c.pullbacks.minDepthPercent))) / 100;
      const trough = peak * (1 - depth), end = baseline(config, p, eventStart + duration);
      base = u <= .38 ? peak + (trough - peak) * smooth(u / .38) : trough + (end - trough) * smooth((u - .38) / .62);
    }
  }
  const intensity = { low: .008, medium: .026, high: .055 }[c.candles.intensity];
  const cluster = .25 + .75 * (noise(seed, label + ':cluster', t, 89 * MINUTE) + 1) / 2;
  const paused = (noise(seed, label + ':pause', t, 23 * MINUTE) + 1) / 2 < frequencies[c.candles.pauseFrequency] * .5;
  const amplitude = intensity * (paused ? .12 : 1) * cluster;
  const move = noise(seed, label + ':medium', t, 13 * MINUTE) * amplitude
    + noise(seed, label + ':fast', t, 83_000) * amplitude * (.5 + c.candles.diversity)
    + noise(seed, label + ':micro', t, 31_000) * amplitude * .4 * c.candles.diversity;
  // The permanent range has no elapsed-time trend or resetting growth cycle.
  const range = p.regime === 'consolidation' ? noise(seed, label + ':range', t, 137 * MINUTE) * intensity * 2.5 : 0;
  return displaced(base, envelope * (move + range), cap);
}

/* Inlined PURE v2-only arithmetic: this module is omitted by the NRX v1
 * source projection, which forbids any new runtime imports here. The
 * independent shared reference implementation stays regression-tested. */
/** A bounded index is admitted ONLY for deeply frozen, validated programs.
 * Mutable editor inputs keep the reference path: never cache stale candles.
 * Four entries, each at most 4801 Float64 prices; no ticks, clocks or IO.
 */
interface HistoricalOpenIndex {
  program: HistoricalMoveProgram;
  anchor: number;
  opens: Float64Array;
  bars: HistoricalMoveBar[];
}
const historicalOpenIndexes: HistoricalOpenIndex[] = [];
function findHistoricalOpenIndex(program: HistoricalMoveProgram, anchor: number): HistoricalOpenIndex | undefined {
  const at = historicalOpenIndexes.findIndex(entry => entry.program === program && entry.anchor === anchor);
  if (at < 0) return undefined;
  const [entry] = historicalOpenIndexes.splice(at, 1);
  historicalOpenIndexes.push(entry);
  return entry;
}
function buildHistoricalOpenIndex(program: HistoricalMoveProgram, anchor: number): HistoricalOpenIndex | undefined {
  if (!Number.isFinite(anchor) || anchor <= 0 || !Object.isFrozen(program)
      || !Object.isFrozen(program.clips) || !program.clips.every(clip =>
        Object.isFrozen(clip) && Object.isFrozen(clip.bars) && clip.bars.every(bar => Object.isFrozen(bar)))) return undefined;
  const total = program.clips.reduce((sum, clip) => sum + clip.bars.length, 0);
  if (total < 24 || total > 4800) return undefined;
  const opens = new Float64Array(total + 1), bars: HistoricalMoveBar[] = [];
  let offset = 0, clipAnchor = anchor;
  for (const clip of program.clips) {
    let open = clipAnchor, factor = 1;
    for (const bar of clip.bars) {
      opens[offset++] = open;
      bars.push(bar);
      const multiplier = 1 + bar[2] / 1000000;
      open *= multiplier;
      factor *= multiplier;
    }
    // Preserve the reference's exact floating-point grouping across clips.
    // anchor * product is NOT bit-identical to sequential anchored products.
    clipAnchor *= factor;
  }
  opens[total] = clipAnchor;
  const entry = { program, anchor, opens, bars };
  if (historicalOpenIndexes.length === 4) historicalOpenIndexes.shift();
  historicalOpenIndexes.push(entry);
  return entry;
}

function lastFactor(clip: HistoricalMoveClip): number {
  return clip.bars.reduce((factor, bar) => factor * (1 + bar[2] / 1000000), 1);
}

interface HistoricalTick { price: number; high: number; low: number; volume: number; quoteVolume: number; }
interface HistoricalHour { open: number; ticks: HistoricalTick[]; regime: 'impulse'|'pullback'|'consolidation'; }

/**
 * Returns canonical 10-second modeled ticks for one HISTORICAL hour.
 * The source's hourly close, high and low PPM moves are respected; true
 * intrahour ordering was not in hourly OHLC, and is intentionally modeled.
 * No clock acceleration and no "future" data reads.
 */
function historicalReplayHour(program: HistoricalMoveProgram, anchor: number, hour: number, seed: string): HistoricalHour {
  // Persisted configurations are strictly validated by parseListingConfig
  // before entering this synchronous v2-only generator; no runtime imports
  // are permitted by the NRX legacy release identity guard.
  if (!Number.isSafeInteger(hour) || hour < 0) throw new Error('Час истории должен быть неотрицательным');
  let indexed = findHistoricalOpenIndex(program, anchor);
  if (!indexed) {
    indexed = buildHistoricalOpenIndex(program, anchor);
  }
  let open = anchor, remaining = hour;
  let found: HistoricalMoveBar | null = null;
  if (indexed) {
    open = indexed.opens[Math.min(hour, indexed.bars.length)];
    found = indexed.bars[hour] ?? null;
  } else {
    for (const clip of program.clips) {
      if (remaining < clip.bars.length) {
        for (let i=0; i<remaining; i++) open *= 1 + clip.bars[i][2] / 1000000;
        found = clip.bars[remaining];
        break;
      }
      open *= lastFactor(clip);
      remaining -= clip.bars.length;
    }
  }
  if (!Number.isFinite(open) || open <= 0) throw new Error('Историческая цена не представима');
  const ticks: HistoricalTick[] = [];
  let last = open;
  const hash = Array.from(seed + ':' + hour).reduce((h,ch)=>((h * 33) ^ ch.charCodeAt(0)) >>> 0, 5381);
  const upFirst = (hash & 1) === 0;
  const [high,low,close] = found
    ? [open * (1 + found[0] / 1000000), open * (1 + found[1] / 1000000), open * (1 + found[2] / 1000000)]
    : [open * 1.004, open * 0.996, open];
  const stops: [number,number][] = upFirst
    ? [[0,open],[120,high],[240,low],[360,close]]
    : [[0,open],[120,low],[240,high],[360,close]];
  for (let t=1;t<=360;t++) {
    const index = t <= 120 ? 0 : t <= 240 ? 1 : 2;
    const [t0,p0] = stops[index], [t1,p1] = stops[index+1];
    const fraction = (t - t0)/(t1 - t0);
    const price = t === 360 ? close : p0 * Math.exp(Math.log(p1/p0) * fraction);
    const move = Math.abs(Math.log(price/last));
    // Model-only activity; historical volume is neither imported nor claimed.
    const quoteVolume = 20 + Math.min(300,move*20000) + (hash%17);
    ticks.push({price,high:Math.max(last,price),low:Math.min(last,price),
      quoteVolume,volume:quoteVolume/((price+last)/2)});
    last = price;
  }
  const delta = Math.log(close/open);
  return {open,ticks,regime:delta > 0.001 ? 'impulse' : delta < -0.001 ? 'pullback' : 'consolidation'};
}

/* Historical GROWTH WINDOW (voltex.historical-growth.v1): inlined copy of
 * historicalGrowthLogAt / historicalGrowthOpenLogAt / historicalGrowthTickVolume /
 * historicalGrowthPrice in shared/listingHistoricalGrowth.ts (pinned equal by
 * test, tick for tick). REAL_TIME: tick t of the listing reads source day
 * ceil(t / 1 day) - 1. Intraday v1 (straight-line baseline): a reference is
 * log-linear between samples; an OHLC day runs open → extreme (8 h) →
 * extreme (16 h) → close (24 h), its order drawn from the seed. Intraday v2
 * (SEEDED_BRIDGE_*_V2): the seeded bridge below, the reference's code with
 * the historicalBridge prefix. After the last source value the price stops. */
const HISTORICAL_BRIDGE_DEPTH = 14;
interface HistoricalBridgeSegment { t0: number; t1: number; v0: number; v1: number; edge: number; lam0: number; lam1: number; sigma: number; stream: number }
interface HistoricalBridgeDay { key: number; lo: number; hi: number; rate: number; total: number; volume: number; bursts: number[][]; segments: HistoricalBridgeSegment[] }

function historicalBridgeKey(seed: string, scenarioId: string, day: number): number {
  const text = `voltex.history20.bridge.v2:${seed}:${scenarioId}:${day}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A uniform number in [0, 1) for (day key, stream a, index b); `imul` is Math.imul. */
function historicalBridgeUnit(imul: (x: number, y: number) => number, key: number, a: number, b: number): number {
  let h = (key ^ imul(a, 0x9e3779b1)) >>> 0;
  h = imul(h ^ (h >>> 16), 0x85ebca6b);
  h = imul(h ^ (h >>> 13) ^ imul(b, 0xc2b2ae35), 0x27d4eb2f);
  h ^= h >>> 15; h = imul(h, 0x165667b1); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Standard Brownian bridge on [0, 1] (0 at both ends), Lévy midpoint construction, random access. */
function historicalBridgeNoise(key: number, stream: number, w: number): number {
  if (!(w > 0 && w < 1)) return 0;
  const imul = Math.imul;
  let left = 0, right = 0, from = 0, size = 1, index = 0, scale = 0.5;
  for (let level = 0; level < HISTORICAL_BRIDGE_DEPTH; level++) {
    const mid = (left + right) / 2 + (historicalBridgeUnit(imul, key, 1000 + stream * 16 + level, index) - 0.5) * 3.4641016151377544 * scale;
    size /= 2; scale *= 0.7071067811865476; index *= 2;
    if (w < from + size) right = mid;
    else { left = mid; from += size; index += 1; }
  }
  return left + (right - left) * (w - from) / size;
}
/** The day's activity clock: a quiet base rate plus seeded bursts (strictly increasing). */
function historicalBridgeClock(day: HistoricalBridgeDay, t: number): number {
  const tanh = Math.tanh;
  let value = day.rate * t;
  for (const [center, width, mass] of day.bursts) value += mass * (tanh((t - center) / width) + tanh(center / width)) / 2;
  return value;
}
/** Activity rate at t, mean 1 over the day: drives the pace of moves and the modeled volume. */
function historicalBridgeActivity(day: HistoricalBridgeDay, t: number): number {
  const cosh = Math.cosh;
  let rate = day.rate;
  for (const [center, width, mass] of day.bursts) { const c = cosh((t - center) / width); rate += mass / (2 * width * c * c); }
  return rate * 86400 / day.total;
}
function historicalBridgeDay(program: HistoricalGrowthProgram, seed: string, day: number, top: number): HistoricalBridgeDay {
  const rows = program.logs, key = historicalBridgeKey(seed, program.scenarioId, day);
  const unit = (a: number) => historicalBridgeUnit(Math.imul, key, a, 0), snap = (t: number) => Math.round(t / 10) * 10;
  const bursts: number[][] = [];
  for (let k = 0, n = 3 + Math.floor(unit(1) * 4); k < n; k++) bursts.push([86400 * unit(10 + k), 1200 * Math.exp(2.0149030205422647 * unit(20 + k)), 0.04 + 0.16 * unit(30 + k)]);
  const out: HistoricalBridgeDay = { key, lo: 0, hi: 0, rate: (0.5 + 0.3 * unit(2)) / 86400, total: 0, volume: 18 + 50 * unit(3), bursts, segments: [] };
  out.total = historicalBridgeClock(out, 86400);
  let points: number[][], sigma: number;
  if (program.source.dataKind === 'exchange_ohlcv') {
    // Source open at 0 s, high and low exactly at seeded tick times, close at 24 h.
    const [o, h, l, c] = rows[day], range = h - l;
    out.lo = l; out.hi = h; sigma = 0.6 * range;
    points = [[0, o]];
    if (range > 0) {
      const highFirst = o === h || c === l ? true : o === l || c === h ? false : unit(4) < 0.5 + 0.4 * (o - c) / range;
      const first = highFirst ? h : l, second = highFirst ? l : h;
      if (first !== o && second !== c) {
        const t1 = snap(86400 * (0.04 + 0.56 * unit(5) * (0.3 + 0.7 * Math.abs(first - o) / range)));
        points.push([t1, first], [snap(t1 + (86400 - t1) * (0.12 + 0.8 * unit(6))), second]);
      } else if (first !== o) points.push([snap(86400 * (0.15 + 0.7 * unit(5))), first]);
      else if (second !== c) points.push([snap(86400 * (0.15 + 0.7 * unit(5))), second]);
    }
    points.push([86400, c]);
  } else {
    // Both daily samples exactly; the band is modeled from the current and six previous daily moves (no later sample).
    const a = rows[day][0], b = rows[day + 1][0];
    let sum = 0, n = 0;
    for (let j = Math.max(0, day - 6); j <= day; j++) { sum += Math.abs(rows[j + 1][0] - rows[j][0]); n++; }
    sigma = Math.min(6e6, Math.max(4e5, 1.25 * sum / n));
    out.lo = Math.min(a, b) - 1.25 * sigma; out.hi = Math.min(top, Math.max(a, b) + 1.25 * sigma);
    points = [[0, a], [86400, b]];
  }
  const edge = (v: number) => out.hi > out.lo ? (v === out.hi ? 1 : v === out.lo ? -1 : 0) : 0;
  const push = (t0: number, v0: number, t1: number, v1: number) => {
    const lam0 = historicalBridgeClock(out, t0), lam1 = historicalBridgeClock(out, t1);
    out.segments.push({ t0, t1, v0, v1, edge: edge(v0) || edge(v1), lam0, lam1, sigma: sigma * Math.sqrt((lam1 - lam0) / out.total), stream: 3 * out.segments.length });
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    if (edge(v0) !== 0 && edge(v1) !== 0) {
      // Edge to edge: through a seeded interior point, so each piece touches at most one edge.
      const tm = t0 + snap((t1 - t0) * (0.3 + 0.4 * unit(40 + i))), vm = out.lo + (out.hi - out.lo) * (0.3 + 0.4 * unit(50 + i));
      push(t0, v0, tm, vm); push(tm, vm, t1, v1);
    } else push(t0, v0, t1, v1);
  }
  return out;
}
/**
 * ln(P/A)·1e8 at `into` seconds of the day. Vertices are returned exactly.
 * Between them the drift is linear on the activity clock. The noise lives in
 * a coordinate where the band cannot be reached: logit for a piece inside the
 * band; for a piece that ends on an edge (a source high or low), the distance
 * to that edge is the norm of a 3-D bridge (a Bessel-3 bridge: repelled from
 * the edge, touching it only at the vertex). The path never leaves [lo, hi];
 * the final min/max only absorbs floating-point rounding.
 */
function historicalBridgeLog(day: HistoricalBridgeDay, into: number): number {
  const segments = day.segments;
  let i = 0;
  while (i < segments.length - 1 && into > segments[i].t1) i++;
  const s = segments[i], range = day.hi - day.lo;
  if (into <= s.t0) return s.v0;
  if (into >= s.t1) return s.v1;
  if (!(range > 0)) return s.v0;
  const w = (historicalBridgeClock(day, into) - s.lam0) / (s.lam1 - s.lam0);
  const p = (s.v0 - day.lo + (s.v1 - s.v0) * w) / range, b = historicalBridgeNoise(day.key, s.stream, w);
  if (s.edge === 0) return Math.min(day.hi, Math.max(day.lo, day.lo + range / (1 + Math.exp(-(Math.log(p / (1 - p)) + 4 * s.sigma / range * b)))));
  const k = 1.6 * s.sigma / range, near = -Math.log(s.edge > 0 ? p : 1 - p) + k * b;
  const c2 = k * historicalBridgeNoise(day.key, s.stream + 1, w), c3 = k * historicalBridgeNoise(day.key, s.stream + 2, w);
  const z = Math.sqrt(near * near + c2 * c2 + c3 * c3);
  return Math.min(day.hi, Math.max(day.lo, s.edge > 0 ? day.lo + range * Math.exp(-z) : day.hi - range * Math.exp(-z)));
}

function historicalGrowthDayHash(seed: string, scenarioId: string, day: number): number {
  let h = 5381;
  for (const ch of `${seed}:${scenarioId}:${day}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h;
}
function historicalGrowthLog(program: HistoricalGrowthProgram, seed: string, seconds: number): number {
  const rows = program.logs;
  if (!(seconds > 0)) return rows[0][0];
  const day = Math.ceil(seconds / 86400) - 1;
  const into = seconds - day * 86400;
  if (program.source.dataKind === 'daily_reference') {
    if (day >= rows.length - 1) return rows[rows.length - 1][0];
    const a = rows[day][0], b = rows[day + 1][0];
    return a + (b - a) * into / 86400;
  }
  if (day >= rows.length) return rows[rows.length - 1][3];
  const [o, h, l, c] = rows[day];
  const upFirst = (historicalGrowthDayHash(seed, program.scenarioId, day) & 1) === 0;
  const points = upFirst ? [o, h, l, c] : [o, l, h, c];
  const third = 86400 / 3;
  const leg = Math.min(2, Math.floor((into - 1e-9) / third));
  const u = (into - leg * third) / third;
  return points[leg] + (points[leg + 1] - points[leg]) * u;
}
function historicalGrowthHour(program: HistoricalGrowthProgram, initialPrice: number, cap: number, hour: number, seed: string): { open: number; ticks: RealismTick[]; regime: Regime } {
  // Persisted configurations are validated by parseListingConfig (with the
  // logs checksum) and validateScheduledScenario before reaching here.
  if (!Number.isSafeInteger(hour) || hour < 0) throw new RangeError('Час истории должен быть неотрицательным');
  const ohlc = program.source.dataKind === 'exchange_ohlcv';
  let max = -Infinity;
  for (const row of program.logs) max = Math.max(max, ohlc ? row[1] : row[0]);
  const alpha = Math.log(1 + Number(program.targetPeakGrowthPercent) / 100) / (max / 100000000);
  // Locals, not a global lookup per tick (slow in sandboxed VMs); the values are identical.
  const { abs, exp, imul, log: ln, max: top, min: bottom } = Math, finite = Number.isFinite;
  const priceOf = (log: number) => {
    const price = initialPrice * exp(alpha * log / 100000000);
    if (!finite(price) || price <= 0) throw new RangeError('Историческая цена не представима');
    // Only the floating-point rounding of the peak (P0 · M) is floored to the cap.
    if (price > cap) {
      if (price > cap * (1 + 1e-9) + 1e-10) throw new RangeError('Историческое окно превышает максимальную цену');
      return cap;
    }
    return price;
  };
  const start = hour * 3600, day = Math.floor(start / 86400);
  const bridge = program.intrabar === 'SEEDED_BRIDGE_REFERENCE_V2' || program.intrabar === 'SEEDED_BRIDGE_OHLC_V2';
  const ticks: RealismTick[] = [];
  let open: number, previous: number;
  if (bridge && day < (ohlc ? program.logs.length : program.logs.length - 1)) {
    // Every tick of this hour lies in one source day; an OHLC day opens at its source open.
    const params = historicalBridgeDay(program, seed, day, max), from = start - day * 86400;
    open = priceOf(historicalBridgeLog(params, from)); previous = open;
    for (let i = 1; i <= 360; i++) {
      const into = from + i * 10, price = priceOf(historicalBridgeLog(params, into));
      const move = abs(ln(price / previous));
      // Modeled activity (bursts, pauses, move size); never the source's volume.
      const quoteVolume = params.volume * historicalBridgeActivity(params, into) * (0.55 + 0.9 * historicalBridgeUnit(imul, params.key, 7, into / 10)) * (1 + bottom(3, 3000 * move));
      ticks.push({ price, high: top(previous, price), low: bottom(previous, price), quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
      previous = price;
    }
  } else {
    open = priceOf(historicalGrowthLog(program, seed, start)); previous = open;
    for (let i = 1; i <= 360; i++) {
      const price = priceOf(historicalGrowthLog(program, seed, start + i * 10));
      const move = Math.abs(Math.log(price / previous));
      // Model-only activity; the source's volume is neither imported nor claimed.
      const quoteVolume = 20 + Math.min(300, move * 20000);
      ticks.push({ price, high: Math.max(previous, price), low: Math.min(previous, price), quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
      previous = price;
    }
  }
  const delta = Math.log(previous / open);
  return { open, ticks, regime: delta > 0.001 ? 'impulse' : delta < -0.001 ? 'pullback' : 'consolidation' };
}

export function controlledScenarioHour(config: ControlledScenarioConfig, seed: string, hour: number): { open: number; ticks: RealismTick[]; regime: Regime } {
  if (config.controls.growth === 'historical-window' && config.controls.historicalGrowth) {
    // The growth window replaces the stages: no stage, pullback or wick model applies.
    return historicalGrowthHour(config.controls.historicalGrowth, Number(config.initialPrice), Number(config.controls.maxPrice), hour, seed);
  }
  const stagesEnd = config.controls.stages.reduce((total, stage) => total + stage.durationHours, 0);
  if (config.controls.afterGrowth === 'historical' && config.controls.historical && hour >= stagesEnd) {
    // A 10-second synthetic tick is drawn once per real 10 seconds. Hour N
    // reproduces source hour N's relative OHLC; no replay speed control.
    // The preceding growth and final pullback are NOT modified.
    const anchor = Number(config.controls.stages[config.controls.stages.length - 1].targetPrice);
    return historicalReplayHour(config.controls.historical, anchor, hour - stagesEnd, seed);
  }
  const start = config.from + hour * HOUR, cap = Number(config.controls.maxPrice);
  const open = priceAt(config, seed, start), ticks: RealismTick[] = [];
  let previous = open;
  for (let i = 0; i < 360; i++) {
    const at = start + (i + 1) * TICK, price = priceAt(config, seed, at);
    const random = seededRandom(seed, 'scenario-controls-v2:tick', at);
    const top = Math.max(previous, price), bottom = Math.min(previous, price), move = Math.abs(Math.log(price / previous));
    const c = config.controls;
    const shadowScale = { short: .0005, normal: .002, pronounced: .008 }[c.wicks.length];
    const strong = random() < frequencies[c.wicks.longFrequency] * .15;
    const activity = .4 + random() * (1 + c.candles.diversity);
    const shadow = shadowScale * activity * (strong ? 2 + random() * 5 : random());
    // Sub-tick extrema belong to the canonical interval, so every aggregation
    // sees them. Asymmetric shadows spend only a fraction of available space.
    const high = top + (cap - top) * (1 - Math.exp(-shadow * top / cap * random()));
    const low = bottom * Math.exp(-shadow * random());
    const quoteVolume = (25 + random() * 190) * activity * (1 + Math.min(12, 140 * move));
    ticks.push({ price, high, low, volume: quoteVolume / ((previous + price) / 2), quoteVolume });
    previous = price;
  }
  return { open, ticks, regime: stageAt(config, start + HOUR / 2).regime };
}
