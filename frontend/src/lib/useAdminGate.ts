import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, onSessionChange } from './api';

type Me = Awaited<ReturnType<typeof api.getMe>>;

/** Why access is refused. Only these two ever lead away from /admin. */
export type AdminDeniedReason = 'NO_SESSION' | 'FORBIDDEN';
/** A check that could not finish. Never read as "not an administrator". */
export type AdminCheckError = 'TIMEOUT' | 'NETWORK' | 'SERVER';

export type AdminGate =
  | { status: 'checking'; me: null; slow: boolean; retry: () => void }
  | { status: 'denied'; me: null; reason: AdminDeniedReason; retry: () => void }
  | { status: 'error'; me: null; reason: AdminCheckError; retry: () => void }
  | { status: 'ok'; me: Me; retry: () => void };

/** A /me that has not answered by now is abandoned and reported, not waited on forever. */
export const ADMIN_GATE_TIMEOUT_MS = 15_000;
/** After this long the checking screen says so, before the timeout gives up. */
export const ADMIN_GATE_SLOW_MS = 5_000;

type Outcome =
  | { status: 'denied'; reason: AdminDeniedReason }
  | { status: 'error'; reason: AdminCheckError }
  | { status: 'ok'; me: Me };

/** 401/403 are answers about the session; anything else is a failure to get an answer. */
export function classifyAdminCheckFailure(error: unknown, timedOut: boolean): Outcome {
  if (timedOut) return { status: 'error', reason: 'TIMEOUT' };
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null;
  if (status === 401) return { status: 'denied', reason: 'NO_SESSION' };
  if (status === 403) return { status: 'denied', reason: 'FORBIDDEN' };
  if (status !== null) return { status: 'error', reason: 'SERVER' };
  return { status: 'error', reason: 'NETWORK' };
}

/**
 * The single admin gate the client side has.
 *
 * This is a UX convenience only — it decides what to render, nothing more.
 * Every privileged request is independently re-checked for role ADMIN on
 * the server (see the requireAdmin middleware), and the check here is
 * against `role` as reported by GET /me, never against an email address or
 * a user id: the backend is the only place an identity is ever compared.
 *
 * Four outcomes, kept apart on purpose:
 * - checking: /me is in flight. Nothing private is rendered and no admin
 *   request runs (the admin pages mount only on `ok`).
 * - ok: the server reported an administrator.
 * - denied: no session, 401, 403, or a non-admin account.
 * - error: 5xx, network failure, malformed answer, or no answer within
 *   ADMIN_GATE_TIMEOUT_MS. A temporary outage is not a refusal: the caller
 *   shows it with a retry instead of sending an administrator away.
 *
 * `retry` runs one new check; a check already in flight is not duplicated.
 * A session change (sign-in, sign-out, another account) re-checks from scratch.
 */
export function useAdminGate(timeoutMs = ADMIN_GATE_TIMEOUT_MS): AdminGate {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [slow, setSlow] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const check = useCallback(() => {
    if (inFlight.current) return () => {};
    const epoch = ++generation.current;
    setOutcome(null);
    setSlow(false);
    const token = getToken();
    if (!token) {
      setOutcome({ status: 'denied', reason: 'NO_SESSION' });
      return () => {};
    }
    inFlight.current = true;
    const controller = new AbortController();
    let timedOut = false;
    const slowTimer = setTimeout(() => { if (generation.current === epoch) setSlow(true); }, Math.min(ADMIN_GATE_SLOW_MS, timeoutMs));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const settle = (next: Outcome) => {
      clearTimeout(slowTimer); clearTimeout(timeout);
      inFlight.current = false;
      // A newer check or another session owns the screen now.
      if (generation.current !== epoch || getToken() !== token) return;
      setOutcome(next);
    };
    api.getMe(controller.signal)
      .then((data) => {
        if (!data || typeof data !== 'object' || typeof data.isAdmin !== 'boolean') settle({ status: 'error', reason: 'SERVER' });
        else settle(data.isAdmin ? { status: 'ok', me: data } : { status: 'denied', reason: 'FORBIDDEN' });
      })
      .catch((error) => settle(classifyAdminCheckFailure(error, timedOut)));
    return () => { generation.current++; controller.abort(); clearTimeout(slowTimer); clearTimeout(timeout); inFlight.current = false; };
  }, [timeoutMs]);

  useEffect(() => {
    let cancel = check();
    const off = onSessionChange(() => { cancel(); cancel = check(); });
    return () => { off(); cancel(); };
  }, [check]);

  const retry = useCallback(() => { check(); }, [check]);

  if (outcome === null) return { status: 'checking', me: null, slow, retry };
  if (outcome.status === 'ok') return { status: 'ok', me: outcome.me, retry };
  return { ...outcome, me: null, retry };
}
