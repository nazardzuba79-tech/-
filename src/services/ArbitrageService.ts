import { KrakenMarketDataService } from './KrakenMarketDataService';

/**
 * Live cross-exchange spot-price comparison across Binance, OKX, and our
 * own Kraken mirror (KrakenMarketDataService) — surfaces real, currently
 * computed spread opportunities for a handful of major USDT pairs. Every
 * price here is genuinely fetched at request time (briefly cached);
 * nothing is fabricated, hardcoded, or a fixed "typical return" figure.
 *
 * This is a MONITOR, not an executor: it never places, cancels, or moves
 * funds on any exchange. Turning a detected spread into an actual filled
 * trade would require funded, API-trading-enabled accounts on every venue
 * compared here — transfer time between exchanges alone is usually enough
 * to erase a real spot spread before a transfer clears, which is why real
 * cross-exchange arbitrage desks hold pre-positioned balances on each venue
 * rather than moving coins on the fly. That's a distinct, much bigger and
 * financially risky project this service intentionally does not attempt.
 *
 * netSpreadPercent subtracts a flat ROUND_TRIP_FEE_PERCENT estimate (taker
 * fee on both legs) — a reasonable industry-typical figure, but every
 * exchange's real fee depends on the account's own volume/VIP tier, so
 * treat it as an estimate, not a promise of realizable profit. Real,
 * durable cross-exchange spreads on major pairs are usually a few basis
 * points, not the double-digit percentages sometimes advertised by
 * arbitrage-bot scams — this service reports whatever the real number is,
 * however small (or negative, in which case it's simply not opportunity).
 *
 * NOT tested against the live APIs from this environment (this sandbox's
 * outbound proxy blocks non-allowlisted hosts, same restriction
 * CoinGeckoService/KrakenMarketDataService carry) — verify once deployed.
 */

export class ExternalArbitrageError extends Error {}

export interface ArbitrageOpportunity {
  pair: string;
  buyExchange: string;
  buyPrice: number;
  sellExchange: string;
  sellPrice: number;
  spreadPercent: number; // gross, before fees
  netSpreadPercent: number; // spreadPercent minus the round-trip fee estimate
}

const TRACKED_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'TRX/USDT', 'DOGE/USDT'];

// 0.10% taker fee per leg, both legs — see the class doc comment above for
// why this is an estimate rather than an exact figure.
const ROUND_TRIP_FEE_PERCENT = 0.2;

// Prices move fast; short cache like KrakenMarketDataService's own ticker
// cache, just enough to absorb a burst of near-simultaneous requests
// without hammering three external APIs per request.
const OPPORTUNITIES_TTL_MS = 10_000;

const BINANCE_SYMBOL: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT',
  'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT',
  'XRP/USDT': 'XRPUSDT',
  'TRX/USDT': 'TRXUSDT',
  'DOGE/USDT': 'DOGEUSDT',
};

const OKX_SYMBOL: Record<string, string> = {
  'BTC/USDT': 'BTC-USDT',
  'ETH/USDT': 'ETH-USDT',
  'SOL/USDT': 'SOL-USDT',
  'XRP/USDT': 'XRP-USDT',
  'TRX/USDT': 'TRX-USDT',
  'DOGE/USDT': 'DOGE-USDT',
};

interface ExchangeQuote {
  exchange: string;
  price: number;
}

export class ArbitrageService {
  private cache: { opportunities: ArbitrageOpportunity[]; expiresAt: number } | null = null;

  constructor(
    private readonly krakenService: KrakenMarketDataService,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly binanceBaseUrl = 'https://api.binance.com',
    private readonly okxBaseUrl = 'https://www.okx.com'
  ) {}

  /** Every tracked pair with at least two live exchange quotes, sorted by
   * netSpreadPercent descending (best opportunity first). A pair with only
   * zero or one live quote (an external API failed) is simply omitted
   * rather than shown with a fabricated comparison. */
  async getOpportunities(): Promise<ArbitrageOpportunity[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.opportunities;

    // Independent sources — one failing (e.g. Binance rate-limiting) should
    // degrade to fewer comparisons, not take down the whole endpoint.
    const [binance, okx, kraken] = await Promise.allSettled([
      this.fetchBinancePrices(),
      this.fetchOkxPrices(),
      this.krakenService.getTickers(),
    ]);

    const byPair = new Map<string, ExchangeQuote[]>(TRACKED_PAIRS.map((p) => [p, []]));

    if (binance.status === 'fulfilled') {
      for (const [pair, price] of binance.value) byPair.get(pair)?.push({ exchange: 'Binance', price });
    }
    if (okx.status === 'fulfilled') {
      for (const [pair, price] of okx.value) byPair.get(pair)?.push({ exchange: 'OKX', price });
    }
    if (kraken.status === 'fulfilled') {
      for (const t of kraken.value) {
        const quotes = byPair.get(t.pair);
        if (!quotes) continue;
        const price = parseFloat(t.lastPrice);
        if (price > 0) quotes.push({ exchange: 'Kraken', price });
      }
    }

    const opportunities: ArbitrageOpportunity[] = [];
    for (const [pair, quotes] of byPair) {
      if (quotes.length < 2) continue;
      const sorted = [...quotes].sort((a, b) => a.price - b.price);
      const lowest = sorted[0];
      const highest = sorted[sorted.length - 1];
      const spreadPercent = ((highest.price - lowest.price) / lowest.price) * 100;
      opportunities.push({
        pair,
        buyExchange: lowest.exchange,
        buyPrice: lowest.price,
        sellExchange: highest.exchange,
        sellPrice: highest.price,
        spreadPercent,
        netSpreadPercent: spreadPercent - ROUND_TRIP_FEE_PERCENT,
      });
    }
    opportunities.sort((a, b) => b.netSpreadPercent - a.netSpreadPercent);

    if (opportunities.length === 0) {
      if (this.cache) return this.cache.opportunities;
      throw new ExternalArbitrageError('No exchange price data available right now');
    }

    this.cache = { opportunities, expiresAt: Date.now() + OPPORTUNITIES_TTL_MS };
    return opportunities;
  }

  private async fetchBinancePrices(): Promise<[string, number][]> {
    const symbols = JSON.stringify(Object.values(BINANCE_SYMBOL));
    let res: Response;
    try {
      res = await this.fetchFn(`${this.binanceBaseUrl}/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`);
    } catch (err: any) {
      throw new ExternalArbitrageError(`Failed to reach Binance: ${err.message}`);
    }
    if (!res.ok) throw new ExternalArbitrageError(`Binance responded with HTTP ${res.status}`);
    const rows = (await res.json()) as { symbol: string; price: string }[];
    const bySymbol = new Map(rows.map((r) => [r.symbol, parseFloat(r.price)]));
    const out: [string, number][] = [];
    for (const [pair, symbol] of Object.entries(BINANCE_SYMBOL)) {
      const price = bySymbol.get(symbol);
      if (price && price > 0) out.push([pair, price]);
    }
    return out;
  }

  private async fetchOkxPrices(): Promise<[string, number][]> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.okxBaseUrl}/api/v5/market/tickers?instType=SPOT`);
    } catch (err: any) {
      throw new ExternalArbitrageError(`Failed to reach OKX: ${err.message}`);
    }
    if (!res.ok) throw new ExternalArbitrageError(`OKX responded with HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { instId: string; last: string }[] };
    const rows = json.data ?? [];
    const byInstId = new Map(rows.map((r) => [r.instId, parseFloat(r.last)]));
    const out: [string, number][] = [];
    for (const [pair, instId] of Object.entries(OKX_SYMBOL)) {
      const price = byInstId.get(instId);
      if (price && price > 0) out.push([pair, price]);
    }
    return out;
  }
}
