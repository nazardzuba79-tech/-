'use strict';
// Issue #592 / CTO 6361475787 — internal demo liquidity, on a DISPOSABLE PostgreSQL only.
// One designated account's already-credited DemoBalance answers demo Spot takers at a
// server-owned reference plus a spread. Real routers and services; the reference is a
// fixture (no market feed, no venue); synthetic identities; outbound network denied.
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('node:assert/strict'), { spawnSync } = require('child_process'), { createRequire } = require('module');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.DEMO_QA_DEPS || 'output/demo-qa-deps/package.json'));
const out = path.resolve(root, process.env.DEMO_QA_OUT || 'output/demo-liquidity');
fs.mkdirSync(out, { recursive: true });
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-liquidity-fixture-secret-at-least-32-chars';
// The auth middleware loads the API-key module; a fixture value, never a real key.
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || require('crypto').randomBytes(32).toString('hex');
for (const key of Object.keys(process.env)) if (key.startsWith('DEMO_LIQUIDITY_') || key.startsWith('PRIVATE_TRADING_')) delete process.env[key];
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const express = require('express'), jwt = require('jsonwebtoken');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { demoLiquidityConfig, liquidityOrderId } = require('../src/services/DemoLiquidity');
const { demoTradingRouter } = require('../src/api/routes/demoTrading');
const { balancesRouter } = require('../src/api/routes/balances');
const { withdrawalsRouter } = require('../src/api/routes/withdrawals');

const LP = '00000000-0000-4000-8000-00000000a11d';
function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

async function main() {
  const configuredBin = process.env.DEMO_QA_PG_BIN;
  assert(configuredBin && path.isAbsolute(configuredBin), 'DEMO_QA_PG_BIN must be the absolute PostgreSQL tool directory (never a DB URL)');
  const bin = Object.fromEntries(['initdb', 'pg_ctl'].map(name => [name, path.join(fs.realpathSync(configuredBin), name)]));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-demo-liquidity-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${path.dirname(dir)}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);

  let sql, prisma, server;
  const checks = [], evidence = {};
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  const loopback = 'http://127.0.0.1:'; const realFetch = globalThis.fetch; const outbound = [];
  globalThis.fetch = (url, init) => { if (!String(url).startsWith(loopback)) { outbound.push(String(url)); return Promise.reject(new Error('outbound network denied in QA')); } return realFetch(url, init); };
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await sql.connect();
    await sql.query('CREATE DATABASE voltex_demo_liquidity_fixture'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_demo_liquidity_fixture' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    const people = { admin: 'ADMIN', [LP]: 'USER', buyer: 'USER', seller: 'USER', racer: 'USER', maker: 'USER', unfunded: 'USER', qaTrader: 'USER' };
    for (const [id, role] of Object.entries(people)) {
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ($1,$2,'fixture',$1,$3,'APPROVED',now(),now())`, [id, `${id.replace(/[^a-z0-9]/gi, '')}@example.invalid`, role]);
    }
    const url = `postgresql://postgres@127.0.0.1:${port}/voltex_demo_liquidity_fixture?connection_limit=24&sslmode=disable`;
    prisma = new PrismaClient({ datasources: { db: { url } } });

    // The server-owned reference, as the market-data cache reports it; controlled by the test.
    const reference = { 'BTC/USDT': { bid: '99990', ask: '100000', ageMs: 0, stale: false }, 'ETH/USDT': { bid: '3000', ask: '3001', ageMs: 0, stale: false } };
    const referenceReads = [];
    const source = async pair => { referenceReads.push(pair); const r = reference[pair]; return r ? { bid: r.bid, ask: r.ask, fetchedAt: Date.now() - r.ageMs, stale: r.stale } : null; };
    const env = { DEMO_LIQUIDITY_ENABLED: 'true', DEMO_LIQUIDITY_ACCOUNT_ID: LP, DEMO_LIQUIDITY_PAIRS: 'BTC/USDT,ETH/USDT', DEMO_LIQUIDITY_SPREAD_BPS: '10', DEMO_LIQUIDITY_MAX_ORDER_QUOTE: '500' };
    const parsed = demoLiquidityConfig(env);
    assert.ok(parsed.config, parsed.problem);
    const build = (db = prisma, liquidity = { config: parsed.config, reference: source }) => new DemoTradingService(db, new MatchingEngine(), { liquidity });
    let demo = build();
    const demoProxy = new Proxy({}, { get: (_target, key) => (...args) => demo[key](...args) });
    const spotPairs = new Set(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    const app = express(); app.use(express.json());
    app.use('/api/v1', balancesRouter(prisma));
    app.use('/api/v1', demoTradingRouter(prisma, demoProxy, undefined, { enabled: () => true, isSpotPair: async pair => spotPairs.has(pair) }));
    app.use('/api/v1', withdrawalsRouter(prisma, { tradingWallet: async () => null }));
    if (process.env.DEMO_QA_BROWSER === '1') {
      const dist = path.resolve(root, process.env.DEMO_QA_DIST || 'frontend/dist');
      app.use(express.static(dist, { index: false }));
      app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
    app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'fixture server error' }); });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sessions = new Map();
    const token = async who => {
      if (!sessions.has(who)) { const id = randomUUID(); await prisma.session.create({ data: { id, userId: who, lastSeenAt: new Date() } }); sessions.set(who, id); }
      return jwt.sign({ sub: who, sid: sessions.get(who) }, process.env.JWT_SECRET);
    };
    const api = async (method, route, who, body) => {
      const headers = { 'Content-Type': 'application/json' };
      if (who) headers.Authorization = 'Bearer ' + await token(who);
      const response = await fetch(origin + '/api/v1' + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const demoBal = async (who, asset) => { const b = await prisma.demoBalance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return { available: b ? b.available.toFixed() : '0', locked: b ? b.locked.toFixed() : '0' }; };
    const snapshot = async () => JSON.stringify(await prisma.demoBalance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }], select: { userId: true, asset: true, available: true, locked: true } }));
    const topUp = (who, asset, amount) => demo.topUp({ userId: who, asset, amount, performedByAdminId: 'admin', note: 'synthetic demo credit' });
    // Conservation: every demo unit in existence was credited by an admin demo top-up — nothing else creates any.
    const conserved = async () => {
      const credited = {};
      for (const log of await prisma.auditLog.findMany({ where: { action: 'DEMO_BALANCE_ADJUSTED' } })) {
        credited[log.metadata.asset] = (credited[log.metadata.asset] ?? new BigNumber(0)).plus(log.metadata.delta);
      }
      for (const [asset, sum] of Object.entries(credited)) {
        const held = (await prisma.demoBalance.findMany({ where: { asset } })).reduce((s, b) => s.plus(b.available.toString()).plus(b.locked.toString()), new BigNumber(0));
        assert.equal(held.toFixed(), sum.toFixed(), `${asset}: held ${held.toFixed()} vs credited ${sum.toFixed()}`);
        for (const b of await prisma.demoBalance.findMany({ where: { asset } })) assert.ok(!b.available.isNegative() && !b.locked.isNegative(), `${b.userId} ${asset} never negative`);
      }
    };
    const market = (side, quantity, pair = 'BTC/USDT', extra = {}) => ({ pair, side, type: 'MARKET', quantity: String(quantity), ...extra });
    const limit = (side, price, quantity, pair = 'BTC/USDT') => ({ pair, side, type: 'LIMIT', price: String(price), quantity: String(quantity) });

    // ── Inventory: credited to the liquidity account by the ordinary admin demo top-up ─────
    for (const [who, asset, amount] of [[LP, 'BTC', '0.05'], [LP, 'USDT', '5000'], ['buyer', 'USDT', '1000'], ['buyer', 'ETH', '0.5'], ['seller', 'BTC', '0.01'], ['racer', 'USDT', '2000'], ['maker', 'BTC', '0.002']]) await topUp(who, asset, amount);

    await check('baseline (liquidity off, the default): an empty book refuses MARKET BUY and cancels MARKET SELL without a fill', async () => {
      assert.deepEqual(demoLiquidityConfig({}), { config: null });
      const plain = new DemoTradingService(prisma, new MatchingEngine());
      const before = await snapshot();
      await assert.rejects(plain.placeOrder({ userId: 'buyer', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }), { code: 'NO_LIQUIDITY' });
      const sell = await plain.placeOrder({ userId: 'seller', pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber('0.001') });
      assert.equal(sell.order.status, 'CANCELLED'); assert.equal(sell.trades.length, 0);
      assert.equal(await snapshot(), before);
      assert.deepEqual(referenceReads, [], 'no reference is read when liquidity is off');
    });

    await check('MARKET BUY on an empty book fills from the liquidity account at the reference ask + 10 bps; exact balances; its receipt is FILLED; nothing rests', async () => {
      const r = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.002'));
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.order.status, 'FILLED');
      assert.deepEqual(r.body.trades.map(t => [t.makerUserId, t.price, t.quantity]), [[LP, '100100', '0.002']]);
      assert.deepEqual(await demoBal('buyer', 'USDT'), { available: '799.8', locked: '0' }); // 200.2 paid, the 2% buffer refunded
      assert.deepEqual(await demoBal('buyer', 'BTC'), { available: '0.002', locked: '0' });
      assert.deepEqual(await demoBal(LP, 'BTC'), { available: '0.048', locked: '0' });
      assert.deepEqual(await demoBal(LP, 'USDT'), { available: '5200.2', locked: '0' });
      const receipt = await prisma.demoOrder.findUnique({ where: { id: liquidityOrderId(r.body.order.id) } });
      assert.equal(receipt.userId, LP); assert.equal(receipt.status, 'FILLED'); assert.equal(receipt.remainingQuantity.toFixed(), '0'); assert.equal(receipt.originalQuantity.toFixed(), '0.002');
      assert.deepEqual((await api('GET', '/demo/orderbook/BTC%2FUSDT', 'buyer')).body.asks, [], 'the quote never rests');
      await conserved();
      evidence.marketBuy = r.body.trades[0];
    });

    await check('MARKET SELL fills at the reference bid − 10 bps', async () => {
      const r = await api('POST', '/demo/orders', 'seller', market('SELL', '0.003'));
      assert.equal(r.status, 201); assert.equal(r.body.order.status, 'FILLED');
      assert.deepEqual(r.body.trades.map(t => [t.makerUserId, t.price, t.quantity]), [[LP, '99890.01', '0.003']]);
      assert.deepEqual(await demoBal('seller', 'BTC'), { available: '0.007', locked: '0' });
      assert.deepEqual(await demoBal('seller', 'USDT'), { available: '299.67003', locked: '0' });
      assert.deepEqual(await demoBal(LP, 'USDT'), { available: '4900.52997', locked: '0' });
      await conserved();
      evidence.marketSell = r.body.trades[0];
    });

    await check('LIMIT: a crossing BUY fills at the quote and the difference is refunded; a crossing SELL fills at the bid quote; a passive LIMIT rests with an exact reserve and cancels; no quote ever rests', async () => {
      const crossing = await api('POST', '/demo/orders', 'buyer', limit('BUY', 101000, '0.001'));
      assert.equal(crossing.status, 201); assert.equal(crossing.body.order.status, 'FILLED');
      assert.deepEqual(crossing.body.trades.map(t => t.price), ['100100']);
      assert.deepEqual(await demoBal('buyer', 'USDT'), { available: '699.7', locked: '0' }); // 100.1 paid, 0.9 of the 101 reserve returned
      const sell = await api('POST', '/demo/orders', 'seller', limit('SELL', 99000, '0.001'));
      assert.equal(sell.body.order.status, 'FILLED'); assert.deepEqual(sell.body.trades.map(t => t.price), ['99890.01']);
      const passive = await api('POST', '/demo/orders', 'buyer', limit('BUY', 95000, '0.001'));
      assert.equal(passive.status, 201); assert.equal(passive.body.order.status, 'OPEN'); assert.deepEqual(passive.body.trades, []);
      assert.deepEqual(await demoBal('buyer', 'USDT'), { available: '604.7', locked: '95' });
      assert.equal(await prisma.demoOrder.count({ where: { id: liquidityOrderId(passive.body.order.id) } }), 0, 'an unfilled quote leaves no row');
      const book = (await api('GET', '/demo/orderbook/BTC%2FUSDT', 'buyer')).body;
      assert.deepEqual([book.bids, book.asks], [[{ price: '95000', quantity: '0.001', orders: 1 }], []]);
      assert.equal((await api('DELETE', '/demo/orders/' + passive.body.order.id, 'buyer')).status, 204);
      assert.deepEqual(await demoBal('buyer', 'USDT'), { available: '699.7', locked: '0' });
      assert.equal(await prisma.demoOrder.count({ where: { userId: LP, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } }), 0);
      await conserved();
    });

    await check('insufficient funds: 400 «Insufficient … balance» before anything moves; an unfunded account cannot trade at all', async () => {
      const before = await snapshot();
      const buy = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.01'));
      assert.equal(buy.status, 400); assert.deepEqual([buy.body.code, buy.body.error], ['INSUFFICIENT_BALANCE', 'Insufficient USDT balance']);
      const sell = await api('POST', '/demo/orders', 'seller', market('SELL', '1'));
      assert.deepEqual([sell.status, sell.body.code, sell.body.error], [400, 'INSUFFICIENT_BALANCE', 'Insufficient BTC balance']);
      assert.equal((await api('POST', '/demo/orders', 'unfunded', market('BUY', '0.0001'))).status, 403, 'no admin demo credit: not admitted');
      assert.equal(await snapshot(), before);
    });

    await check('no liquidity, fail closed: stale, old, future, crossed, too wide or missing reference, an unlisted pair — BUY 400 NO_LIQUIDITY, SELL CANCELLED without a fill, nothing moves', async () => {
      const saved = { ...reference['BTC/USDT'] };
      const cases = { stale: { stale: true }, old: { ageMs: 60_000 }, future: { ageMs: -5_000 }, crossed: { bid: '100000', ask: '99990' }, wide: { bid: '99000', ask: '100500' } };
      evidence.failClosed = {};
      for (const [name, change] of Object.entries(cases)) {
        Object.assign(reference['BTC/USDT'], saved, change);
        const before = await snapshot();
        const buy = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.001'));
        assert.deepEqual([buy.status, buy.body.code], [400, 'NO_LIQUIDITY'], name);
        const sell = await api('POST', '/demo/orders', 'seller', market('SELL', '0.001'));
        assert.deepEqual([sell.status, sell.body.order.status, sell.body.trades.length], [201, 'CANCELLED', 0], name);
        assert.equal(await snapshot(), before, name);
        evidence.failClosed[name] = [buy.status, buy.body.code, sell.body.order.status];
      }
      Object.assign(reference['BTC/USDT'], saved);
      delete reference['ETH/USDT'];
      const missing = await api('POST', '/demo/orders', 'buyer', market('SELL', '0.01', 'ETH/USDT'));
      assert.deepEqual([missing.status, missing.body.order.status, missing.body.trades.length], [201, 'CANCELLED', 0], 'no reference for the pair');
      reference['ETH/USDT'] = { bid: '3000', ask: '3001', ageMs: 0, stale: false };
      const unlisted = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.01', 'SOL/USDT'));
      assert.deepEqual([unlisted.status, unlisted.body.code], [400, 'NO_LIQUIDITY']);
      assert.ok(!referenceReads.includes('SOL/USDT'), 'an unlisted pair never reads a reference');
      await conserved();
    });

    await check('inventory and the per-order cap: an empty inventory side quotes nothing; a large MARKET BUY fills up to 500 USDT, the rest is cancelled and refunded', async () => {
      // The liquidity account holds no ETH: nothing to sell a buyer; its USDT still buys from a seller.
      const noEth = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.01', 'ETH/USDT'));
      assert.deepEqual([noEth.status, noEth.body.code], [400, 'NO_LIQUIDITY']);
      const ethSell = await api('POST', '/demo/orders', 'buyer', market('SELL', '0.1', 'ETH/USDT'));
      assert.deepEqual([ethSell.body.order.status, ethSell.body.trades.map(t => [t.price, t.quantity])], ['FILLED', [['2997', '0.1']]]);
      assert.deepEqual(await demoBal(LP, 'ETH'), { available: '0.1', locked: '0' });
      const big = await api('POST', '/demo/orders', 'racer', market('BUY', '0.01'));
      assert.equal(big.status, 201); assert.equal(big.body.order.status, 'CANCELLED');
      assert.deepEqual(big.body.trades.map(t => [t.price, t.quantity]), [['100100', '0.004995']]); // 500 / 100100, rounded down to 8 places
      assert.deepEqual(await demoBal('racer', 'USDT'), { available: '1500.0005', locked: '0' }); // 499.9995 paid
      assert.deepEqual(await demoBal('racer', 'BTC'), { available: '0.004995', locked: '0' });
      await conserved();
      evidence.cap = { requested: '0.01', filled: big.body.trades[0].quantity, paid: '499.9995' };
    });

    await check('retries: 5 parallel attempts with one request ID → one order, one quote fill, one charge; a later replay answers 200 with the same fill; other terms → 409', async () => {
      const requestId = randomUUID();
      const before = await demoBal('buyer', 'USDT');
      const attempts = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/demo/orders', 'buyer', market('BUY', '0.001', 'BTC/USDT', { requestId }))));
      assert.deepEqual(attempts.map(a => a.status).sort(), [200, 200, 200, 200, 201]);
      const ids = new Set(attempts.map(a => a.body.order.id)), tradeIds = new Set(attempts.flatMap(a => a.body.trades.map(t => t.id)));
      assert.equal(ids.size, 1); assert.equal(tradeIds.size, 1);
      assert.equal(await prisma.demoTrade.count({ where: { takerOrderId: [...ids][0] } }), 1);
      assert.equal(await prisma.demoOrder.count({ where: { id: liquidityOrderId([...ids][0]) } }), 1);
      assert.equal(new BigNumber(before.available).minus((await demoBal('buyer', 'USDT')).available).toFixed(), '100.1', 'charged once');
      const replay = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.001', 'BTC/USDT', { requestId }));
      assert.equal(replay.status, 200); assert.deepEqual(replay.body.trades.map(t => t.id), [...tradeIds]);
      const conflict = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.002', 'BTC/USDT', { requestId }));
      assert.deepEqual([conflict.status, conflict.body.code], [409, 'REQUEST_CONFLICT']);
      await conserved();
    });

    await check('concurrency: 12 parallel MARKET BUYs against 0.005 BTC of inventory → exactly 0.005 sold, never overdrawn, the rest refused NO_LIQUIDITY, nothing minted', async () => {
      const held = new BigNumber((await demoBal(LP, 'BTC')).available);
      await demo.topUp({ userId: LP, asset: 'BTC', amount: held.minus('0.005').negated().toFixed(), performedByAdminId: 'admin', note: 'synthetic demo debit' });
      assert.deepEqual(await demoBal(LP, 'BTC'), { available: '0.005', locked: '0' });
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => api('POST', '/demo/orders', i % 2 ? 'buyer' : 'racer', market('BUY', '0.001'))));
      const filled = results.filter(r => r.status === 201 && r.body.order.status === 'FILLED');
      assert.equal(filled.length, 5);
      assert.deepEqual(results.filter(r => r.status !== 201).map(r => [r.status, r.body.code]), Array(7).fill([400, 'NO_LIQUIDITY']));
      assert.deepEqual(await demoBal(LP, 'BTC'), { available: '0', locked: '0' });
      await conserved();
      evidence.concurrency = { attempts: 12, filled: 5, refused: 7 };
    });

    await check('priority: a resting tester ask at a better price fills first, the quote takes the rest', async () => {
      await topUp(LP, 'BTC', '0.01');
      const rest = await api('POST', '/demo/orders', 'maker', limit('SELL', 100050, '0.002'));
      assert.equal(rest.status, 201);
      const r = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.003'));
      assert.deepEqual(r.body.trades.map(t => [t.makerUserId, t.price, t.quantity]), [['maker', '100050', '0.002'], [LP, '100100', '0.001']]);
      assert.deepEqual(await demoBal('maker', 'USDT'), { available: '200.1', locked: '0' });
      await conserved();
    });

    await check('restart: a new process (engine, service, DB client) holds no liquidity order and trades from the same balances', async () => {
      const before = await snapshot();
      const restarted = new PrismaClient({ datasources: { db: { url } } });
      demo = build(restarted);
      try {
        assert.deepEqual((await api('GET', '/demo/orderbook/BTC%2FUSDT', 'buyer')).body.asks, []);
        assert.equal(await snapshot(), before);
        const r = await api('POST', '/demo/orders', 'seller', market('SELL', '0.001'));
        assert.deepEqual([r.body.order.status, r.body.trades.map(t => t.makerUserId)], ['FILLED', [LP]]);
      } finally { demo = build(); await restarted.$disconnect(); }
      await conserved();
    });

    await check('a blocked liquidity account quotes nothing; the liquidity account never trades against itself', async () => {
      await prisma.user.update({ where: { id: LP }, data: { blockedAt: new Date() } });
      const blocked = await api('POST', '/demo/orders', 'buyer', market('BUY', '0.001'));
      assert.deepEqual([blocked.status, blocked.body.code], [400, 'NO_LIQUIDITY']);
      await prisma.user.update({ where: { id: LP }, data: { blockedAt: null } });
      const self = await api('POST', '/demo/orders', LP, market('BUY', '0.001'));
      assert.deepEqual([self.status, self.body.code], [400, 'NO_LIQUIDITY']);
    });

    await check('admin status (read only): configuration, inventory and a fresh reference per pair; a USER is refused', async () => {
      const status = await api('GET', '/demo/liquidity', 'admin');
      assert.equal(status.status, 200);
      assert.deepEqual([status.body.enabled, status.body.accountId, status.body.spreadBps, status.body.maxOrderQuote], [true, LP, 10, '500']);
      assert.deepEqual(status.body.pairs.map(p => [p.pair, p.reference]), [['BTC/USDT', 'OK'], ['ETH/USDT', 'OK']]);
      assert.ok(status.body.inventory.some(b => b.asset === 'USDT'));
      assert.equal((await api('GET', '/demo/liquidity', 'buyer')).status, 403);
      evidence.status = status.body;
    });

    await check('no cash-out: the liquidity account and the testers have no Balance row, no withdrawal, no real order or trade', async () => {
      assert.equal(await prisma.balance.count(), 0);
      const w = await api('POST', '/withdrawals', LP, { asset: 'USDT', network: 'TRC20', toAddress: 'TQAFIXTURE', amount: '1' });
      assert.notEqual(w.status, 200); assert.notEqual(w.status, 201);
      assert.equal(await prisma.withdrawal.count(), 0);
      assert.equal(await prisma.order.count(), 0); assert.equal(await prisma.trade.count(), 0);
    });
    await check('no outbound network request', async () => { assert.deepEqual(outbound, []); });

    if (process.env.DEMO_QA_BROWSER === '1') {
      const browser = await require('./qa-demo-liquidity.cjs').run({ origin, out, token, prisma, demoBal, topUp, reference, conserved });
      for (const group of browser.groups) console.log('PASS browser: ' + group);
      evidence.browser = browser;
    }
    const report = { database: 'disposable loopback PostgreSQL', evidence, passed: checks, checks: checks.length, outbound, productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: checks.length, outbound: outbound.length }, null, 2));
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
