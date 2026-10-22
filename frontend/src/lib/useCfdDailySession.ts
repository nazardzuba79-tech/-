import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener } from './browserActivity';
import { readDisplayJson, displayRefreshDelay, SLOW_DISPLAY_REFRESH_MS } from './displaySnapshotCache';
import { useEffect, useState } from 'react';
import { API_BASE } from './api';
import { parseCfdDailyBars, type CfdDailyBar } from './cfdInfoStrip';

// One cached daily series per instrument for the information strip. It rides
// the same public display route and the same shared snapshot cache as the
// chart (6-hour snapshots, one in-flight request per URL, localStorage), so a
// second reader of the same instrument costs no extra request. The limit is
// the route's floor: the strip needs the current and the previous session only.
const MARKET_EDGE_BASE = 'https://market.voltextech.net';
export const CFD_DAILY_SESSION_LIMIT = 20;
const production = () => typeof window !== 'undefined' && !!window.location && (window.location.hostname === 'voltextech.net' || window.location.hostname.endsWith('.voltextech.net'));

export function cfdDailySessionUrl(symbol:string):string {
  const path = `/cfd/display/candles/${encodeURIComponent(symbol)}?interval=1d&limit=${CFD_DAILY_SESSION_LIMIT}`;
  return production() ? `${MARKET_EDGE_BASE}${path}&v=9` : `${API_BASE.replace(/\/$/, '')}${path}`;
}

export interface CfdDailySession { symbol:string; bars:CfdDailyBar[]; fetchedAt:number|null }
export type CfdDailySessionState = 'idle'|'loading'|'ready'|'error';

export function useCfdDailySession(symbol:string, enabled = true):{ session:CfdDailySession|null; state:CfdDailySessionState } {
  const [session, setSession] = useState<CfdDailySession|null>(null);
  const [state, setState] = useState<CfdDailySessionState>('idle');
  useEffect(() => {
    if (!enabled) { setSession(null); setState('idle'); return; }
    let cancelled = false, controller:AbortController|null = null, timer:ReturnType<typeof setTimeout>|null = null;
    // Another instrument's series is never shown under this symbol: clear it now.
    setSession(previous => previous && previous.symbol === symbol ? previous : null);
    setState('loading');
    const schedule = (delay:number) => { if (timer) clearTimeout(timer); timer = null; if (!cancelled && !isBrowserInactive()) timer = setTimeout(() => void load(), delay); };
    async function load() {
      if (cancelled || controller || isBrowserInactive()) return;
      const request = new AbortController(); controller = request; let delay = SLOW_DISPLAY_REFRESH_MS;
      try {
        const url = cfdDailySessionUrl(symbol);
        const body = await readDisplayJson<{ fetchedAt?:unknown }>(url, SLOW_DISPLAY_REFRESH_MS, request.signal);
        if (cancelled || request.signal.aborted) return;
        const bars = parseCfdDailyBars(body, symbol);
        if (!bars) throw new Error('cfd_daily_session_shape');
        delay = displayRefreshDelay(url, SLOW_DISPLAY_REFRESH_MS);
        setSession({ symbol, bars, fetchedAt: typeof body.fetchedAt === 'number' ? body.fetchedAt : null });
        setState('ready');
      } catch {
        // The last good series of this symbol stays on screen; retry in a minute.
        if (!cancelled && !request.signal.aborted) setState('error');
        delay = 60_000;
      } finally {
        if (controller === request) controller = null;
        schedule(request.signal.aborted && !cancelled && !isBrowserInactive() ? 0 : delay);
      }
    }
    const visible = () => { if (isBrowserInactive()) { if (timer) clearTimeout(timer); timer = null; controller?.abort(); } else schedule(0); };
    addBrowserActivityListener(visible); void load();
    return () => { cancelled = true; controller?.abort(); if (timer) clearTimeout(timer); removeBrowserActivityListener(visible); };
  }, [symbol, enabled]);
  return { session: session && session.symbol === symbol ? session : null, state };
}
