// Copy Trading integration review (#658 Track A): ONE authenticated HTTP app, ONE
// follower, real JWT + Session rows, disposable loopback PostgreSQL only.
//   Spot:    leader LIMIT + MARKET through POST /demo/orders -> copy worker -> follower DemoOrder/DemoTrade
//   Futures: leader Native Demo OPEN/CLOSE -> follower observer scan -> follower-initiated run -> follower NativeDemo position
// Every HTTP status is recorded without tokens; user IDs are anonymised in the report.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const url = process.env.COPY_INTEGRATION_TEST_DATABASE_URL;
assert(url, 'Explicit disposable database URL required');
const parsed = new URL(url);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && /^\/copy_demo_[a-z0-9_]+$/.test(parsed.pathname), 'Refuse non-fixture database');
const leader = randomUUID(), follower = randomUUID(), other = randomUUID(), maker = randomUUID();
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: url,
  JWT_SECRET: 'copy-integration-fixture-only-not-a-production-key', EMAIL_VERIFICATION_SECRET: 'copy-integration-fixture-email',
  COPY_DEMO_ENABLED: 'true', COPY_DEMO_ISOLATED_REVIEW: 'true', DEMO_SPOT_ENABLED: 'true',
  COPY_FUTURES_DEMO_OBSERVER_ENABLED: 'true', COPY_FUTURES_DEMO_EXECUTION_ENABLED: 'true',
  PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: leader,
  PRIVATE_TRADING_TEST_USER_IDS: [follower, other].join(','), COPY_FUTURES_DEMO_APPROVED_LEADER_IDS: leader,
});
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client'), BN = require('bignumber.js');
const express = require('express'), request = require('supertest'), jwt = require('jsonwebtoken');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { CopyDemoService, copyDemoEnabled } = require('../src/services/copyTrading/CopyDemoService');
const { startCopyDemoWorker } = require('../src/services/copyTrading/copyDemoWorker');
const { copyDemoRouter } = require('../src/api/routes/copyDemo');
const { demoTradingRouter } = require('../src/api/routes/demoTrading');
const { NativeDemoService } = require('../src/private-trading/native/service');
const { PrismaNativeRepository } = require('../src/private-trading/native/store');
const { Clock, FakeMarket, H0, H, M } = require('../src/private-trading/native/testing/liveFixture');
const { FuturesDemoObserverService, futuresDemoObserverEnabled } = require('../src/services/copyTrading/FuturesDemoObserverService');
const { FuturesDemoFollowerExecutor, futuresDemoExecutionEnabled } = require('../src/services/copyTrading/FuturesDemoFollowerExecutor');
const { copyFuturesDemoObserverRouter } = require('../src/api/routes/copyFuturesDemoObserver');
const { copyFuturesDemoExecutionRouter } = require('../src/api/routes/copyFuturesDemoExecution');

const db = new PrismaClient({ datasources: { db: { url } } });
const anon = new Map([[leader, 'leader'], [follower, 'follower'], [other, 'other'], [maker, 'maker']]);
const log = [], checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
let executionOn = true;
// --- the same services index.ts constructs, wired the same way
const engine = new MatchingEngine();
let copy;
const demo = new DemoTradingService(db, engine, {
  orderLifecycle: (tx, id, event) => copy.orderLifecycle(tx, id, event),
  tradeLifecycle: (tx, ids) => copy.captureFills(tx, ids),
});
copy = new CopyDemoService(db, engine, demo);
const clock = new Clock(H0 + 5 * H + 5 * M + 30000), market = new FakeMarket(clock);
const native = new NativeDemoService(new PrismaNativeRepository(db, () => ({ enabled: true, ownerId: leader })), market, clock.now);
const executor = new FuturesDemoFollowerExecutor(db, native, () => executionOn && futuresDemoExecutionEnabled());
const app = express(); app.use(express.json());
app.use('/api/v1', demoTradingRouter(db, demo, undefined, { enabled: () => true, isSpotPair: async () => true }));
app.use('/api/v1', copyDemoRouter(db, copy));
app.use('/api/v1', copyFuturesDemoObserverRouter(db, new FuturesDemoObserverService(db)));
app.use('/api/v1', copyFuturesDemoExecutionRouter(db, executor, native, () => executionOn && futuresDemoExecutionEnabled()));

const tokens = {}, sessions = {};
async function login(id) {
  const s = await db.session.create({ data: { userId: id } }); sessions[id] = s.id;
  tokens[id] = jwt.sign({ sub: id, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
async function call(who, method, route, body) {
  let r = request(app)[method](`/api/v1${route}`);
  if (who) r = r.set('Authorization', `Bearer ${tokens[who]}`);
  const res = await (body ? r.send(body) : r);
  log.push({ as: who ? anon.get(who) : 'anonymous', method: method.toUpperCase(), route, status: res.status, code: res.body?.code ?? null });
  return res;
}
const actor = id => ({ userId: id, sessionId: sessions[id], expiresAt: Date.now() + H });
const nativeOpen = async id => (await db.nativeDemoAccount.findUniqueOrThrow({ where: { userId: id } })).payload.snapshot.positions.filter(p => p.status === 'OPEN');
async function protectedRows() {
  const out = {};
  for (const t of ['Balance', 'Order', 'Trade', 'FuturesOrder', 'FuturesPosition', 'Deposit', 'Withdrawal'])
    out[t] = await db.$queryRawUnsafe(`SELECT row_to_json(x)::text AS r FROM "${t}" x ORDER BY 1`);
  return JSON.stringify(out);
}
const demoTotals = async () => (await db.demoBalance.groupBy({ by: ['asset'], _sum: { available: true, locked: true }, orderBy: { asset: 'asc' } }))
  .map(r => [r.asset, new BN(r._sum.available.toString()).plus(r._sum.locked.toString()).toFixed()]);
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); } };

async function main() {
  assert.equal(await db.user.count(), 0, 'Refuse nonempty fixture database');
  await check('gates: production, remote DB and missing execution flag all fail closed', async () => {
    const review = { ...process.env };
    assert.equal(copyDemoEnabled(review), true); assert.equal(futuresDemoExecutionEnabled(review), true);
    assert.equal(futuresDemoExecutionEnabled({ ...review, NODE_ENV: 'production' }), false);
    assert.equal(futuresDemoExecutionEnabled({ ...review, DATABASE_URL: 'postgresql://db.production.invalid/copy_demo_x' }), false);
    assert.equal(futuresDemoExecutionEnabled({ ...review, COPY_FUTURES_DEMO_EXECUTION_ENABLED: 'false' }), false);
    assert.equal(futuresDemoObserverEnabled({ ...review, COPY_DEMO_ENABLED: 'false' }), false);
  });
  for (const [id, role] of [[leader, 'ADMIN'], [follower, 'USER'], [other, 'USER'], [maker, 'USER']]) {
    await db.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'fixture', role, referralCode: id.replaceAll('-', '').slice(0, 16) } });
    await db.auditLog.create({ data: { userId: id, action: 'DEMO_BALANCE_ADJUSTED', metadata: { fixture: true } } });
    for (const asset of ['USDT', 'BTC']) await db.demoBalance.create({ data: { userId: id, asset, available: asset === 'USDT' ? '10000' : '10' } });
    await db.balance.create({ data: { userId: id, asset: 'USDT', available: '777', locked: '3' } });
    await login(id);
  }
  await db.copyStrategyOwner.upsert({ where: { traderId: 'VX-001' }, create: { traderId: 'VX-001', publicName: 'Fixture', ownerUserId: leader }, update: { ownerUserId: leader } });
  const protectedBefore = await protectedRows(), totalsBefore = await demoTotals();

  // ---------------- Spot: LIMIT + MARKET through HTTP and the real worker
  const stopWorker = startCopyDemoWorker(copy, copyDemoEnabled, e => { throw e; });
  try {
    await check('Spot: follower subscribes over HTTP; earlier leader orders are not backfilled', async () => {
      const early = await call(leader, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', quantity: '1', price: '90', requestId: randomUUID() });
      assert.equal(early.status, 201, JSON.stringify(early.body));
      const sub = await call(follower, 'put', '/copy-trading/demo/subscription', { traderId: 'VX-001', ratio: '0.5', maxOrderUsdt: '500', maxExposureUsdt: '1000' });
      assert.equal(sub.status, 200); assert.equal(sub.body.subscription.status, 'ACTIVE'); assert.equal(sub.body.executions.length, 0);
      assert.equal((await call(leader, 'delete', `/demo/orders/${early.body.order.id}`)).status, 204);
    });
    let limitSource;
    await check('Spot LIMIT: leader order -> worker places exactly one follower order at ratio, server status visible', async () => {
      limitSource = await call(leader, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', quantity: '2', price: '100', requestId: randomUUID() });
      assert.equal(limitSource.status, 201);
      const snap = await waitFor(async () => { const s = await call(follower, 'get', '/copy-trading/demo'); return s.body.executions.find(e => e.status === 'EXECUTED') ? s : null; });
      const ex = snap.body.executions[0];
      assert.equal(ex.order.originalQuantity.toString(), '1'); assert.equal(ex.order.type, 'LIMIT');
      assert.equal(await db.demoOrder.count({ where: { userId: follower } }), 1);
    });
    await check('Spot LIMIT fill: maker sell fills leader and follower; follower position and fees from real DemoTrade rows', async () => {
      const fill = await call(maker, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', quantity: '3', price: '100', requestId: randomUUID() });
      assert.equal(fill.status, 201);
      const s = await call(follower, 'get', '/copy-trading/demo');
      assert.deepEqual(s.body.positions, [{ pair: 'BTC/USDT', quantity: '1', costUsdt: '100' }]);
      const trades = await db.demoTrade.findMany({ where: { OR: [{ makerUserId: follower }, { takerUserId: follower }] } });
      assert.equal(trades.length, 1); assert.equal(trades[0].quantity.toString(), '1');
    });
    await check('Spot MARKET: leader market sell copies only the filled quantity; realized PnL from fills', async () => {
      await call(maker, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', quantity: '5', price: '110', requestId: randomUUID() });
      const src = await call(leader, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: '2', requestId: randomUUID() });
      assert.equal(src.status, 201);
      const snap = await waitFor(async () => { const s = await call(follower, 'get', '/copy-trading/demo'); return s.body.executions.filter(e => e.status === 'EXECUTED').length === 2 ? s : null; });
      const market = snap.body.executions.find(e => e.order?.type === 'MARKET');
      assert.equal(market.order.side, 'SELL'); assert.equal(market.order.originalQuantity.toString(), '1');
      assert.equal(snap.body.positions[0].quantity, '0'); assert.equal(snap.body.realizedPnlUsdt, '10');
    });
    await check('Spot STOP: open copied order cancelled, filled assets retained, later leader orders not copied', async () => {
      const resting = await call(leader, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', quantity: '2', price: '95', requestId: randomUUID() });
      await waitFor(async () => (await db.copyDemoExecution.findFirst({ where: { sourceOrderId: resting.body.order.id, status: 'EXECUTED' } })));
      const stop = await call(follower, 'delete', '/copy-trading/demo/subscription');
      assert.equal(stop.status, 200); assert.equal(stop.body.subscription.status, 'STOPPED');
      assert.ok(stop.body.executions.every(e => !e.order || e.order.status !== 'OPEN'));
      const after = await call(leader, 'post', '/demo/orders', { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', quantity: '1', price: '94', requestId: randomUUID() });
      await new Promise(r => setTimeout(r, 2500));
      assert.equal(await db.copyDemoExecution.count({ where: { sourceOrderId: after.body.order.id } }), 0);
      for (const id of [resting.body.order.id, after.body.order.id]) await call(leader, 'delete', `/demo/orders/${id}`);
    });
  } finally { stopWorker(); }
  await check('Spot: demo assets conserved across leader, follower and maker (no value created or lost)', async () => {
    assert.deepEqual(await demoTotals(), totalsBefore);
  });
  // Native Demo Futures initialisation moves the account's demo USDT into its
  // own margin ledger (existing NativeDemoService behaviour, not changed here).
  for (const id of [leader, follower, other]) await native.initialize(actor(id), `fixture-init-${id}`);

  // ---------------- Futures: OPEN / CLOSE through follower HTTP
  await check('Futures: auth, OFF, forged body and consent-before-observation are refused', async () => {
    assert.equal((await call(null, 'get', '/copy-trading/futures-demo-execution')).status, 401);
    executionOn = false; assert.equal((await call(follower, 'get', '/copy-trading/futures-demo-execution')).status, 403); executionOn = true;
    const limits = { ratio: '0.5', maxLeverage: '3', maxFillUsdt: '6000', maxTotalExposureUsdt: '6500', maxDeviationBps: '100' };
    assert.equal((await call(follower, 'put', '/copy-trading/futures-demo-execution', { ...limits, userId: other })).status, 400);
    const early = await call(follower, 'put', '/copy-trading/futures-demo-execution', limits);
    assert.equal(early.status, 403); assert.equal(early.body.code, 'OBSERVATION_REQUIRED');
  });
  const limits = { ratio: '0.5', maxLeverage: '3', maxFillUsdt: '6000', maxTotalExposureUsdt: '6500', maxDeviationBps: '100' };
  let sourcePosition;
  await check('Futures: pre-consent leader OPEN is never copied (no backfill)', async () => {
    const pre = await native.command(actor(leader), { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '2', marginType: 'ISOLATED', idempotencyKey: 'pre-' + randomUUID() });
    assert.equal((await call(follower, 'put', '/copy-trading/futures-demo-observer/subscription', { traderId: 'VX-001', maxLeverage: '3', maxFillUsdt: '6000' })).status, 200);
    const consent = await call(follower, 'put', '/copy-trading/futures-demo-execution', limits);
    assert.equal(consent.status, 200); assert.equal(consent.body.consent.status, 'ACTIVE');
    clock.t += M + 100;
    await native.command(actor(leader), { kind: 'CLOSE', positionId: pre.positions[0].id, quantity: '0.1', idempotencyKey: 'pre-close-' + randomUUID() });
    assert.equal((await call(follower, 'post', '/copy-trading/futures-demo-observer/scan')).status, 200);
    const run = await call(follower, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(run.status, 200);
    // Leader notional 0.1 BTC x 50000 = 5000 USDT stays under the 6000 observation cap.
    // The CLOSE of a position opened before consent has no copied OPEN to reduce.
    assert.deepEqual(run.body.results.map(r => [r.status, r.reason]), [['REJECTED', 'NO_COPY_ATTRIBUTED_POSITION']]);
    assert.equal((await nativeOpen(follower)).length, 0);
  });
  await check('Futures OPEN: leader fill -> follower scan + run -> one follower position at ratio, receipt APPLIED', async () => {
    clock.t += M + 100;
    const src = await native.command(actor(leader), { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '2', marginType: 'ISOLATED', idempotencyKey: 'open-' + randomUUID() });
    sourcePosition = src.positions[0].id;
    assert.equal((await call(follower, 'post', '/copy-trading/futures-demo-observer/scan')).body.accepted, 1);
    const run = await call(follower, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(run.status, 200); assert.equal(run.body.results.length, 1); assert.equal(run.body.results[0].status, 'APPLIED');
    const open = await nativeOpen(follower); assert.equal(open.length, 1); assert.equal(open[0].quantity, '0.05');
    const applied = run.body.mirrors.find(m => m.kind === 'OPEN' && m.status === 'APPLIED');
    assert.equal(applied.followerPositionId, open[0].id); assert.equal(applied.filledQuantity, '0.05');
    const again = await call(follower, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(again.body.results.length, 0); assert.equal((await nativeOpen(follower)).length, 1);
  });
  await check('Futures isolation: another user sees none of the follower receipts and cannot run them', async () => {
    const o = await call(other, 'get', '/copy-trading/futures-demo-execution');
    assert.equal(o.status, 200); assert.equal(o.body.consent, null); assert.deepEqual(o.body.mirrors, []);
    const r = await call(other, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(r.status, 403); assert.equal(r.body.code, 'COPY_EXECUTION_CONSENT_REQUIRED');
  });
  await check('Futures CLOSE: leader close -> follower copied position closed exactly, no phantom close', async () => {
    clock.t += M + 100;
    await native.command(actor(leader), { kind: 'CLOSE', positionId: sourcePosition, quantity: '0.1', idempotencyKey: 'close-' + randomUUID() });
    await call(follower, 'post', '/copy-trading/futures-demo-observer/scan');
    const run = await call(follower, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(run.body.results[0].status, 'APPLIED'); assert.equal((await nativeOpen(follower)).length, 0);
    assert.equal(await db.copyFuturesDemoMirror.count({ where: { status: 'APPLIED' } }), 2);
  });
  await check('Futures STOP: open copied position retained; later leader OPEN not executed; run refused', async () => {
    clock.t += M + 100;
    const src = await native.command(actor(leader), { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '2', marginType: 'ISOLATED', idempotencyKey: 'open2-' + randomUUID() });
    await call(follower, 'post', '/copy-trading/futures-demo-observer/scan');
    assert.equal((await call(follower, 'post', '/copy-trading/futures-demo-execution/run')).body.results[0].status, 'APPLIED');
    const stop = await call(follower, 'delete', '/copy-trading/futures-demo-execution');
    assert.equal(stop.status, 200); assert.equal(stop.body.existingPositionsRetained, true); assert.equal(stop.body.consent.status, 'STOPPED');
    assert.equal((await nativeOpen(follower)).length, 1);
    clock.t += M + 100;
    await native.command(actor(leader), { kind: 'CLOSE', positionId: src.positions[0].id, quantity: '0.1', idempotencyKey: 'close2-' + randomUUID() });
    const r = await call(follower, 'post', '/copy-trading/futures-demo-execution/run');
    assert.equal(r.status, 403); assert.equal(r.body.code, 'COPY_EXECUTION_STOPPED');
    assert.equal((await nativeOpen(follower)).length, 1);
  });
  if (process.env.COPY_INTEGRATION_BROWSER === '1') await check('browser 1440/390: start copying, apply a real leader trade, see the executed row, stop; 7 languages', async () => {
    const bundle = path.resolve('output/copy-integration-658/frontend');
    assert(fs.existsSync(path.join(bundle, 'index.html')), 'Build the flagged review frontend first');
    app.use(express.static(bundle)); app.get('*', (_req, res) => res.sendFile(path.join(bundle, 'index.html')));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch();
    const shots = path.resolve('output/copy-integration-658/screens'); fs.mkdirSync(shots, { recursive: true });
    const errors = [], external = [];
    const open = async (width, height, lang) => {
      const ctx = await browser.newContext({ viewport: { width, height } });
      await ctx.addInitScript(([token, l]) => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', l); }, [tokens[other], lang]);
      await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin !== origin) { if (!/^fonts\.(googleapis|gstatic)\.com$/.test(u.host)) external.push(u.host); return r.abort(); } return r.continue(); });
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${origin}/copy-trading/futures-demo-observer`); await page.waitForSelector('.futures-copy');
      return { ctx, page };
    };
    const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    try {
      const { ctx, page } = await open(1440, 900, 'en');
      const form = page.locator('.copy-futures-observer > form');
      await form.locator('input').nth(0).fill('3'); await form.locator('input').nth(1).fill('6000');
      await form.locator('button[type=submit]').click();
      await page.getByText('Following the trader', { exact: false }).or(page.getByText('Observing strategy events')).first().waitFor();
      const copyForm = page.locator('.futures-copy form'), inputs = copyForm.locator('input');
      for (const [i, v] of ['0.5', '3', '6000', '6500', '100'].entries()) await inputs.nth(i).fill(v);
      await copyForm.locator('button[type=submit]').click();
      await page.getByText('Order copying: ON', { exact: false }).waitFor();
      assert.equal(await page.getByText('Automatic order copying: OFF').count(), 0, 'observation-only notice hidden while copying');
      clock.t += M + 100;
      const src = await native.command(actor(leader), { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '2', marginType: 'ISOLATED', idempotencyKey: 'ui-open-' + randomUUID() });
      await page.getByRole('button', { name: 'Apply new trades' }).click();
      await page.locator('.futures-copy li[data-status="APPLIED"]').first().waitFor();
      assert.match(await page.locator('.futures-copy li').first().innerText(), /BTCUSDT · Open · LONG · Executed · Quantity 0\.05/);
      assert.equal((await nativeOpen(other)).length, 1);
      await page.screenshot({ path: path.join(shots, 'copy-1440-executed.png'), fullPage: true });
      clock.t += M + 100;
      await native.command(actor(leader), { kind: 'CLOSE', positionId: src.positions[0].id, quantity: '0.1', idempotencyKey: 'ui-close-' + randomUUID() });
      await page.getByRole('button', { name: 'Apply new trades' }).click();
      await page.locator('.futures-copy li[data-status="APPLIED"]').nth(1).waitFor();
      assert.equal((await nativeOpen(other)).length, 0);
      await page.getByRole('button', { name: 'Stop copying' }).click();
      await page.getByText('Order copying: OFF', { exact: true }).waitFor();
      assert.equal(await overflow(page), 0);
      await ctx.close();
      for (const lang of ['en', 'ru', 'es', 'zh', 'hi', 'ja', 'ko']) {
        const m = await open(390, 844, lang);
        await m.page.locator('.futures-copy li').nth(1).waitFor();
        const text = await m.page.locator('main').innerText();
        assert.doesNotMatch(text, /futuresCopy|undefined|NaN|\bnull\b/, lang);
        assert.equal(await overflow(m.page), 0, `${lang} horizontal overflow`);
        await m.page.screenshot({ path: path.join(shots, `copy-390-${lang}.png`), fullPage: true });
        await m.ctx.close();
      }
      assert.deepEqual(errors, []); assert.deepEqual([...new Set(external)], [], 'external hosts: ' + [...new Set(external)].join(','));
    } finally { await browser.close(); server.close(); }
  });
  await check('revoked session: every copy route answers 401 and nothing is executed', async () => {
    await db.session.update({ where: { id: sessions[follower] }, data: { revokedAt: new Date() } });
    for (const [m, r] of [['get', '/copy-trading/demo'], ['get', '/copy-trading/futures-demo-execution'], ['post', '/copy-trading/futures-demo-execution/run']])
      assert.equal((await call(follower, m, r)).status, 401);
  });
  await check('real balances, orders, trades, futures, deposits and withdrawals unchanged', async () => {
    assert.equal(await protectedRows(), protectedBefore);
  });
  const out = path.resolve('output/copy-integration-658'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ result: 'PASS', checks, http: log, production: false }, null, 2));
  console.log(`${checks.length} integration checks PASS; ${log.length} HTTP calls recorded`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
