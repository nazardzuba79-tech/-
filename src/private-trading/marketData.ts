import BigNumber from 'bignumber.js';
import { createHash } from 'crypto';
import { z } from 'zod';

/** Public data only. API instances MUST use the authenticated Frankfurt collector. */
export const PRIVATE_QUOTE_MAX_AGE_MS = 5_000;
export const PRIVATE_HISTORY_MAX_CANDLES = 50_000;
export const PRIVATE_HISTORY_MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
const FUTURE_SKEW_MS = 1_000;
const positive = z.string().max(80).regex(/^\d+(\.\d+)?$/).refine(v => new BigNumber(v).isFinite() && new BigNumber(v).gt(0));
const nonnegative = z.string().max(80).regex(/^\d+(\.\d+)?$/).refine(v => new BigNumber(v).isFinite() && new BigNumber(v).gte(0));
const signed = z.string().max(80).regex(/^-?\d+(\.\d+)?$/).refine(v => new BigNumber(v).isFinite());
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const symbolSchema = z.string().regex(/^[A-Z0-9]{1,32}USDT$/);
const levelSchema = z.object({ price: positive, quantity: positive });
export const privateInstrumentSchema = z.object({
  provider: z.literal('bybit'), symbol: symbolSchema, baseAsset: z.string().min(1).max(32),
  quoteAsset: z.literal('USDT'), settleAsset: z.literal('USDT'), contractType: z.literal('LinearPerpetual'),
  status: z.literal('Trading'), launchTime: timestamp, fetchedAt: timestamp,
  fundingIntervalMinutes: z.number().int().positive().max(1440),
  filters: z.object({ tickSize: positive, minPrice: positive, maxPrice: positive, qtyStep: positive,
    minOrderQty: positive, maxOrderQty: positive, maxMarketOrderQty: positive, minNotionalValue: nonnegative }),
  leverage: z.object({ min: positive, max: positive, step: positive }),
  riskTiers: z.array(z.object({ riskLimitValue: positive, maintenanceMarginRate: positive,
    initialMarginRate: positive, maintenanceDeduction: nonnegative, maxLeverage: positive })).min(1).max(200),
  parameterModel: z.literal('CURRENT_INSTRUMENT_PARAMETERS'), parameterVersion: z.string().min(1).max(100),
});
export type PrivateInstrument = z.infer<typeof privateInstrumentSchema>;
export const privateQuoteSchema = z.object({
  provider: z.literal('bybit'), symbol: symbolSchema,
  bids: z.array(levelSchema).min(1).max(1000), asks: z.array(levelSchema).min(1).max(1000),
  markPrice: positive, lastPrice: positive, fundingRate: signed, nextFundingTime: timestamp,
  providerTimestamp: timestamp, bookGeneratedAt: timestamp, markProviderTimestamp: timestamp, fetchedAt: timestamp,
});
export type PrivateFreshQuote = z.infer<typeof privateQuoteSchema>;
export interface PrivateCandle { timestamp: number; open: string; high: string; low: string; close: string }
export const PRIVATE_CHART_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
export type PrivateChartInterval = typeof PRIVATE_CHART_INTERVALS[number];
export interface PrivateChartRequest { symbol: string; interval: PrivateChartInterval; limit?: number; endTime?: number; signal?: AbortSignal }
export interface PrivateCandleSelection { symbol: string; source: 'BYBIT_LINEAR'; interval: PrivateChartInterval; openTime: number; pricePoint: 'OPEN' | 'CLOSE'; signal?: AbortSignal }
export interface ResolvedPrivateCandle {
  symbol: string; source: 'BYBIT_LINEAR'; interval: PrivateChartInterval; intervalMs: number; openTime: number; closeTime: number;
  effectiveAt: number; price: string; pricePoint: 'OPEN' | 'CLOSE'; candle: PrivateCandle & { volume: string }; fetchedAt: number; verification: 'VERIFIED';
}
const chartIntervals: Record<PrivateChartInterval, { wire: string; milliseconds: number; offset: number }> = {
  '1m': { wire: '1', milliseconds: 60_000, offset: 0 }, '5m': { wire: '5', milliseconds: 300_000, offset: 0 },
  '15m': { wire: '15', milliseconds: 900_000, offset: 0 }, '1h': { wire: '60', milliseconds: 3_600_000, offset: 0 },
  '4h': { wire: '240', milliseconds: 14_400_000, offset: 0 }, '1d': { wire: 'D', milliseconds: 86_400_000, offset: 0 },
  // Bybit weekly bars start Monday 00:00 UTC, four days after the Unix epoch Thursday.
  '1w': { wire: 'W', milliseconds: 604_800_000, offset: 345_600_000 },
};
export function privateChartIntervalMs(interval: PrivateChartInterval): number {
  if (!Object.prototype.hasOwnProperty.call(chartIntervals, interval)) throw new PrivateMarketDataError('invalid_chart_interval', 400);
  return chartIntervals[interval].milliseconds;
}
export interface PrivateFundingEvent { timestamp: number; rate: string; markPrice: string }
export interface PrivateHistoricalData {
  symbol: string; tradeCandles: PrivateCandle[]; markCandles: PrivateCandle[];
  fundingEvents: PrivateFundingEvent[]; expectedFundingTimestamps: number[];
  intervalMs: number; complete: boolean; issues: string[]; fetchedAt: number;
  fundingScheduleModel: 'CURRENT_INTERVAL_GRID_V1'; instrument: PrivateInstrument;
}
export interface PrivateHistoryRequest {
  symbol: string; startTime: number; endTime: number; intervalMinutes?: 1 | 5 | 15 | 60;
  signal?: AbortSignal; onProgress?: (progress: { stage: 'trade' | 'mark' | 'funding'; pages: number; rows: number }) => void;
}
const candleSchema = z.object({ timestamp, open: positive, high: positive, low: positive, close: positive }).refine(c =>
  new BigNumber(c.high).gte(c.low) && new BigNumber(c.high).gte(c.open) && new BigNumber(c.high).gte(c.close)
  && new BigNumber(c.low).lte(c.open) && new BigNumber(c.low).lte(c.close), 'Inconsistent OHLC');
const chartCandleSchema = z.object({ timestamp, open: positive, high: positive, low: positive, close: positive, volume: nonnegative })
  .refine(c => candleSchema.safeParse(c).success, 'Inconsistent OHLC');
const chartPageSchema = z.object({ source: z.literal('BYBIT_LINEAR'), symbol: symbolSchema, interval: z.enum(PRIVATE_CHART_INTERVALS),
  candles: z.array(chartCandleSchema).max(1000), fetchedAt: timestamp, providerTimestamp: timestamp });
type PrivateChartPage = z.infer<typeof chartPageSchema>;
const fundingSchema = z.object({ timestamp, rate: signed });
const candlePageSchema = z.object({ symbol: symbolSchema, candles: z.array(candleSchema).max(1000), fetchedAt: timestamp });
const fundingPageSchema = z.object({ symbol: symbolSchema, events: z.array(fundingSchema).max(200), fetchedAt: timestamp });
export class PrivateMarketDataError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); this.name = 'PrivateMarketDataError'; }
}
function invalid(): never { throw new PrivateMarketDataError('market_data_invalid'); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new PrivateMarketDataError('request_cancelled', 499); }
function decimal(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return invalid();
  const d = new BigNumber(value); if (!d.isFinite()) return invalid(); return d.toFixed();
}
function read<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); return parsed.success ? parsed.data : invalid(); }
function symbol(value: string): string {
  const normalized = value.replace(/[-/]USDT$/, 'USDT');
  if (!symbolSchema.safeParse(normalized).success) throw new PrivateMarketDataError('invalid_symbol', 400);
  return normalized;
}
function time(value: unknown): number { const parsed = Number(value); return read(timestamp, parsed); }
function chartRequest(request: PrivateChartRequest, now: number, maxLimit: number) {
  const contract = symbol(request.symbol), intervalMs = privateChartIntervalMs(request.interval), limit = request.limit ?? 520;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit || (request.endTime !== undefined
    && (!Number.isSafeInteger(request.endTime) || request.endTime <= 0 || request.endTime > now))) throw new PrivateMarketDataError('invalid_chart_range', 400);
  return { contract, intervalMs, limit, end: request.endTime ?? now };
}
function checkedChartPage(value: unknown, request: PrivateChartRequest, now: number): PrivateChartPage {
  const { contract, intervalMs, limit, end } = chartRequest(request, now, 1000), page = read(chartPageSchema, value);
  if (page.symbol !== contract || page.interval !== request.interval || page.candles.length > limit || page.fetchedAt > now + FUTURE_SKEW_MS || page.providerTimestamp > now + FUTURE_SKEW_MS) return invalid();
  const seen = new Set<number>(), offset = chartIntervals[request.interval].offset;
  for (const candle of page.candles) {
    if (candle.timestamp > end || candle.timestamp > page.providerTimestamp || (candle.timestamp - offset) % intervalMs !== 0 || seen.has(candle.timestamp)) return invalid();
    seen.add(candle.timestamp);
  }
  page.candles.sort((a, b) => a.timestamp - b.timestamp);
  return page;
}
function chartCacheKey(request: PrivateChartRequest): string { return `${symbol(request.symbol)}:${request.interval}:${request.limit ?? 520}:${request.endTime ?? 'latest'}`; }
function chartCacheTtl(page: PrivateChartPage): number {
  const step = privateChartIntervalMs(page.interval);
  return page.candles.length && page.candles.every(c => c.timestamp + step <= page.providerTimestamp) ? 15 * 60_000 : 2_000;
}
function fresh(value: number, now: number, maxAge = PRIVATE_QUOTE_MAX_AGE_MS): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= now + FUTURE_SKEW_MS && now - value <= maxAge;
}
/** Repeat immediately inside the transaction before committing a simulated fill. */
export function assertPrivateFreshQuote(value: unknown, expectedSymbol: string, now = Date.now()): PrivateFreshQuote {
  const quote = read(privateQuoteSchema, value);
  if (quote.symbol !== symbol(expectedSymbol)) return invalid();
  if (![quote.providerTimestamp, quote.bookGeneratedAt, quote.markProviderTimestamp, quote.fetchedAt].every(t => fresh(t, now))) {
    throw new PrivateMarketDataError('quote_stale');
  }
  for (const [levels, ascending] of [[quote.bids, false], [quote.asks, true]] as const) {
    for (let i = 1; i < levels.length; i++) {
      const comparison = new BigNumber(levels[i].price).comparedTo(levels[i - 1].price);
      if (ascending ? comparison !== 1 : comparison !== -1) return invalid();
    }
  }
  if (new BigNumber(quote.bids[0].price).gte(quote.asks[0].price)) return invalid();
  return quote;
}

/** Fixed allowlisted upstream endpoints, only instantiated by the collector. */
export class CollectorPrivateTradingSource {
  private instruments = new Map<string, { at: number; value: PrivateInstrument }>();
  private historyPages = new Map<string, { at: number; value: unknown }>();
  private chartPages = new Map<string, { at: number; ttl: number; value: PrivateChartPage }>();
  private active = 0;
  constructor(private request: typeof fetch = fetch, private now: () => number = Date.now) {}
  private async get(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<any> {
    abort(signal);
    const url = `https://api.bybit.com/v5/market/${path}?${new URLSearchParams({ category: 'linear', ...query })}`;
    // Cache only settled historical pages; never live quotes or forming candles.
    const finalAt = Number(query.end ?? query.endTime);
    const cacheable = ['kline', 'mark-price-kline', 'funding/history'].includes(path)
      && Number.isFinite(finalAt) && finalAt + Number(query.interval || 1) * 60_000 < this.now() - 60_000;
    const cached = cacheable ? this.historyPages.get(url) : undefined;
    if (cached && this.now() - cached.at < 15 * 60_000) return structuredClone(cached.value);
    if (this.active >= 8) throw new PrivateMarketDataError('market_data_busy', 429);
    this.active++;
    try {
      const response = await this.request(url, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000), redirect: 'error',
      });
      if (!response.ok) throw new PrivateMarketDataError('provider_unavailable');
      const data: any = await response.json(); abort(signal);
      if (data?.retCode !== 0 || !data.result || (data.result.category && data.result.category !== 'linear')) return invalid();
      if (cacheable && Array.isArray(data.result.list) && data.result.list.length && data.result.list.length <= 1000) {
        if (this.historyPages.size >= 64) this.historyPages.delete(this.historyPages.keys().next().value!);
        this.historyPages.set(url, { at: this.now(), value: data });
      }
      return data;
    } finally { this.active--; }
  }
  async instrument(input: string, signal?: AbortSignal): Promise<PrivateInstrument> {
    const contract = symbol(input); abort(signal);
    const cached = this.instruments.get(contract);
    if (cached && this.now() - cached.at < 60_000) return structuredClone(cached.value);
    const data = await this.get('instruments-info', { symbol: contract }, signal);
    if (data.result.category !== 'linear' || !Array.isArray(data.result.list) || data.result.list.length !== 1) return invalid();
    const item = data.result.list[0];
    if (item.symbol !== contract || item.contractType !== 'LinearPerpetual' || item.status !== 'Trading'
      || item.quoteCoin !== 'USDT' || item.settleCoin !== 'USDT' || item.isPreListing === true) return invalid();
    const rawTiers: any[] = []; let cursor = ''; const cursors = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const risk = await this.get('risk-limit', { symbol: contract, ...(cursor ? { cursor } : {}) }, signal);
      if (risk.result.category !== 'linear' || !Array.isArray(risk.result.list) || !risk.result.list.length || risk.result.list.length > 200) return invalid();
      for (const row of risk.result.list) { if (row.symbol !== contract) return invalid(); rawTiers.push(row); }
      cursor = risk.result.nextPageCursor || '';
      if (!cursor) break;
      if (typeof cursor !== 'string' || cursor.length > 1024 || cursors.has(cursor) || page === 9) return invalid();
      cursors.add(cursor);
    }
    rawTiers.sort((a, b) => new BigNumber(decimal(a.riskLimitValue)).comparedTo(decimal(b.riskLimitValue)) ?? 0);
    const parameters = {
      filters: { tickSize: item.priceFilter?.tickSize, minPrice: item.priceFilter?.minPrice, maxPrice: item.priceFilter?.maxPrice,
        qtyStep: item.lotSizeFilter?.qtyStep, minOrderQty: item.lotSizeFilter?.minOrderQty,
        maxOrderQty: item.lotSizeFilter?.maxOrderQty, maxMarketOrderQty: item.lotSizeFilter?.maxMktOrderQty,
        minNotionalValue: item.lotSizeFilter?.minNotionalValue },
      leverage: { min: item.leverageFilter?.minLeverage, max: item.leverageFilter?.maxLeverage, step: item.leverageFilter?.leverageStep },
      riskTiers: rawTiers.map((t, index) => ({ riskLimitValue: decimal(t.riskLimitValue), maintenanceMarginRate: decimal(t.maintenanceMargin),
        // Bybit documents an empty deduction for the explicitly flagged lowest tier.
        // There is no lower tier to deduct; absent/non-numeric higher-tier values still fail closed.
        initialMarginRate: decimal(t.initialMargin), maintenanceDeduction: t.mmDeduction === '' && index === 0 && t.isLowestRisk === 1 ? '0' : decimal(t.mmDeduction),
        maxLeverage: decimal(t.maxLeverage) })),
    };
    const value = read(privateInstrumentSchema, { provider: 'bybit', symbol: contract, baseAsset: item.baseCoin,
      quoteAsset: item.quoteCoin, settleAsset: item.settleCoin, status: item.status, contractType: item.contractType,
      launchTime: time(item.launchTime), fundingIntervalMinutes: item.fundingInterval, fetchedAt: this.now(), ...parameters,
      parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: `bybit-current-${createHash('sha256').update(JSON.stringify(parameters)).digest('hex').slice(0, 20)}` });
    for (let i = 1; i < value.riskTiers.length; i++) if (new BigNumber(value.riskTiers[i].riskLimitValue).lte(value.riskTiers[i - 1].riskLimitValue)) return invalid();
    if (this.instruments.size >= 64) this.instruments.delete(this.instruments.keys().next().value!);
    this.instruments.set(contract, { at: this.now(), value }); return structuredClone(value);
  }
  async freshQuote(input: string, signal?: AbortSignal): Promise<PrivateFreshQuote> {
    const contract = symbol(input);
    // Selected-contract REST snapshots; never use the 60-second catalogue ticker cache.
    const [book, ticker] = await Promise.all([
      this.get('orderbook', { symbol: contract, limit: '1000' }, signal),
      this.get('tickers', { symbol: contract }, signal),
    ]);
    if (book.result.s !== contract || ticker.result.category !== 'linear' || !Array.isArray(ticker.result.list) || ticker.result.list.length !== 1 || ticker.result.list[0].symbol !== contract) return invalid();
    const quote = ticker.result.list[0];
    const levels = (rows: unknown) => {
      if (!Array.isArray(rows)) return invalid();
      return rows.map(row => { if (!Array.isArray(row) || row.length !== 2) return invalid(); return { price: row[0], quantity: row[1] }; });
    };
    return assertPrivateFreshQuote({ provider: 'bybit', symbol: contract, bids: levels(book.result.b), asks: levels(book.result.a),
      markPrice: quote.markPrice, lastPrice: quote.lastPrice, fundingRate: quote.fundingRate, nextFundingTime: time(quote.nextFundingTime),
      providerTimestamp: time(book.result.cts), bookGeneratedAt: time(book.result.ts), markProviderTimestamp: time(ticker.time), fetchedAt: this.now() }, contract, this.now());
  }
  async chartCandles(request: PrivateChartRequest): Promise<PrivateChartPage> {
    abort(request.signal);
    const { contract, limit } = chartRequest(request, this.now(), 1000), key = chartCacheKey(request), cached = this.chartPages.get(key);
    if (cached && this.now() - cached.at < cached.ttl) return structuredClone(cached.value);
    await this.instrument(contract, request.signal);
    const data = await this.get('kline', { symbol: contract, interval: chartIntervals[request.interval].wire, limit: String(limit),
      ...(request.endTime === undefined ? {} : { end: String(request.endTime) }) }, request.signal);
    if (data.result.category !== 'linear' || data.result.symbol !== contract || !Array.isArray(data.result.list)) return invalid();
    const page = checkedChartPage({ source: 'BYBIT_LINEAR', symbol: contract, interval: request.interval, fetchedAt: this.now(), providerTimestamp: time(data.time),
      candles: data.result.list.map((row: unknown) => {
        if (!Array.isArray(row) || row.length < 6) return invalid();
        return { timestamp: time(row[0]), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] };
      }) }, request, this.now());
    abort(request.signal);
    if (this.chartPages.size >= 64) this.chartPages.delete(this.chartPages.keys().next().value!);
    this.chartPages.set(key, { at: this.now(), ttl: request.endTime === undefined ? 2_000 : chartCacheTtl(page), value: page });
    return structuredClone(page);
  }
  async candles(input: string, kind: 'trade' | 'mark', intervalMinutes: number, startTime: number, endTime: number, signal?: AbortSignal) {
    const contract = symbol(input); validatePageRange(intervalMinutes, startTime, endTime, this.now());
    const data = await this.get(kind === 'trade' ? 'kline' : 'mark-price-kline', {
      symbol: contract, interval: String(intervalMinutes), start: String(startTime), end: String(endTime), limit: '1000',
    }, signal);
    if (data.result.symbol !== contract || data.result.category !== 'linear' || !Array.isArray(data.result.list)) return invalid();
    const value = read(candlePageSchema, { symbol: contract, fetchedAt: this.now(), candles: data.result.list.map((row: unknown) => {
      if (!Array.isArray(row) || row.length < 5) return invalid();
      return { timestamp: time(row[0]), open: row[1], high: row[2], low: row[3], close: row[4] };
    }) });
    if (value.candles.some(c => c.timestamp < startTime || c.timestamp > endTime || c.timestamp % (intervalMinutes * 60_000) !== 0)) return invalid();
    return value;
  }
  async funding(input: string, startTime: number, endTime: number, signal?: AbortSignal) {
    const contract = symbol(input); validateFundingRange(startTime, endTime, this.now());
    const data = await this.get('funding/history', { symbol: contract, startTime: String(startTime), endTime: String(endTime), limit: '200' }, signal);
    if (data.result.category !== 'linear' || !Array.isArray(data.result.list)) return invalid();
    const value = read(fundingPageSchema, { symbol: contract, fetchedAt: this.now(), events: data.result.list.map((row: any) => {
      if (row.symbol !== contract) return invalid(); return { timestamp: time(row.fundingRateTimestamp), rate: row.fundingRate };
    }) });
    if (value.events.some(e => e.timestamp < startTime || e.timestamp > endTime)) return invalid();
    return value;
  }
}
function validateFundingRange(startTime: number, endTime: number, now: number): void {
  if (![startTime, endTime].every(t => Number.isSafeInteger(t) && t > 0) || startTime > endTime
    || endTime > now || endTime - startTime > PRIVATE_HISTORY_MAX_RANGE_MS) throw new PrivateMarketDataError('invalid_history_range', 400);
}
function validatePageRange(interval: number, startTime: number, endTime: number, now: number): void {
  validateFundingRange(startTime, endTime, now);
  if (![1, 5, 15, 60].includes(interval) || endTime - startTime >= 1000 * interval * 60_000) throw new PrivateMarketDataError('invalid_candle_page', 400);
}

export class PrivateTradingMarketData {
  private historyActive = false;
  private chartActive = 0;
  private chartPages = new Map<string, { at: number; ttl: number; value: PrivateChartPage }>();
  private readonly origin: string;
  private readonly token: string;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  constructor(options: { collector: { url: string; token: string }; request?: typeof fetch; now?: () => number }) {
    const collector = options.collector; let url: URL;
    try { url = new URL(collector.url); } catch { throw new PrivateMarketDataError('collector_unconfigured'); }
    if (!collector.token.trim() || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new PrivateMarketDataError('collector_unconfigured');
    this.origin = url.origin; this.token = collector.token; this.request = options.request ?? fetch; this.now = options.now ?? Date.now;
  }
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    abort(signal);
    const response = await this.request(`${this.origin}/internal/v1/private-trading/${path}`, {
      headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new PrivateMarketDataError('collector_unavailable');
    const value: unknown = await response.json(); abort(signal); return value;
  }
  async instrument(input: string, signal?: AbortSignal): Promise<PrivateInstrument> {
    const contract = symbol(input), instrument = read(privateInstrumentSchema, await this.get(`instruments/${contract}`, signal));
    if (instrument.symbol !== contract || !fresh(instrument.fetchedAt, this.now(), 65_000)) return invalid(); return instrument;
  }
  async freshQuote(input: string, signal?: AbortSignal): Promise<PrivateFreshQuote> {
    const contract = symbol(input);
    return assertPrivateFreshQuote(await this.get(`quote/${contract}`, signal), contract, this.now());
  }
  private async chartPage(request: PrivateChartRequest): Promise<PrivateChartPage> {
    abort(request.signal);
    const { contract, limit } = chartRequest(request, this.now(), 1000), key = chartCacheKey(request), cached = this.chartPages.get(key);
    if (cached && this.now() - cached.at < cached.ttl) return structuredClone(cached.value);
    if (this.chartActive >= 4) throw new PrivateMarketDataError('chart_busy', 429);
    this.chartActive++;
    try {
      const query = new URLSearchParams({ interval: request.interval, limit: String(limit), ...(request.endTime === undefined ? {} : { endTime: String(request.endTime) }) });
      const page = checkedChartPage(await this.get(`chart-candles/${contract}?${query}`, request.signal), request, this.now());
      abort(request.signal);
      if (this.chartPages.size >= 64) this.chartPages.delete(this.chartPages.keys().next().value!);
      this.chartPages.set(key, { at: this.now(), ttl: request.endTime === undefined ? 2_000 : chartCacheTtl(page), value: page });
      return structuredClone(page);
    } finally { this.chartActive--; }
  }
  async chartCandles(request: PrivateChartRequest): Promise<{
    source: 'BYBIT_LINEAR'; symbol: string; interval: PrivateChartInterval;
    candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  }> {
    abort(request.signal);
    const { contract, limit } = chartRequest(request, this.now(), 1500), candles = new Map<number, PrivateCandle & { volume: string }>();
    let endTime = request.endTime;
    for (let pageIndex = 0; pageIndex < 2 && candles.size < limit; pageIndex++) {
      const pageLimit = Math.min(1000, limit - candles.size);
      const page = await this.chartPage({ ...request, symbol: contract, limit: pageLimit, endTime });
      for (const candle of page.candles) { if (candles.has(candle.timestamp)) return invalid(); candles.set(candle.timestamp, candle); }
      if (page.candles.length < pageLimit) break;
      endTime = page.candles[0].timestamp - 1;
      if (endTime <= 0) break;
    }
    const numeric = (value: string) => { const result = Number(value); if (!Number.isFinite(result)) return invalid(); return result; };
    return { source: 'BYBIT_LINEAR', symbol: contract, interval: request.interval,
      candles: [...candles.values()].sort((a, b) => a.timestamp - b.timestamp).map(c => ({ time: c.timestamp / 1000,
        open: numeric(c.open), high: numeric(c.high), low: numeric(c.low), close: numeric(c.close), volume: numeric(c.volume) })) };
  }
  async resolveCandle(selection: PrivateCandleSelection): Promise<ResolvedPrivateCandle> {
    abort(selection.signal);
    const parsed = z.object({ symbol: symbolSchema, source: z.literal('BYBIT_LINEAR'), interval: z.enum(PRIVATE_CHART_INTERVALS), openTime: timestamp, pricePoint: z.enum(['OPEN', 'CLOSE']) })
      .safeParse({ ...selection, symbol: symbol(selection.symbol) });
    if (!parsed.success) throw new PrivateMarketDataError('invalid_candle_selection', 400);
    const value = parsed.data, intervalMs = privateChartIntervalMs(value.interval), closeTime = value.openTime + intervalMs;
    if ((value.openTime - chartIntervals[value.interval].offset) % intervalMs !== 0 || !Number.isSafeInteger(closeTime)) throw new PrivateMarketDataError('invalid_candle_alignment', 400);
    if (closeTime > this.now()) throw new PrivateMarketDataError('candle_not_closed', 409);
    const instrument = await this.instrument(value.symbol, selection.signal);
    if (value.openTime < instrument.launchTime) throw new PrivateMarketDataError('contract_not_launched', 400);
    const page = await this.chartPage({ symbol: value.symbol, interval: value.interval, limit: 1, endTime: closeTime - 1, signal: selection.signal });
    const candle = page.candles.find(c => c.timestamp === value.openTime);
    if (!candle) throw new PrivateMarketDataError('selected_candle_missing', 409);
    if (closeTime > page.providerTimestamp) throw new PrivateMarketDataError('candle_not_closed', 409);
    abort(selection.signal);
    return { ...value, intervalMs, closeTime, effectiveAt: value.pricePoint === 'OPEN' ? value.openTime : closeTime,
      price: value.pricePoint === 'OPEN' ? candle.open : candle.close, candle: structuredClone(candle), fetchedAt: page.fetchedAt, verification: 'VERIFIED' };
  }
  /** Settled funding only. Mark candle open is the versioned simulation valuation rule. */
  async funding(input: string, startTime: number, endTime: number, signal?: AbortSignal): Promise<{
    events: PrivateFundingEvent[]; expectedFundingTimestamps: number[]; complete: boolean; issues: string[];
    fundingScheduleModel: 'CURRENT_INTERVAL_GRID_V1';
  }> {
    const contract = symbol(input); validateFundingRange(startTime, endTime, this.now()); abort(signal);
    const instrument = await this.instrument(contract, signal), events = new Map<number, { timestamp: number; rate: string }>();
    let end = endTime, pageCount = 0; const issues: string[] = [];
    for (; pageCount < 100 && end >= startTime; pageCount++) {
      const page = read(fundingPageSchema, await this.get(`funding/${contract}?${new URLSearchParams({ startTime: String(startTime), endTime: String(end) })}`, signal));
      if (page.symbol !== contract) return invalid();
      for (const event of page.events) {
        if (event.timestamp < startTime || event.timestamp > end || events.has(event.timestamp)) return invalid();
        events.set(event.timestamp, event);
      }
      if (page.events.length < 200) break;
      const oldest = Math.min(...page.events.map(event => event.timestamp));
      if (oldest <= startTime) break; end = oldest - 1;
    }
    if (pageCount === 100) issues.push('funding_page_limit');
    const expectedFundingTimestamps: number[] = [], interval = instrument.fundingIntervalMinutes * 60_000;
    for (let ts = Math.ceil(startTime / interval) * interval; ts <= endTime; ts += interval) {
      expectedFundingTimestamps.push(ts); if (!events.has(ts)) issues.push('funding_history_gap');
    }
    const sorted = [...events.values()].sort((a, b) => a.timestamp - b.timestamp);
    const fundingEvents: PrivateFundingEvent[] = [];
    if (sorted.length) {
      // Use the coarsest grid whose actual opens coincide with every funding timestamp.
      // No interpolation and no valuation at a different timestamp.
      const minutes = [60, 15, 5, 1].find(m => sorted.every(event => event.timestamp % (m * 60_000) === 0));
      if (!minutes) issues.push('funding_mark_missing');
      else {
        const step = minutes * 60_000, first = sorted[0].timestamp, last = sorted[sorted.length - 1].timestamp;
        if ((last - first) / step > PRIVATE_HISTORY_MAX_CANDLES) throw new PrivateMarketDataError('funding_range_too_large', 400);
        const marks = new Map<number, PrivateCandle>();
        for (let from = first; from <= last; from += 1000 * step) {
          const to = Math.min(last, from + 1000 * step - 1);
          const page = read(candlePageSchema, await this.get(`candles/${contract}?${new URLSearchParams({ kind: 'mark', intervalMinutes: String(minutes), startTime: String(from), endTime: String(to) })}`, signal));
          if (page.symbol !== contract) return invalid();
          for (const candle of page.candles) {
            if (candle.timestamp < from || candle.timestamp > to || candle.timestamp % step !== 0 || marks.has(candle.timestamp)) return invalid();
            marks.set(candle.timestamp, candle);
          }
        }
        for (const event of sorted) {
          const candle = marks.get(event.timestamp);
          if (!candle) issues.push('funding_mark_missing');
          else fundingEvents.push({ ...event, markPrice: candle.open });
        }
      }
    }
    return { events: fundingEvents, expectedFundingTimestamps, complete: !issues.length, issues: [...new Set(issues)], fundingScheduleModel: 'CURRENT_INTERVAL_GRID_V1' };
  }
  async history(request: PrivateHistoryRequest): Promise<PrivateHistoricalData> {
    abort(request.signal);
    if (this.historyActive) throw new PrivateMarketDataError('history_busy', 409);
    const contract = symbol(request.symbol), intervalMs = (request.intervalMinutes ?? 1) * 60_000;
    validateFundingRange(request.startTime, request.endTime, this.now());
    if (![60_000, 300_000, 900_000, 3_600_000].includes(intervalMs) || request.endTime <= request.startTime
      || request.startTime % intervalMs !== 0 || request.endTime % intervalMs !== 0
      || (request.endTime - request.startTime) / intervalMs > PRIVATE_HISTORY_MAX_CANDLES) throw new PrivateMarketDataError('invalid_history_range', 400);
    this.historyActive = true;
    try {
      const instrument = await this.instrument(contract, request.signal);
      if (request.startTime < instrument.launchTime) throw new PrivateMarketDataError('contract_not_launched', 400);
      const issues: string[] = [];
      const loadCandles = async (kind: 'trade' | 'mark'): Promise<PrivateCandle[]> => {
        const candles = new Map<number, PrivateCandle>(); let pages = 0;
        for (let start = request.startTime; start < request.endTime; start += 1000 * intervalMs) {
          abort(request.signal);
          const end = Math.min(request.endTime - 1, start + 1000 * intervalMs - 1);
          const page = read(candlePageSchema, await this.get(`candles/${contract}?${new URLSearchParams({ kind, intervalMinutes: String(intervalMs / 60_000), startTime: String(start), endTime: String(end) })}`, request.signal));
          if (page.symbol !== contract) return invalid();
          for (const candle of page.candles) {
            if (candle.timestamp < start || candle.timestamp > end || candle.timestamp % intervalMs !== 0 || candles.has(candle.timestamp)) return invalid();
            candles.set(candle.timestamp, candle);
          }
          request.onProgress?.({ stage: kind, pages: ++pages, rows: candles.size });
        }
        const expected = (request.endTime - request.startTime) / intervalMs;
        if (candles.size !== expected) issues.push(`${kind}_history_gap`);
        return [...candles.values()].sort((a, b) => a.timestamp - b.timestamp);
      };
      // Sequential pages cap collector pressure; cancellation propagates through every request.
      const tradeCandles = await loadCandles('trade'), markCandles = await loadCandles('mark');
      const funding = new Map<number, { timestamp: number; rate: string }>(); let end = request.endTime - 1, pages = 0;
      for (; pages < 100 && end >= request.startTime; pages++) {
        const page = read(fundingPageSchema, await this.get(`funding/${contract}?${new URLSearchParams({ startTime: String(request.startTime), endTime: String(end) })}`, request.signal));
        if (page.symbol !== contract) return invalid();
        for (const event of page.events) {
          if (event.timestamp < request.startTime || event.timestamp > end || funding.has(event.timestamp)) return invalid();
          funding.set(event.timestamp, event);
        }
        request.onProgress?.({ stage: 'funding', pages: pages + 1, rows: funding.size });
        if (page.events.length < 200) break;
        const oldest = Math.min(...page.events.map(event => event.timestamp));
        if (oldest <= request.startTime) break; end = oldest - 1;
      }
      if (pages === 100) issues.push('funding_page_limit');
      const fundingIntervalMs = instrument.fundingIntervalMinutes * 60_000;
      const expectedFundingTimestamps: number[] = [];
      for (let ts = Math.ceil(request.startTime / fundingIntervalMs) * fundingIntervalMs; ts < request.endTime; ts += fundingIntervalMs) {
        expectedFundingTimestamps.push(ts); if (!funding.has(ts)) issues.push('funding_history_gap');
      }
      const marks = new Map(markCandles.map(candle => [candle.timestamp, candle]));
      const fundingEvents: PrivateFundingEvent[] = [];
      for (const event of [...funding.values()].sort((a, b) => a.timestamp - b.timestamp)) {
        const mark = marks.get(event.timestamp);
        if (!mark) { issues.push('funding_mark_missing'); continue; }
        fundingEvents.push({ ...event, markPrice: mark.open });
      }
      return { symbol: contract, tradeCandles, markCandles, fundingEvents, expectedFundingTimestamps, intervalMs,
        complete: issues.length === 0, issues: [...new Set(issues)], instrument, fetchedAt: this.now(), fundingScheduleModel: 'CURRENT_INTERVAL_GRID_V1' };
    } finally { this.historyActive = false; }
  }
}
