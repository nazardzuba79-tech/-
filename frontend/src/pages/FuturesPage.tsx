import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesPairList } from '../components/FuturesPairList';
import { PriceChart } from '../components/PriceChart';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { TopGainersTicker } from '../components/TopGainersTicker';

const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function FuturesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(() => {
    const requested = searchParams.get('pair');
    return requested && FUTURES_SYMBOLS.includes(requested) ? requested : 'BTC/USDT';
  });
  const [newAccountNotice, setNewAccountNotice] = useState<{ max: number; days: number } | null>(null);
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);

  // Surface the new-account leverage cap as an informational notice — the
  // real enforcement is server-side (see the leverage checks in
  // FuturesPositionService), this is just so the trader isn't surprised by
  // a rejected order at 50x on day one.
  useEffect(() => {
    Promise.all([api.getFuturesConfig(), api.getMe()])
      .then(([config, me]) => {
        const accountAgeDays = (Date.now() - new Date(me.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (accountAgeDays < config.newAccountPeriodDays) {
          setNewAccountNotice({ max: config.newAccountMaxLeverage, days: config.newAccountPeriodDays });
        }
      })
      .catch(() => {});
  }, []);

  const handleOrderPlaced = useCallback(() => setPositionsRefreshKey((k) => k + 1), []);

  // A futures position can only ever be opened on FUTURES_SYMBOLS (see
  // config/futuresConfig.ts on the backend — the order-placement route
  // rejects anything else outright). Clicking a pair the marquee shows but
  // futures doesn't support sends the trader to spot instead of pretending
  // a futures market exists for it.
  function handleTickerSelect(pair: string) {
    if (FUTURES_SYMBOLS.includes(pair)) setSymbol(pair);
    else navigate(`/trade?pair=${pair}`);
  }

  return (
    <div className="page-mesh trading-page" style={styles.page}>
      <Nav
        active="/futures"
        rightExtra={
          <button onClick={() => setShowTransfer(true)} style={styles.transferBtn}>
            {t('futures.transfer')}
          </button>
        }
      />
      <TopGainersTicker onSelect={handleTickerSelect} />

      <div className="trading-content" style={styles.content}>
        <div style={styles.tickerCard}>
          <FuturesTickerBar symbol={symbol} />
        </div>

        {newAccountNotice && (
          <div style={styles.notice}>
            {t('futures.newAccountLimitNotice', { max: newAccountNotice.max, days: newAccountNotice.days })}
          </div>
        )}

        <main className="trading-grid" style={styles.grid}>
          <div className="trading-col trading-col-pairlist" style={styles.pairListColumn}>
            <FuturesPairList symbols={FUTURES_SYMBOLS} symbol={symbol} onChange={setSymbol} />
          </div>
          <div className="trading-col trading-col-chart" style={styles.chartColumn}>
            <PriceChart pair={symbol} />
          </div>
          <div className="trading-col trading-col-form" style={styles.formColumn}>
            <FuturesOrderForm symbol={symbol} onPlaced={handleOrderPlaced} onOpenTransfer={() => setShowTransfer(true)} />
          </div>
        </main>

        <div className="trading-orders-row" style={styles.positionsRow}>
          <FuturesPositionsPanel refreshKey={positionsRefreshKey} />
        </div>
      </div>

      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
    </div>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to just this page the same way WalletPage/AdminLayout re-theme
// themselves — every existing var(--panel)/var(--border)/var(--text-*)
// rule below (and in the futures sub-components, and in the shared Nav
// rendered above) picks this up automatically, nothing else on the site
// changes. Cyan/purple brand accent replaces the site's default amber.
const FUTURES_V0_VARS = {
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
  page: {
    height: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...FUTURES_V0_VARS,
  },
  transferBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 10,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '12px 16px 16px',
    minHeight: 0,
    overflow: 'hidden',
  },
  tickerCard: {
    flexShrink: 0,
    borderRadius: 12,
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  notice: {
    padding: '8px 14px',
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 10,
    flexShrink: 0,
  },
  grid: {
    flex: 1,
    display: 'flex',
    gap: 12,
    minHeight: 0,
  },
  pairListColumn: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 220px',
    minHeight: 0,
    overflow: 'hidden',
  },
  chartColumn: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
  },
  formColumn: {
    flex: '0 0 320px',
    overflowY: 'auto',
  },
  positionsRow: {
    flex: '0 0 260px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    minHeight: 0,
    overflow: 'hidden',
  },
};
