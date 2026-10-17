import http from 'node:http';
import { Transform } from 'node:stream';

const PREFIX = '/__stocks_global/';
const ROUTES = new Map([
  ['state', { method: 'GET', query: ['id'] }],
  ['portfolio', { method: 'GET', query: [] }],
  ['history', { method: 'GET', query: ['id', 'interval', 'before'] }],
  ['catalogue', { method: 'GET', query: [] }],
  ['health', { method: 'GET', query: [] }],
  ['orders', { method: 'POST', query: [] }],
  ['cancel', { method: 'POST', query: [] }],
  ['refresh', { method: 'POST', query: [] }],
  ['balances', { method: 'POST', query: [] }],
  ['lease', { method: 'DELETE', query: ['id'] }],
]);
const FORWARDED_HEADERS = ['authorization', 'content-type', 'x-stocks-token', 'x-stocks-view'];
const UNIQUE_HEADERS = new Set(['host', 'origin', 'sec-fetch-site', ...FORWARDED_HEADERS]);
const MAX_BODY = 64 * 1024;

function localOrigin(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.test(value)) return null;
  const port = Number(value.slice(value.lastIndexOf(':') + 1));
  return port <= 65535 ? { value, host: `127.0.0.1:${port}`, port } : null;
}

function reply(res, status, error) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error }));
}

/**
 * Local review gateway only. Invoke with the untouched raw req.url, before a
 * router strips its mount prefix. Both callbacks are operator-owned, called
 * without request arguments, and must return distinct literal loopback origins.
 * This forwards identity to the Stocks service; it does not authenticate users.
 */
export function createLocalStocksProxy({ origin, stocksOrigin, timeoutMs = 8000 } = {}) {
  if (typeof origin !== 'function' || typeof stocksOrigin !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new TypeError('Invalid local Stocks proxy configuration');
  }
  return function localStocksProxy(req, res) {
    let local, upstream;
    try { local = localOrigin(origin()); upstream = localOrigin(stocksOrigin()); } catch {}
    if (!local || !upstream || local.value === upstream.value) return reply(res, 503, 'LOCAL_STOCKS_UNAVAILABLE');
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return reply(res, 403, 'ORIGIN_DENIED');
    const seen = new Set();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (UNIQUE_HEADERS.has(name) && seen.has(name)) return reply(res, 400, 'DUPLICATE_HEADER');
      seen.add(name);
    }
    if (req.headers.host !== local.host) return reply(res, 400, 'INVALID_HOST');
    if (req.headers.origin !== undefined && req.headers.origin !== local.value) return reply(res, 403, 'ORIGIN_DENIED');
    if (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
      return reply(res, 403, 'ORIGIN_DENIED');
    }
    const target = req.url || '';
    if (target.length > 8192 || !target.startsWith(PREFIX) || /[\\#\r\n]/.test(target)) return reply(res, 404, 'ROUTE_NOT_ALLOWED');
    const [pathname] = target.split('?');
    const route = ROUTES.get(pathname.slice(PREFIX.length));
    if (!route) return reply(res, 404, 'ROUTE_NOT_ALLOWED');
    if (req.method !== route.method) return reply(res, 405, 'METHOD_NOT_ALLOWED');
    const query = target.includes('?') ? target.slice(target.indexOf('?') + 1) : '';
    if (/%(?![\da-f]{2})/i.test(query)) return reply(res, 400, 'QUERY_NOT_ALLOWED');
    const params = new URLSearchParams(query), names = new Set();
    for (const name of params.keys()) {
      if (!route.query.includes(name) || names.has(name)) return reply(res, 400, 'QUERY_NOT_ALLOWED');
      names.add(name);
    }
    if (req.method !== 'POST' && (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) !== 0)) {
      return reply(res, 400, 'BODY_NOT_ALLOWED');
    }
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return reply(res, 413, 'BODY_TOO_LARGE');
    const headers = { host: upstream.host, origin: upstream.value, 'sec-fetch-site': 'same-origin' };
    for (const name of FORWARDED_HEADERS) {
      const value = req.headers[name];
      if (value !== undefined) {
        if (typeof value !== 'string' || value.length > 8192) return reply(res, 400, 'INVALID_HEADER');
        headers[name] = value;
      }
    }

    let done = false, received = 0, upstreamResponse;
    const outbound = http.request({ hostname: '127.0.0.1', port: upstream.port, method: req.method, path: target, headers, agent: false });
    const body = new Transform({ transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_BODY) callback(new Error('BODY_TOO_LARGE'));
      else callback(null, chunk);
    } });
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('aborted', disconnected);
      res.removeListener('close', disconnected);
    };
    const stop = (status, code) => {
      if (done) return;
      done = true;
      cleanup();
      req.unpipe(body); body.unpipe(outbound);
      upstreamResponse?.destroy(); outbound.destroy(); body.destroy();
      if (status) reply(res, status, code);
    };
    const disconnected = () => { if (!res.writableFinished) stop(); };
    const timer = setTimeout(() => stop(504, 'LOCAL_STOCKS_TIMEOUT'), timeoutMs);
    timer.unref();
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    req.once('error', () => stop(502, 'LOCAL_STOCKS_UNAVAILABLE'));
    body.once('error', () => stop(413, 'BODY_TOO_LARGE'));
    outbound.once('error', () => stop(502, 'LOCAL_STOCKS_UNAVAILABLE'));
    outbound.once('response', response => {
      if (done) { response.destroy(); return; }
      upstreamResponse = response;
      const responseHeaders = { 'content-type': response.headers['content-type'] || 'application/json', 'cache-control': 'no-store' };
      if (typeof response.headers['retry-after'] === 'string') responseHeaders['retry-after'] = response.headers['retry-after'];
      res.writeHead(response.statusCode || 502, responseHeaders);
      response.once('aborted', () => stop(502, 'LOCAL_STOCKS_UNAVAILABLE'));
      response.once('error', () => stop(502, 'LOCAL_STOCKS_UNAVAILABLE'));
      response.once('end', () => { done = true; cleanup(); });
      response.pipe(res);
    });
    req.pipe(body).pipe(outbound);
  };
}
