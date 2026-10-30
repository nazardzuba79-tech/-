'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixtureScope, installTrace } = require('./auth-trace.cjs');
const app = path.resolve(__dirname, '../..');
const adapterModule = import(pathToFileURL(path.join(app, 'services/stocks-global/authority-adapter.mjs')));
const AUTH = 'Bearer ' + 'DO_NOT_LOG_TOKEN_'.repeat(3);
const PRIVATE_SUBJECT = 'DO_NOT_LOG_USER';
const PRIVATE_COOKIE = 'DO_NOT_LOG_COOKIE';

async function server(t, handler) {
  const value = http.createServer(handler);
  await new Promise(resolve => value.listen(0, '127.0.0.1', resolve));
  t.after(async () => { value.closeAllConnections(); await new Promise(resolve => value.close(resolve)); });
  return { value, port: value.address().port };
}
async function adapter(port) {
  return (await adapterModule).createAuthorityAdapter({
    endpoint: `http://127.0.0.1:${port}/api/v1/stocks-test-cash`,
    issuer: 'fixture', gatewayKey: 'DO_NOT_LOG_GATEWAY_KEY_'.repeat(2),
  });
}
async function identity(a, signal) {
  const req = { headers: { authorization: AUTH } };
  return a.runWithRequest(req, () => a.authenticate(req, { signal }));
}
function trace(t, port, extra = {}) {
  const messages = [];
  const restore = installTrace({ role: 'gateway', authorityPort: port,
    write: line => messages.push(JSON.parse(line)), ...extra });
  t.after(restore);
  return messages;
}
function noSecrets(messages) {
  const encoded = JSON.stringify(messages);
  for (const secret of [AUTH, PRIVATE_SUBJECT, PRIVATE_COOKIE, 'DO_NOT_LOG_GATEWAY_KEY',
    'DO_NOT_LOG_BODY', 'DO_NOT_LOG_ERROR_MESSAGE']) assert.ok(!encoded.includes(secret));
}

test('non-JSON HTTP429: classified denial stays fail-closed and trace observes headers without consuming body', async t => {
  const api = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, AUTH);
    res.writeHead(429, { 'content-type': 'text/plain', 'ratelimit-limit': '120',
      'ratelimit-remaining': '0', 'retry-after': '60', 'set-cookie': PRIVATE_COOKIE });
    res.end('DO_NOT_LOG_BODY ' + PRIVATE_SUBJECT);
  });
  const a = await adapter(api.port);
  // Diagnostic preload must preserve the new status-first adapter behavior.
  let original;
  try { await identity(a); } catch (error) { original = error; }
  assert.equal(original.code, 'AUTH_RATE_LIMIT');
  assert.equal(original.retryAfterMs, 60000);
  assert.equal(original.status, undefined);
  const messages = trace(t, api.port);
  await assert.rejects(identity(await adapter(api.port)), error => error.code === original.code);
  const headers = messages.find(m => m.stage === 'authority-headers');
  assert.equal(headers.status, 429); assert.equal(headers.media, 'text');
  assert.equal(headers.rateLimit, 120); assert.equal(headers.rateRemaining, 0);
  assert.equal(headers.retryAfter, 60);
  assert.equal(messages.some(m => m.stage === 'authority-body-end'), false);
  noSecrets(messages);
});

test('malformed HTTP200 JSON is distinguished from socket failure without altering the original error', async t => {
  const api = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"secret":"DO_NOT_LOG_BODY"');
  });
  const messages = trace(t, api.port), a = await adapter(api.port);
  await assert.rejects(identity(a), error => error.code === 'AUTH_UNAVAILABLE');
  assert.ok(messages.some(m => m.stage === 'authority-headers' && m.status === 200 && m.media === 'json'));
  assert.ok(messages.some(m => m.stage === 'authority-body-end' && m.json === 'INVALID' && m.complete));
  noSecrets(messages);
});

test('upstream auth denial and per-request identity results are unchanged; no identity cache', async t => {
  let count = 0;
  const api = await server(t, (req, res) => {
    count++; assert.equal(req.headers.authorization, AUTH);
    res.writeHead(count === 3 ? 401 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(count === 3 ? { error: 'AUTH_REQUIRED' } :
      { issuer: 'fixture', subject: PRIVATE_SUBJECT }));
  });
  const messages = trace(t, api.port), a = await adapter(api.port);
  assert.equal((await identity(a)).subject, PRIVATE_SUBJECT);
  assert.equal((await identity(a)).subject, PRIVATE_SUBJECT);
  await assert.rejects(identity(a), error => error.code === 'AUTH_REQUIRED');
  assert.equal(count, 3);
  assert.deepEqual(messages.filter(m => m.stage === 'authority-headers').map(m => m.status), [200, 200, 401]);
  noSecrets(messages);
});

test('connection failure is classified without exposing raw errors or altering AUTH_UNAVAILABLE', async t => {
  const api = await server(t, (_req, res) => res.end());
  await new Promise(resolve => api.value.close(resolve));
  const messages = trace(t, api.port), a = await adapter(api.port);
  await assert.rejects(identity(a), error => error.code === 'AUTH_UNAVAILABLE');
  assert.ok(messages.some(m => m.stage === 'authority-fetch-error' && m.errorCode === 'ECONNREFUSED'));
  noSecrets(messages);
});

test('post-headers closed socket is captured while original response stream error remains fail-closed', async t => {
  const api = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' });
    res.write('{"issuer":"fixture","subject":"');
    setTimeout(() => res.destroy(), 25);
  });
  const messages = trace(t, api.port), a = await adapter(api.port);
  await assert.rejects(identity(a), error => error.code === 'AUTH_UNAVAILABLE');
  assert.ok(messages.some(m => m.stage === 'authority-headers' && m.status === 200));
  assert.ok(messages.some(m => m.stage === 'authority-stream-error' && ['UND_ERR_SOCKET', 'ECONNRESET'].includes(m.errorCode)));
  noSecrets(messages);
});

test('caller cancellation keeps original AbortSignal and maps to bounded safe diagnostic', async t => {
  const api = await server(t, () => {});
  const messages = trace(t, api.port), a = await adapter(api.port), controller = new AbortController();
  const pending = identity(a, controller.signal);
  setTimeout(() => controller.abort(new Error('DO_NOT_LOG_ERROR_MESSAGE')), 20);
  await assert.rejects(pending, error => error.code === 'AUTH_UNAVAILABLE');
  assert.ok(messages.some(m => m.stage === 'authority-fetch-error' && m.signalAborted === true));
  noSecrets(messages);
});

test('gateway request correlation reaches API and distinguishes no order submission from an unknown commit', async t => {
  let observedHeader;
  const api = await server(t, (req, res) => {
    observedHeader = req.headers['x-smoke-correlation-id'];
    res.writeHead(429, { 'content-type': 'text/plain' }); res.end('DO_NOT_LOG_BODY');
  });
  let a;
  const gateway = await server(t, async (req, res) => {
    try { await a.runWithRequest(req, () => a.authenticate(req)); res.end('unexpected'); }
    catch (error) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.code })); }
  });
  const messages = trace(t, api.port, { gatewayPort: gateway.port });
  a = await adapter(api.port);
  const response = await fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/orders`,
    { method: 'POST', headers: { authorization: AUTH }, body: '{}' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'AUTH_UNAVAILABLE');
  const end = messages.find(m => m.stage === 'http-end' && m.route === 'orders');
  assert.equal(end.id, observedHeader);
  assert.equal(end.identityCalls, 1);
  assert.equal(end.orderCommandSent, 0);
  assert.equal(end.requestedOrderCommit, 'NOT_SUBMITTED');
  const apiEnd = messages.find(m => m.stage === 'http-end' && m.route === 'identity');
  assert.equal(apiEnd.requestedOrderCommit, 'NOT_OBSERVED');
  noSecrets(messages);
});

test('preload scope rejects nonfixture database and wrong role/app; logging failure never changes transport', async t => {
  const env = { STOCKS_SMOKE_TRACE: 'isolated-v1', STOCKS_SMOKE_TRACE_APP: '98c577d4241ce527f7bfca3b78dd7bb78255e300',
    STOCKS_SMOKE_TRACE_ROLE: 'api' };
  const config = { databaseUrl: 'postgresql://fixture:unused@127.0.0.1:5432/stocks_disposable_pg_tls_1',
    issuer: 'stocks-isolated-smoke', principals: ['stocks-smoke-trader-a', 'stocks-smoke-trader-b']
      .map(subject => ({ issuer: 'stocks-isolated-smoke', subject })) };
  fixtureScope(env, config);
  for (const changed of [{ ...env, STOCKS_SMOKE_TRACE_APP: 'wrong' },
    { ...env, STOCKS_SMOKE_TRACE_ROLE: 'production' }, { ...env, STOCKS_SMOKE_TRACE: '' }])
    assert.throws(() => fixtureScope(changed, config), /SMOKE_TRACE_SCOPE_INVALID/);
  assert.throws(() => fixtureScope(env, { ...config, databaseUrl: 'postgresql://127.0.0.1:5432/production' }),
    /SMOKE_TRACE_SCOPE_INVALID/);
  const api = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ issuer: 'fixture', subject: PRIVATE_SUBJECT }));
  });
  const restore = installTrace({ role: 'gateway', authorityPort: api.port, write() { throw Error('sink unavailable'); } });
  t.after(restore);
  assert.equal((await identity(await adapter(api.port))).subject, PRIVATE_SUBJECT);
});

test('unchanged hosted ingress forwards diagnostic context without changing JWT/CSRF or exposing it to the client', async t => {
  const api = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ issuer: 'fixture', subject: PRIVATE_SUBJECT }));
  });
  let a;
  const gateway = await server(t, async (req, res) => {
    assert.equal(req.headers.authorization, AUTH);
    assert.equal(req.headers['x-stocks-token'], 'DO_NOT_LOG_CSRF');
    await a.runWithRequest(req, () => a.authenticate(req));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  const messages = trace(t, api.port, { gatewayPort: gateway.port });
  a = await adapter(api.port);
  const { createHostedIngress } = await import(pathToFileURL(path.join(app, 'services/stocks-global/hosted-ingress.mjs')));
  const ingress = await createHostedIngress({ origin: 'https://stocks.fixture.invalid:4443', gatewayPort: gateway.port, port: 0 });
  t.after(() => ingress.close());
  // Same native HTTP client / explicit Host header as the smoke TLS proxy.
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: ingress.port, path: '/__stocks_global/orders',
      method: 'POST', headers: { host: 'stocks.fixture.invalid:4443',
        origin: 'https://stocks.fixture.invalid:4443', authorization: AUTH, 'x-stocks-token': 'DO_NOT_LOG_CSRF' } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(response.headers['x-smoke-correlation-id'], undefined);
  const starts = messages.filter(m => m.stage === 'http-start' && m.route === 'orders');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].id, starts[1].id);
  assert.equal(messages.find(m => m.stage === 'authority-start').id, starts[0].id);
  assert.ok(!JSON.stringify(messages).includes('DO_NOT_LOG_CSRF'));
  noSecrets(messages);
});

test('bounded trace quota reports truncation once and never changes subsequent authorization', async t => {
  const api = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ issuer: 'fixture', subject: PRIVATE_SUBJECT }));
  });
  const messages = trace(t, api.port, { maxEvents: 1 }), a = await adapter(api.port);
  assert.equal((await identity(a)).subject, PRIVATE_SUBJECT);
  assert.equal((await identity(a)).subject, PRIVATE_SUBJECT);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].stage, 'trace-limit');
  noSecrets(messages);
});

test('order-command trace distinguishes HTTP acknowledgment from rejection or lost ACK without claiming DB observation', async t => {
  let mode = 'ack';
  const api = await server(t, (req, res) => {
    if (mode === 'lost') { req.socket.destroy(); return; }
    res.writeHead(mode === 'ack' ? 200 : 503, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const gateway = await server(t, async (_req, res) => {
    try {
      const result = await fetch(`http://127.0.0.1:${api.port}/api/v1/stocks-test-cash/command`,
        { method: 'POST', body: '{"type":"submitObserved"}', headers: { authorization: AUTH } });
      await result.text(); res.writeHead(result.status); res.end('{}');
    } catch { res.writeHead(503); res.end('{}'); }
  });
  const messages = trace(t, api.port, { gatewayPort: gateway.port });
  for (const value of ['ack', 'rejected', 'lost']) {
    mode = value;
    const response = await fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/orders`, { method: 'POST' });
    await response.text();
    const end = messages.filter(m => m.stage === 'http-end' && m.route === 'orders').at(-1);
    assert.equal(end.orderCommandSent, 1);
    assert.equal(end.requestedOrderCommit, value === 'ack' ? 'ACK_AFTER_COMMIT' : 'UNKNOWN');
  }
  noSecrets(messages);
});
