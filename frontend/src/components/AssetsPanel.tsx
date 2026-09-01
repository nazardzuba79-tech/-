import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

/**
 * Balances in the reference's `.orders-table`, with the total column
 * derived from the two figures that are already fetched rather than
 * requested separately, so the three can never disagree.
 */
export function AssetsPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useLanguage();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .getBalances()
      .then(setBalances)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  if (!loading && balances.length === 0) {
    return <div className="empty-state">{t('trade.noAssets')}</div>;
  }

  return (
    <table className="orders-table">
      <thead>
        <tr>
          <th>{t('trade.asset')}</th>
          <th>{t('trade.available')}</th>
          <th>{t('trade.locked')}</th>
          <th>{t('trade.total')}</th>
        </tr>
      </thead>
      <tbody>
        {balances.map((b) => {
          const available = parseFloat(b.available);
          const locked = parseFloat(b.locked);
          return (
            <tr key={b.asset}>
              <td>{b.asset}</td>
              <td>{available.toFixed(6)}</td>
              <td>{locked.toFixed(6)}</td>
              <td>{(available + locked).toFixed(6)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
