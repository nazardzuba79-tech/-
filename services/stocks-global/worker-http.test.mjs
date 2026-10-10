import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
const Q = { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'worker-http-fixture-1', capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {} };
const ORDER = { id: 'worker-http-request-0001', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1' };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-worker-http-'));
  const control = new Int32Array(new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT));
  const history = { instrumentId: ID, interval: '15m', currency: 'USDT', provider: 'bybit', delaySeconds: 0, candles: [], receivedAt: NOW };
  let authCalls = 0;
  const app = await createServer({ port: 0, accountsPath: join(dir, 'accounts.sqlite'), now: () => NOW, autoPoll: false,
    accountWorkerOptions: { testHooks: { commitControl: control.buffer } },
    authenticate: async req => {
      authCalls++;
      const subject = req.headers.authorization === 'Bearer fixture-alice' ? 'alice' : req.headers.authorization === 'Bearer fixture-bob' ? 'bob' : null;
      if (!subject) throw new SimError('AUTH_REQUIRED');
      return { issuer: 'worker-http-fixture-only', subject };
    },
    hub: { metrics: {}, catalogue: async () => CATALOG.map(i => ({ ...i, exists: true, online: true })), quote: async () => structuredClone(Q), history: async () => history },
  });
  const base = `http://127.0.0.1:${app.port}/__stocks_global/`;
  const request = async (path, { user = 'alice', token, body, signal } = {}) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer fixture-' + user, ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(3000) });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    Atomics.store(control, 2, 1); Atomics.notify(control, 2);
    await app.close(); await rm(dir, { recursive: true, force: true });
  });
  return { request, control, authCalls: () => authCalls };
}

async function entered(control, after) {
  const deadline = Date.now() + 5000;
  while (Atomics.load(control, 1) <= after) {
    assert.ok(Date.now() < deadline, 'ledger worker must reach its commit barrier');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('health and authenticated history respond while a ledger commit is blocked; order success waits for commit', async t => {
  const f = await fixture(t), initial = await f.request('state'), token = initial.body.token;
  assert.equal(initial.status, 200);
  assert.equal((await f.request('refresh', { token, body: { id: ID } })).status, 200);
  const count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0);
  let orderSettled = false;
  const order = f.request('orders', { token, body: ORDER, signal: AbortSignal.timeout(10000) });
  order.then(() => { orderSettled = true; }, () => { orderSettled = true; });
  await entered(f.control, count);
  const [health, history] = await Promise.all([f.request('health'), f.request('history?id=' + encodeURIComponent(ID) + '&interval=15m')]);
  assert.equal(health.status, 200); assert.equal(health.body.ok, true);
  assert.equal(history.status, 200); assert.equal(history.body.instrumentId, ID);
  assert.equal(orderSettled, false, 'responsive read routes must not require optimistic trading acknowledgements');
  Atomics.store(f.control, 2, 1); Atomics.notify(f.control, 2);
  const committed = await order;
  assert.equal(committed.status, 200); assert.equal(committed.body.result.status, 'FILLED');
  assert.equal(committed.body.wallets.USDT.cash, '9990.00000000');
  assert.equal((await f.request('state')).body.fills.length, 1);
});

test('a ledger worker crash reports unknown order outcome and unhealthy/unavailable responses instead of false success', async t => {
  const f = await fixture(t), initial = await f.request('state'), token = initial.body.token;
  assert.equal((await f.request('refresh', { token, body: { id: ID } })).status, 200);
  Atomics.store(f.control, 3, 1);
  const order = await f.request('orders', { token, body: ORDER });
  assert.equal(order.status, 503); assert.equal(order.body.error, 'ACCOUNT_OUTCOME_UNKNOWN');
  const health = await f.request('health');
  assert.equal(health.status, 503); assert.equal(health.body.ok, false);
  const state = await f.request('state');
  assert.equal(state.status, 503); assert.equal(state.body.error, 'ACCOUNT_UNAVAILABLE');
  const retryWhileDead = await f.request('orders', { token, body: ORDER });
  assert.equal(retryWhileDead.status, 503); assert.equal(retryWhileDead.body.error, 'ACCOUNT_UNAVAILABLE');
});

test('parallel first requests share one account/CSRF context and cannot select or cancel another user account', async t => {
  const f = await fixture(t);
  const alice = await Promise.all(Array.from({ length: 12 }, () => f.request('state')));
  for (const response of alice) assert.equal(response.status, 200);
  assert.equal(new Set(alice.map(r => r.body.account.id)).size, 1);
  assert.equal(new Set(alice.map(r => r.body.token)).size, 1, 'initialization singleflight must not issue competing CSRF tokens');
  const a = alice[0].body, b = (await f.request('state', { user: 'bob' })).body;
  assert.notEqual(a.account.id, b.account.id); assert.notEqual(a.token, b.token);
  const limit = { ...ORDER, type: 'LIMIT', limitPrice: '50' };
  assert.equal((await f.request('orders', { token: a.token, body: limit })).status, 200);
  const crossCancel = await f.request('cancel', { user: 'bob', token: b.token, body: { id: limit.id } });
  assert.equal(crossCancel.status, 422); assert.equal(crossCancel.body.error, 'ORDER_NOT_FOUND');
  assert.equal((await f.request('orders', { user: 'bob', token: a.token, body: { ...limit, id: 'worker-http-request-0002' } })).body.error, 'TOKEN_REQUIRED');
  assert.equal((await f.request('state?accountId=' + a.account.id, { user: 'bob' })).body.error, 'ACCOUNT_SELECTOR_FORBIDDEN');
  assert.equal((await f.request('orders', { user: 'bob', token: b.token, body: { ...limit, accountId: a.account.id } })).body.error, 'ACCOUNT_SELECTOR_FORBIDDEN');
  const finalBob = await f.request('state', { user: 'bob' });
  assert.equal(finalBob.body.wallets.USDT.cash, '10000.00000000'); assert.equal(finalBob.body.wallets.USDT.reserved, '0.00000000');
  assert.equal(finalBob.body.orders.length, 0); assert.equal(finalBob.body.fills.length, 0);
  const blocked = await f.request('history?id=' + encodeURIComponent('MOEX:TQBR:SBER') + '&interval=1m');
  assert.equal(blocked.status, 422); assert.equal(blocked.body.error, 'MOEX_UNVERIFIED');
  assert.ok(f.authCalls() >= 20, 'the worker adapter must not introduce an authentication bypass/cache');
});
