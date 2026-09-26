import { useEffect, useState, useMemo, useContext } from 'react';
import { futuresAccountStore, type FuturesAccountState, type ResourceKey } from './futuresAccountStore';
import { FuturesAccountSourceContext } from './futuresAccountSource';

/**
 * Read authenticated Futures account state from the one shared store.
 *
 * `wants` declares which resources this component needs kept fresh and how
 * fast, subject to the store's state-dependent read budget. Histories use
 * zero: fetch on activation/invalidation, never a recurring timer.
 *
 *   const { positions } = useFuturesAccount({ positions: 10_000 });
 *
 * A resource left out of `wants` is still readable; this component just
 * does not keep a timer alive for it.
 */
export function useFuturesAccount(wants: Partial<Record<ResourceKey, number>>): FuturesAccountState {
  /**
   * An account whose terminal is backed by something other than the real
   * futures endpoints supplies its own state through this context (see
   * lib/futuresExecution). It is read FIRST and the store is then not
   * subscribed to at all, so the real endpoints are never polled for such
   * an account — not merely ignored after the fact.
   *
   * `null`, which is what every ordinary account sees, leaves this hook
   * exactly as it was.
   */
  const override = useContext(FuturesAccountSourceContext);
  const [state, setState] = useState<FuturesAccountState>(() => futuresAccountStore.getState());

  // The caller writes `{ positions: 4000 }` inline, so identity changes on
  // every render; the cadences themselves almost never do. Keying on the
  // serialized value stops a re-render from resubscribing (and re-timing)
  // the store on every paint.
  const key = JSON.stringify(wants);

  const stable = useMemo(() => JSON.parse(key) as Partial<Record<ResourceKey, number>>, [key]);

  useEffect(() => {
    if (override) return;
    return futuresAccountStore.subscribe(setState, stable);
  }, [stable, override]);

  return override ?? state;
}

/** Refresh account resources now — call after an action that really did
 *  change the account (order placed or cancelled, position closed,
 *  transfer completed). */
export function refreshFuturesAccount(resources?: ResourceKey[]): void {
  futuresAccountStore.invalidate(resources);
}
