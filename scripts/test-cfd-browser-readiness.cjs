'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForCfdBrowserReadiness } = require('./cfd-browser-readiness.cjs');

const ORIGIN = 'http://127.0.0.1:43123';
const candlePath = symbol => `/api/v1/cfd/candles/${symbol}?interval=1h&limit=320`;
const quoteBody = { tickers: [{ symbol: 'XAUUSD', price: null }, { symbol: 'WTIUSD', price: '96.410' }] };
const candleBody = symbol => ({ symbol, interval: '1h', bars: [
  { openTime: '2026-09-29T10:00:00.000Z', open: '95', high: '97', low: '94', close: '96' },
  { openTime: '2026-09-29T11:00:00.000Z', open: '96', high: '98', low: '95', close: '97' },
] });
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function harness(handler) {
  const requests = [], attempts = [], delays = [];
  let clock = 0;
  return { requests, attempts, delays, options: {
    fetchFn: async (url, options) => {
      const parsed = new URL(url), pathname = parsed.pathname + parsed.search;
      requests.push({ pathname, options });
      assert.equal(parsed.origin, ORIGIN);
      assert.equal(options.method ?? 'GET', 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      assert.ok(options.signal instanceof AbortSignal);
      return handler(pathname, requests.length);
    },
    sleep: async ms => { delays.push(ms); clock += ms; },
    now: () => ++clock,
    record: result => attempts.push(result),
  } };
}
const successResponse = path => response(path.endsWith('/tickers') ? quoteBody : candleBody(path.split('/').at(-1).split('?')[0]));

test('readiness probes exact uncached real routes for the selected and reload charts, then stops', async () => {
  const h = harness(successResponse);
  const result = await waitForCfdBrowserReadiness(ORIGIN, h.options);
  assert.equal(result.passed, true);
  assert.equal(result.selectedSymbol, 'WTIUSD');
  assert.equal(result.reloadSymbol, 'XAUUSD');
  assert.deepEqual(result.candles.map(item => item.bars), [2, 2]);
  assert.deepEqual(h.requests.map(item => item.pathname), ['/api/v1/cfd/tickers', candlePath('WTIUSD'), candlePath('XAUUSD')]);
  assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.delays, []);
  assert.ok(result.requests.every(item => item.status === 200 && item.elapsedMs > 0));
});

test('a transient chart failure is recorded before a bounded retry, with no display-cache route', async () => {
  let tickers = 0;
  const h = harness(path => {
    if (path.endsWith('/tickers')) { tickers++; return response({ tickers: [{ symbol: 'XAUUSD', price: '3800' }] }); }
    if (tickers === 1 && path === candlePath('WTIUSD')) return response({ error: 'provider_timeout' }, 503);
    return successResponse(path);
  });
  const result = await waitForCfdBrowserReadiness(ORIGIN, h.options);
  assert.equal(result.selectedSymbol, 'XAUUSD');
  assert.equal(result.reloadSymbol, 'WTIUSD');
  assert.equal(result.attempt, 2);
  assert.equal(h.requests.length, 6);
  assert.deepEqual(h.delays, [1000]);
  assert.equal(h.attempts[0].passed, false);
  assert.equal(h.attempts[0].requests.find(item => item.path === candlePath('WTIUSD')).error, 'provider_timeout');
  assert.equal(h.attempts[0].candles.find(item => item.symbol === 'WTIUSD').bars, 0);
  assert.equal(h.requests.some(item => item.pathname.includes('/display/')), false);
});

test('missing or non-numeric actual quotes fail after exactly three attempts without chart requests', async () => {
  const h = harness(() => response({ tickers: [null, { symbol: 'XAUUSD', price: null },
    { symbol: 'WTIUSD', price: true }, { symbol: 'EURUSD', price: '' }, { symbol: 'USDJPY', price: 'NaN' }] }));
  await assert.rejects(waitForCfdBrowserReadiness(ORIGIN, h.options), /failed after 3 bounded attempts/);
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.delays, [1000, 2000]);
  assert.ok(h.attempts.every(item => !item.passed && item.error === 'No real priced CFD row'));
});

test('HTTP 200 cannot pass mismatched identities, invalid OHLC, duplicate times or insufficient bars', async t => {
  const mutations = {
    symbol: body => ({ ...body, symbol: 'USOIL' }),
    interval: body => ({ ...body, interval: '15m' }),
    invalidRange: body => ({ ...body, bars: body.bars.map(bar => ({ ...bar, high: '90' })) }),
    booleanPrices: body => ({ ...body, bars: body.bars.map(bar => ({ ...bar, open: true })) }),
    invalidTime: body => ({ ...body, bars: body.bars.map(bar => ({ ...bar, openTime: 'not-a-date' })) }),
    duplicateTime: body => ({ ...body, bars: [body.bars[0], body.bars[0]] }),
    oneBar: body => ({ ...body, bars: body.bars.slice(0, 1) }),
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const h = harness(path => path.endsWith('/tickers') ? response(quoteBody)
      : response(mutate(candleBody(path.split('/').at(-1).split('?')[0]))));
    await assert.rejects(waitForCfdBrowserReadiness(ORIGIN, h.options), /failed after 3 bounded attempts/);
    assert.equal(h.attempts.length, 3);
    assert.equal(h.requests.length, 9);
    assert.ok(h.attempts.every(item => !item.passed && item.candles.every(candle => candle.bars < 2)));
  });
});

test('transport and non-JSON failures retain diagnostics and exhaust finite retries', async () => {
  const h = harness((_path, request) => {
    if (request === 1) throw new DOMException('The operation timed out', 'TimeoutError');
    if (request === 2) return { status: 502, ok: false, json: async () => { throw new SyntaxError('Invalid JSON'); } };
    return response({ error: 'upstream_unavailable' }, 503);
  });
  await assert.rejects(waitForCfdBrowserReadiness(ORIGIN, h.options), /failed after 3 bounded attempts/);
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.attempts.map(item => item.requests[0].status), [null, 502, 503]);
  assert.deepEqual(h.attempts.map(item => item.requests[0].error), ['The operation timed out', 'Invalid JSON', 'upstream_unavailable']);
  assert.deepEqual(h.delays, [1000, 2000]);
});

test('foreign, credentialled and non-origin targets are rejected before any request', async () => {
  const h = harness(() => { throw new Error('must not fetch'); });
  for (const origin of ['https://example.com', 'http://localhost:43123', 'https://127.0.0.1:43123',
    'http://user:password@127.0.0.1:43123', ORIGIN + '/api', ORIGIN + '?target=remote', ORIGIN + '#fragment']) {
    await assert.rejects(waitForCfdBrowserReadiness(origin, h.options), /requires its loopback origin/);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.attempts.length, 0);
});
