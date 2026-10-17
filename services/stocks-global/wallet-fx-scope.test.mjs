import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketHub, convertPrices } from './market.mjs';
import { CATALOG } from './catalog.mjs';
import { createServer } from './server.mjs';
import { openAccounts } from './accounts.mjs';
import { applyQuote, submit, quoteStatus } from './engine.mjs';

// Native transport fixtures only: no external requests, production accounts or
// adapter overrides. Default quote(), FX validation and FULL SQLite stay real.
const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
const principal = subject => ({ issuer: 'wallet-fx-regression', subject });
function fixture() {
  const state = { now: NOW, calls: [], staleFx: false, bookGate: null, fxGate: null };
  const tick = i => ({ symbol: i.sourceSymbol, lastPrice: '100', price24hPcnt: '0.01', priceChangePercent: '1', volume24h: '20', volume: '20' });
  const hub = new MarketHub({ now: () => state.now, fetchImpl: async (address, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    const u = new URL(address), symbol = u.searchParams.get('symbol');
    state.calls.push({ host: u.hostname, path: u.pathname, symbol, at: state.now });
    let body;
    if (u.hostname === 'api.bybit.com' && u.pathname.endsWith('/instruments-info')) {
      body = { retCode: 0, result: { list: CATALOG.filter(i => i.provider === 'bybit').map(i => ({ symbol: i.sourceSymbol, status: 'Trading', xstockMultiplier: '1' })) } };
    } else if (u.hostname === 'api.binance.com' && u.pathname.endsWith('/exchangeInfo')) {
      body = { symbols: CATALOG.filter(i => i.provider === 'binance').map(i => ({ symbol: i.sourceSymbol, status: 'TRADING' })) };
    } else if (u.hostname === 'iss.moex.com' && u.pathname.endsWith('/securities.json')) {
      body = { securities: { columns: ['SECID', 'STATUS'], data: [] } };
    } else if (u.hostname === 'api.bybit.com' && u.pathname.endsWith('/tickers')) {
      body = { retCode: 0, result: { list: CATALOG.filter(i => i.provider === 'bybit' && (!symbol || symbol === i.sourceSymbol)).map(tick) } };
    } else if (u.hostname === 'api.binance.com' && u.pathname.endsWith('/ticker/24hr')) {
      const rows = CATALOG.filter(i => i.provider === 'binance').map(tick);
      body = symbol ? rows.find(i => i.symbol === symbol) : rows;
    } else if (u.hostname === 'api.bybit.com' && u.pathname.endsWith('/orderbook')) {
      if (state.bookGate) await state.bookGate;
      body = { retCode: 0, result: { s: symbol, ts: state.now, cts: state.now, u: state.now, b: [['100', '2']], a: [['100', '2']] } };
    } else if (u.hostname === 'api.binance.com' && u.pathname.endsWith('/trades') && symbol === 'USDCUSDT') {
      if (state.fxGate) await state.fxGate;
      body = [{ id: state.now, time: state.now - (state.staleFx ? 181000 : 0), price: '0.9982' }];
    } else throw Error('FIXTURE_TRANSPORT_DENIED');
    return new Response(JSON.stringify(body));
  } });
  const count = kind => state.calls.filter(c => kind === 'fx' ? c.symbol === 'USDCUSDT' : c.path.endsWith('/orderbook')).length;
  return { state, hub, count };
}
function oldQuote() {
  return { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', last: '100',
    timestamp: NOW - 1000, receivedAt: NOW - 1000, verified: true, marketOpen: true, eventId: 'seed-native-event',
    capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' }, USDC: convertPrices('100', '100', '0.9982') },
    fx: { USDC: { rate: '0.9982', timestamp: NOW - 1000, maxAgeMs: 180000, source: 'test fixture' } } };
}
const order = (id, currency = 'USDT', overrides = {}) => ({ id, instrumentId: ID, currency, side: 'BUY', type: 'MARKET', quantity: '0.1', ...overrides });
async function seed(path, legacy = false) {
  const repo = openAccounts(path, { now: () => NOW - 1000 });
  try {
    const owner = repo.forPrincipal(principal('alice'));
    await owner.transact((state, now) => {
      applyQuote(state, oldQuote(), now);
      submit(state, order('seed-usdt-position'), now);
      if (legacy) {
        submit(state, order('seed-usdc-position', 'USDC'), now);
        submit(state, order('legacy-usdc-limit', 'USDC', { type: 'LIMIT', quantity: '0.6', limitPrice: '200' }), now + 1);
      }
    });
  } finally { repo.close(); }
}
async function serverFixture(t, { legacy = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-wallet-fx-')), path = join(dir, 'paper.sqlite');
  const f = fixture(); await seed(path, legacy);
  const options = { port: 0, accountsPath: path, ownerOnlyMode: true, tradeOwnerSubject: 'alice',
    now: () => f.state.now, autoPoll: false, hub: f.hub,
    authenticate: async req => principal(req.headers.authorization === 'Bearer fixture-bob' ? 'bob' : 'alice') };
  let app = await createServer(options);
  let closing;
  const close = () => closing ??= app.close();
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  const send = async (route, { user = 'alice', body, token, signal } = {}) => {
    const response = await fetch('http://127.0.0.1:' + app.port + '/__stocks_global/' + route, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer fixture-' + user,
        ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(4000),
    });
    return { status: response.status, data: await response.json() };
  };
  return { ...f, path, send, close, restart: async () => { await close(); app = await createServer(options); closing = undefined; } };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'fixture request must start'); await new Promise(resolve => setTimeout(resolve, 1)); }
}

test('explicit USDT response skips one unused FX request; default quote and non-mutating enrichment keep dual currencies', async () => {
  const f = fixture();
  const narrow = await f.hub.quote(ID, { includeUsdc: false });
  assert.equal(f.count('fx'), 0); assert.equal(f.count('native'), 1);
  assert.equal(narrow.prices.USDC, undefined); assert.equal(quoteStatus(narrow, NOW), 'READY');
  const full = await f.hub.withUsdcPrices(narrow);
  assert.equal(f.count('native'), 1, 'enrichment never requests another execution observation');
  assert.equal(f.count('fx'), 1); assert.equal(narrow.prices.USDC, undefined, 'published response object is unchanged');
  assert.equal(full.eventId, narrow.eventId); assert.equal(full.timestamp, narrow.timestamp); assert.equal(full.capacity, narrow.capacity);
  assert.deepEqual(full.prices.USDC, convertPrices('100', '100', '0.9982'));
  assert.equal(quoteStatus(full, NOW, 'USDC'), 'READY');
  const standard = await f.hub.quote(ID);
  assert.deepEqual(standard.prices, full.prices); assert.deepEqual(standard.fx, full.fx);
  await assert.rejects(f.hub.quote(ID, { includeUsdc: 'false' }), /INVALID_REQUEST/);
});

test('skipping response-only FX cannot validate USDC or conceal stale native data', async () => {
  const f = fixture(); f.state.staleFx = true;
  const narrow = await f.hub.quote(ID, { includeUsdc: false });
  assert.equal(quoteStatus(narrow, NOW, 'USDC'), 'FX_UNAVAILABLE');
  assert.equal(quoteStatus({ ...narrow, timestamp: NOW - 61000 }, NOW), 'QUOTE_STALE');
  const full = await f.hub.withUsdcPrices(narrow);
  assert.equal(full.fxError, 'FX_STALE'); assert.equal(full.prices.USDC, undefined);
  assert.equal(quoteStatus(full, NOW, 'USDC'), 'FX_UNAVAILABLE');
});

test('Wallet-only holdings consume no FX; later full state upgrades the same observation without extending native cache TTL', async t => {
  const f = await serverFixture(t);
  const before = (await f.send('state')).data;
  const wallet = await f.send('portfolio');
  assert.equal(wallet.status, 200); assert.equal(wallet.data.positions[ID + '|USDT'].quantity, '0.10000000');
  assert.equal(wallet.data.quotes[ID].prices.USDC, undefined); assert.equal(f.count('fx'), 0);
  const empty = await f.send('portfolio', { user: 'bob' });
  assert.deepEqual(empty.data.positions, {}); assert.equal(f.count('native'), 1);
  f.state.now += 1500;
  const full = await f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.equal(full.status, 200); assert.ok(full.data.quotes[ID].prices.USDC);
  assert.equal(f.count('native'), 1); assert.equal(f.count('fx'), 1);
  assert.equal(full.data.fills.length, 0); assert.equal(full.data.account.mode, 'viewer');
  assert.equal(full.data.wallets.USDT.cash, '0.00000000', 'market viewers never receive a funded ledger');
  const after = (await f.send('state')).data;
  assert.equal(after.revision, before.revision); assert.deepEqual(after.fills, before.fills);
  f.state.now += 501;
  await f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.equal(f.count('native'), 2, 'FX upgrade does not restart the original 2s native cache lifetime');
});

test('mixed concurrent Wallet/full-state flights keep currency identity and share native transport', async t => {
  const f = await serverFixture(t); await f.send('state'); await f.send('state', { user: 'bob' });
  let release; f.state.bookGate = new Promise(resolve => { release = resolve; });
  const wallets = [f.send('portfolio'), f.send('portfolio')];
  await until(() => f.count('native') === 1);
  const full = f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  release();
  const [a, b, c] = await Promise.all([...wallets, full]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(c.status, 200);
  assert.equal(a.data.quotes[ID].prices.USDC, undefined); assert.equal(b.data.quotes[ID].prices.USDC, undefined);
  assert.ok(c.data.quotes[ID].prices.USDC); assert.equal(f.count('native'), 1); assert.equal(f.count('fx'), 1);
  const reused = await f.send('portfolio');
  assert.equal(reused.status, 200); assert.equal(f.count('native'), 1); assert.equal(f.count('fx'), 1);
});

test('Wallet FX promotion keeps one bounded instrument slot through completion; third instrument remains rejected', async t => {
  const f = await serverFixture(t);
  const [second, third] = CATALOG.filter(i => i.provider === 'bybit' && i.id !== ID);
  await f.send('portfolio');
  let release; f.state.fxGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const upgraded = f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  await until(() => f.count('fx') === 1);
  const other = f.send('state?id=' + encodeURIComponent(second.id), { user: 'bob' });
  await until(() => f.count('native') === 2);
  const blocked = await f.send('state?id=' + encodeURIComponent(third.id), { user: 'bob' });
  assert.equal(blocked.status, 200); assert.equal(blocked.data.errors[third.id], 'SOURCE_BUSY');
  assert.equal(blocked.data.quotes[third.id], undefined); assert.equal(f.count('native'), 2);
  release();
  const [a, b] = await Promise.all([upgraded, other]);
  assert.ok(a.data.quotes[ID].prices.USDC); assert.ok(b.data.quotes[second.id].prices.USDC);
  const recovered = await f.send('state?id=' + encodeURIComponent(third.id), { user: 'bob' });
  assert.ok(recovered.data.quotes[third.id].prices.USDC); assert.equal(f.count('native'), 3);
  assert.equal(f.count('fx'), 1, 'both instrument admissions share the unchanged provider FX flight');
});

test('legacy USDC limit and holdings retain FX valuation, shared USDT capacity, replay safety and recovery across owner-only restart', async t => {
  const f = await serverFixture(t, { legacy: true });
  const initial = (await f.send('state')).data, initialFills = initial.fills.length;
  f.state.now += 3000; // Existing-account recovery needs a later verified observation.
  const wallet = await f.send('portfolio');
  assert.equal(wallet.status, 200); assert.equal(f.count('fx'), 0);
  assert.equal(wallet.data.positions[ID + '|USDC'], undefined, 'Wallet projection remains USDT-only');
  assert.equal((await f.send('state')).data.fills.length, initialFills, 'Wallet cannot match the legacy limit');
  const refreshed = await f.send('refresh', { body: { id: ID }, token: initial.token });
  assert.equal(refreshed.status, 200);
  const state = refreshed.data, legacy = state.orders.find(o => o.id === 'legacy-usdc-limit');
  assert.equal(legacy.status, 'FILLED'); assert.equal(legacy.filled, '0.60000000');
  assert.equal(f.count('native'), 1); assert.equal(f.count('fx'), 1, 'full engine observation enriches the same Wallet event');
  assert.ok(state.positions[ID + '|USDC'].unrealized !== null);
  assert.ok(state.quotes[ID].prices.USDC); assert.equal(state.fills.length, initialFills + 1);
  assert.equal(state.wallets.USDC.reserved, '0.00000000');
  const next = order('shared-usdt-capacity', 'USDT', { quantity: '0.8' });
  const trade = await f.send('orders', { body: next, token: initial.token });
  assert.equal(trade.status, 200, trade.data.error); assert.equal(trade.data.result.filled, '0.40000000');
  assert.equal(trade.data.result.status, 'PARTIAL_CANCELLED', 'USDC legacy fill consumed the same native event capacity');
  const replay = await f.send('orders', { body: next, token: initial.token });
  assert.equal(replay.status, 200); assert.deepEqual(replay.data.fills, trade.data.fills);
  await f.restart();
  const reopened = (await f.send('state')).data;
  const stale = await f.send('orders', { body: order('recovery-no-observation'), token: reopened.token });
  assert.equal(stale.status, 422); assert.equal(stale.data.error, 'QUOTE_STALE');
  const replayAfter = await f.send('orders', { body: next, token: reopened.token });
  assert.equal(replayAfter.status, 200); assert.deepEqual(replayAfter.data.fills, trade.data.fills);
  assert.deepEqual(replayAfter.data.wallets, trade.data.wallets);
});

test('failed full FX promotion remains unavailable until the original provider TTL expires and then recovers', async t => {
  const f = await serverFixture(t);
  f.state.staleFx = true;
  const wallet = await f.send('portfolio');
  const timestamp = wallet.data.quotes[ID].timestamp;
  const failed = await f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.equal(failed.status, 200);
  assert.equal(failed.data.quotes[ID].fxError, 'FX_STALE');
  assert.equal(failed.data.quotes[ID].prices.USDC, undefined);
  assert.equal(failed.data.quotes[ID].timestamp, timestamp);
  assert.equal(f.count('native'), 1);
  assert.equal(f.count('fx'), 1);
  f.state.staleFx = false;
  f.state.now += 2001;
  const stillUnavailable = await f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.equal(stillUnavailable.data.quotes[ID].prices.USDC, undefined);
  assert.equal(f.count('native'), 2);
  assert.equal(f.count('fx'), 1, 'failed FX verification does not bypass the provider cache TTL');
  f.state.now += 14000;
  const recovered = await f.send('state?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.ok(recovered.data.quotes[ID].prices.USDC);
  assert.equal(recovered.data.quotes[ID].fxError, undefined);
  assert.equal(f.count('native'), 3);
  assert.equal(f.count('fx'), 2);
  assert.deepEqual(recovered.data.wallets, failed.data.wallets);
  assert.deepEqual(recovered.data.fills, failed.data.fills);
});

test('shutdown drains an FX upgrade after its HTTP reader disconnects', async t => {
  const f = await serverFixture(t); await f.send('portfolio');
  let release; f.state.fxGate = new Promise(resolve => { release = resolve; });
  const abort = new AbortController();
  const request = assert.rejects(f.send('state?id=' + encodeURIComponent(ID), { user: 'bob', signal: abort.signal }), { name: 'AbortError' });
  let closing;
  try {
    await until(() => f.count('fx') === 1);
    abort.abort(); await request;
    closing = f.close();
    const premature = await Promise.race([closing.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    assert.equal(premature, false, 'close must await the quote continuation rather than the flight wrapper object');
  } finally { abort.abort(); release(); await request; await closing; }
  assert.equal(f.count('native'), 1); assert.equal(f.count('fx'), 1);
});
