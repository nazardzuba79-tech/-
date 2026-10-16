'use strict';

// Synthetic unit inputs only. These are not provider observations or quotes
// for any browser preview, public page, financial operation or live acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { READY_TIMEOUT_MS, evaluateSelectedQuote, sameQuoteEpoch, observeSelectedQuote } = require('./cfd-workspace-quote-readiness.cjs');

const at = iso => Date.parse(iso);
const NOW = at('2026-01-08T12:00:00.000Z');
const STATS = ['price', 'change', 'high', 'low', 'updated', 'status'];
function fixture() {
  return {
    symbol: 'XAUUSD', now: NOW,
    dom: { requestedSymbol: 'XAUUSD', activeSymbol: 'XAUUSD', headerSymbol: 'XAUUSD',
      ticker: '3,800.12', ticket: '≈ 3,800.12', stats: [...STATS], status: 'open' },
    ticker: { sequence: 1, status: 200, complete: true, body: {
      source: 'voltex-multi-source-display',
      tickers: [{ symbol: 'XAUUSD', price: '3800.12', provider: 'biquote', providerSymbol: 'XAUUSD',
        asOf: NOW, providerTimestamp: NOW, fetchedAt: NOW, status: 'live', stale: false,
        marketClosed: false, displayOnly: true, executionAllowed: false }],
      _display: { mode: 'snapshot', capturedAt: NOW, refreshMs: 21600000 },
    } },
    daily: { sequence: 2, status: 200, complete: true, body: {
      symbol: 'XAUUSD', interval: '1d', bars: [
        { openTime: '2026-01-07T00:00:00.000Z', open: '3760', high: '3795', low: '3740', close: '3780', isOpen: false },
        { openTime: '2026-01-08T00:00:00.000Z', open: '3790', high: '3820', low: '3770', close: '3800.12', isOpen: true },
      ], _display: { mode: 'snapshot', capturedAt: NOW, refreshMs: 21600000 },
    } },
  };
}
const row = value => value.ticker.body.tickers[0];
function ready(value) {
  const result = evaluateSelectedQuote(value);
  assert.equal(result.ready, true, JSON.stringify(result.reasons));
  assert.ok(typeof result.epoch === 'string' && result.epoch.length > 0);
  assert.deepEqual(result.reasons, []);
  return result;
}
function rejected(value, label) {
  let result;
  assert.doesNotThrow(() => { result = evaluateSelectedQuote(value); }, label);
  assert.equal(result.ready, false, label);
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, label);
  assert.ok(result.reasons.every(reason => typeof reason === 'string' && reason.length > 0), label);
}

test('selected quote readiness needs the matching rendered quote and its own daily sessions', () => {
  const value = fixture(), before = structuredClone(value);
  ready(value);
  assert.deepEqual(value, before, 'readiness must not rewrite input observations');
  const numeric = fixture(); row(numeric).price = 3800.12;
  numeric.daily.body.bars.forEach(bar => { bar.openTime = Date.parse(bar.openTime); });
  ready(numeric);
});

test('another priced instrument never substitutes for an unavailable selected quote', () => {
  for (const selected of [null, { symbol: 'XAUUSD', price: null }, { symbol: 'XAUUSD', price: 'NaN' }]) {
    const value = fixture();
    value.ticker.body.tickers = [{ ...row(value), symbol: 'EURUSD', providerSymbol: 'EURUSD', price: '1.09' }, selected].filter(Boolean);
    rejected(value, 'a priced EURUSD row cannot establish XAUUSD readiness');
  }
});

test('every selected DOM identity must match the requested instrument', () => {
  for (const key of ['requestedSymbol', 'activeSymbol', 'headerSymbol']) for (const wrong of ['EURUSD', '', null, undefined]) {
    const value = fixture(); value.dom[key] = wrong;
    rejected(value, key + ' must name XAUUSD');
  }
  const value = fixture(); value.symbol = 'EURUSD'; rejected(value, 'changing the requested symbol cannot reuse XAUUSD');
});

test('ticker and ticket must both show the selected numeric quote, with supported display formatting', () => {
  const plain = fixture(); plain.dom.ticker = '3800.12'; plain.dom.ticket = '≈3800.12'; ready(plain);
  for (const key of ['ticker', 'ticket']) for (const text of ['', '—', 'NaN', 'Infinity', '3800.13', '3799.12', 'EURUSD 3800.12', true, null]) {
    const value = fixture(); value.dom[key] = text;
    rejected(value, key + ' malformed or different quote: ' + String(text));
  }
});

test('malformed selected quote prices cannot become readiness through numeric coercion', () => {
  for (const price of [null, undefined, true, false, '', ' ', 'NaN', 'Infinity', NaN, Infinity, -Infinity,
    0, -1, '0', '-1', '3800.12junk', 'junk3800.12', {}, [], ['3800.12']]) {
    const value = fixture(); row(value).price = price;
    rejected(value, 'invalid quote price ' + String(price));
  }
});

test('all six original stats remain required rather than accepting any priced row or canvas', () => {
  for (const missing of STATS) {
    const value = fixture(); value.dom.stats = STATS.filter(stat => stat !== missing);
    rejected(value, 'missing original stat ' + missing);
  }
  const value = fixture(); value.dom.stats = []; rejected(value, 'empty stats are not ready');
});

test('source, provider and explicit display-only non-executable flags are required', () => {
  for (const missing of ['', ' ', null, undefined]) {
    const value = fixture(); value.ticker.body.source = missing; rejected(value, 'missing source');
    for (const key of ['provider', 'providerSymbol']) {
      const changed = fixture(); row(changed)[key] = missing; rejected(changed, 'missing ' + key);
    }
  }
  for (const value of [false, undefined, 'true']) {
    const changed = fixture(); row(changed).displayOnly = value; rejected(changed, 'displayOnly must be boolean true');
  }
  for (const value of [true, undefined, 'false', 0]) {
    const changed = fixture(); row(changed).executionAllowed = value; rejected(changed, 'executionAllowed must be boolean false');
  }
});

test('acquisition and quote timestamps must be finite, positive and never in the future', () => {
  const invalid = [null, undefined, true, false, '', '2026-01-08T12:00:00Z', NaN, Infinity, -Infinity, 0, -1, NOW + 50];
  for (const key of ['asOf', 'fetchedAt']) for (const time of invalid) {
    const value = fixture(); row(value)[key] = time; rejected(value, 'invalid ' + key + ': ' + String(time));
  }
  for (const time of invalid) {
    const value = fixture(); value.ticker.body._display.capturedAt = time;
    rejected(value, 'invalid snapshot capture: ' + String(time));
  }
  const absent = fixture(); delete absent.ticker.body._display; rejected(absent, 'snapshot capture is required');
});

test('ticker and daily observations both require the exact client snapshot envelope', () => {
  for (const kind of ['ticker', 'daily']) {
    for (const envelope of [undefined, null, {}, [], 'snapshot']) {
      const value = fixture(); value[kind].body._display = envelope;
      rejected(value, kind + ' missing or malformed snapshot envelope');
    }
    for (const mode of [undefined, null, '', ' ', 'live', 'SNAPSHOT', true]) {
      const value = fixture(); value[kind].body._display.mode = mode;
      rejected(value, kind + ' invalid snapshot mode ' + String(mode));
    }
    for (const refreshMs of [undefined, null, false, '21600000', 0, 21599999, 21600001, NaN, Infinity]) {
      const value = fixture(); value[kind].body._display.refreshMs = refreshMs;
      rejected(value, kind + ' invalid client refresh interval ' + String(refreshMs));
    }
    for (const capturedAt of [undefined, null, false, String(NOW), 0, -1, NaN, Infinity, NOW + 50]) {
      const value = fixture(); value[kind].body._display.capturedAt = capturedAt;
      rejected(value, kind + ' invalid snapshot capture ' + String(capturedAt));
    }
  }
  const oldCapture = fixture(); oldCapture.now += 14 * 24 * 60 * 60 * 1000;
  row(oldCapture).status = 'stale'; row(oldCapture).stale = true;
  ready(oldCapture); // Envelope validity is not financial execution freshness admission.
});

test('display readiness does not impose a new financial freshness limit or require an open session', () => {
  const sampled = fixture(); sampled.now += 20 * 60 * 1000; row(sampled).status = 'stale'; row(sampled).stale = true;
  ready(sampled);
  const closed = fixture(); closed.now = at('2026-01-10T12:00:00.000Z');
  row(closed).status = 'market_closed'; row(closed).marketClosed = true; closed.dom.status = 'closed';
  ready(closed);
});

test('only the documented display-route quote statuses can establish readiness', () => {
  for (const status of ['unknown', ' ', '', 'unavailable', 'sampled', 'closed', 'LIVE', null, undefined]) {
    const value = fixture(); row(value).status = status;
    rejected(value, 'unsupported provider quote status ' + String(status));
  }
});

test('incomplete, unsuccessful or non-JSON ticker and daily observations fail readiness', () => {
  for (const key of ['ticker', 'daily']) {
    for (const patch of [{ complete: false }, { complete: undefined }, { status: 503 }, { status: 304 },
      { status: 0 }, { body: null }, { body: 'not JSON' }, { body: [] }, { error: 'provider_timeout', body: null }]) {
      const value = fixture(); value[key] = { ...value[key], ...patch }; rejected(value, key + ' is not a complete successful observation');
    }
    const value = fixture(); value[key] = null; rejected(value, 'missing ' + key);
  }
  for (const tickers of [null, {}, [], [null], [false], ['XAUUSD']]) {
    const value = fixture(); value.ticker.body.tickers = tickers; rejected(value, 'invalid ticker rows');
  }
});

test('daily data must identify the selected instrument and use the daily interval', () => {
  for (const patch of [{ symbol: 'EURUSD' }, { symbol: 'USOIL' }, { symbol: '' }, { symbol: undefined },
    { interval: '1h' }, { interval: '15m' }, { interval: undefined }, { bars: null }, { bars: [] }]) {
    const value = fixture(); Object.assign(value.daily.body, patch); rejected(value, 'wrong daily identity or shape');
  }
});

test('invalid daily prices, OHLC ranges and timestamps cannot satisfy selected stats readiness', () => {
  for (const index of [0, 1]) {
    for (const key of ['open', 'high', 'low', 'close']) for (const number of [true, false, null, '', NaN, Infinity, 0, -1, 'invalid']) {
      const value = fixture(); value.daily.body.bars[index][key] = number; rejected(value, 'invalid daily ' + key);
    }
    for (const time of [null, true, '', 'not-a-time', NaN, Infinity, 0, -1]) {
      const value = fixture(); value.daily.body.bars[index].openTime = time; rejected(value, 'invalid daily timestamp');
    }
    for (const patch of [{ high: '1' }, { low: '9999' }]) {
      const value = fixture(); Object.assign(value.daily.body.bars[index], patch); rejected(value, 'invalid daily range');
    }
  }
  const duplicate = fixture(); duplicate.daily.body.bars[1].openTime = duplicate.daily.body.bars[0].openTime;
  rejected(duplicate, 'duplicate times provide no quote-day session');
});

test('daily session must contain the quote timestamp and have a previous closed session within five days', () => {
  for (const bars of [[fixture().daily.body.bars[0]], [fixture().daily.body.bars[1]]]) {
    const value = fixture(); value.daily.body.bars = bars; rejected(value, 'both session dependencies are required');
  }
  const wrongDay = fixture(); row(wrongDay).asOf = at('2026-01-06T12:00:00.000Z'); rejected(wrongDay, 'quote day absent');
  const wideGap = fixture(); wideGap.daily.body.bars[0].openTime = '2026-01-02T00:00:00.000Z'; rejected(wideGap, 'six-day previous-session gap');
  const fiveDays = fixture(); fiveDays.daily.body.bars[0].openTime = '2026-01-03T00:00:00.000Z'; ready(fiveDays);
  const openPrevious = fixture(); openPrevious.daily.body.bars[0].isOpen = true; rejected(openPrevious, 'previous session must be closed');
  const weekend = fixture(); weekend.now = at('2026-01-12T12:00:00.000Z');
  Object.assign(row(weekend), { asOf: weekend.now, providerTimestamp: weekend.now, fetchedAt: weekend.now });
  weekend.ticker.body._display.capturedAt = weekend.now; weekend.daily.body._display.capturedAt = weekend.now;
  weekend.daily.body.bars[0].openTime = '2026-01-09T00:00:00.000Z'; weekend.daily.body.bars[1].openTime = '2026-01-12T00:00:00.000Z';
  ready(weekend);
});

test('epoch equality accepts the same complete observations and refuses either unready side', () => {
  const before = ready(fixture()), after = ready(structuredClone(fixture()));
  assert.equal(sameQuoteEpoch(before, after), true);
  for (const [left, right] of [[{ ...before, ready: false }, after], [before, { ...after, ready: false }],
    [{ ready: false, epoch: null }, { ready: false, epoch: null }]]) assert.equal(sameQuoteEpoch(left, right), false);
});

test('epoch changes when quote acquisition changes even if the rendered price stays identical', () => {
  const original = ready(fixture());
  const changes = [
    value => { value.ticker.body.source = 'unit-other-display-source'; },
    value => { row(value).asOf -= 1000; },
    value => { row(value).providerTimestamp -= 1000; },
    value => { row(value).fetchedAt -= 1000; },
    value => { value.ticker.body._display.capturedAt -= 1000; },
    value => { row(value).provider = 'unit-secondary-provider'; },
    value => { row(value).providerSymbol = 'UNIT_XAUUSD'; },
  ];
  for (const change of changes) {
    const value = fixture(); change(value); const newer = ready(value);
    assert.notEqual(newer.epoch, original.epoch); assert.equal(sameQuoteEpoch(original, newer), false);
  }
});

test('epoch binds the quote price and daily response content rather than the visible stat labels alone', () => {
  const original = ready(fixture());
  const price = fixture(); row(price).price = '3801.12'; price.dom.ticker = '3,801.12'; price.dom.ticket = '≈ 3,801.12';
  assert.equal(sameQuoteEpoch(original, ready(price)), false);
  const revisedDaily = fixture(); revisedDaily.daily.body.bars[0].close = '3781';
  assert.equal(sameQuoteEpoch(original, ready(revisedDaily)), false);
  const capturedDaily = fixture(); capturedDaily.daily.body._display.capturedAt -= 1000;
  assert.equal(sameQuoteEpoch(original, ready(capturedDaily)), false);
});

// These page/CDP doubles emit existing browser observations only. They perform
// no requests and never start a real browser or contact a quote provider.
const ORIGIN = 'https://unit-cfd.invalid';
const tickerUrl = ORIGIN + '/api/v1/cfd/display/tickers';
const dailyUrl = symbol => ORIGIN + '/api/v1/cfd/display/candles/' + symbol + '?interval=1d&limit=20';
const jsonBytes = value => Buffer.from(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flushObservationTasks() {
  // Advance only the finite promise chains in response parsing, never wall time.
  for (let step = 0; step < 16; step += 1) await Promise.resolve();
}
function controlledTimers(t) {
  let next = 0;
  const scheduled = [], active = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = { id: ++next, callback: () => callback(...args), delay };
    scheduled.push(timer); active.set(timer.id, timer); return timer.id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { active.delete(id); });
  return { scheduled, active, fire(timer) {
    assert.equal(active.delete(timer.id), true, 'only a pending timer may fire');
    timer.callback();
  } };
}
async function observerHarness(dom = fixture().dom) {
  const page = new EventEmitter(), cdp = new EventEmitter();
  const commands = [], requests = [], captures = [];
  cdp.send = async (...args) => { commands.push(args); };
  page.context = () => ({ newCDPSession: async target => { assert.equal(target, page); return cdp; } });
  page.evaluate = async () => structuredClone(dom);
  for (const method of ['goto', 'reload', 'route', 'request', 'addInitScript']) {
    page[method] = () => { throw Error('observer must not initiate browser work: ' + method); };
  }
  const observer = await observeSelectedQuote(page, { origin: ORIGIN, record: evidence => captures.push(evidence) });
  assert.deepEqual(commands, [['Network.enable']]);
  assert.equal(captures.length, 1); assert.equal(captures[0], observer.evidence);
  const request = (kind, options = {}) => {
    const item = {
      url: () => options.url || (kind === 'ticker' ? tickerUrl : dailyUrl(options.symbol || 'XAUUSD')),
      method: () => 'GET', resourceType: () => 'fetch',
      timing: () => ({ startTime: NOW, requestStart: 2, responseStart: 4, responseEnd: 6 }),
      failure: () => ({ errorText: options.failure || 'net::ERR_CONNECTION_RESET' }),
    };
    requests.push(item); page.emit('request', item); return item;
  };
  const respond = (item, body, options = {}) => {
    page.emit('response', {
      request: () => item, status: () => options.status ?? 200,
      fromServiceWorker: () => options.fromServiceWorker ?? false,
      allHeaders: async () => options.headers || { 'content-type': 'application/json' },
      body: async () => body instanceof Promise ? body : Buffer.isBuffer(body) ? body : jsonBytes(body),
    });
  };
  const send = (kind, body, options = {}) => { const item = request(kind, options); respond(item, body, options); return item; };
  const assertPassive = count => {
    assert.equal(requests.length, count, 'observation must not issue a replacement request');
    assert.deepEqual(commands, [['Network.enable']], 'CDP must only enable observational events');
  };
  return { page, cdp, observer, commands, requests, request, respond, send, assertPassive };
}
async function observedFixture(harness) {
  const input = fixture();
  harness.send('ticker', input.ticker.body); harness.send('daily', input.daily.body);
  await flushObservationTasks();
  const state = await harness.observer.snapshot('XAUUSD');
  assert.equal(state.ready, true, state.reasons.join(','));
  return state;
}

test('observer waits for the delayed selected body without adding requests or extending the 45-second deadline', async t => {
  t.mock.method(performance, 'now', () => 1000);
  const timers = controlledTimers(t), h = await observerHarness(), delayed = deferred(), input = fixture();
  h.send('daily', input.daily.body);
  h.send('ticker', delayed.promise);
  await flushObservationTasks();
  const pending = await h.observer.snapshot('XAUUSD');
  assert.equal(pending.ready, false); assert.equal(pending.tickerSequence, 2);
  const waiting = h.observer.wait('XAUUSD');
  await flushObservationTasks();
  assert.equal(READY_TIMEOUT_MS, 45_000);
  const deadlineTimer = timers.scheduled[0];
  assert.equal(deadlineTimer.delay, 45_000);
  const poll = [...timers.active.values()];
  assert.equal(poll.length, 1); assert.equal(poll[0].delay, 100);
  delayed.resolve(jsonBytes(input.ticker.body));
  await flushObservationTasks();
  timers.fire(poll[0]);
  const result = await waiting;
  assert.equal(result.ready, true, result.reasons.join(','));
  assert.equal(h.observer.evidence.readiness.length, 1);
  const receipt = h.observer.evidence.readiness[0];
  assert.equal(receipt.deadline - receipt.startedAt, 45_000);
  assert.equal(timers.active.size, 0);
  h.assertPassive(2);
});

test('a stalled DOM observation fails at the original readiness deadline with no retry requests', async t => {
  t.mock.method(performance, 'now', () => 1000);
  const timers = controlledTimers(t), h = await observerHarness(), stalledDom = deferred();
  await observedFixture(h);
  h.page.evaluate = () => stalledDom.promise;
  const waiting = h.observer.wait('XAUUSD');
  const rejectedWait = assert.rejects(waiting, /SELECTED_CFD_QUOTE_NOT_READY XAUUSD: DOM_OBSERVATION_DEADLINE/);
  const deadline = timers.scheduled.at(-1);
  assert.equal(deadline.delay, 45_000);
  timers.fire(deadline);
  await rejectedWait;
  assert.equal(h.observer.evidence.readiness.length, 1);
  assert.equal(h.observer.evidence.readiness[0].ready, false);
  assert.equal(h.observer.evidence.readiness[0].deadline - h.observer.evidence.readiness[0].startedAt, 45_000);
  assert.equal(timers.active.size, 0);
  stalledDom.resolve(fixture().dom); await flushObservationTasks();
  assert.equal(h.observer.evidence.readiness[0].ready, false);
  h.assertPassive(2);
});

test('a permanently unavailable selected quote expires at 45 seconds even when another instrument has a price', async t => {
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const timers = controlledTimers(t), input = fixture();
  input.ticker.body.tickers.push({ ...row(input), symbol: 'XAGUSD', providerSymbol: 'XAGUSD', price: '42.50' });
  row(input).price = null; row(input).status = 'unavailable';
  input.dom.ticker = '—'; input.dom.ticket = '—';
  const h = await observerHarness(input.dom);
  h.send('ticker', input.ticker.body); h.send('daily', input.daily.body);
  await flushObservationTasks();
  const waiting = h.observer.wait('XAUUSD');
  const rejectedWait = assert.rejects(waiting, /SELECTED_CFD_QUOTE_NOT_READY XAUUSD:.*SELECTED_QUOTE_UNAVAILABLE/);
  await flushObservationTasks();
  assert.equal(timers.scheduled[0].delay, 45_000);
  const poll = [...timers.active.values()];
  assert.equal(poll.length, 1); assert.equal(poll[0].delay, 100);
  elapsed = 45_000; timers.fire(poll[0]);
  await rejectedWait;
  const receipt = h.observer.evidence.readiness[0];
  assert.equal(h.observer.evidence.readiness.length, 1);
  assert.equal(receipt.ready, false);
  assert.ok(receipt.reasons.includes('SELECTED_QUOTE_UNAVAILABLE'));
  assert.equal(receipt.reasons.includes('DOM_OBSERVATION_DEADLINE'), false);
  assert.equal(receipt.deadline - receipt.startedAt, 45_000);
  assert.equal(timers.active.size, 0);
  assert.equal(timers.scheduled.length, 2, 'deadline expiry must not start another polling window');
  h.assertPassive(2);
});

test('bounded drain reports stalled bodies and stays incomplete even if the body later arrives', async t => {
  const timers = controlledTimers(t);
  for (const [budget, expected] of [[undefined, 1000], [25, 25], [5000, 1000], [Infinity, 1000], [-1, 0]]) {
    const h = await observerHarness(), stalled = deferred(), input = fixture();
    h.send('daily', input.daily.body); h.send('ticker', stalled.promise);
    await flushObservationTasks();
    const draining = h.observer.settle(budget);
    const timer = timers.scheduled.at(-1);
    assert.equal(timer.delay, expected);
    timers.fire(timer);
    assert.deepEqual(await draining, { complete: false, pending: 1 });
    assert.equal(h.observer.evidence.incomplete, true);
    assert.equal((await h.observer.snapshot('XAUUSD')).ready, false);
    stalled.resolve(jsonBytes(input.ticker.body));
    await flushObservationTasks();
    assert.equal(h.observer.evidence.entries.at(-1).complete, true);
    assert.deepEqual(await h.observer.settle(0), { complete: false, pending: 0 });
    assert.equal((await h.observer.snapshot('XAUUSD')).ready, false, 'late body cannot conceal a truncated diagnostic capture');
    assert.equal(timers.active.size, 0);
    h.assertPassive(2);
  }
});

test('completed observation drains without firing its timeout and preserves a complete receipt', async t => {
  const timers = controlledTimers(t), h = await observerHarness();
  await observedFixture(h);
  assert.deepEqual(await h.observer.settle(), { complete: true, pending: 0 });
  assert.equal(h.observer.evidence.incomplete, false);
  assert.deepEqual(h.observer.evidence.drain, { complete: true, pending: 0 });
  assert.equal(timers.active.size, 0);
  assert.equal(timers.scheduled.length, 1); assert.equal(timers.scheduled[0].delay, 1000);
  h.assertPassive(2);
});

test('request failure, non-JSON, failed HTTP and unreadable bodies cannot reuse an earlier successful quote', async () => {
  for (const failure of ['request', 'non-json', 'http', 'body']) {
    const h = await observerHarness(); await observedFixture(h);
    const item = h.request('ticker');
    if (failure === 'request') h.page.emit('requestfailed', item);
    if (failure === 'non-json') h.respond(item, Buffer.from('<html>unit upstream error</html>'));
    if (failure === 'http') h.respond(item, fixture().ticker.body, { status: 503 });
    if (failure === 'body') {
      const failed = deferred(); h.respond(item, failed.promise);
      await flushObservationTasks(); failed.reject(Error('UNIT_BODY_UNAVAILABLE'));
    }
    await flushObservationTasks();
    const result = await h.observer.snapshot('XAUUSD'), entry = h.observer.evidence.entries.at(-1);
    assert.equal(result.ready, false, failure); assert.equal(result.tickerSequence, 3);
    assert.ok(result.reasons.length > 0);
    if (failure !== 'http') assert.ok(entry.error, failure + ' must retain the actual failure');
    if (failure === 'request') assert.equal(entry.error, 'net::ERR_CONNECTION_RESET');
    if (failure === 'body') assert.equal(entry.error, 'UNIT_BODY_UNAVAILABLE');
    assert.ok(Number.isFinite(entry.endedAt));
    h.assertPassive(3);
  }
});

test('latest pending ticker or selected daily request fails closed instead of falling back to earlier success', async () => {
  const h = await observerHarness(), input = fixture(); await observedFixture(h);
  const pendingTicker = h.request('ticker');
  assert.equal((await h.observer.snapshot('XAUUSD')).ready, false);
  h.respond(pendingTicker, input.ticker.body); await flushObservationTasks();
  assert.equal((await h.observer.snapshot('XAUUSD')).ready, true);
  const pendingDaily = h.request('daily');
  h.send('daily', { ...input.daily.body, symbol: 'XAGUSD' }, { symbol: 'XAGUSD' });
  await flushObservationTasks();
  const pending = await h.observer.snapshot('XAUUSD');
  assert.equal(pending.ready, false); assert.equal(pending.dailySequence, 4);
  h.respond(pendingDaily, input.daily.body); await flushObservationTasks();
  assert.equal((await h.observer.snapshot('XAUUSD')).ready, true);
  h.assertPassive(5);
});

test('observer retains response, local-cache and CDP provenance without changing the cache or response', async () => {
  const input = fixture(), dom = { ...input.dom, cache: [{ key: '/cfd/display/tickers', at: NOW,
    expiresAt: NOW + 30_000, ttl: 30_000, snapshot: input.ticker.body._display }] };
  const h = await observerHarness(dom), payload = jsonBytes(input.ticker.body);
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=30', age: '12',
    etag: 'unit-etag', 'x-voltex-refresh-seconds': '21600', 'set-cookie': 'unit-secret-not-for-evidence' };
  h.cdp.emit('Network.requestWillBeSent', { requestId: 'quote-1', timestamp: 1, wallTime: NOW / 1000,
    request: { url: tickerUrl, method: 'GET' }, initiator: { type: 'script' } });
  h.cdp.emit('Network.responseReceived', { requestId: 'quote-1', timestamp: 2, response: {
    status: 200, fromDiskCache: true, fromServiceWorker: true, fromPrefetchCache: true, protocol: 'h2' } });
  h.cdp.emit('Network.requestServedFromCache', { requestId: 'quote-1' });
  h.cdp.emit('Network.loadingFinished', { requestId: 'quote-1', timestamp: 3, encodedDataLength: 0 });
  h.send('ticker', payload, { headers, fromServiceWorker: true }); h.send('daily', input.daily.body);
  await flushObservationTasks();
  const result = await h.observer.checkpoint('XAUUSD', 'unit-before-assertions');
  assert.equal(result.ready, true, result.reasons.join(','));
  assert.deepEqual(result.dom.cache, dom.cache);
  const entry = h.observer.evidence.entries[0];
  assert.deepEqual(entry.headers, Object.fromEntries(Object.entries(headers).filter(([key]) => key !== 'set-cookie')));
  assert.equal(entry.fromServiceWorker, true);
  assert.equal(entry.bytes, payload.length);
  assert.equal(entry.bodySha256, createHash('sha256').update(payload).digest('hex'));
  assert.deepEqual(entry.snapshot, input.ticker.body._display);
  assert.equal(entry.data.source, input.ticker.body.source);
  assert.equal(entry.data.rows[0].provider, row(input).provider);
  assert.equal(entry.data.rows[0].asOf, row(input).asOf);
  assert.deepEqual(entry.timing, h.requests[0].timing());
  const publicEvidence = JSON.parse(JSON.stringify(h.observer.evidence));
  assert.equal(Object.hasOwn(publicEvidence.entries[0], 'body'), false, 'full body remains non-enumerable');
  assert.equal(JSON.stringify(publicEvidence).includes('unit-secret-not-for-evidence'), false);
  assert.deepEqual(publicEvidence.network.map(event => event.event), ['request', 'response', 'requestServedFromCache', 'loadingFinished']);
  assert.deepEqual(publicEvidence.network[1], { event: 'response', requestId: 'quote-1', timestamp: 2,
    status: 200, fromDiskCache: true, fromServiceWorker: true, fromPrefetchCache: true, protocol: 'h2' });
  assert.equal(h.observer.evidence.checkpoints.length, 1);
  h.assertPassive(2);
});

test('unrelated origin, hourly candles and untracked CDP responses cannot satisfy selected daily readiness', async () => {
  const h = await observerHarness(), input = fixture();
  h.send('ticker', input.ticker.body);
  h.send('daily', input.daily.body, { url: 'https://other-unit.invalid/api/v1/cfd/display/candles/XAUUSD?interval=1d&limit=20' });
  h.send('daily', input.daily.body, { url: dailyUrl('XAUUSD').replace('interval=1d', 'interval=1h') });
  h.send('daily', input.daily.body, { url: dailyUrl('XAUUSD').replace('limit=20', 'limit=200') });
  h.cdp.emit('Network.responseReceived', { requestId: 'not-observed', timestamp: 1, response: { status: 200 } });
  await flushObservationTasks();
  const result = await h.observer.snapshot('XAUUSD');
  assert.equal(result.ready, false); assert.equal(result.dailySequence, null);
  assert.equal(h.observer.evidence.entries.length, 1); assert.equal(h.observer.evidence.network.length, 0);
  h.assertPassive(4);
});

test('request trace overflow caps stored entries at 256 and invalidates an otherwise ready selected quote', async () => {
  const h = await observerHarness(); await observedFixture(h);
  for (let index = 2; index < 256; index += 1) h.request('daily', { symbol: 'XAGUSD' });
  assert.equal(h.observer.evidence.entries.length, 256);
  assert.equal((await h.observer.snapshot('XAUUSD')).ready, true);
  h.request('daily', { symbol: 'XAGUSD' });
  const result = await h.observer.snapshot('XAUUSD');
  assert.equal(h.observer.evidence.entries.length, 256);
  assert.equal(h.observer.evidence.overflow, true);
  assert.equal(result.ready, false); assert.equal(result.epoch, null);
  assert.ok(result.reasons.includes('QUOTE_TRACE_OVERFLOW'));
  h.assertPassive(257);
});

test('CDP trace caps recognized request IDs at 256 and cannot accept later events for an overflow ID', async () => {
  const h = await observerHarness(); await observedFixture(h);
  const requestEvent = index => ({ requestId: 'unit-' + index, timestamp: index, wallTime: NOW / 1000,
    request: { url: tickerUrl, method: 'GET' }, initiator: { type: 'script' } });
  for (let index = 0; index < 256; index += 1) h.cdp.emit('Network.requestWillBeSent', requestEvent(index));
  assert.equal(h.observer.evidence.network.length, 256);
  assert.equal((await h.observer.snapshot('XAUUSD')).ready, true);
  h.cdp.emit('Network.requestWillBeSent', requestEvent(256));
  h.cdp.emit('Network.responseReceived', { requestId: 'unit-256', timestamp: 257, response: { status: 200 } });
  h.cdp.emit('Network.loadingFinished', { requestId: 'unit-256', timestamp: 258, encodedDataLength: 0 });
  assert.equal(h.observer.evidence.network.length, 256);
  assert.equal(new Set(h.observer.evidence.network.map(event => event.requestId)).size, 256);
  const result = await h.observer.snapshot('XAUUSD');
  assert.equal(h.observer.evidence.overflow, true);
  assert.equal(result.ready, false); assert.equal(result.epoch, null);
  assert.ok(result.reasons.includes('QUOTE_TRACE_OVERFLOW'));
  h.assertPassive(2);
});

test('observer checkpoints detect a new same-price quote epoch while allowing unchanged acquisition data', async () => {
  const h = await observerHarness(), input = fixture(); await observedFixture(h);
  const before = await h.observer.checkpoint('XAUUSD', 'before');
  h.send('ticker', input.ticker.body); await flushObservationTasks();
  const same = await h.observer.checkpoint('XAUUSD', 'same-source-response');
  assert.equal(sameQuoteEpoch(before, same), true, 'HTTP request sequence alone is not a different quote');
  row(input).fetchedAt -= 1000; input.ticker.body._display.capturedAt -= 1000;
  h.send('ticker', input.ticker.body); await flushObservationTasks();
  const revised = await h.observer.checkpoint('XAUUSD', 'different-acquisition');
  assert.equal(revised.ready, true, revised.reasons.join(','));
  assert.equal(before.dom.ticker, revised.dom.ticker);
  assert.equal(sameQuoteEpoch(before, revised), false);
  assert.notEqual(before.epoch, revised.epoch);
  h.assertPassive(4);
});
