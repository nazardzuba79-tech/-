import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteReader } from './server.mjs';
import { SimError } from './engine.mjs';

// Synthetic transport observations only. No browser, database or external requests.
const NOW = 1_800_000_000_000;
const outcome = fn => {
  try { return Promise.resolve(fn()).then(value => ({ value }), error => ({ error })); }
  catch (error) { return Promise.resolve({ error }); }
};
const flush = async () => { for (let n = 0; n < 32; n++) await Promise.resolve(); };
const code = result => result.error?.code;
const quoteValue = (id, includeUsdc = true) => ({ instrumentId: id, timestamp: NOW,
  eventId: 'observation-' + id, prices: { USDT: { buy: '10.00000000', sell: '9.00000000' },
    ...(includeUsdc ? { USDC: { buy: '9.90099010', sell: '8.91089108' } } : {}) } });

function fixture(t) {
  let mono = 0, wall = NOW, nextTimer = 0, onTimerCancelled = () => {};
  const timers = new Map(), calls = [], allowed = [];
  const schedule = (fn, delay) => {
    const timer = { id: ++nextTimer, at: mono + delay, fn, unref() {} };
    timers.set(timer.id, timer); return timer;
  };
  const cancelTimer = timer => { timers.delete(timer?.id); onTimerCancelled(timer); };
  const hold = (kind, id, includeUsdc, native) => {
    let yes, no;
    const promise = new Promise((resolve, reject) => { yes = resolve; no = reject; });
    const call = { kind, id, includeUsdc, native, done: false,
      resolve(value = kind === 'fx' ? { ...native, prices: { ...native.prices, USDC: quoteValue(id).prices.USDC } } : quoteValue(id, includeUsdc)) {
        assert.equal(call.done, false, 'a provider call settles exactly once'); call.done = true; yes(value);
      },
      reject(error) { assert.equal(call.done, false); call.done = true; no(error); } };
    calls.push(call); return promise;
  };
  const hub = {
    quote: (id, { includeUsdc = true } = {}) => hold('native', id, includeUsdc),
    withUsdcPrices: value => hold('fx', value.instrumentId, true, value),
  };
  const quote = createQuoteReader({ hub, now: () => wall, monotonicNow: () => mono,
    sourceAllowed: id => { allowed.push(id); if (id === 'BLOCKED') throw new SimError('SOURCE_UNAVAILABLE'); },
    schedule, cancelTimer });
  const read = (id, options) => outcome(() => quote(id, options));
  const advance = (ms, fire = true) => {
    mono += ms; wall += ms;
    if (fire) for (const timer of [...timers.values()].sort((a, b) => a.at - b.at)) {
      if (timer.at <= mono && timers.delete(timer.id)) timer.fn();
    }
  };
  const pending = (id, kind = 'native') => calls.find(call => !call.done && call.id === id && call.kind === kind);
  const drain = async () => {
    for (let n = 0; n < 512; n++) {
      await flush(); const call = calls.find(item => !item.done);
      if (call) call.resolve();
      else if (quote.metrics().active === 0 && quote.metrics().queued === 0) return;
    }
    assert.fail('queue did not settle after all finite deferred provider calls were released');
  };
  t.after(async () => {
    const closing = quote.close();
    for (let n = 0; n < 512; n++) {
      await flush(); const call = calls.find(item => !item.done);
      if (call) call.resolve(); else break;
    }
    await closing;
  });
  return { quote, read, hub, calls, timers, allowed, advance, pending, drain,
    onTimerCancel: callback => { onTimerCancelled = callback; } };
}

function idle(f) {
  const { active, queued, waiters, flights } = f.quote.metrics();
  assert.deepEqual({ active, queued, waiters, flights }, { active: 0, queued: 0, waiters: 0, flights: 0 });
  assert.equal(f.timers.size, 0, 'no admission timer remains after settlement');
}

test('a twenty-instrument cold burst admits at most two active jobs and drains bounded queued work', async t => {
  const f = fixture(t), jobs = Array.from({ length: 20 }, (_, n) => f.read('asset-' + n));
  await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.quote.metrics().active, 2);
  assert.equal(f.quote.metrics().queued, 18); assert.equal(f.quote.metrics().flights, 20);
  await f.drain();
  const results = await Promise.all(jobs);
  results.forEach((result, n) => { assert.equal(result.error, undefined); assert.equal(result.value.instrumentId, 'asset-' + n); });
  assert.equal(f.calls.length, 20); assert.equal(f.quote.metrics().started, 20);
  assert.equal(f.quote.metrics().maxActive, 2); assert.equal(f.quote.metrics().maxQueued, 18);
  idle(f);
  const warm = await Promise.all(Array.from({ length: 20 }, (_, n) => f.read('asset-' + n)));
  assert.ok(warm.every(result => !result.error)); assert.equal(f.calls.length, 20, 'warm reads do not start providers');
  idle(f);
});

test('same-instrument queued readers share one admission and do not consume extra pending capacity', async t => {
  const f = fixture(t), a = f.read('active-a'), b = f.read('active-b');
  const followers = Array.from({ length: 20 }, () => f.read('shared'));
  await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.quote.metrics().queued, 1); assert.equal(f.quote.metrics().flights, 3);
  assert.ok(f.quote.metrics().coalesced >= 19);
  f.pending('active-a').resolve(); await flush();
  assert.equal(f.calls.filter(call => call.id === 'shared').length, 1);
  await f.drain(); const results = await Promise.all([a, b, ...followers]);
  assert.ok(results.every(result => !result.error));
  results.slice(2).forEach(result => assert.equal(result.value.instrumentId, 'shared'));
  assert.equal(f.calls.length, 3); idle(f);
});

test('pending admission is capped at thirty-two distinct jobs and rejects excess without executing them', async t => {
  const f = fixture(t), active = [f.read('a'), f.read('b')];
  const queued = Array.from({ length: 32 }, (_, n) => f.read('q-' + n));
  const rejected = await f.read('overflow');
  assert.equal(code(rejected), 'SOURCE_BUSY'); assert.equal(f.quote.metrics().queued, 32);
  assert.equal(f.quote.metrics().active, 2); assert.equal(f.calls.length, 2);
  const shared = f.read('q-0'); await flush();
  assert.equal(f.quote.metrics().queued, 32, 'a duplicate can share an existing queue entry at capacity');
  await f.drain(); assert.ok((await Promise.all([...active, ...queued, shared])).every(result => !result.error));
  assert.equal(f.calls.some(call => call.id === 'overflow'), false);
  assert.equal(f.quote.metrics().maxQueued, 32); assert.ok(f.quote.metrics().rejected >= 1); idle(f);
});

test('total outstanding readers are capped at 256 even when they all coalesce onto one instrument', async t => {
  const f = fixture(t), readers = Array.from({ length: 256 }, () => f.read('shared'));
  assert.equal(code(await f.read('shared')), 'SOURCE_BUSY'); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.quote.metrics().waiters, 256);
  f.pending('shared').resolve();
  assert.ok((await Promise.all(readers)).every(result => !result.error)); await flush(); idle(f);
  assert.equal(f.calls.length, 1);
});

test('cancelling one queued reader preserves survivors; cancelling the final queued reader prevents dispatch', async t => {
  const f = fixture(t), active = [f.read('a'), f.read('b')], abort = new AbortController(), last = new AbortController();
  const cancelled = f.read('shared', { signal: abort.signal }), survivor = f.read('shared');
  const abandoned = f.read('abandoned', { signal: last.signal }); await flush();
  abort.abort(); last.abort();
  assert.equal(code(await cancelled), 'SOURCE_BUSY'); assert.equal(code(await abandoned), 'SOURCE_BUSY');
  assert.equal(f.quote.metrics().queued, 1); assert.equal(f.calls.length, 2);
  await f.drain(); assert.ok((await Promise.all([...active, survivor])).every(result => !result.error));
  assert.equal(f.calls.filter(call => call.id === 'shared').length, 1);
  assert.equal(f.calls.some(call => call.id === 'abandoned'), false);
  assert.ok(f.quote.metrics().cancelled >= 2); idle(f);
});

test('cancelled active readers cannot release a provider slot before the underlying operation settles', async t => {
  const f = fixture(t), abort = new AbortController();
  const gone = f.read('a', { signal: abort.signal }), b = f.read('b'), queued = f.read('c'); await flush();
  abort.abort(); assert.equal(code(await gone), 'SOURCE_BUSY'); await flush();
  assert.equal(f.quote.metrics().active, 2); assert.equal(f.calls.length, 2); assert.equal(f.quote.metrics().queued, 1);
  const survivor = f.read('a'); await flush(); assert.equal(f.calls.length, 2, 'a live follower reuses the still-active request');
  f.pending('a').resolve(); await flush(); assert.equal(f.calls.length, 3);
  await f.drain(); assert.ok((await Promise.all([b, queued, survivor])).every(result => !result.error)); idle(f);
});

test('already-cancelled readers create no job, provider call, admission timer or waiter', async t => {
  const f = fixture(t), abort = new AbortController(); abort.abort();
  assert.equal(code(await f.read('a', { signal: abort.signal })), 'SOURCE_BUSY');
  assert.equal(f.calls.length, 0); idle(f);
});

test('delayed expiry timers cannot dispatch an old queued generation or renew its deadline for followers', async t => {
  const f = fixture(t), a = f.read('a'), b = f.read('b'), expired = f.read('old');
  await flush();
  f.advance(1000, false); const lateFollower = f.read('old'), live = f.read('live');
  f.advance(1000, false); f.pending('a').resolve(); await flush();
  assert.equal(code(await expired), 'SOURCE_BUSY'); assert.equal(code(await lateFollower), 'SOURCE_BUSY');
  assert.equal(f.calls.some(call => call.id === 'old'), false);
  assert.ok(f.pending('live'), 'the next unexpired waiter receives the released slot');
  await f.drain(); assert.ok((await Promise.all([a, b, live])).every(result => !result.error));
  assert.ok(f.quote.metrics().expired >= 1); idle(f);
});

test('expiry after slot grant but before continuation does not call the provider and releases the slot', async t => {
  const f = fixture(t), a = f.read('a'), b = f.read('b'), pending = f.read('expired');
  await flush();
  const queuedTimer = [...f.timers.values()][0];
  f.onTimerCancel(timer => { if (timer === queuedTimer) queueMicrotask(() => f.advance(1, false)); });
  f.advance(1999, false); f.pending('a').resolve();
  assert.equal(code(await pending), 'SOURCE_BUSY');
  assert.equal(f.quote.metrics().started, 3, 'the expired continuation had already been granted the third instrument permit');
  assert.equal(f.calls.some(call => call.id === 'expired'), false);
  const recovery = f.read('later'); await flush(); assert.ok(f.pending('later'));
  await f.drain(); assert.ok((await Promise.all([a, b, recovery])).every(result => !result.error)); idle(f);
});

test('cancellation after slot grant cannot start the provider and releases the granted permit', async t => {
  const f = fixture(t), abort = new AbortController(), a = f.read('a'), b = f.read('b');
  const cancelled = f.read('cancelled', { signal: abort.signal }); await flush();
  const queuedTimer = [...f.timers.values()][0];
  f.onTimerCancel(timer => { if (timer === queuedTimer) queueMicrotask(() => abort.abort()); });
  f.pending('a').resolve(); assert.equal(code(await cancelled), 'SOURCE_BUSY'); await flush();
  assert.equal(f.quote.metrics().started, 3, 'cancellation occurs after grant, before the provider continuation');
  assert.equal(f.calls.some(call => call.id === 'cancelled'), false);
  const later = f.read('later'); await flush(); assert.ok(f.pending('later'));
  await f.drain(); assert.ok((await Promise.all([a, b, later])).every(result => !result.error)); idle(f);
});

test('the actual queue expiry callback drops pending work without imposing a new deadline on active work', async t => {
  const f = fixture(t), a = f.read('a'), b = f.read('b'), queued = f.read('expired'); await flush();
  f.advance(2000);
  assert.equal(code(await queued), 'SOURCE_BUSY'); await flush();
  assert.equal(f.quote.metrics().queued, 0); assert.equal(f.quote.metrics().active, 2);
  assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
  f.advance(5000); await f.drain();
  assert.ok((await Promise.all([a, b])).every(result => !result.error), 'already-started work remains governed by its underlying provider contract'); idle(f);
});

test('cancelled queued generation cleanup cannot delete a live replacement with the same key', async t => {
  const f = fixture(t), a = f.read('a'), b = f.read('b'), abort = new AbortController();
  const old = f.read('same', { signal: abort.signal }); abort.abort();
  const replacement = f.read('same'), duplicate = f.read('same');
  assert.equal(code(await old), 'SOURCE_BUSY'); await flush();
  assert.equal(f.quote.metrics().queued, 1); await f.drain();
  assert.ok((await Promise.all([a, b, replacement, duplicate])).every(result => !result.error));
  assert.equal(f.calls.filter(call => call.id === 'same').length, 1); idle(f);
});

test('FX promotion retains the original instrument slot and native cache age through its completion', async t => {
  const f = fixture(t), native = f.read('a', { includeUsdc: false }), full = f.read('a'), b = f.read('b'), queued = f.read('c');
  await flush(); assert.equal(f.calls.length, 2); assert.equal(f.quote.metrics().active, 2);
  f.advance(100, false); f.pending('a').resolve(); const nativeResult = await native; await flush();
  assert.equal(nativeResult.value.prices.USDC, undefined); assert.ok(f.pending('a', 'fx'));
  assert.equal(f.quote.metrics().active, 2); assert.equal(f.quote.metrics().queued, 1);
  assert.equal(f.calls.some(call => call.id === 'c'), false, 'native completion cannot release an ongoing full observation');
  f.advance(1800, false); f.pending('a', 'fx').resolve(); const fullResult = await full; await flush();
  assert.equal(fullResult.value.timestamp, nativeResult.value.timestamp);
  assert.equal(fullResult.value.eventId, nativeResult.value.eventId);
  assert.deepEqual(fullResult.value.prices.USDT, nativeResult.value.prices.USDT);
  assert.equal(nativeResult.value.prices.USDC, undefined, 'FX promotion cannot mutate a response-only quote');
  assert.ok(f.pending('c')); await f.drain(); assert.ok((await Promise.all([b, queued])).every(result => !result.error));
  const callsBefore = f.calls.length; f.advance(200, false);
  const expired = f.read('a'); await flush();
  assert.equal(f.calls.length, callsBefore + 1, 'FX completion must not restart the original two-second native cache lifetime');
  await f.drain(); assert.equal((await expired).error, undefined); idle(f);
});

test('FX continuation of an admitted native request does not reapply an expired queue deadline', async t => {
  const f = fixture(t), native = f.read('a', { includeUsdc: false }); await flush();
  f.advance(2500); const full = f.read('a'); await flush();
  assert.equal(f.quote.metrics().active, 1); assert.equal(f.calls.length, 1);
  f.pending('a').resolve(); await native; await flush();
  assert.ok(f.pending('a', 'fx'), 'FX promotion belongs to the same already-admitted operation');
  f.pending('a', 'fx').resolve(); assert.equal((await full).error, undefined); await flush(); idle(f);
});

test('cancelling every full reader before FX starts preserves native readers without fetching unused conversion', async t => {
  for (const phase of ['queued', 'awaiting-native']) {
    const f = fixture(t), blockers = phase === 'queued' ? [f.read('block-a'), f.read('block-b')] : [];
    const abortA = new AbortController(), abortB = new AbortController();
    const native = f.read('asset', { includeUsdc: false });
    const fullA = f.read('asset', { signal: abortA.signal }), fullB = f.read('asset', { signal: abortB.signal });
    await flush(); abortA.abort(); abortB.abort();
    assert.equal(code(await fullA), 'SOURCE_BUSY', phase); assert.equal(code(await fullB), 'SOURCE_BUSY', phase);
    if (phase === 'queued') { f.pending('block-a').resolve(); await flush(); }
    assert.ok(f.pending('asset'), phase + ': the native reader still dispatches');
    assert.equal(f.calls.filter(call => call.kind === 'fx').length, 0, phase);
    f.pending('asset').resolve(); const result = await native; await flush();
    assert.equal(result.error, undefined, phase); assert.equal(result.value.prices.USDC, undefined);
    assert.equal(f.calls.filter(call => call.kind === 'fx').length, 0, phase + ': native completion cannot revive cancelled FX demand');
    await f.drain(); assert.ok((await Promise.all(blockers)).every(item => !item.error));
    const laterFull = f.read('asset'); await flush();
    assert.ok(f.pending('asset', 'fx'), phase + ': a later full reader can still upgrade');
    assert.equal(f.calls.filter(call => call.id === 'asset' && call.kind === 'native').length, 1, 'upgrade uses the original cached native observation');
    f.pending('asset', 'fx').resolve(); const upgraded = await laterFull; await flush();
    assert.equal(upgraded.error, undefined); assert.ok(upgraded.value.prices.USDC);
    assert.equal(upgraded.value.timestamp, result.value.timestamp); assert.equal(upgraded.value.eventId, result.value.eventId);
    assert.equal(result.value.prices.USDC, undefined); idle(f);
  }
});

test('an unused queued full promise cannot poison a new full reader of the still-running native flight', async t => {
  const f = fixture(t), a = f.read('a'), b = f.read('b'), abort = new AbortController();
  const native = f.read('asset', { includeUsdc: false }), unused = f.read('asset', { signal: abort.signal });
  await flush(); abort.abort(); assert.equal(code(await unused), 'SOURCE_BUSY');
  f.pending('a').resolve(); await flush();
  assert.ok(f.pending('asset')); assert.equal(f.calls.filter(call => call.kind === 'fx').length, 0);
  const liveFull = f.read('asset'); await flush();
  f.pending('asset').resolve(); const result = await native; await flush();
  assert.ok(f.pending('asset', 'fx'), 'cleared unused promotion permits a later full subscriber before native completion');
  f.pending('asset', 'fx').resolve(); const upgraded = await liveFull;
  assert.equal(upgraded.error, undefined); assert.ok(upgraded.value.prices.USDC);
  assert.equal(result.value.prices.USDC, undefined);
  assert.equal(f.calls.filter(call => call.id === 'asset' && call.kind === 'native').length, 1);
  assert.equal(f.calls.filter(call => call.id === 'asset' && call.kind === 'fx').length, 1);
  await f.drain(); assert.ok((await Promise.all([a, b])).every(item => !item.error)); idle(f);
});

test('cancelling all full subscribers after FX starts retains the permit and drains the existing conversion', async t => {
  const f = fixture(t), abortA = new AbortController(), abortB = new AbortController();
  const native = f.read('asset', { includeUsdc: false }), fullA = f.read('asset', { signal: abortA.signal });
  const fullB = f.read('asset', { signal: abortB.signal }), b = f.read('b'), queued = f.read('c');
  await flush(); f.pending('asset').resolve(); await native; await flush(); assert.ok(f.pending('asset', 'fx'));
  abortA.abort(); abortB.abort(); assert.equal(code(await fullA), 'SOURCE_BUSY'); assert.equal(code(await fullB), 'SOURCE_BUSY'); await flush();
  assert.equal(f.quote.metrics().active, 2); assert.equal(f.quote.metrics().queued, 1);
  assert.equal(f.calls.some(call => call.id === 'c'), false, 'cancelled subscribers cannot release active FX capacity early');
  f.pending('asset', 'fx').resolve(); await flush(); assert.ok(f.pending('c'));
  await f.drain(); assert.ok((await Promise.all([b, queued])).every(item => !item.error)); idle(f);
  const reused = await f.read('asset'); assert.ok(reused.value.prices.USDC);
  assert.equal(f.calls.filter(call => call.id === 'asset' && call.kind === 'fx').length, 1);
});

test('the shared quote cache keeps its eighty-entry bound and does not renew source timestamps', async t => {
  const f = fixture(t);
  for (let n = 0; n < 81; n++) {
    const result = f.read('cache-' + n); await flush(); f.pending('cache-' + n).resolve();
    assert.equal((await result).value.timestamp, NOW);
  }
  const retained = await f.read('cache-80'); assert.equal(retained.value.timestamp, NOW); assert.equal(f.calls.length, 81);
  const evicted = f.read('cache-0'); await flush(); assert.equal(f.calls.length, 82);
  f.pending('cache-0').resolve(); assert.equal((await evicted).value.timestamp, NOW); await flush(); idle(f);
});

test('source rejection and provider failures preserve exact errors, release admission and permit a later attempt', async t => {
  const f = fixture(t); assert.equal(code(await f.read('BLOCKED')), 'SOURCE_UNAVAILABLE');
  assert.equal(f.calls.length, 0);
  for (const errorCode of ['RATE_LIMIT', 'SOURCE_UNAVAILABLE', 'INVALID_DATA']) {
    const first = f.read('a'), failure = new SimError(errorCode); await flush(); f.pending('a').reject(failure);
    const rejected = await first; assert.equal(rejected.error, failure); await flush(); idle(f);
  }
  const recovered = f.read('a'); await flush(); assert.equal(f.calls.length, 4);
  f.pending('a').resolve(); assert.equal((await recovered).error, undefined); await flush(); idle(f);
});

test('shutdown rejects queued and new readers while draining already-started native and FX operations', async t => {
  const f = fixture(t), native = f.read('a', { includeUsdc: false }), full = f.read('a'), b = f.read('b'), queued = f.read('c');
  await flush(); f.pending('a').resolve(); await native; await flush(); assert.ok(f.pending('a', 'fx'));
  let closed = false; const closing = f.quote.close().then(() => { closed = true; }); await flush();
  assert.equal(code(await queued), 'SOURCE_BUSY'); assert.equal(code(await f.read('new')), 'SOURCE_BUSY');
  assert.equal(closed, false); assert.equal(f.quote.metrics().active, 2); assert.equal(f.quote.metrics().queued, 0);
  f.pending('a', 'fx').resolve(); await flush(); assert.equal(closed, false);
  f.pending('b').resolve(); await closing;
  assert.ok((await Promise.all([full, b])).every(result => !result.error));
  assert.equal(f.calls.some(call => call.id === 'c' || call.id === 'new'), false); idle(f);
});
