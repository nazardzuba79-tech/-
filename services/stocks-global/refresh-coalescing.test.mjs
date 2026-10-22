import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

test('rapid selections share only pending background observations per account and instrument', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-refresh-coalescing-'));
  let now = 1800000000000, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const A = 'BYBIT:AAPLXUSDT', N = 'BYBIT:NVDAXUSDT';
  let providerCalls = 0, tick, failure = false;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 123456; });
  const hub = {
    metrics: {}, catalogue: async () => CATALOG, history: async () => ({ candles: [] }),
    quote: async instrumentId => {
      providerCalls++; await blocked;
      if (failure) throw new SimError('RATE_LIMIT');
      return { instrumentId, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', last: '100',
        timestamp: now, receivedAt: now, verified: true, marketOpen: true, eventId: String(now),
        capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {} };
    },
  };
  const app = await createServer({ port: 0, accountsPath: join(dir, 'paper.sqlite'), now: () => now, hub,
    authenticate: async req => ({ issuer: 'coalescing-fixture-only', subject: req.headers['x-fixture-user'] }) });
  const base = `http://127.0.0.1:${app.port}/__stocks_global/`;
  const state = async (user, id) => {
    const r = await fetch(base + 'state' + (id ? '?id=' + encodeURIComponent(id) : ''), { headers: { 'x-fixture-user': user } });
    assert.equal(r.status, 200); return r.json();
  };
  const waitFor = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'background observations settle'); await new Promise(resolve => setTimeout(resolve, 5)); }
  };
  try {
    let alice = await state('alice'); const bob = await state('bob');
    const funded = await fetch(base + 'balances', { method: 'POST', headers: { 'x-fixture-user': 'alice',
      'X-Stocks-Token': alice.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'coalescing-test-funding-1', balances: { USDT: '12000', USDC: '15000' } }) });
    assert.equal(funded.status, 200); await funded.json(); alice = await state('alice');
    assert.notDeepEqual(alice.wallets, bob.wallets);
    assert.notEqual(alice.account.id, bob.account.id);
    for (let i = 0; i < 24; i++) await state('alice', i % 2 ? A : N);
    await state('bob', N); await state('bob', A);
    assert.equal(providerCalls, 2, 'provider singleflight remains shared across accounts');
    assert.equal(hub.metrics.accountQuoteObservations, 0);
    const scheduled = tick();
    await waitFor(() => hub.metrics.accountQuoteCoalesced === 24);
    release();
    await scheduled;
    await waitFor(() => hub.metrics.accountQuoteObservations >= 4 && app.accountMetrics().queue.pending === 0 && app.accountMetrics().queue.active === 0);
    assert.equal(hub.metrics.accountQuoteObservations, 4, 'one observation per owner/instrument, not one per selection');
    assert.equal(hub.metrics.accountQuoteCoalesced, 24, 'scheduler joins both pending owner observations');
    const a = await state('alice'), b = await state('bob');
    assert.deepEqual(a.wallets, alice.wallets); assert.deepEqual(b.wallets, bob.wallets);
    assert.equal(a.revision, alice.revision); assert.equal(b.revision, bob.revision);
    for (const s of [a, b]) { assert.equal(s.quotes[A].timestamp, now); assert.equal(s.quotes[N].timestamp, now); }
    // Completed observations are never cached by the coalescer. The existing
    // quote freshness rules and explicit request ordering remain authoritative.
    now += 3000;
    await state('alice', N); await waitFor(() => hub.metrics.accountQuoteObservations === 5);
    assert.equal((await state('alice')).quotes[N].timestamp, now);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(base + 'refresh', { method: 'POST', headers: { 'x-fixture-user': 'alice',
        'X-Stocks-Token': alice.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: N }) });
      assert.equal(r.status, 200); await r.json();
    }
    assert.equal(hub.metrics.accountQuoteObservations, 7, 'explicit refreshes retain separate execution');
    now += 3000; failure = true;
    await state('alice', A);
    await waitFor(() => app.accountMetrics().queue.pending === 0 && app.accountMetrics().queue.active === 0);
    let failed;
    for (let i = 0; i < 100; i++) {
      failed = await state('alice'); if (failed.errors[A] === 'RATE_LIMIT') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(failed.errors[A], 'RATE_LIMIT');
    assert.equal((await state('bob')).errors[A], undefined, 'failed owner observation does not change another account');
    failure = false; now += 3000;
    await state('alice', N); await state('alice', A);
    await waitFor(() => hub.metrics.accountQuoteObservations === 9);
    assert.equal((await state('alice')).errors[A], undefined, 'failed flights are removed and subsequent selections recover');
  } finally {
    release(); await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
