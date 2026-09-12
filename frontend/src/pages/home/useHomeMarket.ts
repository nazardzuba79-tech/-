import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { parseChangePercent } from '../../lib/priceChange';
import { futuresConfigStore } from '../../lib/futuresConfigStore';

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

/** Independent load state per source. The homepage is composed of five
 *  market panels served by three different upstreams; if one is down the
 *  page must still render everything else, so each section reads its own
 *  status rather than one shared "loading" flag gating the whole page. */
export type Status = 'loading' | 'ok' | 'error';

export interface HomeMarket {
  /** Actual quotes observed during this visit; never a generated history. */
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
  /** The contracts the perpetual exchange actually lists right now, straight
   *  from /futures/config (FuturesMarketRegistry). Never a hardcoded list. */
  futuresSymbols: string[];
  futuresStatus: Status;
  /** Logo for a base asset, from the exchange's own ranking feed. */
  logoOf: (base: string) => string | undefined;
}

// One clock for tickers and the visible terminal's bounded snapshots.
// CFD reference quotes refresh at 60s while the hero is visible. Rankings
// and global stats remain one-shot reads. Child
// components receive these values and never open a second polling loop.
const TICKER_POLL_MS = 15_000;
const receivedNumber = (value: unknown): number => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : NaN;

export function useHomeMarket(): HomeMarket {
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});
  const [tickerUpdatedAt, setTickerUpdatedAt] = useState<number | null>(null);
  const [tickerSource, setTickerSource] = useState('');
  const [tickersStale, setTickersStale] = useState(false);
  const [hero, setHero] = useState<HomeHeroFeed>({
    pair: null, book: null, candles: [], trades: [],
    bookStatus: 'loading', candlesStatus: 'loading', tradesStatus: 'loading',
    stale: false, updatedAt: null,
  });
  const [tickers, setTickers] = useState<HomeTicker[]>([]);
  const [tickersStatus, setTickersStatus] = useState<Status>('loading');
  const [rankings, setRankings] = useState<HomeRanking[]>([]);
  const [rankingsStatus, setRankingsStatus] = useState<Status>('loading');
  const [global, setGlobal] = useState<Global['global'] | null>(null);
  const [fearGreed, setFearGreed] = useState<Global['fearGreed'] | null>(null);
  const [globalStatus, setGlobalStatus] = useState<Status>('loading');
  const [cfd, setCfd] = useState<Cfd | null>(null);
  const [cfdStatus, setCfdStatus] = useState<Status>('loading');
  const [cfdPriceHistory, setCfdPriceHistory] = useState<Record<string, number[]>>({});
  const [futuresSymbols, setFuturesSymbols] = useState<string[]>([]);
  const [futuresStatus, setFuturesStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    let tickerInFlight = false;
    let hasTickers = false;
    let heroInFlight = false;
    let heroVisible = true;
    let heroPair: string | null = null;
    let tickerStartedAt = -Infinity;
    let heroStartedAt = -Infinity;
    let cfdStartedAt = -Infinity;
    let cfdInFlight = false;

    async function loadCfd() {
      if (cancelled || document.hidden || !heroVisible || cfdInFlight || Date.now() - cfdStartedAt < 60_000) return;
      cfdInFlight = true; cfdStartedAt = Date.now();
      try {
        const res = await api.getCfdTickers();
        if (cancelled) return;
        setCfd(res); setCfdStatus('ok');
        setCfdPriceHistory(previous => {
          const next: Record<string, number[]> = {};
          if (res.configured) res.tickers.forEach(row => {
            const price = receivedNumber(row.price);
            if (Number.isFinite(price)) next[row.symbol] = [...(previous[row.symbol] ?? []), price].slice(-24);
          });
          return next;
        });
      } catch {
        if (!cancelled) { setCfd(null); setCfdStatus('error'); }
      } finally { cfdInFlight = false; }
    }

    // These bounded public reads replace the old illustrated book/candles.
    // One owner and one clock: no child section opens a poll or socket.
    async function loadHero() {
      if (cancelled || document.hidden || !heroVisible || !heroPair || heroInFlight
        || Date.now() - heroStartedAt < TICKER_POLL_MS) return;
      heroInFlight = true;
      heroStartedAt = Date.now();
      const pair = heroPair;
      const [book, candles, trades] = await Promise.allSettled([
        api.getExternalOrderBook(pair, 12),
        api.getExternalCandles(pair, '15m', 48),
        api.getExternalTrades(pair, 8),
      ]);
      heroInFlight = false;
      if (cancelled || pair !== heroPair) return;
      const positive = (value: string | number) => Number.isFinite(Number(value)) && Number(value) > 0;
      const validBook = book.status === 'fulfilled' && book.value.pair === pair && positive(book.value.timestamp)
        ? { ...book.value,
          bids: book.value.bids.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
          asks: book.value.asks.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
        } : null;
      const validCandles = candles.status === 'fulfilled' && candles.value.pair === pair
        ? candles.value.candles.filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
          && Math.min(c.time, c.open, c.high, c.low, c.close) > 0
          && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))
          .sort((a, b) => a.time - b.time).slice(-48) : [];
      const validTrades = trades.status === 'fulfilled' && trades.value.pair === pair
        ? trades.value.trades.filter(row => positive(row.price) && positive(row.quantity)
          && Number.isFinite(row.time) && row.time > 0 && (row.side === 'BUY' || row.side === 'SELL'))
          .sort((a, b) => b.time - a.time).slice(0, 6) : [];
      const bookOk = !!validBook && validBook.bids.length > 0 && validBook.asks.length > 0;
      const candlesOk = validCandles.length > 0;
      const tradesOk = validTrades.length > 0;
      setHero(previous => ({
        pair,
        book: bookOk ? validBook : previous.book,
        candles: candlesOk ? validCandles : previous.candles,
        candlesUpdatedAt: candlesOk ? Date.now() : previous.candlesUpdatedAt,
        trades: tradesOk ? validTrades : previous.trades,
        bookStatus: bookOk ? 'ok' : 'error',
        candlesStatus: candlesOk ? 'ok' : 'error',
        tradesStatus: tradesOk ? 'ok' : 'error',
        stale: (!bookOk && !!previous.book) || (!candlesOk && previous.candles.length > 0)
          || (!tradesOk && previous.trades.length > 0),
        updatedAt: bookOk && candlesOk && tradesOk ? Date.now() : previous.updatedAt,
      }));
    }

    function loadTickers() {
      if (cancelled || document.hidden || tickerInFlight
        || Date.now() - tickerStartedAt < TICKER_POLL_MS) return;
      tickerInFlight = true;
      tickerStartedAt = Date.now();
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          const rows: HomeTicker[] = res.tickers.filter(t =>
            Number.isFinite(receivedNumber(t.lastPrice)) && receivedNumber(t.lastPrice) >= 0
          ).map((t) => {
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
          hasTickers = true;
          setTickers(rows);
          setTickerUpdatedAt(Date.now());
          setTickerSource(res.source);
          setTickersStale(false);
          setPriceHistory(previous => {
            const next: Record<string, number[]> = {};
            byVolume(rows, 60).forEach(row => {
              if (Number.isFinite(row.price) && row.price >= 0) {
                next[row.pair] = [...(previous[row.pair] ?? []), row.price].slice(-24);
              }
            });
            return next;
          });
          if (!heroPair) {
            heroPair = rows.find(row => row.pair === 'BTC/USDT')?.pair ?? byVolume(rows, 1)[0]?.pair ?? null;
            setHero(previous => ({
              ...previous, pair: heroPair,
              bookStatus: heroPair ? 'loading' : 'error',
              candlesStatus: heroPair ? 'loading' : 'error',
              tradesStatus: heroPair ? 'loading' : 'error',
            }));
          }
          void loadHero();
          setTickersStatus(rows.length > 0 ? 'ok' : 'error');
        })
        .catch(() => {
          if (cancelled) return;
          // Keep whatever was last shown rather than blanking a populated
          // strip on one failed poll.
          setTickersStale(hasTickers);
          if (!heroPair) {
            setHero(previous => ({
              ...previous, bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error', stale: false,
            }));
          }
          setTickersStatus((prev) => (prev === 'ok' ? 'ok' : 'error'));
        })
        .finally(() => { tickerInFlight = false; });
    }

    const refresh = () => {
      loadTickers();
      void loadHero();
      void loadCfd();
    };
    const terminal = document.getElementById('home-live-terminal');
    const observer = typeof IntersectionObserver !== 'undefined' && terminal
      ? new IntersectionObserver(entries => {
        heroVisible = entries.some(entry => entry.isIntersecting);
        if (heroVisible) { void loadHero(); void loadCfd(); }
      }, { rootMargin: '120px' }) : null;
    if (terminal) observer?.observe(terminal);
    refresh();
    const poll = window.setInterval(refresh, TICKER_POLL_MS);
    document.addEventListener('visibilitychange', refresh);

    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        setRankings(res.rankings);
        setRankingsStatus('ok');
      })
      .catch(() => !cancelled && setRankingsStatus('error'));

    api
      .getGlobalMarket()
      .then((res) => {
        if (cancelled) return;
        setGlobal(res.global);
        setFearGreed(res.fearGreed);
        setGlobalStatus(res.global || res.fearGreed ? 'ok' : 'error');
      })
      .catch(() => !cancelled && setGlobalStatus('error'));

    // Public endpoint (no auth) — the same listing the futures terminal
    // reads, so the homepage's Фьючерсы tab shows the real contract
    // universe rather than a marketing-side guess at it.
    futuresConfigStore
      .load()
      .then((res) => {
        if (cancelled) return;
        setFuturesSymbols(res.symbols);
        setFuturesStatus(res.symbols.length > 0 ? 'ok' : 'error');
      })
      .catch(() => !cancelled && setFuturesStatus('error'));

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const logoByBase = new Map(rankings.map((r) => [r.symbol.toUpperCase(), r.image]));

  return {
    priceHistory, tickerUpdatedAt, tickerSource, tickersStale, hero,
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

/** USDT markets by real 24h turnover, descending. */
export function byVolume(tickers: HomeTicker[], limit: number): HomeTicker[] {
  return tickers
    .filter((t) => t.quote === 'USDT')
    .sort((a, b) => (Number.isFinite(b.quoteVolume) ? b.quoteVolume : -1)
      - (Number.isFinite(a.quoteVolume) ? a.quoteVolume : -1))
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
