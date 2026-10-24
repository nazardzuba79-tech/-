import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { createServer } from './server.mjs';
import { openAccounts } from './accounts.mjs';
import { CATALOG } from './catalog.mjs';
import { setBalances, SimError } from './engine.mjs';
import { twoTraderPolicy, configuredTraders } from './trader-policy.mjs';

// Disposable identities and quotes only. No provider or production requests.
const ID = 'BYBIT:AAPLXUSDT', NOW = 1791569400000;
const traders = ['fixture-alice', 'fixture-bob'].map(subject => ({ issuer: 'fixture-authority', subject }));
const zero = '0.00000000';
async function fixture(t, { provision = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-two-trader-')), accountsPath = join(dir, 'paper.sqlite');
  let time = NOW, price = '100', quoteCalls = 0, authCalls = 0, revoked = false, app;
  if (provision) {
    const repo = openAccounts(accountsPath, { now: () => time });
    for (const [i, principal] of traders.entries()) await repo.forPrincipal(principal).transact((state, now) => setBalances(state, { id: `fixture-provision-${i}`, balances: { USDT: ['731.25', '129.875'][i], USDC: '0' } }, now));
    repo.close();
  }
  const hub = {
    metrics: {}, catalogue: async () => CATALOG.map(i => ({ ...i, exists: true, online: true })),
    quote: async () => { quoteCalls++; return { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: price, ask: price, timestamp: time, receivedAt: time, verified: true, marketOpen: true, eventId: `fixture-${time}`, capacity: '1.00000000', prices: { USDT: { buy: price, sell: price } }, fx: {} }; },
    history: async () => ({ candles: [{ time: NOW / 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 }] }),
  };
  const start = async () => { app = await createServer({ financialEnabled: true, port: 0, accountsPath, tradePrincipals: traders, now: () => time, hub, accountDiagnostics: true, authenticate: async req => {
    authCalls++; if (revoked || !req.headers['x-fixture-subject']) throw new SimError('AUTH_REQUIRED');
    return { issuer: req.headers['x-fixture-issuer'] || 'fixture-authority', subject: req.headers['x-fixture-subject'] };
  } }); };
  await start();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const send = async (path, { subject = traders[0].subject, issuer, body, token, method = body ? 'POST' : 'GET' } = {}) => {
    // Windows ephemeral listeners can receive a Fetch-spec blocked port. The
    // native HTTP client preserves the same 3s deadline without a browser port policy.
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${app.port}/__stocks_global/${path}`, { method, headers: { ...(subject ? { 'x-fixture-subject': subject } : {}), ...(issuer ? { 'x-fixture-issuer': issuer } : {}), ...(body ? { 'content-type': 'application/json', 'x-stocks-token': token || '' } : {}) }, signal: AbortSignal.timeout(3000) }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks)) }); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  };
  const rows = () => { const db = new DatabaseSync(accountsPath, { readOnly: true }); try { return db.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all(); } finally { db.close(); } };
  return { send, rows, metrics: () => app.accountMetrics(), counts: () => ({ quoteCalls, authCalls }), mark: value => { price = value; time += 3000; }, revoke: () => { revoked = true; }, restart: async () => { await app.close(); await start(); } };
}
const statePath = 'state?id=' + encodeURIComponent(ID);
const order = (id, side = 'BUY', quantity = '0.4', extra = {}) => ({ id, instrumentId: ID, currency: 'USDT', side, type: 'MARKET', quantity, ...extra });

test('strict configuration requires exactly two distinct full trusted identities and never echoes them', () => {
  const allowed = twoTraderPolicy(traders);
  for (const p of traders) assert.equal(allowed(p), true);
  assert.equal(allowed({ ...traders[0], issuer: 'other-issuer' }), false);
  assert.equal(allowed({ issuer: traders[0].issuer, subject: 'viewer' }), false);
  for (const invalid of [undefined, [], [traders[0]], [...traders, traders[0]], [traders[0], traders[0]], [{ issuer: '', subject: 'private-value' }, traders[1]]]) assert.throws(() => twoTraderPolicy(invalid), error => error.code === 'AUTH_CONFIG_INVALID' && !error.message.includes('private-value'));
  assert.throws(() => configuredTraders('not-json'), /AUTH_CONFIG_INVALID/);
});

test('50 authenticated viewers use market routes without registration, ledger reads, matcher or financial queue', async t => {
  const f = await fixture(t), before = f.rows(), metrics = f.metrics();
  const results = await Promise.all(Array.from({ length: 50 }, async (_, i) => {
    const subject = `fixture-viewer-${i}`;
    const result = await f.send(statePath, { subject });
    assert.equal(result.status, 200); assert.equal(result.data.account.mode, 'viewer'); assert.equal(result.data.account.canTrade, false);
    assert.equal(result.data.wallets.USDT.cash, zero); assert.deepEqual(result.data.orders, []);
    for (const path of ['history?id=' + encodeURIComponent(ID) + '&interval=1m', 'catalogue', 'portfolio']) assert.equal((await f.send(path, { subject })).status, 200);
    return result;
  }));
  assert.equal(new Set(results.map(r => r.data.account.id)).size, 50);
  assert.equal(f.metrics().queue.accepted, metrics.queue.accepted);
  assert.equal(f.metrics().queue.dispatched, metrics.queue.dispatched);
  assert.equal(f.metrics().sqlCalls, metrics.sqlCalls);
  assert.equal(f.counts().quoteCalls, 1); assert.equal(f.counts().authCalls, 200);
  assert.deepEqual(f.rows(), before);
});

test('viewer forged mutations, wrong issuer and revoked session fail before any account command', async t => {
  const f = await fixture(t), before = f.rows(), metrics = f.metrics();
  for (const identity of [{ subject: 'fixture-viewer' }, { subject: traders[0].subject, issuer: 'different-authority' }]) for (const path of ['orders', 'cancel', 'balances', 'refresh']) {
    const result = await f.send(path, { ...identity, body: {}, token: 'forged' });
    assert.equal(result.status, 401); assert.equal(result.data.error, 'AUTH_REQUIRED');
  }
  assert.equal((await f.send('catalogue', { subject: '' })).status, 401);
  f.revoke(); assert.equal((await f.send('orders', { body: order('revoked-order') })).status, 401);
  assert.equal(f.metrics().queue.accepted, metrics.queue.accepted); assert.deepEqual(f.rows(), before);
});

test('missing strict ledger does not auto-fund; even an allowed trader can read history without registration', async t => {
  const f = await fixture(t, { provision: false });
  assert.equal((await f.send('history?id=' + encodeURIComponent(ID) + '&interval=1m')).status, 200);
  assert.deepEqual(f.rows(), []);
  const result = await f.send(statePath); assert.equal(result.data.error, 'ACCOUNT_NOT_BOUND');
  assert.deepEqual(f.rows(), []);
});

test('both existing nonstandard balances support buy, partial/full sell, limit cancel, idempotency and restart without resets', async t => {
  const f = await fixture(t);
  for (const [i, p] of traders.entries()) {
    const subject = p.subject, initial = await f.send(statePath, { subject });
    assert.equal(initial.status, 200); assert.equal(initial.data.account.canTrade, true); assert.equal(initial.data.account.fundingMode, 'existing-only');
    assert.equal(initial.data.wallets.USDT.cash, ['731.25000000', '129.87500000'][i]);
    const token = initial.data.token;
    const reset = await f.send('balances', { subject, token, body: { id: 'forbidden-reset', balances: { USDT: '10000', USDC: '0' } } });
    assert.equal(reset.data.error, 'BALANCE_EDIT_DISABLED');
    f.mark('100'); await f.send(statePath, { subject });
    const buy = await f.send('orders', { subject, token, body: order(`fixture-trade-buy-${i}`) });
    assert.equal(buy.status, 200, JSON.stringify(buy.data)); assert.equal(buy.data.fills.length, 1);
    const replay = await f.send('orders', { subject, token, body: order(`fixture-trade-buy-${i}`) });
    assert.equal(replay.status, 200); assert.equal(replay.data.fills.length, 1); assert.equal(replay.data.wallets.USDT.cash, buy.data.wallets.USDT.cash);
    f.mark('110'); await f.send(statePath, { subject });
    const partial = await f.send('orders', { subject, token, body: order(`fixture-partial-${i}`, 'SELL', '0.1') });
    assert.equal(partial.status, 200); assert.equal(partial.data.positions[ID + '|USDT'].quantity, '0.30000000');
    f.mark('120'); await f.send(statePath, { subject });
    const full = await f.send('orders', { subject, token, body: order(`fixture-trade-close-${i}`, 'SELL', '0.3') });
    assert.equal(full.status, 200); assert.equal(full.data.positions[ID + '|USDT'].quantity, zero); assert.equal(full.data.realized.USDT, '7.00000000');
    const limit = await f.send('orders', { subject, token, body: order(`fixture-trade-limit-${i}`, 'BUY', '0.1', { type: 'LIMIT', limitPrice: '90' }) });
    assert.equal(limit.status, 200); assert.equal(limit.data.wallets.USDT.reserved, '9.00000000');
    const cancel = await f.send('cancel', { subject, token, body: { id: `fixture-trade-limit-${i}` } });
    assert.equal(cancel.status, 200); assert.equal(cancel.data.wallets.USDT.reserved, zero);
  }
  const before = f.rows(); await f.restart();
  for (const [i, p] of traders.entries()) {
    const reloaded = await f.send('state', { subject: p.subject });
    assert.equal(reloaded.status, 200); assert.equal(reloaded.data.wallets.USDT.cash, ['738.25000000', '136.87500000'][i]);
    assert.equal(reloaded.data.fills.length, 3); assert.equal(reloaded.data.orders.length, 4);
  }
  assert.deepEqual(f.rows(), before);
});
