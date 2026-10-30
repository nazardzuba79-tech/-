import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';
import { CATALOG, DEMO_CATALOG, instrument } from './catalog.mjs';
import { DEX_PROGRAMS, USDC_MINT, IndicativeMoex, IndicativeSolanaPrices, decodePool, indicativeFromEnv, tokenPrice, withIndicativePrices } from './demo-indicative.mjs';
import { quoteStatus } from './engine.mjs';

// #613 demo/indicative prices (owner decision 30.10): tokenized stocks priced from their own Solana DEX pools and MOEX
// equities from ISS, both 15-minute delayed and view-only. These cases pin the decoders on real pool accounts, the
// candle store, the OFF default, and that no order is ever accepted on an indicative row.
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./testing/demo-pools.fixture.json', import.meta.url), 'utf8'));
const row = asset => DEMO_CATALOG.find(r => r.asset === asset);
const DECIMALS = new Map([[USDC_MINT, 6], ...DEMO_CATALOG.map(r => [r.mint, 8])]);

test('the list: 55 xStocks with mint, pool and DEX, never colliding with another row; FluxBeam-only tokens left out', () => {
  assert.equal(DEMO_CATALOG.length, 55);
  assert.equal(new Set(DEMO_CATALOG.map(r => r.id)).size, 55);
  for (const r of DEMO_CATALOG) {
    assert.match(r.id, /^XSTOCK:[A-Z.]+x$/); assert.equal(r.id, 'XSTOCK:' + r.sourceSymbol); assert.equal(instrument(r.id), r);
    assert.ok(Object.hasOwn(DEX_PROGRAMS, r.dex), r.dex); assert.equal(r.currency, 'USDC'); assert.equal(r.delaySeconds, 900); assert.equal(r.indicative, true);
    assert.equal(CATALOG.some(c => c.id === r.id), false);
  }
  assert.equal(DEMO_CATALOG.some(r => ['SGOVx', 'APPx', 'ITAx'].includes(r.asset)), false);
});

test('decoders on real mainnet pool accounts give the token price in USDC (cross-checked the same minute)', () => {
  // Captured prices: SPYx 752.0, NVDAx 202.4, AVGOx 321.5, XOMx 187.7 (aggregator, all venues); a single pool may differ.
  const expect = { SPYx: [740, 770], NVDAx: [198, 207], AVGOx: [315, 330], XOMx: [175, 195] };
  for (const [asset, [lo, hi]] of Object.entries(expect)) {
    const r = row(asset), a = FIXTURE[asset], pool = decodePool(a.owner, a.data);
    assert.equal(a.owner, DEX_PROGRAMS[r.dex], asset + ' owner');
    assert.ok([pool.mintA, pool.mintB].includes(r.mint) && [pool.mintA, pool.mintB].includes(USDC_MINT), asset + ' mints');
    const price = tokenPrice(r, pool, DECIMALS);
    assert.ok(price > lo && price < hi, `${asset} ${price}`);
  }
});

test('a pool that is not what the list says is refused, never guessed', () => {
  const spy = FIXTURE.SPYx;
  assert.equal(decodePool('11111111111111111111111111111111', spy.data), null, 'unknown owner');
  assert.equal(decodePool(DEX_PROGRAMS.raydium, Buffer.alloc(100)), null, 'short account');
  // The right layout for another token, or without USDC on the other side, or without decimals: no price.
  assert.equal(tokenPrice(row('NVDAx'), decodePool(spy.owner, spy.data), DECIMALS), null);
  assert.equal(tokenPrice(row('SPYx'), { ...decodePool(spy.owner, spy.data), mintB: row('NVDAx').mint }, DECIMALS), null);
  assert.equal(tokenPrice(row('NVDAx'), decodePool(FIXTURE.NVDAx.owner, FIXTURE.NVDAx.data), new Map()), null);
  assert.equal(tokenPrice(row('SPYx'), null, DECIMALS), null);
});

// A fake RPC answering getMultipleAccounts from the fixture (pools) and synthetic mint accounts (decimals at byte 44).
function rpc(prices = FIXTURE, { fail = false } = {}) {
  const mint = decimals => { const b = Buffer.alloc(82); b[44] = decimals; return b.toString('base64'); };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, method: body.method, count: body.params[0].length });
    if (fail) return new Response('busy', { status: 429 });
    const value = body.params[0].map(address => {
      if (address === USDC_MINT) return { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: [mint(6), 'base64'] };
      const r = DEMO_CATALOG.find(x => x.mint === address); if (r) return { owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', data: [mint(8), 'base64'] };
      const p = DEMO_CATALOG.find(x => x.pool === address); if (p && prices[p.asset]) return { owner: prices[p.asset].owner, data: [prices[p.asset].data, 'base64'] };
      return null;
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 463000000 }, value } }));
  };
  return { fetchImpl, calls };
}

test('one snapshot reads every pool in one batch, builds candles, and a failing RPC leaves the last price to go stale', async t => {
  let now = Date.parse('2026-10-30T12:00:30Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-ind-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { fetchImpl, calls } = rpc();
  const prices = new IndicativeSolanaPrices({ fetchImpl, now: () => now, dataPath: path.join(dir, 'candles.json') });
  await prices.snapshot();
  assert.deepEqual(calls.map(c => [c.method, c.count]), [['getMultipleAccounts', 56], ['getMultipleAccounts', 55]], 'mints once (55 + USDC), then all pools in one call');
  assert.equal(prices.metrics.priced, 4); assert.equal(prices.metrics.unpriced, 51, 'only the fixture pools exist in the fake chain');
  const q = prices.quote(row('SPYx').id);
  assert.equal(q.nativeCurrency, 'USDC'); assert.deepEqual(Object.keys(q.prices), ['USDC']); assert.equal(q.indicative, true); assert.equal(q.delaySeconds, 900);
  assert.equal(quoteStatus(q, now, 'USDC'), 'READY'); assert.equal(quoteStatus(q, now, 'USDT'), 'FX_UNAVAILABLE', 'no USDT/USDC parity is assumed');
  assert.throws(() => prices.quote(row('AAPLx').id), /QUOTE_UNAVAILABLE/);
  now += 60000; await prices.snapshot(); now += 3600000; await prices.snapshot();
  const m = prices.history(row('SPYx').id, '1m'), h = prices.history(row('SPYx').id, '1h');
  assert.equal(m.candles.length, 3); assert.equal(h.candles.length, 2); assert.equal(m.indicative, true);
  assert.ok(m.candles.every(c => c.open > 0 && c.high >= c.low && c.time % 60 === 0));
  assert.equal(prices.history(row('SPYx').id, '1m', Date.parse('2026-10-30T12:01:00Z')).candles.length, 1, 'before is exclusive');
  assert.throws(() => prices.history(row('SPYx').id, '2m'), /INVALID_REQUEST/);
  // Persisted and restored after a restart.
  prices.save();
  const restored = new IndicativeSolanaPrices({ fetchImpl, now: () => now, dataPath: path.join(dir, 'candles.json') });
  assert.equal(restored.history(row('SPYx').id, '1m').candles.length, 3);
  // The RPC refuses: no new price, the old one goes stale (no invented value).
  const down = new IndicativeSolanaPrices({ fetchImpl: rpc(FIXTURE, { fail: true }).fetchImpl, now: () => now });
  await down.snapshot(); assert.equal(down.metrics.failures, 1); assert.equal(down.metrics.lastError, 'RATE_LIMIT');
  assert.equal(quoteStatus(q, now, 'USDC'), 'QUOTE_STALE');
});

test('MOEX from ISS: roubles, 15 minutes delayed, last trade and candles; no CEX and no FX', async () => {
  const urls = [], now = Date.parse('2026-10-30T19:06:00Z');
  const fetchImpl = async url => {
    urls.push(url); const u = new URL(url);
    if (u.pathname.endsWith('/securities.json')) return new Response(JSON.stringify({ securities: { columns: ['SECID', 'STATUS'], data: CATALOG.filter(r => r.provider === 'moex').map(r => [r.sourceSymbol, 'A']) },
      marketdata: { columns: ['SECID', 'LAST', 'LASTTOPREVPRICE', 'UPDATETIME', 'SYSTIME'], data: [['SBER', 296.81, 0.6, '21:51:44', '2026-10-30 22:06:00']] } }));
    if (u.pathname.endsWith('/candles.json')) return new Response(JSON.stringify({ candles: { columns: ['open', 'close', 'high', 'low', 'value', 'volume', 'begin', 'end'], data: [[296, 297, 298, 295, 1, 10, '2026-10-30 20:00:00', '2026-10-30 20:59:59'], [297, 296.8, 297.5, 296.5, 1, 12, '2026-10-30 21:00:00', '2026-10-30 21:59:59']] } }));
    return new Response(JSON.stringify({ marketdata: { columns: ['SECID', 'LAST', 'UPDATETIME', 'SYSTIME', 'TRADINGSTATUS', 'LASTTOPREVPRICE', 'VOLTODAY', 'SEQNUM'], data: [['SBER', 296.81, '21:51:44', '2026-10-30 22:06:00', 'T', 0.6, 100, 7]] } }));
  };
  const moex = new IndicativeMoex({ fetchImpl, now: () => now });
  const list = await moex.catalogue();
  assert.equal(list.length, 20); assert.ok(list.every(r => r.online && r.indicative && r.currency === 'RUB'));
  assert.deepEqual(list.find(r => r.sourceSymbol === 'SBER').display, { price: '296.81000000', change24h: 0.6, timestamp: Date.parse('2026-10-30T21:51:44+03:00') });
  assert.equal(list.find(r => r.sourceSymbol === 'GAZP').display, null, 'no row in the answer: no list price');
  const q = await moex.quote('MOEX:TQBR:SBER');
  assert.deepEqual(q.prices, { RUB: { buy: '296.81000000', sell: '296.81000000' } }); assert.deepEqual(q.fx, {});
  assert.equal(quoteStatus(q, now, 'RUB'), 'READY');
  const h = await moex.history('MOEX:TQBR:SBER', '1h');
  assert.equal(h.candles.length, 2); assert.equal(h.currency, 'RUB');
  await assert.rejects(moex.history('MOEX:TQBR:SBER', '5m'), /INVALID_REQUEST/);
  assert.ok(urls.every(u => new URL(u).hostname === 'iss.moex.com'), 'MOEX only');
});

test('OFF unless STOCKS_DEMO_INDICATIVE_ENABLED=true; any other value is refused', () => {
  assert.equal(indicativeFromEnv({}), null); assert.equal(indicativeFromEnv({ STOCKS_DEMO_INDICATIVE_ENABLED: 'false' }), null);
  assert.deepEqual(indicativeFromEnv({ STOCKS_DEMO_INDICATIVE_ENABLED: 'true', STOCKS_DEMO_INDICATIVE_DATA: '/var/lib/x.json' }), { dataPath: '/var/lib/x.json' });
  assert.throws(() => indicativeFromEnv({ STOCKS_DEMO_INDICATIVE_ENABLED: '1' }), /STOCKS_RELEASE_FEED_CONFIG_INVALID/);
});

// The gateway: indicative rows viewable only in the demo profile, never tradable; MOEX blocked as before without it.
const ISSUER = 'demo-ind-fixture', KEY = 'synthetic-demo-indicative-capability-0000';
const bearer = letter => 'Bearer ' + letter.repeat(32);
function authority() {
  const SUBJECTS = { A: 'trader-a', V: 'viewer-v' };
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/identities')) { const tokens = JSON.parse(options.body).tokens; return new Response(JSON.stringify({ results: tokens.map(token => ({ issuer: ISSUER, subject: SUBJECTS[token[0]] })) })); }
    const subject = SUBJECTS[options.headers.Authorization[7]], body = JSON.parse(options.body);
    const value = body.type === 'ensure' ? { id: accountId({ issuer: ISSUER, subject }) } : { schema: 2, revision: 1, serverTime: 1, wallets: { USDT: { cash: '1000', reserved: '0' }, USDC: { cash: '1000', reserved: '0' } }, positions: {}, orders: [], fills: [], quotes: {}, realized: { USDT: '0', USDC: '0' } };
    return new Response(JSON.stringify({ value, metrics: {}, actor: { issuer: ISSUER, subject } }));
  };
  return createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl });
}
async function gateway(t, demo) {
  const now = Date.now(), base = { metrics: {}, close() {}, catalogue: async () => CATALOG.map(r => ({ ...r, online: false, exists: null, sourceError: 'SOURCE_UNAVAILABLE' })), quote: async () => { throw Object.assign(new Error('SOURCE_UNAVAILABLE'), { code: 'SOURCE_UNAVAILABLE' }); }, history: async () => { throw new Error('SOURCE_UNAVAILABLE'); } };
  const prices = new IndicativeSolanaPrices({ fetchImpl: rpc().fetchImpl });
  await prices.snapshot();
  const moexQuote = { instrumentId: 'MOEX:TQBR:SBER', provider: 'moex', nativeCurrency: 'RUB', bid: '296.81', ask: '296.81', last: '296.81', timestamp: now - 900000, receivedAt: now, eventId: 'moex-1', verified: true, indicative: true, capacity: '1.00000000', multiplier: 1, delaySeconds: 900, marketOpen: true, change24h: 0.6, volume: '100', prices: { RUB: { buy: '296.81', sell: '296.81' } }, fx: {} };
  const moex = Object.assign(new IndicativeMoex(), { catalogue: async () => CATALOG.filter(r => r.provider === 'moex').map(r => ({ ...r, indicative: true, online: true, exists: true, display: null })), quote: async () => moexQuote });
  const hub = demo ? withIndicativePrices(base, prices, moex) : base, adapter = authority();
  const app = await createServer({ port: 0, autoPoll: false, financialEnabled: true, accountAuthority: adapter, hub, tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }] });
  t.after(async () => { await app.close(); await adapter.close(); });
  const call = async (letter, route, { body, token } = {}) => {
    const r = await fetch(`http://127.0.0.1:${app.port}/__stocks_global/${route}`, { method: body ? 'POST' : 'GET', headers: { authorization: bearer(letter), ...(body ? { 'content-type': 'application/json', 'x-stocks-token': token ?? '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { call };
}
const SPY = DEMO_CATALOG.find(r => r.asset === 'SPYx').id;

test('without the demo profile: no indicative row exists for a viewer and MOEX stays blocked', async t => {
  const { call } = await gateway(t, false);
  await call('V', 'catalogue'); const view = await call('V', 'state');
  assert.equal(view.status, 200); assert.equal(view.body.catalogue.some(r => r.indicative || r.id.startsWith('XSTOCK:')), false);
  assert.ok(view.body.catalogue.filter(r => r.provider === 'moex').every(r => r.sourceError === 'MOEX_UNVERIFIED' && r.online === false));
  const x = await call('V', 'state?id=' + encodeURIComponent(SPY));
  assert.equal(x.body.errors?.[SPY] ?? x.body.error, 'INVALID_PAIR'); assert.equal(x.body.quotes?.[SPY], undefined);
  assert.equal((await call('V', 'state?id=MOEX%3ATQBR%3ASBER')).body.errors['MOEX:TQBR:SBER'], 'MOEX_UNVERIFIED');
});

test('with the demo profile: xStock and MOEX prices are viewable in their own currency and every order on them is refused', async t => {
  const { call } = await gateway(t, true);
  const list = (await call('V', 'catalogue')).body.catalogue;
  assert.ok(list.some(r => r.id === SPY && r.online && r.indicative && Number(r.display.price) > 300)); assert.ok(list.filter(r => r.provider === 'moex').every(r => r.online && r.indicative && !r.sourceError));
  assert.equal(list.some(r => r.provider === 'bybit' || r.provider === 'binance'), false, 'no dead CEX rows in the demo list');
  const x = await call('V', 'state?id=' + encodeURIComponent(SPY));
  assert.equal(x.status, 200); assert.equal(x.body.quotes[SPY].status.USDC, 'READY'); assert.equal(x.body.quotes[SPY].indicative, true); assert.equal(x.body.errors[SPY], undefined);
  const m = await call('V', 'state?id=MOEX%3ATQBR%3ASBER');
  assert.equal(m.body.quotes['MOEX:TQBR:SBER'].status.RUB, 'READY'); assert.equal(m.body.errors['MOEX:TQBR:SBER'], undefined);
  // A trader (both server gates ON in this fixture) is refused an order on either, before any authority command.
  const token = (await call('A', 'state')).body.token;
  for (const instrumentId of [SPY, 'MOEX:TQBR:SBER']) {
    const r = await call('A', 'orders', { token, body: { id: 'demo-' + instrumentId, instrumentId, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '1' } });
    assert.deepEqual([r.status, r.body.error], [422, 'INDICATIVE_ONLY'], instrumentId);
  }
  const hist = await call('V', `history?id=${encodeURIComponent(SPY)}&interval=1m`);
  assert.equal(hist.status, 200); assert.equal(hist.body.candles.length, 1);
});
