import { isRetiredNrx } from '../../shared/nrxRetirement';

const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

/** Edge-compatible, on-demand presentation. No IO, DB, timers or executable orders.
 * The production Worker never supplies a clock override or accepts a client clock.
 */
export function nrxPublicResponse(request: Request, _clock: () => number = Date.now): Response | null {
  const url = new URL(request.url);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Reserved malformed NRX stays retired. */ }
  const reservedPath = path.split('/').some(segment => segment && isRetiredNrx(segment));
  const reservedQuery = ['pair', 'symbol'].some(name => { const value = url.searchParams.get(name); return value !== null && isRetiredNrx(value); });
  if (!reservedPath && !reservedQuery) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const status = ['GET', 'HEAD'].includes(request.method) ? 410 : 405;
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    error: status === 410 ? 'market_retired' : 'method_not_allowed', symbol: 'NRX',
  }), { status, headers });
}
