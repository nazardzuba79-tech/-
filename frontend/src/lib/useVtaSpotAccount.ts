import { useCallback, useSyncExternalStore } from 'react';
import { api, getToken, onSessionChange, type VtaDemoSnapshot } from './api';
import { createVisibleRead } from './visibleRead';

type State = { snapshot: VtaDemoSnapshot | null; failed: boolean; loading: boolean };
const empty: State = { snapshot: null, failed: false, loading: true };
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
      const snapshot = authorized ? await api.getVtaDemo() : null;
      if (current()) publish({ snapshot, failed: false, loading: false });
    } catch (error) {
      if (current()) publish({ snapshot: null, failed: true, loading: false });
      throw error;
    }
  }, 30_000, false);
}
const storageSession = (event: StorageEvent) => { if (event.key === 'exchange_token') { authorized = null; state = empty; start(); } };
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    offSession = onSessionChange(() => { authorized = null; state = empty; start(); });
    window.addEventListener('storage', storageSession);
    start();
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { ++epoch; reader?.stop(); reader = null; offSession?.(); offSession = null; window.removeEventListener('storage', storageSession); }
  };
}
const refresh = () => { ++revision; return reader?.refresh() ?? Promise.resolve(); };
/** A single session-scoped projection shared by the form, Assets and wallet.
 * No polling; one visible read, and one invalidation after a successful sale. */
export function useVtaSpotAccount(enabled: boolean) {
  const listen = useCallback((fn: () => void) => enabled ? subscribe(fn) : () => {}, [enabled]);
  const value = useSyncExternalStore(listen, () => enabled ? state : empty);
  return { ...value, refresh };
}
