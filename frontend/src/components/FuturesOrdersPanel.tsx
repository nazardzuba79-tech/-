import { useEffect, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { refreshFuturesAccount, useFuturesAccount } from '../lib/useFuturesAccount';
import { useFuturesExecution } from '../lib/futuresExecution';
import { formatOrderDecimal, formatOrderDifference, spotOrderStatus } from './spotOrderPresentation';

/** Account-wide orders. History is the endpoint's latest 100 orders, not fills. */
export function FuturesOrdersPanel({ history = false, refreshKey }: { history?: boolean; refreshKey: number }) {
  const { t } = useLanguage();
  const account = useFuturesAccount(history ? {} : { orders: 5000 });
  const execution = useFuturesExecution();
  const key = history ? 'orderHistory' : 'orders';
  const resource = account[key];
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelFailed, setCancelFailed] = useState(false);
  useEffect(() => {
    if (history || refreshKey > 0) refreshFuturesAccount([key]);
  }, [history, refreshKey, key]);

  async function cancel(id: string) {
    if (cancelling) return;
    setCancelling(id);
    setCancelFailed(false);
    try {
      await execution.cancelOrder(id);
      execution.refresh(['orders', 'orderHistory', 'balances']);
    } catch { setCancelFailed(true); }
    finally { setCancelling(null); }
  }

  const headers = ['trade.time', 'markets.pair', 'trade.orderTypeCol', 'trade.side', 'trade.price', 'trade.quantity', 'trade.filled', 'trade.status', 'futures.reduceOnly'];
  if (!history) headers.push('trade.action');
  return <div className="futures-orders-panel" aria-busy={resource.loading || resource.refreshing}>
    <div className="futures-orders-caption">{t('futures.latestOrders')}</div>
    {((resource.failed && !!resource.data?.length) || cancelFailed) && <div role="alert" className="futures-orders-error terminal-account-state">
      {t(cancelFailed ? 'trade.cancelOrderError' : 'trade.loadOrdersError')}
      <button type="button" className="terminal-account-retry" disabled={resource.loading || resource.refreshing} onClick={() => { setCancelFailed(false); refreshFuturesAccount([key]); }}>{t('trade.retry')}</button>
    </div>}
    <table className="orders-table futures-orders-table">
      <thead><tr>{headers.map(h => <th key={h} scope="col">{t(h as Parameters<typeof t>[0])}</th>)}</tr></thead>
      <tbody>{resource.data?.length ? resource.data.map(order => {
        const date = new Date(order.createdAt);
        return <tr key={order.id} data-order-id={order.id}>
          <td>{Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'}</td>
          <td>{order.symbol} <small>{order.leverage}x</small></td>
          <td>{order.type === 'LIMIT' ? t('trade.orderType.LIMIT') : order.type === 'MARKET' ? t('trade.orderType.MARKET') : order.type}</td>
          <td className={order.side === 'BUY' ? 'text-buy' : 'text-sell'}>{t(order.side === 'BUY' ? 'trade.buy' : 'trade.sell')}</td>
          <td>{order.price == null ? '—' : formatOrderDecimal(order.price)}</td>
          <td>{formatOrderDecimal(order.originalQuantity)}</td>
          <td>{formatOrderDifference(order.originalQuantity, order.remainingQuantity)}</td>
          <td>{spotOrderStatus(order.status, t)}</td>
          <td>{order.reduceOnly ? '✓' : '—'}</td>
          {!history && <td><button className="cancel-btn" type="button" disabled={cancelling !== null} onClick={() => void cancel(order.id)}>
            {t(cancelling === order.id ? 'trade.cancelling' : 'trade.cancel')}
          </button></td>}
        </tr>;
      }) : <tr><td colSpan={headers.length} className="futures-orders-empty" role="status">
        <div className="futures-order-state">
          <span>{t(resource.failed ? 'trade.loadOrdersError' : resource.data === null ? 'trade.loading' : history ? 'futures.noOrderHistory' : 'futures.noOpenOrders')}</span>
          {resource.failed && <button type="button" className="terminal-account-retry" disabled={resource.loading || resource.refreshing}
            onClick={() => refreshFuturesAccount([key])}>{t('trade.retry')}</button>}
        </div>
      </td></tr>}</tbody>
    </table>
  </div>;
}
