import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

interface Trade {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  executedAt: string;
}

export function TradeHistoryPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const [trades, setTrades] = useState<Trade[]>([]);

  const load = useCallback(() => {
    api.getMyTrades(pair).then(setTrades).catch(() => {});
  }, [pair]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  return (
    <div style={styles.panel}>
      <div style={styles.columns}>
        <span>{t('trade.side')}</span>
        <span>{t('trade.price')}</span>
        <span>{t('trade.quantity')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.time')}</span>
      </div>
      <div style={styles.rows}>
        {trades.map((tr) => (
          <div key={tr.id} style={styles.row}>
            <span className={tr.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 600 }}>
              {tr.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
            </span>
            <span className="mono">{parseFloat(tr.price).toFixed(2)}</span>
            <span className="mono">{parseFloat(tr.quantity).toFixed(5)}</span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 11 }}>
              {new Date(tr.executedAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}
            </span>
          </div>
        ))}
        {trades.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noTradeHistory')}</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1.4fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  rows: { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1.4fr',
    padding: '7px 14px',
    fontSize: 12,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
};
