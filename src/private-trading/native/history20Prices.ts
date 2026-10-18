import BigNumber from 'bignumber.js';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { listingSimulationConfig, parseListingConfig, type ListingConfig } from '../../services/listings/listingConfig';
import { ListingStoreError, type AdminListing, type ListingStore } from '../../services/listings/store';
import { aggregateCandles, simulationFor, MINUTE_MS, TICK_MS, HOUR_MS, SIM_INTERVALS, SIM_INTERVAL_OFFSETS, CANDLE_MS,
  type TestMarketSimulation } from '../../services/testMarkets/testMarketSimulation';
import { PRIVATE_HISTORY_MAX_CANDLES, PrivateMarketDataError, privateChartIntervalMs, type PrivateCandle, type PrivateChartRequest, type PrivateHistoricalData,
  type PrivateHistoryRequest, type PrivateInstrument, type PrivateMark, type PrivateModelInstrument, type PrivateTradingMarketData } from '../marketData';
import { HISTORY20_CONTRACT_SUFFIX } from './history20Contract';
export { HISTORY20_CONTRACT_SUFFIX, isHistory20Contract } from './history20Contract';

/**
 * HISTORY20 AS THE PRICE PATH OF A PRIVATE MODEL CONTRACT IN THE NATIVE
 * FUTURES TEST ACCOUNT. A History20 growth window (Admin → Listings draft,
 * `HISTORICAL_RIGHTS_UNVERIFIED`, never published) is selected through the
 * listing store Render already reads, PINNED by the server (listing id,
 * draft revision, logs checksum, start and model version), and its model
 * price is served to the native demo engine through the reads the existing
 * HISTORICAL_DEMO contract uses: `historicalDemoPrices`, `marks` and closed
 * `history` bars, plus the chart. Orders, fills, margin, fees, funding and
 * the journal stay the engine's own; nothing here writes.
 *
 * What the model cannot honestly answer is refused, by name: a book
 * (`freshQuote`: no depth is invented), a candle-selected entry
 * (`resolveCandle`) and venue funding. Every symbol that is not a pinned
 * model contract reaches the wrapped market exactly as before; with no pin
 * the wrapped market IS the original object.
 */
export const HISTORY20_PRICE_SOURCE = 'VOLTEX_HISTORY20_MODEL' as const;

export interface History20Selection {
  listingId: string; draftRevision: number; contract: string; source: typeof HISTORY20_PRICE_SOURCE;
  scenarioId: string; intrabar: string; logsSha256: string; rights: 'HISTORICAL_RIGHTS_UNVERIFIED'; listingAt: number;
}
export interface History20Choice { selection: History20Selection; config: ListingConfig }

/** The model contract of a window listing: `SIM` keeps it apart from every venue contract name. */
export const history20Contract = (symbol: string) => `${symbol}${HISTORY20_CONTRACT_SUFFIX}`;

/** A saved History20 window draft, re-validated (schema, logs checksum, scenario) as the simulation reads it. */
export function history20Selection(listing: Pick<AdminListing, 'id' | 'draft' | 'draftRevision' | 'activeVersion'>): History20Choice {
  const config = parseListingConfig(listing.draft), program = config.simulationProgram;
  const growth = program?.kind === 'scenario-controls-v2' && program.growth === 'historical-window' ? program.historicalGrowth : undefined;
  if (!growth) throw new PrivateMarketDataError('history20_not_a_window', 400);
  // A private price path only; a published listing is a different (public) product.
  if (listing.activeVersion !== null) throw new PrivateMarketDataError('history20_published', 409);
  const listingAt = Date.parse(config.listingAt);
  // The engine's bars are epoch-aligned minutes and hours; the model's candles start at the window's opening.
  if (listingAt % HOUR_MS !== 0) throw new PrivateMarketDataError('history20_unaligned', 400);
  return { config, selection: { listingId: listing.id, draftRevision: listing.draftRevision, contract: history20Contract(config.symbol), source: HISTORY20_PRICE_SOURCE,
    scenarioId: growth.scenarioId, intrabar: growth.intrabar, logsSha256: growth.logsSha256, rights: growth.rights, listingAt } };
}

/** Reads the draft through the existing listing store (`list` only: never saves or publishes). */
export async function loadHistory20Selection(store: Pick<ListingStore, 'list'>, listingId: string): Promise<History20Choice> {
  const listing = (await store.list()).listings.find(l => l.id === listingId);
  if (!listing) throw new PrivateMarketDataError('history20_unknown', 404);
  return history20Selection(listing);
}

const decimal = (value: number) => new BigNumber(value).toFixed();
const HISTORY_STEPS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS, HOUR_MS];
/** How far back the model chart answers: the bound the private history already has. */
const CHART_MAX_RANGE_MS = 90 * 24 * HOUR_MS;

/** The selected window's model price, from the same simulation the Admin preview and the listing chart read. */
export class History20PriceSource {
  readonly selection: History20Selection;
  private readonly simulation: TestMarketSimulation;
  constructor(choice: History20Choice, private readonly now: () => number = Date.now) {
    this.selection = choice.selection;
    this.simulation = simulationFor(listingSimulationConfig(choice.config));
  }
  /** The price of the last completed 10-second model tick: never a moment after `now`. */
  mark(): PrivateMark | null {
    const now = this.now(), from = this.selection.listingAt, price = this.simulation.priceAt(now);
    if (price === null) return null;
    const tick = from + Math.floor((now - from) / TICK_MS) * TICK_MS, p = decimal(price);
    return { symbol: this.selection.contract, markPrice: p, lastPrice: p, markProviderTimestamp: tick, receivedAt: tick, fetchedAt: now };
  }
  /** Closed model bars only; trade and mark are the one model price. No provider funding: the engine's own schedule applies. */
  history(request: PrivateHistoryRequest, instrument: PrivateInstrument): PrivateHistoricalData {
    const step = (request.intervalMinutes ?? 1) * MINUTE_MS, now = this.now(), { startTime, endTime } = request;
    if (!HISTORY_STEPS.includes(step) || endTime <= startTime || startTime % step !== 0 || endTime % step !== 0
      || (endTime - startTime) / step > PRIVATE_HISTORY_MAX_CANDLES) throw new PrivateMarketDataError('invalid_history_range', 400);
    if (endTime > Math.floor(now / step) * step) throw new PrivateMarketDataError('history20_not_closed', 400);
    const minutes = startTime < this.selection.listingAt ? [] : this.simulation.candles1m(endTime, startTime).filter(c => c.openTime < endTime);
    const candles: PrivateCandle[] = (step === MINUTE_MS ? minutes : aggregateCandles(minutes, step))
      .map(c => ({ timestamp: c.openTime, open: decimal(c.open), high: decimal(c.high), low: decimal(c.low), close: decimal(c.close) }));
    const complete = candles.length === (endTime - startTime) / step;
    return { symbol: this.selection.contract, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [],
      intervalMs: step, complete, issues: complete ? [] : ['history20_before_window'], fetchedAt: now, fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1', instrument };
  }
  /**
   * The terminal chart: the listing chart's own series (1m from the ticks, every
   * coarser interval from the canonical 5m), up to the candle forming now, built
   * from completed ticks only. Labelled as the model it is; volume is modeled.
   */
  chart(request: PrivateChartRequest) {
    const now = this.now(), size = privateChartIntervalMs(request.interval), offset = SIM_INTERVAL_OFFSETS[request.interval] ?? 0;
    if (SIM_INTERVALS[request.interval] !== size) throw new PrivateMarketDataError('invalid_chart_interval', 400);
    const limit = request.limit ?? 520, end = request.endTime ?? now;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1500 || !Number.isSafeInteger(end) || end <= 0 || end > now) throw new PrivateMarketDataError('invalid_chart_range', 400);
    const bucket = (t: number) => Math.floor((t - offset) / size) * size + offset;
    const last = bucket(end), oldest = bucket(now - CHART_MAX_RANGE_MS) + size;
    // A cut (limit, range) starts on a whole bucket; only the window's own opening may start one part-way.
    const from = Math.max(this.selection.listingAt, last - (limit - 1) * size, oldest), until = Math.min(now, last + size);
    const series = from > until ? [] : size === MINUTE_MS ? this.simulation.candles1m(until, from)
      : aggregateCandles(this.simulation.candles5m(until, Math.floor(from / CANDLE_MS) * CANDLE_MS), size, offset);
    return { source: HISTORY20_PRICE_SOURCE, symbol: this.selection.contract, interval: request.interval,
      candles: series.filter(c => c.openTime >= bucket(from) && c.openTime <= last && c.openTime <= now).slice(-limit)
        .map(c => ({ time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })) };
  }
}

/**
 * THE TEST-ONLY MODEL CONTRACT. Synthetic, never a venue's parameters
 * (`provider: 'voltex-model'`), on the existing native rule structure: USDT
 * settled, the engine's standard demo fee profile and fixed funding schedule.
 * - tick 1e-8: model prices carry 8 significant figures; every window price is on this grid;
 * - quantity step and minimum 0.01, minimum notional 5 USDT, as the engine's usual contracts;
 * - leverage 1-10x, one risk tier (initial 10%, maintenance 1%): conservative, because a
 *   model path has no venue liquidity behind it.
 * These are an explicit owner decision to confirm before any activation.
 * The version carries the pinned path, so every journaled entry records which one it used.
 */
export function history20TestContract(source: History20PriceSource, now: () => number = Date.now): PrivateModelInstrument {
  const s = source.selection;
  return { provider: 'voltex-model', symbol: s.contract, baseAsset: s.contract.slice(0, -'USDT'.length), quoteAsset: 'USDT', settleAsset: 'USDT',
    contractType: 'LinearPerpetual', status: 'Trading', launchTime: s.listingAt, fetchedAt: now(), fundingIntervalMinutes: 480,
    filters: { tickSize: '0.00000001', minPrice: '0.00000001', maxPrice: '10000000', qtyStep: '0.01', minOrderQty: '0.01', maxOrderQty: '1000000', maxMarketOrderQty: '1000000', minNotionalValue: '5' },
    leverage: { min: '1', max: '10', step: '1' },
    riskTiers: [{ riskLimitValue: '1000000', maintenanceMarginRate: '0.01', initialMarginRate: '0.1', maintenanceDeduction: '0', maxLeverage: '10' }],
    parameterModel: 'VOLTEX_HISTORY20_TEST_CONTRACT_V1',
    parameterVersion: `history20-test-v1:${s.scenarioId}:${s.intrabar}:${s.logsSha256.slice(0, 16)}:r${s.draftRevision}:${s.listingAt}` };
}

/** One server pin: exactly which saved window, at which revision, is a model contract's price path. */
export const history20PinSchema = z.object({
  listingId: z.string().min(1).max(80), symbol: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/), draftRevision: z.number().int().positive(),
  logsSha256: z.string().regex(/^[a-f0-9]{64}$/), listingAt: z.string().datetime(), intrabar: z.enum(['SEEDED_BRIDGE_REFERENCE_V2', 'SEEDED_BRIDGE_OHLC_V2', 'LOG_LINEAR_REFERENCE_V1', 'SEEDED_OHLC_PATH_V1']),
}).strict();
export type History20Pin = z.infer<typeof history20PinSchema>;

/** `NATIVE_HISTORY20_PINS` (JSON array). Unset: none. Invalid: none, logged by name, never a partial set. */
export function history20PinsFromEnvironment(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.warn): History20Pin[] {
  const raw = env.NATIVE_HISTORY20_PINS?.trim();
  if (!raw) return [];
  try {
    const pins = z.array(history20PinSchema).max(20).parse(JSON.parse(raw));
    if (new Set(pins.map(p => p.listingId)).size !== pins.length || new Set(pins.map(p => p.symbol)).size !== pins.length) throw new Error('duplicate');
    return pins;
  } catch { log('[history20] NATIVE_HISTORY20_PINS ignored: invalid'); return []; }
}

/**
 * The pinned windows, loaded from the listing store. A pin is served only
 * while the stored draft is exactly the pinned one; otherwise its contract
 * answers `history20_unavailable` (never another path, never the venue).
 */
export class History20Registry {
  private loaded: History20PriceSource[] = [];
  private loading: Promise<void> | null = null;
  private retryAt = 0;
  readonly contracts: ReadonlySet<string>;
  constructor(readonly pins: readonly History20Pin[], private readonly store: Pick<ListingStore, 'list'>, private readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = console.warn) {
    this.contracts = new Set(pins.map(p => history20Contract(p.symbol)));
  }
  sources(): readonly History20PriceSource[] {
    if (this.loaded.length < this.pins.length && !this.loading && this.now() >= this.retryAt) void this.load();
    return this.loaded;
  }
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const { listings } = await this.store.list();
        const next: History20PriceSource[] = [];
        for (const pin of this.pins) {
          const listing = listings.find(l => l.id === pin.listingId);
          try {
            if (!listing) throw new PrivateMarketDataError('history20_unknown', 404);
            const choice = history20Selection(listing), s = choice.selection;
            if (s.draftRevision !== pin.draftRevision || s.logsSha256 !== pin.logsSha256 || s.listingAt !== Date.parse(pin.listingAt)
              || s.intrabar !== pin.intrabar || s.contract !== history20Contract(pin.symbol)) throw new PrivateMarketDataError('history20_pin_mismatch', 409);
            next.push(new History20PriceSource(choice, this.now));
          } catch (e) { this.log(`[history20] pin ${pin.listingId} not served: ${e instanceof PrivateMarketDataError ? e.code : 'invalid'}`); }
        }
        this.loaded = next;
        this.retryAt = this.now() + 60_000;
      } catch { this.retryAt = this.now() + 60_000; this.log('[history20] listing store unavailable'); }
      finally { this.loading = null; }
    })();
    return this.loading;
  }
}

export interface History20MarketOptions {
  /** The selected sources, or the server registry's currently loaded ones. */
  sources: readonly History20PriceSource[] | (() => readonly History20PriceSource[]);
  /** Contracts routed to the model even before their source loads (the pins). Default: the given sources' contracts. */
  contracts?: ReadonlySet<string>;
  /** The contract rules a model symbol trades under. Without it every model command is refused. */
  contract?: (source: History20PriceSource) => PrivateInstrument;
}
type MarketOverrides = { [K in keyof PrivateTradingMarketData]?: PrivateTradingMarketData[K] };
/** How a wrapped market lists its served model contracts (not part of the market interface). */
const MODELS = Symbol('history20.models');

/** What the terminal is told about a served model contract: its identity, provenance and current model price. */
export interface History20ModelView {
  symbol: string; pair: string; source: typeof HISTORY20_PRICE_SOURCE; rights: 'HISTORICAL_RIGHTS_UNVERIFIED';
  scenarioId: string; intrabar: string; listingAt: number; draftRevision: number; logsSha256: string; mark: PrivateMark | null;
}
/** The model contracts a server market currently serves; none for an unwrapped market. */
export function history20Models(market: PrivateTradingMarketData | null): History20ModelView[] {
  const list = (market as unknown as Record<symbol, unknown> | null)?.[MODELS];
  if (typeof list !== 'function') return [];
  return (list as () => readonly History20PriceSource[])().map(source => {
    const s = source.selection;
    return { symbol: s.contract, pair: `${s.contract.slice(0, -'USDT'.length)}/USDT`, source: s.source, rights: s.rights, scenarioId: s.scenarioId,
      intrabar: s.intrabar, listingAt: s.listingAt, draftRevision: s.draftRevision, logsSha256: s.logsSha256, mark: source.mark() };
  });
}

/** The market the native engine is given. With no selected window it IS the original market. */
export function withHistory20Prices(base: PrivateTradingMarketData, options: History20MarketOptions): PrivateTradingMarketData {
  const listed = typeof options.sources === 'function' ? null : options.sources;
  const routed = options.contracts ?? new Set((listed ?? []).map(s => s.selection.contract));
  if (!routed.size) return base;
  if (listed && new Set(listed.map(s => s.selection.contract)).size !== listed.length) throw new PrivateMarketDataError('history20_duplicate_contract', 400);
  const current = () => (typeof options.sources === 'function' ? options.sources() : options.sources);
  const normalize = (input: string) => input.replace(/[-/]USDT$/, 'USDT');
  const isModel = (input: string) => routed.has(normalize(input));
  /** A routed contract: its loaded source, or a refusal; it never falls through to the venue. */
  const model = (input: string) => {
    const source = current().find(s => s.selection.contract === normalize(input));
    if (!source) throw new PrivateMarketDataError('history20_unavailable', 503);
    return source;
  };
  const contract = (source: History20PriceSource) => {
    if (!options.contract) throw new PrivateMarketDataError('history20_contract_undefined', 400);
    const instrument = options.contract(source);
    if (instrument.symbol !== source.selection.contract) throw new PrivateMarketDataError('market_data_invalid');
    return instrument;
  };
  const refuse = (input: string, code: string) => { if (isModel(input)) throw new PrivateMarketDataError(code, 400); };
  const priced = async (symbols: string[], read: (others: string[]) => Promise<Map<string, PrivateMark>>) => {
    const own = symbols.filter(isModel), others = symbols.filter(s => !isModel(s));
    const out = others.length ? await read(others) : new Map<string, PrivateMark>();
    for (const symbol of own) {
      const source = current().find(s => s.selection.contract === normalize(symbol)), mark = source?.mark();
      if (mark) out.set(mark.symbol, mark);
    }
    return out;
  };
  const overrides: MarketOverrides = {
    instrument: async (input, signal) => isModel(input) ? contract(model(input)) : base.instrument(input, signal),
    freshQuote: async (input, signal) => { refuse(input, 'history20_no_book'); return base.freshQuote(input, signal); },
    marks: (symbols, signal) => priced(symbols, others => base.marks(others, signal)),
    historicalDemoPrices: (symbols, signal, minRemainingMs) => priced(symbols, others => base.historicalDemoPrices(others, signal, minRemainingMs)),
    history: async request => { if (!isModel(request.symbol)) return base.history(request); const source = model(request.symbol); return source.history(request, contract(source)); },
    resolveCandle: async selection => { refuse(selection.symbol, 'history20_candle_source_unsupported'); return base.resolveCandle(selection); },
    chartCandles: async request => {
      if (!isModel(request.symbol)) {
        if (request.source === HISTORY20_PRICE_SOURCE) throw new PrivateMarketDataError('chart_source_mismatch', 409);
        return base.chartCandles(request);
      }
      if (request.source !== HISTORY20_PRICE_SOURCE) throw new PrivateMarketDataError('chart_source_mismatch', 409);
      return model(request.symbol).chart(request);
    },
    funding: async (input, startTime, endTime, signal) => { refuse(input, 'history20_no_venue_funding'); return base.funding(input, startTime, endTime, signal); },
  };
  return new Proxy(base, { get(target, key) {
    if (key === MODELS) return current;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key as keyof MarketOverrides];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/** The server's market: the collector's, wrapped only when pins are configured. */
export function history20Market(base: PrivateTradingMarketData, store: Pick<ListingStore, 'list'>, pins: readonly History20Pin[], now: () => number = Date.now): PrivateTradingMarketData {
  if (!pins.length) return base;
  const registry = new History20Registry(pins, store, now);
  void registry.load();
  return withHistory20Prices(base, { sources: () => registry.sources(), contracts: registry.contracts, contract: source => history20TestContract(source, now) });
}

/**
 * A pinned window's price path must not change under a journal that used it:
 * replay, funding and history read it again. Saving or publishing a pinned
 * listing is refused while any native account row or revision mentions its
 * contract; once nothing does, the edit goes through (and the pin, now
 * stale, stops serving until the owner pins the new revision).
 */
/** Whether any native account row or stored revision mentions `contract` (a handful of owner/test accounts). */
export function nativeJournalReferences(db: PrismaClient) {
  return async (contract: string) => {
    const needle = `%"${contract}"%`;
    const rows = await db.$queryRaw<{ found: number }[]>`SELECT 1 AS found FROM "NativeDemoAccount" WHERE payload::text LIKE ${needle}
      UNION ALL SELECT 1 AS found FROM "NativeDemoRevision" WHERE payload::text LIKE ${needle} LIMIT 1`;
    return rows.length > 0;
  };
}

export function guardHistory20Listings<T extends ListingStore>(store: T, pins: readonly History20Pin[], referenced: (contract: string) => Promise<boolean>): T {
  if (!pins.length) return store;
  const contractOf = (id: string) => { const pin = pins.find(p => p.listingId === id); return pin ? history20Contract(pin.symbol) : null; };
  const check = async (id: string) => {
    const contract = contractOf(id);
    if (contract && await referenced(contract)) {
      throw new ListingStoreError(409, 'HISTORY20_PRICE_PATH_IN_USE', `This History20 window is the pinned price path of ${contract}; it cannot change while trades reference it`);
    }
  };
  return new Proxy(store, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key === 'saveDraft' || key === 'publish' || key === 'replacePrelisting') {
      return async (id: string, ...rest: unknown[]) => { await check(id); return (value as (...a: unknown[]) => unknown).call(target, id, ...rest); };
    }
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
