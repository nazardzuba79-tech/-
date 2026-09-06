import { LayoutList, History, WalletCards } from 'lucide-react';
import { formatOrderDecimal, formatOrderDifference, formatOrderProduct, formatOrderSum, spotOrderStatus, spotOrderType, type SpotOrderRow } from './spotOrderPresentation';

export function SpotOrdersEmpty({ title, detail, loading = false, kind = 'orders' }: {
  title: string; detail?: string; loading?: boolean; kind?: 'orders' | 'history' | 'assets';
}) {
  const Icon = kind === 'assets' ? WalletCards : kind === 'history' ? History : LayoutList;
  return <div className="spot-orders-empty" role="status" aria-busy={loading}>
    <span className="spot-orders-empty-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.5} /></span>
    <div><strong>{title}</strong>{detail && <span>{detail}</span>}</div>
  </div>;
}

export function SpotOrdersView({ orders, loading, error, history = false, cancelling = false, cancellingId, locale, t, onCancel, onRetry }: {
  orders: SpotOrderRow[]; loading: boolean; error: string | null; history?: boolean;
  cancelling?: boolean; cancellingId?: string | null; locale: string; t: (key: any) => string;
  onCancel?: (id: string) => void; onRetry: () => void;
}) {
  const headers = ['trade.time', 'markets.pair', 'trade.orderTypeCol', 'trade.side', 'trade.price', 'trade.quantity', 'trade.filled', 'trade.total', 'trade.trigger', 'trade.status'];
  if (!history) headers.push('trade.action');
  return <div className="spot-orders-panel" aria-busy={loading}>
    {error && <div className="spot-orders-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>{t('trade.retry')}</button></div>}
    <table className={`orders-table spot-orders-table${history ? ' spot-orders-history' : ''}`} data-has-rows={orders.length > 0}>
      <thead><tr>{headers.map((key, index) => <th scope="col" key={key} className={index >= 4 && index <= 8 ? 'spot-order-number' : undefined}>{t(key)}</th>)}</tr></thead>
      <tbody>{orders.length === 0 ? <tr><td className="spot-orders-empty-cell" colSpan={headers.length}>
        <SpotOrdersEmpty kind={history ? 'history' : 'orders'} loading={loading}
          title={loading ? t('trade.loading') : error ? t('trade.loadOrdersError') : t(history ? 'trade.noOrderHistory' : 'trade.noOrdersForPair')}
          detail={!loading && !error && !history ? t('trade.placeOrderPrompt') : undefined} />
      </td></tr> : orders.map(order => {
        const date = new Date(order.createdAt);
        const validDate = Number.isFinite(date.getTime());
        const quote = order.pair.split('/')[1] ?? '';
        const base = order.pair.split('/')[0] ?? '';
        return <tr key={order.id} data-order-id={order.id}>
          <td className="spot-order-time"><time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toLocaleString(locale) : order.createdAt}>
            <span>{validDate ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
            <small>{validDate ? date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—'}</small>
          </time></td>
          <td className="spot-order-pair">{order.pair}</td>
          <td title={order.type.replace(/_/g, ' ')}>{spotOrderType(order, t)}</td>
          <td className={order.side === 'BUY' ? 'side-buy' : 'side-sell'}>{t(order.side === 'BUY' ? 'trade.buy' : 'trade.sell')}</td>
          <td className="spot-order-number" title={order.price == null ? undefined : `${order.price} ${quote}`}>{order.price == null ? t('trade.market') : formatOrderDecimal(order.price)}</td>
          <td className="spot-order-number" title={`${order.originalQuantity} ${base}`}>{formatOrderDecimal(order.originalQuantity)}</td>
          <td className="spot-order-number">{formatOrderDifference(order.originalQuantity, order.remainingQuantity)}</td>
          <td className="spot-order-number">{formatOrderProduct(order.price, order.originalQuantity)}{order.price != null && <small className="spot-order-unit"> {quote}</small>}</td>
          <td className="spot-order-number" title={order.triggerPrice ?? undefined}>{formatOrderDecimal(order.triggerPrice)}</td>
          <td><span className="spot-order-status" data-status={order.status}>{spotOrderStatus(order.status, t)}</span></td>
          {!history && <td><button type="button" className="cancel-btn" disabled={cancelling} onClick={() => onCancel?.(order.id)} aria-label={`${t('trade.cancel')} ${order.pair} ${order.id}`}>
            {cancellingId === order.id ? t('trade.cancelling') : t('trade.cancel')}
          </button></td>}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function SpotAssetsView({ balances, loading, error, t, onRetry }: {
  balances: { asset: string; available: string; locked: string }[]; loading: boolean;
  error: string | null; t: (key: any) => string; onRetry: () => void;
}) {
  return <div className="spot-orders-panel" aria-busy={loading}>
    {error && <div className="spot-orders-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>{t('trade.retry')}</button></div>}
    <table className="orders-table spot-orders-table spot-assets-table" data-has-rows={balances.length > 0}>
      <thead><tr>{['trade.asset', 'trade.available', 'trade.locked', 'trade.total'].map((key, i) => <th key={key} scope="col" className={i ? 'spot-order-number' : undefined}>{t(key)}</th>)}</tr></thead>
      <tbody>{balances.length === 0 ? <tr><td className="spot-orders-empty-cell" colSpan={4}>
        <SpotOrdersEmpty kind="assets" loading={loading} title={t(loading ? 'trade.loading' : error ? 'trade.loadAssetsError' : 'trade.noAssets')} />
      </td></tr> : balances.map(balance => <tr key={balance.asset}>
        <td className="spot-order-pair">{balance.asset}</td>
        <td className="spot-order-number">{formatOrderDecimal(balance.available)}</td>
        <td className="spot-order-number">{formatOrderDecimal(balance.locked)}</td>
        <td className="spot-order-number">{formatOrderSum(balance.available, balance.locked)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
