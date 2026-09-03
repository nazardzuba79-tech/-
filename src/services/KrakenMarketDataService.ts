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

import { ProviderCache } from './marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  ProviderRequestPolicy,
  ProviderUnavailableError,
  logCircuitTransition,
  providerHealthRegistry,
} from './marketData/ProviderHealth';

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

// TTLs by data type, and how long each may still be served past its TTL if
// a refresh FAILS (see ProviderCache). The staleness budgets are graded by
// how much a stale value could mislead someone:
//
//  - symbols: a pair listing barely changes; an hour-old list beats an
//    empty exchange.
//  - tickers/order book: trading-adjacent. A short grace covers a single
//    failed poll; past that the API says "unavailable" rather than dressing
//    up an old price as current.
//  - candles: closed candles are immutable, so the only stale part is the
//    newest bucket — a generous grace here just keeps the chart drawn.
const SYMBOLS_TTL_MS = 5 * 60_000;
const SYMBOLS_MAX_STALE_MS = 60 * 60_000;
const TICKERS_TTL_MS = 5_000;
const TICKERS_MAX_STALE_MS = 60_000;
const ORDERBOOK_TTL_MS = 2_000;
const ORDERBOOK_MAX_STALE_MS = 10_000;
// The open (still-forming) candle is the only part of a series that can
// change, so this is really "how often do we top up the tail".
const CANDLES_TTL_MS = 5_000;
const CANDLES_MAX_STALE_MS = 10 * 60_000;
const TRADES_TTL_MS = 2_000;
const TRADES_MAX_STALE_MS = 30_000;

// Longest candle series kept per pair+interval. Bounds memory per entry the
// same way ProviderCache bounds the number of entries.
const MAX_CACHED_CANDLES = 1000;

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
  // Every cache below is a ProviderCache: TTL + in-flight deduplication +
  // stale-last-good + an LRU bound. Before this, only the ticker walk
  // deduplicated concurrent callers and none of the per-pair maps had a
  // ceiling — three visitors opening the same chart at once meant three
  // identical outbound requests, and an arbitrary-symbol caller could grow
  // the maps without limit.
  private readonly symbols: ProviderCache<Map<string, SymbolInfo>>;
  private readonly tickers: ProviderCache<Map<string, MarketTicker>>;
  private readonly orderBooks: ProviderCache<MarketOrderBookSnapshot>;
  private readonly candleSeries: ProviderCache<MarketCandle[]>;
  private readonly trades: ProviderCache<MarketTrade[]>;
  private readonly http: HttpProviderClient;
  readonly health: ProviderHealth;

  constructor(
    private readonly baseUrl = 'https://api.kraken.com',
    private readonly fetchFn: typeof fetch = fetch,
    policy: ProviderRequestPolicy = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('kraken', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Kraken', {
      ...policy,
      fetchFn: this.fetchFn,
      health: this.health,
      wrapError: (message) => new ExternalMarketDataError(message),
    });

    const onStaleServe = (key: string, ageMs: number) =>
      console.warn(`[marketData] kraken serving stale ${key} (${Math.round(ageMs / 1000)}s old)`);
    this.symbols = new ProviderCache({ ttlMs: SYMBOLS_TTL_MS, maxStaleMs: SYMBOLS_MAX_STALE_MS, maxEntries: 4, onStaleServe });
    this.tickers = new ProviderCache({ ttlMs: TICKERS_TTL_MS, maxStaleMs: TICKERS_MAX_STALE_MS, maxEntries: 4, onStaleServe });
    this.orderBooks = new ProviderCache({ ttlMs: ORDERBOOK_TTL_MS, maxStaleMs: ORDERBOOK_MAX_STALE_MS, maxEntries: 120, onStaleServe });
    this.candleSeries = new ProviderCache({ ttlMs: CANDLES_TTL_MS, maxStaleMs: CANDLES_MAX_STALE_MS, maxEntries: 120, onStaleServe });
    this.trades = new ProviderCache({ ttlMs: TRADES_TTL_MS, maxStaleMs: TRADES_MAX_STALE_MS, maxEntries: 120, onStaleServe });
  }

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
    // Keyed with the depth too: a 200-level request must not be served the
    // 50-level snapshot a different caller just cached.
    const cached = await this.orderBooks.fetch(`${normalizedPair}:${limit}`, async () => {
      const info = await this.requireSymbol(normalizedPair);
      const body = await this.request(`/0/public/Depth?pair=${info.krakenName}&count=${limit}`);
      const result = Object.values(body.result)[0] as { asks: [string, string, number][]; bids: [string, string, number][] };
      return {
        pair: normalizedPair,
        bids: result.bids.map(([price, quantity]) => ({ price, quantity })),
        asks: result.asks.map(([price, quantity]) => ({ price, quantity })),
        timestamp: Date.now(),
      } satisfies MarketOrderBookSnapshot;
    });
    return cached.value;
  }

  /**
   * Candles, cached as ONE series per pair+interval rather than per
   * requested `limit`, and topped up rather than re-downloaded.
   *
   * A closed candle never changes: once 12:00-12:05 is over, its OHLCV is
   * final forever. Only the newest bucket is still forming. The old cache
   * ignored that — it keyed on `pair:interval:limit` with a 5s TTL, so the
   * BTC -> ETH -> SOL -> BTC navigation every trader does re-downloaded
   * BTC's entire ~720-candle history on the way back, every time.
   *
   * Now the first request for a pair+interval fetches the full window and
   * keeps it; subsequent requests past the TTL ask Kraken for candles
   * `since` the last CLOSED bucket, which returns the handful that have
   * happened since (usually one or two), and merge them in — the
   * previously-open candle is replaced by its now-closed version, so no
   * incomplete bucket is ever kept as history. `limit` is applied as a
   * slice of the shared series, so two consumers asking for 300 and 720
   * candles still cost one request.
   */
  async getCandles(pair: string, interval: string, limit = 300): Promise<MarketCandle[]> {
    const krakenInterval = INTERVAL_MAP[interval];
    if (!krakenInterval) throw new ExternalMarketDataError(`Unsupported interval: ${interval}`);

    const normalizedPair = pair.toUpperCase();
    const key = `${normalizedPair}:${interval}`;
    const cached = await this.candleSeries.fetch(key, async () => {
      const previous = this.candleSeries.peek(key)?.value;
      const info = await this.requireSymbol(normalizedPair);

      // Only ask for the tail when we already hold history AND the gap is
      // small enough that Kraken's window covers it — otherwise a chart
      // reopened hours later would silently keep a hole in the middle.
      const lastClosed = previous && previous.length >= 2 ? previous[previous.length - 2] : null;
      const intervalSeconds = krakenInterval * 60;
      const gapCandles = lastClosed ? (Date.now() / 1000 - lastClosed.time) / intervalSeconds : Infinity;
      const useSince = lastClosed !== null && gapCandles < 500;

      const query = `/0/public/OHLC?pair=${info.krakenName}&interval=${krakenInterval}` + (useSince ? `&since=${lastClosed!.time}` : '');
      const body = await this.request(query);
      const rows = Object.values(body.result).find((v) => Array.isArray(v)) as
        | [number, string, string, string, string, string, string, number][]
        | undefined;
      if (!rows) throw new ExternalMarketDataError(`No OHLC data for ${normalizedPair}`);

      // Kraken already returns candles oldest-first.
      const fetched: MarketCandle[] = rows.map(([time, open, high, low, close, , volume]) => ({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      }));

      if (!useSince || !previous) return fetched.slice(-MAX_CACHED_CANDLES);
      return mergeCandleSeries(previous, fetched).slice(-MAX_CACHED_CANDLES);
    });

    return cached.value.slice(-limit);
  }

  async getRecentTrades(pair: string, limit = 60): Promise<MarketTrade[]> {
    const normalizedPair = pair.toUpperCase();
    const cached = await this.trades.fetch(`${normalizedPair}:${limit}`, async () => {
      const info = await this.requireSymbol(normalizedPair);
      const body = await this.request(`/0/public/Trades?pair=${info.krakenName}`);
      const rows = Object.values(body.result).find((v) => Array.isArray(v)) as
        | [string, string, number, string, string, string][]
        | undefined;
      if (!rows) throw new ExternalMarketDataError(`No trade data for ${normalizedPair}`);

      return rows
        .slice(-limit)
        .reverse() // Kraken returns oldest-first; a trade tape reads newest-first.
        .map(([price, volume, time, side], idx) => ({
          id: `${time}-${price}-${volume}-${idx}`,
          price,
          quantity: volume,
          side: side === 'b' ? 'BUY' : ('SELL' as 'BUY' | 'SELL'),
          time: Math.round(time * 1000),
        }));
    });
    return cached.value;
  }

  private async requireSymbol(normalizedPair: string): Promise<SymbolInfo> {
    const byPair = await this.getSymbolsMap();
    const info = byPair.get(normalizedPair);
    if (!info) throw new ExternalMarketDataError(`Unknown pair: ${normalizedPair}`);
    return info;
  }

  private async getSymbolsMap(): Promise<Map<string, SymbolInfo>> {
    const cached = await this.symbols.fetch('assetPairs', () => this.fetchSymbolsMap());
    return cached.value;
  }

  private async fetchSymbolsMap(): Promise<Map<string, SymbolInfo>> {
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
      // USDT/USD would relabel to "USDT/USDT" — an asset quoted against
      // itself, which is not a market and showed up in the pair list as a
      // junk row priced at ~1.00. Nothing else can collide this way: only
      // USDT itself produces a self-pair under a "/USDT" label.
      if (info.baseAsset === 'USDT') continue;
      const usdtPair = `${info.baseAsset}/USDT`;
      byPair.set(usdtPair, { pair: usdtPair, baseAsset: info.baseAsset, quoteAsset: 'USDT', krakenName: info.krakenName });
    }

    return byPair;
  }

  private async getTickersMap(): Promise<Map<string, MarketTicker>> {
    // ProviderCache supplies what the hand-rolled `tickersInFlight` field
    // used to: one shared walk for every caller that lands while it runs.
    const cached = await this.tickers.fetch('all', () => this.fetchTickersMap());
    return cached.value;
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
        type RawTicker = { c: [string, string]; b: [string, string, string]; a: [string, string, string]; h: [string, string]; l: [string, string]; v: [string, string]; p: [string, string]; o: string };
        for (const info of batch) {
          let raw: RawTicker | undefined = resultByKrakenName.get(info.krakenName);
          if (!raw) {
            // A batched request keys its response by whatever pair
            // identifier Kraken's Ticker endpoint chooses to echo back —
            // for most pairs that's the altname we requested, but for a
            // handful of legacy-prefixed majors (this is what the "prefer
            // the deeper USD market" substitution above tends to select
            // for) it can differ, so the exact-key lookup above misses
            // them even though the pair is perfectly valid. Every other
            // endpoint here (Depth/OHLC/Trades) already sidesteps this by
            // not caring about the response key at all — a single-pair
            // retry can do the same (Object.values(...)[0] is
            // unambiguous when only one pair was asked for), rather than
            // silently dropping a pair that's actually fine.
            try {
              const singleBody = await this.request(`/0/public/Ticker?pair=${info.krakenName}`);
              raw = Object.values(singleBody.result)[0] as RawTicker | undefined;
            } catch {
              // still unavailable — fall through to the skip below
            }
          }
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
    return byPair;
  }

  /**
   * Every outbound Kraken call goes through the shared HTTP policy:
   * bounded retries with jittered backoff, Retry-After respect, 429
   * accounting, and a circuit that stops hammering a provider that is
   * already failing. Kraken's own body-level `error[]` convention is
   * checked here because only this service knows about it.
   */
  private async request(path: string): Promise<any> {
    let body: { error: string[]; result: any };
    try {
      body = (await this.http.getJson(`${this.baseUrl}${path}`)) as { error: string[]; result: any };
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new ExternalMarketDataError('Kraken is temporarily unavailable');
      }
      throw err;
    }
    if (body.error && body.error.length > 0) {
      throw new ExternalMarketDataError(`Kraken error: ${body.error.join(', ')}`);
    }
    return body;
  }
}

/**
 * Merges a freshly-fetched tail into an existing series. Later data wins
 * for any bucket present in both — which is exactly what turns the
 * previously-open candle into its final closed form — and the result stays
 * sorted oldest-first with one entry per bucket.
 */
export function mergeCandleSeries(previous: MarketCandle[], tail: MarketCandle[]): MarketCandle[] {
  if (tail.length === 0) return previous;
  const byTime = new Map<number, MarketCandle>();
  for (const candle of previous) byTime.set(candle.time, candle);
  for (const candle of tail) byTime.set(candle.time, candle);
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function pairToKrakenSymbol(pair: string): string {
  return pair.toUpperCase().replace('/', '');
}
