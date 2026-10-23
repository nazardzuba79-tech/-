import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { MarketHub } from './market.mjs';
import { CATALOG } from './catalog.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
let requestSerial = 0;
const outcome = promise => promise.then(value => ({ value }), error => ({ error: error.code || error.name }));
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function until(predicate) { const end = performance.now() + 1000; while (!predicate()) { assert.ok(performance.now() < end, 'fixture condition must settle before queue timeout'); await tick(); } }
function held(hub) { let release; const promise = hub.historySlot(() => new Promise(resolve => { release = resolve; })); return { release, promise }; }
function fixtureHub({ gate } = {}) {
  let calls = 0;
  const hub = new MarketHub({ now: () => NOW, fetchImpl: async url => {
    calls++;
    if (gate) await gate;
    const parsed = new URL(url), symbol = parsed.searchParams.get('symbol');
    assert.equal(parsed.hostname, 'api.bybit.com');
    assert.equal(parsed.pathname, '/v5/market/kline');
    const rows = Array.from({ length: 600 }, (_, n) => [String(NOW - n * 900000), '100', '101', '99', '100', '10']);
    return Response.json({ retCode: 0, result: { symbol, list: rows } });
  } });
  hub.catalogue = async () => CATALOG.map(i => ({ ...i, exists: true, online: true }));
  return { hub, calls: () => calls };
}
async function httpFixture(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-history-cancel-')), f = fixtureHub(options);
  const app = await createServer({ financialEnabled: true, port: 0, accountsPath: join(dir, 'fixture.sqlite'), now: () => NOW, autoPoll: false, authenticate: async () => ({ issuer: 'history-cancellation-fixture', subject: 'reader' }), hub: f.hub });
  const sockets = new Set();
  app.server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  return { ...f, app };
}
function request(f, suffix = '') {
  const path = '/__stocks_global/history?id=' + encodeURIComponent(ID) + '&interval=15m' + suffix;
  const tag = String(++requestSerial);
  let closeServer, settle;
  const serverClosed = new Promise(resolve => { closeServer = resolve; });
  const hook = (req, res) => { if (req.headers['x-fixture-request'] === tag) { f.app.server.off('request', hook); res.once('close', closeServer); } };
  f.app.server.on('request', hook);
  const result = new Promise(resolve => { settle = resolve; });
  const req = http.get({ host: '127.0.0.1', port: f.app.port, path, agent: false, headers: { 'X-Fixture-Request': tag } }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => settle({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  req.on('error', error => settle({ error: error.code }));
  return { result, async disconnect() { req.destroy(); await serverClosed; } };
}

test('last HTTP history reader disconnect removes queued work before it consumes a provider request', async t => {
  const f = await httpFixture(t), a = held(f.hub), b = held(f.hub);
  t.after(() => { a.release(); b.release(); });
  const reader = request(f);
  await until(() => f.hub.historyQueue.length === 1);
  await reader.disconnect();
  a.release(); b.release(); await Promise.all([a.promise, b.promise]);
  await until(() => f.hub.historyFlights.size === 0);
  assert.equal(f.calls(), 0, 'a disconnected last reader must not spend a provider start');
  assert.equal(f.hub.metrics.requests, 0); assert.equal(f.hub.starts.size, 0);
  assert.equal(f.hub.historyActive, 0); assert.equal(f.hub.historyQueue.length, 0);
  assert.equal(f.hub.metrics.historySerializations, 0);
});

test('disconnecting one HTTP reader preserves a shared queued flight for its live reader', async t => {
  const f = await httpFixture(t), a = held(f.hub), b = held(f.hub);
  t.after(() => { a.release(); b.release(); });
  const gone = request(f), live = request(f);
  await until(() => f.hub.historyQueue.length === 1 && f.hub.metrics.historyCoalesced === 1);
  await gone.disconnect();
  a.release(); b.release(); await Promise.all([a.promise, b.promise]);
  const result = await live.result;
  assert.equal(result.status, 200); assert.equal(result.body.instrumentId, ID);
  assert.equal(result.body.candles.length, 300);
  assert.equal(f.calls(), 1); assert.equal(f.hub.metrics.historyParses, 1);
  assert.equal(f.hub.metrics.historySerializations, 1);
  assert.equal(f.hub.historyActive, 0); assert.equal(f.hub.historyQueue.length, 0);
});

test('a live HTTP cursor follower keeps its earlier queued latest dependency after that HTTP reader disconnects', async t => {
  const f = await httpFixture(t), a = held(f.hub), b = held(f.hub);
  t.after(() => { a.release(); b.release(); });
  const latest = request(f);
  await until(() => f.hub.historyQueue.length === 1);
  const cursor = request(f, '&before=' + (NOW - 900000));
  await until(() => f.hub.historyQueue.length === 2);
  await latest.disconnect();
  a.release(); b.release(); await Promise.all([a.promise, b.promise]);
  const result = await cursor.result;
  assert.equal(result.status, 200); assert.equal(result.body.candles.length, 299);
  assert.equal(f.calls(), 1, 'cursor reuses the required native latest window');
  assert.equal(f.hub.metrics.historyRangeHits, 1); assert.equal(f.hub.metrics.historySerializations, 1);
  assert.equal(f.hub.historyFlights.size, 0); assert.equal(f.hub.historyActive, 0);
});

test('cancelling all queued latest/cursor HTTP readers releases the dependency without a native request', async t => {
  const f = await httpFixture(t), a = held(f.hub), b = held(f.hub);
  t.after(() => { a.release(); b.release(); });
  const latest = request(f); await until(() => f.hub.historyQueue.length === 1);
  const cursor = request(f, '&before=' + (NOW - 900000)); await until(() => f.hub.historyQueue.length === 2);
  await latest.disconnect(); await cursor.disconnect();
  a.release(); b.release(); await Promise.all([a.promise, b.promise]);
  await until(() => f.hub.historyFlights.size === 0);
  assert.equal(f.calls(), 0); assert.equal(f.hub.historyQueue.length, 0); assert.equal(f.hub.historyActive, 0);
});

test('a started native flight survives disconnect and serves a new live HTTP reader without another provider call', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await httpFixture(t, { gate }); t.after(() => release());
  const gone = request(f); await until(() => f.calls() === 1);
  await gone.disconnect();
  assert.equal(f.hub.historyActive, 1); assert.equal(f.hub.metrics.historySerializations, 0);
  const live = request(f); await until(() => f.hub.metrics.historyCoalesced === 1);
  release(); const result = await live.result;
  assert.equal(result.status, 200); assert.equal(result.body.candles.length, 300);
  assert.equal(f.calls(), 1); assert.equal(f.hub.metrics.historySerializations, 1);
  assert.equal(f.hub.historyFlights.size, 0); assert.equal(f.hub.historyActive, 0);
});

test('a cancelled queued generation cannot delete a replacement flight for the same key', async () => {
  const f = fixtureHub(), a = held(f.hub), b = held(f.hub), abort = new AbortController();
  const old = outcome(f.hub.history(ID, '15m', null, { signal: abort.signal }));
  abort.abort();
  const live = f.hub.history(ID), duplicate = f.hub.history(ID);
  assert.deepEqual(await old, { error: 'SOURCE_CANCELLED' });
  assert.equal(f.hub.historyFlights.size, 1); assert.equal(f.hub.historyQueue.length, 1);
  a.release(); b.release();
  const [page, same] = await Promise.all([live, duplicate]); await Promise.all([a.promise, b.promise]);
  assert.equal(page, same); assert.equal(f.calls(), 1);
  assert.equal(f.hub.historyFlights.size, 0); assert.equal(f.hub.historyActive, 0);
});

test('aborted admission and abort after grant do not call the queued callback or leak slot ownership', async () => {
  const f = fixtureHub(), already = new AbortController(); already.abort();
  assert.deepEqual(await outcome(f.hub.history(ID, '15m', null, { signal: already.signal })), { error: 'SOURCE_CANCELLED' });
  const a = held(f.hub), b = held(f.hub), abort = new AbortController(); let started = false;
  const queued = outcome(f.hub.historySlot(() => { started = true; }, { signal: abort.signal }));
  a.release(); queueMicrotask(() => abort.abort());
  assert.deepEqual(await queued, { error: 'SOURCE_CANCELLED' });
  b.release(); await Promise.all([a.promise, b.promise]);
  assert.equal(started, false); assert.equal(f.calls(), 0);
  assert.equal(f.hub.historyActive, 0); assert.equal(f.hub.historyQueue.length, 0);
});
