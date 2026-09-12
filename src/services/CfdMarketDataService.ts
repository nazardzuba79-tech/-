/** Twelve Data adapter for reference display and explicitly approved CFD execution.
 * Quote freshness and entitlement are separate from the display cache. Financial
 * consumers depend on CfdQuoteSource and must revalidate inside their transaction.
 * This provider publishes close, not an executable bid/ask spread. */
import { type CachedValue } from './marketData/ProviderCache';
import { CFD_REFERENCE_CATALOG, CfdCreditBudget } from './marketData/cfd/catalog';
import { assertCfdFreshQuote, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './marketData/cfd/CfdQuote';
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

// Display membership follows verified provider support, never execution entitlement.
export const CFD_INSTRUMENTS: CfdInstrument[] = CFD_REFERENCE_CATALOG.map(i =>
  ({ symbol:i.symbol, name:i.name, twelveDataSymbol:i.providerSymbol }));
const REFERENCE_REFRESH_MS = 60_000;
const REFERENCE_MAX_AGE_MS = 120_000;

export interface CfdDataOptions {
  now?: () => number;
  maxQuoteAgeMs?: number;
  /** Operator-verified real-time entitlement; never controls reference membership. */
  entitledSymbols?: string[];
  /** Approval for new positions only; does not disable quotes for existing risk. */
  executionSymbols?: string[];
  creditsPerMinute?: number;
  creditsPerDay?: number;
}
export class CfdMarketDataService implements CfdQuoteSource {
  private readonly lastGood = new Map<string, CfdTicker>();
  private readonly failed = new Set<string>();
  private referenceInFlight: Promise<void> | null = null;
  private readonly executionInFlight = new Map<string, Promise<void>>();
  private nextReferenceAt = -Infinity;
  private cursor = 0;
  private referenceError: unknown;
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
    this.budget = new CfdCreditBudget(Math.min(8, options.creditsPerMinute ?? 8),Math.min(800, options.creditsPerDay ?? 800),this.now);
    this.entitled = new Set(options.entitledSymbols ?? []);
    this.executable = new Set(options.executionSymbols ?? []);
    for (const symbol of [...this.entitled,...this.executable]) if (!CFD_REFERENCE_CATALOG.some(i=>i.symbol===symbol)) throw new Error('Unverified CFD catalog symbol');
    this.instruments = CFD_INSTRUMENTS;
    this.health = providerHealthRegistry.register(
      new ProviderHealth('twelvedata', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Twelve Data', {
      ...policy,
      // Count retries as well as initial calls. Budget errors never reach HTTP.
      fetchFn: (url, init) => {
        this.budget.take(new URL(String(url)).searchParams.get('symbol')!.split(',').length);
        return this.fetchFn(url, { ...init, signal:AbortSignal.timeout(10_000), redirect:'error' });
      },
      health: this.health,
      wrapError: (message) => new ExternalCfdDataError(/^Twelve Data responded with HTTP \d+$/.test(message) ? message : 'Failed to reach Twelve Data'),
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

  /** Last-good reference cache with aggregate metadata for the gateway. Public
   * CFD rows use getQuotes() for per-symbol availability and strict risk gates. */
  async getTickersWithMeta(): Promise<CachedValue<CfdTicker[]>> {
    if (!this.apiKey) return { value: [], fetchedAt: this.now(), stale: false };
    // Demand-driven round-robin, independent of execution/UI cadence. Failures
    // advance the cursor too, so one bad symbol cannot starve later instruments.
    if (!this.referenceInFlight && this.now() >= this.nextReferenceAt) {
      const size = Math.min(8, this.budget.available(), this.instruments.length);
      if (size > 0) {
        const batch = Array.from({length:size}, (_, n) => this.instruments[(this.cursor+n)%this.instruments.length]);
        this.cursor = (this.cursor+size)%this.instruments.length;
        this.nextReferenceAt = this.now()+REFERENCE_REFRESH_MS;
        this.referenceInFlight = this.fetchTickers(batch).finally(() => { this.referenceInFlight = null; });
      }
    }
    try { await this.referenceInFlight; }
    catch (error) { this.referenceError = error; }
    if (!this.lastGood.size && this.referenceError) throw this.referenceError;
    const value = this.instruments.flatMap(i => this.lastGood.has(i.symbol) ? [this.lastGood.get(i.symbol)!] : []);
    return {value, fetchedAt: Math.min(...[...this.observations.values()].map(o => o.fetchedAt), this.now()),
      stale: value.some(t => this.referenceStale(t.symbol))};
  }

  private referenceStale(symbol: string): boolean {
    const o = this.observations.get(symbol);
    return !o || this.failed.has(symbol) || this.now()-o.fetchedAt > REFERENCE_MAX_AGE_MS
      || (o.timestamp !== null && (this.now()-o.timestamp > REFERENCE_MAX_AGE_MS || o.timestamp > this.now()+1000));
  }

  private async fetchTickers(instruments: CfdInstrument[]): Promise<void> {
    try { await this.fetchBatch(instruments); }
    catch (error) {
      instruments.forEach(i => this.failed.add(i.symbol));
      // JSON parser/transport exceptions can contain fragments of provider data.
      throw error instanceof ExternalCfdDataError ? error : new ExternalCfdDataError('CFD provider unavailable');
    }
  }

  private async fetchBatch(instruments: CfdInstrument[]): Promise<void> {
    const symbolsParam = instruments.map(i => i.twelveDataSymbol).join(',');
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
    this.referenceError = undefined;
    const bySymbol: Record<string, any> = 'symbol' in body ? { [body.symbol]: body } : body;

    for (const instrument of instruments) {
      // A slower reference response must not replace a newer execution fetch.
      if ((this.observations.get(instrument.symbol)?.fetchedAt ?? -Infinity) > requestedAt) continue;
      const raw = bySymbol[instrument.twelveDataSymbol];
      if (!raw || raw.status === 'error' || finite(raw.close) === null || finite(raw.close)! <= 0) {
        // Logged (not thrown) so one bad symbol never takes down the whole
        // batch — but visible in Render's Logs tab so a wrong/plan-gated
        // symbol code can actually be diagnosed instead of just silently
        // missing from the list.
        this.failed.add(instrument.symbol);
        console.warn(`[CfdMarketDataService] Quote unavailable: ${instrument.symbol}`);
        continue;
      }
      const timestamp = finite(raw.timestamp);
      this.failed.delete(instrument.symbol);
      this.observations.set(instrument.symbol,{timestamp:timestamp !== null && timestamp > 0 ? timestamp*1000 : null,
        marketOpen:typeof raw.is_market_open === 'boolean' ? raw.is_market_open : null,fetchedAt:requestedAt});
      this.lastGood.set(instrument.symbol, {
        symbol: instrument.symbol,
        name: instrument.name,
        price: String(raw.close),
        // `?? '0'` would be a fabricated zero. A quote with a price but no
        // reported 24h change is a real quote with an unknown change, so
        // the field is omitted and the UI renders a dash for it.
        ...(finite(raw.percent_change) !== null ? { changePercent24h: String(raw.percent_change) } : {}),
      });
    }

  }

  async getQuotes(): Promise<CfdQuote[]> {
    try { await this.getTickersWithMeta(); } catch { /* Catalog remains visible. */ }
    return this.catalog().map(i => this.quote(i.symbol));
  }
  private quote(symbol: string): CfdQuote {
      const i = CFD_REFERENCE_CATALOG.find(i => i.symbol === symbol)!;
      const ticker = this.lastGood.get(symbol), observation = this.observations.get(symbol);
      if (!ticker || !observation) return this.missing(symbol);
      const last = finite(ticker.price), at = observation.timestamp;
      const old = this.failed.has(symbol) || this.now()-observation.fetchedAt>this.maxQuoteAgeMs
        || (at !== null && (this.now()-at>this.maxQuoteAgeMs || at>this.now()+1000));
      const status = last === null || last <= 0 ? 'malformed' : old ? 'stale' : observation.marketOpen === false ? 'market_closed'
        : !this.entitled.has(symbol) || at === null ? 'reference_only' : 'live';
      return { provider:'twelvedata',symbol,providerSymbol:i.providerSymbol,bid:null,ask:null,last,mid:null,
        lastDecimal:ticker.price,
        ...(finite(ticker.changePercent24h) === null ? {} : {changePercent24h:ticker.changePercent24h}),
        providerTimestamp:at,fetchedAt:observation.fetchedAt,stale:old,status,
        referenceStatus:this.referenceStale(symbol) ? 'stale' : observation.marketOpen === false ? 'market_closed' : 'available',
        entitlementVerified:this.entitled.has(symbol),
        executionAllowed:this.executable.has(symbol) && this.entitled.has(symbol) };
  }
  private missing(symbol:string): CfdQuote {
    const i = CFD_REFERENCE_CATALOG.find(i=>i.symbol===symbol)!;
    return {provider:'twelvedata',symbol,providerSymbol:i.providerSymbol,bid:null,ask:null,last:null,mid:null,providerTimestamp:null,fetchedAt:null,
      entitlementVerified:this.entitled.has(symbol),
      stale:false,status:'unavailable',referenceStatus:'unavailable',
      executionAllowed:this.entitled.has(symbol) && this.executable.has(symbol)};
  }
  async getFreshQuote(symbol:string): Promise<CfdQuote> {
    if (!this.apiKey || !this.entitled.has(symbol)) {
      assertCfdFreshQuote(undefined,symbol,this.maxQuoteAgeMs,this.now());
    }
    // Execution has its own freshness cadence; it never resets or accelerates
    // the reference rotation. Both paths spend the SAME credit budget.
    if (this.referenceInFlight) { try { await this.referenceInFlight; } catch { /* fail closed below */ } }
    let quote = this.quote(symbol);
    try { assertCfdFreshQuote(quote,symbol,this.maxQuoteAgeMs,this.now()); }
    catch {
      if (!this.executionInFlight.has(symbol)) {
        const instrument = this.instruments.find(i => i.symbol === symbol)!;
        const pending = this.fetchTickers([instrument]).finally(() => { this.executionInFlight.delete(symbol); });
        this.executionInFlight.set(symbol,pending);
      }
      try { await this.executionInFlight.get(symbol); } catch { /* fail closed below */ }
      quote = this.quote(symbol);
    }
    assertCfdFreshQuote(quote,symbol,this.maxQuoteAgeMs,this.now());
    return quote!;
  }
  catalog() { return CFD_REFERENCE_CATALOG.map(i=>({...i,entitlement:this.entitled.has(i.symbol) ? 'verified' : 'entitlement_required',
    executionAllowed:this.entitled.has(i.symbol) && this.executable.has(i.symbol)})); }
  async diagnostics() { return {catalog:this.catalog(),quotes:await this.getQuotes(),maxQuoteAgeMs:this.maxQuoteAgeMs,credits:this.budget.diagnostics()}; }
}
