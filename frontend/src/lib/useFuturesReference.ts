import { useEffect, useState } from 'react';
import { directFuturesReferenceStore } from './directFuturesReference';

/**
 * Bulk reference rows refresh slowly. The currently selected contract is
 * overlaid automatically from ticker frames already carried by the direct
 * depth/trades WebSocket.
 */
export function useFuturesReference() {
  const [rows, setRows] = useState(directFuturesReferenceStore.getState);
  useEffect(() => directFuturesReferenceStore.subscribe(setRows), []);
  return rows;
}
