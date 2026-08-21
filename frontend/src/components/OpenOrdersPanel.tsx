import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

interface Order {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: string | null;
  originalQuantity: string;
  remainingQuantity: string;
  status: string;
  createdAt: string;
}

export function OpenOrdersPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getMyOrders('OPEN,PARTIALLY_FILLED').then(setOrders).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  async function handleCancel(orderId: string) {
    setCancellingId(orderId);
    setError(null);
    try {
      await api.cancelOrder(orderId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('trade.cancelOrderError'));
    } finally {
      setCancellingId(null);
    }
  }

  const pairOrders = orders.filter((o) => o.pair === pair);

  return (
    <div style={styles.panel}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.columns}>
        <span>{t('trade.side')}</span>
        <span>{t('trade.price')}</span>
        <span>{t('trade.remaining')}</span>
        <span>{t('trade.status')}</span>
        <span></span>
      </div>
      <div style={styles.rows}>
        {pairOrders.map((o) => (
          <div key={o.id} style={styles.row}>
            <span className={o.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 600 }}>
              {o.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
            </span>
            <span className="mono">{o.price ? parseFloat(o.price).toFixed(2) : t('trade.market')}</span>
            <span className="mono">
              {parseFloat(o.remainingQuantity).toFixed(5)} / {parseFloat(o.originalQuantity).toFixed(5)}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {o.status === 'OPEN' ? t('trade.status.OPEN') : t('trade.status.PARTIALLY_FILLED')}
            </span>
            <button onClick={() => handleCancel(o.id)} disabled={cancellingId === o.id} style={styles.cancelBtn}>
              {cancellingId === o.id ? t('trade.cancelling') : t('trade.cancel')}
            </button>
          </div>
        ))}
        {pairOrders.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noOrdersForPair')}</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  error: {
    margin: '10px 14px 0',
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 11,
    flexShrink: 0,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1.4fr 1.2fr 0.8fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  rows: { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1.4fr 1.2fr 0.8fr',
    padding: '7px 14px',
    fontSize: 12,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    justifySelf: 'start',
  },
};
