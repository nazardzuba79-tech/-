import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createLocalStocksProxy } from './local-proxy.mjs';

async function fixture(t, handler, options = {}) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const stocksOrigin = `http://127.0.0.1:${upstream.address().port}`;
  let origin;
  const proxy = http.createServer(createLocalStocksProxy({ origin: () => origin, stocksOrigin: () => stocksOrigin, ...options }));
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  origin = `http://127.0.0.1:${proxy.address().port}`;
  t.after(async () => {
    proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  });
  return { origin, stocksOrigin, proxy, upstream };
}

function request(origin, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin, { path, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('loopback proxy forwards only allowed identity headers and streams the unchanged paper request', async t => {
  let observed;
  const f = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    observed = { url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() };
    res.writeHead(202, { 'content-type': 'application/json', 'set-cookie': 'must-not-forward=1', 'location': 'https://not-forwarded.invalid', 'retry-after': '2' });
    res.end('{"accepted":true}');
  });
  const body = JSON.stringify({ id: 'BYBIT:AAPLXUSDT', quantity: '0.5' });
  const response = await request(f.origin, '/__stocks_global/orders', { method: 'POST', body, headers: {
    origin: f.origin, 'sec-fetch-site': 'same-origin', authorization: 'Bearer synthetic-local-test-token',
    'content-type': 'application/json', 'x-stocks-token': 'synthetic-csrf', 'x-stocks-view': 'synthetic-view',
    cookie: 'ignored=1', 'x-forwarded-authorization': 'ignored', 'x-forwarded-host': 'ignored.invalid', 'x-user-id': 'ignored',
  } });
  assert.equal(response.status, 202); assert.equal(response.body, '{"accepted":true}');
  assert.equal(observed.url, '/__stocks_global/orders'); assert.equal(observed.body, body);
  assert.equal(observed.headers.host, new URL(f.stocksOrigin).host); assert.equal(observed.headers.origin, f.stocksOrigin);
  assert.equal(observed.headers.authorization, 'Bearer synthetic-local-test-token');
  assert.equal(observed.headers['x-stocks-token'], 'synthetic-csrf'); assert.equal(observed.headers['x-stocks-view'], 'synthetic-view');
  for (const key of ['cookie', 'x-forwarded-authorization', 'x-forwarded-host', 'x-user-id']) assert.equal(observed.headers[key], undefined);
  assert.equal(response.headers['set-cookie'], undefined); assert.equal(response.headers.location, undefined);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['retry-after'], '2');
});

test('only exact allowlisted methods/routes and query fields reach upstream', async t => {
  let count = 0;
  const f = await fixture(t, (req, res) => { count++; req.resume(); res.end('{}'); });
  const accepted = [
    ['GET', 'state?id=BYBIT%3AAAPLXUSDT'], ['GET', 'portfolio'], ['GET', 'history?id=BYBIT%3AAAPLXUSDT&interval=1&before=123'],
    ['GET', 'catalogue'], ['GET', 'health'], ['POST', 'orders'], ['POST', 'cancel'], ['POST', 'refresh'], ['POST', 'balances'], ['DELETE', 'lease?id=BYBIT%3AAAPLXUSDT'],
  ];
  for (const [method, path] of accepted) assert.equal((await request(f.origin, '/__stocks_global/' + path, { method })).status, 200);
  const start = count;
  for (const path of ['/api/v1/orders', '/__stocks_global/../orders', '/__stocks_global/%73tate', '/__stocks_global/state/',
    '/__stocks_global//state', '/__stocks_global/state?url=http%3A%2F%2Fexample.invalid', '/__stocks_global/state?id=one&id=two',
    '/__stocks_global/state?id=%zz', '/__stocks_global/portfolio?id=other', 'http://127.0.0.1:1/__stocks_global/state']) {
    assert.ok((await request(f.origin, path)).status >= 400, path);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal((await request(f.origin, '/__stocks_global/state', { method })).status, 405);
  }
  assert.equal(count, start);
});

test('cross-origin, spoofed Host and duplicate authentication cannot reach upstream', async t => {
  let count = 0;
  const f = await fixture(t, (req, res) => { count++; res.end('{}'); });
  for (const headers of [
    { origin: 'https://untrusted.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' }, { host: 'localhost:' + new URL(f.origin).port },
    { authorization: ['Bearer synthetic-one', 'Bearer synthetic-two'] },
  ]) assert.ok((await request(f.origin, '/__stocks_global/state', { headers })).status >= 400);
  assert.equal(count, 0);
});

test('nonliteral, external and recursive configured origins fail closed without upstream access', async t => {
  let count = 0, origin = 'https://example.invalid';
  const f = await fixture(t, (req, res) => { count++; res.end('{}'); }, { stocksOrigin: () => origin });
  for (const candidate of ['http://localhost:4437', 'http://127.0.0.1:4437/path', 'http://user@127.0.0.1:4437',
    'http://127.0.0.1:70000', 'http://127.0.0.1:4437?url=bad', 'https://127.0.0.1:4437', f.origin]) {
    origin = candidate;
    assert.equal((await request(f.origin, '/__stocks_global/state')).status, 503);
  }
  assert.equal(count, 0);
});

test('request body bounds and unsupported read bodies fail without modifying an account', async t => {
  const f = await fixture(t, (req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  assert.equal((await request(f.origin, '/__stocks_global/state', { body: 'x', headers: { 'content-length': '1' } })).status, 400);
  assert.equal((await request(f.origin, '/__stocks_global/orders', { method: 'POST', body: 'x'.repeat(65537), headers: { 'content-length': '65537' } })).status, 413);
  assert.equal((await request(f.origin, '/__stocks_global/orders', { method: 'POST', body: 'x'.repeat(65537), headers: { 'transfer-encoding': 'chunked' } })).status, 413);
});

test('bounded timeout aborts slow upstream and returns only a safe error code', async t => {
  let closedResolve;
  const closed = new Promise(resolve => { closedResolve = resolve; });
  const f = await fixture(t, (req, res) => { req.resume(); res.once('close', closedResolve); }, { timeoutMs: 50 });
  const result = await request(f.origin, '/__stocks_global/state');
  assert.equal(result.status, 504); assert.equal(result.body, '{"error":"LOCAL_STOCKS_TIMEOUT"}');
  await closed;
});

test('disconnected browser destroys the in-flight upstream response so its chart lease closes', async t => {
  let startedResolve, closedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const closed = new Promise(resolve => { closedResolve = resolve; });
  const f = await fixture(t, (req, res) => { req.resume(); res.once('close', closedResolve); startedResolve(); });
  const client = http.get(f.origin + '/__stocks_global/state?id=BYBIT%3AAAPLXUSDT');
  client.on('error', () => {});
  await started; client.destroy();
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream did not close')), 1000); timer.unref(); })]);
});
