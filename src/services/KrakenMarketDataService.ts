/**
 * Read-only mirror of Kraken's public spot market data (no API key needed —
 * these are public endpoints). Used to show a real market reference next to
 * our own (currently thin) internal order book: available coins, live
 * price, order book depth, recent trades, and candles.
 *
 * We use Kraken here instead of Bybit because Bybit's public API blocks
 * requests from US-hosted servers (which is where this backend runs by
 * default on Render) for regulatory reasons — Kraken's public endpoints
 * don't have that restriction.
 *
 * This NEVER places, cancels, or influences orders on Kraken or on our own
 * matching engine — it only reads and caches.
 */

export class ExternalMarketDataError extends Error {}

export interface MarketSymbol {
  pair: string; // "BTC/USDT" — our internal pair format
  baseAsset: string;
  quoteAsset: string;
}

export interface MarketTicker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string; // in the base asset (e.g. BTC)
  quoteVolume24h: string; // in the quote asset (e.g. USDT) — volume24h * 24h VWAP
  // Already a percentage value (e.g. "2.10" means +2.10%), NOT a fraction
  // — every frontend call site must parse this directly. Re-multiplying
  // by 100 turns a real +2.1% move into a displayed +210% (this exact bug
  // shipped in several components before being caught — see
  // frontend/src/lib/priceChange.ts, which every call site now goes
  // through).
  changePercent24h: string;
}

export interface MarketOrderBookLevel {
  price: string;
  quantity: string;
}

export interface MarketOrderBookSnapshot {
  pair: string;
  bids: MarketOrderBookLevel[]; // sorted descending by price
  asks: MarketOrderBookLevel[]; // sorted ascending by price
  timestamp: number;
}

export interface MarketCandle {
  time: number; // unix seconds, for lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTrade {
  id: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  time: number; // unix ms
}

const SYMBOLS_TTL_MS = 5 * 60_000;
const TICKERS_TTL_MS = 5_000;
const ORDERBOOK_TTL_MS = 2_000;
const CANDLES_TTL_MS = 5_000;
const TRADES_TTL_MS = 2_000;

// Kraken renamed a few assets long ago (legacy ticker codes) — its
// AssetPairs "wsname" still uses these instead of the common ticker.
const ASSET_ALIASES: Record<string, string> = {
  XBT: 'BTC',
  XDG: 'DOGE',
};

// Our interval labels -> Kraken's OHLC interval, in minutes.
const INTERVAL_MAP: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

interface KrakenAssetPair {
  altname: string;
  wsname?: string;
  base: string;
  quote: string;
}

interface SymbolInfo {
  pair: string;
  baseAsset: string;
  quoteAsset: string;
  krakenName: string; // altname — what we pass as the "pair" query param
}

// Kraken's public endpoints cap how many pairs can be requested in one
// call; batch ticker lookups to stay well under that.
const TICKER_BATCH_SIZE = 40;
// Kraken lists several hundred tradeable pairs, so a full ticker refresh is
// many dozens of these batches. Running them one at a time (the original
// approach) meant a full walk could take tens of seconds — long enough to
// outlive TICKERS_TTL_MS itself, so the pair list could sit empty while a
// fresh walk kept restarting under it. This caps how many batches run
// concurrently: fast enough to comfortably finish inside the cache TTL,
// without firing every batch at once against Kraken's public API.
const TICKER_CONCURRENCY = 6;

export class KrakenMarketDataService {
  private symbolsCache: { byPair: Map<string, SymbolInfo>; expiresAt: number } | null = null;
  private tickersCache: { byPair: Map<string, MarketTicker>; expiresAt: number } | null = null;
  // Shared by every caller that lands mid-walk, so a burst of requests
  // while the cache is cold/expired triggers one walk, not one each.
  private tickersInFlight: Promise<Map<string, MarketTicker>> | null = null;
  private readonly orderBookCache = new Map<string, { data: MarketOrderBookSnapshot; expiresAt: number }>();
  private readonly candlesCache = new Map<string, { data: MarketCandle[]; expiresAt: number }>();
  private readonly tradesCache = new Map<string, { data: MarketTrade[]; expiresAt: number }>();

  constructor(
    private readonly baseUrl = 'https://api.kraken.com',
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async listSymbols(): Promise<MarketSymbol[]> {
    const byPair = await this.getSymbolsMap();
    return Array.from(byPair.values()).map(({ pair, baseAsset, quoteAsset }) => ({ pair, baseAsset, quoteAsset }));
  }

  async getTickers(): Promise<MarketTicker[]> {
    const byPair = await this.getTickersMap();
    return Array.from(byPair.values());
  }

  async getTicker(pair: string): Promise<MarketTicker | null> {
    const byPair = await this.getTickersMap();
    return byPair.get(pair.toUpperCase()) ?? null;
  }

  async getOrderBook(pair: string, limit = 50): Promise<MarketOrderBookSnapshot> {
    const normalizedPair = pair.toUpperCase();
    const cached = this.orderBookCache.get(normalizedPair);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const info = await this.requireSymbol(normalizedPair);
    const body = await this.request(`/0/public/Depth?pair=${info.krakenName}&count=${limit}`);
    const result = Object.values(body.result)[0] as { asks: [string, string, number][]; bids: [string, string, number][] };

    const snapshot: MarketOrderBookSnapshot = {
      pair: normalizedPair,
      bids: result.bids.map(([price, quantity]) => ({ price, quantity })),
      asks: result.asks.map(([price, quantity]) => ({ price, quantity })),
      timestamp: Date.now(),
    };
    this.orderBookCache.set(normalizedPair, { data: snapshot, expiresAt: Date.now() + ORDERBOOK_TTL_MS });
    return snapshot;
  }

  async getCandles(pair: string, interval: string, limit = 300): Promise<MarketCandle[]> {
    const krakenInterval = INTERVAL_MAP[interval];
    if (!krakenInterval) throw new ExternalMarketDataError(`Unsupported interval: ${interval}`);

    const normalizedPair = pair.toUpperCase();
    const cacheKey = `${normalizedPair}:${interval}:${limit}`;
    const cached = this.candlesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const info = await this.requireSymbol(normalizedPair);
    const body = await this.request(`/0/public/OHLC?pair=${info.krakenName}&interval=${krakenInterval}`);
    const rows = Object.values(body.result).find((v) => Array.isArray(v)) as
      | [number, string, string, string, string, string, string, number][]
      | undefined;
    if (!rows) throw new ExternalMarketDataError(`No OHLC data for ${normalizedPair}`);

    // Kraken already returns candles oldest-first.
    const candles: MarketCandle[] = rows.slice(-limit).map(([time, open, high, low, close, , volume]) => ({
      time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }));
    this.candlesCache.set(cacheKey, { data: candles, expiresAt: Date.now() + CANDLES_TTL_MS });
    return candles;
  }

  async getRecentTrades(pair: string, limit = 60): Promise<MarketTrade[]> {
    const normalizedPair = pair.toUpperCase();
    const cached = this.tradesCache.get(normalizedPair);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const info = await this.requireSymbol(normalizedPair);
    const body = await this.request(`/0/public/Trades?pair=${info.krakenName}`);
    const rows = Object.values(body.result).find((v) => Array.isArray(v)) as
      | [string, string, number, string, string, string][]
      | undefined;
    if (!rows) throw new ExternalMarketDataError(`No trade data for ${normalizedPair}`);

    const trades: MarketTrade[] = rows
      .slice(-limit)
      .reverse() // Kraken returns oldest-first; a trade tape reads newest-first.
      .map(([price, volume, time, side], idx) => ({
        id: `${time}-${price}-${volume}-${idx}`,
        price,
        quantity: volume,
        side: side === 'b' ? 'BUY' : 'SELL',
        time: Math.round(time * 1000),
      }));
    this.tradesCache.set(normalizedPair, { data: trades, expiresAt: Date.now() + TRADES_TTL_MS });
    return trades;
  }

  private async requireSymbol(normalizedPair: string): Promise<SymbolInfo> {
    const byPair = await this.getSymbolsMap();
    const info = byPair.get(normalizedPair);
    if (!info) throw new ExternalMarketDataError(`Unknown pair: ${normalizedPair}`);
    return info;
  }

  private async getSymbolsMap(): Promise<Map<string, SymbolInfo>> {
    if (this.symbolsCache && this.symbolsCache.expiresAt > Date.now()) {
      return this.symbolsCache.byPair;
    }
    const body = await this.request('/0/public/AssetPairs');
    const byPair = new Map<string, SymbolInfo>();
    for (const [, raw] of Object.entries(body.result as Record<string, KrakenAssetPair>)) {
      if (!raw.wsname) continue; // pairs without a wsname aren't tradeable spot pairs (e.g. dark pool)
      const [rawBase, rawQuote] = raw.wsname.split('/');
      if (!rawBase || !rawQuote) continue;
      const baseAsset = ASSET_ALIASES[rawBase] ?? rawBase;
      const quoteAsset = ASSET_ALIASES[rawQuote] ?? rawQuote;
      const pair = `${baseAsset}/${quoteAsset}`;
      // Prefer the first mapping seen for a given normalized pair (Kraken
      // sometimes lists both a spot pair and its ".d" dark-pool twin).
      if (!byPair.has(pair)) {
        byPair.set(pair, { pair, baseAsset, quoteAsset, krakenName: raw.altname });
      }
    }

    // Kraken lists plenty of coins (TRX among them) only against USD, never
    // USDT — but every pair elsewhere in this app is quoted in USDT. USDT
    // tracks USD closely enough (sub-cent in practice) that reusing the
    // same Kraken ticker under a "/USDT" label is a fair stand-in, not a
    // fabricated price — it's still Kraken's real, live number for that
    // coin.
    //
    // This now wins even when a genuine Kraken USDT pair also exists.
    // Kraken launched as a USD/EUR exchange in 2013 and only added
    // USDT-quoted markets years later; for most majors (BTC/ETH among
    // them) the legacy USD market is still by far the deeper, more liquid
    // one — its native USDT pair can show 24h volume in the low hundreds
    // of coins, which reads on the chart as thin, choppy candles with
    // oversized wicks. Preferring the USD market's real Kraken data under
    // the "/USDT" label fixes that without fabricating anything: same
    // reasoning as the TRX-style gap fill above, just applied whenever
    // it's actually the more liquid of the two rather than only when the
    // USDT pair is missing outright. A coin genuinely listed only against
    // USDT on Kraken (no USD counterpart at all) is unaffected — this loop
    // only runs for entries that came from a real "/USD" pair.
    for (const info of Array.from(byPair.values())) {
      if (info.quoteAsset !== 'USD') continue;
      const usdtPair = `${info.baseAsset}/USDT`;
      byPair.set(usdtPair, { pair: usdtPair, baseAsset: info.baseAsset, quoteAsset: 'USDT', krakenName: info.krakenName });
    }

    this.symbolsCache = { byPair, expiresAt: Date.now() + SYMBOLS_TTL_MS };
    return byPair;
  }

  private async getTickersMap(): Promise<Map<string, MarketTicker>> {
    if (this.tickersCache && this.tickersCache.expiresAt > Date.now()) {
      return this.tickersCache.byPair;
    }
    if (this.tickersInFlight) return this.tickersInFlight;

    this.tickersInFlight = this.fetchTickersMap().finally(() => {
      this.tickersInFlight = null;
    });
    return this.tickersInFlight;
  }

  private async fetchTickersMap(): Promise<Map<string, MarketTicker>> {
    const symbolsByPair = await this.getSymbolsMap();
    const infos = Array.from(symbolsByPair.values());

    const batches: SymbolInfo[][] = [];
    for (let i = 0; i < infos.length; i += TICKER_BATCH_SIZE) {
      batches.push(infos.slice(i, i + TICKER_BATCH_SIZE));
    }

    const byPair = new Map<string, MarketTicker>();
    for (let i = 0; i < batches.length; i += TICKER_CONCURRENCY) {
      const group = batches.slice(i, i + TICKER_CONCURRENCY);
      const groupResults = await Promise.all(
        group.map(async (batch) => ({
          batch,
          body: await this.request(`/0/public/Ticker?pair=${batch.map((b) => b.krakenName).join(',')}`),
        }))
      );
      for (const { batch, body } of groupResults) {
        const resultByKrakenName = new Map(Object.entries(body.result)) as Map<
          string,
          {
            c: [string, string];
            b: [string, string, string];
            a: [string, string, string];
            h: [string, string];
            l: [string, string];
            v: [string, string];
            p: [string, string]; // volume-weighted average price: [today, last 24h]
            o: string;
          }
        >;
        for (const info of batch) {
          const raw = resultByKrakenName.get(info.krakenName);
          if (!raw) continue; // Kraken didn't return this pair (delisted/suspended) — just skip it
          const lastPrice = Number(raw.c[0]);
          const openPrice = Number(raw.o);
          const changePercent24h = openPrice === 0 ? '0' : (((lastPrice - openPrice) / openPrice) * 100).toFixed(4);
          // Prefer the real 24h VWAP for turnover, but fall back to last
          // price if Kraken ever returns a missing/zero VWAP (illiquid pair,
          // API quirk) — better an approximation than a silent "0".
          const vwap = Number(raw.p?.[1]);
          const effectivePrice = vwap > 0 ? vwap : lastPrice;
          const quoteVolume24h = (Number(raw.v[1]) * effectivePrice).toFixed(2);
          byPair.set(info.pair, {
            pair: info.pair,
            lastPrice: raw.c[0],
            bidPrice: raw.b[0],
            askPrice: raw.a[0],
            high24h: raw.h[1],
            low24h: raw.l[1],
            volume24h: raw.v[1],
            quoteVolume24h,
            changePercent24h,
          });
        }
      }
    }
    this.tickersCache = { byPair, expiresAt: Date.now() + TICKERS_TTL_MS };
    return byPair;
  }

  private async request(path: string): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`);
    } catch (err: any) {
      throw new ExternalMarketDataError(`Failed to reach Kraken: ${err.message}`);
    }
    if (!res.ok) {
      throw new ExternalMarketDataError(`Kraken responded with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { error: string[]; result: any };
    if (body.error && body.error.length > 0) {
      throw new ExternalMarketDataError(`Kraken error: ${body.error.join(', ')}`);
    }
    return body;
  }
}

export function pairToKrakenSymbol(pair: string): string {
  return pair.toUpperCase().replace('/', '');
}
