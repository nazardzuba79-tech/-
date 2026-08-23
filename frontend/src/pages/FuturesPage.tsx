import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesPairList } from '../components/FuturesPairList';
import { PriceChart } from '../components/PriceChart';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesRiskDisclaimerModal } from '../components/FuturesRiskDisclaimerModal';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { TopGainersTicker } from '../components/TopGainersTicker';

const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function FuturesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [riskAcknowledged, setRiskAcknowledged] = useState<boolean | null>(null);
  const [newAccountNotice, setNewAccountNotice] = useState<{ max: number; days: number } | null>(null);
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);

  useEffect(() => {
    api
      .getFuturesRiskAck()
      .then((res) => setRiskAcknowledged(res.acknowledged))
      .catch(() => setRiskAcknowledged(false));
  }, []);

  // Surface the new-account leverage cap as an informational notice — the
  // real enforcement is server-side (see requireRiskAck/leverage checks in
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
    <div className="page-mesh" style={styles.page}>
      <Nav
        active="/futures"
        rightExtra={
          <button onClick={() => setShowTransfer(true)} style={styles.transferBtn}>
            {t('futures.transfer')}
          </button>
        }
      />
      <TopGainersTicker onSelect={handleTickerSelect} />
      <FuturesTickerBar symbol={symbol} />

      {newAccountNotice && (
        <div style={styles.notice}>
          {t('futures.newAccountLimitNotice', { max: newAccountNotice.max, days: newAccountNotice.days })}
        </div>
      )}

      <main style={styles.grid}>
        <div style={styles.pairListColumn}>
          <FuturesPairList symbols={FUTURES_SYMBOLS} symbol={symbol} onChange={setSymbol} />
        </div>
        <div style={styles.chartColumn}>
          <PriceChart pair={symbol} />
        </div>
        <div style={styles.formColumn}>
          <FuturesOrderForm symbol={symbol} onPlaced={handleOrderPlaced} />
        </div>
      </main>

      <div style={styles.positionsRow}>
        <FuturesPositionsPanel refreshKey={positionsRefreshKey} />
      </div>

      {riskAcknowledged === false && (
        <FuturesRiskDisclaimerModal onAccepted={() => setRiskAcknowledged(true)} />
      )}
      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  transferBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 18,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12,
  },
  notice: {
    padding: '8px 20px',
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  grid: {
    flex: 1,
    display: 'flex',
    gap: 1,
    background: 'var(--border)',
    padding: 1,
    minHeight: 0,
  },
  pairListColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 220px',
    minHeight: 0,
  },
  chartColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flex: '1 1 auto',
    minWidth: 0,
  },
  formColumn: {
    background: 'var(--bg)',
    flex: '0 0 320px',
    overflowY: 'auto',
  },
  positionsRow: {
    flex: '0 0 260px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    borderTop: '1px solid var(--border)',
    minHeight: 0,
  },
};
