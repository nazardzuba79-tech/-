import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SpotAssetsView } from './SpotOrdersView';
import { createSpotReadController, type SpotReadController } from './spotOrderPresentation';
import { useFuturesAccount, refreshFuturesAccount } from '../lib/useFuturesAccount';
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

  // Futures reads the ONE shared account store — same 4s cadence, but it
  // is now the same /futures/balances response the order form and the
  // margin summary are already reading, so opening this tab no longer adds
  // a third poller for a figure the page has twice over. Spot is untouched
  // and still polls exactly as before; Futures must never read the Spot
  // wallet and still does not.
  const isFutures = wallet === 'futures' && !compact;
  const futuresAccount = useFuturesAccount(isFutures ? { balances: 4000 } : {});

  const load = useCallback((fresh = false) => {
    if (compact) return reader.current!.read(fresh);
    if (wallet === 'futures') return refreshFuturesAccount(['balances']);
    api.getBalances()
      .then(rows => { setBalances(rows); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [compact, wallet]);

  useEffect(() => {
    if (compact) reader.current!.resume();
    // Futures has no timer and no mount fetch of its own any more: the
    // shared store's subscription above already loads on mount and owns the
    // 4s cadence. `refreshKey` still means "the page says this changed".
    if (isFutures) {
      if (refreshKey > 0) void load(true);
      return () => { if (compact) reader.current!.pause(); };
    }
    void load(true);
    const interval = setInterval(load, 4000);
    return () => { clearInterval(interval); if (compact) reader.current!.pause(); };
  }, [load, refreshKey, compact, isFutures]);

  const rows = isFutures ? futuresAccount.balances.data : balances;
  // Futures: `null` is "not known yet or failed" and must not render as an
  // empty wallet; `[]` is a real empty wallet and does.
  const isLoading = isFutures ? !futuresAccount.balances.loaded : loading;
  const hasFailed = isFutures ? futuresAccount.balances.failed && rows === null : failed;

  // Explicit Spot-only opt-in: the shared Futures table/empty state below
  // remains unchanged, including its existing number formatting.
  if (compact) return <SpotAssetsView balances={balances} loading={loading} error={failed ? t('trade.loadAssetsError') : null} t={t} onRetry={() => { void load(true); }} />;

  // A failed read is not an empty wallet. Spot keeps its existing
  // behaviour exactly; Futures now says so instead of showing "no assets"
  // over a balance it simply could not fetch.
  if (isFutures && rows === null) {
    return <div className="empty-state">{isLoading ? t('trade.loading') : t('trade.loadAssetsError')}</div>;
  }
  if (hasFailed && (rows === null || rows.length === 0)) {
    return <div className="empty-state">{t('trade.loadAssetsError')}</div>;
  }
  if (!isLoading && (rows ?? []).length === 0) {
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
        {(rows ?? []).map((b) => {
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
