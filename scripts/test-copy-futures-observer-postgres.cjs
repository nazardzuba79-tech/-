// Disposable PostgreSQL fixture only. Never use a production or remote DB.
const assert = require('node:assert/strict');
const BN = require('bignumber.js');
const url = process.env.COPY_FUTURES_OBSERVER_TEST_DATABASE_URL;
assert(url, 'Explicit isolated database required');
const host = new URL(url);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)
  && /^\/copy_demo_[a-z0-9_]+$/.test(host.pathname), 'Refuse non-fixture DB');
process.env.JWT_SECRET = 'isolated-futures-observer-fixture-no-production-secrets';
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-futures-observer-email-fixture';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { FuturesDemoObserverService, futuresDemoObserverEnabled } =
  require('../src/services/copyTrading/FuturesDemoObserverService');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { copyFuturesDemoObserverRouter } = require('../src/api/routes/copyFuturesDemoObserver');
const db = new PrismaClient({ datasources: { db: { url } } });
const tests = [];
const check = async (label, fn) => { await fn(); tests.push(label); console.log('PASS', label); };
const userIds = ['leader', 'follower', 'viewer', 'other'];
const sessions = {};
const cap = { maxLeverage: '5', maxFillUsdt: '5000' };
const service = new FuturesDemoObserverService(db, () => true, userId => userId === 'leader');
const notOpted = new FuturesDemoObserverService(db, () => true, () => false);
const off = new FuturesDemoObserverService(db, () => false, () => true);
const deny = async (fn, code) => assert.rejects(fn, e => e.code === code);
let seq = 1, current = null;

function account(revision, events = [], commands = []) {
  return { revision, executionMode: 'LIVE_EXECUTION', deposit: '1000',
    commands, snapshot: { positions: [{
      id: 'leader-pos', symbol: 'BTCUSDT', side: 'LONG', leverage: '2',
      marginType: 'CROSS', historical: false, executionMode: 'LIVE_EXECUTION',
    }], events }, createdAt: 1, source: 'DEMO_BALANCE' };
}
const open = (id, qty, price, actionId = 'native-'+id) => ({
  id, kind: 'OPEN', actionId, orderId: actionId, positionId: 'leader-pos',
  symbol: 'BTCUSDT', quantity: qty, price, pricing: 'OBSERVED_BOOK',
});
const cmd = id => ({ kind: 'OPEN', id: 'native-'+id, at: 10,
  order: { id: 'native-'+id, symbol: 'BTCUSDT', side: 'LONG', leverage: '2',
    marginType: 'CROSS', type: 'MARKET', quantity: '1', historical: false } });
async function append(events, commands) {
  const revision = ++seq;
  const payload = account(revision, events, commands);
  await db.$transaction(async tx => {
    await tx.nativeDemoAccount.update({ where: { userId: 'leader' }, data: { revision, payload } });
    await tx.nativeDemoRevision.create({ data: {
      userId: 'leader', revision, requestKey: 'fixture-'+revision,
      requestHash: 'test-only', payload,
    } });
  });
  current = payload; return revision;
}
async function main() {
  assert.equal(await db.user.count(), 0, 'Refuse any existing User table');
  await check('environment: explicit flags plus disposable local PostgreSQL and NODE_ENV test required', async () => {
    const env = { NODE_ENV: 'test', DATABASE_URL: url,
      COPY_DEMO_ENABLED: 'true', COPY_DEMO_ISOLATED_REVIEW: 'true',
      DEMO_SPOT_ENABLED: 'true', COPY_FUTURES_DEMO_OBSERVER_ENABLED: 'true' };
    assert.equal(futuresDemoObserverEnabled(env), true);
    assert.equal(futuresDemoObserverEnabled({ ...env, COPY_FUTURES_DEMO_OBSERVER_ENABLED: 'false' }), false);
    assert.equal(futuresDemoObserverEnabled({ ...env, NODE_ENV: 'production' }), false);
    assert.equal(futuresDemoObserverEnabled({ ...env, DATABASE_URL: 'postgresql://db.production.invalid/copy_demo_test' }), false);
  });
  for (const id of userIds) {
    await db.user.create({ data: {
      id, email: id+'@example.invalid', passwordHash: 'fixture', role: 'USER', referralCode: id.toUpperCase(),
    } });
    const session = await db.session.create({ data: { userId: id } });
    sessions[id] = session.id;
    await db.demoBalance.create({ data: { userId: id, asset: 'USDT', available: '1000', locked: '0' } });
    await db.balance.create({ data: { userId: id, asset: 'USDT', available: '250', locked: '20' } });
  }
  await db.copyStrategyOwner.upsert({ where: { traderId: 'VX-001' }, create: { traderId: 'VX-001', publicName: 'Fixture Nazar', ownerUserId: 'leader' }, update: { publicName: 'Fixture Nazar', ownerUserId: 'leader' } });
  // A pre-existing fill in the immutable source journal MUST NOT be copied
  // by a subscriber who starts observing at revision 1.
  current = account(1, [open('old', '0.4', '1000')], [cmd('old')]);
  await db.nativeDemoAccount.create({ data: { userId: 'leader', revision: 1, payload: current } });
  await db.nativeDemoRevision.create({ data: { userId: 'leader', revision: 1,
    requestKey: 'fixture-1', requestHash: 'test-only', payload: current } });
  await db.nativeDemoAccount.create({ data: { userId: 'follower', revision: 1, payload: account(1) } });
  await db.nativeDemoAccount.create({ data: { userId: 'viewer', revision: 1, payload: account(1) } });
  const moneyBefore = JSON.stringify(await db.balance.findMany({ orderBy: { id: 'asc' } }));
  const demoBefore = JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } }));
  await check('OFF gate, no follower wallet, no leader self-follow, invalid caps and owner consent', async () => {
    await deny(() => off.subscribe('follower', sessions.follower, 'VX-001', cap), 'FUTURES_DEMO_OBSERVER_OFF');
    await deny(() => service.subscribe('other', sessions.other, 'VX-001', cap), 'FOLLOWER_DEMO_NOT_INITIALIZED');
    await deny(() => service.subscribe('leader', sessions.leader, 'VX-001', cap), 'LEADER_CANNOT_FOLLOW');
    await deny(() => service.subscribe('follower', sessions.follower, 'VX-001', { ...cap, maxLeverage: '0' }), 'INVALID_OBSERVER_CAPS');
    await deny(() => notOpted.subscribe('follower', sessions.follower, 'VX-001', cap), 'LEADER_NOT_OPTED_IN');
  });
  await check('subscribe at committed revision, never backfill history', async () => {
    const result = await service.subscribe('follower', sessions.follower, 'VX-001', cap);
    assert.equal(result.lastRevision, 1); assert.equal(result.automaticCopying, false);
    assert.equal((await service.snapshot('follower', sessions.follower)).events.length, 0);
    assert.deepEqual((await service.scan('follower', sessions.follower)).accepted, 0);
  });
  await check('source immutable revision captures one real OPEN receipt and not an order intent', async () => {
    await append([...current.snapshot.events, open('e1', '0.5', '1000')], [...current.commands, cmd('e1')]);
    const s = await service.scan('follower', sessions.follower);
    assert.equal(s.scannedRevisions, 1); assert.equal(s.accepted, 1); assert.equal(s.lastRevision, 2);
    const view = await service.snapshot('follower', sessions.follower);
    assert.equal(view.events.length, 1); assert.equal(view.events[0].status, 'OBSERVED_ONLY');
    assert.equal(view.events.some(e => e.sourceEventId === 'old'), false, 'Pre-subscription history must never be imported');
    assert.equal(view.automaticCopying, false);
    assert.equal((await service.scan('follower', sessions.follower)).accepted, 0);
  });
  await check('duplicate receipts across revisions and overlapping polls never double insert', async () => {
    await append([...current.snapshot.events, open('e2', '0.25', '1000')], [...current.commands, cmd('e2')]);
    const results = await Promise.all([service.scan('follower', sessions.follower), service.scan('follower', sessions.follower)]);
    assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 1);
    assert.equal(await db.copyFuturesDemoEvent.count(), 2);
  });
  await check('per-fill risk rejection never inserts a financial intent', async () => {
    await append([...current.snapshot.events, open('over', '10', '1000')], [...current.commands, cmd('over')]);
    const result = await service.scan('follower', sessions.follower);
    assert.equal(result.accepted, 0); assert.ok(result.rejected >= 1);
    assert.equal(await db.copyFuturesDemoEvent.count(), 2);
  });
  await check('foreign session and revoked session cannot scan or view another subscription', async () => {
    await deny(() => service.snapshot('follower', sessions.viewer), 'OBSERVER_ACCESS_DENIED');
    await deny(() => service.scan('follower', sessions.viewer), 'OBSERVER_ACCESS_DENIED');
    await db.session.update({ where: { id: sessions.follower }, data: { revokedAt: new Date() } });
    await deny(() => service.scan('follower', sessions.follower), 'OBSERVER_ACCESS_DENIED');
    const next = await db.session.create({ data: { userId: 'follower' } });
    sessions.follower = next.id;
  });
  await check('stop blocks scans and resume starts from latest source revision', async () => {
    await service.stop('follower', sessions.follower);
    await deny(() => service.scan('follower', sessions.follower), 'OBSERVER_STOPPED');
    await append([...current.snapshot.events, open('missed', '0.1', '1000')], [...current.commands, cmd('missed')]);
    const resumed = await service.subscribe('follower', sessions.follower, 'VX-001', cap);
    assert.equal(resumed.lastRevision, seq);
    assert.equal((await service.scan('follower', sessions.follower)).accepted, 0);
    assert.equal(await db.copyFuturesDemoEvent.count(), 2);
  });
  await check('source owner rebind refuses future observations without advancing cursor', async () => {
    await db.copyStrategyOwner.update({ where: { traderId: 'VX-001' }, data: { ownerUserId: 'viewer' } });
    await deny(() => service.scan('follower', sessions.follower), 'OBSERVER_OWNER_CHANGED');
    await db.copyStrategyOwner.update({ where: { traderId: 'VX-001' }, data: { ownerUserId: 'leader' } });
    assert.equal((await service.scan('follower', sessions.follower)).lastRevision, seq);
  });
  await check('missing immutable revision fails closed with no cursor change', async () => {
    await db.nativeDemoAccount.update({ where: { userId: 'leader' }, data: { revision: seq + 1 } });
    await deny(() => service.scan('follower', sessions.follower), 'SOURCE_REVISION_GAP');
    await db.nativeDemoAccount.update({ where: { userId: 'leader' }, data: { revision: seq } });
    assert.equal((await service.snapshot('follower', sessions.follower)).subscription.lastRevision, seq);
  });
  await check('HTTP route is OFF before auth, strict request schema and only own observer state', async () => {
    const offApp = express(); offApp.use(express.json());
    offApp.use('/api/v1', copyFuturesDemoObserverRouter(db, service, () => false));
    assert.equal((await request(offApp).get('/api/v1/copy-trading/futures-demo-observer')).status, 403);
    const app = express(); app.use(express.json());
    app.use('/api/v1', copyFuturesDemoObserverRouter(db, service, () => true));
    const endpoint = '/api/v1/copy-trading/futures-demo-observer';
    const tokenFor = user => jwt.sign({ sub: user, sid: sessions[user] }, process.env.JWT_SECRET, { expiresIn: '10m' });
    assert.equal((await request(app).get(endpoint)).status, 401);
    assert.equal((await request(app).post(endpoint + '/scan').set('Authorization', 'Bearer ' + tokenFor('viewer'))).status, 404);
    const forged = await request(app).put(endpoint + '/subscription')
      .set('Authorization', 'Bearer ' + tokenFor('follower'))
      .send({ traderId: 'VX-001', ...cap, userId: 'viewer' });
    assert.equal(forged.status, 400);
    const own = await request(app).get(endpoint).set('Authorization', 'Bearer ' + tokenFor('follower'));
    assert.equal(own.status, 200); assert.equal(own.body.automaticCopying, false);
    assert.equal(own.body.subscription.traderId, 'VX-001');
    const scan = await request(app).post(endpoint + '/scan')
      .set('Authorization', 'Bearer ' + tokenFor('follower'));
    assert.equal(scan.status, 200); assert.equal(scan.body.accepted, 0);
    const stopped = await request(app).delete(endpoint + '/subscription')
      .set('Authorization', 'Bearer ' + tokenFor('follower'));
    assert.equal(stopped.status, 200); assert.equal(stopped.body.status, 'STOPPED');
    assert.equal((await request(app).post(endpoint + '/scan')
      .set('Authorization', 'Bearer ' + tokenFor('follower'))).status, 409);
  });
  await check('real balances, demo balances, and order/trade books untouched', async () => {
    assert.equal(JSON.stringify(await db.balance.findMany({ orderBy: { id: 'asc' } })), moneyBefore);
    assert.equal(JSON.stringify(await db.demoBalance.findMany({ orderBy: { id: 'asc' } })), demoBefore);
    assert.equal(await db.order.count(), 0); assert.equal(await db.trade.count(), 0);
    assert.equal(await db.demoOrder.count(), 0); assert.equal(await db.demoTrade.count(), 0);
    assert.equal(await db.futuresOrder.count(), 0);
    assert.equal(await db.futuresPosition.count(), 0);
  });
  console.log(tests.length + ' isolated Futures observer PostgreSQL checks PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
