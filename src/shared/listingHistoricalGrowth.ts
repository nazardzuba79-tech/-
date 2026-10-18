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
 * chart shows never changes elapsed time. A daily reference is interpolated
 * log-linearly between samples (a model, no invented wicks). A daily OHLC
 * day follows open → first extreme (8 h) → second extreme (16 h) → close
 * (24 h); which extreme comes first is unknown in daily data and is drawn
 * from the listing seed (a model). After the last source value the price
 * stops; there is no automatic tail.
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
  intrabar: 'LOG_LINEAR_REFERENCE_V1' | 'SEEDED_OHLC_PATH_V1';
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

/**
 * ln(P/A)·1e8 of the model path at `seconds` after the listing (end-of-tick
 * convention: a tick at exactly the end of a day still belongs to it).
 */
export function historicalGrowthLogAt(program: HistoricalGrowthProgram, seed: string, seconds: number): number {
  const rows = program.logs;
  if (!(seconds > 0)) return rows[0][0];
  const day = Math.ceil(seconds / HISTORICAL_GROWTH_DAY_SECONDS) - 1;
  const into = seconds - day * HISTORICAL_GROWTH_DAY_SECONDS;
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
 * Model candles of the WHOLE window by scenario day (day d covers its 24 h
 * after the listing). OHLC days carry the source's O/H/L/C; a reference day
 * goes from one sample to the next, so its extremes are its ends — no
 * intraday wick is invented. The same numbers the simulation reaches.
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
    intrabar: ohlc ? 'SEEDED_OHLC_PATH_V1' : 'LOG_LINEAR_REFERENCE_V1',
    logs, logsSha256: sha256HexUtf8(JSON.stringify(logs)),
  };
  validateHistoricalGrowthProgram(program);
  return program;
}

/**
 * What a bot may observe at `now`: model prices of CLOSED days and of the
 * forming day up to now. Never the peak, the target, alpha, the scenario id
 * or any later value (a forming day's final high/low is not known yet).
 */
export function historicalGrowthObservation(program: HistoricalGrowthProgram, initialPrice: string, seed: string, listingAt: number, now: number) {
  const alpha = historicalGrowthAlpha(program), cap = historicalGrowthCap(initialPrice, program.targetPeakGrowthPercent);
  const price = (v: number) => historicalGrowthPrice(program, Number(initialPrice), cap, v, alpha);
  const elapsed = Math.max(0, Math.floor((now - listingAt) / 10_000) * 10);
  const total = historicalGrowthElapsedSeconds(program);
  const seen = Math.min(elapsed, total);
  const closedDays = Math.floor(seen / HISTORICAL_GROWTH_DAY_SECONDS);
  const candle = (fromSeconds: number, toSeconds: number) => {
    // Extremes of a piecewise log-linear path are at its vertices (every 8 h) or the ends.
    const marks = [fromSeconds, toSeconds];
    for (let at = Math.ceil(fromSeconds / 28_800) * 28_800; at <= toSeconds; at += 28_800) marks.push(at);
    const logs = marks.map(at => historicalGrowthLogAt(program, seed, at));
    return { open: price(historicalGrowthLogAt(program, seed, fromSeconds)), high: price(Math.max(...logs)), low: price(Math.min(...logs)), close: price(historicalGrowthLogAt(program, seed, toSeconds)) };
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
