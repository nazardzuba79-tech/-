import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { Badge } from './Badge';

interface Order {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: string | null;
  triggerPrice: string | null;
  ocoGroupId: string | null;
  originalQuantity: string;
  remainingQuantity: string;
  status: string;
  createdAt: string;
}

function OrderTypeBadge({ order }: { order: Order }) {
  const { t } = useLanguage();
  if (order.ocoGroupId) return <Badge text={t('trade.orderType.OCO')} color="#5b8def" bg="rgba(91,141,239,0.14)" />;
  switch (order.type) {
    case 'STOP_LIMIT':
    case 'STOP_MARKET':
      return <Badge text={t('trade.orderType.STOP_LIMIT')} color="var(--sell)" bg="var(--sell-dim)" />;
    case 'TAKE_PROFIT_LIMIT':
    case 'TAKE_PROFIT_MARKET':
      return <Badge text={t('trade.orderType.TAKE_PROFIT_LIMIT')} color="var(--buy)" bg="var(--buy-dim)" />;
    case 'MARKET':
      return <Badge text={t('trade.orderType.MARKET')} color="var(--text-secondary)" bg="var(--neutral-dim)" />;
    default:
      return <Badge text={t('trade.orderType.LIMIT')} color="var(--text-secondary)" bg="var(--neutral-dim)" />;
  }
}

function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  if (status === 'PENDING_TRIGGER') return <Badge text={t('trade.status.PENDING_TRIGGER')} color="#5b8def" bg="rgba(91,141,239,0.14)" />;
  if (status === 'OPEN') return <Badge text={t('trade.status.OPEN')} color="var(--accent)" bg="var(--accent-dim)" />;
  return <Badge text={t('trade.status.PARTIALLY_FILLED')} color="var(--text-secondary)" bg="var(--neutral-dim)" />;
}

export function OpenOrdersPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getMyOrders('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED').then(setOrders).catch(() => {});
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
      toast.success(t('trade.orderCancelled'));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('trade.cancelOrderError');
      setError(message);
      toast.error(message);
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
        <span></span>
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
            <OrderTypeBadge order={o} />
            <span className="mono">
              {o.triggerPrice ? (
                <>
                  ⚡{parseFloat(o.triggerPrice).toFixed(2)}
                  {o.price ? ` / ${parseFloat(o.price).toFixed(2)}` : ''}
                </>
              ) : o.price ? (
                parseFloat(o.price).toFixed(2)
              ) : (
                t('trade.market')
              )}
            </span>
            <span className="mono">
              {parseFloat(o.remainingQuantity).toFixed(5)} / {parseFloat(o.originalQuantity).toFixed(5)}
            </span>
            <OrderStatusBadge status={o.status} />
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
    borderRadius: 8,
    fontSize: 11,
    flexShrink: 0,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '0.7fr 0.6fr 1.4fr 1.4fr 1fr 0.8fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
    gap: 6,
  },
  rows: { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '0.7fr 0.6fr 1.4fr 1.4fr 1fr 0.8fr',
    padding: '7px 14px',
    fontSize: 12,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    gap: 6,
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 11,
    justifySelf: 'start',
  },
};
