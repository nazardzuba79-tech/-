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
 */
export const HOME_MARKET_REFRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HERO_PAIR = 'BTC/USDT';
const receivedNumber = (value: unknown): number => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : NaN;

export function useHomeMarket(): HomeMarket {
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});
  const [tickerUpdatedAt, setTickerUpdatedAt] = useState<number | null>(null);
  const [tickerSource, setTickerSource] = useState('');
  const [tickersStale, setTickersStale] = useState(false);
  const [hero, setHero] = useState<HomeHeroFeed>({
    pair: DEFAULT_HERO_PAIR, book: null, candles: [], trades: [],
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
    const heroPair: string | null = DEFAULT_HERO_PAIR;
    let tickerStartedAt = -Infinity;
    let heroStartedAt = -Infinity;
    let cfdStartedAt = -Infinity;
    let cfdInFlight = false;

    const positive = (value: string | number) => Number.isFinite(Number(value)) && Number(value) > 0;
    const updateHero = (pair: string, patch: Partial<HomeHeroFeed>) => {
      if (cancelled || pair !== heroPair) return;
      setHero(previous => {
        const next: HomeHeroFeed = { ...previous, pair, ...patch };
        return {
          ...next,
          stale: (next.bookStatus === 'error' && !!next.book)
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
        const res = await api.getCfdTickers();
        if (cancelled) return;
        setCfd(res);
        setCfdStatus('ok');
        setCfdPriceHistory(previous => {
          const next: Record<string, number[]> = { ...previous };
          res.tickers.forEach(row => {
            const price = receivedNumber(row.price);
            if (row.status === 'live' && !row.stale && Number.isFinite(price) && price > 0) {
              const old = previous[row.symbol] ?? [];
              if (old[old.length - 1] !== price) next[row.symbol] = [...old, price].slice(-24);
            }
          });
          return next;
        });
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

      const bookTask = api.getExternalOrderBook(pair, 12).then(value => {
        const validBook = value.pair === pair && positive(value.timestamp)
          ? { ...value,
            bids: value.bids.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
            asks: value.asks.filter(row => positive(row.price) && positive(row.quantity)).slice(0, 6),
          } : null;
        const ok = !!validBook && validBook.bids.length > 0 && validBook.asks.length > 0;
        if (ok) updateHero(pair, { book: validBook, bookStatus: 'ok' });
        else updateHero(pair, { bookStatus: 'error' });
      }).catch(() => updateHero(pair, { bookStatus: 'error' }));

      const candleTask = api.getExternalCandles(pair, '15m', 48).then(value => {
        const validCandles = value.pair === pair
          ? value.candles.filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
            && Math.min(c.time, c.open, c.high, c.low, c.close) > 0
            && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))
            .sort((a, b) => a.time - b.time).slice(-48) : [];
        if (validCandles.length > 0) updateHero(pair, {
          candles: validCandles,
          candlesUpdatedAt: Date.now(),
          candlesStatus: 'ok',
        });
        else updateHero(pair, { candlesStatus: 'error' });
      }).catch(() => updateHero(pair, { candlesStatus: 'error' }));

      const tradeTask = api.getExternalTrades(pair, 8).then(value => {
        const validTrades = value.pair === pair
          ? value.trades.filter(row => positive(row.price) && positive(row.quantity)
            && Number.isFinite(row.time) && row.time > 0 && (row.side === 'BUY' || row.side === 'SELL'))
            .sort((a, b) => b.time - a.time).slice(0, 6) : [];
        if (validTrades.length > 0) updateHero(pair, { trades: validTrades, tradesStatus: 'ok' });
        else updateHero(pair, { tradesStatus: 'error' });
      }).catch(() => updateHero(pair, { tradesStatus: 'error' }));

      await Promise.allSettled([bookTask, candleTask, tradeTask]);
      heroInFlight = false;
      if (cancelled || pair !== heroPair) return;
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
      api.getExternalTickers().then(res => {
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
        hasTickers = true;
        setTickers(rows);
        setTickerUpdatedAt(Date.now());
        setTickerSource(res.source);
        setTickersStale(false);
        setPriceHistory(previous => {
          const next: Record<string, number[]> = { ...previous };
          byVolume(rows, 60).forEach(row => {
            if (!Number.isFinite(row.price) || row.price < 0) return;
            const old = previous[row.pair] ?? [];
            if (old[old.length - 1] !== row.price) next[row.pair] = [...old, row.price].slice(-24);
          });
          return next;
        });
        setTickersStatus('ok');
      }).catch(() => {
        if (cancelled) return;
        setTickersStale(hasTickers);
        setTickersStatus(previous => previous === 'ok' ? 'ok' : 'error');
      }).finally(() => {
        tickerInFlight = false;
      });
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
        if (heroVisible) {
          void loadHero();
          void loadCfd();
        }
      }, { rootMargin: '120px' })
      : null;
    if (terminal) observer?.observe(terminal);
    refresh();
    const poll = window.setInterval(refresh, HOME_MARKET_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);

    // These are metadata/bootstrap reads rather than live quote loops. They
    // remain one-shot per homepage mount; no child opens its own poller.
    api.getExternalRankings().then(res => {
      if (cancelled) return;
      setRankings(res.rankings);
      setRankingsStatus('ok');
    }).catch(() => !cancelled && setRankingsStatus('error'));
    api.getGlobalMarket().then(res => {
      if (cancelled) return;
      setGlobal(res.global);
      setFearGreed(res.fearGreed);
      setGlobalStatus(res.global || res.fearGreed ? 'ok' : 'error');
    }).catch(() => !cancelled && setGlobalStatus('error'));
    futuresConfigStore.load().then(res => {
      if (cancelled) return;
      setFuturesSymbols(res.symbols);
      setFuturesStatus(res.symbols.length > 0 ? 'ok' : 'error');
    }).catch(() => !cancelled && setFuturesStatus('error'));

    return () => {
      cancelled = true;
      window.clearInterval(poll);
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
