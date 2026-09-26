import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SpotAssetsView } from './SpotOrdersView';
import { createSpotReadController, startVisibleReadPolling, type SpotReadController } from './spotOrderPresentation';
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
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const reader = useRef<SpotReadController | null>(null);
  if (!reader.current) reader.current = createSpotReadController(() => api.getBalances(), {
    started: () => setRefreshing(true), accept: rows => { setBalances(rows); setFailed(false); }, reject: () => setFailed(true),
    settled: () => { setLoading(false); setRefreshing(false); },
  });

  // Futures reads the ONE shared account store — same 4s cadence, but it
  // is now the same /futures/balances response the order form and the
  // margin summary are already reading, so opening this tab no longer adds
  // a third poller for a figure the page has twice over. Spot keeps its 4s
  // visible cadence and sleeps in hidden tabs; Futures never reads the Spot
  // wallet and still does not.
  const isFutures = wallet === 'futures' && !compact;
  const futuresAccount = useFuturesAccount(isFutures ? { balances: 4000 } : {});

  const load = useCallback((fresh = false) => {
    if (compact) return reader.current!.read(fresh);
    if (wallet === 'futures') return refreshFuturesAccount(['balances']);
    setRefreshing(true);
    api.getBalances()
      .then(rows => { setBalances(rows); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
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
    const stopPolling = startVisibleReadPolling(load, 4000);
    return () => { stopPolling(); if (compact) reader.current!.pause(); };
  }, [load, refreshKey, compact, isFutures]);

  const rows = isFutures ? futuresAccount.balances.data : balances;
  // Futures: `null` is "not known yet or failed" and must not render as an
  // empty wallet; `[]` is a real empty wallet and does.
  const isLoading = isFutures ? !futuresAccount.balances.loaded : loading;
  const hasFailed = isFutures ? futuresAccount.balances.failed : failed;
  const isRefreshing = isFutures ? futuresAccount.balances.loading || futuresAccount.balances.refreshing : refreshing;
  const failure = <div className="terminal-account-state" role="alert" aria-busy={isRefreshing}>
    <span>{t('trade.loadAssetsError')}</span>
    <button type="button" className="terminal-account-retry" disabled={isRefreshing} onClick={() => { void load(true); }}>{t('trade.retry')}</button>
  </div>;

  // Spot keeps its compact view; Futures keeps its existing table format.
  if (compact) return <SpotAssetsView balances={balances} loading={loading} refreshing={refreshing} error={failed ? t('trade.loadAssetsError') : null} t={t} onRetry={() => { void load(true); }} />;

  // A failed read is not an empty wallet. The same retry remains available
  // for a failed initial read and for a refresh of a previously empty wallet.
  if (isFutures && rows === null) {
    return hasFailed ? failure : <div className="empty-state" role="status" aria-busy={isLoading}>{t('trade.loading')}</div>;
  }
  if (hasFailed && (rows === null || rows.length === 0)) {
    return failure;
  }
  if (!isLoading && (rows ?? []).length === 0) {
    return <div className="empty-state">{t('trade.noAssets')}</div>;
  }

  return (
    <>
    {hasFailed && failure}
    <table className="orders-table" aria-busy={isRefreshing}>
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
    </>
  );
}
