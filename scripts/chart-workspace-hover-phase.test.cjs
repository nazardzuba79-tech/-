'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { installCandleFetchObserver, installCandleTimerObserver, selectRefreshPhase,
  hoverVerdict, attachCandlePhase, dataWindowReady, latestPrimaryTail } = require('./chart-workspace-hover-phase.cjs');

const nativeUrl = 'http://127.0.0.1:4435/api/v1/market/futures/candles/BTC-USDT?interval=1h&limit=520';
const sites = [
  ['http://127.0.0.1:4435/assets/index.js', 272, 3245],
  ['http://127.0.0.1:4435/assets/index.js', 272, 3289],
  ['http://127.0.0.1:4435/assets/TerminalPremium.js', 3, 169288],
];
const stack = sites.map(([url, line, column]) => `    at caller (${url}:${line}:${column})`).join('\n');
function fixture() {
  const timer = { id: 1, delay: 5000, scheduledAt: 100, active: true, stack, fires: [{ tick: 1, at: 5100 }] };
  const fetch = { url: '/market/futures/candles/BTC-USDT?interval=1h&limit=520',
    originalUrl: 'https://market.voltextech.net/market/futures/candles/BTC-USDT?interval=1h&limit=520',
    nativeUrl, at: 5101, state: 'fulfilled', status: 200, finishedAt: 5120 };
  const request = { id: '1', url: nativeUrl, method: 'GET', finished: true, status: 200,
    initiator: { stack: { description: 'await', callFrames: [], parent: {
      description: 'setInterval', callFrames: sites.map(([url, line, column]) => ({ url, lineNumber: line - 1, columnNumber: column - 1 })),
    } } } };
  return { timer, fetch, request, snapshot: { at: 5300, epoch: 1005300, fetches: [fetch], timers: { timers: [timer], overflow: false } } };
}
function browser() {
  let now = 0, nextHandle = 0;
  const scheduled = new Map(), calls = [], clears = [];
  const nativePromise = Promise.resolve({ status: 200 });
  const w = {
    location: { origin: 'http://127.0.0.1:4435' }, performance: { now: () => now }, __qa: { fetches: [] },
    fetch(...args) { calls.push(args); return nativePromise; },
    setInterval(callback, delay, ...args) { const handle = ++nextHandle; scheduled.set(handle, { callback, delay, args }); return handle; },
    clearInterval(handle) { clears.push(handle); scheduled.delete(handle); },
  };
  // Same serialization used by bootstrap/Playwright; no hidden Node closure.
  vm.runInNewContext(`(${installCandleFetchObserver.toString()})(window); (${installCandleTimerObserver.toString()})(window);`,
    { window: w, URL, Promise, Error });
  return { w, calls, scheduled, clears, nativePromise, time: value => { now = value; } };
}

test('fetch observer preserves response/options and both original and rewritten URLs', async () => {
  const b = browser(), options = { signal: new AbortController().signal };
  const result = b.w.fetch('https://market.voltextech.net/market/futures/candles/BTC-USDT?interval=1h&limit=520', options);
  assert.equal(await result, await b.nativePromise);
  assert.equal(b.calls[0][0], '/api/v1/market/futures/candles/BTC-USDT?interval=1h&limit=520');
  assert.equal(b.calls[0][1], options);
  assert.equal(b.w.__qa.fetches[0].nativeUrl, nativeUrl);
  assert.match(b.w.__qa.fetches[0].originalUrl, /^https:\/\/market\.voltextech\.net\//);
  assert.equal(b.w.__qa.fetches[0].state, 'fulfilled');
});

test('fetch observer retains blocked attempts without sending them externally', async () => {
  const b = browser();
  await assert.rejects(b.w.fetch('https://unexpected.example/candles/BTC-USDT'), /External network blocked/);
  assert.equal(b.calls.length, 0);
  assert.equal(b.w.__qa.fetches.length, 1);
  assert.equal(b.w.__qa.fetches[0].state, 'rejected');
});

for (const handled of [true, false]) test(`actual global rejection event is ${handled ? 'absent for a handled' : 'retained for an ignored'} fetch failure`, () => {
  // Use an isolated real process/global Promise lifecycle, not mocked event
  // dispatch. The ignored case must report the exact caller-facing promise
  // and original Error; the handled case must not invent a global error.
  const child = spawnSync(process.execPath, ['-e', `
    const { installCandleFetchObserver } = require(${JSON.stringify(require.resolve('./chart-workspace-hover-phase.cjs'))});
    const reason = new Error('qa-observer-original-fetch-failure');
    const events = []; let caught = false;
    const w = { location: { origin: 'http://127.0.0.1:4435' }, performance,
      __qa: { fetches: [] }, fetch: () => Promise.reject(reason) };
    installCandleFetchObserver(w);
    const returned = w.fetch('/api/v1/market/futures/candles/BTC-USDT');
    process.on('unhandledRejection', (error, promise) => events.push({ sameError: error === reason, samePromise: promise === returned }));
    if (${handled}) returned.catch(error => { caught = error === reason; });
    setImmediate(() => setImmediate(() => console.log(JSON.stringify({ events, caught, state: w.__qa.fetches[0].state }))));
  `], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const result = JSON.parse(child.stdout.trim());
  assert.deepEqual(result.events, handled ? [] : [{ sameError: true, samePromise: true }]);
  assert.equal(result.caught, handled); assert.equal(result.state, 'rejected');
});

test('non-Error rejection reasons are rethrown unchanged instead of diagnostic TypeErrors', async () => {
  for (const reason of [null, undefined, 'abort reason', 42]) {
    const w = { location: { origin: 'http://127.0.0.1:4435' }, performance,
      __qa: { fetches: [] }, fetch: () => Promise.reject(reason) };
    installCandleFetchObserver(w);
    const result = await w.fetch(nativeUrl).then(() => ({ fulfilled: true }), error => ({ error }));
    assert.deepEqual(result, { error: reason }); assert.equal(w.__qa.fetches[0].state, 'rejected');
  }
});

test('pre-hover readiness accepts the visible prompt without reading candle rows or text', () => {
  const panel = { getBoundingClientRect: () => ({ width: 220, height: 90 }),
    querySelectorAll() { throw new Error('Pre-hover rows do not exist'); },
    get textContent() { throw new Error('Pre-hover UTC does not exist'); } };
  let compare = false, visible = true;
  const doc = { querySelector: selector => selector === '[data-cw-data-window]' ? panel
    : selector === '[data-chart-state="candles"]' ? {} : compare ? {} : null,
    defaultView: { getComputedStyle: () => ({ display: visible ? 'block' : 'none', visibility: 'visible' }) } };
  assert.equal(dataWindowReady(doc), true);
  compare = true; assert.equal(dataWindowReady(doc), false);
  compare = false; visible = false; assert.equal(dataWindowReady(doc), false);
  // Exercise the browser-serialized function/default document as Playwright does.
  visible = true;
  assert.equal(vm.runInNewContext(`(${dataWindowReady.toString()})()`, { document: doc }), true);
});

test('abort observation preserves initial state and later timestamp without changing fetch results', async () => {
  const b = browser(), controller = new AbortController();
  const promise = b.w.fetch(nativeUrl, { signal: controller.signal });
  assert.equal(await promise, await b.nativePromise);
  const row = b.w.__qa.fetches[0];
  assert.equal(row.hasSignal, true); assert.equal(row.abortedAtStart, false);
  b.time(123); controller.abort(); assert.equal(row.abortedAt, 123); assert.equal(row.state, 'fulfilled');
  b.time(200); await b.w.fetch(nativeUrl, { signal: controller.signal });
  assert.equal(b.w.__qa.fetches[1].abortedAtStart, true); assert.equal(b.w.__qa.fetches[1].abortedAt, 200);
});

test('native interval delay, return handle, this, arguments and cancellation are preserved', () => {
  const b = browser(), receiver = {}, invoked = [];
  const handle = b.w.setInterval(function (...args) { invoked.push({ receiver: this, args }); return 'value'; }, 5000, 'arg');
  const native = b.scheduled.get(handle); assert.equal(native.delay, 5000);
  b.time(5000); assert.equal(native.callback.apply(receiver, native.args), 'value');
  b.time(10000); native.callback.apply(receiver, native.args);
  assert.equal(invoked.length, 2); assert.equal(invoked[0].receiver, receiver); assert.deepEqual(invoked[0].args, ['arg']);
  assert.deepEqual(Array.from(b.w.__qaCandleTimers.timers[0].fires, row => row.at), [5000, 10000]);
  b.w.clearInterval(handle); assert.deepEqual(b.clears, [handle]); assert.equal(b.w.__qaCandleTimers.timers[0].active, false);
  const other = () => {}; const nonChart = b.w.setInterval(other, 4000);
  assert.equal(b.scheduled.get(nonChart).callback, other);
});

test('phase requires CDP async interval ancestry, successful body EOF and exact original cadence', () => {
  const f = fixture(), phase = selectRefreshPhase(f.snapshot, f.request, 5000);
  assert.equal(phase.timerId, 1); assert.equal(phase.deadline, 10100);
  assert.equal(phase.fetch, f.fetch); assert.equal(phase.fire, f.timer.fires[0]);
  // Async fetch has no synchronous timer marker; matching is from CDP ancestry.
  assert.equal(f.fetch.timer, undefined);
});

test('primary identity excludes actual Futures endTime history and fallback pagination, never counter rows', () => {
  const tail = { nativeUrl }, rows = [tail,
    ...['endTime', 'end', 'before', 'from', 'startTime'].map(key => ({ nativeUrl: `${nativeUrl}&${key}=1792065600000` }))];
  assert.equal(latestPrimaryTail(rows, 'futures'), tail);
  assert.equal(latestPrimaryTail(rows.slice(1), 'futures'), undefined);
  assert.equal(rows.length, 6); // history remains in the ALL-fetch evidence/count
  const spotTail = { nativeUrl: nativeUrl.replace('/futures/', '/external/') };
  assert.equal(latestPrimaryTail([spotTail, { nativeUrl: `${spotTail.nativeUrl}&endTime=1792065600000` }], 'spot'), spotTail);
  assert.equal(latestPrimaryTail(rows, 'spot'), undefined);
});

for (const [name, change, code] of [
  ['non-interval request', f => { delete f.request.initiator.stack.parent; }, 'CANDLE_PHASE_TIMER_AMBIGUOUS'],
  ['ambiguous timer', f => { f.snapshot.timers.timers.push({ ...f.timer, id: 2 }); }, 'CANDLE_PHASE_TIMER_AMBIGUOUS'],
  ['stopped timer', f => { f.timer.active = false; }, 'CANDLE_PHASE_TIMER_AMBIGUOUS'],
  ['unfinished body', f => { f.request.finished = false; }, 'CANDLE_PHASE_REFRESH_FAILED'],
  ['unsuccessful response', f => { f.request.status = 503; }, 'CANDLE_PHASE_REFRESH_FAILED'],
  ['previous poll', f => { f.timer.fires[0].at = 4999; }, 'CANDLE_PHASE_NOT_A_NEW_POLL'],
  ['near deadline', f => { f.snapshot.at = 9700; }, 'CANDLE_PHASE_EXPIRED'],
  ['overflow', f => { f.snapshot.timers.overflow = true; }, 'CANDLE_PHASE_EVIDENCE_OVERFLOW'],
]) test(`readiness rejects ${name}`, () => {
  const f = fixture(); change(f); assert.throws(() => selectRefreshPhase(f.snapshot, f.request, 5000), error => error.code === code);
});

test('one hover-triggered OTHER-symbol request fails the unchanged all-candle counter', async () => {
  const b = browser();
  const handle = b.w.setInterval(() => b.w.fetch(nativeUrl), 5000);
  b.time(5000); await b.scheduled.get(handle).callback();
  const timer = b.w.__qaCandleTimers.timers[0], before = b.w.__qa.fetches.filter(row => /candles/.test(row.url)).length;
  const phase = { fire: { tick: 1 }, deadline: 10000 };
  for (let i = 0; i < 20; i += 1) {
    b.time(5100 + i * 15);
    if (i === 7) await b.w.fetch('/api/v1/market/external/candles/ETH-USDT?interval=1h&limit=520');
  }
  b.time(5785); // full 400ms after last modeled move, not a shortened window
  const after = b.w.__qa.fetches.filter(row => /candles/.test(row.url)).length;
  const result = hoverVerdict({ phase, before, after, finishedAt: 5785, pending: 0, timer });
  assert.equal(result.ok, false); assert.equal(result.requestsDuringHover, 1);
  assert.deepEqual(result.reasons, ['CANDLE_FETCH_DURING_HOVER']);
  // Observation did not stop the ordinary next refresh.
  b.time(10000); await b.scheduled.get(handle).callback(); assert.equal(b.calls.length, 3);
});

test('zero calls alone cannot pass an expired, pending or changed polling phase', () => {
  const f = fixture(), phase = selectRefreshPhase(f.snapshot, f.request, 5000);
  const input = { phase, before: 1, after: 1, finishedAt: 6000, pending: 0, timer: f.timer };
  assert.equal(hoverVerdict(input).ok, true);
  assert.deepEqual(hoverVerdict({ ...input, finishedAt: 10100 }).reasons, ['CANDLE_PHASE_EXPIRED']);
  assert.deepEqual(hoverVerdict({ ...input, pending: 1 }).reasons, ['CANDLE_REQUEST_STILL_PENDING']);
  assert.deepEqual(hoverVerdict({ ...input, timer: { ...f.timer, active: false } }).reasons, ['CANDLE_POLL_PHASE_CHANGED']);
});

async function attached() {
  const f = fixture(), session = new EventEmitter(), scripts = [];
  session.send = async () => {};
  let snapshot = { at: 5000, epoch: 1005000, fetches: [{ ...f.fetch, at: 1000 }], timers: f.snapshot.timers };
  const page = { on() {}, addInitScript: async source => scripts.push(source), context: () => ({ newCDPSession: async () => session }),
    evaluate: async () => structuredClone(snapshot) };
  const phase = await attachCandlePhase(page);
  return { f, phase, session, scripts, set: value => { snapshot = value; } };
}
function emitRequest(session, request, wallTime = 1005.101) {
  session.emit('Network.requestWillBeSent', { requestId: request.id, type: 'Fetch', wallTime, timestamp: wallTime,
    request: { url: request.url, method: 'GET' }, initiator: request.initiator });
}

test('barrier awaits first successful primary and EVERY candle body before starting', async () => {
  const b = await attached(); let resolved = false;
  const promise = b.phase.nextPrimaryRefresh('futures').then(value => { resolved = true; return value; });
  await new Promise(setImmediate);
  const other = { ...b.f.request, id: 'other', url: nativeUrl.replace('BTC-USDT', 'ETH-USDT') };
  emitRequest(b.session, other); emitRequest(b.session, b.f.request);
  b.set({ ...b.f.snapshot, fetches: [...b.f.snapshot.fetches, { nativeUrl: other.url, url: other.url, state: 'pending', at: 5100 }] });
  b.session.emit('Network.responseReceived', { requestId: '1', response: { status: 200 } });
  b.session.emit('Network.loadingFinished', { requestId: '1', timestamp: 1005.120 });
  await new Promise(setImmediate); assert.equal(resolved, false);
  b.set({ ...b.f.snapshot, fetches: [...b.f.snapshot.fetches, { nativeUrl: other.url, url: other.url, state: 'fulfilled', at: 5100, status: 200 }] });
  b.session.emit('Network.loadingFinished', { requestId: 'other', timestamp: 1005.200 });
  const result = await promise;
  assert.equal(result.phase.requestId, '1'); assert.equal(result.phase.fire.tick, 1);
  assert.match(b.scripts[0].content, /\)\(window\);$/);
});

test('failed first refresh is not retried or replaced with a later success', async () => {
  const b = await attached(), promise = b.phase.nextPrimaryRefresh('futures');
  const rejected = assert.rejects(promise, error => error.code === 'CANDLE_PHASE_REFRESH_FAILED');
  await new Promise(setImmediate); emitRequest(b.session, b.f.request);
  b.session.emit('Network.responseReceived', { requestId: '1', response: { status: 503 } });
  await rejected;
  emitRequest(b.session, { ...b.f.request, id: '2' }, 1010.101);
  b.session.emit('Network.responseReceived', { requestId: '2', response: { status: 200 } });
  b.session.emit('Network.loadingFinished', { requestId: '2', timestamp: 1010.120 });
});
