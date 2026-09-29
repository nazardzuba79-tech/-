/**
 * The public market-data edge (Cloudflare Worker `voltex-market-edge`).
 *
 * Production and every ordinary build use https://market.voltextech.net. A
 * build may point elsewhere with VITE_MARKET_EDGE_URL (a build-time constant, see
 * vite.config) — accepted only as an
 * https origin, or a loopback http origin for a local test Worker — so a test
 * environment can serve listings from its own store without touching
 * production. Anything else falls back to the default.
 */
const DEFAULT_MARKET_EDGE_BASE = 'https://market.voltextech.net';
/** Replaced by vite.config `define`; undeclared (typeof → 'undefined') under Jest. */
declare const __VOLTEX_MARKET_EDGE_URL__: string | undefined;

export function resolveMarketEdgeBase(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_MARKET_EDGE_BASE;
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(trimmed) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(trimmed)
    ? trimmed : DEFAULT_MARKET_EDGE_BASE;
}

export const MARKET_EDGE_BASE = resolveMarketEdgeBase(typeof __VOLTEX_MARKET_EDGE_URL__ === 'string' && __VOLTEX_MARKET_EDGE_URL__ ? __VOLTEX_MARKET_EDGE_URL__ : undefined);
