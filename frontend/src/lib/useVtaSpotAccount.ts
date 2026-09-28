import { useState } from 'react';
import { api, type VtaDemoSnapshot } from './api';
import { useVisibleAccountRead } from './useVisibleAccountRead';

/** Private ledger data, presented through the existing Spot components.
 * It never changes deposit, withdrawal or real-ledger availability. */
export function useVtaSpotAccount(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<VtaDemoSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const refresh = useVisibleAccountRead({
    load: async () => {
      if (!enabled) return null;
      const me = await api.getMe();
      return me.isAdmin ? api.getVtaDemo() : null;
    },
    accept: value => { setSnapshot(value); setFailed(false); setLoading(false); },
    reset: () => { setSnapshot(null); setFailed(false); setLoading(enabled); },
    fail: () => { setSnapshot(null); setFailed(true); setLoading(false); },
    staleMs: 30_000,
    poll: false,
  });
  return { snapshot: enabled ? snapshot : null, failed, loading, refresh };
}
