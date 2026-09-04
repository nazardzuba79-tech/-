import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { parseChangePercent } from '../../lib/priceChange';

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

/** Independent load state per source. The homepage is composed of five
 *  market panels served by three different upstreams; if one is down the
 *  page must still render everything else, so each section reads its own
 *  status rather than one shared "loading" flag gating the whole page. */
export type Status = 'loading' | 'ok' | 'error';

export interface HomeMarket {
  tickers: HomeTicker[];
  tickersStatus: Status;
  rankings: HomeRanking[];
  rankingsStatus: Status;
  global: Global['global'] | null;
  fearGreed: Global['fearGreed'] | null;
  globalStatus: Status;
  cfd: Cfd | null;
  cfdStatus: Status;
  /** The contracts the perpetual exchange actually lists right now, straight
   *  from /futures/config (FuturesMarketRegistry). Never a hardcoded list. */
  futuresSymbols: string[];
  futuresStatus: Status;
  /** Logo for a base asset, from the exchange's own ranking feed. */
  logoOf: (base: string) => string | undefined;
}

// One poll for the whole page. The ticker feed is the only thing here that
// moves minute to minute; rankings, global stats and CFD quotes are slower
// and are fetched once. Deliberately a single shared hook rather than a
// fetch per section — five sections each opening their own poll is exactly
// the kind of duplication that makes a landing page heavy.
const TICKER_POLL_MS = 15_000;

export function useHomeMarket(): HomeMarket {
  const [tickers, setTickers] = useState<HomeTicker[]>([]);
  const [tickersStatus, setTickersStatus] = useState<Status>('loading');
  const [rankings, setRankings] = useState<HomeRanking[]>([]);
  const [rankingsStatus, setRankingsStatus] = useState<Status>('loading');
  const [global, setGlobal] = useState<Global['global'] | null>(null);
  const [fearGreed, setFearGreed] = useState<Global['fearGreed'] | null>(null);
  const [globalStatus, setGlobalStatus] = useState<Status>('loading');
  const [cfd, setCfd] = useState<Cfd | null>(null);
  const [cfdStatus, setCfdStatus] = useState<Status>('loading');
  const [futuresSymbols, setFuturesSymbols] = useState<string[]>([]);
  const [futuresStatus, setFuturesStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;

    function loadTickers() {
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          const rows: HomeTicker[] = res.tickers.map((t) => {
            const [base, quote] = t.pair.split('/');
            return {
              pair: t.pair,
              base,
              quote,
              price: parseFloat(t.lastPrice) || 0,
              change: parseChangePercent(t.changePercent24h, t.pair),
              quoteVolume: parseFloat(t.quoteVolume24h) || 0,
              high: parseFloat(t.high24h) || 0,
              low: parseFloat(t.low24h) || 0,
            };
          });
          setTickers(rows);
          setTickersStatus(rows.length > 0 ? 'ok' : 'error');
        })
        .catch(() => {
          if (cancelled) return;
          // Keep whatever was last shown rather than blanking a populated
          // strip on one failed poll.
          setTickersStatus((prev) => (prev === 'ok' ? 'ok' : 'error'));
        });
    }

    loadTickers();
    const poll = window.setInterval(loadTickers, TICKER_POLL_MS);

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

    api
      .getCfdTickers()
      .then((res) => {
        if (cancelled) return;
        setCfd(res);
        setCfdStatus('ok');
      })
      .catch(() => !cancelled && setCfdStatus('error'));

    // Public endpoint (no auth) — the same listing the futures terminal
    // reads, so the homepage's Фьючерсы tab shows the real contract
    // universe rather than a marketing-side guess at it.
    api
      .getFuturesConfig()
      .then((res) => {
        if (cancelled) return;
        setFuturesSymbols(res.symbols);
        setFuturesStatus(res.symbols.length > 0 ? 'ok' : 'error');
      })
      .catch(() => !cancelled && setFuturesStatus('error'));

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  const logoByBase = new Map(rankings.map((r) => [r.symbol.toUpperCase(), r.image]));

  return {
    tickers,
    tickersStatus,
    rankings,
    rankingsStatus,
    global,
    fearGreed,
    globalStatus,
    cfd,
    cfdStatus,
    futuresSymbols,
    futuresStatus,
    logoOf: (base: string) => logoByBase.get(base.toUpperCase()),
  };
}

/** USDT markets by real 24h turnover, descending. */
export function byVolume(tickers: HomeTicker[], limit: number): HomeTicker[] {
  return tickers
    .filter((t) => t.quote === 'USDT')
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}

export function formatPriceValue(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
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
