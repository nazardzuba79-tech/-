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
 */

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
  changePercent24h: string; // already a percentage value, e.g. "-0.31" — same convention as MarketTicker
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

export class CfdMarketDataService {
  private cache: { tickers: CfdTicker[]; expiresAt: number } | null = null;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.twelvedata.com'
  ) {}

  /** Whether a real key is configured — callers use this to show an honest
   * "not set up yet" state instead of a scary error when it's simply
   * unconfigured (e.g. before the user has signed up for a key). */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getTickers(): Promise<CfdTicker[]> {
    if (!this.apiKey) return [];
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.tickers;

    const symbolsParam = CFD_INSTRUMENTS.map((i) => i.twelveDataSymbol).join(',');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/quote?symbol=${encodeURIComponent(symbolsParam)}&apikey=${this.apiKey}`);
    } catch (err: any) {
      throw new ExternalCfdDataError(`Failed to reach Twelve Data: ${err.message}`);
    }
    if (!res.ok) {
      throw new ExternalCfdDataError(`Twelve Data responded with HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, any>;

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
        changePercent24h: String(raw.percent_change ?? '0'),
      });
    }

    this.cache = { tickers, expiresAt: Date.now() + TICKERS_TTL_MS };
    return tickers;
  }
}
