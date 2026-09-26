import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, getToken } from '../../lib/api';

/** A deposit that still needs an admin: already attributed to a user, not CREDITED. Server record, never edited here. */
export interface AdminPendingDeposit {
  id: string;
  userId: string;
  asset: string;
  chain: string;
  txHash: string;
  amount: string;
  confirmations: number;
  status: string;
  createdAt: string;
}

export interface AdminUserActivity {
  asOf: string;
  totalUsers: number;
  newUsers24h: number;
  pendingKyc: number;
  pendingDeposits: AdminPendingDeposit[];
}

/** One small read: counts + the pending-deposit work queue (GET /admin/user-activity). No history. */
export async function getAdminUserActivity(signal?: AbortSignal): Promise<AdminUserActivity> {
  const token = getToken();
  if (!token) throw new Error('Admin session unavailable');
  const response = await fetch(`${API_BASE}/admin/user-activity`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Admin activity failed (${response.status})`);
  const body = (await response.json()) as Partial<AdminUserActivity>;
  return {
    asOf: typeof body.asOf === 'string' ? body.asOf : new Date().toISOString(),
    totalUsers: Number(body.totalUsers) || 0,
    newUsers24h: Number(body.newUsers24h) || 0,
    pendingKyc: Number(body.pendingKyc) || 0,
    pendingDeposits: Array.isArray(body.pendingDeposits) ? body.pendingDeposits : [],
  };
}

/** Re-read cadence while the Users page is on screen. */
export const ADMIN_ACTIVITY_POLL_MS = 25_000;

const visible = () => document.visibilityState === 'visible';

/**
 * The Users page's only timer: the compact activity read, every
 * ADMIN_ACTIVITY_POLL_MS while the tab is visible. A hidden tab schedules
 * nothing; coming back reads immediately and resumes the cadence. Overlapping
 * reads collapse into one. Nothing global — it lives and dies with the page.
 */
export function useAdminUserActivity(load: (signal?: AbortSignal) => Promise<AdminUserActivity> = getAdminUserActivity) {
  const [activity, setActivity] = useState<AdminUserActivity | null>(null);
  const [failed, setFailed] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const refresh = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    const work = load()
      .then((next) => { if (alive.current) { setActivity(next); setFailed(false); } })
      .catch(() => { if (alive.current) setFailed(true); })
      .finally(() => { running.current = null; });
    running.current = work;
    return work;
  }, [load]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const schedule = () => {
      stop();
      if (!alive.current || !visible()) return;
      timer = setTimeout(() => { void refresh().then(schedule); }, ADMIN_ACTIVITY_POLL_MS);
    };
    const onVisibility = () => {
      if (visible()) void refresh().then(schedule);
      else stop();
    };
    void refresh().then(schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { activity, failed, refresh };
}
