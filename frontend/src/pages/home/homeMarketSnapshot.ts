import type {
  HomeBook, HomeCandle, HomeCfd, HomeFearGreed, HomeGlobal, HomeRanking, HomeTicker, HomeTrade,
} from './useHomeMarket';

/**
 * THE LAST REAL HOMEPAGE MARKET SNAPSHOT, SO `/` OPENS ON WHAT IT LAST KNEW.
 *
 * The homepage is a presentation surface refreshed once every six hours. That
 * cadence already meant nothing on the page was live; what it did not yet
 * mean was that a reload could skip the round trip. Every mount still started
 * from nothing, drew skeletons over figures the browser had already been told
 * were true, and then asked every provider again.
 *
 * This module is one versioned record in `localStorage`, written only from
 * sections that ALREADY PASSED the hook's own live validation, and read back
 * through validators at least as strict as those. Nothing in here can produce
 * a price, a candle, a book level or a trade that was not received: a section
 * that does not validate is simply absent, and an absent section renders as
 * unknown (`—`), exactly as it would with no cache at all.
 *
 * Three rules, in order of importance:
 *
 *  1. ONLY RECEIVED DATA IS WRITTEN. The hook persists a section after the
 *     live response for it succeeded and was validated. `loading`, `error`
 *     and `refreshing` are not data and are never stored; they are recomputed
 *     on read from what is present.
 *  2. NOTHING IS TRUSTED FOR BEING OURS. The record can be an older schema,
 *     truncated by a full disk, hand-edited, or carry `null` where JSON lost
 *     a NaN. Every section is re-validated on read and dropped on its own
 *     if it fails; the others are kept.
 *  3. FRESHNESS IS PER SECTION, JUDGED ON THE OBSERVATION TIME, not on when
 *     the record was saved. A section younger than the cadence is shown and
 *     not re-requested; an older one is shown, flagged stale, and refreshed
 *     in the background.
 *
 * There is deliberately no session partition: everything here is public
 * market data and none of it belongs to a login.
 */

export const HOME_SNAPSHOT_KEY = 'voltex.home.market.v1';
export const HOME_SNAPSHOT_VERSION = 1;
/** The one pair the laptop terminal shows. Anything else in a stored hero
 *  section is a different product's data and is refused. */
export const HOME_HERO_PAIR = 'BTC/USDT';
/** History kept per pair. The sparklines never read more than this. */
export const HOME_HISTORY_POINTS = 24;

const MAX_TICKERS = 2_000;
const MAX_RANKINGS = 500;
const MAX_CFD_ROWS = 200;
const MAX_FUTURES_SYMBOLS = 500;
const MAX_CANDLES = 48;
const MAX_BOOK_LEVELS = 6;
const MAX_TRADES = 6;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What the hook holds and what the record restores, section by section.
 *  `null` is "nothing confirmed", never a zero. */
export interface HydratedHomeMarket {
  tickers: { rows: HomeTicker[]; source: string; history: Record<string, number[]>; observedAt: number } | null;
  hero: { pair: string; book: HomeBook | null; candles: HomeCandle[]; trades: HomeTrade[]; observedAt: number } | null;
  rankings: { rows: HomeRanking[]; observedAt: number } | null;
  global: { global: HomeGlobal; fearGreed: HomeFearGreed; observedAt: number } | null;
  cfd: { value: HomeCfd; history: Record<string, number[]>; observedAt: number } | null;
  futures: { symbols: string[]; observedAt: number } | null;
}

export const EMPTY_HYDRATION: HydratedHomeMarket = Object.freeze({
  tickers: null, hero: null, rankings: null, global: null, cfd: null, futures: null,
}) as HydratedHomeMarket;

/** The on-disk shape. Kept close to the brief so the next schema change is a
 *  deliberate version bump rather than a guess. */
export interface HomeMarketSnapshot {
  version: number;
  savedAt: number;
  tickerUpdatedAt: number | null;
  tickerSource: string;
  /** Unknown fields (change, volume, high, low) travel as `null`: JSON has no NaN. */
  tickers: HomeTicker[];
  priceHistory: Record<string, number[]>;
  hero: { pair: string; book: HomeBook | null; candles: HomeCandle[]; trades: HomeTrade[]; updatedAt: number } | null;
  rankings: HomeRanking[] | null;
  rankingsUpdatedAt: number | null;
  global: HomeGlobal;
  fearGreed: HomeFearGreed;
  globalUpdatedAt: number | null;
  cfd: HomeCfd | null;
  cfdUpdatedAt: number | null;
  cfdPriceHistory: Record<string, number[]>;
  futuresSymbols: string[] | null;
  futuresUpdatedAt: number | null;
}

/** The browser's store, or null wherever there isn't one (SSR, tests, a
 *  locked-down profile). Null always means "no cache", never an error. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    // Storage access throws outright under some privacy settings.
    return null;
  }
}

/**
 * Is an observation still inside the refresh window?
 *
 * A timestamp from the future fails on purpose: a clock that moved backwards
 * would otherwise make a section "fresh" until the clock caught up, which
 * could be days. Treating it as stale costs one refresh and nothing else.
 */
export function isFreshObservation(observedAt: number, now: number, ttlMs: number): boolean {
  return Number.isFinite(observedAt) && observedAt <= now && now - observedAt < ttlMs;
}

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nonEmpty = (value: unknown): value is string => text(value) && value.trim().length > 0;
const finiteOrNull = (value: unknown): value is number | null => value === null || finite(value);
// A function declaration, not a generic arrow: the homepage render tests
// transpile this file in TSX mode, where `<T>(` would parse as JSX.
function optional<T>(value: unknown, check: (value: unknown) => value is T): value is T | undefined {
  return value === undefined || check(value);
}
const positiveNumeric = (value: unknown): value is string =>
  text(value) && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
/** A number that may legitimately be unknown. JSON turned NaN into null on
 *  the way out; both come back as NaN, which every formatter renders as `—`. */
const knownOr = (value: unknown): number => (finite(value) ? value : NaN);

/**
 * One ticker row. `price` must be a real finite non-negative number — a row
 * whose price did not survive is not a row with a price of zero, it is a row
 * that does not exist. The four secondary fields may be unknown.
 */
function validTicker(value: unknown): HomeTicker | null {
  if (!record(value)) return null;
  const { pair, base, quote, price } = value;
  if (!nonEmpty(pair) || !pair.includes('/') || !nonEmpty(base) || !nonEmpty(quote)) return null;
  if (!finite(price) || price < 0) return null;
  const quoteVolume = knownOr(value.quoteVolume);
  return {
    pair, base, quote, price,
    change: knownOr(value.change),
    quoteVolume: quoteVolume >= 0 ? quoteVolume : NaN,
    high: knownOr(value.high),
    low: knownOr(value.low),
  };
}

/**
 * Price history: per key, the last observations actually received. A series
 * containing anything that is not a finite non-negative number is dropped
 * WHOLE rather than patched — a sparkline with a point quietly removed is a
 * different chart from the one that was observed.
 */
function validHistory(value: unknown): Record<string, number[]> {
  if (!record(value)) return {};
  const out: Record<string, number[]> = {};
  for (const [key, series] of Object.entries(value)) {
    if (!nonEmpty(key) || !Array.isArray(series) || series.length === 0) continue;
    if (!series.every(point => finite(point) && point >= 0)) continue;
    out[key] = series.slice(-HOME_HISTORY_POINTS);
  }
  return out;
}

function validBook(value: unknown, pair: string): HomeBook | null {
  if (!record(value) || value.pair !== pair || !finite(value.timestamp) || value.timestamp <= 0) return null;
  const level = (row: unknown): row is { price: string; quantity: string } =>
    record(row) && positiveNumeric(row.price) && positiveNumeric(row.quantity);
  if (!Array.isArray(value.bids) || !Array.isArray(value.asks)) return null;
  if (!value.bids.every(level) || !value.asks.every(level)) return null;
  const bids = value.bids.slice(0, MAX_BOOK_LEVELS).map(row => ({ price: row.price, quantity: row.quantity }));
  const asks = value.asks.slice(0, MAX_BOOK_LEVELS).map(row => ({ price: row.price, quantity: row.quantity }));
  // The live loader only reports a book when both sides exist.
  if (!bids.length || !asks.length) return null;
  return { pair, timestamp: value.timestamp, bids, asks };
}

/**
 * Candles: the same structural rules the live loader applies, plus strictly
 * increasing time. One bad bar invalidates the series — see validHistory.
 */
function validCandles(value: unknown): HomeCandle[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CANDLES) return [];
  const out: HomeCandle[] = [];
  let previousTime = -Infinity;
  for (const bar of value) {
    if (!record(bar)) return [];
    const { time, open, high, low, close, volume } = bar;
    if (![time, open, high, low, close].every(finite) || Math.min(time, open, high, low, close) <= 0) return [];
    if (!finite(volume) || volume < 0) return [];
    if (low > Math.min(open, close) || high < Math.max(open, close)) return [];
    if (time <= previousTime) return [];
    previousTime = time;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function validTrades(value: unknown): HomeTrade[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRADES) return [];
  const out: HomeTrade[] = [];
  let previousTime = Infinity;
  for (const row of value) {
    if (!record(row) || !text(row.id) || !positiveNumeric(row.price) || !positiveNumeric(row.quantity)) return [];
    if (!finite(row.time) || row.time <= 0 || (row.side !== 'BUY' && row.side !== 'SELL')) return [];
    if (row.time > previousTime) return [];
    previousTime = row.time;
    out.push({ id: row.id, price: row.price, quantity: row.quantity, side: row.side, time: row.time });
  }
  return out;
}

function validRanking(value: unknown): HomeRanking | null {
  if (!record(value) || !nonEmpty(value.symbol) || !text(value.name) || !text(value.image)) return null;
  if (!Array.isArray(value.categories) || !value.categories.every(text)) return null;
  if (!finiteOrNull(value.changePercent24h) || !finiteOrNull(value.changePercent7d)) return null;
  return {
    symbol: value.symbol, name: value.name, image: value.image, categories: value.categories,
    changePercent24h: value.changePercent24h, changePercent7d: value.changePercent7d,
  };
}

function validGlobal(value: unknown): HomeGlobal {
  if (value === null) return null;
  if (!record(value) || !finite(value.totalVolume24hUsd) || !finite(value.totalMarketCapUsd)) return null;
  if (!finiteOrNull(value.btcDominancePercent) || !finiteOrNull(value.ethDominancePercent)
    || !finiteOrNull(value.marketCapChangePercent24h)) return null;
  return {
    totalVolume24hUsd: value.totalVolume24hUsd, totalMarketCapUsd: value.totalMarketCapUsd,
    btcDominancePercent: value.btcDominancePercent, ethDominancePercent: value.ethDominancePercent,
    marketCapChangePercent24h: value.marketCapChangePercent24h,
  };
}

function validFearGreed(value: unknown): HomeFearGreed {
  if (value === null) return null;
  if (!record(value) || !finite(value.value) || !text(value.classification) || !finite(value.updatedAt)) return null;
  return { value: value.value, classification: value.classification, updatedAt: value.updatedAt };
}

/** A CFD row, with only the fields the homepage reads and each in the type it
 *  expects. Extra fields are not carried: this is a display cache, not a
 *  mirror of the provider payload. */
function validCfdRow(value: unknown): HomeCfd['tickers'][number] | null {
  if (!record(value) || !nonEmpty(value.symbol) || !text(value.name)) return null;
  if (!(value.price === null || text(value.price))) return null;
  const bool = (v: unknown): v is boolean => typeof v === 'boolean';
  if (!optional(value.status, text) || !optional(value.stale, bool) || !optional(value.marketClosed, bool)
    || !optional(value.displayOnly, bool) || !optional(value.executionAllowed, bool)
    || !optional(value.provider, text) || !optional(value.providerSymbol, text)
    || !optional(value.providerTimestamp, finiteOrNull) || !optional(value.fetchedAt, finiteOrNull)
    || !optional(value.asOf, finiteOrNull) || !optional(value.maxQuoteAgeMs, finite)
    || !optional(value.changePercent24h, text)) return null;
  const row: HomeCfd['tickers'][number] = { symbol: value.symbol, name: value.name, price: value.price };
  for (const key of ['status', 'stale', 'marketClosed', 'displayOnly', 'executionAllowed', 'provider', 'providerSymbol',
    'providerTimestamp', 'fetchedAt', 'asOf', 'maxQuoteAgeMs', 'changePercent24h'] as const) {
    if (value[key] !== undefined) (row as any)[key] = value[key];
  }
  return row;
}

function validCfd(value: unknown): HomeCfd | null {
  if (!record(value) || typeof value.configured !== 'boolean' || !text(value.source)) return null;
  if (!Array.isArray(value.tickers) || value.tickers.length > MAX_CFD_ROWS) return null;
  const tickers: HomeCfd['tickers'] = [];
  for (const row of value.tickers) {
    const valid = validCfdRow(row);
    if (valid) tickers.push(valid);
  }
  return { source: value.source, configured: value.configured, tickers };
}

/** The observation time of a section: finite, or the section is not usable.
 *  Whether it is FRESH is the hook's question, answered against its cadence. */
const observed = (value: unknown): number | null => (finite(value) ? value : null);

/**
 * Read the record and return every section that validates, independently.
 *
 * `now` is a parameter rather than `Date.now()` so a test can drive the clock
 * and so this module never has a reason to touch the wall clock itself.
 */
export function readHomeSnapshot(storage: StorageLike | null, now: number): HydratedHomeMarket {
  void now;
  if (!storage) return EMPTY_HYDRATION;
  let parsed: unknown;
  try {
    const raw = storage.getItem(HOME_SNAPSHOT_KEY);
    if (!raw) return EMPTY_HYDRATION;
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable is the same as absent: show nothing rather than guess.
    return EMPTY_HYDRATION;
  }
  // A different schema is not "close enough". It is the reason the key
  // carries a version at all.
  if (!record(parsed) || parsed.version !== HOME_SNAPSHOT_VERSION || !finite(parsed.savedAt)) return EMPTY_HYDRATION;

  const out: HydratedHomeMarket = { tickers: null, hero: null, rankings: null, global: null, cfd: null, futures: null };

  const tickerAt = observed(parsed.tickerUpdatedAt);
  if (tickerAt !== null && Array.isArray(parsed.tickers)) {
    const rows: HomeTicker[] = [];
    for (const row of parsed.tickers.slice(0, MAX_TICKERS)) {
      const valid = validTicker(row);
      if (valid) rows.push(valid);
    }
    // The live path refuses an empty ticker universe; so does the cache.
    if (rows.length) out.tickers = {
      rows, observedAt: tickerAt,
      source: text(parsed.tickerSource) ? parsed.tickerSource : '',
      history: validHistory(parsed.priceHistory),
    };
  }

  if (record(parsed.hero) && parsed.hero.pair === HOME_HERO_PAIR) {
    const heroAt = observed(parsed.hero.updatedAt);
    if (heroAt !== null) {
      const book = validBook(parsed.hero.book, HOME_HERO_PAIR);
      const candles = validCandles(parsed.hero.candles);
      const trades = validTrades(parsed.hero.trades);
      if (book || candles.length || trades.length) out.hero = { pair: HOME_HERO_PAIR, book, candles, trades, observedAt: heroAt };
    }
  }

  const rankingsAt = observed(parsed.rankingsUpdatedAt);
  if (rankingsAt !== null && Array.isArray(parsed.rankings) && parsed.rankings.length <= MAX_RANKINGS) {
    const rows: HomeRanking[] = [];
    for (const row of parsed.rankings) {
      const valid = validRanking(row);
      if (valid) rows.push(valid);
    }
    out.rankings = { rows, observedAt: rankingsAt };
  }

  const globalAt = observed(parsed.globalUpdatedAt);
  if (globalAt !== null) {
    const global = validGlobal(parsed.global);
    const fearGreed = validFearGreed(parsed.fearGreed);
    // The live path calls this section ok when EITHER half answered.
    if (global || fearGreed) out.global = { global, fearGreed, observedAt: globalAt };
  }

  const cfdAt = observed(parsed.cfdUpdatedAt);
  if (cfdAt !== null) {
    const value = validCfd(parsed.cfd);
    if (value) out.cfd = { value, history: validHistory(parsed.cfdPriceHistory), observedAt: cfdAt };
  }

  const futuresAt = observed(parsed.futuresUpdatedAt);
  if (futuresAt !== null && Array.isArray(parsed.futuresSymbols) && parsed.futuresSymbols.length > 0
    && parsed.futuresSymbols.length <= MAX_FUTURES_SYMBOLS && parsed.futuresSymbols.every(nonEmpty)) {
    out.futures = { symbols: parsed.futuresSymbols, observedAt: futuresAt };
  }

  return out;
}

/**
 * Persist what is confirmed. A null section is written as null, so the next
 * visit restores what was real and nothing else. A full or disabled quota
 * must never break the page it was meant to speed up — the live request has
 * already been issued regardless.
 */
export function writeHomeSnapshot(storage: StorageLike | null, committed: HydratedHomeMarket, now: number): void {
  if (!storage) return;
  const snapshot: HomeMarketSnapshot = {
    version: HOME_SNAPSHOT_VERSION,
    savedAt: now,
    tickerUpdatedAt: committed.tickers?.observedAt ?? null,
    tickerSource: committed.tickers?.source ?? '',
    tickers: committed.tickers?.rows.slice(0, MAX_TICKERS) ?? [],
    priceHistory: committed.tickers?.history ?? {},
    hero: committed.hero ? {
      pair: committed.hero.pair, book: committed.hero.book, candles: committed.hero.candles,
      trades: committed.hero.trades, updatedAt: committed.hero.observedAt,
    } : null,
    rankings: committed.rankings?.rows ?? null,
    rankingsUpdatedAt: committed.rankings?.observedAt ?? null,
    global: committed.global?.global ?? null,
    fearGreed: committed.global?.fearGreed ?? null,
    globalUpdatedAt: committed.global?.observedAt ?? null,
    cfd: committed.cfd?.value ?? null,
    cfdUpdatedAt: committed.cfd?.observedAt ?? null,
    cfdPriceHistory: committed.cfd?.history ?? {},
    futuresSymbols: committed.futures?.symbols ?? null,
    futuresUpdatedAt: committed.futures?.observedAt ?? null,
  };
  try {
    storage.setItem(HOME_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota, private mode, or a storage that throws: the page keeps working
    // on the live data it already has.
  }
}

export function clearHomeSnapshot(storage: StorageLike | null): void {
  if (!storage) return;
  try { storage.removeItem(HOME_SNAPSHOT_KEY); } catch { /* see writeHomeSnapshot */ }
}
