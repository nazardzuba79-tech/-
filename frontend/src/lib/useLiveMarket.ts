import { useEffect, useState } from 'react';
import { LiveMarketStore } from './liveMarketStore';
const base = import.meta.env.VITE_API_URL || '/api/v1';
// Warm-cache is browser-local only. The EventSource still opens immediately,
// so this improves first paint without adding or delaying any API request.
export const liveMarketStore = new LiveMarketStore(() => new EventSource(`${base}/market/live`), true);
export function useLiveMarket() {
  const [state, setState] = useState(liveMarketStore.getState);
  useEffect(() => liveMarketStore.subscribe(setState), []);
  return state;
}
