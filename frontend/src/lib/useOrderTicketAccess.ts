import { useEffect, useState } from 'react';
import { request, getToken, onSessionChange } from './api';

/** Presentation capability only. Every execution endpoint independently checks
 * the current session and the server's two pinned identities. Never persisted. */
export function useOrderTicketAccess() {
  const [session, setSession] = useState(getToken);
  const [verdict, setVerdict] = useState<{ token: string; allowed: boolean } | null>(null);
  useEffect(() => onSessionChange(() => { setVerdict(null); setSession(getToken()); }), []);
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let generation = 0;
    const check = async () => {
      const requestGeneration = ++generation;
      try {
        const access = await request<{ allowed: boolean }>('/orders/access');
        if (!disposed && requestGeneration === generation && getToken() === session) setVerdict({ token: session, allowed: access.allowed === true });
      } catch {
        if (!disposed && requestGeneration === generation) setVerdict(null);
      }
    };
    void check();
    const refresh = () => { setVerdict(null); void check(); };
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener('focus', refresh); };
  }, [session]);
  const canSubmit = () => !!verdict?.allowed && verdict.token === getToken();
  return { allowed: canSubmit(), canSubmit };
}
