import { browserFetch as fetch } from './browserActivity';
import { MARKET_EDGE_BASE } from './marketEdge';
import { isManagedListingPair } from './testMarkets';

export const NRX_EDGE_BASE = MARKET_EDGE_BASE;
export const isNrxPair = (pair: string) => pair.toUpperCase() === 'NRX/USDT';
/** Served entirely by the market edge (no Render or venue fallback): NRX and every published managed listing. */
export const isEdgeMarketPair = (pair: string) => isNrxPair(pair) || isManagedListingPair(pair);

/** True when a test-market URL is served by the market edge: NRX, the listings catalogue, or a published managed listing. */
export function isEdgeMarketUrl(url: string): boolean {
  if (url.toUpperCase().includes('NRX') || url.startsWith(`${NRX_EDGE_BASE}/`)) return true;
  const slug = /\/([A-Z0-9]+)-USDT(?:[/?]|$)/i.exec(url);
  return slug !== null && isManagedListingPair(`${slug[1].toUpperCase()}/USDT`);
}

export function nrxListingTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const time = (timeZone: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  return `${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date)} · ${time('UTC')} UTC / ${time('Europe/Moscow')} МСК`;
}

/** No Render/venue fallback, including development and edge outages. */
export function nrxPublicUrl(input: string): string {
  const url = new URL(input, NRX_EDGE_BASE);
  url.pathname = url.pathname.replace(/^\/api\/v1(?=\/)/, '');
  return `${NRX_EDGE_BASE}${url.pathname}${url.search}`;
}

export async function fetchNrxPublic<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(nrxPublicUrl(path), { signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`market_http_${response.status}`);
  return response.json();
}
