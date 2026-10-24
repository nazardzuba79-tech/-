'use strict';
// Staging-only ingress. Never an authority proxy. No configurable upstream.
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ROUTES = Object.freeze({ catalogue: 'GET', state: 'GET', portfolio: 'GET', history: 'GET',
  lease: 'DELETE', orders: 'POST', cancel: 'POST', refresh: 'POST' });
const ORIGIN = 'https://stocks.fixture.invalid:4443';
const SOCKET = '/run/stocks-ingress/ingress.sock';
const HEADERS = ['authorization', 'content-type', 'origin', 'sec-fetch-site', 'x-stocks-token', 'x-stocks-view'];
function validate(req) {
  assert.equal(req.headers.host, new URL(ORIGIN).host, 'HOST_FORBIDDEN');
  const raw = req.url;
  assert.ok(typeof raw === 'string' && raw.length <= 8192 && !/[\\#%]/.test(raw.split('?')[0]), 'ROUTE_NOT_FOUND');
  const pathname = raw.split('?')[0];
  const route = pathname.slice('/__stocks_global/'.length);
  assert.ok(pathname === '/__stocks_global/' + route && ROUTES[route] === req.method, 'ROUTE_NOT_FOUND');
  assert.ok(req.headers.origin === undefined || req.headers.origin === ORIGIN, 'ORIGIN_FORBIDDEN');
  if (req.method !== 'GET') assert.equal(req.headers.origin, ORIGIN, 'ORIGIN_FORBIDDEN');
  assert.ok(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'ORIGIN_FORBIDDEN');
  assert.ok(!Object.keys(req.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-') ||
    k === 'x-real-ip' || k.startsWith('cf-') || k === 'true-client-ip' || k === 'x-stocks-authority-key'), 'HOST_FORBIDDEN');
  for (const key of ['host', ...HEADERS]) {
    assert.ok(req.rawHeaders.filter((_, i) => i % 2 === 0).filter(x => x.toLowerCase() === key).length <= 1, 'HOST_FORBIDDEN');
  }
  return raw;
}
function createHandler(request = http.request) {
  let inflight = 0;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 80, maxFreeSockets: 8 });
  const handler = async (req, res) => {
    const deny = (status, error) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error })); };
    if (inflight >= 80) return deny(503, 'ACCOUNT_BUSY');
    inflight++; res.once('close', () => inflight--);
    let out;
    try {
      const path = validate(req), chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; assert.ok(length <= 16384, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const headers = { host: new URL(ORIGIN).host, 'content-length': String(body.length) };
      for (const key of HEADERS) if (typeof req.headers[key] === 'string') headers[key] = req.headers[key];
      // Never retry, redirect, cache, or forward arbitrary incoming headers.
      out = request({ host: '127.0.0.1', port: 4438, method: req.method, path, headers, agent }, upstream => {
        const responseHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };
        if (/^\d{1,2}$/.test(upstream.headers['retry-after'] ?? '')) responseHeaders['retry-after'] = upstream.headers['retry-after'];
        res.writeHead(upstream.statusCode, responseHeaders);
        upstream.on('error', () => res.destroy()); upstream.pipe(res);
      });
      out.setTimeout(15000, () => out.destroy(Error('UPSTREAM_TIMEOUT')));
      out.on('error', () => { if (res.headersSent) res.destroy(); else deny(503, 'STOCKS_UNAVAILABLE'); });
      res.on('close', () => { if (!res.writableFinished) out.destroy(); });
      out.end(body);
    } catch (error) {
      out?.destroy();
      const code = ['HOST_FORBIDDEN','ORIGIN_FORBIDDEN','ROUTE_NOT_FOUND','REQUEST_TOO_LARGE'].find(x => error.message.includes(x)) || 'REQUEST_REJECTED';
      deny(code === 'ROUTE_NOT_FOUND' ? 404 : 403, code);
    }
  };
  handler.close = () => agent.destroy();
  return handler;
}
function verifyDirectory(dir, platform = process.platform) {
  assert.equal(platform, 'linux', 'UNIX_PERMISSIONS_REQUIRE_LINUX');
  const stat = fs.lstatSync(dir);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'SOCKET_DIRECTORY_INVALID');
  assert.equal(stat.uid, 10001); assert.equal(stat.gid, 10002);
  assert.equal(stat.mode & 0o777, 0o710, 'SOCKET_DIRECTORY_PERMISSIONS');
}
async function start() {
  verifyDirectory('/run/stocks-ingress');
  assert.equal(process.getuid(), 10001); assert.equal(process.getgid(), 10002);
  assert.ok(!fs.existsSync(SOCKET), 'STALE_SOCKET_REQUIRES_OPERATOR_REVIEW');
  process.umask(0o117); // socket 0660; directory already pre-created 0710
  const handler = createHandler(), server = http.createServer(handler);
  server.keepAliveTimeout = 5000; server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(SOCKET, ok); });
  const stat = fs.lstatSync(SOCKET);
  assert.ok(stat.isSocket()); assert.equal(stat.uid, 10001); assert.equal(stat.gid, 10002); assert.equal(stat.mode & 0o777, 0o660);
  console.log('UNIX_INGRESS_READY');
  const stop = () => { handler.close(); server.close(() => process.exit(0)); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { ROUTES, ORIGIN, SOCKET, validate, createHandler, verifyDirectory };
if (require.main === module) start().catch(() => { console.error('UNIX_INGRESS_START_FAILED'); process.exit(1); });
