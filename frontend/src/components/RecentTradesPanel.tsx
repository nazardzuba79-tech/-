import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { krakenSocket } from '../lib/krakenSocket';

interface Trade {
  id: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  time: number;
}

const MAX_TRADES = 60;
const WS_FALLBACK_TIMEOUT_MS = 4000;

// Live-scrolling trade tape, streamed from Kraken's public WebSocket — real
// prints arriving as they happen, not a 2s poll. Falls back to REST polling
// (the previous behavior) if the socket doesn't deliver anything within a
// few seconds, so a blocked/failed connection degrades instead of freezing.
export function RecentTradesPanel({ pair }: { pair: string }) {
  const { t, lang } = useLanguage();
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    setTrades([]);
    let gotWsData = false;
    let restInterval: number | null = null;

    async function loadRest() {
      try {
        const res = await api.getExternalTrades(pair, MAX_TRADES);
        if (!gotWsData) setTrades(res.trades);
      } catch {
        // stays whatever it was — background poll, not worth an error state
      }
    }

    const unsubscribe = krakenSocket.subscribeTrades(pair, (trade) => {
      gotWsData = true;
      if (restInterval !== null) {
        clearInterval(restInterval);
        restInterval = null;
      }
      setTrades((prev) => [trade, ...prev].slice(0, MAX_TRADES));
    });

    loadRest();
    const fallbackTimer = window.setTimeout(() => {
      if (!gotWsData) restInterval = window.setInterval(loadRest, 2000);
    }, WS_FALLBACK_TIMEOUT_MS);

    return () => {
      unsubscribe();
      clearTimeout(fallbackTimer);
      if (restInterval !== null) clearInterval(restInterval);
    };
  }, [pair]);

  return (
    <div style={styles.panel}>
      <div style={styles.columnLabels}>
        <span>{t('trade.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.quantity')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.time')}</span>
      </div>
      <div style={styles.rows}>
        {trades.map((t) => (
          <div key={t.id} style={styles.row}>
            <span className="mono" style={{ color: t.side === 'BUY' ? 'var(--buy)' : 'var(--sell)' }}>
              {parseFloat(t.price).toFixed(2)}
            </span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>
              {parseFloat(t.quantity).toFixed(5)}
            </span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 11 }}>
              {new Date(t.time).toLocaleTimeString(localeOf(lang), {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        ))}
        {trades.length === 0 && <p style={styles.hint}>{t('trade.loadingTrades')}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--panel)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
    overflow: 'auto',
  },
  columnLabels: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '3px 14px',
    fontSize: 12,
  },
  hint: {
    padding: 16,
    color: 'var(--text-tertiary)',
    fontSize: 12,
  },
};
