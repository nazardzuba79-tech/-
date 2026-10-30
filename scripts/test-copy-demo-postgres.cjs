// Disposable, empty, loopback PostgreSQL only. Never reads production env URLs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const url = process.env.COPY_DEMO_TEST_DATABASE_URL;
assert(url, 'Explicit isolated fixture URL required');
const parsed = new URL(url);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && /^\/copy_demo_[a-z0-9_]+$/.test(parsed.pathname), 'Refuse non-fixture database');
process.env.JWT_SECRET = 'copy-demo-isolated-fixture-only-not-a-production-key';
process.env.EMAIL_VERIFICATION_SECRET = 'copy-demo-isolated-fixture-email-secret';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client'), BN = require('bignumber.js');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { CopyDemoService, copyDemoEnabled } = require('../src/services/copyTrading/CopyDemoService');
const { copyDemoRouter } = require('../src/api/routes/copyDemo');
const express = require('express'), request = require('supertest'), jwt = require('jsonwebtoken');
let db = new PrismaClient({ datasources: { db: { url } } });
let demo, copy, on = true;
function construct() { const engine = new MatchingEngine(); demo = new DemoTradingService(db, engine, { orderLifecycle: (...args) => copy.orderLifecycle(...args), tradeLifecycle: (...args) => copy.captureFills(...args) }); copy = new CopyDemoService(db, engine, demo, () => on); }
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
const risk = { ratio: '0.5', maxOrderUsdt: '500', maxExposureUsdt: '1000' };
const place = (userId, side, quantity, price = '100', pair = 'BTC/USDT') => demo.placeOrder({ userId, pair, side, type: 'LIMIT', quantity: new BN(quantity), price: new BN(price), requestId: randomUUID() });
const expectCode = async (fn, code) => assert.rejects(fn, e => e.code === code);
let server;
async function protectedRows() {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const { tablename } of tables) if (/^(Balance|Order|Trade|.*Ledger|Futures.*|Native.*|.*Deposit.*|Withdrawal|Wallet.*|Banking.*|SyntheticCopyTradingState|CopyPerformanceScenario)$/.test(tablename) && /^\w+$/.test(tablename)) {
    result[tablename] = await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t ORDER BY row_to_json(t)::text`);
  }
  return JSON.stringify(result);
}
async function main() {
  assert.equal(await db.user.count(), 0, 'Refuse nonempty fixture');
  construct();
  for (const id of ['leader', 'ksenia', 'follower', 'other', 'maker', 'unfunded', 'blocked', 'poor', 'oversize', 'race']) {
    await db.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'fixture', referralCode: id.toUpperCase(), role: 'USER', blockedAt: id === 'blocked' ? new Date() : null } });
    if (id !== 'unfunded') await db.auditLog.create({ data: { userId: id, action: 'DEMO_BALANCE_ADJUSTED', metadata: { fixture: true } } });
    // Explicit synthetic scenario, never an API credit or production account.
    for (const asset of ['USDT', 'BTC', 'ETH']) await db.demoBalance.create({ data: { userId: id, asset, available: id === 'poor' ? '0' : asset === 'USDT' ? '10000' : '100' } });
    await db.balance.create({ data: { userId: id, asset: 'USDT', available: '777', locked: '3' } });
  }
  for (const data of [{ traderId: 'VX-001', publicName: 'Fixture Nazar', ownerUserId: 'leader' }, { traderId: 'VX-KSENIA', publicName: 'Fixture Ksenia', ownerUserId: 'ksenia' }])
    await db.copyStrategyOwner.upsert({ where: { traderId: data.traderId }, create: data, update: data });
  const protectedBefore = await protectedRows();
  const totals = async () => (await db.demoBalance.groupBy({ by: ['asset'], _sum: { available: true, locked: true }, orderBy: { asset: 'asc' } })).map(r => [r.asset, new BN(r._sum.available.toString()).plus(r._sum.locked.toString()).toFixed()]);
  const totalsBefore = await totals();
  await check('default OFF and production fail closed even with review flags', async () => {
    assert.equal(copyDemoEnabled({}), false);
    assert.equal(copyDemoEnabled({ COPY_DEMO_ENABLED: 'true', COPY_DEMO_ISOLATED_REVIEW: 'true', DEMO_SPOT_ENABLED: 'true', NODE_ENV: 'production' }), false);
    const review = { COPY_DEMO_ENABLED: 'true', COPY_DEMO_ISOLATED_REVIEW: 'true', DEMO_SPOT_ENABLED: 'true', NODE_ENV: 'test', DATABASE_URL: url };
    assert.equal(copyDemoEnabled(review), true);
    assert.equal(copyDemoEnabled({ ...review, DATABASE_URL: 'postgresql://localhost/actual_exchange' }), false);
    assert.equal(copyDemoEnabled({ ...review, DATABASE_URL: 'postgresql://db.production.invalid/copy_demo_fixture' }), false);
    on = false; await expectCode(() => copy.subscribe('follower', 'VX-001', risk), 'COPY_DEMO_OFF'); on = true;
  });
  await check('ownership admission self/cycle unknown strategy and invalid risk', async () => {
    await expectCode(() => copy.subscribe('leader', 'VX-001', risk), 'LEADER_CANNOT_FOLLOW');
    await expectCode(() => copy.subscribe('ksenia', 'VX-001', risk), 'LEADER_CANNOT_FOLLOW');
    await expectCode(() => copy.subscribe('unfunded', 'VX-001', risk), 'COPY_DEMO_ACCESS_DENIED');
    await expectCode(() => copy.subscribe('blocked', 'VX-001', risk), 'COPY_DEMO_ACCESS_DENIED');
    await expectCode(() => copy.subscribe('follower', 'VIP-OTHER', risk), 'UNSUPPORTED_STRATEGY');
    await expectCode(() => copy.subscribe('follower', 'VX-001', { ...risk, ratio: '1.1' }), 'INVALID_RISK');
  });
  const old = await place('leader', 'BUY', '1', '10');
  await copy.subscribe('follower', 'VX-001', risk);
  await check('persistent subscription excludes historical orders and synthetic performance', async () => {
    assert.equal((await copy.snapshot('follower')).subscription.status, 'ACTIVE');
    assert.equal(await db.copyDemoExecution.count(), 0);
    await demo.cancelOrder('leader', old.order.id);
  });
  const source = await place('leader', 'BUY', '2');
  await check('transactional outbox survives reconnect; concurrent drains create one order', async () => {
    await db.$disconnect(); db = new PrismaClient({ datasources: { db: { url } } }); construct();
    await Promise.all([copy.drain(), copy.drain(), copy.drain()]);
    let s = await copy.snapshot('follower'); assert.equal(s.executions.length, 1); assert.equal(s.executions[0].order.originalQuantity.toString(), '1');
    assert.equal(s.exposureUsdt, '100'); assert.equal(s.executions[0].order.status, 'OPEN');
    assert.equal(await db.demoOrder.count({ where: { userId: 'follower' } }), 1);
  });
  await check('actual partial fills cancel unused funds and preserve purchased assets', async () => {
    await place('maker', 'SELL', '2.5'); // leader 2, follower 0.5
    let s = await copy.snapshot('follower'); assert.equal(s.executions[0].order.status, 'PARTIALLY_FILLED'); assert.equal(s.positions[0].quantity, '0.5');
    await copy.stop('follower'); s = await copy.snapshot('follower');
    assert.equal(s.subscription.status, 'STOPPED'); assert.equal(s.executions[0].order.status, 'CANCELLED');
    assert.equal(s.positions[0].quantity, '0.5'); assert.equal(s.exposureUsdt, '50');
  });
  await check('resume and source sell close only copied position; realized PnL from actual fills', async () => {
    await copy.subscribe('follower', 'VX-001', risk);
    await place('leader', 'SELL', '1', '120'); await copy.drain();
    await place('maker', 'BUY', '1.5', '120');
    const s = await copy.snapshot('follower'); assert.equal(s.positions[0].quantity, '0'); assert.equal(s.realizedPnlUsdt, '10');
    assert.equal(s.exposureUsdt, '0');
    // Identical millisecond timestamps cannot reorder executions or fabricate PnL.
    await db.demoTrade.updateMany({ data: { executedAt: new Date('2026-10-30T00:00:00.000Z') } });
    assert.equal((await copy.snapshot('follower')).realizedPnlUsdt, '10');
  });
  await check('source cancellation reaches copied resting order; cancel-before-drain creates nothing', async () => {
    const a = await place('leader', 'BUY', '1', '90'); await copy.drain(); await demo.cancelOrder('leader', a.order.id); await copy.drain();
    const row = await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: a.order.id } }); assert.equal((await db.demoOrder.findUniqueOrThrow({ where: { id: row.demoOrderId } })).status, 'CANCELLED');
    const b = await place('leader', 'BUY', '1', '90'); await demo.cancelOrder('leader', b.order.id); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: b.order.id } })).status, 'SKIPPED');
  });
  await check('mandatory order and exposure limits, no arbitrary minimum deposit', async () => {
    await copy.subscribe('follower', 'VX-001', { ratio: '0.5', maxOrderUsdt: '60', maxExposureUsdt: '60' });
    const over = await place('leader', 'BUY', '2', '90'); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: over.order.id } })).reason, 'MAX_ORDER_EXCEEDED');
    await demo.cancelOrder('leader', over.order.id);
    const a = await place('leader', 'BUY', '1', '90'), b = await place('leader', 'BUY', '1', '90'); await copy.drain();
    const rows = await db.copyDemoExecution.findMany({ where: { sourceOrderId: { in: [a.order.id, b.order.id] } } });
    assert.equal(rows.filter(r => r.status === 'EXECUTED').length, 1); assert.equal(rows.filter(r => r.reason === 'MAX_EXPOSURE_EXCEEDED').length, 1);
    await copy.stop('follower'); await demo.cancelOrder('leader', a.order.id); await demo.cancelOrder('leader', b.order.id);
  });
  await check('insufficient demo funds reject without using ordinary Balance', async () => {
    await copy.subscribe('poor', 'VX-KSENIA', risk); const order = await place('ksenia', 'BUY', '1', '90'); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: order.order.id } })).reason, 'INSUFFICIENT_BALANCE');
    await copy.stop('poor'); await demo.cancelOrder('ksenia', order.order.id);
  });
  await check('stop racing worker never leaves an active copy order or loses metadata', async () => {
    await copy.subscribe('race', 'VX-001', risk); const order = await place('leader', 'BUY', '1', '90');
    await Promise.all([copy.drain(), copy.stop('race')]); await copy.drain();
    assert.equal((await copy.snapshot('race')).subscription.status, 'STOPPED');
    assert.equal(await db.demoOrder.count({ where: { userId: 'race', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } }), 0);
    await demo.cancelOrder('leader', order.order.id);
  });
  await check('blocked follower and changed owner binding checked at execution', async () => {
    await copy.subscribe('other', 'VX-KSENIA', risk); const a = await place('ksenia', 'BUY', '1', '90');
    await db.user.update({ where: { id: 'other' }, data: { blockedAt: new Date() } }); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: a.order.id } })).reason, 'COPY_DEMO_ACCESS_DENIED');
    await db.user.update({ where: { id: 'other' }, data: { blockedAt: null } });
    const b = await place('ksenia', 'BUY', '1', '90'); await db.copyStrategyOwner.update({ where: { traderId: 'VX-KSENIA' }, data: { ownerUserId: 'leader' } }); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: b.order.id } })).reason, 'OWNER_BINDING_CHANGED');
    await db.copyStrategyOwner.update({ where: { traderId: 'VX-KSENIA' }, data: { ownerUserId: 'ksenia' } });
    await copy.stop('other'); await demo.cancelOrder('ksenia', a.order.id); await demo.cancelOrder('ksenia', b.order.id);
  });
  await check('source outbox failure rolls back source funds/order; copy completion failure rolls back all follower writes', async () => {
    const before = JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } }));
    const badSource = new DemoTradingService(db, new MatchingEngine(), { orderLifecycle: async () => { throw new Error('injected outbox failure'); } });
    await assert.rejects(() => badSource.placeOrder({ userId: 'leader', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BN(90), quantity: new BN(1) }), /injected outbox/);
    assert.equal(JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } })), before);
    await copy.subscribe('follower', 'VX-001', risk);
    const source = await place('leader', 'BUY', '1', '90');
    const execution = await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: source.order.id } });
    const balances = JSON.stringify(await db.demoBalance.findMany({ where: { userId: 'follower' }, orderBy: { id: 'asc' } }));
    const count = await db.demoOrder.count({ where: { userId: 'follower' } });
    const failing = new Proxy(demo, { get(target, key) {
      if (key === 'placeOrder') return params => target.placeOrder({ ...params, transactionComplete: async (...args) => { await params.transactionComplete(...args); throw new Error('injected completion failure'); } });
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(() => new CopyDemoService(db, new MatchingEngine(), failing, () => true).drain(), /injected completion/);
    assert.equal((await db.copyDemoExecution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'PENDING');
    assert.equal(await db.demoOrder.count({ where: { userId: 'follower' } }), count);
    assert.equal(JSON.stringify(await db.demoBalance.findMany({ where: { userId: 'follower' }, orderBy: { id: 'asc' } })), balances);
    const independent = new CopyDemoService(db, new MatchingEngine(), new DemoTradingService(db, new MatchingEngine()), () => true);
    await Promise.all([copy.drain(), independent.drain()]);
    assert.equal(await db.demoOrder.count({ where: { userId: 'follower' } }), count + 1);
    await demo.cancelOrder('leader', source.order.id); await copy.drain();
  });
  await check('sell cannot consume unrelated owned demo inventory; unsupported MARKET is explicitly rejected', async () => {
    const sell = await place('leader', 'SELL', '1', '130'); await copy.drain();
    assert.equal((await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: sell.order.id } })).reason, 'NO_COPIED_POSITION');
    await demo.cancelOrder('leader', sell.order.id);
    await place('maker', 'SELL', '1', '100', 'ETH/USDT');
    const market = await demo.placeOrder({ userId: 'leader', pair: 'ETH/USDT', side: 'BUY', type: 'MARKET', quantity: new BN(1) });
    const result = await db.copyDemoExecution.findFirstOrThrow({ where: { sourceOrderId: market.order.id } });
    assert.equal(result.status, 'REJECTED'); assert.equal(result.reason, 'UNSUPPORTED_ORDER'); assert.equal(result.demoOrderId, null);
    await copy.stop('follower');
  });
  await check('a manual order cannot self-match a copied resting order', async () => {
    await copy.subscribe('follower', 'VX-001', risk);
    const source = await place('leader', 'BUY', '1', '90'); await copy.drain();
    const before = JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } }));
    const fills = await db.demoTrade.count();
    await expectCode(() => place('follower', 'SELL', '2', '90'), 'COPY_SELF_MATCH_REFUSED');
    assert.equal(await db.demoTrade.count(), fills);
    assert.equal(JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } })), before);
    await copy.stop('follower'); await demo.cancelOrder('leader', source.order.id);
  });
  const app = express(); app.use(express.json()); app.use('/api/v1', copyDemoRouter(db, copy, () => on));
  const tokens = {};
  for (const id of ['follower', 'other']) { const session = await db.session.create({ data: { userId: id } }); tokens[id] = jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '1h' }); }
  await check('HTTP auth, owner-only snapshot, forged IDs, revoke and default-OFF', async () => {
    assert.equal((await request(app).get('/api/v1/copy-trading/demo')).status, 401);
    const h = request(app).get('/api/v1/copy-trading/demo').set('Authorization', 'Bearer '+tokens.follower); const own = await h; assert.equal(own.status, 200); assert.equal(own.body.subscription.traderId, 'VX-001');
    const other = await request(app).get('/api/v1/copy-trading/demo').set('Authorization', 'Bearer '+tokens.other); assert.equal(other.body.subscription.traderId, 'VX-KSENIA');
    const forged = await request(app).put('/api/v1/copy-trading/demo/subscription').set('Authorization', 'Bearer '+tokens.follower).send({ traderId: 'VX-001', ...risk, userId: 'other' }); assert.equal(forged.status, 400);
    on = false; assert.equal((await request(app).get('/api/v1/copy-trading/demo').set('Authorization', 'Bearer '+tokens.follower)).status, 403); on = true;
    await db.session.updateMany({ where: { userId: 'other' }, data: { revokedAt: new Date() } });
    assert.equal((await request(app).get('/api/v1/copy-trading/demo').set('Authorization', 'Bearer '+tokens.other)).status, 401);
  });
  await check('real balances/orders/fills unchanged and demo assets conserved', async () => {
    assert.equal(await protectedRows(), protectedBefore);
    assert.deepEqual(await totals(), totalsBefore);
    assert.ok(await db.auditLog.count({ where: { action: 'COPY_DEMO_ORDER_CREATED' } }) > 0);
  });
  const out = path.resolve('output/copy-demo644'); fs.mkdirSync(out, { recursive: true });
  if (process.env.COPY_DEMO_BROWSER === '1') {
    const bundle = path.join(out, 'frontend'); assert(fs.existsSync(path.join(bundle, 'index.html')), 'Build review frontend first');
    app.use(express.static(bundle)); app.get('*', (_req, res) => res.sendFile(path.join(bundle, 'index.html')));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const session = await db.session.create({ data: { userId: 'oversize' } });
    const token = jwt.sign({ sub: 'oversize', sid: session.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await require('./qa-copy-demo-browser.cjs').run({ origin: `http://127.0.0.1:${server.address().port}`, token, out,
      sourceOrder: () => place('leader', 'BUY', '1'), cancelSource: order => demo.cancelOrder('leader', order.order.id), drain: () => copy.drain() });
    assert.deepEqual(await totals(), totalsBefore);
  }
  fs.writeFileSync(path.join(out, 'postgres.json'), JSON.stringify({ passed: true, checks, count: checks.length, production: false }, null, 2));
  console.log(`${checks.length} isolated PostgreSQL checks PASS`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (server) server.close(); await db.$disconnect(); });
