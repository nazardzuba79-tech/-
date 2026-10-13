import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState, applyQuote, submit, validate, snapshot } from './engine.mjs';
import { CATALOG } from './catalog.mjs';
import { createServer } from './server.mjs';
import { projectViewerQuote } from './viewer-projection.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
const quote = (overrides = {}) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'projection-fixture', capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' }, USDC: { buy: '100', sell: '100' } }, fx: { USDC: { rate: '1', timestamp: NOW, maxAgeMs: 180000, source: 'offline fixture' } }, ...overrides });
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function viewFixture() {
  const state = createState(NOW);
  applyQuote(state, quote(), NOW);
  submit(state, { id: 'projection-buy-usdt-0001', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.5' }, NOW);
  applyQuote(state, quote({ eventId: 'projection-fixture-2' }), NOW);
  submit(state, { id: 'projection-buy-usdc-0001', instrumentId: ID, currency: 'USDC', side: 'BUY', type: 'MARKET', quantity: '0.25' }, NOW);
  submit(state, { id: 'projection-sell-usdt-001', instrumentId: ID, currency: 'USDT', side: 'SELL', type: 'MARKET', quantity: '0.2' }, NOW);
  submit(state, { id: 'projection-limit-usdc-01', instrumentId: ID, currency: 'USDC', side: 'BUY', type: 'LIMIT', quantity: '0.1', limitPrice: '90' }, NOW);
  validate(state);
  return { ...snapshot(state, NOW), account: { id: 'offline-viewer', canTrade: false }, catalogue: CATALOG.map(i => ({ ...i, exists: true, online: true })), errors: { [ID]: 'SOURCE_UNAVAILABLE', other: 'RATE_LIMIT' }, metrics: { requests: 3, cpu: { user: 10, system: 2 } } };
}

test('viewer projection preserves exact engine values and serialized order for holdings, history, reservations and quote validity', () => {
  const view = freeze(viewFixture()), before = JSON.stringify(view);
  for (const patch of [{}, { failed: true }, { verified: false }, { marketOpen: false }]) for (const age of [0, 30001, 61001]) {
    const q = freeze(quote(patch)), expected = snapshot({ ...view, quotes: { ...view.quotes, [ID]: q } }, NOW + age);
    const actual = projectViewerQuote(view, ID, q, NOW + age);
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    assert.deepEqual(actual.wallets, view.wallets);
    assert.deepEqual(actual.orders, view.orders);
    assert.deepEqual(actual.fills, view.fills);
    assert.deepEqual(actual.realized, view.realized);
    assert.notEqual(actual.errors, view.errors);
    assert.notEqual(actual.positions, view.positions);
    delete actual.errors[ID];
    assert.equal(view.errors[ID], 'SOURCE_UNAVAILABLE');
    assert.equal(JSON.stringify(view), before);
  }
});

test('empty-view response metadata retains optional property presence without entering the structured clone', () => {
  for (const shape of ['absent', 'undefined', 'null', 'present']) {
    const view = { ...viewFixture(), ...snapshot(createState(NOW), NOW) };
    for (const key of ['account', 'catalogue', 'metrics']) {
      if (shape === 'absent') delete view[key];
      else if (shape !== 'present') view[key] = shape === 'null' ? null : undefined;
    }
    freeze(view);
    const actual = projectViewerQuote(view, ID, quote(), NOW), expected = snapshot({ ...view, quotes: { ...view.quotes, [ID]: quote() } }, NOW);
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    for (const key of ['account', 'catalogue', 'metrics']) {
      assert.equal(Object.hasOwn(actual, key), Object.hasOwn(view, key));
      assert.equal(actual[key], view[key], 'response-only metadata is reused, not cloned');
    }
  }
});

test('every nonempty ledger category retains the original metadata-cloning projection path', () => {
  const full = viewFixture();
  for (const key of ['orders', 'fills', 'positions', 'adjustments']) {
    const view = { ...full, ...snapshot(createState(NOW), NOW) };
    view[key] = key === 'adjustments' ? [{ at: NOW, currency: 'USDT', amount: '1.00000000' }] : full[key];
    freeze(view);
    const actual = projectViewerQuote(view, ID, quote(), NOW), expected = snapshot({ ...view, quotes: { ...view.quotes, [ID]: quote() } }, NOW);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    for (const metadata of ['account', 'catalogue', 'metrics']) assert.notEqual(actual[metadata], view[metadata], `${key} uses the original full snapshot`);
  }
});

test('projection retains the requested response key even when the source quote identity is malformed', () => {
  const view = freeze(viewFixture()), q = freeze(quote({ instrumentId: 'BYBIT:NV DAXUSDT' }));
  const expected = snapshot({ ...view, quotes: { ...view.quotes, [ID]: q } }, NOW);
  const actual = projectViewerQuote(view, ID, q, NOW);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(Object.hasOwn(actual.quotes, q.instrumentId), false);
});

test('read-only HTTP projections do not persist quotes, mutate test accounts, or bypass the owner gate', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-viewer-projection-'));
  const q = freeze(quote()), list = freeze(CATALOG.map(i => ({ ...i, exists: true, online: true })));
  const listBefore = JSON.stringify(list), quoteBefore = JSON.stringify(q);
  const app = await createServer({ port: 0, accountsPath: join(dir, 'fixture.sqlite'), ownerOnlyMode: true, tradeOwnerSubject: 'owner', autoPoll: false, now: () => NOW,
    authenticate: async req => ({ issuer: 'projection-offline-fixture', subject: req.headers['x-fixture-user'] || 'viewer' }),
    hub: { metrics: {}, catalogue: async () => list, quote: async () => q, history: async () => { throw Error('unused fixture route'); } },
  });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const request = async (path, { user = 'viewer', body, token } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.port}/__stocks_global/${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Fixture-User': user, ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  const initial = await request('state');
  assert.equal(initial.status, 200);
  const views = await Promise.all(Array.from({ length: 4 }, () => request('state?id=' + encodeURIComponent(ID))));
  for (const { status, body } of views) {
    assert.equal(status, 200); assert.equal(body.account.canTrade, false);
    assert.equal(body.quotes[ID].eventId, q.eventId); assert.equal(body.quotes[ID].status.USDT, 'READY');
    for (const key of ['wallets', 'orders', 'fills', 'positions', 'realized', 'revision']) assert.deepEqual(body[key], initial.body[key]);
  }
  const attempted = await request('orders', { token: initial.body.token, body: { id: 'projection-forbidden-01', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1' } });
  assert.equal(attempted.status, 401); assert.equal(attempted.body.error, 'AUTH_REQUIRED');
  const after = await request('state'), other = await request('state', { user: 'other-viewer' });
  assert.deepEqual(after.body.quotes, initial.body.quotes);
  for (const key of ['wallets', 'orders', 'fills', 'positions', 'realized', 'revision']) assert.deepEqual(after.body[key], initial.body[key]);
  assert.notEqual(other.body.account.id, after.body.account.id);
  assert.equal(JSON.stringify(list), listBefore); assert.equal(JSON.stringify(q), quoteBefore);
});
