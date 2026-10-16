import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { startTwoTraderPreview, FIXTURE_STARTING_USDT, FIXTURE_INSTRUMENTS } from './stocks-two-trader-preview.mjs';

const ID = FIXTURE_INSTRUMENTS[0];
async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'stocks-two-trader-preview-test-'));
  const dist = join(parent, 'dist'), dataDir = join(parent, 'voltex-stocks-two-trader-test');
  await mkdir(dist); await writeFile(join(dist, 'index.html'), '<!doctype html><html><body><main id="root">Fixture frontend placeholder for HTTP tests</main></body></html>');
  let app = await startTwoTraderPreview({ dataDir, dist });
  t.after(async () => { await app.close(); await rm(parent, { recursive: true, force: true }); });
  return { parent, dist, dataDir, get app() { return app; }, async restart() { await app.close(); app = await startTwoTraderPreview({ dataDir, dist }); } };
}
async function request(app, path, { token, method = 'GET', body, csrf, origin = app.origin } = {}) {
  const response = await fetch(app.origin + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-Stocks-Token': csrf } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function login(app, account) { const response = await request(app, '/__stocks_fixture/login', { method: 'POST', body: { account } }); assert.equal(response.status, 200); return response.body.token; }
const state = (app, token, select = true) => request(app, '/__stocks_global/state' + (select ? '?id=' + encodeURIComponent(ID) : ''), { token });
const wallet = (app, token) => request(app, '/api/v1/demo/vta', { token });
const order = (app, token, csrf, value) => request(app, '/__stocks_global/orders', { token, csrf, method: 'POST', body: { instrumentId: ID, currency: 'USDT', type: 'MARKET', side: 'BUY', quantity: '0.1', ...value } });

test('fixture two traders share each own Stocks cash with read-only Wallet; trades and reserves survive restart', async t => {
  const f = await fixture(t);
  let alpha = await login(f.app, 'alpha'), beta = await login(f.app, 'beta');
  let a = await state(f.app, alpha), b = await state(f.app, beta);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.account.canTrade, true); assert.equal(b.body.account.canTrade, true);
  assert.notEqual(a.body.account.id, b.body.account.id);
  assert.equal(a.body.wallets.USDT.cash, FIXTURE_STARTING_USDT[0]);
  assert.equal(b.body.wallets.USDT.cash, FIXTURE_STARTING_USDT[1]);
  assert.equal(a.body.wallets.USDC.cash, '0.00000000');
  // Existing ledgers retain the engine's recovery epoch (+2s future-skew fence).
  // Wait for a genuinely newer fixture observation, never bypass that guard.
  assert.notEqual(a.body.quotes[ID]?.status?.USDT, 'READY');
  const readyBy = Date.now() + 5000;
  while (a.body.quotes[ID]?.status?.USDT !== 'READY' && Date.now() < readyBy) {
    await new Promise(resolve => setTimeout(resolve, 250));
    a = await state(f.app, alpha);
  }
  assert.equal(a.body.errors[ID], undefined, JSON.stringify(a.body.errors));
  assert.equal(a.body.quotes[ID]?.status?.USDT, 'READY', JSON.stringify(a.body.quotes[ID]));
  const buy = await order(f.app, alpha, a.body.token, { id: 'fixture-alpha-buy-0001' });
  assert.equal(buy.status, 200, JSON.stringify(buy.body)); assert.equal(buy.body.wallets.USDT.cash, '721.24000000');
  const replay = await order(f.app, alpha, a.body.token, { id: 'fixture-alpha-buy-0001' });
  assert.equal(replay.status, 200); assert.equal(replay.body.fills.length, 1);
  let w = await wallet(f.app, alpha);
  assert.equal(w.status, 200); assert.equal(w.body.fixtureOnly, true); assert.equal(w.body.liveDemoBalanceBridge, false);
  assert.equal(w.body.balances[0].available, buy.body.wallets.USDT.cash);
  assert.equal((await wallet(f.app, beta)).body.balances[0].available, FIXTURE_STARTING_USDT[1]);
  const partial = await order(f.app, alpha, a.body.token, { id: 'fixture-alpha-sell-partial-0001', side: 'SELL', quantity: '0.04' });
  assert.equal(partial.status, 200); assert.equal(partial.body.wallets.USDT.cash, '725.24000000');
  const full = await order(f.app, alpha, a.body.token, { id: 'fixture-alpha-sell-full-0001', side: 'SELL', quantity: '0.06' });
  assert.equal(full.status, 200); assert.equal(full.body.wallets.USDT.cash, '731.24000000');
  const limit = await order(f.app, alpha, a.body.token, { id: 'fixture-alpha-limit-0001', type: 'LIMIT', limitPrice: '90' });
  assert.equal(limit.status, 200); assert.equal(limit.body.wallets.USDT.reserved, '9.00000000');
  w = await wallet(f.app, alpha); assert.equal(w.body.balances[0].available, '722.24000000'); assert.equal(w.body.balances[0].locked, '9.00000000');
  await f.restart();
  assert.equal((await state(f.app, alpha)).status, 401, 'old ephemeral fixture session is not valid after restart');
  alpha = await login(f.app, 'alpha'); beta = await login(f.app, 'beta');
  const restored = await state(f.app, alpha, false);
  assert.equal(restored.body.wallets.USDT.cash, '731.24000000'); assert.equal(restored.body.wallets.USDT.reserved, '9.00000000'); assert.equal(restored.body.fills.length, 3);
  assert.equal((await wallet(f.app, beta)).body.balances[0].available, FIXTURE_STARTING_USDT[1]);
  const cancelled = await request(f.app, '/__stocks_global/cancel', { token: alpha, csrf: restored.body.token, method: 'POST', body: { id: 'fixture-alpha-limit-0001' } });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.wallets.USDT.reserved, '0.00000000');
  assert.equal((await wallet(f.app, alpha)).body.balances[0].available, '731.24000000');
});

test('viewer receives explicit fixture market data, creates no ledger, and cannot forge a trader or native operation', async t => {
  const f = await fixture(t), viewer = await login(f.app, 'viewer');
  const before = f.app.accountMetrics();
  const results = await Promise.all([state(f.app, viewer), request(f.app, '/__stocks_global/catalogue', { token: viewer }), request(f.app, '/__stocks_global/history?id=' + encodeURIComponent(ID) + '&interval=15m', { token: viewer })]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results[0].body.account.canTrade, false); assert.equal(results[0].body.wallets.USDT.cash, '0.00000000');
  assert.equal(results[0].body.quotes[ID].fixtureOnly, true);
  assert.deepEqual(results[1].body.catalogue.map(x => x.id), FIXTURE_INSTRUMENTS);
  assert.equal(results[2].body.fixtureOnly, true); assert.equal(results[2].body.candles.length, 40);
  const w = await wallet(f.app, viewer); assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.account.active, false); assert.equal(w.body.balances[0].available, '0.00000000');
  const fixtureWallet = await fetch(f.app.origin + '/__stocks_fixture/wallet');
  assert.equal(fixtureWallet.status, 200);
  const fixtureWalletHtml = await fixtureWallet.text();
  assert.match(fixtureWalletHtml, /Fixture Wallet — test only/);
  assert.match(fixtureWalletHtml, /fetch\('\/api\/v1\/demo\/vta',\{method:'GET'/);
  assert.match(fixtureWalletHtml, /localStorage\.getItem\('exchange_token'\)/);
  assert.equal((await wallet(f.app, viewer)).body.balances[0].available, '0.00000000');
  const forbidden = await order(f.app, viewer, results[0].body.token, { id: 'fixture-viewer-forged-001' });
  assert.equal(forbidden.status, 401); assert.equal(forbidden.body.error, 'AUTH_REQUIRED');
  assert.equal(f.app.accountMetrics().queue.accepted, before.queue.accepted, 'viewer reads and denied commands never enter financial queue');
  const db = new DatabaseSync(f.app.accountsPath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM paper_accounts').get().n, 2); } finally { db.close(); }
  for (const path of ['/api/v1/orders', '/api/v1/private-trading/native/orders', '/api/v1/demo/vta/sell', '/api/v1/futures/orders']) {
    const denied = await request(f.app, path, { token: viewer, method: 'POST', body: {} }); assert.equal(denied.status, 403); assert.equal(denied.body.error, 'FINANCIAL_WRITES_BLOCKED');
  }
  assert.equal((await request(f.app, '/__stocks_fixture/login', { method: 'POST', body: { account: 'alpha', subject: 'fixture-trader-alpha' } })).status, 400);
  const logout = await request(f.app, '/api/v1/auth/logout', { token: viewer, method: 'POST', body: {} }); assert.equal(logout.status, 200);
  assert.equal((await state(f.app, viewer)).status, 401);
});

test('fixture history uses exclusive millisecond pagination and returns contiguous older second-based candles', async t => {
  const f = await fixture(t), viewer = await login(f.app, 'viewer');
  for (const [interval, step] of [['1m', 60], ['15m', 900], ['1D', 86400]]) {
    const path = '/__stocks_global/history?id=' + encodeURIComponent(ID) + '&interval=' + interval;
    const first = await request(f.app, path, { token: viewer });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.fixtureOnly, true); assert.equal(first.body.candles.length, 40);
    const oldest = first.body.candles[0].time;
    const beforeMs = oldest * 1000 - 1;
    const older = await request(f.app, path + '&before=' + beforeMs, { token: viewer });
    assert.equal(older.status, 200, JSON.stringify(older.body));
    assert.equal(older.body.candles.length, 40);
    const times = older.body.candles.map(candle => candle.time);
    assert.ok(times.every(time => Number.isSafeInteger(time) && time * 1000 < beforeMs));
    assert.equal(Math.max(...times), oldest - step, 'newest older candle is immediately before the previous oldest, without a gap');
    assert.equal(new Set([...times, ...first.body.candles.map(candle => candle.time)]).size, 80, 'pages do not overlap');
    assert.ok(times.every((time, i) => i === 0 || time - times[i - 1] === step));
    const exactBoundary = await request(f.app, path + '&before=' + oldest * 1000, { token: viewer });
    assert.equal(exactBoundary.status, 200);
    assert.deepEqual(exactBoundary.body.candles, older.body.candles, 'exact millisecond boundary remains exclusive');
  }
});

test('preview hard rejects foreign hosts/origins and presents fixture labels plus network-denying CSP', async t => {
  const f = await fixture(t);
  const landing = await fetch(f.app.origin + '/'); const html = await landing.text();
  assert.match(html, /LOCAL FIXTURES ONLY/); assert.match(html, /not the production DemoBalance integration/);
  assert.match(html, /href="\/__stocks_fixture\/wallet"/);
  assert.match(landing.headers.get('content-security-policy'), /connect-src 'self'/); assert.match(landing.headers.get('content-security-policy'), /frame-src 'none'/);
  const page = await fetch(f.app.origin + '/stocks/' + encodeURIComponent(ID)); assert.match(await page.text(), /local-stocks-fixture-banner/);
  const fixtureWallet = await fetch(f.app.origin + '/__stocks_fixture/wallet'), fixtureWalletHtml = await fixtureWallet.text();
  assert.match(fixtureWallet.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(fixtureWalletHtml, /NOT the production DemoBalance integration/);
  assert.match(fixtureWalletHtml, /Same fixture ledger; read only/);
  assert.match(fixtureWalletHtml, /id="wallet-cash"/); assert.match(fixtureWalletHtml, /id="wallet-available"/); assert.match(fixtureWalletHtml, /id="wallet-reserved"/);
  assert.doesNotMatch(fixtureWalletHtml, /method:'POST'|localStorage\.setItem|isAdmin/);
  assert.equal((await request(f.app, '/__stocks_fixture/login', { method: 'POST', body: { account: 'alpha' }, origin: 'https://voltex.example' })).status, 403);
  assert.equal((await request(f.app, '/__stocks_fixture/login', { method: 'POST', body: { account: 'alpha' }, origin: null })).status, 403);
  const hostStatus = await new Promise((ok, fail) => { const req = http.get(f.app.origin + '/', { headers: { Host: 'evil.example' } }, res => { res.resume(); ok(res.statusCode); }); req.once('error', fail); });
  assert.equal(hostStatus, 403);
  const alpha = await login(f.app, 'alpha');
  assert.equal((await request(f.app, '/__stocks_global/state?id=MOEX%3ATQBR%3ASBER', { token: alpha })).body.errors['MOEX:TQBR:SBER'], 'MOEX_UNVERIFIED');
  const history = await request(f.app, '/__stocks_global/history?id=MOEX%3ATQBR%3ASBER&interval=1m', { token: alpha }); assert.equal(history.status, 422); assert.equal(history.body.error, 'MOEX_UNVERIFIED');
  assert.equal(f.app.audit.externalRequests, 0);
});

test('existing fixture marker/ledger cannot be reset, second writer refuses, and wrong directory fails closed', async t => {
  const f = await fixture(t);
  await assert.rejects(startTwoTraderPreview({ dataDir: f.dataDir, dist: f.dist }), /EEXIST/);
  await assert.rejects(startTwoTraderPreview({ dataDir: join(f.parent, 'not-a-fixture'), dist: f.dist }), /DEDICATED_FIXTURE_DIRECTORY_REQUIRED/);
  await f.app.close();
  const markerPath = join(f.dataDir, 'fixture-only.json'), original = await readFile(markerPath, 'utf8');
  await writeFile(markerPath, '{"fixtureOnly":false}');
  await assert.rejects(startTwoTraderPreview({ dataDir: f.dataDir, dist: f.dist }), /FIXTURE_DIRECTORY_NOT_RECOGNIZED/);
  assert.equal(await readFile(markerPath, 'utf8'), '{"fixtureOnly":false}');
  await writeFile(markerPath, original);
});
