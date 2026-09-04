import { useCallback, useEffect, useState } from 'react';
import { clearToken, getToken } from '../../lib/api';

type Section<T> = ({ available: true } & T) | { available: false; reason: string };
export interface AnalyticsSnapshot {
  generatedAt: number;
  sections: {
    marketOverview: Section<{totalMarketCapUsd:number; totalVolume24hUsd:number; btcDominancePercent:number|null; ethDominancePercent:number|null; marketCapChangePercent24h:number|null; source:string}>;
    sentiment: Section<{value:number; classification:string; updatedAt:number; source:string}>;
    openInterest: Section<{scope:'venue'; contracts:{symbol:string; openInterestBase:string; openInterestUsd:string|null}[]; source:string}>;
    funding: Section<{intervalHours:number; latest:{symbol:string; rate:string; appliedAt:number}[]; source:string}>;
    markPrices: Section<{contracts:{symbol:string; markPrice:string; indexPrice:string}[]; source:string}>;
  };
}

/** Called only after the existing admin gate admits this page. */
export function useAnalyticsSnapshot() {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setSnapshot(null);
    fetch(`${import.meta.env.VITE_API_URL || '/api/v1'}/analytics/overview`, {
      headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal,
    }).then(async response => {
      if (response.status === 401) { clearToken(); window.location.assign('/login?next=%2Fanalytics'); }
      if (response.status === 403) window.location.assign('/');
      if (!response.ok) throw new Error('Analytics unavailable');
      return response.json() as Promise<AnalyticsSnapshot>;
    }).then(data => {
      if (!controller.signal.aborted) { setSnapshot(data); setState('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [attempt]);
  return {snapshot, state, retry};
}
