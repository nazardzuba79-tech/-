import { browserFetch as fetch } from '../../lib/browserActivity';
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

/** A read that has not answered by now is abandoned and reported as failed. */
export const ADMIN_ACTIVITY_TIMEOUT_MS = 20_000;

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * One small read: counts + deposit packages (GET /admin/user-activity). No history.
 * An answer without the counts is rejected, never filled in with zeros: the
 * page must not claim "no deposits" about numbers it does not have.
 */
export async function getAdminUserActivity(signal?: AbortSignal): Promise<AdminUserActivity> {
  const token = getToken();
  if (!token) throw new Error('Admin session unavailable');
  const response = await fetch(`${API_BASE}/admin/user-activity`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Admin activity failed (${response.status})`);
  const body = (await response.json()) as Partial<AdminUserActivity> | null;
  const counts = (body?.counts ?? null) as Partial<Record<keyof AdminUserActivity['counts'], unknown>> | null;
  const totalUsers = count(body?.totalUsers), newUsers24h = count(body?.newUsers24h), pendingKyc = count(body?.pendingKyc);
  const states = ['UNATTRIBUTED', 'AWAITING_CONFIRMATIONS', 'AWAITING_TOPUP', 'READY', 'NEEDS_REVIEW'] as const;
  const stateCounts = states.map((key) => count(counts?.[key]));
  if (!body || totalUsers === null || newUsers24h === null || pendingKyc === null || !Array.isArray(body.packages) || stateCounts.some((n) => n === null)) {
    throw new Error('Admin activity answer is incomplete');
  }
  const [UNATTRIBUTED, AWAITING_CONFIRMATIONS, AWAITING_TOPUP, READY, NEEDS_REVIEW] = stateCounts as number[];
  return {
    asOf: typeof body.asOf === 'string' ? body.asOf : new Date().toISOString(),
    totalUsers,
    newUsers24h,
    pendingKyc,
    minDepositUsd: Number(body.minDepositUsd) || 300,
    packages: body.packages,
    counts: { UNATTRIBUTED, AWAITING_CONFIRMATIONS, AWAITING_TOPUP, READY, NEEDS_REVIEW },
    awaitingConfirmationsByUser: body.awaitingConfirmationsByUser && typeof body.awaitingConfirmationsByUser === 'object' ? body.awaitingConfirmationsByUser : {},
  };
}

/** Re-read cadence while the Users page is on screen. */
export const ADMIN_ACTIVITY_POLL_MS = 60 * 60_000;

/**
 * The Users page's only timer: the compact activity read, every
 * ADMIN_ACTIVITY_POLL_MS while the tab is visible. A hidden tab schedules
 * nothing; coming back reads only stale data. A mutation during a read queues
 * one follow-up; a read already in flight is shared, never duplicated.
 * Nothing global — it lives and dies with the page.
 *
 * `failed` means the latest read did not succeed. With `activity === null`
 * nothing is known yet; with data present, that data is the last good answer
 * (from `receivedAt`) and is kept, not cleared.
 */
export function useAdminUserActivity(
  load: (signal?: AbortSignal) => Promise<AdminUserActivity> = getAdminUserActivity,
  timeoutMs = ADMIN_ACTIVITY_TIMEOUT_MS,
) {
  const [activity, setActivity] = useState<AdminUserActivity | null>(null);
  const [failed, setFailed] = useState(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const refresh = useVisibleAccountRead({
    load: () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return load(controller.signal).finally(() => clearTimeout(timer));
    },
    staleMs: ADMIN_ACTIVITY_POLL_MS, poll: true,
    accept: next => { setActivity(next); setFailed(false); setReceivedAt(Date.now()); },
    fail: () => setFailed(true),
    reset: () => { setActivity(null); setFailed(false); setReceivedAt(null); },
  });

  return { activity, failed, receivedAt, refresh };
}
