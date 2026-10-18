/**
 * Historical GROWTH WINDOW for managed, non-executable demo listings
 * (format `voltex.historical-growth.v1`, owner pack History20, 2026-10-18).
 *
 * It REPLACES the programmed stages of a scenario; it is never laid over a
 * programmed growth, and it is not the PR #518 continuation that replays
 * hourly moves after the stages. The two are mutually exclusive.
 *
 * Contract (A = first source open, or first reference price; H = the
 * highest high, or highest reference price, of the whole window; G = the
 * agreed peak growth; P0 = the listing's initial price):
 *
 *   M = 1 + G/100,  alpha = ln(M) / ln(H/A),
 *   P_model(t) = P0 * exp(alpha * ln(P_source(t)/A)).
 *
 * The stored program keeps only ln(P_source/A) as integers (1e-8), never the
 * source's absolute prices or volume. alpha > 0 keeps every turn and the
 * sign of every move; drawdown percentages change and are reported apart.
 *
 * Clock: REAL_TIME. Source day d is scenario day d (24 h); the timeframe a
 * chart shows never changes elapsed time. After the last source value the
 * price stops; there is no automatic tail.
 *
 * Inside a day only the source's daily values are observed; everything
 * between them is a MODEL, chosen per program by `intrabar`:
 *  - v1 (baseline, straight lines): LOG_LINEAR_REFERENCE_V1 interpolates a
 *    daily reference log-linearly; SEEDED_OHLC_PATH_V1 runs open → extreme
 *    (8 h) → extreme (16 h) → close (24 h).
 *  - v2 (default, SEEDED_BRIDGE_*_V2): a deterministic, seeded Brownian
 *    bridge on an activity clock (bursts and quiet pauses). Random access,
 *    O(depth) per tick, no state. An OHLC day starts at its source open,
 *    reaches its source high and low exactly at seeded tick times, never
 *    leaves [low, high] and ends at its close: the 1d candle IS the source
 *    bar. A reference day keeps both daily samples exactly; its intraday
 *    wicks stay inside a modeled band (local daily moves) under the global
 *    cap and are labelled MODELED, never source truth.
 * Which extreme comes first, when, the pauses and all volume are modeled
 * from the listing seed; the source volume is not imported.
 *
 * Pure: no IO, no network, no clock, no Math.random. Rights stay
 * HISTORICAL_RIGHTS_UNVERIFIED: publication is refused separately.
 *
 * The inert copies in listingScenarioControls.ts (validation) and
 * simulationScenarioControls.ts (ticks) must stay equal to this reference;
 * tests pin them against each other.
 */
import { exactPriceFromGain, HISTORICAL_GROWTH_LIMITS, validateHistoricalGrowthStructure } from './listingScenarioControls';

export const HISTORICAL_GROWTH_FORMAT = 'voltex.historical-growth.v1' as const;
export const HISTORICAL_GROWTH_LOG_SCALE = HISTORICAL_GROWTH_LIMITS.logScale;
/** Inclusive limits of the agreed GLOBAL peak from the initial price, in percent. */
export const HISTORICAL_GROWTH_MIN_PEAK_PERCENT = HISTORICAL_GROWTH_LIMITS.minPeakPercent;
export const HISTORICAL_GROWTH_MAX_PEAK_PERCENT = HISTORICAL_GROWTH_LIMITS.maxPeakPercent;
export const HISTORICAL_GROWTH_MIN_ROWS = HISTORICAL_GROWTH_LIMITS.minRows;
export const HISTORICAL_GROWTH_MAX_ROWS = HISTORICAL_GROWTH_LIMITS.maxRows;
export const HISTORICAL_GROWTH_DAY_SECONDS = 86_400;
/** |ln(P/A)| above this (≈ ×4.8e8) is not a supported price ratio. */
export const HISTORICAL_GROWTH_MAX_ABS_LOG = HISTORICAL_GROWTH_LIMITS.maxAbsLog;
export const HISTORICAL_GROWTH_PROVIDERS = ['Coin Metrics', 'Binance Vision'] as const;
export const HISTORICAL_GROWTH_LICENSES = ['CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms'] as const;
/** The preview's accounting unit. Not a currency, not a deposit asset. */
export const HISTORICAL_GROWTH_PREVIEW_UNIT = 'SIMUSDT';
export const HISTORICAL_GROWTH_LABEL = 'Симуляция • обучение ботов • не реальный торговый актив';

export type HistoricalGrowthDataKind = 'daily_reference' | 'exchange_ohlcv';
/** v1: straight-line baseline. v2: seeded bridge (default for new choices). */
export type HistoricalGrowthIntrabar = 'LOG_LINEAR_REFERENCE_V1' | 'SEEDED_OHLC_PATH_V1' | 'SEEDED_BRIDGE_REFERENCE_V2' | 'SEEDED_BRIDGE_OHLC_V2';
export function historicalGrowthIntrabarFor(kind: HistoricalGrowthDataKind, version: 1 | 2 = 2): HistoricalGrowthIntrabar {
  if (kind === 'exchange_ohlcv') return version === 1 ? 'SEEDED_OHLC_PATH_V1' : 'SEEDED_BRIDGE_OHLC_V2';
  return version === 1 ? 'LOG_LINEAR_REFERENCE_V1' : 'SEEDED_BRIDGE_REFERENCE_V2';
}
export const isHistoricalGrowthBridge = (program: Pick<HistoricalGrowthProgram, 'intrabar'>) =>
  program.intrabar === 'SEEDED_BRIDGE_REFERENCE_V2' || program.intrabar === 'SEEDED_BRIDGE_OHLC_V2';
export interface HistoricalGrowthSource {
  provider: typeof HISTORICAL_GROWTH_PROVIDERS[number];
  /** source_asset, e.g. BTC. */
  asset: string;
  /** source_quote: USD for a Coin Metrics reference, USDT for a Binance pair. Never renamed. */
  quote: 'USD' | 'USDT';
  /** source_metric. */
  metric: 'PriceUSD' | 'spot daily OHLCV';
  /** data_kind: a daily reference price is NOT OHLC. */
  dataKind: HistoricalGrowthDataKind;
  /** source_timeframe. */
  timeframe: '1d';
  firstDate: string;
  lastDate: string;
  /** SHA-256 of the source CSV slice: a fingerprint, NOT re-verifiable from the stored logs. */
  sliceSha256: string;
  license: typeof HISTORICAL_GROWTH_LICENSES[number];
}
export interface HistoricalGrowthProgram {
  format: typeof HISTORICAL_GROWTH_FORMAT;
  scenarioId: string;
  scenarioVersion: 1;
  source: HistoricalGrowthSource;
  rights: 'HISTORICAL_RIGHTS_UNVERIFIED';
  /** clock_mapping: one source day is one scenario day; no acceleration. */
  clock: { mode: 'REAL_TIME'; sourceStepSeconds: 86400; scenarioStepSeconds: 86400 };
  /** G, the agreed peak growth in percent (decimal text). */
  targetPeakGrowthPercent: string;
  intrabar: HistoricalGrowthIntrabar;
  /** round(ln(P/A) · 1e8) per source day: [ref] for a reference, [open, high, low, close] for OHLC. */
  logs: number[][];
  /** SHA-256 of JSON.stringify(logs): integrity of THESE stored values. */
  logsSha256: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const DAY_MS = HISTORICAL_GROWTH_DAY_SECONDS * 1000;

function dateMs(text: string): number {
  if (!DATE.test(text)) return NaN;
  const at = Date.parse(text + 'T00:00:00.000Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === text ? at : NaN;
}

/** SHA-256 (FIPS 180-4) over UTF-8, synchronous and dependency-free. */
export function sha256HexUtf8(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length, blocks = Math.ceil((length + 9) / 64), data = new Uint8Array(blocks * 64);
  data.set(bytes); data[length] = 0x80;
  const bits = length * 8;
  data[data.length - 4] = (bits >>> 24) & 0xff; data[data.length - 3] = (bits >>> 16) & 0xff;
  data[data.length - 2] = (bits >>> 8) & 0xff; data[data.length - 1] = bits & 0xff;
  data[data.length - 5] = Math.floor(bits / 0x100000000) & 0xff;
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 16; i++) {
      const j = block * 64 + i * 4;
      w[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

/** Width of one stored row. */
export const historicalGrowthWidth = (kind: HistoricalGrowthDataKind) => kind === 'exchange_ohlcv' ? 4 : 1;
/** The highest stored value: ln(H/A) · 1e8. */
export function historicalGrowthMaxLog(program: Pick<HistoricalGrowthProgram, 'logs' | 'source'>): number {
  const ohlc = program.source.dataKind === 'exchange_ohlcv';
  let max = -Infinity;
  for (const row of program.logs) max = Math.max(max, ohlc ? row[1] : row[0]);
  return max;
}
/** alpha = ln(M) / ln(H/A). */
export function historicalGrowthAlpha(program: Pick<HistoricalGrowthProgram, 'logs' | 'source' | 'targetPeakGrowthPercent'>): number {
  return Math.log(1 + Number(program.targetPeakGrowthPercent) / 100) / (historicalGrowthMaxLog(program) / HISTORICAL_GROWTH_LOG_SCALE);
}
/** Elapsed scenario seconds of the whole source window (REAL_TIME). */
export function historicalGrowthElapsedSeconds(program: Pick<HistoricalGrowthProgram, 'logs' | 'source'>): number {
  const days = program.source.dataKind === 'exchange_ohlcv' ? program.logs.length : program.logs.length - 1;
  return days * HISTORICAL_GROWTH_DAY_SECONDS;
}

/**
 * Structural, numeric and checksum validation of a stored program. Refuses
 * NaN/Infinity, unsafe integers, a first value other than the anchor, H ≤ A,
 * invalid OHLC, non-contiguous dates and unsupported ratios (the inert rules
 * in listingScenarioControls.ts), then the SHA-256 of the stored logs.
 */
export function validateHistoricalGrowthProgram(program: HistoricalGrowthProgram, options: { checksum?: boolean } = {}): void {
  validateHistoricalGrowthStructure(program);
  if (options.checksum !== false && (!HEX64.test(program.logsSha256) || sha256HexUtf8(JSON.stringify(program.logs)) !== program.logsSha256))
    throw new RangeError('Контрольная сумма исторического окна не совпадает');
}

/** min/max of the model over EVERY value (all O/H/L/C or all reference prices), in P0 units. */
export function historicalGrowthFactorBounds(program: HistoricalGrowthProgram): { min: number; max: number } {
  const alpha = historicalGrowthAlpha(program);
  let min = Infinity, max = -Infinity;
  for (const row of program.logs) for (const v of row) {
    const f = Math.exp(alpha * v / HISTORICAL_GROWTH_LOG_SCALE);
    min = Math.min(min, f); max = Math.max(max, f);
  }
  return { min, max };
}

function dayHash(seed: string, scenarioId: string, day: number): number {
  let h = 5381;
  for (const ch of `${seed}:${scenarioId}:${day}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h;
}

/* Intraday model v2 (SEEDED_BRIDGE_*_V2). Copied verbatim, with the
 * historicalBridge prefix, into simulationScenarioControls.ts (tests pin the
 * two tick for tick). Integer hashing only: no Math.random, no clock. Hot
 * loops take Math functions into locals: a global lookup per call is slow in
 * sandboxed VMs (such as Jest's), and the values are identical. */
const BRIDGE_DEPTH = 14;
interface BridgeSegment { t0: number; t1: number; v0: number; v1: number; edge: number; lam0: number; lam1: number; sigma: number; stream: number }
interface BridgeDay { key: number; lo: number; hi: number; rate: number; total: number; volume: number; bursts: number[][]; segments: BridgeSegment[] }

function bridgeKey(seed: string, scenarioId: string, day: number): number {
  const text = `voltex.history20.bridge.v2:${seed}:${scenarioId}:${day}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A uniform number in [0, 1) for (day key, stream a, index b); `imul` is Math.imul. */
function bridgeUnit(imul: (x: number, y: number) => number, key: number, a: number, b: number): number {
  let h = (key ^ imul(a, 0x9e3779b1)) >>> 0;
  h = imul(h ^ (h >>> 16), 0x85ebca6b);
  h = imul(h ^ (h >>> 13) ^ imul(b, 0xc2b2ae35), 0x27d4eb2f);
  h ^= h >>> 15; h = imul(h, 0x165667b1); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Standard Brownian bridge on [0, 1] (0 at both ends), Lévy midpoint construction, random access. */
function bridgeNoise(key: number, stream: number, w: number): number {
  if (!(w > 0 && w < 1)) return 0;
  const imul = Math.imul;
  let left = 0, right = 0, from = 0, size = 1, index = 0, scale = 0.5;
  for (let level = 0; level < BRIDGE_DEPTH; level++) {
    const mid = (left + right) / 2 + (bridgeUnit(imul, key, 1000 + stream * 16 + level, index) - 0.5) * 3.4641016151377544 * scale;
    size /= 2; scale *= 0.7071067811865476; index *= 2;
    if (w < from + size) right = mid;
    else { left = mid; from += size; index += 1; }
  }
  return left + (right - left) * (w - from) / size;
}
/** The day's activity clock: a quiet base rate plus seeded bursts (strictly increasing). */
function bridgeClock(day: BridgeDay, t: number): number {
  const tanh = Math.tanh;
  let value = day.rate * t;
  for (const [center, width, mass] of day.bursts) value += mass * (tanh((t - center) / width) + tanh(center / width)) / 2;
  return value;
}
/** Activity rate at t, mean 1 over the day: drives the pace of moves and the modeled volume. */
function bridgeActivity(day: BridgeDay, t: number): number {
  const cosh = Math.cosh;
  let rate = day.rate;
  for (const [center, width, mass] of day.bursts) { const c = cosh((t - center) / width); rate += mass / (2 * width * c * c); }
  return rate * 86400 / day.total;
}
function bridgeDay(program: HistoricalGrowthProgram, seed: string, day: number, top: number): BridgeDay {
  const rows = program.logs, key = bridgeKey(seed, program.scenarioId, day);
  const unit = (a: number) => bridgeUnit(Math.imul, key, a, 0), snap = (t: number) => Math.round(t / 10) * 10;
  const bursts: number[][] = [];
  for (let k = 0, n = 3 + Math.floor(unit(1) * 4); k < n; k++) bursts.push([86400 * unit(10 + k), 1200 * Math.exp(2.0149030205422647 * unit(20 + k)), 0.04 + 0.16 * unit(30 + k)]);
  const out: BridgeDay = { key, lo: 0, hi: 0, rate: (0.5 + 0.3 * unit(2)) / 86400, total: 0, volume: 18 + 50 * unit(3), bursts, segments: [] };
  out.total = bridgeClock(out, 86400);
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
    const lam0 = bridgeClock(out, t0), lam1 = bridgeClock(out, t1);
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
function bridgeLog(day: BridgeDay, into: number): number {
  const segments = day.segments;
  let i = 0;
  while (i < segments.length - 1 && into > segments[i].t1) i++;
  const s = segments[i], range = day.hi - day.lo;
  if (into <= s.t0) return s.v0;
  if (into >= s.t1) return s.v1;
  if (!(range > 0)) return s.v0;
  const w = (bridgeClock(day, into) - s.lam0) / (s.lam1 - s.lam0);
  const p = (s.v0 - day.lo + (s.v1 - s.v0) * w) / range, b = bridgeNoise(day.key, s.stream, w);
  if (s.edge === 0) return Math.min(day.hi, Math.max(day.lo, day.lo + range / (1 + Math.exp(-(Math.log(p / (1 - p)) + 4 * s.sigma / range * b)))));
  const k = 1.6 * s.sigma / range, near = -Math.log(s.edge > 0 ? p : 1 - p) + k * b;
  const c2 = k * bridgeNoise(day.key, s.stream + 1, w), c3 = k * bridgeNoise(day.key, s.stream + 2, w);
  const z = Math.sqrt(near * near + c2 * c2 + c3 * c3);
  return Math.min(day.hi, Math.max(day.lo, s.edge > 0 ? day.lo + range * Math.exp(-z) : day.hi - range * Math.exp(-z)));
}

// One deterministic day kept per call site; it holds no clock, cursor or financial state.
const bridgeCache: { logs?: number[][]; program?: HistoricalGrowthProgram; seed?: string; day?: number; value?: BridgeDay } = {};
function cachedBridgeDay(program: HistoricalGrowthProgram, seed: string, day: number): BridgeDay {
  if (bridgeCache.program !== program || bridgeCache.logs !== program.logs || bridgeCache.seed !== seed || bridgeCache.day !== day) {
    Object.assign(bridgeCache, { program, logs: program.logs, seed, day, value: bridgeDay(program, seed, day, historicalGrowthMaxLog(program)) });
  }
  return bridgeCache.value!;
}
const lastLog = (program: HistoricalGrowthProgram) => program.logs[program.logs.length - 1][program.source.dataKind === 'exchange_ohlcv' ? 3 : 0];

/**
 * ln(P/A)·1e8 of the model path at `seconds` after the listing (end-of-tick
 * convention: a tick at exactly the end of a day still belongs to it).
 */
export function historicalGrowthLogAt(program: HistoricalGrowthProgram, seed: string, seconds: number): number {
  const rows = program.logs;
  if (!(seconds > 0)) return rows[0][0];
  const day = Math.ceil(seconds / HISTORICAL_GROWTH_DAY_SECONDS) - 1;
  const into = seconds - day * HISTORICAL_GROWTH_DAY_SECONDS;
  if (isHistoricalGrowthBridge(program)) {
    if (day >= historicalGrowthElapsedSeconds(program) / HISTORICAL_GROWTH_DAY_SECONDS) return lastLog(program);
    return bridgeLog(cachedBridgeDay(program, seed, day), into);
  }
  if (program.source.dataKind === 'daily_reference') {
    if (day >= rows.length - 1) return rows[rows.length - 1][0];
    const a = rows[day][0], b = rows[day + 1][0];
    return a + (b - a) * into / HISTORICAL_GROWTH_DAY_SECONDS;
  }
  if (day >= rows.length) return rows[rows.length - 1][3];
  const [o, h, l, c] = rows[day];
  const upFirst = (dayHash(seed, program.scenarioId, day) & 1) === 0;
  const points = upFirst ? [o, h, l, c] : [o, l, h, c];
  const third = HISTORICAL_GROWTH_DAY_SECONDS / 3;
  const leg = Math.min(2, Math.floor((into - 1e-9) / third));
  const u = (into - leg * third) / third;
  return points[leg] + (points[leg + 1] - points[leg]) * u;
}

/**
 * The OPEN of a candle starting at `seconds`: the path's value just after it.
 * v1 is continuous (the previous close). v2 opens an OHLC day at its source
 * open, so the 1d candle is the source bar; the source's own gap between a
 * close and the next open stays at 00:00 (≤ 0.92 % in History20).
 */
export function historicalGrowthOpenLogAt(program: HistoricalGrowthProgram, seed: string, seconds: number): number {
  if (!isHistoricalGrowthBridge(program)) return historicalGrowthLogAt(program, seed, seconds);
  const at = Math.max(0, seconds), day = Math.floor(at / HISTORICAL_GROWTH_DAY_SECONDS);
  if (day >= historicalGrowthElapsedSeconds(program) / HISTORICAL_GROWTH_DAY_SECONDS) return lastLog(program);
  return bridgeLog(cachedBridgeDay(program, seed, day), at - day * HISTORICAL_GROWTH_DAY_SECONDS);
}

/** Modeled quote volume (SIMUSDT) of the 10-second tick ending at `seconds`; never source volume. */
export function historicalGrowthTickVolume(program: HistoricalGrowthProgram, seed: string, seconds: number, move: number): number {
  const day = Math.ceil(seconds / HISTORICAL_GROWTH_DAY_SECONDS) - 1;
  if (!isHistoricalGrowthBridge(program) || day >= historicalGrowthElapsedSeconds(program) / HISTORICAL_GROWTH_DAY_SECONDS) return 20 + Math.min(300, move * 20000);
  const params = cachedBridgeDay(program, seed, day), into = seconds - day * HISTORICAL_GROWTH_DAY_SECONDS;
  return params.volume * bridgeActivity(params, into) * (0.55 + 0.9 * bridgeUnit(Math.imul, params.key, 7, into / 10)) * (1 + Math.min(3, 3000 * move));
}

/** P0 · M in exact decimals, cut down to the asset step (1e-10): the listing's `maxPrice`. */
export function historicalGrowthMaxPrice(initialPrice: string, targetPeakGrowthPercent: string): string {
  return exactPriceFromGain(initialPrice, targetPeakGrowthPercent);
}
/** The cap every model value respects, as the simulation's formatter reads it. */
export function historicalGrowthCap(initialPrice: string, targetPeakGrowthPercent: string): number {
  return Number(historicalGrowthMaxPrice(initialPrice, targetPeakGrowthPercent));
}

/**
 * Model price for a stored log value. The peak equals P0·M up to floating
 * point (≤ 1e-12 relative); that rounding — and only it — is floored to the
 * cap. A larger excess is a broken program and throws: never a clipping.
 */
export function historicalGrowthPrice(program: HistoricalGrowthProgram, initialPrice: number, cap: number, log: number, alpha = historicalGrowthAlpha(program)): number {
  const price = initialPrice * Math.exp(alpha * log / HISTORICAL_GROWTH_LOG_SCALE);
  if (!Number.isFinite(price) || price <= 0) throw new RangeError('Историческая цена не представима');
  if (price > cap) {
    if (price > cap * (1 + 1e-9) + 1e-10) throw new RangeError('Историческое окно превышает максимальную цену');
    return cap;
  }
  return price;
}

/**
 * The SOURCE-TRUTH daily view of the whole window by scenario day (day d
 * covers its 24 h after the listing), in model units. OHLC days carry the
 * source's O/H/L/C — with v2 exactly the simulation's 1d candles. A
 * reference day goes from one sample to the next; its extremes here are its
 * ends (the source has no intraday high/low). v2's modeled reference wicks
 * appear only in the simulated intraday candles, labelled as a model.
 */
export function historicalGrowthDailyModel(program: HistoricalGrowthProgram, initialPrice: string) {
  const p0 = Number(initialPrice), alpha = historicalGrowthAlpha(program), cap = historicalGrowthCap(initialPrice, program.targetPeakGrowthPercent);
  const price = (v: number) => historicalGrowthPrice(program, p0, cap, v, alpha);
  const rows = program.logs;
  if (program.source.dataKind === 'exchange_ohlcv') return rows.map(([o, h, l, c], day) => ({ day, open: price(o), high: price(h), low: price(l), close: price(c) }));
  return rows.slice(1).map(([next], day) => {
    const open = rows[day][0];
    return { day, open: price(open), high: price(Math.max(open, next)), low: price(Math.min(open, next)), close: price(next) };
  });
}

export interface HistoricalGrowthSourceRow { date: string; open?: number; high?: number; low?: number; close: number }

/**
 * Build a stored program from a verified source slice. Refuses gaps,
 * duplicates, non-positive or non-finite prices, invalid OHLC and H ≤ A.
 * Only ln(P/A) leaves this function; absolute prices and volume do not.
 */
export function buildHistoricalGrowthProgram(input: {
  scenarioId: string; source: Omit<HistoricalGrowthSource, 'firstDate' | 'lastDate'>; targetPeakGrowthPercent: string; rows: HistoricalGrowthSourceRow[];
  /** Intraday model version: 2 (seeded bridge, default) or 1 (straight-line baseline). */
  intrabarVersion?: 1 | 2;
}): HistoricalGrowthProgram {
  const rows = input.rows, ohlc = input.source.dataKind === 'exchange_ohlcv';
  if (!Array.isArray(rows) || rows.length < HISTORICAL_GROWTH_MIN_ROWS || rows.length > HISTORICAL_GROWTH_MAX_ROWS)
    throw new RangeError('Историческое окно: от 30 до 1500 суток источника');
  const start = dateMs(rows[0].date);
  const anchor = ohlc ? rows[0].open : rows[0].close;
  if (!Number.isFinite(start) || !(typeof anchor === 'number' && anchor > 0 && Number.isFinite(anchor))) throw new RangeError('Неверная первая строка источника');
  const logs = rows.map((row, index) => {
    if (dateMs(row.date) !== start + index * DAY_MS) throw new RangeError(`Пропущенная или повторная дата источника: ${row.date}`);
    const values = ohlc ? [row.open, row.high, row.low, row.close] : [row.close];
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new RangeError(`Некорректная цена источника: ${row.date}`);
    if (ohlc && (row.high! < Math.max(row.open!, row.close) || row.low! > Math.min(row.open!, row.close))) throw new RangeError(`Некорректный OHLC источника: ${row.date}`);
    return (values as number[]).map(v => Math.round(Math.log(v / anchor) * HISTORICAL_GROWTH_LOG_SCALE));
  });
  const program: HistoricalGrowthProgram = {
    format: HISTORICAL_GROWTH_FORMAT, scenarioId: input.scenarioId, scenarioVersion: 1,
    source: { ...input.source, firstDate: rows[0].date, lastDate: rows[rows.length - 1].date },
    rights: 'HISTORICAL_RIGHTS_UNVERIFIED',
    clock: { mode: 'REAL_TIME', sourceStepSeconds: 86400, scenarioStepSeconds: 86400 },
    targetPeakGrowthPercent: input.targetPeakGrowthPercent,
    intrabar: historicalGrowthIntrabarFor(input.source.dataKind, input.intrabarVersion ?? 2),
    logs, logsSha256: sha256HexUtf8(JSON.stringify(logs)),
  };
  validateHistoricalGrowthProgram(program);
  return program;
}

/**
 * What a bot may observe at `now`: model prices of CLOSED days and of the
 * forming day up to now. Never the peak, the target, alpha, the scenario id
 * or any later value (a forming day's final high/low is not known yet).
 * Candles are aggregated from the same 10-second ticks as the simulation.
 * The model of a forming day is conditioned on that day's source bar
 * (a bridge between daily values): it is training data, not a market.
 */
export function historicalGrowthObservation(program: HistoricalGrowthProgram, initialPrice: string, seed: string, listingAt: number, now: number) {
  const alpha = historicalGrowthAlpha(program), cap = historicalGrowthCap(initialPrice, program.targetPeakGrowthPercent);
  const price = (v: number) => historicalGrowthPrice(program, Number(initialPrice), cap, v, alpha);
  const elapsed = Math.max(0, Math.floor((now - listingAt) / 10_000) * 10);
  const total = historicalGrowthElapsedSeconds(program);
  const seen = Math.min(elapsed, total);
  const closedDays = Math.floor(seen / HISTORICAL_GROWTH_DAY_SECONDS);
  const bridge = isHistoricalGrowthBridge(program);
  const candle = (fromSeconds: number, toSeconds: number) => {
    const open = historicalGrowthOpenLogAt(program, seed, fromSeconds);
    let high = open, low = open;
    if (bridge) {
      for (let at = fromSeconds + 10; at <= toSeconds; at += 10) { const v = historicalGrowthLogAt(program, seed, at); high = Math.max(high, v); low = Math.min(low, v); }
    } else {
      // Extremes of a piecewise log-linear path are at its vertices (every 8 h) or the ends.
      const marks = [toSeconds];
      for (let at = Math.ceil(fromSeconds / 28_800) * 28_800; at <= toSeconds; at += 28_800) marks.push(at);
      for (const v of marks.map(at => historicalGrowthLogAt(program, seed, at))) { high = Math.max(high, v); low = Math.min(low, v); }
    }
    return { open: price(open), high: price(high), low: price(low), close: price(historicalGrowthLogAt(program, seed, toSeconds)) };
  };
  const closed = Array.from({ length: closedDays }, (_, day) => ({ openTime: listingAt + day * DAY_MS, ...candle(day * HISTORICAL_GROWTH_DAY_SECONDS, (day + 1) * HISTORICAL_GROWTH_DAY_SECONDS) }));
  const formingFrom = closedDays * HISTORICAL_GROWTH_DAY_SECONDS;
  return {
    asOf: listingAt + seen * 1000,
    price: price(historicalGrowthLogAt(program, seed, seen)),
    closed,
    forming: seen > formingFrom ? { openTime: listingAt + formingFrom * 1000, ...candle(formingFrom, seen) } : null,
    finished: elapsed >= total,
  };
}

/**
 * Train / validation / test by SOURCE ASSET (never by random candles): every
 * window of one asset — on any timeframe or seed — lands in the same fold.
 */
export function historicalGrowthFold(asset: string): 'train' | 'validation' | 'test' {
  const bucket = parseInt(sha256HexUtf8('voltex.history20.fold.v1:' + asset).slice(0, 8), 16) % 10;
  return bucket < 6 ? 'train' : bucket < 8 ? 'validation' : 'test';
}
