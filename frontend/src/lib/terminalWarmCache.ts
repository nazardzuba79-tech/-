import type { MarketTicker } from './api';
import type { LiveQuote } from './liveMarketTypes';

/**
 * Browser-only warm caches used for first paint.
 *
 * They NEVER replace a network refresh and NEVER create an extra request.
 * Their only job is to let the terminal paint the last known real market
 * catalogue/quotes immediately while the existing single poll/SSE stream
 * reconnects in the background.
 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const SPOT_KEY = 'voltex:warm:spot-tickers:v1';
const FUTURES_SYMBOLS_KEY = 'voltex:warm:futures-symbols:v1';
const LIVE_QUOTES_KEY = 'voltex:warm:live-quotes:v1';

// Short on purpose: cached prices are only a visual bridge during reload.
// Every read is marked stale and a real refresh starts immediately.
export const SPOT_WARM_MAX_AGE_MS = 15 * 60_000;
export const LIVE_WARM_MAX_AGE_MS = 15 * 60_000;
// Instrument catalogues change far less often than prices.
export const FUTURES_SYMBOLS_MAX_AGE_MS = 24 * 60 * 60_000;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readObject(storage: StorageLike | null, key: string): Record<string, unknown> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isFresh(savedAt: unknown, maxAge: number, now: number): savedAt is number {
  return typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= maxAge;
}

function finiteOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export interface SpotWarmCache {
  tickers: MarketTicker[];
  source: string;
  fetchedAt: number;
}

export function readSpotWarmCache(storage: StorageLike | null = browserStorage(), now = Date.now()): SpotWarmCache | null {
  const parsed = readObject(storage, SPOT_KEY);
  if (!parsed || parsed.version !== 1 || !isFresh(parsed.savedAt, SPOT_WARM_MAX_AGE_MS, now) || !Array.isArray(parsed.tickers)) return null;
  const tickers = parsed.tickers
    .filter((ticker): ticker is MarketTicker => !!ticker && typeof ticker === 'object' && typeof (ticker as MarketTicker).pair === 'string')
    .slice(0, 5_000);
  if (!tickers.length) return null;
  return {
    tickers,
    source: typeof parsed.source === 'string' ? parsed.source : 'warm-cache',
    fetchedAt: typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : parsed.savedAt,
  };
}

export function writeSpotWarmCache(cache: SpotWarmCache, storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  if (!storage || !cache.tickers.length) return;
  try {
    storage.setItem(SPOT_KEY, JSON.stringify({
      version: 1,
      savedAt: now,
      fetchedAt: cache.fetchedAt,
      source: cache.source,
      tickers: cache.tickers.slice(0, 5_000),
    }));
  } catch {
    // Storage quota/privacy mode must never break live market data.
  }
}

export function readFuturesSymbolCache(storage: StorageLike | null = browserStorage(), now = Date.now()): string[] | null {
  const parsed = readObject(storage, FUTURES_SYMBOLS_KEY);
  if (!parsed || parsed.version !== 1 || !isFresh(parsed.savedAt, FUTURES_SYMBOLS_MAX_AGE_MS, now) || !Array.isArray(parsed.symbols)) return null;
  const symbols = [...new Set(parsed.symbols
    .filter((symbol): symbol is string => typeof symbol === 'string' && /^[A-Z0-9._-]{1,24}\/USDT$/.test(symbol))
    .slice(0, 5_000))];
  return symbols.length ? symbols : null;
}

export function writeFuturesSymbolCache(symbols: string[], storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  if (!storage) return;
  const safe = [...new Set(symbols.filter(symbol => /^[A-Z0-9._-]{1,24}\/USDT$/.test(symbol)))].slice(0, 5_000);
  if (!safe.length) return;
  try {
    storage.setItem(FUTURES_SYMBOLS_KEY, JSON.stringify({ version: 1, savedAt: now, symbols: safe }));
  } catch {
    // Best-effort UI acceleration only.
  }
}

export function readLiveQuoteCache(storage: StorageLike | null = browserStorage(), now = Date.now()): LiveQuote[] | null {
  const parsed = readObject(storage, LIVE_QUOTES_KEY);
  if (!parsed || parsed.version !== 1 || !isFresh(parsed.savedAt, LIVE_WARM_MAX_AGE_MS, now) || !Array.isArray(parsed.rows)) return null;
  const rows = parsed.rows.filter((row): row is LiveQuote => {
    if (!row || typeof row !== 'object') return false;
    const quote = row as LiveQuote;
    if (typeof quote.id !== 'string' || typeof quote.pair !== 'string' || typeof quote.providerSymbol !== 'string'
      || typeof quote.baseAsset !== 'string' || typeof quote.quoteAsset !== 'string') return false;
    return [quote.lastPrice, quote.bidPrice, quote.askPrice, quote.high24h, quote.low24h, quote.volume24h,
      quote.quoteVolume24h, quote.changePercent24h, quote.indexPrice, quote.markPrice, quote.fundingRate,
      quote.openInterest, quote.openInterestValue].every(finiteOrNull);
  }).slice(0, 5_000).map(row => ({ ...row, stale: true }));
  return rows.length ? rows : null;
}

export function writeLiveQuoteCache(rows: Iterable<LiveQuote>, storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  if (!storage) return;
  const values = Array.from(rows).slice(0, 5_000);
  if (!values.length) return;
  try {
    storage.setItem(LIVE_QUOTES_KEY, JSON.stringify({ version: 1, savedAt: now, rows: values }));
  } catch {
    // Best-effort UI acceleration only.
  }
}
