import { PROOF, FORWARD, origin, keyBytes, hex, canonical, validateBrowser, reject } from '../../services/stocks-global/edge-transport/protocol.mjs';

const encoder = new TextEncoder();
const errorResponse = (code, status) => Response.json({ error: code }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
// Default OFF. This is a narrowly scoped transport, not auth, a market provider
// or a new financial API. No VITE_API_URL or browser login change.
export async function stocksPages(request, env) {
  if (env.STOCKS_PAGES_PROXY_ENABLED !== 'true') return errorResponse('STOCKS_UNAVAILABLE', 503);
  try {
    const app = origin(env.STOCKS_PUBLIC_ORIGIN), api = origin(env.STOCKS_API_INGRESS_ORIGIN);
    if (app.origin === api.origin) reject('STOCKS_EDGE_CONFIG_INVALID', 503);
    const bytes = keyBytes(env.STOCKS_EDGE_TRANSPORT_KEY), path = validateBrowser(request, app);
    // GET and lease release never need a body. Bound reads, not buffering a
    // browser-controlled stream; no financial method is forwarded.
    if (request.headers.has('transfer-encoding') || request.headers.has('content-length') && request.headers.get('content-length') !== '0' || request.body !== null) reject('REQUEST_REJECTED');
    const time = String(Date.now()), nonce = crypto.randomUUID();
    const digest = hex(await crypto.subtle.digest('SHA-256', new Uint8Array()));
    const fields = { time, nonce, publicOrigin: app.origin, apiOrigin: api.origin, method: request.method, path,
      authorization: request.headers.get('authorization'), csrf: request.headers.get('x-stocks-token') || '', view: request.headers.get('x-stocks-view') || '', digest };
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical(fields))));
    const headers = new Headers({ origin: app.origin });
    for (const name of FORWARD) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    for (const [name, value] of Object.entries({ time, nonce, digest, signature })) headers.set(PROOF + name, value);
    const response = await fetch(api.origin + path, { method: request.method, headers, redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]), cache: 'no-store' });
    // Never follow redirects with the bearer; never mask a broken route with
    // Pages' HTML fallback, and never relay Set-Cookie or authority credentials.
    if (response.status >= 300 && response.status < 400 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); return errorResponse('STOCKS_UNAVAILABLE', 503);
    }
    const output = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const retry = response.headers.get('retry-after'); if (/^\d{1,3}$/.test(retry || '')) output.set('retry-after', retry);
    return new Response(response.body, { status: response.status, headers: output });
  } catch (error) {
    const safe = ['AUTH_REQUIRED', 'HOST_FORBIDDEN', 'ORIGIN_FORBIDDEN', 'ROUTE_NOT_FOUND', 'ACCOUNT_TRADING_DISABLED', 'REQUEST_REJECTED'];
    return safe.includes(error.code) ? errorResponse(error.code, error.status || 403) : errorResponse('STOCKS_UNAVAILABLE', 503);
  }
}
