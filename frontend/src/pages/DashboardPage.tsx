import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { CryptoIcon, assetColor } from '../components/CryptoIcon';
import { PortfolioDonut, DonutSlice } from '../components/PortfolioDonut';
import { PortfolioValueChart, ChartRange } from '../components/PortfolioValueChart';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

type ActivityType = 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL';
interface ActivityItem {
  id: string;
  type: ActivityType;
  asset: string;
  amountLabel: string;
  time: string;
  timestamp: number;
}

// Everything here reads from the same real endpoints WalletPage/FuturesPage
// already use — no invented numbers, no separate demo balances. See
// WalletPage's spotValue()/donutSlices for the identical computation this
// mirrors, so the totals shown here always agree with the Wallet page.
const MIN_SLICE_SHARE = 0.02;

export function DashboardPage() {
  const { t, lang } = useLanguage();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [spotBalances, setSpotBalances] = useState<Balance[]>([]);
  const [futuresBalances, setFuturesBalances] = useState<Balance[]>([]);
  const [priceByAsset, setPriceByAsset] = useState<Record<string, number>>({});
  const [chartPoints, setChartPoints] = useState<{ date: string; totalValueUsd: string }[]>([]);
  const [chartRange, setChartRange] = useState<ChartRange>('30d');
  const [chartLoading, setChartLoading] = useState(true);
  const [openOrdersCount, setOpenOrdersCount] = useState<number | null>(null);
  const [openPositionsCount, setOpenPositionsCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api.getMe().then((me) => setDisplayName(me.displayName)).catch(() => {});
  }, []);

  useEffect(() => {
    function load() {
      api.getBalances().then(setSpotBalances).catch(() => {});
      api.getFuturesBalances().then(setFuturesBalances).catch(() => {});
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

  useEffect(() => {
    setChartLoading(true);
    api
      .getPortfolioHistory(chartRange)
      .then((res) => setChartPoints(res.points))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [chartRange]);

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
      .then(([deposits, withdrawals, trades]) => {
        const items: ActivityItem[] = [
          ...deposits.map((d): ActivityItem => ({
            id: `dep-${d.id}`,
            type: 'DEPOSIT',
            asset: d.asset,
            amountLabel: `+${d.amount} ${d.asset}`,
            time: d.createdAt,
            timestamp: new Date(d.createdAt).getTime(),
          })),
          ...withdrawals.map((w): ActivityItem => ({
            id: `wd-${w.id}`,
            type: 'WITHDRAW',
            asset: w.asset,
            amountLabel: `-${w.amount} ${w.asset}`,
            time: w.createdAt,
            timestamp: new Date(w.createdAt).getTime(),
          })),
          ...trades.map((tr): ActivityItem => {
            const [base] = tr.pair.split('/');
            return {
              id: `tr-${tr.id}`,
              type: tr.side === 'BUY' ? 'BUY' : 'SELL',
              asset: base,
              amountLabel: `${tr.quantity} ${base}`,
              time: tr.executedAt,
              timestamp: new Date(tr.executedAt).getTime(),
            };
          }),
        ];
        items.sort((a, b) => b.timestamp - a.timestamp);
        setActivity(items.slice(0, 8));
      })
      .catch(() => setActivity([]));
  }, []);

  function priceOf(asset: string): number | null {
    if (asset === 'USDT' || asset === 'USDC' || asset === 'USD') return 1;
    return priceByAsset[asset] ?? null;
  }

  const spotValue = (b: Balance) => {
    const price = priceOf(b.asset);
    return price === null ? 0 : (parseFloat(b.available) + parseFloat(b.locked)) * price;
  };
  const availableValue = (b: Balance) => {
    const price = priceOf(b.asset);
    return price === null ? 0 : parseFloat(b.available) * price;
  };
  const lockedValue = (b: Balance) => {
    const price = priceOf(b.asset);
    return price === null ? 0 : parseFloat(b.locked) * price;
  };

  const totalUsd = useMemo(
    () => spotBalances.reduce((s, b) => s + spotValue(b), 0) + futuresBalances.reduce((s, b) => s + spotValue(b), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spotBalances, futuresBalances, priceByAsset]
  );
  const availableUsd = useMemo(
    () => spotBalances.reduce((s, b) => s + availableValue(b), 0) + futuresBalances.reduce((s, b) => s + availableValue(b), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spotBalances, futuresBalances, priceByAsset]
  );
  const lockedUsd = useMemo(
    () => spotBalances.reduce((s, b) => s + lockedValue(b), 0) + futuresBalances.reduce((s, b) => s + lockedValue(b), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spotBalances, futuresBalances, priceByAsset]
  );

  const donutSlices: DonutSlice[] = useMemo(() => {
    const combined = new Map<string, number>();
    for (const b of spotBalances) combined.set(b.asset, (combined.get(b.asset) ?? 0) + spotValue(b));
    for (const b of futuresBalances) combined.set(b.asset, (combined.get(b.asset) ?? 0) + spotValue(b));
    const entries = Array.from(combined.entries())
      .filter(([, v]) => v > 0)
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

  const mask = (s: string) => (hidden ? '••••••' : s);
  const fmtUsd = (n: number) =>
    n.toLocaleString(localeOf(lang), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const ACTIVITY_LABEL: Record<ActivityType, string> = {
    DEPOSIT: t('dashboard.activity.deposit'),
    WITHDRAW: t('dashboard.activity.withdraw'),
    BUY: t('dashboard.activity.buy'),
    SELL: t('dashboard.activity.sell'),
  };

  const QUICK_LINKS = [
    { to: '/trade', label: t('dashboard.quickLinkSpotTrade'), desc: t('dashboard.quickLinkSpotTradeDesc') },
    { to: '/futures', label: t('dashboard.quickLinkFutures'), desc: t('dashboard.quickLinkFuturesDesc') },
    { to: '/wallet', label: t('dashboard.quickLinkWallet'), desc: t('dashboard.quickLinkWalletDesc') },
    { to: '/copy-trading', label: t('dashboard.quickLinkCopyTrading'), desc: t('dashboard.quickLinkCopyTradingDesc') },
  ];

  const STATS = [
    { label: t('dashboard.availableBalance'), value: fmtUsd(availableUsd) },
    { label: t('dashboard.inOrders'), value: fmtUsd(lockedUsd) },
    { label: t('dashboard.openOrders'), value: openOrdersCount ?? '—' },
    { label: t('dashboard.openPositions'), value: openPositionsCount ?? '—' },
  ];

  return (
    <div className="page-mesh" style={{ ...styles.page, ...DASHBOARD_V0_VARS }}>
      <Nav active="/dashboard" />
      <main style={styles.main}>
        <h1 style={styles.title}>{t('dashboard.welcome', { name: displayName ? `, ${displayName}` : '' })}</h1>
        <p style={styles.subtitle}>{t('dashboard.subtitle')}</p>

        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryHeaderRow}>
              <div>
                <div style={styles.summaryLabelRow}>
                  <span style={styles.summaryLabel}>{t('dashboard.totalValue')}</span>
                  <button onClick={() => setHidden((v) => !v)} style={styles.eyeBtn} aria-label="toggle">
                    {hidden ? '🙈' : '👁'}
                  </button>
                </div>
                <div style={styles.totalValue}>{mask(fmtUsd(totalUsd))}</div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <PortfolioValueChart points={chartPoints} range={chartRange} onRangeChange={setChartRange} loading={chartLoading} />
            </div>
          </div>

          <div style={styles.allocationCard}>
            <h2 style={styles.cardHeading}>{t('dashboard.allocation')}</h2>
            <div style={styles.allocationBody}>
              <PortfolioDonut slices={donutSlices} size={132} thickness={20} />
              <ul style={styles.allocationList}>
                {donutSlices.slice(0, 6).map((s) => (
                  <li key={s.label} style={styles.allocationItem}>
                    <span style={{ ...styles.allocationDot, background: s.color }} />
                    <span style={{ flex: 1 }}>{s.label}</span>
                    <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                      {donutSlices.length > 0 ? ((s.value / donutSlices.reduce((sum, x) => sum + x.value, 0)) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </li>
                ))}
                {donutSlices.length === 0 && <li style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</li>}
              </ul>
            </div>
          </div>
        </div>

        <div style={styles.quickLinksRow}>
          {QUICK_LINKS.map((l) => (
            <Link key={l.to} to={l.to} style={styles.quickLinkCard} className="row-hover">
              <div style={styles.quickLinkTitle}>{l.label}</div>
              <div style={styles.quickLinkDesc}>{l.desc}</div>
            </Link>
          ))}
        </div>

        <div style={styles.bottomRow}>
          <div style={styles.activityCard}>
            <div style={styles.activityHeaderRow}>
              <h2 style={styles.cardHeading}>{t('dashboard.recentActivity')}</h2>
            </div>
            <div>
              {activity === null && <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 12 }}>…</div>}
              {activity !== null && activity.length === 0 && (
                <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('dashboard.activityEmpty')}</div>
              )}
              {activity?.map((a) => (
                <div key={a.id} style={styles.activityRow}>
                  <CryptoIcon symbol={a.asset} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                      {ACTIVITY_LABEL[a.type]}
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{a.asset}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {a.amountLabel}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {new Date(a.timestamp).toLocaleString(localeOf(lang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.statsCard}>
            <h2 style={styles.cardHeading}>{t('dashboard.accountStats')}</h2>
            <dl style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {STATS.map((s) => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</dt>
                  <dd className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </main>
    </div>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to just this page the same way FuturesPage/MarketsPage/TradePage
// re-theme themselves.
const DASHBOARD_V0_VARS = {
  ['--bg' as any]: '#080b12',
  ['--panel' as any]: '#121925',
  ['--panel-alt' as any]: '#0e131d',
  ['--panel-alt-hover' as any]: '#172131',
  ['--border' as any]: '#1c2735',
  ['--text-primary' as any]: '#f5f7fa',
  ['--text-secondary' as any]: '#8b96a8',
  ['--text-tertiary' as any]: '#6b7789',
  ['--buy' as any]: '#19d98b',
  ['--buy-dim' as any]: 'rgba(25,217,139,0.14)',
  ['--sell' as any]: '#ff4d67',
  ['--sell-dim' as any]: 'rgba(255,77,103,0.14)',
  ['--accent' as any]: '#18c8ff',
  ['--accent-hover' as any]: '#3fd4ff',
  ['--accent-dim' as any]: 'rgba(24,200,255,0.14)',
  ['--on-accent' as any]: '#04121b',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 1200, margin: '0 auto' },
  title: { fontSize: 26, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  subtitle: { color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 24px' },
  summaryRow: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'stretch' },
  summaryCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
  summaryHeaderRow: { display: 'flex', justifyContent: 'space-between' },
  summaryLabelRow: { display: 'flex', alignItems: 'center', gap: 8 },
  summaryLabel: { fontSize: 13, color: 'var(--text-secondary)' },
  eyeBtn: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, opacity: 0.7 },
  totalValue: { fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 6 },
  allocationCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
  cardHeading: { fontSize: 14, margin: 0, fontWeight: 700 },
  allocationBody: { display: 'flex', alignItems: 'center', gap: 18, marginTop: 16 },
  allocationList: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  allocationItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  allocationDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  quickLinksRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 },
  quickLinkCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
  },
  quickLinkTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' },
  quickLinkDesc: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 },
  bottomRow: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 },
  activityCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  activityHeaderRow: { padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  activityRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' },
  statsCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
};
