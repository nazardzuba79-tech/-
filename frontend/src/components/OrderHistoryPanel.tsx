import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';

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

/**
 * Order history in the reference's `.orders-table` — same table shape the
 * Open Orders tab uses, since the reference gives every bottom-panel tab
 * one table style.
 *
 * Data and polling are unchanged from before.
 */
export function OrderHistoryPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .getMyOrders('FILLED,CANCELLED')
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

  if (!loading && pairOrders.length === 0) {
    return <div className="empty-state">{t('trade.noOrderHistory')}</div>;
  }

  return (
    <table className="orders-table">
      <thead>
        <tr>
          <th>{t('trade.time')}</th>
          <th>{t('trade.side')}</th>
          <th>{t('trade.price')}</th>
          <th>{t('trade.quantity')}</th>
          <th>{t('trade.filled')}</th>
          <th>{t('trade.status')}</th>
        </tr>
      </thead>
      <tbody>
        {pairOrders.map((o) => {
          const original = parseFloat(o.originalQuantity);
          const remaining = parseFloat(o.remainingQuantity);
          return (
            <tr key={o.id}>
              <td>{new Date(o.createdAt).toLocaleString(localeOf(lang))}</td>
              <td className={o.side === 'BUY' ? 'side-buy' : 'side-sell'}>
                {o.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
              </td>
              <td>{o.price ? parseFloat(o.price).toFixed(2) : t('trade.market')}</td>
              <td>{original.toFixed(5)}</td>
              <td>{(original - remaining).toFixed(5)}</td>
              <td>{o.status === 'FILLED' ? t('trade.status.FILLED') : t('trade.status.CANCELLED')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
