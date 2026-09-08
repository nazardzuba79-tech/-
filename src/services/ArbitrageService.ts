import { KrakenMarketDataService } from './KrakenMarketDataService';
import { ProviderCache } from './marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from './marketData/ProviderHealth';

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
 *
 * Binance and OKX now go through the shared transport primitives
 * (HttpProviderClient + per-venue ProviderHealth) and the shared
 * ProviderCache, like every other provider in the system. Each venue gets
 * its OWN circuit: Binance rate-limiting must not stop OKX being read,
 * because a spread needs two independent venues and silently dropping to
 * one is how a comparison becomes a fiction. That is also why a pair with
 * fewer than two live quotes is still omitted entirely rather than
 * reported with one side missing.
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
  /** Every venue actually compared for this pair, so a reader can see the
   *  comparison rather than trusting two endpoints of it. */
  sources: string[];
  /** When this comparison was computed (epoch ms). A spread is only
   *  meaningful with a timestamp — an hour-old one is not an opportunity,
   *  and without this the UI could not tell. */
  observedAt: number;
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

// A spread past its stale budget is not an opportunity, it is history —
// so this budget is short and the endpoint says "unavailable" rather than
// presenting a minute-old comparison as actionable.
const OPPORTUNITIES_MAX_STALE_MS = 30_000;

export class ArbitrageService {
  private readonly cache: ProviderCache<ArbitrageOpportunity[]>;
  private readonly binanceHttp: HttpProviderClient;
  private readonly okxHttp: HttpProviderClient;

  constructor(
    private readonly krakenService: KrakenMarketDataService,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly binanceBaseUrl = 'https://api.binance.com',
    private readonly okxBaseUrl = 'https://www.okx.com',
    policy: ProviderRequestPolicy = {}
  ) {
    // Separate health per venue, registered independently: the admin
    // status view must be able to show Binance open and OKX closed,
    // because that is exactly the state in which arbitrage output should
    // be treated with suspicion.
    this.binanceHttp = new HttpProviderClient('Binance', {
      ...policy,
      fetchFn: this.fetchFn,
      health: providerHealthRegistry.register(
        new ProviderHealth('binance', { onStateChange: logCircuitTransition })
      ),
      wrapError: (message) => new ExternalArbitrageError(message),
    });
    this.okxHttp = new HttpProviderClient('OKX', {
      ...policy,
      fetchFn: this.fetchFn,
      health: providerHealthRegistry.register(new ProviderHealth('okx', { onStateChange: logCircuitTransition })),
      wrapError: (message) => new ExternalArbitrageError(message),
    });
    this.cache = new ProviderCache<ArbitrageOpportunity[]>({
      ttlMs: OPPORTUNITIES_TTL_MS,
      maxStaleMs: OPPORTUNITIES_MAX_STALE_MS,
      maxEntries: 4,
      onStaleServe: (key, ageMs) =>
        console.warn(`[marketData] arbitrage serving stale ${key} (${Math.round(ageMs / 1000)}s old)`),
    });
  }

  /** Every tracked pair with at least two live exchange quotes, sorted by
   * netSpreadPercent descending (best opportunity first). A pair with only
   * zero or one live quote (an external API failed) is simply omitted
   * rather than shown with a fabricated comparison. */
  async getOpportunities(): Promise<ArbitrageOpportunity[]> {
    // ProviderCache replaces the hand-rolled {opportunities, expiresAt}:
    // same TTL, but now concurrent callers on a cold cache collapse into
    // ONE upstream sweep instead of each hitting three external APIs.
    return (await this.cache.fetch('opportunities', () => this.computeOpportunities())).value;
  }

  private async computeOpportunities(): Promise<ArbitrageOpportunity[]> {
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

    const observedAt = Date.now();
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
        sources: quotes.map((q) => q.exchange).sort(),
        observedAt,
      });
    }
    opportunities.sort((a, b) => b.netSpreadPercent - a.netSpreadPercent);

    if (opportunities.length === 0) {
      // Throwing (rather than returning []) is what lets ProviderCache
      // serve the last good comparison inside the stale budget and
      // surface a genuine failure past it. Fabricating a spread from a
      // single venue is never an option: a comparison needs two.
      throw new ExternalArbitrageError('No exchange price data available right now');
    }

    return opportunities;
  }

  private async fetchBinancePrices(): Promise<[string, number][]> {
    const symbols = JSON.stringify(Object.values(BINANCE_SYMBOL));
    const rows = (await this.binanceHttp.getJson(
      `${this.binanceBaseUrl}/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`
    )) as { symbol: string; price: string }[];
    const bySymbol = new Map(rows.map((r) => [r.symbol, parseFloat(r.price)]));
    const out: [string, number][] = [];
    for (const [pair, symbol] of Object.entries(BINANCE_SYMBOL)) {
      const price = bySymbol.get(symbol);
      if (price && price > 0) out.push([pair, price]);
    }
    return out;
  }

  private async fetchOkxPrices(): Promise<[string, number][]> {
    const json = (await this.okxHttp.getJson(`${this.okxBaseUrl}/api/v5/market/tickers?instType=SPOT`)) as {
      data?: { instId: string; last: string }[];
    };
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
