import { useEffect, useState } from 'react';
import { catalogueStore } from './catalogueStore';
import { change7dBySymbol } from './change7d';

/**
 * Seven-day returns by symbol from the shared catalogue (see lib/change7d
 * for which assets may contribute one). Subscribes while `enabled`; the
 * catalogue store makes one ref-counted request per tab, so this adds no
 * request of its own and no timer.
 */
export function useChange7d(enabled = true): ReadonlyMap<string, number> {
  const [values, setValues] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    if (!enabled) return;
    return catalogueStore.subscribe(state => setValues(change7dBySymbol(state.assets)));
  }, [enabled]);
  return values;
}
