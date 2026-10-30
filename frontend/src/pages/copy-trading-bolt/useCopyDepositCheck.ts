import { useEffect, useRef, useState } from 'react';
import { api, getToken, onSessionChange } from '../../lib/api';
import type { CopyDepositCheck } from './CopyEligibilityContext';

type Reading = Pick<CopyDepositCheck, 'status' | 'depositUsd' | 'requestId'> & { session: string | null };

function latestDeposit(response: unknown): number | null {
  const points = (response as { points?: unknown } | null)?.points;
  if (!Array.isArray(points) || points.length === 0) return null;
  const raw = points[points.length - 1]?.totalValueUsd;
  // Do not let Number(null), Number('') or Number(false) turn unknown into 0.
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw))) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** One existing portfolio read per visit/session, plus an explicit retry.
 * The amount is never shared between sessions or inferred from a failed read. */
export function useCopyDepositCheck(): CopyDepositCheck {
  const requestId = useRef(0);
  const retry = useRef<() => void>(() => {});
  const [reading, setReading] = useState<Reading>({ session: null, requestId: 0, status: 'loading', depositUsd: null });

  useEffect(() => {
    let alive = true;
    let pending = false;
    let currentSession: string | null = null;
    const load = () => {
      const session = getToken();
      if (pending && session === currentSession) return;
      currentSession = session;
      pending = session !== null;
      const id = ++requestId.current;
      setReading({ session, requestId: id, status: session ? 'loading' : 'unavailable', depositUsd: null });
      if (!session) return;
      const current = () => alive && id === requestId.current && getToken() === session;
      void (async () => {
        try {
          const response = await api.getPortfolioHistory('90d');
          if (!current()) return;
          pending = false;
          const depositUsd = latestDeposit(response);
          setReading({ session, requestId: id, status: depositUsd === null ? 'unavailable' : 'ready', depositUsd });
        } catch {
          if (!current()) return;
          pending = false;
          setReading({ session, requestId: id, status: 'unavailable', depositUsd: null });
        }
      })();
    };
    retry.current = load;
    const unsubscribe = onSessionChange(load);
    load();
    return () => { alive = false; ++requestId.current; retry.current = () => {}; unsubscribe(); };
  }, []);

  const current = () => reading.requestId === requestId.current && reading.session !== null && getToken() === reading.session;
  const status = reading.session === getToken() ? reading.status : getToken() ? 'loading' : 'unavailable';
  return {
    status, depositUsd: status === 'ready' ? reading.depositUsd : null, requestId: reading.requestId,
    retry: () => retry.current(),
    // Also fence a click delivered before React commits the session reset.
    isCurrent: () => reading.status === 'ready' && current(),
  };
}
