import { useMemo, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { CryptoIcon } from '../components/CryptoIcon';

// Copy trading has no real backend yet — this page is deliberately
// self-contained demo/mock data (see the visible banner below), never
// wired to real balances, orders, or other users. The "Copy" button only
// toggles local UI state; it does not place any real order.
interface Trader {
  id: string;
  handle: string;
  roi30d: number;
  winRate: number;
  copiers: number;
  followers: number;
  risk: 'low' | 'medium' | 'high';
  markets: string[];
}

const TRADERS: Trader[] = [
  { id: 't1', handle: '@apex_alpha', roi30d: 42.6, winRate: 78, copiers: 1284, followers: 5230, risk: 'medium', markets: ['BTC', 'ETH'] },
  { id: 't2', handle: '@northstar_fx', roi30d: 18.3, winRate: 84, copiers: 640, followers: 2110, risk: 'low', markets: ['BTC', 'SOL'] },
  { id: 't3', handle: '@quantum_leverage', roi30d: 96.4, winRate: 61, copiers: 2310, followers: 9840, risk: 'high', markets: ['ETH', 'SOL', 'XRP'] },
  { id: 't4', handle: '@steady_gains', roi30d: 11.2, winRate: 89, copiers: 410, followers: 980, risk: 'low', markets: ['BTC', 'USDT'] },
  { id: 't5', handle: '@volt_prime', roi30d: 54.8, winRate: 70, copiers: 1560, followers: 4370, risk: 'medium', markets: ['ETH', 'BTC'] },
  { id: 't6', handle: '@degen_labs', roi30d: 128.7, winRate: 52, copiers: 3020, followers: 12400, risk: 'high', markets: ['SOL', 'DOGE'] },
];

const RISK_FILTERS = ['ALL', 'low', 'medium', 'high'] as const;

function initials(handle: string): string {
  return handle.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
}

function fmtFollowers(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);
}

export function CopyTradingPage() {
  const { t } = useLanguage();
  const [riskFilter, setRiskFilter] = useState<(typeof RISK_FILTERS)[number]>('ALL');
  const [sortKey, setSortKey] = useState<'roi' | 'winRate' | 'copiers'>('roi');
  const [copying, setCopying] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    return TRADERS.filter((tr) => riskFilter === 'ALL' || tr.risk === riskFilter).sort((a, b) => {
      if (sortKey === 'roi') return b.roi30d - a.roi30d;
      if (sortKey === 'winRate') return b.winRate - a.winRate;
      return b.copiers - a.copiers;
    });
  }, [riskFilter, sortKey]);

  const RISK_LABEL: Record<Trader['risk'], string> = {
    low: t('copyTrading.risk.low'),
    medium: t('copyTrading.risk.medium'),
    high: t('copyTrading.risk.high'),
  };
  const RISK_COLOR: Record<Trader['risk'], string> = {
    low: 'var(--buy)',
    medium: 'var(--accent)',
    high: 'var(--sell)',
  };
  const RISK_DIM: Record<Trader['risk'], string> = {
    low: 'var(--buy-dim)',
    medium: 'var(--accent-dim)',
    high: 'var(--sell-dim)',
  };

  const STEPS = [
    { title: t('copyTrading.step1Title'), text: t('copyTrading.step1Text') },
    { title: t('copyTrading.step2Title'), text: t('copyTrading.step2Text') },
    { title: t('copyTrading.step3Title'), text: t('copyTrading.step3Text') },
  ];

  return (
    <div className="page-mesh" style={{ ...styles.page, ...COPY_TRADING_V0_VARS }}>
      <Nav active="/copy-trading" />
      <main style={styles.main}>
        <h1 style={styles.title}>{t('copyTrading.title')}</h1>
        <p style={styles.subtitle}>{t('copyTrading.subtitle')}</p>

        <div style={styles.demoNotice}>{t('copyTrading.demoNotice')}</div>

        <div style={styles.howItWorksCard}>
          <h2 style={styles.cardHeading}>{t('copyTrading.howItWorksTitle')}</h2>
          <div style={styles.stepsGrid}>
            {STEPS.map((s, i) => (
              <div key={s.title} style={styles.stepItem}>
                <div style={styles.stepBadge}>{i + 1}</div>
                <div>
                  <div style={styles.stepTitle}>{s.title}</div>
                  <p style={styles.stepText}>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.filterRow}>
          <div style={styles.filterGroup}>
            {RISK_FILTERS.map((r) => (
              <button
                key={r}
                onClick={() => setRiskFilter(r)}
                style={{ ...styles.filterBtn, ...(riskFilter === r ? styles.filterBtnActive : {}) }}
              >
                {r === 'ALL' ? t('copyTrading.risk') : RISK_LABEL[r]}
              </button>
            ))}
          </div>
          <div style={styles.filterGroup}>
            <button
              onClick={() => setSortKey('roi')}
              style={{ ...styles.filterBtn, ...(sortKey === 'roi' ? styles.filterBtnActive : {}) }}
            >
              {t('copyTrading.roi')}
            </button>
            <button
              onClick={() => setSortKey('winRate')}
              style={{ ...styles.filterBtn, ...(sortKey === 'winRate' ? styles.filterBtnActive : {}) }}
            >
              {t('copyTrading.winRate')}
            </button>
            <button
              onClick={() => setSortKey('copiers')}
              style={{ ...styles.filterBtn, ...(sortKey === 'copiers' ? styles.filterBtnActive : {}) }}
            >
              {t('copyTrading.followers')}
            </button>
          </div>
        </div>

        <div style={styles.grid}>
          {filtered.map((tr) => (
            <div key={tr.id} style={styles.traderCard}>
              <div style={styles.traderHeaderRow}>
                <span style={styles.avatar}>{initials(tr.handle)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.traderHandle}>{tr.handle}</div>
                </div>
                <span style={{ ...styles.riskBadge, color: RISK_COLOR[tr.risk], background: RISK_DIM[tr.risk] }}>
                  {RISK_LABEL[tr.risk]}
                </span>
              </div>

              <div style={styles.roiRow}>
                <div>
                  <div style={styles.statLabel}>{t('copyTrading.roi')}</div>
                  <div className="mono text-buy" style={styles.roiValue}>
                    +{tr.roi30d.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div style={styles.statsRow}>
                <div style={styles.statCell}>
                  <div className="mono" style={styles.statValue}>
                    {tr.winRate}%
                  </div>
                  <div style={styles.statLabelSmall}>{t('copyTrading.winRate')}</div>
                </div>
                <div style={styles.statCell}>
                  <div className="mono" style={styles.statValue}>
                    {fmtFollowers(tr.copiers)}
                  </div>
                  <div style={styles.statLabelSmall}>{t('copyTrading.copiers')}</div>
                </div>
                <div style={styles.statCell}>
                  <div className="mono" style={styles.statValue}>
                    {fmtFollowers(tr.followers)}
                  </div>
                  <div style={styles.statLabelSmall}>{t('copyTrading.followers')}</div>
                </div>
              </div>

              <div style={styles.marketsRow}>
                {tr.markets.map((m) => (
                  <span key={m} style={styles.marketChip}>
                    <CryptoIcon symbol={m} size={14} />
                    {m}
                  </span>
                ))}
              </div>

              <button
                onClick={() => setCopying((c) => ({ ...c, [tr.id]: !c[tr.id] }))}
                style={{ ...styles.copyBtn, ...(copying[tr.id] ? styles.copyBtnActive : {}) }}
              >
                {copying[tr.id] ? '✓' : ''} {t('copyTrading.copyBtn')}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const COPY_TRADING_V0_VARS = {
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
  subtitle: { color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 16px' },
  demoNotice: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 600,
    padding: '10px 14px',
    borderRadius: 10,
    marginBottom: 20,
  },
  howItWorksCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24 },
  cardHeading: { fontSize: 14, margin: 0, fontWeight: 700 },
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginTop: 16 },
  stepItem: { display: 'flex', gap: 10 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  stepTitle: { fontSize: 13, fontWeight: 700 },
  stepText: { fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 },
  filterRow: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  filterGroup: { display: 'flex', gap: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 },
  filterBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  filterBtnActive: { background: 'var(--panel-alt)', color: 'var(--text-primary)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  traderCard: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column' },
  traderHeaderRow: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--accent), #7c5cff)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    flexShrink: 0,
  },
  traderHandle: { fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  riskBadge: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0 },
  roiRow: { marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
  statLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  roiValue: { fontSize: 24, fontWeight: 800, marginTop: 2 },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTop: '1px solid var(--border)',
    textAlign: 'center',
  },
  statCell: {},
  statValue: { fontSize: 13, fontWeight: 700 },
  statLabelSmall: { fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: 2 },
  marketsRow: { display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' },
  marketChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'var(--panel-alt)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  copyBtn: {
    marginTop: 14,
    border: 'none',
    borderRadius: 10,
    padding: '10px 0',
    fontWeight: 700,
    fontSize: 13,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  copyBtnActive: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    border: '1px solid var(--buy)',
  },
};
