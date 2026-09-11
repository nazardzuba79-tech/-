import { useEffect, useState } from 'react';
import { LiveMarketStore } from './liveMarketStore';
const base = import.meta.env.VITE_API_URL || '/api/v1';
export const liveMarketStore = new LiveMarketStore(() => new EventSource(`${base}/market/live`));
export function useLiveMarket() {
  const [state, setState] = useState(liveMarketStore.getState);
  useEffect(() => liveMarketStore.subscribe(setState), []);
  return state;
}
