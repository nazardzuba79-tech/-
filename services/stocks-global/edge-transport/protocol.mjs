// Shared, dependency-free wire contract. Never contains deployment credentials.
export const PREFIX = '/__stocks_global/';
export const PROOF = 'x-voltex-stocks-edge-';
export const READS = new Map([['catalogue', []], ['state', ['id']], ['portfolio', []], ['history', ['id', 'interval', 'before']], ['lease', ['id']]]);
export const FINANCIAL = new Set(['orders', 'cancel', 'balances', 'refresh']);
export const FORWARD = ['authorization', 'x-stocks-token', 'x-stocks-view'];
export function reject(code, status = 403) { throw Object.assign(new Error(code), { code, status }); }
export function origin(value) {
  let url; try { url = new URL(value); } catch { reject('STOCKS_EDGE_CONFIG_INVALID', 503); }
  if (url.protocol !== 'https:' || value !== url.origin || url.username || url.password || url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) reject('STOCKS_EDGE_CONFIG_INVALID', 503);
  return url;
}
export function route(raw, method) {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\\#\r\n]/.test(raw) || !raw.startsWith(PREFIX)) reject('ROUTE_NOT_FOUND', 404);
  const url = new URL(raw, 'https://unused.invalid');
  if (url.pathname + url.search !== raw || url.pathname.includes('%')) reject('ROUTE_NOT_FOUND', 404);
  const name = url.pathname.slice(PREFIX.length);
  if (FINANCIAL.has(name)) reject('ACCOUNT_TRADING_DISABLED');
  if (!READS.has(name) || method !== (name === 'lease' ? 'DELETE' : 'GET')) reject('ROUTE_NOT_FOUND', 404);
  const keys = [...url.searchParams.keys()];
  if (keys.some(k => !READS.get(name).includes(k)) || new Set(keys).size !== keys.length || /%0[0ad]/i.test(url.search)) reject('ROUTE_NOT_FOUND', 404);
  return raw;
}
export function validateBrowser(request, publicUrl) {
  const url = new URL(request.url), headers = request.headers;
  if (url.origin !== publicUrl.origin || headers.has('host') && headers.get('host') !== publicUrl.host) reject('HOST_FORBIDDEN');
  const supplied = headers.get('origin');
  if (supplied !== null && supplied !== publicUrl.origin || request.method !== 'GET' && supplied !== publicUrl.origin) reject('ORIGIN_FORBIDDEN');
  const site = headers.get('sec-fetch-site');
  if (site !== null && !['same-origin', 'none'].includes(site)) reject('ORIGIN_FORBIDDEN');
  // Cloudflare can insert X-Forwarded-For/Proto. Neither is an identity input;
  // they are discarded along with CF-* and Cookie. Other forwarding/proof
  // headers are never valid browser input.
  for (const key of headers.keys()) if (key === 'forwarded' || key.startsWith(PROOF) || key.startsWith('x-forwarded-') && !['x-forwarded-for', 'x-forwarded-proto'].includes(key)) reject('HOST_FORBIDDEN');
  if (headers.has('x-forwarded-proto') && headers.get('x-forwarded-proto') !== 'https') reject('HOST_FORBIDDEN');
  const auth = headers.get('authorization') || '';
  if (auth.length > 4096 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) reject('AUTH_REQUIRED', 401);
  // Syntax only: actual JWT signature, issuer/user/session and revocation are
  // verified by the existing PostgreSQL authority on EVERY request.
  for (const key of ['x-stocks-token', 'x-stocks-view']) if ((headers.get(key) || '').length > 256) reject('REQUEST_REJECTED');
  return route(url.pathname + url.search, request.method);
}
export const keyBytes = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject('STOCKS_EDGE_CONFIG_INVALID', 503);
  return new Uint8Array(value.match(/../g).map(hex => parseInt(hex, 16)));
};
export const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export function canonical({ time, nonce, publicOrigin, apiOrigin, method, path, authorization, csrf = '', view = '', digest }) {
  return JSON.stringify(['stocks-edge-v1', time, nonce, publicOrigin, apiOrigin, method, path, authorization, csrf, view, digest]);
}
