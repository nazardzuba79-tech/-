import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CoinRanking } from '../../lib/pairList';

export type PerformancePeriod = '7d' | '30d' | '90d' | '1y' | 'all';
export const PERFORMANCE_PERIODS: PerformancePeriod[] = ['7d', '30d', '90d', '1y', 'all'];

export type WalletOverview = Awaited<ReturnType<typeof api.getWalletOverview>>;
export type WalletPerformance = Awaited<ReturnType<typeof api.getWalletPerformance>>;

/** One row of the asset ledger, whatever produced it. */
export interface LedgerRow {
  symbol: string;
  name: string;
  /** Total units held. */
  total: number;
  available: number;
  locked: number;
  priceUsd: number | null;
  changePercent24h: number | null;
  valueUsd: number | null;
  /** True for rows the account can actually act on (deposit/withdraw). */
  spendable: boolean;
}

export type LoadState = 'loading' | 'ok' | 'error';

const BALANCE_POLL_MS = 8_000;
const RANKINGS_POLL_MS = 15_000;

/**
 * The Wallet page's data.
 *
 * The valuation and the performance both come from the backend now, which
 * is what lets one code path serve an ordinary account and the operator
 * profile without the page knowing the difference — it renders whatever
 * `overview.presentation ?? overview.real` gives it. The coin browser
 * (price/24h/market cap for every listed asset) stays on the existing
 * rankings feed, unchanged.
 */
export function useWalletData() {
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [overviewState, setOverviewState] = useState<LoadState>('loading');
  const [performance, setPerformance] = useState<WalletPerformance | null>(null);
  const [performanceState, setPerformanceState] = useState<LoadState>('loading');
  const [rankings, setRankings] = useState<CoinRanking[]>([]);
  const [rankingsLoaded, setRankingsLoaded] = useState(false);
  const snapshotRecorded = useRef(false);

  const loadOverview = useCallback(() => {
    api
      .getWalletOverview()
      .then((res) => {
        setOverview(res);
        setOverviewState('ok');
      })
      // Keep the last good figures rather than blanking a populated page on
      // one failed poll; only a cold start shows the error state.
      .catch(() => setOverviewState((prev) => (prev === 'ok' ? 'ok' : 'error')));
  }, []);

  useEffect(() => {
    loadOverview();
    const id = setInterval(loadOverview, BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [loadOverview]);

  const loadPerformance = useCallback(() => {
    api
      .getWalletPerformance()
      .then((res) => {
        setPerformance(res);
        setPerformanceState('ok');
      })
      .catch(() => setPerformanceState((prev) => (prev === 'ok' ? 'ok' : 'error')));
  }, []);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  useEffect(() => {
    function load() {
      api
        .getExternalRankings()
        .then((res) => setRankings(res.rankings as CoinRanking[]))
        .catch(() => {})
        .finally(() => setRankingsLoaded(true));
    }
    load();
    const id = setInterval(load, RANKINGS_POLL_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * Today's snapshot, recorded once per page load from the account's real
   * total. The backend dedupes per UTC day as well. Deliberately the *real*
   * total: the stored history is a record of the ledger, and a presentation
   * profile must not write itself into it.
   */
  useEffect(() => {
    if (snapshotRecorded.current || !overview) return;
    if (overview.real.spot.length === 0 && overview.real.futures.length === 0) return;
    snapshotRecorded.current = true;
    api
      .recordPortfolioSnapshot(overview.real.totalValueUsd.toFixed(2))
      .then(() => loadPerformance())
      .catch(() => {});
  }, [overview, loadPerformance]);

  const rankingBySymbol = useMemo(() => new Map(rankings.map((r) => [r.symbol, r])), [rankings]);

  /**
   * The ledger rows. For an account with a presentation profile those are
   * the profile's holdings; for everyone else they are the real spot
   * balances joined onto the coin browser, exactly as before. Prices and
   * 24h changes come from the same market feed in both cases.
   */
  const rows: LedgerRow[] = useMemo(() => {
    if (!overview) return [];

    if (overview.presentation) {
      return overview.presentation.holdings.map((h) => {
        const ranking = rankingBySymbol.get(h.asset);
        const total = Number(h.quantity);
        return {
          symbol: h.asset,
          name: ranking?.name ?? h.asset,
          total,
          available: total,
          locked: 0,
          priceUsd: h.priceUsd,
          changePercent24h: ranking?.changePercent24h ?? null,
          valueUsd: h.valueUsd,
          spendable: false,
        };
      });
    }

    const bySymbol = new Map(overview.real.spot.map((b) => [b.asset, b]));
    const symbols = new Set<string>([...rankingBySymbol.keys(), ...bySymbol.keys()]);
    return [...symbols].map((symbol) => {
      const ranking = rankingBySymbol.get(symbol);
      const b = bySymbol.get(symbol);
      const available = b ? Number(b.available) : 0;
      const locked = b ? Number(b.locked) : 0;
      const total = available + locked;
      // A held asset is valued by the same endpoint that produced the
      // portfolio total, so a row can never disagree with the header. The
      // coin browser's ranking price only fills in assets the account does
      // not hold, and its 24h change is used for everything.
      const priceUsd = b?.priceUsd ?? ranking?.price ?? null;
      return {
        symbol,
        name: ranking?.name ?? symbol,
        total,
        available,
        locked,
        priceUsd,
        changePercent24h: ranking?.changePercent24h ?? null,
        valueUsd: b?.valueUsd ?? (priceUsd === null ? null : total * priceUsd),
        spendable: true,
      };
    });
  }, [overview, rankingBySymbol]);

  const btcEquivalent = useMemo(() => {
    if (!overview?.btcPriceUsd) return null;
    return overview.displayTotalUsd / overview.btcPriceUsd;
  }, [overview]);

  return {
    overview,
    overviewState,
    performance,
    performanceState,
    rows,
    rankingsLoaded,
    btcEquivalent,
    refresh: loadOverview,
  };
}
