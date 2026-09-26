import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, getToken } from '../../lib/api';

/** One user's deposit package summary (one asset, one network): the sum of
 * their network-confirmed, uncredited transfers. Server record, never edited here. */
export interface AdminDepositPackage {
  key: string;
  userId: string;
  chain: string;
  asset: string;
  /** AWAITING_TOPUP: below the minimum; READY: reviewable; NEEDS_REVIEW: cannot be valued. */
  state: 'AWAITING_TOPUP' | 'READY' | 'NEEDS_REVIEW';
  total: string;
  transferCount: number;
  unconfirmedTotal: string;
  unconfirmedCount: number;
  remaining: string | null;
  remainingUsd: string | null;
  minimumReached: boolean;
  latestAt: string;
}

export interface AdminUserActivity {
  asOf: string;
  totalUsers: number;
  newUsers24h: number;
  pendingKyc: number;
  minDepositUsd: number;
  packages: AdminDepositPackage[];
  /** Exact registry counts by state (not a list length). */
  counts: { UNATTRIBUTED: number; AWAITING_CONFIRMATIONS: number; AWAITING_TOPUP: number; READY: number; NEEDS_REVIEW: number };
  awaitingConfirmationsByUser: Record<string, number>;
}

/** One small read: counts + deposit packages (GET /admin/user-activity). No history. */
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
  const counts = body.counts ?? ({} as Partial<AdminUserActivity['counts']>);
  return {
    asOf: typeof body.asOf === 'string' ? body.asOf : new Date().toISOString(),
    totalUsers: Number(body.totalUsers) || 0,
    newUsers24h: Number(body.newUsers24h) || 0,
    pendingKyc: Number(body.pendingKyc) || 0,
    minDepositUsd: Number(body.minDepositUsd) || 300,
    packages: Array.isArray(body.packages) ? body.packages : [],
    counts: {
      UNATTRIBUTED: Number(counts.UNATTRIBUTED) || 0,
      AWAITING_CONFIRMATIONS: Number(counts.AWAITING_CONFIRMATIONS) || 0,
      AWAITING_TOPUP: Number(counts.AWAITING_TOPUP) || 0,
      READY: Number(counts.READY) || 0,
      NEEDS_REVIEW: Number(counts.NEEDS_REVIEW) || 0,
    },
    awaitingConfirmationsByUser: body.awaitingConfirmationsByUser && typeof body.awaitingConfirmationsByUser === 'object' ? body.awaitingConfirmationsByUser : {},
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
