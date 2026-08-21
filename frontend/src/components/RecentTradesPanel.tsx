import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

interface Trade {
  id: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  time: number;
}

// Live-scrolling trade tape, mirrored from Kraken — same "market is moving"
// feel as a real exchange's own trades tab, purely for display next to the order book.
export function RecentTradesPanel({ pair }: { pair: string }) {
  const { t, lang } = useLanguage();
  const [trades, setTrades] = useState<Trade[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    seenIds.current = new Set();
    setTrades([]);

    async function load() {
      try {
        const res = await api.getExternalTrades(pair, 60);
        if (cancelled) return;
        seenIds.current = new Set(res.trades.map((t) => t.id));
        setTrades(res.trades);
      } catch {
        // stays empty on failure — background poll, not worth an error state
      }
    }

    load();
    const poll = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
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
              {new Date(t.time).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', {
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
    padding: 14,
    color: 'var(--text-tertiary)',
    fontSize: 12,
  },
};
