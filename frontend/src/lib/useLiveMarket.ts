import { useEffect, useState } from 'react';
import { LiveMarketStore } from './liveMarketStore';
import { SampledMarketSource } from './displaySnapshotCache';
const apiBase = import.meta.env.VITE_API_URL || '/api/v1';
const displayBase = typeof window !== 'undefined' && window.location && (window.location.hostname === 'voltextech.net' || window.location.hostname.endsWith('.voltextech.net')) ? 'https://market.voltextech.net' : apiBase;
// Warm-cache is browser-local only. The EventSource still opens immediately,
// so this improves first paint without adding or delaying any API request.
export const liveMarketStore = new LiveMarketStore(() => new SampledMarketSource(`${displayBase}/market/display`), true, { watchdogMs: 90_000, retryFloorMs: 60_000 });
export function useLiveMarket() {
  const [state, setState] = useState(liveMarketStore.getState);
  useEffect(() => liveMarketStore.subscribe(setState), []);
  return state;
}
