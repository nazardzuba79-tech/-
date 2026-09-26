import { useState } from 'react';
import { useVisibleAccountRead } from '../../lib/useVisibleAccountRead';
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
export const ADMIN_ACTIVITY_POLL_MS = 60 * 60_000;

/**
 * The Users page's only timer: the compact activity read, every
 * ADMIN_ACTIVITY_POLL_MS while the tab is visible. A hidden tab schedules
 * nothing; coming back reads only stale data. A mutation during a read queues
 * one follow-up. Nothing global — it lives and dies with the page.
 */
export function useAdminUserActivity(load: (signal?: AbortSignal) => Promise<AdminUserActivity> = getAdminUserActivity) {
  const [activity, setActivity] = useState<AdminUserActivity | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useVisibleAccountRead({
    load, staleMs: ADMIN_ACTIVITY_POLL_MS, poll: true,
    accept: next => { setActivity(next); setFailed(false); },
    fail: () => setFailed(true),
    reset: () => { setActivity(null); setFailed(false); },
  });

  return { activity, failed, refresh };
}
