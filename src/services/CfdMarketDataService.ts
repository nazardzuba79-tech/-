/** Twelve Data adapter for reference display and explicitly approved CFD execution.
 * Quote freshness and entitlement are separate from the display cache. Financial
 * consumers depend on CfdQuoteSource and must revalidate inside their transaction.
 * This provider publishes close, not an executable bid/ask spread. */
import { ProviderCache, type CachedValue } from './marketData/ProviderCache';
import { CFD_REFERENCE_CATALOG, CfdCreditBudget } from './marketData/cfd/catalog';
import { assertCfdExecutionQuote, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './marketData/cfd/CfdQuote';
import { finite } from './marketData/numbers';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from './marketData/ProviderHealth';

export class ExternalCfdDataError extends Error {}

export interface CfdInstrument {
  symbol: string; // our short display symbol, e.g. "XAUUSD"
  name: string; // e.g. "Gold US Dollar"
  twelveDataSymbol: string; // what we actually query Twelve Data with, e.g. "XAU/USD"
}

export interface CfdTicker {
  symbol: string;
  name: string;
  price: string;
  /** Already a percentage value, e.g. "-0.31" — same convention as
   *  MarketTicker. ABSENT when Twelve Data did not report one: a missing
   *  24h change is unknown, not zero, and the UI shows a dash. */
  changePercent24h?: string;
}

// Legacy reference watchlist, not evidence of account entitlement. Additional
// verified catalog instruments are queried only after explicit operator approval.
export const CFD_INSTRUMENTS: CfdInstrument[] = [
  { symbol: 'XAUUSD', name: 'Gold US Dollar', twelveDataSymbol: 'XAU/USD' },
  { symbol: 'EURUSD', name: 'Euro vs US Dollar', twelveDataSymbol: 'EUR/USD' },
  { symbol: 'GBPUSD', name: 'British Pound vs US Dollar', twelveDataSymbol: 'GBP/USD' },
  { symbol: 'USDJPY', name: 'US Dollar vs Japanese Yen', twelveDataSymbol: 'USD/JPY' },
  { symbol: 'AUDUSD', name: 'Australian Dollar vs US Dollar', twelveDataSymbol: 'AUD/USD' },
  { symbol: 'USDCAD', name: 'US Dollar vs Canadian Dollar', twelveDataSymbol: 'USD/CAD' },
];

// Reference display can retain old quotes; execution checks BOTH timestamps.
const TICKERS_TTL_MS = 60_000;
const TICKERS_MAX_STALE_MS = 120_000;

export interface CfdDataOptions {
  now?: () => number;
  maxQuoteAgeMs?: number;
  /** Operator-verified real-time entitlement, independent of execution approval. */
  entitledSymbols?: string[];
  executionSymbols?: string[];
  creditsPerMinute?: number;
  creditsPerDay?: number;
}
export class CfdMarketDataService implements CfdQuoteSource {
  private readonly tickersCache: ProviderCache<CfdTicker[]>;
  private readonly http: HttpProviderClient;
  private readonly health: ProviderHealth;
  readonly maxQuoteAgeMs: number;
  private readonly now: () => number;
  private readonly budget: CfdCreditBudget;
  private readonly entitled: Set<string>;
  private readonly executable: Set<string>;
  private observations = new Map<string, { timestamp:number | null; marketOpen:boolean | null; fetchedAt:number }>();
  private readonly instruments: CfdInstrument[];

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.twelvedata.com',
    policy: ProviderRequestPolicy = {},
    options: CfdDataOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.maxQuoteAgeMs = quoteAgeLimit(options.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS);
    this.budget = new CfdCreditBudget(options.creditsPerMinute ?? 8,options.creditsPerDay ?? 800,this.now);
    this.entitled = new Set(options.entitledSymbols ?? []);
    this.executable = new Set(options.executionSymbols ?? []);
    for (const symbol of [...this.entitled,...this.executable]) if (!CFD_REFERENCE_CATALOG.some(i=>i.symbol===symbol)) throw new Error('Unverified CFD catalog symbol');
    this.instruments = [...CFD_INSTRUMENTS, ...CFD_REFERENCE_CATALOG.filter(i=>this.entitled.has(i.symbol) && !CFD_INSTRUMENTS.some(old=>old.symbol===i.symbol))
      .map(i=>({symbol:i.symbol,name:i.name,twelveDataSymbol:i.providerSymbol}))];
    this.health = providerHealthRegistry.register(
      new ProviderHealth('twelvedata', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Twelve Data', {
      ...policy,
      // Count retries as well as initial calls. Budget errors never reach HTTP.
      fetchFn: (url, init) => {
        this.budget.take(this.instruments.length);
        return this.fetchFn(url, { ...init, signal:AbortSignal.timeout(10_000), redirect:'error' });
      },
      health: this.health,
      wrapError: (message) => new ExternalCfdDataError(message),
    });
    this.tickersCache = new ProviderCache<CfdTicker[]>({
      ttlMs: this.entitled.size ? this.maxQuoteAgeMs : TICKERS_TTL_MS,
      maxStaleMs: TICKERS_MAX_STALE_MS,
      maxEntries: 4,
      now: this.now,
      onStaleServe: (key, ageMs) =>
        console.warn(`[marketData] twelvedata serving stale ${key} (${Math.round(ageMs / 1000)}s old)`),
    });
  }

  /** Whether a real key is configured — callers use this to show an honest
   * "not set up yet" state instead of a scary error when it's simply
   * unconfigured (e.g. before the user has signed up for a key). */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getTickers(): Promise<CfdTicker[]> {
    return (await this.getTickersWithMeta()).value;
  }

  /**
   * Same data with the freshness the cache already knows about. The
   * gateway uses this; `getTickers()` above keeps its original signature
   * so every existing caller is untouched.
   *
   * An unconfigured key returns an empty list rather than throwing —
   * unchanged behaviour, and the distinction the route relies on to show
   * "not set up yet" instead of an error banner.
   */
  async getTickersWithMeta(): Promise<CachedValue<CfdTicker[]>> {
    if (!this.apiKey) return { value: [], fetchedAt: this.now(), stale: false };
    // Concurrent consumers share a single metered batch (one credit per symbol).
    return this.tickersCache.fetch('quotes', () => this.fetchTickers());
  }

  private async fetchTickers(): Promise<CfdTicker[]> {
    const symbolsParam = this.instruments.map((i) => i.twelveDataSymbol).join(',');
    const requestedAt = this.now();
    // The key is a query parameter Twelve Data requires; it is read from
    // the environment, never logged, and never included in an error
    // message — HttpProviderClient reports status codes and the provider
    // name only.
    const body = (await this.http.getJson(
      `${this.baseUrl}/quote?symbol=${encodeURIComponent(symbolsParam)}&apikey=${this.apiKey}`
    )) as Record<string, any>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.status === 'error') throw new ExternalCfdDataError('CFD provider unavailable');

    // A single-symbol request returns one flat object instead of one keyed
    // by symbol — normalize both shapes the same way.
    const bySymbol: Record<string, any> = 'symbol' in body ? { [body.symbol]: body } : body;

    const tickers: CfdTicker[] = [];
    const observations = new Map<string, {timestamp:number | null;marketOpen:boolean | null;fetchedAt:number}>();
    for (const instrument of this.instruments) {
      const raw = bySymbol[instrument.twelveDataSymbol];
      if (!raw || raw.status === 'error' || raw.close == null) {
        // Logged (not thrown) so one bad symbol never takes down the whole
        // batch — but visible in Render's Logs tab so a wrong/plan-gated
        // symbol code can actually be diagnosed instead of just silently
        // missing from the list.
        console.warn(`[CfdMarketDataService] Quote unavailable: ${instrument.symbol}`);
        continue;
      }
      const timestamp = finite(raw.timestamp);
      observations.set(instrument.symbol,{timestamp:timestamp !== null && timestamp > 0 ? timestamp*1000 : null,
        marketOpen:typeof raw.is_market_open === 'boolean' ? raw.is_market_open : null,fetchedAt:requestedAt});
      tickers.push({
        symbol: instrument.symbol,
        name: instrument.name,
        price: String(raw.close),
        // `?? '0'` would be a fabricated zero. A quote with a price but no
        // reported 24h change is a real quote with an unknown change, so
        // the field is omitted and the UI renders a dash for it.
        ...(raw.percent_change != null ? { changePercent24h: String(raw.percent_change) } : {}),
      });
    }
    this.observations = observations;
    return tickers;
  }

  async getQuotes(): Promise<CfdQuote[]> {
    let data: CachedValue<CfdTicker[]>;
    try { data = await this.getTickersWithMeta(); }
    catch { return this.catalog().map(i=>this.missing(i.symbol)); }
    return this.catalog().map(i => {
      const ticker = data.value.find(t=>t.symbol===i.symbol), observation = this.observations.get(i.symbol);
      if (!ticker || !observation) return this.missing(i.symbol);
      const last = finite(ticker.price), at = observation.timestamp;
      const old = data.stale || this.now()-observation.fetchedAt>this.maxQuoteAgeMs || (at !== null && (this.now()-at>this.maxQuoteAgeMs || at>this.now()+1000));
      const status = last === null || last <= 0 ? 'malformed' : old ? 'stale' : observation.marketOpen === false ? 'market_closed'
        : !this.entitled.has(i.symbol) || at === null ? 'reference_only' : 'live';
      return { provider:'twelvedata',symbol:i.symbol,providerSymbol:i.providerSymbol,bid:null,ask:null,last,mid:null,
        lastDecimal:ticker.price,
        ...(finite(ticker.changePercent24h) === null ? {} : {changePercent24h:ticker.changePercent24h}),
        providerTimestamp:at,fetchedAt:observation.fetchedAt,stale:old,status,
        executionAllowed:this.executable.has(i.symbol) && this.entitled.has(i.symbol) };
    });
  }
  private missing(symbol:string): CfdQuote {
    const i = CFD_REFERENCE_CATALOG.find(i=>i.symbol===symbol)!;
    return {provider:'twelvedata',symbol,providerSymbol:i.providerSymbol,bid:null,ask:null,last:null,mid:null,providerTimestamp:null,fetchedAt:null,
      stale:false,status:this.entitled.has(symbol) ? 'unavailable' : 'entitlement_required',
      executionAllowed:this.entitled.has(symbol) && this.executable.has(symbol)};
  }
  async getExecutionQuote(symbol:string): Promise<CfdQuote> {
    if (!this.entitled.has(symbol) || !this.executable.has(symbol)) {
      assertCfdExecutionQuote(undefined,symbol,this.maxQuoteAgeMs,this.now());
    }
    const cached = this.tickersCache.peek('quotes');
    if (cached && this.now()-cached.fetchedAt>this.maxQuoteAgeMs) this.tickersCache.invalidate('quotes');
    const quote = (await this.getQuotes()).find(q=>q.symbol===symbol);
    assertCfdExecutionQuote(quote,symbol,this.maxQuoteAgeMs,this.now());
    return quote!;
  }
  catalog() { return CFD_REFERENCE_CATALOG.map(i=>({...i,entitlement:this.entitled.has(i.symbol) ? 'verified' : 'entitlement_required',
    executionAllowed:this.entitled.has(i.symbol) && this.executable.has(i.symbol)})); }
  async diagnostics() { return {catalog:this.catalog(),quotes:await this.getQuotes(),maxQuoteAgeMs:this.maxQuoteAgeMs,credits:this.budget.diagnostics()}; }
}
