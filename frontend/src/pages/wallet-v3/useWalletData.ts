import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CoinRanking } from '../../lib/pairList';
import { nativeDemoApi, type NativeWallet } from '../../lib/nativeDemoApi';

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
  /**
   * Held against the account's own orders and positions, so not spendable.
   * On the Cross account this also carries the margin the engine reports
   * locked against the settle asset.
   */
  locked: number;
  priceUsd: number | null;
  changePercent24h: number | null;
  valueUsd: number | null;
  /** True for rows the account can actually act on (deposit/withdraw). */
  spendable: boolean;
  /**
   * False when this row's asset could not be priced. `valueUsd` is then
   * `null` — an unknown, NOT a zero — and the interface has to say so
   * rather than let the row read as a worthless holding.
   */
  priced: boolean;
}

/**
 * The account summary the Unified Trading Account header renders.
 *
 * Every field is `number | null`, and `null` means UNKNOWN: the figure does
 * not apply to this kind of account, or the server did not answer it. It is
 * rendered as an em dash and never as 0 — a margin requirement of zero and
 * an unknown margin requirement are different facts.
 */
export interface UnifiedAccount {
  /** 'CROSS' for the authoritative margin account; 'SPOT' for a plain ledger. */
  mode: 'CROSS' | 'SPOT';
  totalEquityUsd: number | null;
  availableUsd: number | null;
  unrealizedPnlUsd: number | null;
  initialMarginUsd: number | null;
  maintenanceMarginUsd: number | null;
  orderReserveUsd: number | null;
  /** The two ledger subtotals, for the accounts that actually have two. */
  spotUsd: number | null;
  futuresUsd: number | null;
  /** False when a held asset could not be priced — the totals are a FLOOR. */
  valuationComplete: boolean;
  unpricedAssets: string[];
  settleAsset: string;
}

export type LoadState = 'loading' | 'ok' | 'error';

const BALANCE_POLL_MS = 8_000;
const RANKINGS_POLL_MS = 15_000;

const finite = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The Wallet page's data.
 *
 * TWO KINDS OF ACCOUNT, ONE PAGE, NEVER TWO SETS OF BOOKS.
 *
 * An ordinary account is its spot and futures ledgers, valued once by
 * `/wallet/overview`. The owner's account is a Cross margin account, and its
 * equity, margins and P&L are computed in exactly one place — the native
 * account model the Futures terminal reads. This hook asks that endpoint for
 * them rather than deriving a second answer here, which is why the Wallet
 * and `/futures` cannot disagree: they are printing the same object.
 *
 * REQUEST COST. The unified account is read ONCE per page load and again
 * only when something happened that could have changed it (a transfer, a
 * withdrawal, the tab coming back to the foreground). It is deliberately
 * NOT on the 8-second balance poll: its valuation fetches a live mark per
 * held asset, so polling it would multiply upstream load by the number of
 * assets the owner holds. It replaces the single `/native/account` request
 * the old futures card made, so the page's steady-state request count is
 * unchanged.
 */
export function useWalletData() {
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [overviewState, setOverviewState] = useState<LoadState>('loading');
  const [performance, setPerformance] = useState<WalletPerformance | null>(null);
  const [performanceState, setPerformanceState] = useState<LoadState>('loading');
  const [rankings, setRankings] = useState<CoinRanking[]>([]);
  const [rankingsLoaded, setRankingsLoaded] = useState(false);
  // `undefined` = not answered yet, `null` = answered "you have no such
  // account". The two are different and the page waits on the first.
  const [unified, setUnified] = useState<NativeWallet | null | undefined>(undefined);
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

  const loadUnified = useCallback(() => {
    nativeDemoApi
      .wallet()
      // 401/403 (not the owner) and 409 (no margin account yet) all mean the
      // same thing here: this account is an ordinary ledger, render it as one.
      .then((res) => setUnified(res))
      .catch(() => setUnified((prev) => (prev ? prev : null)));
  }, []);

  useEffect(() => {
    loadUnified();
  }, [loadUnified]);

  // Coming back to the tab is the one moment a stale account figure is most
  // likely and cheapest to fix: it costs one request, only after the page
  // was actually left, and never fires while the user is looking at it.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadUnified();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadUnified]);

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
   * The account summary, from whichever source is authoritative for THIS
   * account. Never a blend of the two: a Cross account's equity already
   * counts its whole wallet, so adding a ledger subtotal to it would count
   * the same collateral twice.
   */
  const account: UnifiedAccount | null = useMemo(() => {
    if (unified) {
      const a = unified.account;
      return {
        mode: 'CROSS',
        totalEquityUsd: finite(a.equity),
        availableUsd: finite(a.available),
        unrealizedPnlUsd: finite(a.unrealizedPnl),
        initialMarginUsd: finite(a.initialMargin),
        maintenanceMarginUsd: finite(a.maintenanceMargin),
        orderReserveUsd: finite(a.orderReserve),
        // A Cross account has one pool, not a spot half and a futures half.
        // Reporting a split it does not have would be an invention.
        spotUsd: null,
        futuresUsd: null,
        valuationComplete: a.collateralComplete,
        unpricedAssets: a.unpricedAssets,
        settleAsset: unified.collateral.settleAsset,
      };
    }
    if (!overview) return null;
    return {
      mode: 'SPOT',
      totalEquityUsd: overview.real.totalValueUsd,
      // Spendable cash is a per-asset fact on a plain ledger, shown in the
      // rows. There is no single account-level "available margin" to report,
      // and a made-up one would be worse than the dash.
      availableUsd: null,
      unrealizedPnlUsd: null,
      initialMarginUsd: null,
      maintenanceMarginUsd: null,
      orderReserveUsd: null,
      spotUsd: overview.real.spotValueUsd,
      futuresUsd: overview.real.futuresValueUsd,
      valuationComplete: overview.valuationComplete,
      unpricedAssets: overview.unpricedAssets,
      settleAsset: 'USDT',
    };
  }, [unified, overview]);

  /**
   * Today's snapshot, recorded once per page load from whatever this
   * account's authoritative total is. The backend dedupes per UTC day as
   * well. Nothing is written until an authoritative total exists, so a
   * half-loaded page can never record a zero.
   */
  useEffect(() => {
    if (snapshotRecorded.current || unified === undefined) return;
    const total = account?.totalEquityUsd ?? null;
    if (total === null || total <= 0) return;
    snapshotRecorded.current = true;
    api
      .recordPortfolioSnapshot(total.toFixed(2))
      .then(() => loadPerformance())
      .catch(() => {});
  }, [account, unified, loadPerformance]);

  const rankingBySymbol = useMemo(() => new Map(rankings.map((r) => [r.symbol, r])), [rankings]);

  /**
   * The ledger rows.
   *
   * For the Cross account they are the server's own wallet projection — one
   * row per asset, with the balance that has moved into the trading ledger
   * already folded into the settle row and the margin already subtracted.
   * None of that arithmetic happens here; see `unifiedWalletRows` on the
   * server for why each figure is what it is.
   *
   * For everyone else they are the real spot balances joined onto the coin
   * browser, exactly as before. Prices and 24h changes come from the same
   * market feed in both cases.
   */
  const rows: LedgerRow[] = useMemo(() => {
    if (unified) {
      return unified.rows.map((r) => {
        const ranking = rankingBySymbol.get(r.asset);
        const total = Number(r.total);
        return {
          symbol: r.asset,
          name: ranking?.name ?? r.asset,
          total,
          available: Number(r.available),
          locked: Number(r.inUse),
          priceUsd: finite(r.price),
          changePercent24h: ranking?.changePercent24h ?? null,
          // Straight from the server. `null` for an UNPRICED asset stays
          // null all the way to the cell, which renders a dash.
          valueUsd: finite(r.value),
          spendable: false,
          priced: r.status !== 'UNPRICED',
        };
      });
    }

    if (!overview) return [];

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
        // Only a held asset can be an unknown: a row the account has none of
        // is not an incomplete valuation, it is an empty one.
        priced: priceUsd !== null || total === 0,
      };
    });
  }, [unified, overview, rankingBySymbol]);

  const btcEquivalent = useMemo(() => {
    const total = account?.totalEquityUsd ?? null;
    if (total === null) return null;
    // The Cross account's own BTC mark, when it holds BTC, in preference to
    // the spot feed's: the equity it divides was valued at that mark.
    const nativeBtc = unified?.collateral.lines.find((l) => l.asset === 'BTC')?.price ?? null;
    const price = finite(nativeBtc) ?? overview?.btcPriceUsd ?? null;
    if (price === null || price <= 0) return null;
    return total / price;
  }, [account, unified, overview]);

  const refresh = useCallback(() => {
    loadOverview();
    loadUnified();
  }, [loadOverview, loadUnified]);

  return {
    overview,
    overviewState,
    performance,
    performanceState,
    account,
    /** True once the unified account question has been answered either way. */
    accountResolved: unified !== undefined,
    rows,
    rankingsLoaded,
    btcEquivalent,
    refresh,
  };
}
