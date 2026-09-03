import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { LayoutList } from 'lucide-react';

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

export interface OpenOrdersHandle {
  cancelAll: () => Promise<void>;
}

function typeLabel(order: Order, t: (k: any) => string): string {
  if (order.ocoGroupId) return t('trade.orderType.OCO');
  switch (order.type) {
    case 'STOP_LIMIT':
    case 'STOP_MARKET':
      return t('trade.orderType.STOP_LIMIT');
    case 'TAKE_PROFIT_LIMIT':
    case 'TAKE_PROFIT_MARKET':
      return t('trade.orderType.TAKE_PROFIT_LIMIT');
    case 'MARKET':
      return t('trade.orderType.MARKET');
    default:
      return t('trade.orderType.LIMIT');
  }
}

/**
 * The reference's Open Orders table: Time, Pair, Type, Side, Price, Amount,
 * Filled, Total, Trigger, Action — rendered as its `.orders-table`.
 *
 * Behaviour is unchanged (4s poll, per-row cancel through the same
 * endpoint); it now also reports its row count so the tab can show the
 * reference's badge, and exposes cancelAll for the reference's "Cancel All"
 * action, which loops the same per-order endpoint rather than needing a new
 * one.
 */
export const OpenOrdersPanel = forwardRef<OpenOrdersHandle, { pair: string; refreshKey: number; onCount?: (n: number) => void }>(
  function OpenOrdersPanel({ pair, refreshKey, onCount }, ref) {
    const { t, lang } = useLanguage();
    const toast = useToast();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [cancellingId, setCancellingId] = useState<string | null>(null);

    const load = useCallback(() => {
      api
        .getMyOrders('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED')
        .then(setOrders)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
      load();
      const interval = setInterval(load, 4000);
      return () => clearInterval(interval);
    }, [load, refreshKey]);

    const pairOrders = orders.filter((o) => o.pair === pair);

    useEffect(() => {
      onCount?.(pairOrders.length);
    }, [pairOrders.length, onCount]);

    async function handleCancel(orderId: string) {
      setCancellingId(orderId);
      try {
        await api.cancelOrder(orderId);
        load();
        toast.success(t('trade.orderCancelled'));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t('trade.cancelOrderError'));
      } finally {
        setCancellingId(null);
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        async cancelAll() {
          // Sequential rather than parallel: these all hit the same account
          // and the same book, and a burst of concurrent cancels is exactly
          // the shape a rate limiter rejects.
          for (const order of pairOrders) {
            try {
              await api.cancelOrder(order.id);
            } catch {
              // One failure must not abandon the rest; the reload below
              // shows whatever actually survived.
            }
          }
          load();
          toast.success(t('trade.orderCancelled'));
        },
      }),
      [pairOrders, load, toast, t]
    );

    if (!loading && pairOrders.length === 0) {
      return (
        <div className="open-orders-empty">
          <span className="open-orders-empty-icon" aria-hidden="true"><LayoutList size={20} /></span>
          <strong>{t('trade.noOrdersForPair')}</strong>
          <span>{t('trade.placeOrderPrompt')}</span>
        </div>
      );
    }

    return (
      <table className="orders-table">
        <thead>
          <tr>
            <th>{t('trade.time')}</th>
            <th>{t('markets.pair')}</th>
            <th>{t('trade.orderTypeCol')}</th>
            <th>{t('trade.side')}</th>
            <th>{t('trade.price')}</th>
            <th>{t('trade.quantity')}</th>
            <th>{t('trade.filled')}</th>
            <th>{t('trade.total')}</th>
            <th>{t('trade.trigger')}</th>
            <th>{t('trade.action')}</th>
          </tr>
        </thead>
        <tbody>
          {pairOrders.map((o) => {
            const original = parseFloat(o.originalQuantity);
            const remaining = parseFloat(o.remainingQuantity);
            const price = o.price ? parseFloat(o.price) : null;
            const [, quoteAsset] = o.pair.split('/');
            return (
              <tr key={o.id}>
                <td>{new Date(o.createdAt).toLocaleString(localeOf(lang))}</td>
                <td>{o.pair}</td>
                <td>{typeLabel(o, t)}</td>
                <td className={o.side === 'BUY' ? 'side-buy' : 'side-sell'}>
                  {o.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
                </td>
                <td>{price !== null ? price.toFixed(2) : t('trade.market')}</td>
                <td>{original.toFixed(4)}</td>
                <td>{(original - remaining).toFixed(4)}</td>
                <td>{price !== null ? `${(price * original).toFixed(2)} ${quoteAsset}` : '—'}</td>
                <td>{o.triggerPrice ? parseFloat(o.triggerPrice).toFixed(2) : '—'}</td>
                <td>
                  <button className="cancel-btn" onClick={() => handleCancel(o.id)} disabled={cancellingId === o.id}>
                    {cancellingId === o.id ? t('trade.cancelling') : t('trade.cancel')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
);
