'use strict';
// Issue #592 — Demo Spot for admin-credited accounts, on a DISPOSABLE PostgreSQL only.
// Reproduces the current ledger facts, then the acceptance contract with the real
// routers and services. Synthetic identities only; nothing here can reach production.
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('node:assert/strict'), { spawnSync } = require('child_process'), { createRequire } = require('module');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.DEMO_QA_DEPS || 'output/demo-qa-deps/package.json'));
const out = path.resolve(root, process.env.DEMO_QA_OUT || 'output/demo-trading');
fs.mkdirSync(out, { recursive: true });
// Ignore any DATABASE_URL: this runner creates its own loopback cluster.
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-trading-fixture-secret-at-least-32-chars';
// ordersRouter loads the API-key module; a fixture value, never a real key.
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || require('crypto').randomBytes(32).toString('hex');
const TRADER = '00000000-0000-4000-8000-0000000005c2'; // a configured native test account (Cross trading wallet)
const TRADER2 = '00000000-0000-4000-8000-0000000005c3'; // configured too, but its Cross wallet is not opened
process.env.PRIVATE_TRADING_TEST_USER_IDS = `${TRADER},${TRADER2}`;
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const express = require('express'), jwt = require('jsonwebtoken');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
const { transferWalletBalance } = require('../src/services/WalletTransferService');
const { WithdrawalService, DemoFundsNotWithdrawableError } = require('../src/services/WithdrawalService');
const { ordersRouter } = require('../src/api/routes/orders');
const { balancesRouter } = require('../src/api/routes/balances');
const { demoTradingRouter } = require('../src/api/routes/demoTrading');
const { withdrawalsRouter } = require('../src/api/routes/withdrawals');

function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

async function main() {
  const configuredBin = process.env.DEMO_QA_PG_BIN;
  assert(configuredBin && path.isAbsolute(configuredBin), 'DEMO_QA_PG_BIN must be the absolute PostgreSQL tool directory (never a DB URL)');
  const bin = Object.fromEntries(['initdb', 'pg_ctl'].map(name => [name, path.join(fs.realpathSync(configuredBin), name)]));
  for (const name of ['initdb', 'pg_ctl']) assert(fs.statSync(bin[name]).isFile(), `Missing PostgreSQL tool: ${name}`);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-demo-trading-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${path.dirname(dir)}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);

  let sql, prisma, server;
  const checks = [], reproduction = {};
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  // Outbound network is denied: only this loopback fixture may be reached.
  const loopback = `http://127.0.0.1:`; const realFetch = globalThis.fetch; const outbound = [];
  globalThis.fetch = (url, init) => { if (!String(url).startsWith(loopback)) { outbound.push(String(url)); return Promise.reject(new Error('outbound network denied in QA')); } return realFetch(url, init); };
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await sql.connect();
    await sql.query('CREATE DATABASE voltex_demo_trading_fixture'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_demo_trading_fixture' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    // legacy/legacyMaker: testers an admin credited on the ordinary ledger (Balance) before Demo Spot.
    const people = { admin: 'ADMIN', unfunded: 'USER', funded: 'USER', tester: 'USER', maker: 'USER', blocked: 'USER', legacy: 'USER', legacyMaker: 'USER',
      legacySeller: 'USER', demoSeller: 'USER', both: 'USER', demoFunded: 'USER', demoBidder: 'USER', spotFunded: 'USER', spotBidder: 'USER',
      [TRADER]: 'USER', [TRADER2]: 'USER' };
    for (const [id, role] of Object.entries(people)) {
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ($1,$2,'fixture',$1,$3,'APPROVED',now(),now())`, [id, `${id.replace(/[^a-z0-9]/gi, "")}@example.invalid`, role]);
    }
    const url = `postgresql://postgres@127.0.0.1:${port}/voltex_demo_trading_fixture?connection_limit=16&sslmode=disable`;
    prisma = new PrismaClient({ datasources: { db: { url } } });

    let enabled = false;
    const spotPairs = new Set(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    const priceSource = { getTicker: async () => ({ lastPrice: '100000' }) };
    let orders = ordersRouter(prisma, new MatchingEngine(), priceSource); // swapped on "restart"
    let demo = new DemoTradingService(prisma, new MatchingEngine());
    const demoProxy = new Proxy({}, { get: (_target, key) => (...args) => demo[key](...args) }); // swapped on "restart"
    const app = express(); app.use(express.json());
    app.use('/api/v1', (req, res, next) => orders(req, res, next));
    app.use('/api/v1', balancesRouter(prisma));
    app.use('/api/v1', demoTradingRouter(prisma, demoProxy, undefined, { enabled: () => enabled, isSpotPair: async pair => spotPairs.has(pair) }));
    // The native Cross wallet is valued from DemoBalance (PrismaNativeRepository); this reader stands in for that valuation.
    // Issue #617: demo-valued requests are refused permanently; the old guard switch no longer decides anything.
    let guardSwitch = false;
    app.use('/api/v1', withdrawalsRouter(prisma, { tradingWallet: async actor => actor.userId === TRADER
      ? (await prisma.demoBalance.findMany({ where: { userId: actor.userId } })).map(b => ({ asset: b.asset, available: b.available.toString() })) : null }));
    const adminWithdrawals = new WithdrawalService(prisma); // what the admin routes call
    if (process.env.DEMO_QA_BROWSER === '1') {
      const dist = path.resolve(root, process.env.DEMO_QA_DIST || 'frontend/dist');
      app.use(express.static(dist, { index: false }));
      app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
    app.use((error, req, res, next) => res.status(500).json({ error: 'fixture server error' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sessions = new Map();
    const token = async (who, { sid = true, secret = process.env.JWT_SECRET } = {}) => {
      if (!sid) return jwt.sign({ sub: who }, secret);
      if (!sessions.has(who)) { const id = randomUUID(); await prisma.session.create({ data: { id, userId: who, lastSeenAt: new Date() } }); sessions.set(who, id); }
      return jwt.sign({ sub: who, sid: sessions.get(who) }, secret);
    };
    const api = async (method, route, who, body, opts) => {
      const headers = { 'Content-Type': 'application/json' };
      if (who) headers.Authorization = 'Bearer ' + await token(who, opts);
      const response = await fetch(origin + '/api/v1' + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const demoBal = async (who, asset) => { const b = await prisma.demoBalance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return { available: b ? b.available.toFixed() : '0', locked: b ? b.locked.toFixed() : '0' }; };
    const realState = async () => ({ orders: await prisma.order.count(), trades: await prisma.trade.count(), balances: JSON.stringify(await prisma.balance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] })) });
    const adjust = new BalanceAdjustmentService(prisma);
    const limit = (side, price, quantity, pair = 'BTC/USDT') => ({ pair, side, type: 'LIMIT', price: String(price), quantity: String(quantity) });

    // ── Owner/admin credits, as today: two different admin operations ──────────────
    for (const [who, asset, amount] of [['funded', 'USDT', '100'], ['both', 'USDT', '100'], [TRADER2, 'USDT', '100'], [TRADER2, 'BTC', '0.001'], ['legacy', 'USDT', '1000'], ['legacyMaker', 'BTC', '0.01']]) {
      await adjust.adjustOnce({ userId: who, asset, amount, reason: 'synthetic Balance credit', performedByAdminId: 'admin', idempotencyKey: randomUUID() });
    }
    for (const [who, asset, amount] of [['tester', 'USDT', '50'], ['maker', 'BTC', '0.01'], ['blocked', 'USDT', '50'], ['both', 'USDT', '50'], [TRADER, 'USDT', '100']]) {
      await demo.topUp({ userId: who, asset, amount, performedByAdminId: 'admin', note: 'synthetic demo credit' });
    }
    await prisma.user.update({ where: { id: 'blocked' }, data: { blockedAt: new Date() } });

    // ── Reproduction: current behaviour with DEMO_SPOT_ENABLED unset ──────────────
    await check('reproduce: a registered USER without any credit cannot place an ordinary Spot order', async () => {
      const r = await api('POST', '/orders', 'unfunded', limit('BUY', 100000, 0.0001));
      reproduction.unfundedOrders = r; assert.equal(r.status, 400);
      assert.equal(await prisma.balance.count({ where: { userId: 'unfunded' } }) + await prisma.demoBalance.count({ where: { userId: 'unfunded' } }), 0);
    });
    await check('reproduce: an admin Balance credit trades on the REAL Spot ledger (OrderService)', async () => {
      const r = await api('POST', '/orders', 'funded', limit('BUY', 100000, 0.0001));
      reproduction.balanceCreditOrders = { status: r.status, orderStatus: r.body?.order?.status }; assert.equal(r.status, 201);
      assert.equal((await api('DELETE', '/orders/' + r.body.order.id, 'funded')).status, 204);
    });
    await check('reproduce: a demo-topup credit (DemoBalance) cannot use /orders, and /demo/orders is admin-only', async () => {
      const real = await api('POST', '/orders', 'tester', limit('BUY', 100000, 0.0001));
      const sandbox = await api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.0001));
      reproduction.demoCreditOrders = real; reproduction.demoCreditDemoOrders = sandbox;
      assert.equal(real.status, 400); assert.equal(sandbox.status, 403); assert.equal(sandbox.body.error, 'Admin access required');
    });
    await check('reproduce (BLOCKER evidence): an admin Balance credit can be put into a withdrawal request', async () => {
      const r = await api('POST', '/withdrawals', 'funded', { asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount: '10' });
      reproduction.balanceCreditWithdrawal = { status: r.status, withdrawalStatus: r.body?.status, balanceHeld: r.body?.balanceHeld };
      assert.equal(r.status, 200); assert.equal(r.body.status, 'PENDING');
    });

    // ── Acceptance with DEMO_SPOT_ENABLED=true ───────────────────────────────────
    let realBefore = await realState();
    enabled = true;
    await check('access and terminal ledger: demo credit → demo; ordinary Balance funds keep the ordinary terminal (as before); nothing → silent', async () => {
      const access = async who => (await api('GET', '/demo/spot/access', who)).body;
      assert.deepEqual(await access('tester'), { enabled: true, admitted: true, ledger: 'demo' });
      assert.deepEqual(await access('unfunded'), { enabled: true, admitted: false, ledger: 'none' });
      assert.deepEqual(await access('blocked'), { enabled: true, admitted: false, ledger: 'none' });
      // Funded earlier through an ordinary Balance adjustment: not silently disabled, no migration.
      assert.deepEqual(await access('funded'), { enabled: true, admitted: false, ledger: 'spot' });
      assert.deepEqual(await access('both'), { enabled: true, admitted: true, ledger: 'spot' });
      // The other testers an admin funded on Balance keep it too; the owner/admin account follows the same rule.
      for (const who of ['legacy', 'legacyMaker', TRADER2]) assert.deepEqual(await access(who), { enabled: true, admitted: false, ledger: 'spot' }, who);
      assert.deepEqual(await access('admin'), { enabled: true, admitted: true, ledger: 'demo' });
      assert.equal((await api('GET', '/demo/spot/access')).status, 401);
      // With the Balance funds the ordinary order path works exactly as before.
      const real = await api('POST', '/orders', 'funded', limit('BUY', 100000, 0.0001));
      assert.equal(real.status, 201);
      assert.equal((await api('DELETE', '/orders/' + real.body.order.id, 'funded')).status, 204);
      realBefore = await realState(); // from here on only demo trading runs
    });
    await check('zero allocation: every order route is refused before the ledger; nothing is created or granted', async () => {
      for (const body of [limit('BUY', 100000, 0.0001), { pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.0001' }]) {
        const r = await api('POST', '/demo/orders', 'unfunded', body); assert.equal(r.status, 403); assert.equal(r.body.code, 'DEMO_ACCESS_DENIED');
      }
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'unfunded' } }), 0);
      assert.equal(await prisma.demoBalance.count({ where: { userId: 'unfunded' } }), 0);
    });
    await check('50 demo USDT: a 50 USDT LIMIT order is reserved exactly; 51 is refused with nothing changed', async () => {
      const ok = await api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.0005));
      assert.equal(ok.status, 201); assert.equal(ok.body.order.status, 'OPEN');
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '0', locked: '50' });
      assert.equal((await api('DELETE', '/demo/orders/' + ok.body.order.id, 'tester')).status, 204);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
      const before = await prisma.demoOrder.count({ where: { userId: 'tester' } });
      const over = await api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.00051));
      assert.equal(over.status, 400); assert.deepEqual(over.body, { error: 'Insufficient USDT balance', code: 'INSUFFICIENT_BALANCE' });
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester' } }), before);
    });
    await check('concurrency: two simultaneous 30 USDT orders on 50 — exactly one is accepted, never overdrawn', async () => {
      const results = await Promise.all([1, 2].map(() => api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.0003))));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '20', locked: '30' });
      const placed = results.find(r => r.status === 201).body.order.id;
      // Duplicate cancellation releases one lock.
      const cancels = await Promise.all([1, 2].map(() => api('DELETE', '/demo/orders/' + placed, 'tester')));
      assert.deepEqual(cancels.map(r => r.status).sort(), [204, 404]);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
    });
    await check('request ID: a retry after a lost response returns the same order; duplicates and other terms cannot place twice', async () => {
      const requestId = randomUUID(), body = { ...limit('BUY', 80000, 0.0001), requestId };
      const first = await api('POST', '/demo/orders', 'tester', body);
      assert.equal(first.status, 201);
      // The response is "lost": the client retries the same request ID, several times at once.
      const retries = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/demo/orders', 'tester', body)));
      assert.deepEqual(retries.map(r => r.status), [200, 200, 200, 200, 200]);
      assert(retries.every(r => r.body.order.id === first.body.order.id));
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester', price: '80000' } }), 1);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '42', locked: '8' }); // reserved once
      const conflict = await api('POST', '/demo/orders', 'tester', { ...body, quantity: '0.0002' });
      assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'REQUEST_CONFLICT');
      // Concurrent first attempts with one ID: exactly one order.
      const fresh = { ...limit('BUY', 70000, 0.0001), requestId: randomUUID() };
      const racing = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/demo/orders', 'tester', fresh)));
      assert.deepEqual(racing.map(r => r.status).sort(), [200, 200, 200, 201]);
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester', price: '70000' } }), 1);
      for (const id of [first.body.order.id, racing[0].body.order.id]) assert.equal((await api('DELETE', '/demo/orders/' + id, 'tester')).status, 204);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
    });
    await check('replay without a request ID: an identical POST is a second order (as on real Spot); after the session is revoked it is refused', async () => {
      const body = limit('BUY', 90000, 0.0001);
      const [first, second] = [await api('POST', '/demo/orders', 'tester', body), await api('POST', '/demo/orders', 'tester', body)];
      assert.equal(first.status, 201); assert.equal(second.status, 201); assert.notEqual(first.body.order.id, second.body.order.id);
      for (const id of [first.body.order.id, second.body.order.id]) assert.equal((await api('DELETE', '/demo/orders/' + id, 'tester')).status, 204);
      const stale = await token('tester');
      await prisma.session.update({ where: { id: sessions.get('tester') }, data: { revokedAt: new Date() } });
      const replay = await fetch(origin + '/api/v1/demo/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stale }, body: JSON.stringify(body) });
      assert.equal(replay.status, 401);
      sessions.delete('tester'); // a new sign-in
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
    });
    await check('forged, blocked and other-owner requests are refused (401/403/404) with no ledger change', async () => {
      const before = JSON.stringify(await prisma.demoBalance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }));
      assert.equal((await api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.0001), { secret: 'not-the-server-secret-at-least-32-chars' })).status, 401);
      assert.equal((await api('POST', '/demo/orders', null, limit('BUY', 100000, 0.0001))).status, 401);
      assert.equal((await api('POST', '/demo/orders', 'blocked', limit('BUY', 100000, 0.0001))).status, 403);
      assert.equal((await api('POST', '/demo/orders', 'ghost-account', limit('BUY', 100000, 0.0001), { sid: false })).status, 401);
      const maker = await api('POST', '/demo/orders', 'maker', limit('SELL', 100000, 0.001));
      assert.equal(maker.status, 201);
      assert.equal((await api('DELETE', '/demo/orders/' + maker.body.order.id, 'tester')).status, 404);
      const pair = await api('POST', '/demo/orders', 'tester', limit('BUY', 1, 1, 'FAKE/USDT'));
      assert.equal(pair.status, 400); assert.equal(pair.body.code, 'PAIR_NOT_SUPPORTED');
      const after = JSON.parse(JSON.stringify(await prisma.demoBalance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] })));
      // Only the maker's own SELL reserve differs.
      const changed = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(JSON.parse(before)[i]));
      assert.deepEqual(changed.map(r => [r.userId, r.asset, r.available, r.locked]), [['maker', 'BTC', '0.009', '0.001']]);
    });
    await check('MARKET fills only resting depth; with none it is refused (NO_LIQUIDITY) and nothing stays locked', async () => {
      const none = await api('POST', '/demo/orders', 'tester', { pair: 'SOL/USDT', side: 'BUY', type: 'MARKET', quantity: '1' });
      assert.equal(none.status, 400); assert.equal(none.body.code, 'NO_LIQUIDITY');
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '50', locked: '0' });
      const fill = await api('POST', '/demo/orders', 'tester', { pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.0004' });
      assert.equal(fill.status, 201); assert.equal(fill.body.order.status, 'FILLED'); assert.deepEqual(fill.body.trades.map(t => [t.price, t.quantity]), [['100000', '0.0004']]);
      assert.deepEqual(await demoBal('tester', 'USDT'), { available: '10', locked: '0' }); // 40 paid, the 2% buffer refunded
      assert.deepEqual(await demoBal('tester', 'BTC'), { available: '0.0004', locked: '0' });
      const maker = await prisma.demoOrder.findFirst({ where: { userId: 'maker', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
      assert.equal(maker.status, 'PARTIALLY_FILLED'); assert.equal(maker.remainingQuantity.toFixed(), '0.0006');
      assert.deepEqual(await demoBal('maker', 'USDT'), { available: '40', locked: '0' });
    });
    await check('restart: a new process (new engine, service and DB client) trades the persisted book correctly', async () => {
      const restarted = new PrismaClient({ datasources: { db: { url } } });
      demo = new DemoTradingService(restarted, new MatchingEngine());
      try {
        const book = await api('GET', '/demo/orderbook/BTC%2FUSDT', 'tester');
        assert.deepEqual(book.body.asks, [{ price: '100000', quantity: '0.0006', orders: 1 }]);
        // 10 USDT left: 0.0001 would reserve 10.2 with the 2% buffer, so 0.00009 (9.18 reserved, 9 paid).
        const tooMuch = await api('POST', '/demo/orders', 'tester', { pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.0001' });
        assert.equal(tooMuch.status, 400); assert.equal(tooMuch.body.code, 'INSUFFICIENT_BALANCE');
        const fill = await api('POST', '/demo/orders', 'tester', { pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.00009' });
        assert.equal(fill.status, 201); assert.equal(fill.body.order.status, 'FILLED');
        assert.deepEqual(await demoBal('tester', 'USDT'), { available: '1', locked: '0' });
        const makerOrder = await prisma.demoOrder.findFirst({ where: { userId: 'maker', status: 'PARTIALLY_FILLED' } });
        assert.equal(makerOrder.remainingQuantity.toFixed(), '0.00051');
        assert.equal((await api('DELETE', '/demo/orders/' + makerOrder.id, 'maker')).status, 204);
        assert.deepEqual(await demoBal('maker', 'BTC'), { available: '0.00951', locked: '0' });
        assert.equal((await api('DELETE', '/demo/orders/' + makerOrder.id, 'maker')).status, 404); // a cancelled maker cannot be refunded twice
      } finally { demo = new DemoTradingService(prisma, new MatchingEngine()); await restarted.$disconnect(); }
    });
    await check('conservation: demo trades move value between testers only — nothing is minted or lost', async () => {
      const total = async asset => (await prisma.demoBalance.findMany({ where: { asset, userId: { in: ['tester', 'maker'] } } }))
        .reduce((sum, b) => sum.plus(b.available.toString()).plus(b.locked.toString()), new BigNumber(0)).toFixed();
      assert.equal(await total('USDT'), '50'); assert.equal(await total('BTC'), '0.01');
      const history = await api('GET', '/demo/orders/history', 'tester');
      assert.deepEqual(history.body.filter(o => o.status === 'FILLED').map(o => [o.type, o.originalQuantity]), [['MARKET', '0.00009'], ['MARKET', '0.0004']]);
    });
    await check('a stale legacy demo maker stops trading on its pair instead of refunding twice (fail closed)', async () => {
      const at = new Date('2026-10-01T00:00:00Z');
      await prisma.demoOrder.create({ data: { id: 'legacy-maker', userId: 'admin', pair: 'ETH/USDT', side: 'SELL', type: 'LIMIT', price: '3000', originalQuantity: '1', remainingQuantity: '1', status: 'OPEN', createdAt: at } });
      await prisma.demoTrade.create({ data: { id: randomUUID(), pair: 'ETH/USDT', takerOrderId: 'legacy-taker', makerOrderId: 'legacy-maker', takerUserId: 'admin', makerUserId: 'admin', price: '3000', quantity: '0.5', side: 'BUY' } });
      const before = await demoBal('tester', 'USDT');
      const r = await api('POST', '/demo/orders', 'tester', limit('BUY', 3000, 0.001, 'ETH/USDT'));
      assert.equal(r.status, 500); assert.deepEqual(await demoBal('tester', 'USDT'), before);
    });
    await check('no cash-out: demo funds never reach Balance, a withdrawal or a transfer', async () => {
      assert.equal(await prisma.balance.count({ where: { userId: 'tester' } }), 0);
      const options = await api('GET', '/withdrawals/options', 'tester');
      assert.deepEqual(options.body, { source: 'SPOT', assets: [], futures: [] });
      const request = await api('POST', '/withdrawals', 'tester', { asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount: '1' });
      assert.equal(request.status, 400);
      await assert.rejects(transferWalletBalance(prisma, 'tester', 'USDT', new BigNumber(1), 'TO_FUTURES'));
      // A native Cross trading account is valued from DemoBalance: nothing is withdrawable, nothing is recorded.
      assert.deepEqual((await api('GET', '/withdrawals/options', TRADER)).body, { source: 'TRADING', assets: [], futures: [] });
      const native = await api('POST', '/withdrawals', TRADER, { asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount: '1' });
      assert.equal(native.status, 403); assert.equal(native.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
      assert.equal(await prisma.withdrawal.count({ where: { userId: { in: ['tester', 'maker', TRADER] } } }), 0);
    });
    await check('the real Spot ledger is untouched by demo trading (orders, trades, every Balance row)', async () => {
      assert.deepEqual(await realState(), realBefore);
    });
    let pendingUnheldId;
    await check('withdrawal fence (Issue #617): with every switch off, by the guard switch, or with Demo Spot on, the demo-valued Cross account files nothing; pre-existing PENDING/APPROVED unheld requests are neither approved nor sent, only rejectable; Balance-held requests unchanged', async () => {
      const send = (who, amount = '1') => api('POST', '/withdrawals', who, { asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount });
      const state = async () => JSON.stringify({ rows: await prisma.withdrawal.findMany({ where: { userId: TRADER }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, balanceHeld: true, amount: true } }),
        audit: await prisma.auditLog.count({ where: { userId: TRADER, action: { startsWith: 'WITHDRAWAL_' } } }), demo: await prisma.demoBalance.findMany({ where: { userId: TRADER }, orderBy: { asset: 'asc' } }),
        balance: await prisma.balance.count({ where: { userId: TRADER } }) });
      const demoBefore = JSON.stringify(await prisma.demoBalance.findMany({ where: { userId: TRADER }, orderBy: { asset: 'asc' } }));
      // Unheld requests filed before the fence, as production may hold them (the old flow, guard off).
      const historic = async status => (await prisma.withdrawal.create({ data: { userId: TRADER, asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount: '1', status, balanceHeld: false } })).id;
      const first = await historic('PENDING'), second = await historic('APPROVED');
      pendingUnheldId = await historic('PENDING'); // stays PENDING: the pre-activation query must list it
      for (const [label, mode] of [['every switch off', { guard: false, spot: false }], ['guard switch', { guard: true, spot: false }], ['Demo Spot on', { guard: false, spot: true }]]) {
        guardSwitch = mode.guard; enabled = mode.spot;
        if (guardSwitch) process.env.DEMO_WITHDRAWAL_GUARD_ENABLED = 'true'; else delete process.env.DEMO_WITHDRAWAL_GUARD_ENABLED;
        const before = await state();
        const refused = await send(TRADER);
        assert.equal(refused.status, 403, label); assert.equal(refused.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        assert.deepEqual((await api('GET', '/withdrawals/options', TRADER)).body, { source: 'TRADING', assets: [], futures: [] });
        await assert.rejects(adminWithdrawals.approveWithdrawal({ withdrawalId: first, performedByAdminId: 'admin' }), DemoFundsNotWithdrawableError);
        await assert.rejects(adminWithdrawals.markSent({ withdrawalId: second, performedByAdminId: 'admin', txHash: '0xfixture' }), DemoFundsNotWithdrawableError);
        assert.equal(await state(), before, `${label}: nothing written, existing requests untouched`);
        for (const who of ['funded', TRADER2]) { const r = await send(who); assert.equal(r.status, 200, `${who} ${label}`); assert.equal(r.body.balanceHeld, true); }
      }
      // Rejecting an existing unheld request stays possible under any switch; nothing is given back (nothing was held).
      guardSwitch = false; enabled = false; delete process.env.DEMO_WITHDRAWAL_GUARD_ENABLED;
      assert.equal((await adminWithdrawals.rejectWithdrawal({ withdrawalId: first, performedByAdminId: 'admin', reason: 'demo funds' })).status, 'REJECTED');
      assert.equal((await adminWithdrawals.rejectWithdrawal({ withdrawalId: second, performedByAdminId: 'admin', reason: 'demo funds' })).status, 'REJECTED');
      assert.equal(await prisma.withdrawal.count({ where: { userId: TRADER, balanceHeld: false, status: { in: ['APPROVED', 'SENT'] } } }), 0);
      assert.equal(JSON.stringify(await prisma.demoBalance.findMany({ where: { userId: TRADER }, orderBy: { asset: 'asc' } })), demoBefore, 'no request moves a demo balance');
      assert.equal(await prisma.balance.count({ where: { userId: TRADER } }), 0, 'demo funds never reach Balance');
      enabled = true;
    });
    await check('rollback: unsetting DEMO_SPOT_ENABLED refuses testers at once; the admin sandbox and the ledger stay', async () => {
      enabled = false;
      const r = await api('POST', '/demo/orders', 'tester', limit('BUY', 100000, 0.0001));
      assert.equal(r.status, 403); assert.equal(r.body.error, 'Admin access required');
      assert.deepEqual((await api('GET', '/demo/spot/access', 'tester')).body, { enabled: false, admitted: false, ledger: 'spot' });
      assert.deepEqual(await demoBal('tester', 'BTC'), { available: '0.00049', locked: '0' });
      enabled = true;
    });
    // ── Accounts an admin credited on the ordinary ledger before Demo Spot (owner priority 6360408787) ──
    const bal = async (who, asset) => { const b = await prisma.balance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return { available: b ? b.available.toFixed() : '0', locked: b ? b.locked.toFixed() : '0' }; };
    const demoLedger = async () => JSON.stringify({ balances: await prisma.demoBalance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }), orders: await prisma.demoOrder.count(), trades: await prisma.demoTrade.count() });
    const legacyTotals = async () => Object.fromEntries(await Promise.all(['USDT', 'BTC'].map(async asset => [asset, (await prisma.balance.findMany({ where: { asset, userId: { in: ['legacy', 'legacyMaker'] } } }))
      .reduce((sum, b) => sum.plus(b.available.toString()).plus(b.locked.toString()), new BigNumber(0)).toFixed()])));
    const market = (side, quantity, extra = {}) => ({ pair: 'BTC/USDT', side, type: 'MARKET', quantity: String(quantity), ...extra });
    await check('Demo Spot on: a Balance-credited tester trades the ordinary ledger exactly as before — LIMIT reserve/cancel, MARKET fill and partial fill, SELL, restart', async () => {
      const demoBefore = await demoLedger();
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '1000', locked: '0' });
      const buy = await api('POST', '/orders', 'legacy', limit('BUY', 100000, 0.0002));
      assert.equal(buy.status, 201); assert.equal(buy.body.order.status, 'OPEN');
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '980', locked: '20' });
      assert.equal((await api('DELETE', '/orders/' + buy.body.order.id, 'legacy')).status, 204);
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '1000', locked: '0' });
      const ask = await api('POST', '/orders', 'legacyMaker', limit('SELL', 100000, 0.001));
      assert.equal(ask.status, 201);
      const fill = await api('POST', '/orders', 'legacy', market('BUY', 0.0004));
      assert.equal(fill.status, 201); assert.equal(fill.body.order.status, 'FILLED'); assert.deepEqual(fill.body.trades.map(t => [t.price, t.quantity]), [['100000', '0.0004']]);
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '960', locked: '0' }); // 40 paid, the 2% buffer refunded
      assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.0004', locked: '0' });
      // More than the resting depth: 0.0006 fills, the rest is cancelled and refunded.
      const partial = await api('POST', '/orders', 'legacy', market('BUY', 0.001));
      assert.equal(partial.status, 201); assert.equal(partial.body.order.status, 'CANCELLED'); assert.equal(partial.body.order.remainingQuantity, '0.0004');
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '900', locked: '0' });
      assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.001', locked: '0' });
      assert.deepEqual(await bal('legacyMaker', 'USDT'), { available: '100', locked: '0' });
      const sell = await api('POST', '/orders', 'legacy', limit('SELL', 200000, 0.001));
      assert.equal(sell.status, 201); assert.deepEqual(await bal('legacy', 'BTC'), { available: '0', locked: '0.001' });
      // Restart: a new engine, router and DB client trade the persisted ordinary book.
      const restarted = new PrismaClient({ datasources: { db: { url } } });
      orders = ordersRouter(restarted, new MatchingEngine(), priceSource);
      try {
        const bid = await api('POST', '/orders', 'legacyMaker', limit('BUY', 200000, 0.0005));
        assert.equal(bid.status, 201); assert.equal(bid.body.order.status, 'FILLED');
        assert.deepEqual(await bal('legacy', 'USDT'), { available: '1000', locked: '0' });
        assert.equal((await api('DELETE', '/orders/' + sell.body.order.id, 'legacy')).status, 204);
        assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.0005', locked: '0' });
      } finally { orders = ordersRouter(prisma, new MatchingEngine(), priceSource); await restarted.$disconnect(); }
      // Conservation between the two testers; the demo ledger is untouched; nothing moved between ledgers.
      assert.deepEqual(await legacyTotals(), { USDT: '1000', BTC: '0.01' });
      assert.equal(await demoLedger(), demoBefore);
      assert.equal(await prisma.demoBalance.count({ where: { userId: { in: ['legacy', 'legacyMaker'] } } }), 0);
      assert.equal(await prisma.withdrawal.count({ where: { userId: { in: ['legacy', 'legacyMaker'] } } }), 0);
    });
    await check('Demo Spot on: more than the ordinary balance is refused («not enough»), nothing reserved or created', async () => {
      const before = [await bal('legacy', 'USDT'), await prisma.order.count({ where: { userId: 'legacy' } })];
      const over = await api('POST', '/orders', 'legacy', limit('BUY', 100000, 1));
      assert.equal(over.status, 400); assert.equal(over.body.error, 'Insufficient USDT balance or reserved funds');
      assert.deepEqual([await bal('legacy', 'USDT'), await prisma.order.count({ where: { userId: 'legacy' } })], before);
    });
    await check('ordinary /orders request ID: retries after a lost response and racing first attempts place one order and reserve once; other terms 409', async () => {
      const requestId = randomUUID(), body = { ...limit('BUY', 80000, 0.0001), requestId };
      const first = await api('POST', '/orders', 'legacy', body);
      assert.equal(first.status, 201);
      const retries = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/orders', 'legacy', body)));
      assert.deepEqual(retries.map(r => r.status), [200, 200, 200, 200, 200]);
      assert(retries.every(r => r.body.order.id === first.body.order.id));
      assert.equal(await prisma.order.count({ where: { userId: 'legacy', price: '80000' } }), 1);
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '992', locked: '8' });
      const conflict = await api('POST', '/orders', 'legacy', { ...body, quantity: '0.0002' });
      assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'REQUEST_CONFLICT');
      // Another account's identical request ID is its own order.
      const other = await api('POST', '/orders', 'legacyMaker', { ...limit('SELL', 300000, 0.0001), requestId });
      assert.equal(other.status, 201); assert.notEqual(other.body.order.id, first.body.order.id);
      const fresh = { ...limit('BUY', 70000, 0.0001), requestId: randomUUID() };
      const racing = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/orders', 'legacy', fresh)));
      assert.deepEqual(racing.map(r => r.status).sort(), [200, 200, 200, 201]);
      assert.equal(await prisma.order.count({ where: { userId: 'legacy', price: '70000' } }), 1);
      for (const [who, id] of [['legacy', first.body.order.id], ['legacy', racing[0].body.order.id], ['legacyMaker', other.body.order.id]]) assert.equal((await api('DELETE', '/orders/' + id, who)).status, 204);
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '1000', locked: '0' });
      // A filled MARKET order: the retry returns the same fill, never a second one.
      assert.equal((await api('POST', '/orders', 'legacyMaker', limit('SELL', 100000, 0.0002))).status, 201);
      const marketId = randomUUID();
      const filled = await api('POST', '/orders', 'legacy', market('BUY', 0.0001, { requestId: marketId }));
      assert.equal(filled.status, 201); assert.equal(filled.body.order.status, 'FILLED');
      const again = await Promise.all(Array.from({ length: 3 }, () => api('POST', '/orders', 'legacy', market('BUY', 0.0001, { requestId: marketId }))));
      assert.deepEqual(again.map(r => r.status), [200, 200, 200]);
      // The same persisted trade (executedAt is the stored time; the first answer carried the engine's).
      const fills = r => r.body.trades.map(t => [t.id, t.makerOrderId, t.price, t.quantity]);
      assert(again.every(r => JSON.stringify(fills(r)) === JSON.stringify(fills(filled))));
      assert.equal(await prisma.trade.count({ where: { takerOrderId: filled.body.order.id } }), 1);
      assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.0006', locked: '0' });
      assert.deepEqual(await bal('legacy', 'USDT'), { available: '990', locked: '0' });
      const rest = await prisma.order.findFirst({ where: { userId: 'legacyMaker', status: 'PARTIALLY_FILLED' } });
      assert.equal((await api('DELETE', '/orders/' + rest.id, 'legacyMaker')).status, 204);
      assert.deepEqual(await legacyTotals(), { USDT: '1000', BTC: '0.01' });
    });
    await check('ordinary OCO and the team MARKET SELL simulation: one request ID is one order, one reserve or one sale', async () => {
      const requestId = randomUUID();
      const oco = { pair: 'BTC/USDT', side: 'SELL', quantity: '0.0001', takeProfitPrice: '120000', stopTriggerPrice: '90000', stopLimitPrice: '89000', requestId };
      const results = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/orders/oco', 'legacy', oco)));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 200, 201]);
      assert(results.every(r => JSON.stringify(r.body) === JSON.stringify(results[0].body)));
      assert.equal(await prisma.order.count({ where: { userId: 'legacy', ocoGroupId: results[0].body.ocoGroupId } }), 2);
      assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.0005', locked: '0.0001' });
      assert.equal((await api('POST', '/orders/oco', 'legacy', { ...oco, stopLimitPrice: '88000' })).status, 409);
      assert.equal((await api('DELETE', '/orders/' + results[0].body.takeProfitOrderId, 'legacy')).status, 204);
      assert.deepEqual(await bal('legacy', 'BTC'), { available: '0.0006', locked: '0' });
      // TRADER2: a configured team test account whose MARKET SELL settles by simulation (no book), five attempts at once.
      const saleId = randomUUID(), before = [await bal(TRADER2, 'BTC'), await bal(TRADER2, 'USDT')];
      const sales = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/orders', TRADER2, market('SELL', 0.0002, { requestId: saleId }))));
      assert.deepEqual(sales.map(r => r.status).sort(), [200, 200, 200, 200, 201]);
      assert(sales.every(r => r.body.order.id === sales[0].body.order.id && r.body.order.status === 'FILLED'));
      assert.equal(await prisma.order.count({ where: { userId: TRADER2 } }), 1);
      assert.deepEqual(await bal(TRADER2, 'BTC'), { available: new BigNumber(before[0].available).minus('0.0002').toFixed(), locked: before[0].locked });
      assert.deepEqual(await bal(TRADER2, 'USDT'), { available: new BigNumber(before[1].available).plus('20').toFixed(), locked: before[1].locked });
      assert.equal(await prisma.demoBalance.count({ where: { userId: TRADER2 } }), 0);
    });
    await check('the read-only pre-activation SQL in docs/DEMO_TRADING.md runs and lists exactly what it should', async () => {
      const blocks = [...fs.readFileSync(path.join(root, 'docs/DEMO_TRADING.md'), 'utf8').matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1]);
      assert.equal(blocks.length, 4);
      for (const query of blocks) assert.match(query, /^(\s*--[^\n]*\n)*\s*SELECT [^;]*;\s*$/, 'one read-only SELECT');
      const [stale, switching, keeping, unheld] = await Promise.all(blocks.map(query => sql.query(query).then(r => r.rows)));
      assert.deepEqual(unheld.map(r => [r.id, r.status]), [[pendingUnheldId, 'PENDING']]); // REJECTED/SENT and Balance-held requests are not listed
      assert.deepEqual(stale.map(r => r.id), ['legacy-maker']); // the inconsistent row the fail-closed check wrote
      assert.deepEqual(switching.map(r => r.id), ['both']); // a demo credit AND ordinary funds: its terminal moves to the demo ledger
      assert.deepEqual([...new Set(keeping.map(r => r.id))].sort(), ['funded', 'legacy', 'legacyMaker', TRADER2].sort()); // keep the ordinary ledger
    });
    const marketDepth = {};
    await check('MARKET with and without resting depth, both ledgers: an empty book refuses a BUY and cancels a SELL without a fill; depth fills at the resting price', async () => {
      const ledgers = [
        { name: 'demo', who: 'demoFunded', bidder: 'demoBidder', route: '/demo/orders', fund: (who, asset, amount) => demo.topUp({ userId: who, asset, amount, performedByAdminId: 'admin', note: 'synthetic demo credit' }),
          bal: demoBal, orders: prisma.demoOrder, trades: prisma.demoTrade },
        { name: 'ordinary', who: 'spotFunded', bidder: 'spotBidder', route: '/orders', fund: (who, asset, amount) => adjust.adjustOnce({ userId: who, asset, amount, reason: 'synthetic Balance credit', performedByAdminId: 'admin', idempotencyKey: randomUUID() }),
          bal, orders: prisma.order, trades: prisma.trade },
      ];
      for (const l of ledgers) {
        await l.fund(l.who, 'USDT', '100'); await l.fund(l.who, 'SOL', '1'); await l.fund(l.bidder, 'USDT', '100');
        const state = async () => [await l.bal(l.who, 'USDT'), await l.bal(l.who, 'SOL')];
        const before = await state();
        const buy = await api('POST', l.route, l.who, { pair: 'SOL/USDT', side: 'BUY', type: 'MARKET', quantity: '0.1' });
        assert.equal(buy.status, 400); assert.match(buy.body.error, /^No liquidity available for this market order/);
        assert.equal(await l.orders.count({ where: { userId: l.who } }), 0);
        const sell = await api('POST', l.route, l.who, { pair: 'SOL/USDT', side: 'SELL', type: 'MARKET', quantity: '0.1' });
        assert.equal(sell.status, 201); assert.equal(sell.body.order.status, 'CANCELLED'); assert.deepEqual(sell.body.trades, []);
        assert.deepEqual(await state(), before, 'nothing spent; the SELL reserve is returned');
        assert.equal((await api('POST', l.route, l.bidder, { pair: 'SOL/USDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '0.2' })).status, 201);
        const filled = await api('POST', l.route, l.who, { pair: 'SOL/USDT', side: 'SELL', type: 'MARKET', quantity: '0.1' });
        assert.equal(filled.status, 201); assert.equal(filled.body.order.status, 'FILLED'); assert.deepEqual(filled.body.trades.map(t => [t.price, t.quantity]), [['100', '0.1']]);
        assert.deepEqual(await state(), [{ available: '110', locked: '0' }, { available: '0.9', locked: '0' }]);
        const rest = await l.orders.findFirst({ where: { userId: l.bidder, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
        assert.equal((await api('DELETE', l.route + '/' + rest.id, l.bidder)).status, 204);
        marketDepth[l.name] = { emptyBook: { buy: [buy.status, buy.body.error], sell: [sell.status, sell.body.order.status, sell.body.trades.length] }, withDepth: { sell: [filled.status, filled.body.order.status, filled.body.trades[0].price] } };
      }
    });
    await check('no outbound network request was attempted by any demo path', async () => { assert.deepEqual(outbound, []); });

    if (process.env.DEMO_QA_BROWSER === '1') {
      const browser = await require('./qa-demo-trading.cjs').run({ origin, prisma, out, token, demoBal, setEnabled: value => { enabled = value; },
        credit: (who, asset, amount) => adjust.adjustOnce({ userId: who, asset, amount, reason: 'synthetic Balance credit', performedByAdminId: 'admin', idempotencyKey: randomUUID() }),
        topUp: (who, asset, amount) => demo.topUp({ userId: who, asset, amount, performedByAdminId: 'admin', note: 'synthetic demo credit' }) });
      for (const group of browser.groups) console.log('PASS browser: ' + group);
    }
    const report = { database: 'disposable loopback PostgreSQL', reproduction, marketDepth, passed: checks, checks: checks.length, outbound, productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reproduction, marketDepth, checks: checks.length, outbound: outbound.length }, null, 2));
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
