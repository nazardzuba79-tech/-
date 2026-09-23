import { useEffect, useState } from 'react';
import { directFuturesReferenceStore } from './directFuturesReference';

/**
 * Bulk reference rows refresh slowly; the focused contract is overlaid from
 * the same direct Bybit WebSocket used by depth/trades.
 */
export function useFuturesReference(focusedPair?:string) {
  const [rows, setRows] = useState(directFuturesReferenceStore.getState);
  useEffect(() => directFuturesReferenceStore.subscribe(setRows), []);
  useEffect(() => {
    directFuturesReferenceStore.focus(focusedPair ?? null);
    return () => directFuturesReferenceStore.focus(null);
  }, [focusedPair]);
  return rows;
}
