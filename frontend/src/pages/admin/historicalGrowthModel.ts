/**
 * Browser copy of the historical GROWTH WINDOW model
 * (`voltex.historical-growth.v1`). The production frontend builds from
 * frontend/ alone; the server's reference is src/shared/listingHistoricalGrowth.ts
 * and validates again on save. Tests pin the two equal.
 *
 *   M = 1 + G/100,  alpha = ln(M) / ln(H/A),  P_model(t) = P0 · exp(alpha · ln(P_source(t)/A))
 *
 * Only ln(P_source/A) (integers, 1e-8) leaves the import: the source's
 * absolute prices and volume are discarded. REAL_TIME: one source day is one
 * scenario day. Pure: no IO, no network, no clock.
 */
import BigNumber from 'bignumber.js';
import type { ListingMovement } from './listingMovementModel';

export const HISTORICAL_GROWTH_FORMAT = 'voltex.historical-growth.v1' as const;
export const HISTORICAL_GROWTH_LOG_SCALE = 100_000_000;
export const HISTORICAL_GROWTH_MIN_PEAK_PERCENT = 7248;
export const HISTORICAL_GROWTH_MAX_PEAK_PERCENT = 15324;
export const HISTORICAL_GROWTH_DAY_SECONDS = 86_400;
export const HISTORICAL_GROWTH_PREVIEW_UNIT = 'SIMUSDT';
export const HISTORICAL_GROWTH_LABEL = 'Симуляция • обучение ботов • не реальный торговый актив';

export type HistoricalGrowthDataKind = 'daily_reference' | 'exchange_ohlcv';
/** Intraday model: v1 = straight-line baseline, v2 = seeded bridge (default). Daily source values are the same in both. */
export type HistoricalGrowthIntrabar = 'LOG_LINEAR_REFERENCE_V1' | 'SEEDED_OHLC_PATH_V1' | 'SEEDED_BRIDGE_REFERENCE_V2' | 'SEEDED_BRIDGE_OHLC_V2';
export function historicalGrowthIntrabarFor(kind: HistoricalGrowthDataKind, version: 1 | 2 = 2): HistoricalGrowthIntrabar {
  if (kind === 'exchange_ohlcv') return version === 1 ? 'SEEDED_OHLC_PATH_V1' : 'SEEDED_BRIDGE_OHLC_V2';
  return version === 1 ? 'LOG_LINEAR_REFERENCE_V1' : 'SEEDED_BRIDGE_REFERENCE_V2';
}
export const historicalGrowthIntrabarVersion = (program: Pick<HistoricalGrowthProgram, 'intrabar'>): 1 | 2 => program.intrabar.endsWith('_V1') ? 1 : 2;
/** The same stored window with another intraday model: the logs and their checksum do not change. */
export function historicalGrowthWithIntrabar(program: HistoricalGrowthProgram, version: 1 | 2): HistoricalGrowthProgram {
  const intrabar = historicalGrowthIntrabarFor(program.source.dataKind, version);
  return program.intrabar === intrabar ? program : { ...program, intrabar };
}
export interface HistoricalGrowthSource {
  provider: 'Coin Metrics' | 'Binance Vision';
  asset: string;
  quote: 'USD' | 'USDT';
  metric: 'PriceUSD' | 'spot daily OHLCV';
  dataKind: HistoricalGrowthDataKind;
  timeframe: '1d';
  firstDate: string;
  lastDate: string;
  sliceSha256: string;
  license: 'CC-BY-NC-4.0' | 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms';
}
export interface HistoricalGrowthProgram {
  format: typeof HISTORICAL_GROWTH_FORMAT;
  scenarioId: string;
  scenarioVersion: 1;
  source: HistoricalGrowthSource;
  rights: 'HISTORICAL_RIGHTS_UNVERIFIED';
  clock: { mode: 'REAL_TIME'; sourceStepSeconds: 86400; scenarioStepSeconds: 86400 };
  targetPeakGrowthPercent: string;
  intrabar: HistoricalGrowthIntrabar;
  logs: number[][];
  logsSha256: string;
}
export interface HistoricalGrowthSourceRow { date: string; open?: number; high?: number; low?: number; close: number }

const DAY_MS = HISTORICAL_GROWTH_DAY_SECONDS * 1000;
function dateMs(text: unknown): number {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  const at = Date.parse(text + 'T00:00:00.000Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === text ? at : NaN;
}

/** SHA-256 (FIPS 180-4) over UTF-8, synchronous: the same digest the server checks. */
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

/** Same rules as the server (validateHistoricalGrowthStructure + logs checksum); returns a message or null. */
export function historicalGrowthProblem(program: HistoricalGrowthProgram | undefined): string | null {
  if (!program || program.format !== HISTORICAL_GROWTH_FORMAT || program.scenarioVersion !== 1 || !/^VHX-\d{2}-[A-Z0-9]{2,10}$/.test(program.scenarioId)
      || program.rights !== 'HISTORICAL_RIGHTS_UNVERIFIED') return 'Неизвестный формат исторического окна роста';
  const s = program.source, ohlc = s?.dataKind === 'exchange_ohlcv';
  const known = s && ((s.dataKind === 'daily_reference' && s.provider === 'Coin Metrics' && s.quote === 'USD' && s.metric === 'PriceUSD' && s.license === 'CC-BY-NC-4.0')
    || (ohlc && s.provider === 'Binance Vision' && s.quote === 'USDT' && s.metric === 'spot daily OHLCV' && s.license === 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms'));
  if (!known || !/^[A-Z0-9]{2,10}$/.test(s.asset) || s.timeframe !== '1d' || !/^[a-f0-9]{64}$/.test(s.sliceSha256)) return 'Источник исторического окна описан не полностью';
  const c = program.clock;
  if (!c || c.mode !== 'REAL_TIME' || c.sourceStepSeconds !== 86400 || c.scenarioStepSeconds !== 86400) return 'Историческое окно работает только в реальном времени: сутки источника = сутки сценария';
  if (program.intrabar !== historicalGrowthIntrabarFor(s.dataKind, 1) && program.intrabar !== historicalGrowthIntrabarFor(s.dataKind, 2)) return 'Модель внутри суток не соответствует типу данных';
  const target = program.targetPeakGrowthPercent;
  if (!/^\d{4,5}(?:\.\d{1,2})?$/.test(target) || Number(target) < HISTORICAL_GROWTH_MIN_PEAK_PERCENT || Number(target) > HISTORICAL_GROWTH_MAX_PEAK_PERCENT)
    return 'Пик сценария должен быть от +7248% до +15324% от начальной цены';
  const rows = program.logs, width = ohlc ? 4 : 1;
  if (!Array.isArray(rows) || rows.length < 30 || rows.length > 1500) return 'Историческое окно: от 30 до 1500 суток источника';
  const first = dateMs(s.firstDate), last = dateMs(s.lastDate);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last - first !== (rows.length - 1) * DAY_MS) return 'Даты исторического окна не совпадают с числом суток: пропуски не допускаются';
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width || !row.every(v => Number.isSafeInteger(v) && Math.abs(v) <= 2_000_000_000)) return 'Неверные значения исторического окна';
    if (ohlc && (row[1] < Math.max(row[0], row[3]) || row[2] > Math.min(row[0], row[3]))) return 'Неверная свеча OHLC в историческом окне';
  }
  if (rows[0][0] !== 0) return 'Первое значение окна должно совпадать с опорной ценой';
  if (!(historicalGrowthMaxLog(program) > 0)) return 'Максимум окна должен быть выше первой цены';
  if (sha256HexUtf8(JSON.stringify(rows)) !== program.logsSha256) return 'Контрольная сумма исторического окна не совпадает';
  return null;
}

export function historicalGrowthMaxLog(program: Pick<HistoricalGrowthProgram, 'logs' | 'source'>): number {
  const ohlc = program.source.dataKind === 'exchange_ohlcv';
  let max = -Infinity;
  for (const row of program.logs) max = Math.max(max, ohlc ? row[1] : row[0]);
  return max;
}
export function historicalGrowthAlpha(program: Pick<HistoricalGrowthProgram, 'logs' | 'source' | 'targetPeakGrowthPercent'>): number {
  return Math.log(1 + Number(program.targetPeakGrowthPercent) / 100) / (historicalGrowthMaxLog(program) / HISTORICAL_GROWTH_LOG_SCALE);
}
/** Scenario days of the whole window in REAL_TIME (a reference has one sample per day boundary). */
export function historicalGrowthDays(program: Pick<HistoricalGrowthProgram, 'logs' | 'source'>): number {
  return program.source.dataKind === 'exchange_ohlcv' ? program.logs.length : program.logs.length - 1;
}
/** P0 · (1 + G/100), cut down to the asset step: the listing's maximum price. */
export function historicalGrowthMaxPrice(initialPrice: string, targetPeakGrowthPercent: string): string {
  const value = new BigNumber(initialPrice.trim().replace(',', '.')).times(new BigNumber(targetPeakGrowthPercent).dividedBy(100).plus(1));
  return value.isFinite() && value.isGreaterThan(0) ? value.decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() : '';
}

/** Model daily candles of the WHOLE window in listing units, by scenario day (the numbers the simulation reaches). */
export function historicalGrowthDailyModel(program: HistoricalGrowthProgram, initialPrice: string) {
  const p0 = Number(initialPrice), alpha = historicalGrowthAlpha(program), cap = Number(historicalGrowthMaxPrice(initialPrice, program.targetPeakGrowthPercent));
  const price = (v: number) => Math.min(cap, p0 * Math.exp(alpha * v / HISTORICAL_GROWTH_LOG_SCALE));
  const rows = program.logs;
  if (program.source.dataKind === 'exchange_ohlcv') return rows.map(([o, h, l, c], day) => ({ day, open: price(o), high: price(h), low: price(l), close: price(c) }));
  return rows.slice(1).map(([next], day) => {
    const open = rows[day][0];
    return { day, open: price(open), high: price(Math.max(open, next)), low: price(Math.min(open, next)), close: price(next) };
  });
}

/** Chart candles of the whole window (1 = daily, 7 = weekly groups of scenario days), from `listingAtMs`. */
export function historicalGrowthCandles(program: HistoricalGrowthProgram, initialPrice: string, listingAtMs: number, daysPerCandle = 7) {
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (const day of historicalGrowthDailyModel(program, initialPrice)) {
    if (day.day % daysPerCandle === 0) out.push({ time: (listingAtMs + day.day * DAY_MS) / 1000, open: day.open, high: day.high, low: day.low, close: day.close, volume: 0 });
    else { const last = out[out.length - 1]; last.high = Math.max(last.high, day.high); last.low = Math.min(last.low, day.low); last.close = day.close; }
  }
  return out;
}

/** Peak, final value and the largest close-to-close drawdown of the model, from P0. */
export function historicalGrowthSummary(program: HistoricalGrowthProgram, initialPrice: string) {
  const days = historicalGrowthDailyModel(program, initialPrice);
  let peak = 0, peakDay = 0, top = Number(initialPrice), drawdown = 0;
  for (const day of days) {
    if (day.high > peak) { peak = day.high; peakDay = day.day; }
    top = Math.max(top, day.close);
    drawdown = Math.max(drawdown, 1 - day.close / top);
  }
  return { peak, peakDay, last: days[days.length - 1]?.close ?? Number(initialPrice), maxCloseDrawdownPercent: drawdown * 100, alpha: historicalGrowthAlpha(program), days: historicalGrowthDays(program) };
}

/**
 * Strict CSV of the pack's source slice: `date,close` (reference) or
 * `date,open,high,low,close[,volume]` (OHLCV). The volume column is read
 * past and never kept.
 */
export function parseHistoricalGrowthCsv(text: string, dataKind: HistoricalGrowthDataKind): HistoricalGrowthSourceRow[] {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').trim().toLowerCase();
  const ohlc = dataKind === 'exchange_ohlcv';
  if (ohlc ? !/^date,open,high,low,close(,volume)?$/.test(header) : header !== 'date,close') throw new Error('Неожиданный заголовок исходного CSV');
  return lines.map((line, index) => {
    const parts = line.trim().split(',');
    if (parts.length !== (ohlc ? (header.endsWith(',volume') ? 6 : 5) : 2)) throw new Error(`Неверная строка исходного CSV ${index + 2}`);
    const number = (value: string) => { const v = Number(value); if (!/^\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(value.trim()) || !Number.isFinite(v)) throw new Error(`Неверное число в строке ${index + 2}`); return v; };
    return ohlc ? { date: parts[0], open: number(parts[1]), high: number(parts[2]), low: number(parts[3]), close: number(parts[4]) } : { date: parts[0], close: number(parts[1]) };
  });
}

/** Reject gaps, duplicates, non-positive/non-finite prices, invalid OHLC and H ≤ A; keep ln(P/A) only. */
export function buildHistoricalGrowthProgram(input: {
  scenarioId: string; source: Omit<HistoricalGrowthSource, 'firstDate' | 'lastDate'>; targetPeakGrowthPercent: string; rows: HistoricalGrowthSourceRow[];
  intrabarVersion?: 1 | 2;
}): HistoricalGrowthProgram {
  const rows = input.rows, ohlc = input.source.dataKind === 'exchange_ohlcv';
  if (!Array.isArray(rows) || rows.length < 30 || rows.length > 1500) throw new Error('Историческое окно: от 30 до 1500 суток источника');
  const start = dateMs(rows[0].date), anchor = ohlc ? rows[0].open : rows[0].close;
  if (!Number.isFinite(start) || !(typeof anchor === 'number' && anchor > 0 && Number.isFinite(anchor))) throw new Error('Неверная первая строка источника');
  const logs = rows.map((row, index) => {
    if (dateMs(row.date) !== start + index * DAY_MS) throw new Error(`Пропущенная или повторная дата источника: ${row.date}`);
    const values = ohlc ? [row.open, row.high, row.low, row.close] : [row.close];
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new Error(`Некорректная цена источника: ${row.date}`);
    if (ohlc && (row.high! < Math.max(row.open!, row.close) || row.low! > Math.min(row.open!, row.close))) throw new Error(`Некорректный OHLC источника: ${row.date}`);
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
  const problem = historicalGrowthProblem(program);
  if (problem) throw new Error(problem);
  return program;
}

/** Largest relative difference between this model (P0 = 1) and the pack's normalized_path. */
export function historicalGrowthParity(program: HistoricalGrowthProgram, normalizedPath: readonly Record<string, number | string>[]): number {
  if (normalizedPath.length !== program.logs.length) return Infinity;
  const alpha = historicalGrowthAlpha(program), fields = program.source.dataKind === 'exchange_ohlcv' ? ['open', 'high', 'low', 'close'] : ['close'];
  let worst = 0;
  program.logs.forEach((row, index) => {
    const step = normalizedPath[index];
    if (step.offset_seconds !== index * HISTORICAL_GROWTH_DAY_SECONDS) worst = Infinity;
    fields.forEach((field, column) => {
      const expected = Number(step[field]), model = Math.exp(alpha * row[column] / HISTORICAL_GROWTH_LOG_SCALE);
      worst = Math.max(worst, Number.isFinite(expected) && expected > 0 ? Math.abs(model - expected) / expected : Infinity);
    });
    for (const absent of ['open', 'high', 'low'].filter(field => !fields.includes(field))) if (absent in step) worst = Infinity;
  });
  return worst;
}

/** Train / validation / test by SOURCE ASSET (the same rule as the server): never by random candles. */
export function historicalGrowthFold(asset: string): 'train' | 'validation' | 'test' {
  const bucket = parseInt(sha256HexUtf8('voltex.history20.fold.v1:' + asset).slice(0, 8), 16) % 10;
  return bucket < 6 ? 'train' : bucket < 8 ? 'validation' : 'test';
}

/**
 * The scenario program for a growth window: the window replaces the stages,
 * no hourly continuation follows, the maximum price is exactly P0 · M. The
 * candle/pullback fields are kept for the schema and do not apply.
 */
export function historicalWindowMovement(base: ListingMovement, initialPrice: string, program: HistoricalGrowthProgram): ListingMovement {
  const { historical: _continuation, ...rest } = base;
  return { ...rest, growth: 'historical-window', historicalGrowth: program, stages: [], afterGrowth: 'range', first24hGainPercent: '0',
    maxPrice: historicalGrowthMaxPrice(initialPrice || '1', program.targetPeakGrowthPercent) };
}
