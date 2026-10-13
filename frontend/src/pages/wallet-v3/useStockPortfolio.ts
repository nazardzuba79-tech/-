import { useEffect, useState } from 'react';
import { getToken, onSessionChange } from '../../lib/api';
import type { LedgerRow } from './useWalletData';
import { stockPortfolioRows } from './stockPortfolio';

/** One authenticated on-demand read; no wallet mutation, no polling. */
export function useStockPortfolio(ownerConfirmed: boolean, refreshKey: number): LedgerRow[] {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => onSessionChange(() => {
    setRows([]);
    setSessionVersion(v => v + 1);
  }), []);
  useEffect(() => {
    setRows([]);
    if (!ownerConfirmed || document.hidden) return;
    const token = getToken();
    if (!token) return;
    const controller = new AbortController();
    let live = true;
    void fetch('/__stocks_global/state', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return null;
      return response.json() as Promise<unknown>;
    }).then(data => {
      if (live && getToken() === token && data !== null) setRows(stockPortfolioRows(data));
    }).catch(() => {
      // Isolated Stocks may not be mounted. Never fabricate or replace wallet rows.
    });
    return () => { live = false; controller.abort(); };
  }, [ownerConfirmed, refreshKey, sessionVersion]);
  return rows;
}
