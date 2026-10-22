import { useEffect, useSyncExternalStore } from 'react';
import { getToken, onSessionChange } from '../../lib/api';
import { adminRead } from '../../lib/adminReadApi';
export const ADMIN_SUMMARY_STALE_MS = 30_000;
export type SummaryKey = 'readyPackages' | 'pendingPackages' | 'unlinkedTransfers' | 'activeWithdrawals' | 'pendingKyc' | 'openOtc' | 'totalUsers' | 'newUsers24h';
const SUMMARY_KEYS: SummaryKey[] = ['readyPackages', 'pendingPackages', 'unlinkedTransfers', 'activeWithdrawals', 'pendingKyc', 'openOtc', 'totalUsers', 'newUsers24h'];
export interface WorkSummary {
  asOf: string;
  widgets: Record<SummaryKey, { value: number | null; unit: string; href: string; status: 'ready' | 'unavailable'; asOf: string | null }>;
  alerts?: { depositId: string | null; withdrawalId: string | null; kycId: string | null } | null;
}
type State = { data: WorkSummary | null; loading: boolean; error: string | null; updatedAt: number | null; unavailable: boolean };
const empty: State = { data: null, loading: false, error: null, updatedAt: null, unavailable: false };
let state: State = empty;
let session: string | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;
let offSession: (() => void) | undefined;
let nextReadAt = 0;
let forcedFollowup = false;
const visible = () => typeof document !== 'undefined' && !document.hidden;
const publish = (next: State) => { state = next; listeners.forEach(fn => fn()); };
function stopRequest() { controller?.abort(); controller = null; forcedFollowup = false; clearTimeout(timeout); clearTimeout(timer); }
function schedule() {
  clearTimeout(timer);
  if (!state.unavailable && listeners.size && visible() && getToken()) timer = setTimeout(() => refreshAdminSummary(false), Math.max(1, nextReadAt - Date.now()));
}
function scheduleNext() { nextReadAt = Date.now() + ADMIN_SUMMARY_STALE_MS; schedule(); }
function completeRead(own: AbortController) {
  if (controller !== own) return;
  clearTimeout(timeout); controller = null;
  if (forcedFollowup) { forcedFollowup = false; refreshAdminSummary(); }
  else scheduleNext();
}

export function refreshAdminSummary(force = true) {
  const token = getToken();
  if (session !== token) { stopRequest(); session = token; nextReadAt = 0; publish(empty); }
  // Optional on older servers: never poll a missing route or fan out to queues.
  if (state.unavailable) return;
  // A successful mutation invalidates even a fresh hidden snapshot. It never
  // starts hidden traffic, but the next visible return must read again.
  if (force) nextReadAt = 0;
  if (!listeners.size || !visible() || !token) return;
  if (controller) { if (force) forcedFollowup = true; return; }
  // Focus/visibility events keep the original deadline, including retry backoff.
  if (!force && nextReadAt > Date.now()) { schedule(); return; }
  const own = new AbortController(); controller = own;
  publish({ ...state, loading: true, error: null });
  const owns = () => controller === own && session === token && getToken() === token;
  timeout = setTimeout(() => {
    if (!owns()) return;
    own.abort(); publish({ ...state, loading: false, error: 'Истекло время ожидания сводки.' }); completeRead(own);
  }, 15_000);
  adminRead<WorkSummary>('/admin/work-summary', own.signal).then(data => {
    // Do not label a snapshot started before a confirmed mutation as fresh.
    if (!owns() || forcedFollowup) return;
    if (!data?.widgets || !SUMMARY_KEYS.every(key => {
      const widget = data.widgets[key];
      return widget && (widget.status === 'ready' || widget.status === 'unavailable')
        && (widget.value === null || (Number.isSafeInteger(widget.value) && widget.value >= 0))
        && typeof widget.unit === 'string' && typeof widget.href === 'string' && /^\/admin(?:\/|\?|$)/.test(widget.href);
    })) throw new Error('Invalid summary');
    publish({ data, loading: false, error: null, updatedAt: Date.now(), unavailable: false });
  }).catch(error => {
    if (!owns()) return;
    if (error?.status === 404) {
      forcedFollowup = false;
      publish({ ...empty, unavailable: true });
      return;
    }
    const denied = [401, 403].includes(error?.status);
    if (denied) forcedFollowup = false;
    publish({ ...state, ...(denied ? { data: null, updatedAt: null } : {}), loading: false,
      error: denied ? 'Нет доступа к сводке. Проверьте сессию.' : 'Не удалось обновить сводку.' });
  }).finally(() => { if (owns()) completeRead(own); });
}
function changed() {
  if (!visible()) { stopRequest(); if (state.loading) publish({ ...state, loading: false }); }
  else refreshAdminSummary(false);
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', changed); window.addEventListener('focus', changed);
    offSession = onSessionChange(() => { stopRequest(); session = getToken(); nextReadAt = 0; publish(empty); refreshAdminSummary(false); });
    refreshAdminSummary(false);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      stopRequest(); document.removeEventListener('visibilitychange', changed); window.removeEventListener('focus', changed);
      offSession?.(); offSession = undefined;
      // Summary is private working data, never an off-route/session cache.
      state = empty; session = null; nextReadAt = 0;
    }
  };
}
const noSubscribe = () => () => {};
export function useAdminWorkSummary(enabled = true) {
  const snapshot = useSyncExternalStore(enabled ? subscribe : noSubscribe, () => enabled && getToken() === session ? state : empty);
  useEffect(() => { if (enabled) refreshAdminSummary(false); }, [enabled]);
  return { ...snapshot, reload: refreshAdminSummary };
}
