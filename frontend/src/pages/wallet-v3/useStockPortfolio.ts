import { useEffect, useRef, useState } from 'react';
import { getToken, onSessionChange } from '../../lib/api';
import type { LedgerRow } from './useWalletData';
import { isStockPortfolio, nextStockPortfolioExpiry, stockPortfolioRows } from './stockPortfolio';

declare const __VOLTEX_STOCKS_GLOBAL_SIMULATOR__: boolean;
const enabled = typeof __VOLTEX_STOCKS_GLOBAL_SIMULATOR__ !== 'undefined' && __VOLTEX_STOCKS_GLOBAL_SIMULATOR__;
const READ_DEADLINE_MS = 8_000;

type ScopedPortfolio = { token: string; data: unknown };

/** Authenticated demand reads only. Quote expiry updates the display without polling. */
export function useStockPortfolio(refreshKey: number): LedgerRow[] {
  const [portfolio, setPortfolio] = useState<ScopedPortfolio | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const token = getToken();

  useEffect(() => onSessionChange(() => {
    // Invalidate synchronously: a previous user's late response cannot win the render.
    generation.current++;
    active.current?.abort();
    setPortfolio(null);
    setSessionVersion(v => v + 1);
  }), []);

  useEffect(() => {
    if (!enabled || !token) { setPortfolio(null); return; }
    let disposed = false;
    const cancel = () => { generation.current++; active.current?.abort(); };
    const read = () => {
      if (disposed || document.hidden || getToken() !== token) return;
      cancel();
      const request = generation.current;
      const controller = new AbortController();
      active.current = controller;
      const current = () => !disposed && request === generation.current && getToken() === token;
      const deadline = setTimeout(() => controller.abort(), READ_DEADLINE_MS);
      const unavailable = () => {
        if (!current()) return;
        // Preserve known scoped holdings, but never leave an old valuation labelled current.
        setPortfolio(previous => previous?.token === token && isStockPortfolio(previous.data)
          ? { token, data: { ...previous.data, quotes: {} } } : null);
      };
      void fetch('/__stocks_global/portfolio', {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'omit',
        cache: 'no-store', signal: controller.signal,
      }).then(async response => {
        if (!current()) return;
        if (response.status === 401 || response.status === 403) { setPortfolio(null); return; }
        if (!response.ok) { unavailable(); return; }
        const data: unknown = await response.json();
        if (!current()) return;
        if (!isStockPortfolio(data)) { unavailable(); return; }
        setPortfolio({ token, data });
        setClock(Date.now());
      }).catch(unavailable).finally(() => {
        clearTimeout(deadline);
        if (active.current === controller) active.current = null;
      });
    };
    const visibility = () => {
      setClock(Date.now());
      if (document.hidden) cancel(); else read();
    };
    document.addEventListener('visibilitychange', visibility);
    read();
    return () => { disposed = true; cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, [token, refreshKey, sessionVersion]);

  useEffect(() => {
    if (!portfolio || portfolio.token !== token) return;
    const expires = nextStockPortfolioExpiry(portfolio.data, Date.now());
    if (expires === null) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [portfolio, token, clock]);

  // Check the token during render as well, before session effects have had a chance to run.
  return enabled && token && portfolio?.token === token
    ? stockPortfolioRows(portfolio.data, Date.now()) : [];
}
