import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Badge } from './Badge';

interface Order {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  price: string | null;
  originalQuantity: string;
  remainingQuantity: string;
  status: string;
  createdAt: string;
}

export function OrderHistoryPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);

  const load = useCallback(() => {
    api.getMyOrders('FILLED,CANCELLED').then(setOrders).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const pairOrders = orders.filter((o) => o.pair === pair);

  return (
    <div style={styles.panel}>
      <div style={styles.columns}>
        <span>{t('trade.side')}</span>
        <span>{t('trade.price')}</span>
        <span>{t('trade.quantity')}</span>
        <span>{t('trade.status')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.time')}</span>
      </div>
      <div style={styles.rows}>
        {pairOrders.map((o) => (
          <div key={o.id} style={styles.row}>
            <span className={o.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 600 }}>
              {o.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
            </span>
            <span className="mono">{o.price ? parseFloat(o.price).toFixed(2) : t('trade.market')}</span>
            <span className="mono">{parseFloat(o.originalQuantity).toFixed(5)}</span>
            {o.status === 'FILLED' ? (
              <Badge text={t('trade.status.FILLED')} color="var(--buy)" bg="var(--buy-dim)" />
            ) : (
              <Badge text={t('trade.status.CANCELLED')} color="var(--text-secondary)" bg="var(--neutral-dim)" />
            )}
            <span className="mono" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 11 }}>
              {new Date(o.createdAt).toLocaleString(localeOf(lang))}
            </span>
          </div>
        ))}
        {pairOrders.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noOrderHistory')}</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1.2fr 1.4fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  rows: { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1.2fr 1.4fr',
    padding: '7px 14px',
    fontSize: 12,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
};
