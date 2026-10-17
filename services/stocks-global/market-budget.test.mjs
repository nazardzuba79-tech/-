import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { MarketHub, convertPrices } from './market.mjs';
import { CATALOG } from './catalog.mjs';
import { quoteStatus } from './engine.mjs';
import { nativeHistoryFixture } from '../stocks/realistic-provider-fixture.mjs';

// Transport-contract fixtures only: no global fetch, HTTP server, account,
// production source, provider write or order. Unlike the capacity fixture, this
// suite does NOT replace quote(), catalogue(), FX or history() implementations.
const BASE = Date.parse('2026-10-11T12:00:00Z');
const INSTRUMENTS = CATALOG.filter(i => i.provider !== 'moex').slice(0, 20);
const REPORT = [];
function transportFixture() {
  const state = { now: BASE, calls: [], stale: false, staleFx: false };
  const ticker = i => ({ symbol: i.sourceSymbol, lastPrice: String(100 + CATALOG.indexOf(i)),
    price24hPcnt: '0.01', priceChangePercent: '1', volume24h: '20', volume: '20', closeTime: state.now });
  const hub = new MarketHub({ now: () => state.now, fetchImpl: async (address, options) => {
    const u = new URL(address), symbol = u.searchParams.get('symbol');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(u.protocol, 'https:');
    let category, body;
    const selected = CATALOG.find(i => i.sourceSymbol === symbol && u.hostname === `api.${i.provider}.com`);
    if (u.hostname === 'api.bybit.com' && u.pathname === '/v5/market/instruments-info') {
      category = 'metadata'; body = { retCode: 0, result: { list: CATALOG.filter(i => i.provider === 'bybit').map(i => ({ symbol: i.sourceSymbol, status: 'Trading', xstockMultiplier: '1.01' })) } };
    } else if (u.hostname === 'api.binance.com' && u.pathname === '/api/v3/exchangeInfo') {
      category = 'metadata'; body = { symbols: CATALOG.filter(i => i.provider === 'binance').map(i => ({ symbol: i.sourceSymbol, status: 'TRADING' })) };
    } else if (u.hostname === 'iss.moex.com' && u.pathname === '/iss/engines/stock/markets/shares/boards/TQBR/securities.json') {
      // Explicitly unverified Russian symbols; no MOEX quote/candle transport.
      category = 'metadata'; body = { securities: { columns: ['SECID', 'STATUS'], data: [] } };
    } else if (u.hostname === 'api.bybit.com' && u.pathname === '/v5/market/tickers') {
      category = symbol ? 'ticker' : 'catalogue-ticker';
      body = { retCode: 0, time: state.now, result: { list: CATALOG.filter(i => i.provider === 'bybit' && (!symbol || i === selected)).map(ticker) } };
    } else if (u.hostname === 'api.binance.com' && u.pathname === '/api/v3/ticker/24hr') {
      category = symbol ? 'ticker' : 'catalogue-ticker';
      body = symbol ? ticker(selected) : CATALOG.filter(i => i.provider === 'binance').map(ticker);
    } else if (selected?.provider === 'bybit' && u.pathname === '/v5/market/orderbook') {
      category = 'execution-quote'; const at = state.now - (state.stale ? 61000 : 0), price = ticker(selected).lastPrice;
      body = { retCode: 0, result: { s: symbol, ts: at, cts: at, u: at, b: [[price, '2']], a: [[String(Number(price) + 0.1), '2']] } };
    } else if (u.hostname === 'api.binance.com' && u.pathname === '/api/v3/trades' && (selected || symbol === 'USDCUSDT')) {
      category = symbol === 'USDCUSDT' ? 'fx' : 'execution-quote';
      const at = state.now - (category === 'fx' ? (state.staleFx ? 181000 : 0) : (state.stale ? 61000 : 0));
      body = [{ id: at, time: at, price: category === 'fx' ? '0.9982' : ticker(selected).lastPrice }];
    } else if (selected && ['/v5/market/kline', '/api/v3/klines'].includes(u.pathname)) {
      category = 'history'; body = nativeHistoryFixture(u, state.now);
    } else throw Error('FIXTURE_TRANSPORT_DENIED');
    state.calls.push({ at: state.now, host: u.hostname, category, symbol, url: address });
    return new Response(JSON.stringify(body));
  } });
  return { state, hub };
}
const count = (calls, category) => calls.filter(c => c.category === category).length;

test('combined native quotes, FX and candles retain exact identity, non-parity conversion and event IDs', async () => {
  const { hub, state } = transportFixture();
  for (const id of ['BYBIT:AAPLXUSDT', 'BINANCE:AAPLBUSDT']) {
    const q = await hub.quote(id), page = await hub.history(id);
    assert.equal(q.instrumentId, id); assert.equal(page.instrumentId, id);
    assert.equal(q.eventId, String(BASE)); assert.equal(q.timestamp, BASE);
    assert.equal(q.fx.USDC.rate, '0.99820000');
    assert.deepEqual(q.prices.USDC, convertPrices(q.bid, q.ask, q.fx.USDC.rate));
    assert.equal(quoteStatus(q, state.now, 'USDC'), 'READY');
    assert.equal(page.candles.length, 300);
  }
  assert.equal(count(state.calls, 'fx'), 1, 'FX is shared across venues');
  assert.equal(count(state.calls, 'execution-quote'), 2);
  assert.equal(count(state.calls, 'history'), 2);
});

test('50 same-symbol followers share actual transport while a later execution observation is never TTL-cached', async () => {
  const { hub, state } = transportFixture(); await hub.catalogue();
  const quotes = await Promise.all(Array.from({ length: 50 }, () => hub.quote(INSTRUMENTS[0].id)));
  assert.equal(count(state.calls, 'execution-quote'), 1);
  assert.equal(count(state.calls, 'ticker'), 1); assert.equal(count(state.calls, 'fx'), 1);
  assert.ok(quotes.every(q => q.eventId === String(BASE) && q.timestamp === BASE));
  state.now++;
  const next = await hub.quote(INSTRUMENTS[0].id);
  assert.equal(count(state.calls, 'execution-quote'), 2); assert.equal(next.eventId, String(BASE + 1));
  assert.equal(count(state.calls, 'ticker'), 1); assert.equal(count(state.calls, 'fx'), 1);
  state.now = BASE + 15000; await hub.quote(INSTRUMENTS[0].id);
  assert.equal(count(state.calls, 'ticker'), 2); assert.equal(count(state.calls, 'fx'), 2);
});

test('a stale native observation or stale FX remains blocked even with successful transport', async () => {
  const { hub, state } = transportFixture(); state.stale = true;
  assert.equal(quoteStatus(await hub.quote(INSTRUMENTS[0].id), state.now), 'QUOTE_STALE');
  state.stale = false; state.staleFx = true; state.now += 15000;
  const q = await hub.quote(INSTRUMENTS[0].id);
  assert.equal(q.fxError, 'FX_STALE'); assert.equal(q.prices.USDC, undefined);
  assert.equal(quoteStatus(q, state.now, 'USDC'), 'FX_UNAVAILABLE');
});

test('quote, FX and history consume one unchanged 100-per-host budget and recover only after its window', async () => {
  const { hub, state } = transportFixture(); await hub.catalogue();
  const id = 'BINANCE:AAPLBUSDT';
  // Distinct historical requests are real adapter requests, not injected starts.
  for (let n = 0; n < 96; n++) await hub.history(id, '15m', BASE - (n + 1) * 301 * 900000);
  assert.equal(state.calls.filter(c => c.host === 'api.binance.com').length, 98);
  const q = await hub.quote(id); // Book/trade + ticker take remaining 2; FX is refused.
  assert.equal(q.fxError, 'RATE_LIMIT'); assert.equal(q.prices.USDC, undefined);
  assert.equal(state.calls.filter(c => c.host === 'api.binance.com').length, 100);
  await assert.rejects(hub.history(id, '1h'), /RATE_LIMIT/);
  await assert.rejects(hub.quote(id), /RATE_LIMIT/);
  state.now += 60000; assert.equal(quoteStatus(await hub.quote(id), state.now, 'USDC'), 'READY');
});

// Budget-only virtual replay. It uses the same 20 symbols, six-second navigation,
// two-second history paging and three-second selected-symbol round robin. It
// models ideal serialized admission and same-symbol 2s sharing; actual HTTP
// concurrency can additionally reject SOURCE_BUSY. It is NOT a CPU/SQLite/HTTP
// acceptance test and does not replace any original resource test or its gates.
async function combinedBudget(users, pattern, seconds = 60) {
  const { hub, state } = transportFixture(), recent = new Map(), demanded = new Map(), nativeQuoteDemandByHost = {};
  const selected = Array.from({ length: users }, () => INSTRUMENTS[0].id), errors = {}, errorsByOperation = {};
  let cursor = 0, quoteRequests = 0, historyRequests = 0, successfulQuotes = 0, missingUsdc = 0;
  const attempt = async (operation, fn) => { try { return await fn(); } catch (error) {
    assert.equal(error.code, 'RATE_LIMIT', 'unexpected protocol errors must fail the regression');
    errors[error.code] = (errors[error.code] || 0) + 1;
    const key = operation + ':' + error.code; errorsByOperation[key] = (errorsByOperation[key] || 0) + 1;
  } };
  const quote = async id => {
    // Count minimum distinct quote reads independently of quota failures. This
    // assumes perfect same-symbol 2s sharing even when admission later fails;
    // refused followers must not inflate the lower-bound demand calculation.
    if (!demanded.has(id) || state.now - demanded.get(id) >= 2000) {
      demanded.set(id, state.now); const host = `api.${CATALOG.find(i => i.id === id).provider}.com`;
      nativeQuoteDemandByHost[host] = (nativeQuoteDemandByHost[host] || 0) + 1;
    }
    const previous = recent.get(id); if (previous && state.now - previous.at < 2000) return previous.value;
    quoteRequests++; const q = await attempt('quote', () => hub.quote(id));
    if (q) { successfulQuotes++; if (!q.prices.USDC) missingUsdc++; recent.set(id, { at: state.now, value: q }); }
    return q;
  };
  await hub.catalogue();
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 1000) {
    state.now = BASE + elapsed;
    if (elapsed % 2000 === 0) {
      const turn = elapsed / 2000, interval = ['15m', '1h', '1D'][Math.floor(turn / 3) % 3];
      for (let user = 0; user < users; user++) {
        const id = INSTRUMENTS[pattern === 'shared' ? 0 : (user + Math.floor(turn / 3)) % INSTRUMENTS.length].id;
        if (id !== selected[user]) { selected[user] = id; await quote(id); }
        if (turn % 3 < 2) {
          historyRequests++; const before = turn % 3 === 1 ? Math.floor(state.now / 86400000) * 86400000 - 86400000 : null;
          await attempt('history', () => hub.history(id, interval, before));
        }
      }
    }
    if (elapsed && elapsed % 3000 === 0) { const ids = [...new Set(selected)]; await quote(ids[cursor++ % ids.length]); }
  }
  const byHost = {};
  for (const call of state.calls) {
    const host = byHost[call.host] ??= { total: 0, categories: {} };
    host.total++; host.categories[call.category] = (host.categories[call.category] || 0) + 1;
  }
  return { fixture: true, externalRequests: 0, virtualDurationSeconds: seconds, users, pattern,
    idealAdmission: true, quoteRequests, successfulQuotes, missingUsdc, historyRequests,
    starts: state.calls.length, byHost, nativeQuoteDemandByHost, errors, errorsByOperation,
    budgetSatisfied: !Object.keys(errors).length && !missingUsdc,
    caveat: 'Transport budget only, ideal serialized admission; not HTTP, CPU, SQLite or production capacity evidence.' };
}

for (const users of [5, 20, 50]) for (const pattern of ['shared', 'mixed']) {
  test(`combined native transport budget: ${users} ${pattern}, three deterministic repeats without relaxing limits`, async () => {
    const repeats = [];
    for (let n = 0; n < 3; n++) repeats.push(await combinedBudget(users, pattern));
    assert.deepEqual(repeats[1], repeats[0]); assert.deepEqual(repeats[2], repeats[0]);
    for (const result of repeats) for (const host of Object.values(result.byHost)) assert.ok(host.total <= 100);
    if (pattern === 'shared') assert.ok(repeats.every(r => r.budgetSatisfied));
    if (pattern === 'mixed' && users >= 20) {
      assert.ok(repeats.every(r => !r.budgetSatisfied && r.errors.RATE_LIMIT > 0), 'combined provider saturation must remain visible');
      assert.ok(repeats.every(r => r.nativeQuoteDemandByHost['api.binance.com'] >= 130), 'fresh trade reads alone exceed the unchanged budget before history, ticker and FX');
    }
    REPORT.push({ users, pattern, repeats });
  });
}
after(() => { if (process.env.STOCKS_MARKET_BUDGET_REPORT) writeFileSync(process.env.STOCKS_MARKET_BUDGET_REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), originalAcceptanceUnchanged: true, scenarios: REPORT }, null, 2)); });
