import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeTrade, OfflineNativeDemand } from './binance-offline.mjs';
import { MarketHub } from '../../stocks-global/market.mjs';
import { createState, applyQuote, submit, quoteStatus } from '../../stocks-global/engine.mjs';

const NOW = 1791918000000, ID = 'BINANCE:AAPLBUSDT', SYMBOL = 'AAPLBUSDT';
const message = (id = 902, time = NOW) => ({ e: 'trade', s: SYMBOL, t: id, T: time, p: '250.12500000', q: '99' });
function fixture() {
  const state = { now: NOW, connections: [], closed: 0 };
  const transport = { offlineFixture: true, open(symbol, handlers) {
    assert.equal(symbol, SYMBOL);
    const entry = { handlers, close() { state.closed++; } };
    state.connections.push(entry); return entry;
  } };
  return { state, demand: new OfflineNativeDemand({ fixtureTransport: transport, now: () => state.now }) };
}

test('offline raw trade mapping equals actual REST adapter event/time/price/capacity; duplicate cannot refill', async () => {
  const hub = new MarketHub({ now: () => NOW, fetchImpl: async address => {
    const u = new URL(address);
    assert.equal(u.hostname, 'api.binance.com');
    if (u.pathname === '/api/v3/trades') return Response.json([{ id: 902, time: NOW, price: '250.12500000' }]);
    if (u.pathname === '/api/v3/ticker/24hr') return Response.json({ symbol: SYMBOL, priceChangePercent: '0', volume: '1000' });
    throw Error('OFFLINE_UNEXPECTED_ENDPOINT');
  } });
  hub.verified.set(ID, { exists: true, online: true, checkedAt: NOW, multiplier: null });
  const rest = await hub.quote(ID, { includeUsdc: false });
  const streamed = nativeTrade(SYMBOL, message(), NOW);
  for (const [key, value] of Object.entries(streamed)) assert.equal(rest[key], value, key);
  const state = createState(NOW);
  applyQuote(state, rest, NOW);
  submit(state, { id: 'offline-native-buy-0001', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.75000000' }, NOW);
  const before = structuredClone(state);
  applyQuote(state, { ...rest, ...streamed }, NOW);
  assert.equal(state.quotes[ID].used, '0.75000000');
  assert.deepEqual(state.fills, before.fills);
  assert.deepEqual(state.wallets, before.wallets);
  assert.equal(quoteStatus(rest, NOW + 60001), 'QUOTE_STALE');
});

test('shared demand has one connection; receive cannot submit, duplicate cannot refresh; no demand shuts down', () => {
  const { state, demand } = fixture(), a = demand.acquire(ID), b = demand.acquire(ID);
  assert.equal(state.connections.length, 1);
  state.connections[0].handlers.message(message());
  assert.deepEqual(a.read(), b.read());
  state.now += 1900;
  state.connections[0].handlers.message(message());
  assert.equal(a.read().receivedAt, NOW);
  state.now += 101;
  assert.equal(a.read(), null);
  a.release(); assert.equal(state.closed, 0);
  b.release(); assert.equal(state.closed, 1);
  state.connections[0].handlers.message(message(903, state.now));
  assert.equal(b.read(), null); assert.equal(demand.entries.size, 0);
  demand.step(); assert.equal(state.connections.length, 1);
});

test('disconnect invalidates generation; bounded reconnect, stale callbacks and cancelled retries stay inert', () => {
  const { state, demand } = fixture(), reader = demand.acquire(ID);
  const first = state.connections[0]; first.handlers.message(message()); first.handlers.disconnect();
  first.handlers.message(message(903)); assert.equal(reader.read(), null);
  state.now += 999; demand.step(); assert.equal(state.connections.length, 1);
  state.now++; demand.step(); assert.equal(state.connections.length, 2);
  first.handlers.disconnect(); // Must not retire a new generation.
  state.connections[1].handlers.message(message(904, state.now)); assert.equal(reader.read().eventId, '904');
  state.connections[1].handlers.disconnect(); state.now += 2000; demand.step();
  assert.equal(state.connections.length, 3);
  state.connections[2].handlers.disconnect(); state.now += 100000; demand.step();
  assert.equal(state.connections.length, 3); assert.equal(reader.read(), null);
  reader.release(); demand.step(); assert.equal(demand.entries.size, 0);
});

test('reject aggregate/ticker/incorrect provider/symbol and invalid or stale native fields', () => {
  for (const change of [{ e: 'aggTrade' }, { e: '24hrTicker' }, { s: 'AAPLXUSDT' },
    { t: Number.MAX_SAFE_INTEGER + 1 }, { T: NOW - 60001 }, { T: NOW + 2001 }, { p: '0' }]) {
    assert.throws(() => nativeTrade(SYMBOL, { ...message(), ...change }, NOW));
  }
  assert.throws(() => new OfflineNativeDemand({ fixtureTransport: {} }), /OFFLINE_FIXTURE_REQUIRED/);
  const { demand } = fixture();
  assert.throws(() => demand.acquire('BYBIT:AAPLXUSDT'), /UNSUPPORTED_CONTRACT/);
  assert.throws(() => demand.acquire('MOEX:TQBR:SBER'), /UNSUPPORTED_CONTRACT/);
});

test('entry/readers are bounded, out-of-order cannot replace current, release is idempotent', () => {
  const { state, demand } = fixture(); demand.maxEntries = 1; demand.maxReaders = 1;
  const a = demand.acquire(ID);
  assert.throws(() => demand.acquire(ID), /DEMAND_LIMIT/);
  assert.throws(() => demand.acquire('BINANCE:NVDABUSDT'), /DEMAND_LIMIT/);
  state.connections[0].handlers.message(message(902));
  state.connections[0].handlers.message(message(901));
  assert.equal(a.read().eventId, '902');
  a.release(); a.release(); assert.equal(state.closed, 1);
  const b = demand.acquire(ID); state.connections[0].handlers.message(message(903));
  assert.equal(b.read(), null); demand.close(); assert.equal(state.closed, 2);
  assert.equal(b.read(), null);
});

test('synchronous open failure returns releasable demand and retains a bounded retry', () => {
  let now = NOW, calls = 0;
  const demand = new OfflineNativeDemand({ now: () => now, fixtureTransport: {
    offlineFixture: true, open() { calls++; throw Error('OFFLINE_OPEN_FAILURE'); },
  } });
  const a = demand.acquire(ID);
  assert.equal(demand.entries.get(ID).readers, 1); assert.equal(a.read(), null);
  now += 1000; demand.step(); assert.equal(calls, 2);
  a.release(); assert.equal(demand.entries.size, 0);
  now += 10000; demand.step(); assert.equal(calls, 2);
});

test('synchronous disconnect during open cannot retain the returned obsolete handle', () => {
  let now = NOW, calls = 0, closes = 0;
  const demand = new OfflineNativeDemand({ now: () => now, fixtureTransport: {
    offlineFixture: true, open(symbol, handlers) {
      calls++; handlers.disconnect(); return { close() { closes++; } };
    },
  } });
  const a = demand.acquire(ID);
  assert.equal(demand.entries.get(ID).connection, null); assert.equal(closes, 1);
  now += 1000; demand.step(); assert.equal(calls, 2); assert.equal(closes, 2);
  a.release(); now += 10000; demand.step(); assert.equal(calls, 2);
});

test('native string price boundaries match unchanged actual REST truncation policy', async () => {
  for (const price of ['250', '250.1', '250.125000000', '250.123456789', '0.000000019']) {
    const hub = new MarketHub({ now: () => NOW, fetchImpl: async address => {
      const u = new URL(address);
      if (u.pathname === '/api/v3/trades') return Response.json([{ id: 902, time: NOW, price }]);
      if (u.pathname === '/api/v3/ticker/24hr') return Response.json({ symbol: SYMBOL, priceChangePercent: '0', volume: '1' });
      throw Error('OFFLINE_UNEXPECTED_ENDPOINT');
    } });
    hub.verified.set(ID, { exists: true, online: true, checkedAt: NOW, multiplier: null });
    const actual = await hub.quote(ID, { includeUsdc: false });
    assert.equal(nativeTrade(SYMBOL, { ...message(), p: price }, NOW).bid, actual.bid, price);
  }
  assert.throws(() => nativeTrade(SYMBOL, { ...message(), p: '0.000000001' }, NOW));
});

test('a throwing close cannot retain generations or prevent cleanup attempts for other entries', () => {
  const handlers = [], closes = [];
  const demand = new OfflineNativeDemand({ now: () => NOW, fixtureTransport: {
    offlineFixture: true, open(symbol, callbacks) {
      handlers.push(callbacks);
      return { close() { closes.push(symbol); if (symbol === SYMBOL) throw Error('OFFLINE_CLOSE_FAILURE'); } };
    },
  } });
  const a = demand.acquire(ID), b = demand.acquire('BINANCE:NVDABUSDT');
  const result = demand.close();
  assert.deepEqual(closes, [SYMBOL, 'NVDABUSDT']); assert.equal(result.attempted, 2);
  assert.equal(result.cleanupFailureCount, 1); assert.equal(result.cleanupErrors[0].unresolved, true);
  handlers[0].message(message()); assert.equal(a.read(), null); assert.equal(b.read(), null);
  assert.equal(demand.entries.size, 0); a.release(); b.release();
  assert.equal(closes.length, 2); // No claim that the failed underlying close succeeded.
});

test('last release and obsolete synchronous-open handles report close failures without orphan demand', () => {
  for (const synchronousDisconnect of [false, true]) {
    const demand = new OfflineNativeDemand({ now: () => NOW, fixtureTransport: {
      offlineFixture: true, open(symbol, callbacks) {
        if (synchronousDisconnect) callbacks.disconnect();
        return { close() { throw Error('OFFLINE_CLOSE_FAILURE'); } };
      },
    } });
    const a = demand.acquire(ID); a.release();
    assert.equal(demand.entries.size, 0); assert.equal(demand.cleanupFailureCount, 1);
    assert.equal(demand.cleanupErrors[0].unresolved, true);
  }
});
