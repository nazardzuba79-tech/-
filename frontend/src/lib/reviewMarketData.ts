/**
 * Read-only public Kraken data for the isolated review bundle. Not a proxy:
 * callers cannot choose a host, upstream endpoint, headers or credentials.
 * Account/order/auth methods remain unavailable in review mode.
 *
 * Shapes mirror KrakenMarketDataService. Asset aliases are normalized, but
 * USD is NOT relabelled USDT: REST and the public WS must describe the same
 * actual market. No generated candles, fallback prices or stale-success data.
 * https://docs.kraken.com/api-reference/market-data/get-ticker-information
 * https://docs.kraken.com/api-reference/market-data/get-ohlc-data
 */
const ORIGIN = 'https://api.kraken.com';
const INTERVALS: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 };
const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };
const MAX_CACHE_ENTRIES = 64;
const MAX_INFLIGHT = 12;
type Kind = 'symbols' | 'tickers' | 'orderbook' | 'candles' | 'trades';
type Read = { kind: Kind; pair?: string; interval?: string; limit?: number };
type JsonRecord = Record<string, unknown>;

export class ReviewMarketDataError extends Error {}
function unavailable(reason: string): never { throw new ReviewMarketDataError(`Kraken public market data unavailable: ${reason}`); }

function parseRead(path: string, method = 'GET'): Read | null {
  if (method.toUpperCase() !== 'GET') return null;
  const match = /^\/market\/external\/(symbols|tickers|orderbook|candles|trades)(?:\/([A-Za-z0-9]{1,20})-([A-Za-z0-9]{1,20}))?(?:\?([^#]*))?$/.exec(path);
  if (!match) return null;
  const kind = match[1] as Kind;
  const pair = match[2] ? `${match[2]}/${match[3]}`.toUpperCase() : undefined;
  if ((kind === 'symbols' && pair) || (!pair && kind !== 'symbols' && kind !== 'tickers')) return null;
  const params = new URLSearchParams(match[4]);
  const allowed = kind === 'candles' ? ['interval', 'limit'] : kind === 'trades' || kind === 'orderbook' ? ['limit'] : [];
  const seen = new Set<string>();
  for (const [key] of params) {
    if (!allowed.includes(key) || seen.has(key)) return null;
    seen.add(key);
  }
  let limit: number | undefined;
  if (kind === 'candles' || kind === 'trades' || kind === 'orderbook') {
    const raw = params.get('limit');
    limit = raw === null ? (kind === 'candles' ? 300 : kind === 'trades' ? 60 : 100) : Number(raw);
    if ((raw !== null && !/^[1-9]\d{0,3}$/.test(raw)) || !Number.isInteger(limit) || limit < 1 || limit > (kind === 'candles' ? 1000 : 200)) return null;
  }
  const interval = kind === 'candles' ? (params.get('interval') ?? '1m') : undefined;
  if (interval !== undefined && !Object.prototype.hasOwnProperty.call(INTERVALS, interval)) return null;
  return { kind, pair, interval, limit };
}

/** Exact app-facing GET allowlist; never accepts an upstream URL or private API. */
export function isReviewMarketRead(path: string, method = 'GET'): boolean {
  return parseRead(path, method) !== null;
}

/** Latest completed 5-minute close at/before the actual 24-hour cutoff.
 * Missing history/gaps never become an invented zero or a today's-open proxy.
 * The reference can precede the exact cutoff by less than five minutes.
 */
export function rollingChangePercent24h(
  lastPrice: number,
  candles: readonly { time: number; close: number }[],
  asOfMs: number,
): number | null {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0 || !Number.isFinite(asOfMs)) return null;
  const cutoff = asOfMs / 1000 - 86400;
  let reference: { end: number; close: number } | null = null;
  for (const candle of candles) {
    const end = candle.time + 300;
    if (!Number.isFinite(end) || !Number.isFinite(candle.close) || candle.close <= 0 || end > cutoff) continue;
    if (!reference || end > reference.end) reference = { end, close: candle.close };
  }
  if (!reference || cutoff - reference.end >= 300) return null;
  const change = ((lastPrice - reference.close) / reference.close) * 100;
  return Number.isFinite(change) ? change : null;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable('invalid provider response');
  return value as JsonRecord;
}
function numeric(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) unavailable('invalid numeric field');
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) unavailable('invalid numeric field');
  return number;
}
function decimal(value: unknown, allowZero = false): string { numeric(value, allowZero); return String(value); }
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) unavailable('missing series');
  return value;
}
function firstSeries(result: JsonRecord): unknown[] {
  const rows = Object.values(result).find(Array.isArray);
  return array(rows);
}

type SymbolInfo = { pair: string; baseAsset: string; quoteAsset: string; key: string; altname: string };
type CacheEntry = { expires: number; value?: JsonRecord; error?: unknown };

export function createReviewMarketDataClient({
  fetchFn = fetch,
  now = Date.now,
  timeoutMs = 10_000,
}: { fetchFn?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<JsonRecord>>();
  const receivedAt = new WeakMap<JsonRecord, number>();
  const timeout = Math.max(1, Math.min(timeoutMs, 30_000));

  async function upstream(endpoint: 'AssetPairs' | 'Ticker' | 'OHLC' | 'Depth' | 'Trades', query: Record<string, string> = {}): Promise<JsonRecord> {
    const suffix = new URLSearchParams(query).toString();
    const url = `${ORIGIN}/0/public/${endpoint}${suffix ? `?${suffix}` : ''}`;
    const cached = cache.get(url);
    if (cached && cached.expires > now()) {
      cache.delete(url); cache.set(url, cached);
      if (cached.error) throw cached.error;
      return cached.value!;
    }
    if (pending.has(url)) return pending.get(url)!;
    if (pending.size >= MAX_INFLIGHT) unavailable('request capacity reached; retry later');
    const ttl = endpoint === 'AssetPairs' ? 300_000
      : endpoint === 'OHLC' && query.interval === '5' ? 60_000
      : endpoint === 'Depth' || endpoint === 'Trades' ? 2000 : 5000;
    const save = (entry: CacheEntry) => {
      cache.delete(url);
      while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(url, entry);
    };
    const operation = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await fetchFn(url, {
              method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
              referrerPolicy: 'no-referrer', signal: controller.signal,
            });
            if (!response.ok) unavailable(`HTTP ${response.status}`);
            const envelope = record(await response.json());
            if (!Array.isArray(envelope.error) || envelope.error.length) unavailable('provider rejected request');
            return record(envelope.result);
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new ReviewMarketDataError('Kraken public market data unavailable: request timed out')); }, timeout);
          }),
        ]);
        receivedAt.set(result, now());
        save({ value: result, expires: now() + ttl });
        return result;
      } catch (error) {
        // Short negative cache bounds retries during CORS/rate-limit/outage
        // failures, without silently serving an expired financial snapshot.
        const failure = error instanceof ReviewMarketDataError ? error : new ReviewMarketDataError('Kraken public market data unavailable: network or CORS failure');
        save({ error: failure, expires: now() + 1500 });
        throw failure;
      } finally { if (timer) clearTimeout(timer); }
    })();
    pending.set(url, operation);
    try { return await operation; }
    finally { if (pending.get(url) === operation) pending.delete(url); }
  }

  async function symbols(): Promise<SymbolInfo[]> {
    const result = await upstream('AssetPairs');
    const pairs = new Map<string, SymbolInfo>();
    for (const [key, value] of Object.entries(result)) {
      const raw = record(value);
      if (typeof raw.wsname !== 'string' || typeof raw.altname !== 'string' || !/^[A-Za-z0-9]{2,40}$/.test(raw.altname)) continue;
      if (raw.status !== undefined && raw.status !== 'online') continue;
      const parts = raw.wsname.toUpperCase().split('/');
      if (parts.length !== 2 || !parts.every(part => /^[A-Z0-9]{1,20}$/.test(part))) continue;
      const [baseAsset, quoteAsset] = parts.map(part => ALIASES[part] ?? part);
      if (baseAsset === quoteAsset) continue;
      const pair = `${baseAsset}/${quoteAsset}`;
      if (!pairs.has(pair)) pairs.set(pair, { pair, baseAsset, quoteAsset, key, altname: raw.altname });
    }
    if (!pairs.size) unavailable('no supported spot pairs');
    return [...pairs.values()];
  }

  function ticker(info: SymbolInfo, data: unknown) {
    const raw = record(data);
    const field = (name: string, index: number, allowZero = false) => decimal(array(raw[name])[index], allowZero);
    const lastPrice = field('c', 0);
    const volume24h = field('v', 1, true);
    const open = numeric(raw.o);
    const vwap = numeric(array(raw.p)[1]);
    const turnover = Number(volume24h) * vwap;
    const change = ((Number(lastPrice) - open) / open) * 100;
    if (!Number.isFinite(turnover) || !Number.isFinite(change)) unavailable('invalid derived ticker values');
    return {
      pair: info.pair, lastPrice, bidPrice: field('b', 0), askPrice: field('a', 0),
      high24h: field('h', 1), low24h: field('l', 1), volume24h,
      quoteVolume24h: turnover.toFixed(2),
      // Preserve the existing backend field convention. Kraken's `o` is
      // today's UTC open; this legacy field name is not a rolling OHLC audit.
      changePercent24h: change.toFixed(4),
    };
  }

  async function read(path: string, options: RequestInit = {}): Promise<unknown> {
    const request = parseRead(path, options.method);
    if (!request || Object.keys(options).some(key => key !== 'method')) {
      throw new ReviewMarketDataError('Public review request is not permitted');
    }
    const infos = await symbols();
    if (request.kind === 'symbols') return { source: 'kraken', symbols: infos.map(({ pair, baseAsset, quoteAsset }) => ({ pair, baseAsset, quoteAsset })) };
    const info = request.pair ? infos.find(candidate => candidate.pair === request.pair) : undefined;
    if (request.pair && !info) unavailable('unknown pair');
    if (request.kind === 'tickers') {
      // Kraken explicitly permits omitting pair to retrieve all tickers.
      // One bounded call replaces a many-batch fan-out in a visitor browser.
      const result = await upstream('Ticker');
      if (info) {
        const current = ticker(info, result[info.key] ?? result[info.altname]);
        let change: number | null = null;
        try {
          // Only the active single-pair ticker requests this bounded, cached
          // public history. The broad market list does not fan out per pair.
          const history = await upstream('OHLC', { pair: info.altname, interval: '5' });
          const candles = firstSeries(history).map(row => {
            const values = array(row);
            return { time: numeric(values[0]), close: numeric(values[4]) };
          });
          change = rollingChangePercent24h(Number(current.lastPrice), candles, receivedAt.get(result)!);
        } catch { /* price remains real; an unavailable reference is not a zero return */ }
        return { source: 'kraken', ticker: {
          ...current, changePercent24h: change === null ? '' : change.toFixed(4), changeReference: 'ROLLING_24H_5M',
        } };
      }
      const tickers = infos.flatMap(candidate => {
        const raw = result[candidate.key] ?? result[candidate.altname];
        if (!raw) return [];
        try { return [ticker(candidate, raw)]; } catch { return []; }
      });
      if (!tickers.length) unavailable('no valid tickers');
      return { source: 'kraken', tickers };
    }
    if (request.kind === 'orderbook') {
      const result = await upstream('Depth', { pair: info!.altname, count: String(request.limit) });
      const book = record(Object.values(result)[0]);
      const levels = (rows: unknown) => array(rows).map(row => {
        const [price, quantity] = array(row);
        return { price: decimal(price), quantity: decimal(quantity, true) };
      });
      return {
        source: 'kraken', pair: info!.pair,
        bids: levels(book.bids).sort((a, b) => Number(b.price) - Number(a.price)).slice(0, request.limit),
        asks: levels(book.asks).sort((a, b) => Number(a.price) - Number(b.price)).slice(0, request.limit),
        timestamp: receivedAt.get(result)!,
      };
    }
    if (request.kind === 'candles') {
      const result = await upstream('OHLC', { pair: info!.altname, interval: String(INTERVALS[request.interval!]) });
      const candles = firstSeries(result).map(row => {
        const [time, open, high, low, close, , volume] = array(row);
        return { time: numeric(time), open: numeric(open), high: numeric(high), low: numeric(low), close: numeric(close), volume: numeric(volume, true) };
      });
      const ordered = [...new Map(candles.map(candle => [candle.time, candle])).values()].sort((a, b) => a.time - b.time);
      // Kraken caps history at 720, including the current forming candle.
      // A larger requested limit never causes invented or padded history.
      return { source: 'kraken', pair: info!.pair, interval: request.interval, candles: ordered.slice(-request.limit!) };
    }
    const result = await upstream('Trades', { pair: info!.altname });
    const trades = firstSeries(result).map((row, index) => {
      const [price, quantity, time, side, , , id] = array(row);
      if (side !== 'b' && side !== 's') unavailable('invalid trade side');
      return {
        id: id == null ? `${time}-${price}-${quantity}-${index}` : String(id),
        price: decimal(price), quantity: decimal(quantity),
        time: Math.round(numeric(time) * 1000), side: side === 'b' ? 'BUY' : 'SELL',
      };
    });
    return { source: 'kraken', pair: info!.pair, trades: trades.sort((a, b) => b.time - a.time).slice(0, request.limit) };
  }

  return { read };
}

const client = createReviewMarketDataClient();
export const readReviewMarketData = client.read;
