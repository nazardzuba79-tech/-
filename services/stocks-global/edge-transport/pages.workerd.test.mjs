import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pagesWorker, originProxy, ROOT, APP, API, KEY, ENV } from './test-support.mjs';
import { createPagesTransport } from './verifier.mjs';
import { createHostedIngress } from '../hosted-ingress.mjs';
import { createServer } from '../server.mjs';
import { createReleaseMarket } from '../release-market.mjs';
import { SimError } from '../engine.mjs';

test('actual Pages-compiled Function in workerd -> signed ingress -> real gateway, no rights and no finance', { timeout: 30000 }, async t => {
  let ledgerAccess = 0, authenticated = 0, revoked = false;
  const authority = { runWithRequest: (_req, work) => work(),
    authenticate: async req => { authenticated++; if (revoked || req.headers.authorization !== 'Bearer fixture.user.signature') throw new SimError('AUTH_REQUIRED'); return { issuer: 'isolated-edge', subject: 'viewer' }; },
    forPrincipal: async () => { ledgerAccess++; throw Error('no financial authority allowed'); }, close: async () => {}, metrics: () => ({}) };
  const gateway = await createServer({ port: 0, accountAuthority: authority, tradePrincipals: ['alpha', 'beta'].map(subject => ({ issuer: 'isolated-edge', subject })), hub: createReleaseMarket({}) }); t.after(() => gateway.close());
  const ingress = await createHostedIngress({ origin: APP, gatewayPort: gateway.port, port: 0, transport: createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY }) }); t.after(() => ingress.close());
  const proxy = await originProxy(t, ingress.port); const mf = await pagesWorker(t, { outbound: proxy.outbound });
  // Miniflare dispatchFetch otherwise inserts its loopback listener as Host;
  // preserve the actual public Host a Pages request carries, never relax checks.
  const send = (path = 'catalogue', options = {}) => mf.dispatchFetch(APP + '/__stocks_global/' + path, { ...options, headers: { host: new URL(APP).host, authorization: 'Bearer fixture.user.signature', ...options.headers } });
  const anonymous=await send('catalogue', { headers: { authorization: '' } });
  assert.equal(anonymous.status, 401, JSON.stringify(await anonymous.json()));
  assert.equal(proxy.requests.length, 0);
  const response = await send(); assert.equal(response.status, 200); const data = await response.json();
  assert.ok(data.catalogue.length > 0); assert.ok(data.catalogue.every(row => !row.online && row.display === null));
  const state = await (await send('state?id=BYBIT%3AAAPLXUSDT')).json(); assert.deepEqual(state.quotes, {}); assert.equal(state.account.canTrade, false);
  const before = proxy.requests.length;
  for (const path of ['orders', 'cancel', 'balances', 'refresh']) assert.equal((await send(path, { method: 'POST', headers: { origin: APP } })).status, 403);
  assert.equal(proxy.requests.length, before); assert.equal(ledgerAccess, 0);
  revoked = true; assert.equal((await send()).status, 401); assert.ok(authenticated >= 3);
  assert.equal(gateway.server.address().address, '127.0.0.1'); assert.equal(ingress.server.address().address, '127.0.0.1');
  const routes = JSON.parse(await readFile(resolve(ROOT, 'frontend/public/_routes.json'), 'utf8'));
  assert.deepEqual(routes.include, ['/__stocks_global/*']); assert.deepEqual(routes.exclude, []);
  const calls = proxy.requests.length; assert.equal(await (await mf.dispatchFetch(APP + '/login')).text(), 'unchanged static fixture'); assert.equal(proxy.requests.length, calls);
  t.diagnostic(JSON.stringify({ runtime: 'real workerd with Wrangler-compiled Pages router', transport: proxy.mode, providerRequests: 0, financialAuthorityCalls: ledgerAccess, productionAcceptance: 'NOT_RUN' }));
});

test('actual Pages Function default OFF has zero upstream calls', { timeout: 20000 }, async t => {
  let calls = 0; const mf = await pagesWorker(t, { bindings: {}, outbound: async () => { calls++; throw Error('default OFF cannot fetch'); } });
  assert.equal((await mf.dispatchFetch(APP + '/__stocks_global/catalogue')).status, 503); assert.equal(calls, 0);
});
