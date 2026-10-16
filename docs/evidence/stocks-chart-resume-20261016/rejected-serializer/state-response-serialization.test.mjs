import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateResponseSerializer } from './state-response-serialization.mjs';

const catalogue = count => Array.from({ length: count }, (_, index) => ({
  id: `BYBIT:STOCK${index}USDT`, name: `Stock ${index}`, provider: 'bybit',
  sourceSymbol: `STOCK${index}USDT`, currency: 'USDT', online: true,
  display: { price: '101.25000000', change24h: -0.5, timestamp: 1792062793000, source: 'ticker snapshot' },
  sourceError: null,
}));
const state = list => ({
  schema: 1, revision: 4,
  wallets: { USDT: { cash: '10000.00000000', reserved: '0.00000000', available: '10000.00000000' }, USDC: { cash: '9000.00000000', reserved: '0.00000000', available: '9000.00000000' } },
  positions: {}, quotes: {}, orders: [], fills: [], adjustments: [], serverTime: 1792062793000,
  account: { id: 'alice', mode: 'isolated-paper', quoteView: 'volatile', canTrade: false },
  catalogue: list, errors: {}, metrics: { requests: 12, rssBytes: 60000000, cpu: { user: 10, system: 2 }, polling: false }, token: 'fixture-token',
});
const equal = (serializer, body) => assert.equal(serializer.stringify(body), JSON.stringify(body));

test('large-array fallback does not enumerate a descriptor for every fill', () => {
  const serializer = createStateResponseSerializer(), published = serializer.publishCatalogue(catalogue(40));
  const fills = new Proxy(Array.from({ length: 50000 }, (_, id) => ({ id })), {
    ownKeys() { throw new Error('Large fallback array indices must not be enumerated'); },
  });
  equal(serializer, { ...state(published), fills });
});

test('publication owns and deeply freezes the catalogue without mutating its source', () => {
  const serializer = createStateResponseSerializer(), source = catalogue(40);
  const published = serializer.publishCatalogue(source);
  assert.notEqual(published, source); assert.notEqual(published[0], source[0]); assert.notEqual(published[0].display, source[0].display);
  assert.ok(Object.isFrozen(published)); assert.ok(Object.isFrozen(published[0])); assert.ok(Object.isFrozen(published[0].display));
  assert.ok(!Object.isFrozen(source)); assert.ok(!Object.isFrozen(source[0].display));
  assert.equal(JSON.stringify(published), JSON.stringify(source));
  source[0].display.price = '999.00000000'; source.push({ id: 'new' });
  assert.equal(published.length, 40); assert.equal(published[0].display.price, '101.25000000');
  assert.throws(() => { published[0].display.price = '1'; }, TypeError);
  equal(serializer, state(published));
});

test('20/40/250 instrument empty views retain exact bytes, property ordering and live values', () => {
  const serializer = createStateResponseSerializer();
  for (const count of [20, 40, 250]) {
    const published = serializer.publishCatalogue(catalogue(count)), body = state(published);
    equal(serializer, body);
    const previous = serializer.stringify(body);
    body.revision++; body.wallets.USDT.cash = '9900.00000000'; body.wallets.USDT.available = '9900.00000000';
    body.serverTime++; body.metrics.cpu.user++; body.errors[published[0].id] = 'RATE_LIMIT'; body.token = 'next-fixture-token';
    assert.notEqual(serializer.stringify(body), previous); equal(serializer, body);
    const bob = state(published); bob.account.id = 'bob'; bob.token = 'bob-token'; bob.wallets.USDT.cash = '2000.00000000';
    equal(serializer, bob); assert.notEqual(serializer.stringify(body), serializer.stringify(bob));
    assert.equal(body.account.id, 'alice'); assert.equal(bob.account.id, 'bob');
  }
});

test('small positions, quotes, fills, reservations and changed PnL are never cached', () => {
  const serializer = createStateResponseSerializer(), published = serializer.publishCatalogue(catalogue(40)), body = state(published);
  body.positions.a = { instrumentId: published[0].id, quantity: '0.25000000', reserved: '0.10000000', average: '100.00000000', mark: '102.00000000', unrealized: '0.50000000' };
  body.orders.push({ id: 'order-1', instrumentId: published[0].id, status: 'OPEN', quantity: '0.10000000', side: 'SELL' });
  body.fills.push({ orderId: 'earlier-order', quantity: '0.25000000', price: '100.00000000' });
  body.quotes[published[0].id] = { timestamp: body.serverTime, ageSeconds: 0, status: { USDT: 'READY', USDC: 'READY' }, prices: { USDT: { buy: '102.00000000', sell: '102.00000000' }, USDC: { buy: '101.80000000', sell: '101.70000000' } } };
  equal(serializer, body);
  body.positions.a.unrealized = '-0.25000000'; body.positions.a.mark = '99.00000000'; body.quotes[published[0].id].ageSeconds = 500; body.quotes[published[0].id].status.USDT = 'STALE';
  equal(serializer, body);
});

test('large histories keep baseline serialization and every order/fill', () => {
  const serializer = createStateResponseSerializer(), published = serializer.publishCatalogue(catalogue(40)), body = state(published);
  body.orders = Array.from({ length: 10000 }, (_, id) => ({ id: String(id), instrumentId: published[0].id, side: id % 2 ? 'BUY' : 'SELL', quantity: '0.01000000' }));
  body.fills = Array.from({ length: 50000 }, (_, id) => ({ id: String(id), orderId: String(id % 10000), quantity: '0.00100000', price: '100.00000000' }));
  equal(serializer, body);
  body.orders[9999].quantity = '0.02000000'; body.fills[49999].price = '101.00000000'; equal(serializer, body);
  assert.equal(JSON.parse(serializer.stringify(body)).fills.length, 50000);
});

test('replacement invalidates the single fragment; older in-flight and mutable catalogues use their actual values', () => {
  const serializer = createStateResponseSerializer(), first = serializer.publishCatalogue(catalogue(20)), oldView = state(first);
  const next = catalogue(40); next[0].online = false; next[0].sourceError = 'SOURCE_UNAVAILABLE'; next[0].display = null;
  const second = serializer.publishCatalogue(next); equal(serializer, oldView); equal(serializer, state(second));
  const mutable = catalogue(40), mutableView = state(mutable); equal(serializer, mutableView);
  mutable[0].display.price = '2'; equal(serializer, mutableView);
  assert.notEqual(serializer.stringify(state(first)), serializer.stringify(state(second)));
});

test('structural splice ignores nested lookalikes, escaped text and numeric root keys', () => {
  const serializer = createStateResponseSerializer(), published = serializer.publishCatalogue(catalogue(20));
  const lookalike = { catalogue: null, text: '"catalogue":null, {"catalogue":null}', escaped: '\\"catalogue\\":null', unicode: 'Акції 差价合约 😀 \u2028' };
  for (const body of [
    { 2: 'two', 1: 'one', nested: lookalike, catalogue: published, last: null },
    { catalogue: published, nested: [lookalike, { catalogue: [] }] },
    { nested: lookalike, catalogue: published },
    Object.assign(Object.create(null), { nested: lookalike, catalogue: published }),
  ]) equal(serializer, body);
});

test('undefined, holes, special numbers and __proto__ data retain JSON bytes', () => {
  const serializer = createStateResponseSerializer(), source = [{ optional: undefined, value: NaN, low: -Infinity, zero: -0, array: [undefined, , Infinity] }];
  Object.defineProperty(source[0], '__proto__', { value: { ordinary: true }, enumerable: true });
  const published = serializer.publishCatalogue(source);
  assert.equal(JSON.stringify(published), JSON.stringify(source)); assert.ok(Object.hasOwn(published[0], '__proto__'));
  equal(serializer, { absent: undefined, catalogue: published, values: [undefined, , NaN, -0] });
});

test('nonstandard roots and nested serializers preserve original JSON behavior', () => {
  const serializer = createStateResponseSerializer(), published = serializer.publishCatalogue(catalogue(20));
  class Custom { constructor() { this.catalogue = published; } toJSON() { return { custom: true, catalogue: this.catalogue }; } }
  equal(serializer, new Custom()); equal(serializer, undefined); equal(serializer, null); equal(serializer, [published]);
  const body = { catalogue: published, nested: { toJSON(key) { return { key }; } } }; equal(serializer, body);
  let reads = 0;
  const accessor = { catalogue: published, get live() { reads++; return 7; } };
  assert.equal(serializer.stringify(accessor), '{"catalogue":' + JSON.stringify(published) + ',"live":7}'); assert.equal(reads, 1);
  const circular = { catalogue: published }; circular.self = circular;
  assert.throws(() => serializer.stringify(circular), TypeError);
  assert.throws(() => serializer.stringify({ catalogue: published, value: 1n }), TypeError);
});

test('unsupported or oversized publication falls back without invoking source accessors early', () => {
  const serializer = createStateResponseSerializer(), first = serializer.publishCatalogue(catalogue(20));
  let reads = 0; const custom = [{ get id() { reads++; return 'custom'; } }];
  assert.equal(serializer.publishCatalogue(custom), custom); assert.equal(reads, 0);
  equal(serializer, state(first));
  assert.equal(serializer.stringify({ catalogue: custom }), '{"catalogue":[{"id":"custom"}]}'); assert.equal(reads, 1);
  for (const source of [catalogue(1000), [{ text: 'x'.repeat(131073) }], [{ toJSON() { return 'custom'; } }], new Date(0)]) {
    assert.equal(serializer.publishCatalogue(source), source); equal(serializer, { catalogue: source });
  }
});
