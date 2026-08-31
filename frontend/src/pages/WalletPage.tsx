import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf, Key } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { DepositModal } from '../components/DepositModal';
import { WithdrawModal } from '../components/WithdrawModal';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { SearchInput } from '../components/SearchInput';
import { CryptoIcon, assetColor } from '../components/CryptoIcon';
import { PortfolioDonut, DonutSlice } from '../components/PortfolioDonut';
import { Sparkline } from '../components/Sparkline';
import { Footer } from '../components/Footer';
import { SkeletonRow } from '../components/Skeleton';
import { Badge } from '../components/Badge';
import { PortfolioValueChart, ChartRange } from '../components/PortfolioValueChart';
import { CoinRanking } from '../lib/pairList';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

interface Deposit {
  id: string;
  asset: string;
  chain: string;
  txHash: string;
  amount: string;
  confirmations: number;
  status: string;
  createdAt: string;
}

type ActivityType = 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL';
interface ActivityItem {
  id: string;
  type: ActivityType;
  asset: string;
  amountLabel: string;
  timestamp: number;
}

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'USD']);
// Not offered on this exchange — kept out of both the assets table and the
// portfolio donut (TON stands in its place among the featured assets).
const EXCLUDED_ASSETS = new Set(['BNB']);
// A slice below this share of the portfolio is folded into "Other" rather
// than drawn as its own sliver — keeps the ring and legend readable once an
// account holds many small positions.
const MIN_SLICE_SHARE = 0.02;
// Purely illustrative — shown dimmed, with no legend and no "example" label,
// only while the account holds nothing at all, so the ring itself hints at
// what a real distribution looks like instead of a flat empty circle.
const EXAMPLE_DONUT_SLICES: DonutSlice[] = (
  [
    ['BTC', 38],
    ['ETH', 20],
    ['USDT', 15],
    ['SOL', 12],
    ['XRP', 9],
    ['TRX', 6],
  ] as const
).map(([label, value]) => {
  const c = assetColor(label);
  return { label, value, color: c.solid, gradientTo: c.gradientTo };
});
const HIDE_BALANCE_KEY = 'exchange_hide_balance';
const HIDE_ZERO_KEY = 'exchange_hide_zero_balances';
const MASK = '••••••';

// Real block explorers for the two chains this deployment actually verifies
// deposits on (see KNOWN_CHAINS in src/api/routes/deposits.ts) — never
// guessed, and never shown for any other chain value.
const EXPLORER_TX_URL: Record<string, (tx: string) => string> = {
  bitcoin: (tx) => `https://blockstream.info/tx/${tx}`,
  tron: (tx) => `https://tronscan.org/#/transaction/${tx}`,
};

type SortKey = 'asset' | 'price' | 'change' | 'volume' | 'marketCap';
type Tab = 'assets' | 'history';
const RANKINGS_POLL_MS = 10_000;
type HistoryFilter = 'ALL' | 'CREDITED' | 'PENDING' | 'BELOW_MINIMUM';

const HISTORY_STATUS_KEY: Record<string, Key> = {
  CREDITED: 'wallet.history.status.CREDITED',
  PENDING: 'wallet.history.status.PENDING',
  BELOW_MINIMUM: 'wallet.history.status.BELOW_MINIMUM',
};

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // best-effort — the toggle just won't persist across reloads
  }
}

/**
 * Portfolio overview across everything the account actually holds — total
 * USD value (priced off the same Kraken mirror the trade page uses), a
 * real Spot vs Futures split (two genuinely separate balance pools, see
 * FuturesBalance's schema comment), and a per-asset breakdown.
 *
 * Also absorbs what used to be a standalone Dashboard page (open orders/
 * positions counts + a combined deposit/withdrawal/trade activity feed) —
 * that page was mostly duplicating the total value/donut/chart already
 * shown here, so its few genuinely new pieces moved in rather than keeping
 * a second nav tab open just for them.
 *
 * No "Funding" bucket: this exchange has no such account type, so
 * inventing one here would just be fictional UI. No Web3/on-chain tab
 * either — that would need a connected external wallet (WalletConnect/
 * EIP-1193) this codebase doesn't integrate, so showing one would mean
 * fabricating addresses/balances nobody actually holds.
 */
export function WalletPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [spotBalances, setSpotBalances] = useState<Balance[]>([]);
  const [futuresBalances, setFuturesBalances] = useState<Balance[]>([]);
  const [demoBalances, setDemoBalances] = useState<Balance[]>([]);
  const [priceByAsset, setPriceByAsset] = useState<Record<string, number>>({});
  const [rankings, setRankings] = useState<CoinRanking[]>([]);
  const [rankingsLoaded, setRankingsLoaded] = useState(false);
  const [rankingsError, setRankingsError] = useState(false);
  const [showDeposit, setShowDeposit] = useState(() => searchParams.get('action') === 'deposit');
  const [showTransfer, setShowTransfer] = useState(() => searchParams.get('action') === 'transfer');
  const [withdrawAsset, setWithdrawAsset] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideBalance, setHideBalance] = useState(() => loadFlag(HIDE_BALANCE_KEY));
  const [hideZero, setHideZero] = useState(() => loadFlag(HIDE_ZERO_KEY));
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [tab, setTab] = useState<Tab>('assets');
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');
  const [chartRange, setChartRange] = useState<ChartRange>('30d');
  const [chartPoints, setChartPoints] = useState<{ date: string; totalValueUsd: string }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [openOrdersCount, setOpenOrdersCount] = useState<number | null>(null);
  const [openPositionsCount, setOpenPositionsCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const snapshotRecordedRef = useRef(false);

  // Whether to poll the admin-only demo-sandbox balance below at all. Same
  // UX-only role check the nav already does; the endpoint itself is
  // independently re-checked server-side (see requireAdmin).
  useEffect(() => {
    api
      .getMe()
      .then((me) => setIsAdmin(me.isAdmin))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function load() {
      api.getBalances().then(setSpotBalances).catch(() => {});
      api.getFuturesBalances().then(setFuturesBalances).catch(() => {});
      // Kraken-mirrored USDT prices — used for the header's total portfolio
      // value (actually tradable, our-exchange pricing) and to tell whether
      // an asset has a real pair here at all (gates the "Buy" action below).
      // Per-row price/24h%/volume/market cap in the table itself come from
      // CoinGeckoService's real market-wide data instead (see the rankings
      // effect) — that's the source explicitly requested for this table.
      api
        .getExternalTickers()
        .then((res) => {
          const prices: Record<string, number> = {};
          for (const tk of res.tickers) {
            const [base, quote] = tk.pair.split('/');
            if (quote === 'USDT') prices[base] = parseFloat(tk.lastPrice);
          }
          setPriceByAsset(prices);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  // The admin-only demo sandbox's balance, shown here only when it's
  // actually non-empty. Gated on the role check above rather than fired
  // for everyone and letting it 403 — unconditionally polling it logged a
  // 403 to every non-admin user's console every 8 seconds.
  useEffect(() => {
    if (!isAdmin) return;
    function load() {
      api.getDemoBalances().then(setDemoBalances).catch(() => {});
    }
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // Top-200-by-market-cap coin browser data (price/24h%/volume/market cap/
  // sparkline) — polled on its own cadence since it's backed by the
  // backend's own short cache (see CoinGeckoService), so polling this often
  // just re-serves that cache cheaply rather than hammering CoinGecko.
  useEffect(() => {
    function load() {
      api
        .getExternalRankings()
        .then((res) => {
          setRankings(res.rankings as CoinRanking[]);
          setRankingsError(false);
        })
        .catch(() => setRankingsError(true))
        .finally(() => setRankingsLoaded(true));
    }
    load();
    const interval = setInterval(load, RANKINGS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tab !== 'history' || deposits !== null) return;
    api
      .getMyDeposits()
      .then(setDeposits)
      .catch(() => setHistoryError(true));
  }, [tab, deposits]);

  // Folded in from the old standalone Dashboard page (merged here since it
  // was mostly duplicating what Wallet already shows) — real open order/
  // position counts and a combined recent-activity feed across deposits,
  // withdrawals, and trades, same real endpoints as everywhere else.
  useEffect(() => {
    Promise.all([api.getMyOrders('OPEN'), api.getMyFuturesOrders('OPEN')])
      .then(([spot, futures]) => setOpenOrdersCount(spot.length + futures.length))
      .catch(() => {});
    api
      .getFuturesPositions()
      .then((positions) => setOpenPositionsCount(positions.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api.getMyDeposits(), api.getMyWithdrawals(), api.getMyTrades()])
      .then(([dep, withdrawals, trades]) => {
        const items: ActivityItem[] = [
          ...dep.map((d): ActivityItem => ({
            id: `dep-${d.id}`,
            type: 'DEPOSIT',
            asset: d.asset,
            amountLabel: `+${d.amount} ${d.asset}`,
            timestamp: new Date(d.createdAt).getTime(),
          })),
          ...withdrawals.map((w): ActivityItem => ({
            id: `wd-${w.id}`,
            type: 'WITHDRAW',
            asset: w.asset,
            amountLabel: `-${w.amount} ${w.asset}`,
            timestamp: new Date(w.createdAt).getTime(),
          })),
          ...trades.map((tr): ActivityItem => {
            const [base] = tr.pair.split('/');
            return {
              id: `tr-${tr.id}`,
              type: tr.side === 'BUY' ? 'BUY' : 'SELL',
              asset: base,
              amountLabel: `${tr.quantity} ${base}`,
              timestamp: new Date(tr.executedAt).getTime(),
            };
          }),
        ];
        items.sort((a, b) => b.timestamp - a.timestamp);
        setActivity(items.slice(0, 6));
      })
      .catch(() => setActivity([]));
  }, []);

  function priceOf(asset: string): number | null {
    if (STABLE_ASSETS.has(asset)) return 1;
    return priceByAsset[asset] ?? null;
  }

  function toggleHideBalance() {
    setHideBalance((v) => {
      saveFlag(HIDE_BALANCE_KEY, !v);
      return !v;
    });
  }

  function toggleHideZero() {
    setHideZero((v) => {
      saveFlag(HIDE_ZERO_KEY, !v);
      return !v;
    });
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === -1 ? 1 : -1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }


  const spotValue = (asset: string, b?: Balance) => {
    if (!b) return 0;
    const price = priceOf(asset);
    return price === null ? 0 : (parseFloat(b.available) + parseFloat(b.locked)) * price;
  };

  const spotTotalUsd = spotBalances.reduce((sum, b) => sum + spotValue(b.asset, b), 0);
  const futuresTotalUsd = futuresBalances.reduce((sum, b) => sum + spotValue(b.asset, b), 0);
  const totalUsd = spotTotalUsd + futuresTotalUsd;
  const btcPrice = priceOf('BTC');
  const btcEquivalent = btcPrice ? totalUsd / btcPrice : null;

  // Records today's snapshot at most once per page load (the backend also
  // dedupes per UTC day, this just avoids firing on every 8s balance poll)
  // once real balances have actually loaded — never on the initial 0 before
  // the first fetch resolves, which would record a false "empty" day.
  useEffect(() => {
    if (snapshotRecordedRef.current) return;
    if (spotBalances.length === 0 && futuresBalances.length === 0) return;
    snapshotRecordedRef.current = true;
    api
      .recordPortfolioSnapshot(totalUsd.toFixed(2))
      .then(() => api.getPortfolioHistory(chartRange))
      .then((res) => setChartPoints(res.points))
      .catch(() => {})
      .finally(() => setChartLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotBalances, futuresBalances]);

  useEffect(() => {
    if (!snapshotRecordedRef.current) return;
    setChartLoading(true);
    api
      .getPortfolioHistory(chartRange)
      .then((res) => setChartPoints(res.points))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [chartRange]);

  // Combined per-asset portfolio value (spot + futures) — what the donut
  // chart represents, since "portfolio allocation" means the whole
  // portfolio, not just one of its two wallets.
  const donutSlices: DonutSlice[] = useMemo(() => {
    const combined = new Map<string, number>();
    for (const b of spotBalances) combined.set(b.asset, (combined.get(b.asset) ?? 0) + spotValue(b.asset, b));
    for (const b of futuresBalances) combined.set(b.asset, (combined.get(b.asset) ?? 0) + spotValue(b.asset, b));
    const entries = Array.from(combined.entries())
      .filter(([asset, v]) => v > 0 && !EXCLUDED_ASSETS.has(asset))
      .sort((a, b) => b[1] - a[1]);
    const grandTotal = entries.reduce((sum, [, v]) => sum + v, 0);
    const main = entries.filter(([, v]) => v / grandTotal >= MIN_SLICE_SHARE);
    const restTotal = entries.filter(([, v]) => v / grandTotal < MIN_SLICE_SHARE).reduce((sum, [, v]) => sum + v, 0);
    const slices: DonutSlice[] = main.map(([asset, value]) => {
      const c = assetColor(asset);
      return { label: asset, value, color: c.solid, gradientTo: c.gradientTo };
    });
    if (restTotal > 0) slices.push({ label: t('wallet.other'), value: restTotal, color: 'var(--border)' });
    return slices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotBalances, futuresBalances, priceByAsset, lang]);
  const donutTotal = donutSlices.reduce((sum, s) => sum + s.value, 0);

  // The full top-500 coin browser, left-joined with the account's real spot
  // balances (0 if the account never held that asset) — every supported
  // coin shows up here regardless of balance, per the redesign; "hide zero
  // balances" is just a filter over this same list, not a different query.
  // A balance the account genuinely holds in an asset outside the top-500
  // (rare, but not impossible) is still included — never hide real money
  // just because CoinGecko didn't rank it.
  const balanceByAsset = useMemo(() => {
    const m = new Map<string, Balance>();
    for (const b of spotBalances) m.set(b.asset, b);
    return m;
  }, [spotBalances]);


  const rows = useMemo(() => {
    const rankingBySymbol = new Map(rankings.filter((r) => !EXCLUDED_ASSETS.has(r.symbol)).map((r) => [r.symbol, r]));
    const extraHeld = spotBalances.filter((b) => !rankingBySymbol.has(b.asset) && !EXCLUDED_ASSETS.has(b.asset));
    const symbols = [...rankingBySymbol.keys(), ...extraHeld.map((b) => b.asset)];
    return symbols.map((symbol) => {
      const ranking = rankingBySymbol.get(symbol) ?? null;
      const b = balanceByAsset.get(symbol);
      const available = b ? parseFloat(b.available) : 0;
      const locked = b ? parseFloat(b.locked) : 0;
      return { symbol, ranking, available, locked, total: available + locked };
    });
  }, [rankings, spotBalances, balanceByAsset]);

  const visibleRows = rows
    .filter((r) => {
      const q = search.toLowerCase();
      return r.symbol.toLowerCase().includes(q) || (r.ranking?.name.toLowerCase().includes(q) ?? false);
    })
    .filter((r) => !hideZero || r.total > 0)
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'asset') cmp = a.symbol.localeCompare(b.symbol);
      else if (sortKey === 'price') cmp = (a.ranking?.price ?? -1) - (b.ranking?.price ?? -1);
      else if (sortKey === 'change') cmp = (a.ranking?.changePercent24h ?? -Infinity) - (b.ranking?.changePercent24h ?? -Infinity);
      else if (sortKey === 'volume') cmp = (a.ranking?.volume24h ?? -1) - (b.ranking?.volume24h ?? -1);
      else if (sortKey === 'marketCap') cmp = (a.ranking?.marketCap ?? -1) - (b.ranking?.marketCap ?? -1);
      return cmp * sortDir;
    });

  const historyRows = (deposits ?? []).filter((d) => historyFilter === 'ALL' || d.status === historyFilter);

  function formatUsd(n: number): string {
    return hideBalance ? MASK : n.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 });
  }

  function formatPrice(n: number): string {
    return `$${n.toLocaleString(localeOf(lang), { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
  }

  function formatCompactUsd(n: number): string {
    return `$${n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 })}`;
  }

  // Always enabled, for every coin — not gated on whether it has a real
  // Kraken pair here. If it doesn't, the trade page just shows empty
  // market data for that pair (same honest "—" fallback it already uses
  // for any pair with no live ticker), rather than this table pre-judging
  // tradability with a disabled button.
  function handleTradeClick(symbol: string) {
    navigate(`/trade?pair=${symbol}/USDT`);
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/wallet" />
      <main className="wallet-main" style={styles.main}>
        <div style={styles.headerRow}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={styles.eyebrowRow}>
              <span style={styles.eyebrow}>{t('wallet.title')}</span>
              <button
                onClick={toggleHideBalance}
                style={styles.eyeBtn}
                aria-label={hideBalance ? t('wallet.showBalance') : t('wallet.hideBalance')}
                title={hideBalance ? t('wallet.showBalance') : t('wallet.hideBalance')}
              >
                <EyeIcon open={!hideBalance} />
              </button>
            </div>
            <div style={styles.totalValue}>
              {formatUsd(totalUsd)} <span style={styles.totalCurrency}>USD</span>
            </div>
            {btcEquivalent !== null && (
              <div style={styles.btcLine}>
                {hideBalance ? MASK : t('wallet.approxBtc', { amount: btcEquivalent.toFixed(8) })}
              </div>
            )}

            <div style={styles.breakdownRow}>
              <div style={styles.breakdownChip}>
                <span style={styles.breakdownLabel}>{t('wallet.spotWallet')}</span>
                <span className="mono" style={styles.breakdownValue}>
                  {formatUsd(spotTotalUsd)}
                </span>
              </div>
              <div style={styles.breakdownChip}>
                <span style={styles.breakdownLabel}>{t('wallet.futuresWallet')}</span>
                <span className="mono" style={styles.breakdownValue}>
                  {formatUsd(futuresTotalUsd)}
                </span>
              </div>
              <div style={styles.breakdownChip}>
                <span style={styles.breakdownLabel}>{t('dashboard.openOrders')}</span>
                <span className="mono" style={styles.breakdownValue}>
                  {openOrdersCount ?? '—'}
                </span>
              </div>
              <div style={styles.breakdownChip}>
                <span style={styles.breakdownLabel}>{t('dashboard.openPositions')}</span>
                <span className="mono" style={styles.breakdownValue}>
                  {openPositionsCount ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="surface-raised" style={styles.donutCard}>
            <span style={styles.donutTitle}>{t('wallet.allocation')}</span>
            {hideBalance ? (
              <div style={{ ...styles.donutPlaceholder, width: 200, height: 200 }}>{MASK}</div>
            ) : (
              <div style={styles.donutRow}>
                <div style={styles.donutSvgWrap}>
                  <div style={{ opacity: donutSlices.length === 0 ? 0.75 : 1 }}>
                    <PortfolioDonut slices={donutSlices.length === 0 ? EXAMPLE_DONUT_SLICES : donutSlices} size={200} thickness={28} />
                  </div>
                  {donutSlices.length === 0 && <span style={styles.donutEmptyLabel}>$0</span>}
                </div>
                <div style={{ ...styles.legend, opacity: donutSlices.length === 0 ? 0.75 : 1 }}>
                  {(donutSlices.length === 0 ? EXAMPLE_DONUT_SLICES : donutSlices).map((s) => {
                    const pct = donutTotal > 0 ? (s.value / donutTotal) * 100 : 0;
                    const isOther = s.label === t('wallet.other');
                    return (
                      <div key={s.label} style={styles.legendRow}>
                        {isOther ? (
                          <span style={{ ...styles.legendDot, background: s.color }} />
                        ) : (
                          <CryptoIcon symbol={s.label} size={14} />
                        )}
                        <span className="mono" style={{ fontSize: 11 }}>
                          {s.label}
                        </span>
                        {donutSlices.length > 0 && (
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                            {pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={styles.headerBtnCol}>
            <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
              {t('wallet.deposit')} <DepositIcon />
            </button>
            <button onClick={() => setShowTransfer(true)} style={styles.secondaryBtn}>
              <TransferIcon /> {t('wallet.actionTransfer')}
            </button>
            <button onClick={() => setTab('history')} style={styles.secondaryBtn}>
              <HistoryIcon /> {t('wallet.tab.history')}
            </button>
          </div>
        </div>

        {!hideBalance && (
          <div style={{ marginBottom: 24 }}>
            <PortfolioValueChart points={chartPoints} range={chartRange} onRangeChange={setChartRange} loading={chartLoading} />
          </div>
        )}

        {!hideBalance && activity !== null && activity.length > 0 && (
          <div className="accent-edge surface-raised" style={styles.activityCard}>
            <div style={styles.activityHeaderRow}>
              <h2 style={styles.cardHeading}>{t('dashboard.recentActivity')}</h2>
              <button className="row-hover" onClick={() => setTab('history')} style={styles.textBtn}>
                {t('wallet.viewAllActivity')}
              </button>
            </div>
            {activity.map((a) => (
              <div key={a.id} style={styles.activityRow}>
                <CryptoIcon symbol={a.asset} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                    {t(`dashboard.activity.${a.type.toLowerCase()}` as Key)}
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{a.asset}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {a.amountLabel}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {new Date(a.timestamp).toLocaleString(localeOf(lang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
                  <ActivityTypeIcon type={a.type} />
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={styles.tabs}>
          <button
            onClick={() => setTab('assets')}
            style={{ ...styles.tabBtn, ...(tab === 'assets' ? styles.tabBtnActive : {}) }}
          >
            {t('wallet.tab.assets')}
          </button>
          <button
            onClick={() => setTab('history')}
            style={{ ...styles.tabBtn, ...(tab === 'history' ? styles.tabBtnActive : {}) }}
          >
            {t('wallet.tab.history')}
          </button>
        </div>

        {tab === 'assets' && (
          <>
            <div style={styles.toolbarRow}>
              <SearchInput value={search} onChange={setSearch} placeholder={t('wallet.searchAsset')} style={styles.search} />
              <label style={styles.checkboxLabel}>
                <input type="checkbox" checked={hideZero} onChange={toggleHideZero} />
                {t('wallet.hideZeroBalances')}
              </label>
            </div>

            <div className="accent-edge surface-raised" style={{ ...styles.table, overflowX: 'auto' }}>
              <div style={styles.columns}>
                <SortableHeader label={t('wallet.asset')} sortKey="asset" active={sortKey} dir={sortDir} onSort={handleSort} />
                <span style={{ textAlign: 'right' }}>{t('wallet.available')}</span>
                <span style={{ textAlign: 'right' }}>{t('wallet.locked')}</span>
                <SortableHeader label={t('wallet.price')} sortKey="price" active={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader label={t('wallet.change24h')} sortKey="change" active={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader label={t('wallet.volume24hMarket')} sortKey="volume" active={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader label={t('wallet.marketCap')} sortKey="marketCap" active={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <span style={{ textAlign: 'center' }}>{t('wallet.sparkline')}</span>
                <span style={{ textAlign: 'right' }}>{t('wallet.actions')}</span>
              </div>
              <div style={styles.rows}>
                {visibleRows.map((r) => {
                  const change = r.ranking?.changePercent24h;
                  return (
                    <div key={r.symbol} style={styles.row}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, minWidth: 0 }} className="mono">
                        <CryptoIcon symbol={r.symbol} size={22} />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span>{r.symbol}</span>
                          {r.ranking && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.ranking.name}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="mono" style={{ textAlign: 'right' }}>
                        {hideBalance ? MASK : r.available.toFixed(6)}
                      </span>
                      <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {hideBalance ? MASK : r.locked.toFixed(6)}
                      </span>
                      <span className="mono" style={{ textAlign: 'right' }}>
                        {r.ranking ? formatPrice(r.ranking.price) : '—'}
                      </span>
                      <span
                        className={`mono ${change !== null && change !== undefined && change < 0 ? 'text-sell' : 'text-buy'}`}
                        style={{ textAlign: 'right' }}
                      >
                        {change !== null && change !== undefined ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
                      </span>
                      <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {r.ranking ? formatCompactUsd(r.ranking.volume24h) : '—'}
                      </span>
                      <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {r.ranking?.marketCap ? formatCompactUsd(r.ranking.marketCap) : '—'}
                      </span>
                      <span style={{ display: 'flex', justifyContent: 'center' }}>
                        {r.ranking && r.ranking.sparkline.length > 1 ? <Sparkline points={r.ranking.sparkline} /> : '—'}
                      </span>
                      <span style={styles.actionsCell}>
                        {r.total > 0 ? (
                          <>
                            <button onClick={() => setShowDeposit(true)} style={styles.actionBtn} title={t('wallet.deposit')}>
                              <DepositIcon />
                            </button>
                            <button onClick={() => setShowTransfer(true)} style={styles.actionBtn} title={t('wallet.actionTransfer')}>
                              <TransferIcon />
                            </button>
                            <button
                              onClick={() => setWithdrawAsset(r.symbol)}
                              style={styles.actionBtn}
                              title={t('wallet.actionWithdraw')}
                            >
                              <WithdrawIcon />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleTradeClick(r.symbol)} style={styles.tradeBtn}>
                            {t('wallet.tradeAction')}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
                {!rankingsLoaded &&
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={[2, 1, 1, 1, 1, 1, 1, 1, 1]} />)}
                {rankingsLoaded && rankingsError && rows.length === 0 && <p style={styles.hint}>{t('wallet.rankingsLoadError')}</p>}
                {rankingsLoaded && rows.length > 0 && visibleRows.length === 0 && <p style={styles.hint}>{t('wallet.noSearchResults')}</p>}
              </div>
            </div>
          </>
        )}

        {tab === 'history' && (
          <>
            <div style={styles.filterRow}>
              {(['ALL', 'CREDITED', 'PENDING', 'BELOW_MINIMUM'] as HistoryFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className="row-hover"
                  style={{ ...styles.filterChip, ...(historyFilter === f ? styles.filterChipActive : {}) }}
                >
                  {f === 'ALL' ? t('wallet.history.filterAll') : t(HISTORY_STATUS_KEY[f])}
                </button>
              ))}
            </div>

            <div className="accent-edge surface-raised" style={styles.table}>
              <div style={{ ...styles.columns, gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 1.2fr 1.4fr' }}>
                <span>{t('wallet.history.date')}</span>
                <span>{t('wallet.history.asset')}</span>
                <span>{t('wallet.history.chain')}</span>
                <span style={{ textAlign: 'right' }}>{t('wallet.history.amount')}</span>
                <span>{t('wallet.history.status')}</span>
                <span>{t('wallet.history.tx')}</span>
              </div>
              <div style={styles.rows}>
                {historyRows.map((d) => {
                  const explorer = EXPLORER_TX_URL[d.chain];
                  return (
                    <div key={d.id} style={{ ...styles.row, gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 1.2fr 1.4fr' }}>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {new Date(d.createdAt).toLocaleString(localeOf(lang))}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="mono">
                        <CryptoIcon symbol={d.asset} size={16} />
                        {d.asset}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.chain}</span>
                      <span className="mono" style={{ textAlign: 'right' }}>
                        {hideBalance ? MASK : parseFloat(d.amount).toFixed(6)}
                      </span>
                      <span>
                        <HistoryStatusBadge
                          status={d.status}
                          label={HISTORY_STATUS_KEY[d.status] ? t(HISTORY_STATUS_KEY[d.status]) : d.status}
                        />
                      </span>
                      <span>
                        {explorer ? (
                          <a href={explorer(d.txHash)} target="_blank" rel="noreferrer" style={styles.explorerLink}>
                            {t('wallet.history.viewExplorer')}
                          </a>
                        ) : (
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            {d.txHash.slice(0, 10)}…
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {deposits === null && !historyError && Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} columns={[1.2, 0.8, 0.8, 1, 1.2, 1.4]} />)}
                {historyError && <p style={styles.hint}>{t('wallet.historyLoadError')}</p>}
                {deposits !== null && !historyError && historyRows.length === 0 && (
                  <p style={styles.hint}>{t('wallet.historyEmpty')}</p>
                )}
              </div>
            </div>
          </>
        )}

        {demoBalances.length > 0 && (
          <div style={styles.demoCard}>
            <div style={styles.demoCardHeader}>
              <Badge text="DEMO" color="var(--accent)" bg="var(--accent-dim)" />
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Demo-баланс</h3>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Тестовые средства — отдельно от реального баланса</span>
            </div>
            {demoBalances.map((b) => (
              <div key={b.asset} style={styles.demoRow}>
                <span className="mono">{b.asset}</span>
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                  {b.available} доступно{Number(b.locked) > 0 ? `, ${b.locked} заблокировано` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <Footer />
      </main>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
      {withdrawAsset && <WithdrawModal asset={withdrawAsset} onClose={() => setWithdrawAsset(null)} />}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: 1 | -1;
  onSort: (k: SortKey) => void;
  align?: 'right';
}) {
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{ ...styles.sortHeader, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
    >
      {label}
      {active === sortKey && <span style={{ fontSize: 9 }}>{dir === -1 ? '▼' : '▲'}</span>}
    </button>
  );
}

function HistoryStatusBadge({ status, label }: { status: string; label: string }) {
  const styleFor: Record<string, { color: string; bg: string }> = {
    CREDITED: { color: 'var(--buy)', bg: 'var(--buy-dim)' },
    PENDING: { color: 'var(--accent)', bg: 'var(--accent-dim)' },
    BELOW_MINIMUM: { color: 'var(--sell)', bg: 'var(--sell-dim)' },
  };
  const s = styleFor[status] ?? { color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' };
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 999,
        color: s.color,
        background: s.bg,
      }}
    >
      {label}
    </span>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.4 19.4 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

function DepositIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12M6 10l6 6 6-6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function TransferIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function WithdrawIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V8M6 14l6-6 6 6" />
      <path d="M4 4h16" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function BuySellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3" />
    </svg>
  );
}

// Per-type glyph next to each activity row's timestamp — same idea as the
// v0 mockup's transaction-type-icon, mapped onto the real ActivityType
// values this feed actually produces (deposit/withdraw/buy/sell).
function ActivityTypeIcon({ type }: { type: ActivityType }) {
  if (type === 'DEPOSIT') return <DepositIcon />;
  if (type === 'WITHDRAW') return <WithdrawIcon />;
  return <BuySellIcon />;
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to just this page's content (everything inside <main>, below the
// shared Nav bar) the same way FuturesPage/MarketsPage/TradePage/
// DashboardPage re-theme themselves — every existing var(--panel)/
// var(--border)/var(--text-*) rule below picks this up automatically.
// `color` is set explicitly here (not just the custom props) so plain
// inherited text also picks up the right value instead of the app-wide
// default.
const WALLET_V0_VARS = {
  ['--panel' as any]: '#121925',
  ['--panel-alt' as any]: '#0e131d',
  ['--panel-alt-hover' as any]: '#172131',
  ['--border' as any]: '#1c2735',
  ['--text-primary' as any]: '#f5f7fa',
  ['--text-secondary' as any]: '#8b96a8',
  ['--text-tertiary' as any]: '#6b7789',
  ['--neutral-dim' as any]: 'rgba(139,150,168,0.1)',
  ['--buy' as any]: '#19d98b',
  ['--buy-dim' as any]: 'rgba(25,217,139,0.14)',
  ['--sell' as any]: '#ff4d67',
  ['--sell-dim' as any]: 'rgba(255,77,103,0.14)',
  ['--accent' as any]: '#18c8ff',
  ['--accent-hover' as any]: '#3fd4ff',
  ['--accent-dim' as any]: 'rgba(24,200,255,0.14)',
  ['--on-accent' as any]: '#04121b',
  color: 'var(--text-primary)',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#080b12', display: 'flex', flexDirection: 'column' },
  main: { padding: '32px', maxWidth: 1080, margin: '0 auto', width: '100%', ...WALLET_V0_VARS },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    gap: 20,
    flexWrap: 'wrap',
  },
  activityCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 24 },
  activityHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
  },
  cardHeading: { fontSize: 14, margin: 0, fontWeight: 700 },
  textBtn: { background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6 },
  activityRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' },
  demoCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  demoCardHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  demoRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, borderTop: '1px solid var(--border)' },
  eyebrowRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  eyebrow: { fontSize: 13, color: 'var(--text-secondary)' },
  eyeBtn: { background: 'transparent', border: 'none', color: 'var(--text-tertiary)', display: 'flex', padding: 2 },
  totalValue: {
    fontSize: 38,
    fontWeight: 800,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '-0.01em',
    background: 'linear-gradient(120deg, var(--text-primary) 55%, var(--accent) 130%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  totalCurrency: { fontSize: 16, color: 'var(--text-secondary)', fontWeight: 600 },
  btcLine: { fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'var(--font-mono)' },
  breakdownRow: { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  breakdownChip: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '8px 14px',
  },
  breakdownLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  breakdownValue: { fontSize: 14, fontWeight: 700 },
  donutCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    flexShrink: 0,
  },
  donutTitle: { fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' },
  donutRow: { display: 'flex', alignItems: 'center', gap: 16 },
  donutSvgWrap: { position: 'relative', display: 'inline-flex' },
  donutEmptyLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 15,
    fontWeight: 800,
    color: 'var(--text-secondary)',
    pointerEvents: 'none',
  },
  donutPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-tertiary)',
    fontSize: 13,
  },
  legend: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 108 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  headerBtnCol: { display: 'flex', flexDirection: 'column', gap: 9, flexShrink: 0, alignSelf: 'flex-start', minWidth: 150 },
  depositBtn: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: '1px solid var(--accent)',
    borderRadius: 10,
    padding: '0 20px',
    fontWeight: 800,
    fontSize: 13,
  },
  secondaryBtn: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '0 20px',
    fontWeight: 700,
    fontSize: 13,
  },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '10px 4px',
    marginRight: 20,
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  tabBtnActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  toolbarRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' },
  search: { width: 260 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-secondary)' },
  filterRow: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  filterChip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  filterChipActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)' },
  table: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.8fr 1fr 1fr 0.9fr 1.1fr',
    minWidth: 1000,
    padding: '12px 18px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  sortHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 11,
    color: 'inherit',
    width: '100%',
  },
  rows: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.8fr 1fr 1fr 0.9fr 1.1fr',
    minWidth: 1000,
    padding: '12px 18px',
    fontSize: 13,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    gap: 8,
  },
  actionsCell: { display: 'flex', justifyContent: 'flex-end', gap: 4 },
  actionBtn: {
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-secondary)',
  },
  tradeBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 11,
    fontWeight: 800,
  },
  explorerLink: { fontSize: 12, color: 'var(--accent)', fontWeight: 600 },
  hint: { padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' },
};
