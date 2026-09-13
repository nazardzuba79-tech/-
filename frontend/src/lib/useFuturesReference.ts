import { useMemo } from 'react';
import { useLiveMarket } from './useLiveMarket';
import { futuresReferenceRows } from './futuresReference';

/** One existing shared stream; never used to price a financial write. */
export function useFuturesReference() {
  const state = useLiveMarket();
  return useMemo(() => futuresReferenceRows(state), [state]);
}
