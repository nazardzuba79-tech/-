export const NRX_EDGE_BASE = 'https://market.voltextech.net';
export const isNrxPair = (pair: string) => pair.toUpperCase() === 'NRX/USDT';

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
