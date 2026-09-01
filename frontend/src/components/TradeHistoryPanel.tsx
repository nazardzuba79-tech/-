import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';

interface Trade {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  executedAt: string;
}

/**
 * The account's own fills, in the reference's `.orders-table`.
 * Data and polling are unchanged from before.
 */
export function TradeHistoryPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [, quoteAsset] = pair.split('/');

  const load = useCallback(() => {
    api
      .getMyTrades(pair)
      .then(setTrades)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pair]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  if (!loading && trades.length === 0) {
    return <div className="empty-state">{t('trade.noTradeHistory')}</div>;
  }

  return (
    <table className="orders-table">
      <thead>
        <tr>
          <th>{t('trade.time')}</th>
          <th>{t('trade.side')}</th>
          <th>{t('trade.price')}</th>
          <th>{t('trade.quantity')}</th>
          <th>{t('trade.total')}</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((tr) => {
          const price = parseFloat(tr.price);
          const quantity = parseFloat(tr.quantity);
          return (
            <tr key={tr.id}>
              <td>{new Date(tr.executedAt).toLocaleString(localeOf(lang))}</td>
              <td className={tr.side === 'BUY' ? 'side-buy' : 'side-sell'}>
                {tr.side === 'BUY' ? t('trade.buy') : t('trade.sell')}
              </td>
              <td>{price.toFixed(2)}</td>
              <td>{quantity.toFixed(5)}</td>
              <td>{`${(price * quantity).toFixed(2)} ${quoteAsset}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
