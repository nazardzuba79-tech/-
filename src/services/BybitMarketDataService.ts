/**
 * Read-only mirror of Bybit's public spot market data (no API key needed —
 * these are public endpoints). Used to show a real market reference next to
 * our own (currently thin) internal order book: available coins, live
 * price, and order book depth from Bybit.
 *
 * This NEVER places, cancels, or influences orders on Bybit or on our own
 * matching engine — it only reads and caches. See README for why a
 * read-only mirror was chosen over auto-replicating orders (capital/risk).
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
  volume24h: string;
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

// Bybit updates spot tickers roughly once a second; polling faster than
// this just burns rate limit for no fresher data. Order book depth changes
// faster, so it gets a shorter TTL. The symbol list barely changes, hence
// the long TTL.
const SYMBOLS_TTL_MS = 5 * 60_000;
const TICKERS_TTL_MS = 5_000;
const ORDERBOOK_TTL_MS = 2_000;

interface BybitInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
}

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
  highPrice24h: string;
  lowPrice24h: string;
  volume24h: string;
  price24hPcnt: string;
}

interface BybitOrderBookResult {
  s: string;
  b: [string, string][];
  a: [string, string][];
  ts: number;
}

export class BybitMarketDataService {
  private symbolsCache: { bySymbol: Map<string, MarketSymbol>; expiresAt: number } | null = null;
  private tickersCache: { byPair: Map<string, MarketTicker>; expiresAt: number } | null = null;
  private readonly orderBookCache = new Map<string, { data: MarketOrderBookSnapshot; expiresAt: number }>();

  constructor(
    private readonly baseUrl = 'https://api.bybit.com',
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async listSymbols(): Promise<MarketSymbol[]> {
    const bySymbol = await this.getSymbolsMap();
    return Array.from(bySymbol.values());
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

    const symbol = pairToBybitSymbol(normalizedPair);
    const body = await this.request(`/v5/market/orderbook?category=spot&symbol=${symbol}&limit=${limit}`);
    const result = body.result as BybitOrderBookResult;

    const snapshot: MarketOrderBookSnapshot = {
      pair: normalizedPair,
      bids: result.b.map(([price, quantity]) => ({ price, quantity })),
      asks: result.a.map(([price, quantity]) => ({ price, quantity })),
      timestamp: Number(result.ts),
    };
    this.orderBookCache.set(normalizedPair, { data: snapshot, expiresAt: Date.now() + ORDERBOOK_TTL_MS });
    return snapshot;
  }

  private async getSymbolsMap(): Promise<Map<string, MarketSymbol>> {
    if (this.symbolsCache && this.symbolsCache.expiresAt > Date.now()) {
      return this.symbolsCache.bySymbol;
    }
    const body = await this.request('/v5/market/instruments-info?category=spot');
    const bySymbol = new Map<string, MarketSymbol>();
    for (const instrument of body.result.list as BybitInstrument[]) {
      if (instrument.status !== 'Trading') continue;
      bySymbol.set(instrument.symbol, {
        pair: `${instrument.baseCoin}/${instrument.quoteCoin}`,
        baseAsset: instrument.baseCoin,
        quoteAsset: instrument.quoteCoin,
      });
    }
    this.symbolsCache = { bySymbol, expiresAt: Date.now() + SYMBOLS_TTL_MS };
    return bySymbol;
  }

  private async getTickersMap(): Promise<Map<string, MarketTicker>> {
    if (this.tickersCache && this.tickersCache.expiresAt > Date.now()) {
      return this.tickersCache.byPair;
    }
    const [symbolsBySymbol, body] = await Promise.all([
      this.getSymbolsMap(),
      this.request('/v5/market/tickers?category=spot'),
    ]);

    const byPair = new Map<string, MarketTicker>();
    for (const ticker of body.result.list as BybitTicker[]) {
      // Tickers include instruments beyond plain spot Trading pairs (e.g.
      // delisted symbols); skip anything not in the known symbol map so we
      // never surface a pair we can't also resolve an order book for.
      const info = symbolsBySymbol.get(ticker.symbol);
      if (!info) continue;
      byPair.set(info.pair, {
        pair: info.pair,
        lastPrice: ticker.lastPrice,
        bidPrice: ticker.bid1Price,
        askPrice: ticker.ask1Price,
        high24h: ticker.highPrice24h,
        low24h: ticker.lowPrice24h,
        volume24h: ticker.volume24h,
        changePercent24h: ticker.price24hPcnt,
      });
    }
    this.tickersCache = { byPair, expiresAt: Date.now() + TICKERS_TTL_MS };
    return byPair;
  }

  private async request(path: string): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`);
    } catch (err: any) {
      throw new ExternalMarketDataError(`Failed to reach Bybit: ${err.message}`);
    }
    if (!res.ok) {
      throw new ExternalMarketDataError(`Bybit responded with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { retCode: number; retMsg?: string };
    if (body.retCode !== 0) {
      throw new ExternalMarketDataError(`Bybit error: ${body.retMsg ?? 'unknown'}`);
    }
    return body;
  }
}

export function pairToBybitSymbol(pair: string): string {
  return pair.toUpperCase().replace('/', '');
}
