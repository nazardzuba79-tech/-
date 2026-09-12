import { useEffect, useState } from 'react';

export interface HomeCommodityReference {
  price: number;
  observedAt: number;
  source: 'gold-api' | 'eia';
  label: string;
}

interface CommodityState {
  gold: HomeCommodityReference | null;
  oil: HomeCommodityReference | null;
}

// The backend owns provider access/cache so browsers do not fan out directly
// to third-party market sources. These are display-only references: they never
// enter CFD execution, balances, margin, liquidation or accounting.
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
const POLL_MS = 60_000;
const GOLD_MAX_AGE_MS = 20 * 60_000;
const OIL_MAX_AGE_MS = 10 * 24 * 60 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;

function finitePositive(value: unknown): number | null {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseReference(value: unknown, kind: 'gold' | 'oil', now = Date.now()): HomeCommodityReference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const price = finitePositive(raw.price);
  const observedAt = typeof raw.observedAt === 'number' && Number.isFinite(raw.observedAt) ? raw.observedAt : null;
  const expectedSource = kind === 'gold' ? 'gold-api' : 'eia';
  const maxAge = kind === 'gold' ? GOLD_MAX_AGE_MS : OIL_MAX_AGE_MS;
  if (price === null || observedAt === null || raw.source !== expectedSource || typeof raw.label !== 'string'
    || observedAt > now + FUTURE_SKEW_MS || now - observedAt > maxAge) return null;
  return { price, observedAt, source: expectedSource, label: raw.label };
}

function keepIfFresh(value: HomeCommodityReference | null, kind: 'gold' | 'oil', now: number) {
  return parseReference(value, kind, now);
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
        const response = await fetch(`${API_BASE}/market/home-commodities`, {
          signal: AbortSignal.timeout(8_000),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Commodity references HTTP ${response.status}`);
        const payload = await response.json() as Record<string, unknown>;
        if (cancelled) return;
        setState({
          gold: parseReference(payload.gold, 'gold', now),
          oil: parseReference(payload.oil, 'oil', now),
        });
      } catch {
        if (!cancelled) {
          setState(previous => ({
            gold: keepIfFresh(previous.gold, 'gold', now),
            oil: keepIfFresh(previous.oil, 'oil', now),
          }));
        }
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
