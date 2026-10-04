import { useCallback, useSyncExternalStore } from 'react';
import { api, getToken, onSessionChange, type VtaDemoSnapshot } from './api';
import { createVisibleRead } from './visibleRead';
import { nrxDemoApi, NrxDemoApiError, type NrxDemoSnapshot } from './nrxDemoApi';

type Snapshot = VtaDemoSnapshot | NrxDemoSnapshot;
type State = { snapshot: Snapshot | null; failed: boolean; loading: boolean };
const empty: State = { snapshot: null, failed: false, loading: true };

/** Separate in-memory projections for VTA and NRX: switching pair/account
 * must never display another simulation's inventory or unresolved sale. */
function makeStore(readSnapshot: () => Promise<Snapshot>) {
  let state = empty, session: string | null = null, epoch = 0, revision = 0;
  let reader: ReturnType<typeof createVisibleRead> | null = null, offSession: (() => void) | null = null;
  let authorized: boolean | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: State) => { state = next; listeners.forEach(fn => fn()); };
  function start() {
    reader?.stop(); const generation = ++epoch, token = getToken();
    if (session !== token) { session = token; authorized = null; state = empty; }
    publish({ ...state, loading: !!token, failed: false });
    if (!token) { reader = null; return; }
    reader = createVisibleRead(async () => {
      const version = revision;
      const current = () => generation === epoch && getToken() === token && version === revision;
      try {
        if (authorized === null) {
          const me = await api.getMe();
          if (!current()) return;
          authorized = me.isAdmin;
        }
        const snapshot = authorized ? await readSnapshot() : null;
        if (current()) publish({ snapshot, failed: false, loading: false });
      } catch (error) {
        if (current()) publish({ snapshot: null, failed: true, loading: false });
        throw error;
      }
    }, 30_000, false);
  }
  const storageSession = (event: StorageEvent) => { if (event.key === 'exchange_token' || event.key === null) { authorized = null; state = empty; start(); } };
  function subscribe(fn: () => void) {
    listeners.add(fn);
    if (listeners.size === 1) {
      offSession = onSessionChange(() => { authorized = null; state = empty; start(); });
      window.addEventListener('storage', storageSession);
      start();
    }
    return () => {
      listeners.delete(fn);
      if (!listeners.size) { ++epoch; reader?.stop(); reader = null; offSession?.(); offSession = null; window.removeEventListener('storage', storageSession); state = empty; session = null; authorized = null; }
    };
  }
  return { subscribe, get: () => state, refresh: () => { ++revision; return reader?.refresh() ?? Promise.resolve(); } };
}
const vtaStore = makeStore(() => api.getVtaDemo());
const nrxStore = makeStore(() => nrxDemoApi.snapshot());

/** VTA's existing default call remains compatible. No polling; one visible
 * read and invalidation after an explicitly confirmed simulation sale. */
export function useVtaSpotAccount(enabled: boolean, pair = 'VTA/USDT') {
  const nrx = pair.toUpperCase() === 'NRX/USDT';
  const store = nrx ? nrxStore : vtaStore;
  const listen = useCallback((fn: () => void) => enabled ? store.subscribe(fn) : () => {}, [enabled, store]);
  const value = useSyncExternalStore(listen, () => enabled ? store.get() : empty);
  return { ...value, refresh: store.refresh,
    getSale: nrx ? nrxDemoApi.operation : api.getVtaSale,
    sell: nrx ? nrxDemoApi.sell : api.sellVtaDemo,
    definitiveRejection: (error: unknown) => nrx && error instanceof NrxDemoApiError && error.rejected };
}
