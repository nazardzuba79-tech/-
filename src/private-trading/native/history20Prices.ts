import BigNumber from 'bignumber.js';
import { listingSimulationConfig, parseListingConfig, type ListingConfig } from '../../services/listings/listingConfig';
import type { AdminListing, ListingStore } from '../../services/listings/store';
import { aggregateCandles, simulationFor, MINUTE_MS, TICK_MS, HOUR_MS, type TestMarketSimulation } from '../../services/testMarkets/testMarketSimulation';
import { PRIVATE_HISTORY_MAX_CANDLES, PrivateMarketDataError, type PrivateCandle, type PrivateHistoricalData, type PrivateHistoryRequest,
  type PrivateInstrument, type PrivateMark, type PrivateTradingMarketData } from '../marketData';

/**
 * HISTORY20 AS A PRICE SOURCE FOR THE NATIVE FUTURES TEST ACCOUNT — a review
 * seam, wired nowhere. A History20 growth window (Admin → Listings draft,
 * `HISTORICAL_RIGHTS_UNVERIFIED`, never published) is selected through the
 * listing store Render already reads, and its model price is served to the
 * native demo engine through the three sampled-price reads the existing
 * HISTORICAL_DEMO contract uses: `historicalDemoPrices`, `marks` and closed
 * `history` bars. Orders, fills, margin, fees, funding and the journal stay
 * the engine's own; nothing here writes.
 *
 * What the model cannot honestly answer is refused, by name: a book
 * (`freshQuote`: no depth is invented), a candle-selected entry and a chart
 * (`resolveCandle`, `chartCandles`: their source is the literal
 * `BYBIT_LINEAR`), venue funding, and the contract itself — no contract
 * parameters exist for a model symbol until the owner defines them.
 * Every symbol that is not a selected model contract reaches the wrapped
 * market exactly as before.
 */
export const HISTORY20_PRICE_SOURCE = 'VOLTEX_HISTORY20_MODEL';

export interface History20Selection {
  listingId: string; draftRevision: number; contract: string; source: typeof HISTORY20_PRICE_SOURCE;
  scenarioId: string; intrabar: string; logsSha256: string; rights: 'HISTORICAL_RIGHTS_UNVERIFIED'; listingAt: number;
}
export interface History20Choice { selection: History20Selection; config: ListingConfig }

/** The model contract of a window listing: `SIM` keeps it apart from every venue contract name. */
export const history20Contract = (symbol: string) => `${symbol}SIMUSDT`;

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
}

export interface History20MarketOptions {
  sources: readonly History20PriceSource[];
  /** The contract rules a model symbol trades under. None is defined yet (owner decision); without it every model command is refused. */
  contract?: (source: History20PriceSource) => PrivateInstrument;
}
type MarketOverrides = { [K in keyof PrivateTradingMarketData]?: PrivateTradingMarketData[K] };

/** The market the native engine would be given. With no selected window it IS the original market. */
export function withHistory20Prices(base: PrivateTradingMarketData, options: History20MarketOptions): PrivateTradingMarketData {
  if (!options.sources.length) return base;
  const models = new Map(options.sources.map(s => [s.selection.contract, s]));
  if (models.size !== options.sources.length) throw new PrivateMarketDataError('history20_duplicate_contract', 400);
  const model = (input: string) => models.get(input.replace(/[-/]USDT$/, 'USDT'));
  const contract = (source: History20PriceSource) => {
    if (!options.contract) throw new PrivateMarketDataError('history20_contract_undefined', 400);
    const instrument = options.contract(source);
    if (instrument.symbol !== source.selection.contract) throw new PrivateMarketDataError('market_data_invalid');
    return instrument;
  };
  const refuse = (input: string, code: string) => { if (model(input)) throw new PrivateMarketDataError(code, 400); };
  const priced = async (symbols: string[], read: (others: string[]) => Promise<Map<string, PrivateMark>>) => {
    const own = symbols.map(model).filter((s): s is History20PriceSource => !!s), others = symbols.filter(s => !model(s));
    const out = others.length ? await read(others) : new Map<string, PrivateMark>();
    for (const source of own) { const mark = source.mark(); if (mark) out.set(mark.symbol, mark); }
    return out;
  };
  const overrides: MarketOverrides = {
    instrument: async (input, signal) => { const source = model(input); return source ? contract(source) : base.instrument(input, signal); },
    freshQuote: async (input, signal) => { refuse(input, 'history20_no_book'); return base.freshQuote(input, signal); },
    marks: (symbols, signal) => priced(symbols, others => base.marks(others, signal)),
    historicalDemoPrices: (symbols, signal, minRemainingMs) => priced(symbols, others => base.historicalDemoPrices(others, signal, minRemainingMs)),
    history: async request => { const source = model(request.symbol); return source ? source.history(request, contract(source)) : base.history(request); },
    resolveCandle: async selection => { refuse(selection.symbol, 'history20_candle_source_unsupported'); return base.resolveCandle(selection); },
    chartCandles: async request => { refuse(request.symbol, 'history20_chart_source_unsupported'); return base.chartCandles(request); },
    funding: async (input, startTime, endTime, signal) => { refuse(input, 'history20_no_venue_funding'); return base.funding(input, startTime, endTime, signal); },
  };
  return new Proxy(base, { get(target, key) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key as keyof MarketOverrides];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
