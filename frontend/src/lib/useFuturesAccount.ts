import { useEffect, useState, useMemo } from 'react';
import { futuresAccountStore, type FuturesAccountState, type ResourceKey } from './futuresAccountStore';

/**
 * Read authenticated Futures account state from the one shared store.
 *
 * `wants` declares which resources this component needs kept fresh and how
 * fast — the store polls each at the fastest cadence any live subscriber
 * asked for, so passing the cadence the component used to use in its own
 * `setInterval` preserves exactly the freshness it had.
 *
 *   const { positions, balances } = useFuturesAccount({ positions: 4000 });
 *
 * A resource left out of `wants` is still readable; this component just
 * does not keep a timer alive for it.
 */
export function useFuturesAccount(wants: Partial<Record<ResourceKey, number>>): FuturesAccountState {
  const [state, setState] = useState<FuturesAccountState>(() => futuresAccountStore.getState());

  // The caller writes `{ positions: 4000 }` inline, so identity changes on
  // every render; the cadences themselves almost never do. Keying on the
  // serialized value stops a re-render from resubscribing (and re-timing)
  // the store on every paint.
  const key = JSON.stringify(wants);

  const stable = useMemo(() => JSON.parse(key) as Partial<Record<ResourceKey, number>>, [key]);

  useEffect(() => futuresAccountStore.subscribe(setState, stable), [stable]);

  return state;
}

/** Refresh account resources now — call after an action that really did
 *  change the account (order placed or cancelled, position closed,
 *  transfer completed). */
export function refreshFuturesAccount(resources?: ResourceKey[]): void {
  futuresAccountStore.invalidate(resources);
}
