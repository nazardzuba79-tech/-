/**
 * Live reference prices for a small fixed set of CFD-style instruments
 * (gold + major forex pairs) from Twelve Data's public REST API
 * (https://twelvedata.com) — a free tier that needs a signed-up API key
 * (TWELVE_DATA_API_KEY), unlike Kraken's fully public endpoints. Powers the
 * numeric price/spread the order form fills against — the chart itself is
 * TradingView's own free embedded widget (see frontend's CfdChart), which
 * needs neither this service nor this API key.
 *
 * This is informational only, same spirit as ArbitrageService and the OTC
 * page: real, live numbers, but this app has no actual CFD execution
 * engine (margin, leverage, liquidation) behind it yet — see CfdPage's own
 * doc comment for why the UI doesn't pretend otherwise.
 *
 * NOT tested against the live API from this environment (this sandbox's
 * outbound proxy blocks non-allowlisted hosts) — verify once deployed with
 * a real key.
 *
 * Transport, caching and health now go through the same shared primitives
 * as Kraken/CoinGecko/Fear & Greed (ProviderCache, HttpProviderClient,
 * ProviderHealth). Before this it was the only key-bearing provider in the
 * system with a hand-rolled `{tickers, expiresAt}` cache, no request
 * deduplication, no retry policy, no Retry-After handling and no circuit
 * breaker — on a metered 8-credits/minute budget, which made it the one
 * provider where an unprotected request loop costs real money. The TTL and
 * the six-symbol list are unchanged; what changed is what happens when the
 * provider says no.
 */

import { ProviderCache, type CachedValue } from './marketData/ProviderCache';
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

// Twelve Data's free plan charges ONE credit per symbol in a batched
// /quote request (not one credit per call) against an 8-credits/minute
// budget — an 11-symbol list (a prior version of this array) demanded 11
// credits every refetch and permanently exceeded that budget, breaking
// the batch outright rather than just dropping the unlisted symbols as
// originally assumed. Kept deliberately small (6 symbols, well under the
// 8-credit budget at the 60s cadence below) and restricted to gold +
// major forex pairs — the asset classes confirmed working from real
// deployed traffic (XAUUSD and EURUSD were the two that actually returned
// data), since indices and other commodities were never confirmed and
// only ate credits for nothing.
export const CFD_INSTRUMENTS: CfdInstrument[] = [
  { symbol: 'XAUUSD', name: 'Gold US Dollar', twelveDataSymbol: 'XAU/USD' },
  { symbol: 'EURUSD', name: 'Euro vs US Dollar', twelveDataSymbol: 'EUR/USD' },
  { symbol: 'GBPUSD', name: 'British Pound vs US Dollar', twelveDataSymbol: 'GBP/USD' },
  { symbol: 'USDJPY', name: 'US Dollar vs Japanese Yen', twelveDataSymbol: 'USD/JPY' },
  { symbol: 'AUDUSD', name: 'Australian Dollar vs US Dollar', twelveDataSymbol: 'AUD/USD' },
  { symbol: 'USDCAD', name: 'US Dollar vs Canadian Dollar', twelveDataSymbol: 'USD/CAD' },
];

// 60s, not 30s — halves the credit burn rate to stay under Twelve Data's
// 8-credits/minute free-plan budget (see CFD_INSTRUMENTS' comment above).
const TICKERS_TTL_MS = 60_000;
// Deliberately short. A forex/gold quote is what the CFD order form prices
// against, so this is trading-adjacent data: one failed poll may be
// covered by the last good value, a sustained outage may not. Past this
// the caller gets an explicit unavailable rather than a two-minute-old
// price presented as the current one.
const TICKERS_MAX_STALE_MS = 120_000;

export class CfdMarketDataService {
  private readonly tickersCache: ProviderCache<CfdTicker[]>;
  private readonly http: HttpProviderClient;
  private readonly health: ProviderHealth;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.twelvedata.com',
    policy: ProviderRequestPolicy = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('twelvedata', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Twelve Data', {
      ...policy,
      fetchFn: this.fetchFn,
      health: this.health,
      wrapError: (message) => new ExternalCfdDataError(message),
    });
    this.tickersCache = new ProviderCache<CfdTicker[]>({
      ttlMs: TICKERS_TTL_MS,
      maxStaleMs: TICKERS_MAX_STALE_MS,
      maxEntries: 4,
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
    if (!this.apiKey) return { value: [], fetchedAt: Date.now(), stale: false };
    // One in-flight request per key: with the instrument list and the
    // price panel both mounted, a cold cache now costs one credit, not
    // two. On an 8-credits/minute budget that is the difference between
    // fitting and not.
    return this.tickersCache.fetch('quotes', () => this.fetchTickers());
  }

  private async fetchTickers(): Promise<CfdTicker[]> {
    const symbolsParam = CFD_INSTRUMENTS.map((i) => i.twelveDataSymbol).join(',');
    // The key is a query parameter Twelve Data requires; it is read from
    // the environment, never logged, and never included in an error
    // message — HttpProviderClient reports status codes and the provider
    // name only.
    const body = (await this.http.getJson(
      `${this.baseUrl}/quote?symbol=${encodeURIComponent(symbolsParam)}&apikey=${this.apiKey}`
    )) as Record<string, any>;

    // A single-symbol request returns one flat object instead of one keyed
    // by symbol — normalize both shapes the same way.
    const bySymbol: Record<string, any> = 'symbol' in body ? { [body.symbol]: body } : body;

    const tickers: CfdTicker[] = [];
    for (const instrument of CFD_INSTRUMENTS) {
      const raw = bySymbol[instrument.twelveDataSymbol];
      if (!raw || raw.status === 'error' || raw.close == null) {
        // Logged (not thrown) so one bad symbol never takes down the whole
        // batch — but visible in Render's Logs tab so a wrong/plan-gated
        // symbol code can actually be diagnosed instead of just silently
        // missing from the list.
        console.warn(
          `[CfdMarketDataService] Skipping ${instrument.symbol} (${instrument.twelveDataSymbol}): ` +
            (raw ? `Twelve Data said "${raw.message ?? raw.status}"` : 'not present in the response at all')
        );
        continue;
      }
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

    return tickers;
  }
}
