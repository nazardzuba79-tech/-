/**
 * Live reference prices for a small fixed set of CFD-style instruments
 * (gold, oil, major indices) from Twelve Data's public REST API
 * (https://twelvedata.com) — a free tier that needs a signed-up API key
 * (TWELVE_DATA_API_KEY), unlike Kraken's fully public endpoints.
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

// A deliberately small, well-known set — enough to fill a "trending CFDs"
// strip without burning through Twelve Data's free-tier rate limit (8
// requests/minute, 800/day). All fetched in a single batched request.
export const CFD_INSTRUMENTS: CfdInstrument[] = [
  { symbol: 'XAUUSD', name: 'Gold US Dollar', twelveDataSymbol: 'XAU/USD' },
  { symbol: 'XAGUSD', name: 'Silver US Dollar', twelveDataSymbol: 'XAG/USD' },
  { symbol: 'USOUSD', name: 'WTI Crude Oil Cash', twelveDataSymbol: 'WTI/USD' },
  { symbol: 'NAS100', name: 'US 100 Cash', twelveDataSymbol: 'NDX' },
  { symbol: 'US500', name: 'US 500 Cash', twelveDataSymbol: 'SPX' },
  { symbol: 'US30', name: 'US 30 Cash', twelveDataSymbol: 'DJI' },
  { symbol: 'EURUSD', name: 'Euro vs US Dollar', twelveDataSymbol: 'EUR/USD' },
];

const TICKERS_TTL_MS = 30_000;

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
      if (!raw || raw.status === 'error' || raw.close == null) continue; // symbol not on this plan / market closed with no data
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
