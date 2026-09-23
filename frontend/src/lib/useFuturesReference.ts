import { useEffect, useState } from 'react';
import { directFuturesReferenceStore } from './directFuturesReference';

/**
 * Public Futures reference prices come from Bybit directly in the visitor's
 * browser. If that path is unavailable, the store falls back to the public
 * Cloudflare market edge. Render and Neon are not in this display path.
 */
export function useFuturesReference() {
  const [rows, setRows] = useState(directFuturesReferenceStore.getState);
  useEffect(() => directFuturesReferenceStore.subscribe(setRows), []);
  return rows;
}
