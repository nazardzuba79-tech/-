import { useEffect, useState } from 'react';

export interface HomeCommodityReference {
  price: number;
  updatedAt: number;
  source: 'gold-api' | 'croncopia';
  label: string;
}

interface CommodityState {
  gold: HomeCommodityReference | null;
  oil: HomeCommodityReference | null;
}

// Homepage/reference display only. These values are deliberately isolated from
// CFD execution, margin, liquidation and accounting. Gold API explicitly
// supports website use without authentication; Croncopia publishes public-domain
// commodity snapshots without keys. Unknown/stale values stay unavailable.
const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const OIL_URL = 'https://croncopia.com/api/energy/brent_crude.json';
const POLL_MS = 60_000;
const GOLD_MAX_AGE_MS = 15 * 60_000;
const OIL_MAX_AGE_MS = 4 * 60 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;

function finitePositive(value: unknown): number | null {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsedTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function fresh(time: number, maxAgeMs: number, now: number): boolean {
  return time <= now + FUTURE_SKEW_MS && now - time <= maxAgeMs;
}

export function parseGoldReference(payload: unknown, now = Date.now()): HomeCommodityReference | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const price = finitePositive(raw.price);
  const updatedAt = parsedTime(raw.updatedAt);
  if (price === null || updatedAt === null || !fresh(updatedAt, GOLD_MAX_AGE_MS, now)) return null;
  return { price, updatedAt, source: 'gold-api', label: 'XAU/USD' };
}

export function parseOilReference(payload: unknown, now = Date.now()): HomeCommodityReference | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const price = finitePositive(raw.price);
  const updatedAt = parsedTime(raw.timestamp);
  const sources = finitePositive(raw.sources);
  if (price === null || updatedAt === null || sources === null || raw.base !== 'USD' || !fresh(updatedAt, OIL_MAX_AGE_MS, now)) return null;
  return { price, updatedAt, source: 'croncopia', label: 'Brent · USD/bbl' };
}

function stillFresh(value: HomeCommodityReference | null, maxAgeMs: number, now: number): HomeCommodityReference | null {
  return value && fresh(value.updatedAt, maxAgeMs, now) ? value : null;
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Reference provider HTTP ${response.status}`);
  return response.json();
}

export function useHomeCommodityReferences(): CommodityState {
  const [state, setState] = useState<CommodityState>({ gold: null, oil: null });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      const now = Date.now();
      try {
        const [goldResult, oilResult] = await Promise.allSettled([json(GOLD_URL), json(OIL_URL)]);
        if (cancelled) return;
        setState(previous => ({
          gold: goldResult.status === 'fulfilled'
            ? parseGoldReference(goldResult.value, now) ?? stillFresh(previous.gold, GOLD_MAX_AGE_MS, now)
            : stillFresh(previous.gold, GOLD_MAX_AGE_MS, now),
          oil: oilResult.status === 'fulfilled'
            ? parseOilReference(oilResult.value, now) ?? stillFresh(previous.oil, OIL_MAX_AGE_MS, now)
            : stillFresh(previous.oil, OIL_MAX_AGE_MS, now),
        }));
      } finally {
        inFlight = false;
      }
    };

    void load();
    const poll = window.setInterval(() => { void load(); }, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  return state;
}
