import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { parseChangePercent } from '../../lib/priceChange';
import { futuresConfigStore } from '../../lib/futuresConfigStore';
import {
  HOME_HERO_PAIR, HOME_HISTORY_POINTS, browserStorage, isFreshObservation, readHomeSnapshot, writeHomeSnapshot,
  type HydratedHomeMarket,
} from './homeMarketSnapshot';

export interface HomeTicker {
  pair: string;
  base: string;
  quote: string;
  price: number;
  change: number;
  quoteVolume: number;
  high: number;
  low: number;
}

export interface HomeRanking {
  symbol: string;
  name: string;
  image: string;
  categories: string[];
  changePercent24h: number | null;
  changePercent7d: number | null;
}

type Global = Awaited<ReturnType<typeof api.getGlobalMarket>>;
type Cfd = Awaited<ReturnType<typeof api.getCfdTickers>>;
export type HomeGlobal = Global['global'];
export type HomeFearGreed = Global['fearGreed'];
export type HomeCfd = Cfd;
export type HomeBook = Awaited<ReturnType<typeof api.getExternalOrderBook>>;
export type HomeCandle = Awaited<ReturnType<typeof api.getExternalCandles>>['candles'][number];
export type HomeTrade = Awaited<ReturnType<typeof api.getExternalTrades>>['trades'][number];

export interface HomeHeroFeed {
  streaming?: boolean;
  livePrice?: number;
  candlesUpdatedAt?: number;
  pair: string | null;
  book: HomeBook | null;
  candles: HomeCandle[];
  trades: HomeTrade[];
  bookStatus: Status;
  candlesStatus: Status;
  tradesStatus: Status;
  stale: boolean;
  updatedAt: number | null;
}

export type Status = 'loading' | 'ok' | 'error';

export interface HomeMarket {
  priceHistory: Record<string, number[]>;
  tickerUpdatedAt: number | null;
  tickerSource: string;
  tickersStale: boolean;
  hero: HomeHeroFeed;
  tickers: HomeTicker[];
  tickersStatus: Status;
  rankings: HomeRanking[];
  rankingsStatus: Status;
  global: Global['global'] | null;
  fearGreed: Global['fearGreed'] | null;
  globalStatus: Status;
  cfd: Cfd | null;
  cfdStatus: Status;
  cfdPriceHistory?: Record<string, number[]>;
  futuresSymbols: string[];
  futuresStatus: Status;
  logoOf: (base: string) => string | undefined;
}

/**
 * The homepage is presentation, not an execution surface. One real snapshot
 * every six hours is enough for the hero terminal, market map and popular
 * assets table. Trading/Futures keep their own real-time feeds untouched.
 *
 * The same six hours is the lifetime of the persisted snapshot: a section
 * observed less than this long ago is painted from storage and NOT
 * re-requested; an older one is painted, flagged stale, and refreshed in the
 * background. See homeMarketSnapshot.ts.
 */
export const HOME_MARKET_REFRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HERO_PAIR = HOME_HERO_PAIR;
const MARKET_EDGE_BASE='https://market.voltextech.net';
const production=()=>typeof window!=='undefined'&&!!window.location&&(window.location.hostname==='voltextech.net'||window.location.hostname.endsWith('.voltextech.net'));
async function edgeJson<T>(path:string):Promise<T>{const r=await fetch(`${MARKET_EDGE_BASE}${path}`,{credentials:'omit',headers:{Accept:'application/json'}});if(!r.ok)throw new Error('edge_market_unavailable');return r.json() as Promise<T>;}
const getDisplayTickers=()=>production()?edgeJson<Awaited<ReturnType<typeof api.getExternalTickers>>>('/market/display/spot-tickers'):api.getExternalTickers();
const getDisplayCfdTickers=()=>production()?edgeJson<Awaited<ReturnType<typeof api.getCfdTickers>>>('/cfd/display/tickers'):api.getCfdTickers();
const getDisplayBook=(pair:string,_limit:number)=>production()?edgeJson<Awaited<ReturnType<typeof api.getExternalOrderBook>>>(`/market/display/spot-book/${pair.replace('/','-')}`):api.getExternalOrderBook(pair,_limit);
const getDisplayCandles=(pair:string,interval:string,limit:number)=>production()?edgeJson<Awaited<ReturnType<typeof api.getExternalCandles>>>(`/market/display/spot-candles/${pair.replace('/','-')}?interval=${interval}&limit=${limit}`):api.getExternalCandles(pair,interval,limit);
const getDisplayTrades=(pair:string,_limit:number)=>production()?edgeJson<Awaited<ReturnType<typeof api.getExternalTrades>>>(`/market/display/spot-trades/${pair.replace('/','-')}`):api.getExternalTrades(pair,_limit);
const receivedNumber = (value: unknown): number => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : NaN;

/**
 * Append the prices just received to each key's history. A repeated price is
 * not a new observation and is not appended; a key nothing was received for
 * keeps its series untouched. Returns the SAME object when nothing changed,
 * so a refresh that moved no price re-renders nothing.
 *
 * This is the only way a point enters the history: from a value received in
 * a live response. There is no seeding and no interpolation.
 */
export function mergePriceHistory(
  previous: Record<string, number[]>, received: { key: string; price: number }[],
): Record<string, number[]> {
  let changed = false;
  const next: Record<string, number[]> = { ...previous };
  for (const { key, price } of received) {
    if (!Number.isFinite(price) || price < 0) continue;
    const old = previous[key] ?? [];
    if (old[old.length - 1] !== price) {
      next[key] = [...old, price].slice(-HOME_HISTORY_POINTS);
      changed = true;
    }
  }
  return changed ? next : previous;
}

const fresh = (observedAt: number | null | undefined, now: number) =>
  observedAt != null && isFreshObservation(observedAt, now, HOME_MARKET_REFRESH_MS);

export function useHomeMarket(): HomeMarket {
  // Read ONCE, synchronously, before the first paint: whatever the browser
  // last confirmed is on screen from the first render, and the effect below
  // decides what — if anything — still needs to be asked for.
  const [hydrated] = useState<HydratedHomeMarket>(() => readHomeSnapshot(browserStorage(), Date.now()));
  const mountedAt = Date.now();

  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>(() => hydrated.tickers?.history ?? {});
  const [tickerUpdatedAt, setTickerUpdatedAt] = useState<number | null>(() => hydrated.tickers?.observedAt ?? null);
  const [tickerSource, setTickerSource] = useState(() => hydrated.tickers?.source ?? '');
  const [tickersStale, setTickersStale] = useState(() => hydrated.tickers !== null && !fresh(hydrated.tickers.observedAt, mountedAt));
  const [hero, setHero] = useState<HomeHeroFeed>(() => hydrated.hero ? {
    pair: hydrated.hero.pair,
    book: hydrated.hero.book,
    candles: hydrated.hero.candles,
    trades: hydrated.hero.trades,
    // A part that was confirmed is `ok`; a part that was not is still
    // unknown, exactly as it would be with no cache.
    bookStatus: hydrated.hero.book ? 'ok' : 'loading',
    candlesStatus: hydrated.hero.candles.length ? 'ok' : 'loading',
    tradesStatus: hydrated.hero.trades.length ? 'ok' : 'loading',
    candlesUpdatedAt: hydrated.hero.candles.length ? hydrated.hero.observedAt : undefined,
    stale: !fresh(hydrated.hero.observedAt, mountedAt),
    updatedAt: hydrated.hero.observedAt,
  } : {
    pair: DEFAULT_HERO_PAIR, book: null, candles: [], trades: [],
    bookStatus: 'loading', candlesStatus: 'loading', tradesStatus: 'loading',
    stale: false, updatedAt: null,
  });
  const [tickers, setTickers] = useState<HomeTicker[]>(() => hydrated.tickers?.rows ?? []);
  const [tickersStatus, setTickersStatus] = useState<Status>(() => hydrated.tickers ? 'ok' : 'loading');
  const [rankings, setRankings] = useState<HomeRanking[]>(() => hydrated.rankings?.rows ?? []);
  const [rankingsStatus, setRankingsStatus] = useState<Status>(() => hydrated.rankings ? 'ok' : 'loading');
  const [global, setGlobal] = useState<Global['global'] | null>(() => hydrated.global?.global ?? null);
  const [fearGreed, setFearGreed] = useState<Global['fearGreed'] | null>(() => hydrated.global?.fearGreed ?? null);
  const [globalStatus, setGlobalStatus] = useState<Status>(() => hydrated.global ? 'ok' : 'loading');
  const [cfd, setCfd] = useState<Cfd | null>(() => hydrated.cfd?.value ?? null);
  const [cfdStatus, setCfdStatus] = useState<Status>(() => hydrated.cfd ? 'ok' : 'loading');
  const [cfdPriceHistory, setCfdPriceHistory] = useState<Record<string, number[]>>(() => hydrated.cfd?.history ?? {});
  const [futuresSymbols, setFuturesSymbols] = useState<string[]>(() => hydrated.futures?.symbols ?? []);
  const [futuresStatus, setFuturesStatus] = useState<Status>(() => hydrated.futures ? 'ok' : 'loading');

  useEffect(() => {
    let cancelled = false;
    let tickerInFlight = false;
    let hasTickers = hydrated.tickers !== null;
    let heroInFlight = false;
    let heroVisible = true;
    const heroPair: string | null = DEFAULT_HERO_PAIR;
    let cfdInFlight = false;
    const storage = browserStorage();

    // Every loader is gated on "started less than six hours ago". Seeding the
    // gate from the snapshot's observation time is what makes a fresh cache
    // skip its request and a stale one issue it, with no second code path.
    const seed = (observedAt: number | null | undefined) =>
      fresh(observedAt, Date.now()) ? (observedAt as number) : -Infinity;
    let tickerStartedAt = seed(hydrated.tickers?.observedAt);
    // A restored hero counts as observed only when all three of its parts
    // came back; one that lost a part on the way is painted as far as it
    // goes and asked for again now, whatever its age.
    const heroComplete = hydrated.hero !== null && hydrated.hero.book !== null
      && hydrated.hero.candles.length > 0 && hydrated.hero.trades.length > 0;
    let heroStartedAt = heroComplete ? seed(hydrated.hero?.observedAt) : -Infinity;
    let cfdStartedAt = seed(hydrated.cfd?.observedAt);
    let rankingsStartedAt = seed(hydrated.rankings?.observedAt);
    let globalStartedAt = seed(hydrated.global?.observedAt);
    let futuresStartedAt = seed(hydrated.futures?.observedAt);
    // A hero painted from an old snapshot stays marked stale until every one
    // of its three parts has been re-confirmed, not merely until the first
    // part lands.
    let heroSnapshotStale = hydrated.hero !== null && !fresh(hydrated.hero.observedAt, Date.now());

    // What has been COMMITTED to state, kept alongside it, so the snapshot is
    // written from real values rather than read back out of React. Starts
    // as what was restored, so a partial refresh persists the merged whole.
    const committed: HydratedHomeMarket = { ...hydrated };
    const persist = () => writeHomeSnapshot(storage, committed, Date.now());

    const positive = (value: string | number) => Number.isFinite(Number(value)) && Number(value) > 0;
    const updateHero = (pair: string, patch: Partial<HomeHeroFeed>) => {
      if (cancelled || pair !== heroPair) return;
      setHero(previous => {
        const next: HomeHeroFeed = { ...previous, pair, ...patch };
        return {
          ...next,
          stale: heroSnapshotStale
            || (next.bookStatus === 'error' && !!next.book)
            || (next.candlesStatus === 'error' && next.candles.length > 0)
            || (next.tradesStatus === 'error' && next.trades.length > 0),
        };
      });
    };

    async function loadCfd() {
      if (cancelled || document.hidden || !heroVisible || cfdInFlight
        || Date.now() - cfdStartedAt < HOME_MARKET_REFRESH_MS) return;
      cfdInFlight = true;
      cfdStartedAt = Date.now();
      try {
        const res = await getDisplayCfdTickers();
        if (cancelled) return;
        const history = mergePriceHistory(committed.cfd?.history ?? {}, res.tickers
          .filter(row => row.status === 'live' && !row.stale)
          .map(row => ({ key: row.symbol, price: receivedNumber(row.price) }))
          .filter(row => row.price > 0));
        committed.cfd = { value: res, history, observedAt: Date.now() };
        setCfd(res);
        setCfdStatus('ok');
        setCfdPriceHistory(history);
        persist();
      } catch {
        if (!cancelled) setCfdStatus('error');
      } finally {
        cfdInFlight = false;
      }
    }

    async function loadHero() {
      if (cancelled || document.hidden || !heroVisible || !heroPair || heroInFlight
        || Date.now() - heroStartedAt < HOME_MARKET_REFRESH_MS) return;
      heroInFlight = true;
      heroStartedAt = Date.now();
      const pair = heroPair;
      let receivedBook: HomeBook | null = null;
      let receivedCandles: HomeCandle[] = [];
      let receivedTrades: HomeTrade[] = [];

      const bookTask = getDisplayBook(pair, 12).then(value => {
        const validBook = value.pair === pair && positive(value.timestamp)
          ? { ...value,
            bids: value.bids.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
            asks: value.asks.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
          } : null;
        const ok = !!validBook && validBook.bids.length > 0 && validBook.asks.length > 0;
        if (ok) { receivedBook = validBook; updateHero(pair, { book: validBook, bookStatus: 'ok' }); }
        else updateHero(pair, { bookStatus: 'error' });
      }).catch(() => updateHero(pair, { bookStatus: 'error' }));

      const candleTask = getDisplayCandles(pair, '15m', 48).then(value => {
        const validCandles = value.pair === pair
          ? value.candles.filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
            && Math.min(c.time, c.open, c.high, c.low, c.close) > 0
            && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))
            .sort((a, b) => a.time - b.time).slice(-48) : [];
        if (validCandles.length > 0) {
          receivedCandles = validCandles;
          updateHero(pair, { candles: validCandles, candlesUpdatedAt: Date.now(), candlesStatus: 'ok' });
        } else updateHero(pair, { candlesStatus: 'error' });
      }).catch(() => updateHero(pair, { candlesStatus: 'error' }));

      const tradeTask = getDisplayTrades(pair, 8).then(value => {
        const validTrades = value.pair === pair
          ? value.trades.filter(row => positive(row.price) && positive(row.quantity)
            && Number.isFinite(row.time) && row.time > 0 && (row.side === 'BUY' || row.side === 'SELL'))
            .sort((a, b) => b.time - a.time).slice(0, 6) : [];
        if (validTrades.length > 0) { receivedTrades = validTrades; updateHero(pair, { trades: validTrades, tradesStatus: 'ok' }); }
        else updateHero(pair, { tradesStatus: 'error' });
      }).catch(() => updateHero(pair, { tradesStatus: 'error' }));

      await Promise.allSettled([bookTask, candleTask, tradeTask]);
      heroInFlight = false;
      if (cancelled || pair !== heroPair) return;
      // The hero is persisted only when all three parts were confirmed in
      // this same refresh. A mixed hero — new candles beside an old book —
      // would restore next visit as if the whole of it were that fresh.
      if (receivedBook && receivedCandles.length > 0 && receivedTrades.length > 0) {
        heroSnapshotStale = false;
        committed.hero = { pair, book: receivedBook, candles: receivedCandles, trades: receivedTrades, observedAt: Date.now() };
        persist();
      }
      setHero(previous => previous.pair === pair
        && previous.bookStatus === 'ok' && previous.candlesStatus === 'ok' && previous.tradesStatus === 'ok'
        ? { ...previous, stale: false, updatedAt: Date.now() }
        : previous);
    }

    function loadTickers() {
      if (cancelled || document.hidden || tickerInFlight
        || Date.now() - tickerStartedAt < HOME_MARKET_REFRESH_MS) return;
      tickerInFlight = true;
      tickerStartedAt = Date.now();
      getDisplayTickers().then(res => {
        if (cancelled) return;
        const rows: HomeTicker[] = res.tickers
          .filter(t => Number.isFinite(receivedNumber(t.lastPrice)) && receivedNumber(t.lastPrice) >= 0)
          .map(t => {
            const [base, quote] = t.pair.split('/');
            return {
              pair: t.pair,
              base,
              quote,
              price: receivedNumber(t.lastPrice),
              change: Number.isFinite(receivedNumber(t.changePercent24h)) ? parseChangePercent(t.changePercent24h, t.pair) : NaN,
              quoteVolume: receivedNumber(t.quoteVolume24h) >= 0 ? receivedNumber(t.quoteVolume24h) : NaN,
              high: receivedNumber(t.high24h),
              low: receivedNumber(t.low24h),
            };
          });
        if (rows.length === 0) throw new Error('Empty market ticker response');
        const observedAt = Date.now();
        const history = mergePriceHistory(committed.tickers?.history ?? {},
          byVolume(rows, 60).map(row => ({ key: row.pair, price: row.price })));
        hasTickers = true;
        committed.tickers = { rows, source: res.source, history, observedAt };
        setTickers(rows);
        setTickerUpdatedAt(observedAt);
        setTickerSource(res.source);
        setTickersStale(false);
        setPriceHistory(history);
        setTickersStatus('ok');
        persist();
      }).catch(() => {
        if (cancelled) return;
        setTickersStale(hasTickers);
        setTickersStatus(previous => previous === 'ok' ? 'ok' : 'error');
      }).finally(() => {
        tickerInFlight = false;
      });
    }

    // Rankings, the global figures and the listed futures contracts are
    // slower-moving than quotes, but they are still provider reads. They
    // follow the same six-hour gate as everything else, so a fresh snapshot
    // asks for none of them and an expired one asks for all of them once. A
    // hidden tab asks for nothing; the visibility handler catches it up.
    function loadBootstrap() {
      if (cancelled || document.hidden) return;
      const at = Date.now();
      if (at - rankingsStartedAt >= HOME_MARKET_REFRESH_MS) {
        rankingsStartedAt = at;
        api.getExternalRankings().then(res => {
          if (cancelled) return;
          committed.rankings = { rows: res.rankings, observedAt: Date.now() };
          setRankings(res.rankings);
          setRankingsStatus('ok');
          persist();
        }).catch(() => !cancelled && setRankingsStatus('error'));
      }
      if (at - globalStartedAt >= HOME_MARKET_REFRESH_MS) {
        globalStartedAt = at;
        api.getGlobalMarket().then(res => {
          if (cancelled) return;
          setGlobal(res.global);
          setFearGreed(res.fearGreed);
          const ok = !!(res.global || res.fearGreed);
          setGlobalStatus(ok ? 'ok' : 'error');
          if (ok) {
            committed.global = { global: res.global, fearGreed: res.fearGreed, observedAt: Date.now() };
            persist();
          }
        }).catch(() => !cancelled && setGlobalStatus('error'));
      }
      if (at - futuresStartedAt >= HOME_MARKET_REFRESH_MS) {
        futuresStartedAt = at;
        futuresConfigStore.load().then(res => {
          if (cancelled) return;
          setFuturesSymbols(res.symbols);
          const ok = res.symbols.length > 0;
          setFuturesStatus(ok ? 'ok' : 'error');
          if (ok) {
            committed.futures = { symbols: res.symbols, observedAt: Date.now() };
            persist();
          }
        }).catch(() => !cancelled && setFuturesStatus('error'));
      }
    }

    /**
     * The next moment any section turns six hours old. With a fresh snapshot
     * this is the ONLY thing that triggers the first refresh, at exactly the
     * right time, rather than six hours after mount. A section that is due
     * but held by a gate (hidden tab, offscreen hero) is left to the
     * visibility and intersection handlers: arming a zero-delay timer for it
     * would spin.
     */
    let expiry: number | null = null;
    function armExpiry() {
      if (expiry !== null) { window.clearTimeout(expiry); expiry = null; }
      const now = Date.now();
      // Only sections that are NOT yet due decide the delay: one that is
      // already due and still held by a gate must not hide the next real
      // expiry of the others behind a zero delay.
      const pending = [tickerStartedAt, heroStartedAt, cfdStartedAt, rankingsStartedAt, globalStartedAt, futuresStartedAt]
        .filter(Number.isFinite)
        .map(startedAt => startedAt + HOME_MARKET_REFRESH_MS - now)
        .filter(delay => delay > 0);
      if (!pending.length) return;
      expiry = window.setTimeout(() => { expiry = null; refresh(); }, Math.min(...pending));
    }

    const refresh = () => {
      loadTickers();
      void loadHero();
      void loadCfd();
      loadBootstrap();
      armExpiry();
    };
    const terminal = document.getElementById('home-live-terminal');
    const observer = typeof IntersectionObserver !== 'undefined' && terminal
      ? new IntersectionObserver(entries => {
        heroVisible = entries.some(entry => entry.isIntersecting);
        if (heroVisible) {
          void loadHero();
          void loadCfd();
          armExpiry();
        }
      }, { rootMargin: '120px' })
      : null;
    if (terminal) observer?.observe(terminal);
    refresh();
    const poll = window.setInterval(refresh, HOME_MARKET_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (expiry !== null) window.clearTimeout(expiry);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const logoByBase = new Map(rankings.map(r => [r.symbol.toUpperCase(), r.image]));
  return {
    priceHistory,
    tickerUpdatedAt,
    tickerSource,
    tickersStale,
    hero,
    tickers,
    tickersStatus,
    rankings,
    rankingsStatus,
    global,
    fearGreed,
    globalStatus,
    cfd,
    cfdStatus,
    cfdPriceHistory,
    futuresSymbols,
    futuresStatus,
    logoOf: (base: string) => logoByBase.get(base.toUpperCase()),
  };
}

export function byVolume(tickers: HomeTicker[], limit: number): HomeTicker[] {
  return tickers.filter(t => t.quote === 'USDT')
    .sort((a, b) => (Number.isFinite(b.quoteVolume) ? b.quoteVolume : -1) - (Number.isFinite(a.quoteVolume) ? a.quoteVolume : -1))
    .slice(0, limit);
}

export function formatPriceValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

export function formatCompactUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}
