import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SpotAssetsView } from './SpotOrdersView';
import { createSpotReadController, type SpotReadController } from './spotOrderPresentation';
import './SpotOrders.css';

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
export function AssetsPanel({ refreshKey, compact = false, wallet = 'spot' }: { refreshKey: number; compact?: boolean; wallet?: 'spot' | 'futures' }) {
  const { t } = useLanguage();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reader = useRef<SpotReadController | null>(null);
  if (!reader.current) reader.current = createSpotReadController(() => api.getBalances(), {
    accept: rows => { setBalances(rows); setFailed(false); }, reject: () => setFailed(true), settled: () => setLoading(false),
  });

  const load = useCallback((fresh = false) => {
    if (compact) return reader.current!.read(fresh);
    // Same table/polling cadence; Futures must never read the Spot wallet.
    const request = wallet === 'futures' ? api.getFuturesBalances : api.getBalances;
    request()
      .then(rows => { setBalances(rows); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [compact, wallet]);

  useEffect(() => {
    if (compact) reader.current!.resume();
    void load(true);
    const interval = setInterval(load, 4000);
    return () => { clearInterval(interval); if (compact) reader.current!.pause(); };
  }, [load, refreshKey, compact]);

  // Explicit Spot-only opt-in: the shared Futures table/empty state below
  // remains unchanged, including its existing number formatting.
  if (compact) return <SpotAssetsView balances={balances} loading={loading} error={failed ? t('trade.loadAssetsError') : null} t={t} onRetry={() => { void load(true); }} />;

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
