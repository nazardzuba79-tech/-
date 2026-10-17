import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { preDemandReadiness } from './quote-readiness.mjs';
import { createServer } from './server.mjs';
import { openAccounts } from './accounts.mjs';
import { CATALOG } from './catalog.mjs';
import { setBalances, SimError } from './engine.mjs';

const ID = 'BYBIT:AAPLXUSDT', NOW = 1791849600000;
const traders = ['alice', 'bob'].map(subject => ({ issuer: 'readiness-fixture', subject }));
const quote = (time = NOW, changes = {}) => ({
  instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', timestamp: time, receivedAt: time,
  verified: true, marketOpen: true, eventId: 'readiness-' + time, capacity: '1.00000000',
  bid: '100', ask: '100', prices: { USDT: { buy: '100', sell: '100' } }, fx: {}, ...changes,
});

test('only an otherwise READY quote before the current demand earns a non-executable hint', () => {
  const q = quote(), original = structuredClone(q);
  assert.deepEqual(preDemandReadiness(q, NOW + 100, NOW + 100), {
    state: 'WAITING_FOR_QUOTE', reason: 'BEFORE_DEMAND', executable: false,
    quoteTimestamp: NOW, receivedAt: NOW, demandSince: NOW + 100,
  });
  assert.deepEqual(q, original, 'classification cannot rewrite timestamps or quote data');
  assert.equal(preDemandReadiness(q, NOW, NOW), null, 'a current observation is not recovery');
  assert.equal(preDemandReadiness(q, NOW, NOW + 1), null, 'a future demand is not evidence');
});

test('genuinely aged, failed, unverified, closed or FX-unavailable quotes never become recovery hints', () => {
  for (const q of [
    quote(NOW - 60_001, { receivedAt: NOW }), quote(NOW, { receivedAt: NOW - 30_001 }),
    quote(NOW, { failed: true }), quote(NOW, { verified: false }),
    quote(NOW, { provider: 'binance' }), quote(NOW, { marketOpen: false }),
    quote(NOW, { prices: {} }), quote(NOW, { receivedAt: NOW + 10_000 }),
  ]) assert.equal(preDemandReadiness(q, NOW + 100, NOW + 100), null);
  assert.equal(preDemandReadiness(null, NOW + 100, NOW + 100), null);
  assert.equal(preDemandReadiness(quote(), NOW + 30_001, NOW + 100), null,
    'an earlier valid hint must expire with the original receivedAt limit');
});

async function fixture(t, { quoteAgeMs = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-readiness-')), path = join(dir, 'paper.sqlite');
  let time = NOW, calls = 0, sourceFailure = false;
  const repo = openAccounts(path, { now: () => time });
  for (const [i, principal] of traders.entries()) {
    await repo.forPrincipal(principal).transact((state, at) => setBalances(state,
      { id: 'fixture-readiness-' + i, balances: { USDT: String((i + 1) * 100), USDC: '0' } }, at));
  }
  repo.close();
  const app = await createServer({ port: 0, accountsPath: path, tradePrincipals: traders,
    now: () => time, autoPoll: true, accountDiagnostics: true,
    authenticate: async req => {
      const subject = req.headers['x-fixture-subject'];
      if (!subject) throw new SimError('AUTH_REQUIRED');
      return { issuer: 'readiness-fixture', subject };
    },
    hub: { metrics: {}, catalogue: async () => CATALOG, history: async () => ({ candles: [] }),
      quote: async () => { calls++; if (sourceFailure) throw new SimError('SOURCE_UNAVAILABLE'); return quote(time - quoteAgeMs); } },
  });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const tokens = new Map();
  const send = (subject, route, body, method = body ? 'POST' : 'GET') => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${app.port}/__stocks_global/${route}`, {
      method, signal: AbortSignal.timeout(3000), headers: { 'x-fixture-subject': subject,
        'x-stocks-view': 'visit-' + subject, 'x-stocks-token': tokens.get(subject) || '',
        ...(body ? { 'content-type': 'application/json' } : {}) },
    }, response => {
      const chunks = []; response.on('data', x => chunks.push(x)); response.on('error', reject);
      response.on('end', () => { try {
        const data = JSON.parse(Buffer.concat(chunks)); if (data.token) tokens.set(subject, data.token);
        resolve({ status: response.statusCode, data });
      } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const rows = () => { const db = new DatabaseSync(path, { readOnly: true });
    try { return db.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all(); } finally { db.close(); } };
  return { send, rows, metrics: () => app.accountMetrics(), calls: () => calls,
    advance: ms => { time += ms; }, failSource: () => { sourceFailure = true; } };
}

const selected = 'state?id=' + encodeURIComponent(ID);
const buy = subject => ({ id: 'readiness-' + subject + '-buy-0001', instrumentId: ID,
  currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1' });

test('viewer cache then two recovering traders keeps rejection, no extra provider work or writes, and later readiness is idempotent', async t => {
  const f = await fixture(t), before = f.rows(), writes = f.metrics().sqlWriteCalls;
  const viewer = await f.send('viewer', selected);
  assert.equal(viewer.status, 200); assert.equal(viewer.data.account.canTrade, false);
  assert.equal(viewer.data.readiness, undefined); assert.equal(f.calls(), 1);
  f.advance(100);
  for (const { subject } of traders) {
    const r = await f.send(subject, selected);
    assert.equal(r.status, 200); assert.equal(r.data.account.canTrade, true);
    assert.equal(r.data.errors[ID], 'QUOTE_STALE'); assert.equal(r.data.quotes[ID], undefined);
    assert.deepEqual(r.data.readiness[ID], {
      state: 'WAITING_FOR_QUOTE', reason: 'BEFORE_DEMAND', executable: false,
      quoteTimestamp: NOW, receivedAt: NOW, demandSince: NOW + 100,
    });
    const rejected = await f.send(subject, 'orders', buy(subject));
    assert.equal(rejected.status, 422); assert.equal(rejected.data.error, 'QUOTE_STALE');
  }
  assert.equal(f.calls(), 1, 'the hint never bypasses the shared cache or polls a provider');
  assert.deepEqual(f.rows(), before, 'recovery reads and rejected Market orders cannot change either ledger');
  assert.equal(f.metrics().sqlWriteCalls, writes, 'metadata adds no SQL writes');

  // Drive the existing visible 3 s cadence with an injected clock, not retries.
  f.advance(3000);
  for (const [i, { subject }] of traders.entries()) {
    const current = await f.send(subject, selected);
    assert.equal(current.data.readiness, undefined); assert.equal(current.data.errors[ID], undefined);
    assert.equal(current.data.quotes[ID].status.USDT, 'READY');
    const first = await f.send(subject, 'orders', buy(subject));
    const replay = await f.send(subject, 'orders', buy(subject));
    assert.equal(first.status, 200); assert.equal(replay.status, 200);
    assert.equal(first.data.fills.length, 1); assert.equal(replay.data.fills.length, 1);
    assert.equal(replay.data.wallets.USDT.cash, ((i + 1) * 100 - 10).toFixed(8));
    assert.deepEqual(replay.data.wallets, first.data.wallets);
  }
  assert.equal(f.calls(), 2, 'the genuinely later observation is shared by both accounts');
});

test('source failure and demand release remove the hint without hiding the original failure', async t => {
  const f = await fixture(t);
  await f.send('viewer', selected); f.advance(100);
  const first = await f.send('alice', selected); assert.ok(first.data.readiness[ID]);
  await f.send('alice', 'lease?id=' + encodeURIComponent(ID), undefined, 'DELETE');
  const released = await f.send('alice', 'state');
  assert.equal(released.data.readiness, undefined); assert.equal(released.data.errors[ID], 'QUOTE_STALE');
  await f.send('alice', selected); f.advance(3000); f.failSource();
  const failed = await f.send('alice', selected);
  assert.equal(failed.data.readiness, undefined); assert.equal(failed.data.errors[ID], 'SOURCE_UNAVAILABLE');
  assert.equal(failed.data.fills.length, 0);
});

test('state reads stop presenting a pre-demand hint once its actual quote ages, without fetching or writing', async t => {
  const f = await fixture(t, { quoteAgeMs: 28_000 });
  await f.send('viewer', selected); f.advance(100);
  const waiting = await f.send('alice', selected); assert.ok(waiting.data.readiness[ID]);
  const before = f.rows(), writes = f.metrics().sqlWriteCalls;
  f.advance(3000); // The 12 s demand lease is still valid; receivedAt is now too old.
  const stale = await f.send('alice', 'state');
  assert.equal(stale.data.readiness, undefined); assert.equal(stale.data.errors[ID], 'QUOTE_STALE');
  assert.equal(f.calls(), 1); assert.deepEqual(f.rows(), before);
  assert.equal(f.metrics().sqlWriteCalls, writes);
});
