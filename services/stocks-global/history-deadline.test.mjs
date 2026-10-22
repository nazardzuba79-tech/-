import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from './market.mjs';

const outcome = promise => promise.then(value => ({ value }), error => ({ error: error.code }));
function held(hub) { let release; const promise = hub.historySlot(() => new Promise(resolve => { release = resolve; })); return { promise, release }; }

test('delayed timer delivery cannot admit expired history work; the next live waiter retains FIFO and budget', async () => {
  let time = 0, calls = 0;
  const hub = new MarketHub({ monotonicNow: () => time, fetchImpl: async () => { calls++; return new Response('{}'); } });
  const a = held(hub), b = held(hub), started = [];
  const old = outcome(hub.historySlot(() => { started.push('expired'); return hub.request('https://api.binance.com/api/v3/time'); }));
  time = 1000;
  const live = outcome(hub.historySlot(() => { started.push('live'); return hub.request('https://api.binance.com/api/v3/time'); }));
  const last = outcome(hub.historySlot(() => { started.push('last'); return 'last'; }));
  time = 2000; // No timer callback has run, but the first waiter's deadline elapsed.
  a.release();
  assert.deepEqual(await old, { error: 'SOURCE_BUSY' });
  assert.deepEqual(await live, { value: {} });
  assert.deepEqual(await last, { value: 'last' });
  b.release(); await Promise.all([a.promise, b.promise]);
  assert.deepEqual(started, ['live', 'last']);
  assert.equal(calls, 1); assert.equal(hub.metrics.requests, 1);
  assert.equal(hub.starts.get('api.binance.com').length, 1);
  assert.equal(hub.historyActive, 0); assert.equal(hub.historyQueue.length, 0);
});

test('a waiter expiring after slot grant but before its continuation never starts and releases the slot', async () => {
  let time = 0, started = false;
  const hub = new MarketHub({ monotonicNow: () => time, fetchImpl: () => { throw Error('provider must not be called'); } });
  const a = held(hub), b = held(hub);
  const pending = outcome(hub.historySlot(() => { started = true; return hub.request('https://api.binance.com/api/v3/time'); }));
  time = 1999; a.release();
  queueMicrotask(() => { time = 2000; });
  assert.deepEqual(await pending, { error: 'SOURCE_BUSY' });
  b.release(); await Promise.all([a.promise, b.promise]);
  assert.equal(started, false); assert.equal(hub.metrics.requests, 0);
  assert.equal(hub.historyActive, 0); assert.equal(hub.historyQueue.length, 0);
  assert.equal(await hub.historySlot(() => 'recovered'), 'recovered');
});

test('two active and eight waiting history slots stay bounded; expired queue drain permits later recovery', async () => {
  let time = 0, started = 0;
  const hub = new MarketHub({ monotonicNow: () => time });
  const a = held(hub), b = held(hub);
  const queued = Array.from({ length: 8 }, () => outcome(hub.historySlot(() => { started++; })));
  assert.deepEqual(await outcome(hub.historySlot(() => { started++; })), { error: 'SOURCE_BUSY' });
  assert.equal(hub.historyActive, 2); assert.equal(hub.historyQueue.length, 8);
  time = 2001; a.release();
  for (const result of await Promise.all(queued)) assert.deepEqual(result, { error: 'SOURCE_BUSY' });
  b.release(); await Promise.all([a.promise, b.promise]);
  assert.equal(started, 0); assert.equal(hub.historyActive, 0); assert.equal(hub.historyQueue.length, 0);
  assert.equal(await hub.historySlot(() => 'later'), 'later');
});
