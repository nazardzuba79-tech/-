'use strict';
/* Wallet Conversion on the demo ledger (Issue #592 demo funds), on a DISPOSABLE PostgreSQL only.
 * Real services and routers; synthetic identities; the price feed is a fixture; outbound network denied.
 * Ignores DATABASE_URL; never starts src/index. Requires WALLET_QA_PG_BIN (PostgreSQL tool directory). */
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('node:assert/strict'), { spawnSync } = require('child_process'), { createRequire } = require('module');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.WALLET_QA_DEPS || 'output/wallet-qa-deps/package.json'));
const out = path.join(root, 'output/wallet-conversion-demo'); fs.mkdirSync(out, { recursive: true });
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = 'isolated-wallet-demo-conversion-fixture-only';
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-wallet-demo-conversion-fixture-only';
process.env.API_KEY_ENCRYPTION_SECRET = require('crypto').randomBytes(32).toString('hex');
for (const key of Object.keys(process.env)) if (/^(DEMO_|PRIVATE_TRADING_|WALLET_CONVERSION_)/.test(key)) delete process.env[key];
const LIQ = '00000000-0000-4000-8000-0000000c0de1', NATIVE = '00000000-0000-4000-8000-0000000a71e1';
// The production switches this feature depends on, as Issue #592 records them ON (Demo Spot + Demo Liquidity).
Object.assign(process.env, { DEMO_SPOT_ENABLED: 'true', DEMO_LIQUIDITY_ENABLED: 'true', DEMO_LIQUIDITY_ACCOUNT_ID: LIQ,
  DEMO_LIQUIDITY_PAIRS: 'BTC/USDT', DEMO_LIQUIDITY_MAX_ORDER_QUOTE: '5000', PRIVATE_TRADING_TEST_USER_IDS: NATIVE });
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const express = require('express'), jwt = require('jsonwebtoken');
const { WalletConversionService, parseConversionAssets, parseConversionReserves, DEFAULT_CONVERSION_ASSETS } = require('../src/services/WalletConversionService');
const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { demoLiquidityConfig } = require('../src/services/DemoLiquidity');
const { demoSpotLedger, demoWithdrawalGuardEnabled } = require('../src/services/demoSpotAccess');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { walletActivityRouter } = require('../src/api/routes/walletActivity');
const { withdrawalsRouter } = require('../src/api/routes/withdrawals');
function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

async function main() {
  const configuredBin = process.env.WALLET_QA_PG_BIN;
  assert(configuredBin && path.isAbsolute(configuredBin), 'WALLET_QA_PG_BIN must be the absolute PostgreSQL tool directory (never a DB URL)');
  const bin = Object.fromEntries(['initdb', 'pg_ctl'].map(name => [name, path.join(fs.realpathSync(configuredBin), name)]));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-wallet-demo-conversion-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${path.dirname(dir)}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);
  let sql, prisma, restarted, server;
  const checks = []; const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  const loopback = 'http://127.0.0.1:'; const realFetch = globalThis.fetch; const outbound = [];
  globalThis.fetch = (url, init) => { if (!String(url).startsWith(loopback)) { outbound.push(String(url)); return Promise.reject(new Error('outbound network denied in QA')); } return realFetch(url, init); };
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await sql.connect();
    const postgresVersion = (await sql.query('SHOW server_version_num')).rows[0].server_version_num;
    if (process.env.WALLET_QA_PG_VERSION_NUM) assert.equal(postgresVersion, process.env.WALLET_QA_PG_VERSION_NUM, 'Wrong isolated PostgreSQL runtime');
    await sql.query('CREATE DATABASE voltex_wallet_demo_conversion_fixture'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_wallet_demo_conversion_fixture' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    const drains = Array.from({ length: 6 }, (_, i) => `qa-drain-${i}`);
    const people = { 'qa-admin': 'ADMIN', [LIQ]: 'USER', [NATIVE]: 'USER', 'qa-zero': 'USER', 'qa-tester': 'USER', 'qa-racer': 'USER', 'qa-double': 'USER',
      'qa-revoked': 'USER', 'qa-blocked': 'USER', 'qa-switch': 'USER', 'qa-dual': 'USER', 'qa-third': 'USER', 'qa-daily': 'USER', 'qa-off': 'USER',
      'qa-stale': 'USER', 'qa-roll': 'USER', 'qa-other': 'USER', 'qa-lockwait': 'USER',
      ...Object.fromEntries(drains.map(id => [id, 'USER'])) };
    for (const [id, role] of Object.entries(people)) {
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ($1,$2,'fixture',$1,$3,'APPROVED',now(),now())`,
        [id, `${id.replace(/[^a-z0-9]/gi, '')}@example.invalid`, role]);
    }
    const url = `postgresql://postgres@127.0.0.1:${port}/voltex_wallet_demo_conversion_fixture?connection_limit=24&sslmode=disable`;
    prisma = new PrismaClient({ datasources: { db: { url } } });

    // USD per unit, [bid, ask]: the conversion feed. VTA and NRX are priced on purpose: a price alone admits nothing.
    let now = Date.now(), failFeed = false;
    const feedBook = { USD: ['1', '1'], EUR: ['1.08', '1.081'], USDC: ['0.999', '1.001'], BTC: ['60000', '60010'], ETH: ['3000', '3001'], USDT: ['0.997', '0.998'], VTA: ['2', '2'], NRX: ['5', '5'] };
    const prices = { read: async () => {
      if (failFeed) throw new Error('fixture outage');
      const entries = Object.entries(feedBook);
      return { fetchedAt: now, bid: new Map(entries.map(([a, [b]]) => [a, b])), ask: new Map(entries.map(([a, [, k]]) => [a, k])) };
    }, depth: async () => '1000000000' };
    const admitted = parseConversionAssets(DEFAULT_CONVERSION_ASSETS);
    const limits = (reserves, maxUsd = '1000', dailyUsd = '5000') => ({ maxUsd: new BigNumber(maxUsd), dailyUsd: new BigNumber(dailyUsd), reserves: parseConversionReserves(reserves, admitted) });
    // No operator-verified reserve at all: a demo conversion is backed by the liquidity account's DemoBalance only.
    const build = (db = prisma, env = process.env, configured = limits('')) => new WalletConversionService(db, prices, () => now, admitted, configured, env);
    let conversion = build();
    const AMPLE = 'USD:1000000,EUR:1000000,USDT:1000000,USDC:1000000,BTC:100,ETH:1000';
    const balanceService = build(prisma, process.env, limits(AMPLE));
    // The demo Spot engine with the same liquidity account, for the orders that race the conversions.
    const reference = { 'BTC/USDT': { bid: '60100', ask: '60160' } };
    const liquidity = { config: demoLiquidityConfig(process.env).config, reference: async pair => reference[pair] ? { ...reference[pair], fetchedAt: Date.now(), stale: false } : null };
    assert.ok(liquidity.config);
    const demo = new DemoTradingService(prisma, new MatchingEngine(), { liquidity });
    const adjust = new BalanceAdjustmentService(prisma);
    const credited = {};
    const topUp = async (who, asset, amount) => {
      await demo.topUp({ userId: who, asset, amount, performedByAdminId: 'qa-admin', note: 'synthetic demo credit' });
      credited[asset] = new BigNumber(credited[asset] ?? 0).plus(amount).toFixed();
    };
    const credit = (who, asset, amount) => adjust.adjustOnce({ userId: who, asset, amount, reason: 'synthetic fixture', performedByAdminId: 'qa-admin', idempotencyKey: randomUUID() });
    const demoOf = async (who, asset) => { const b = await prisma.demoBalance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return b ? b.available.toFixed() : '0'; };
    const lockedOf = async (who, asset) => { const b = await prisma.demoBalance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return b ? b.locked.toFixed() : '0'; };
    const rowsOf = async who => JSON.stringify({
      balance: (await prisma.balance.findMany({ where: { userId: who }, orderBy: { asset: 'asc' } })).map(r => [r.asset, r.available.toFixed(), r.locked.toFixed()]),
      demo: (await prisma.demoBalance.findMany({ where: { userId: who }, orderBy: { asset: 'asc' } })).map(r => [r.asset, r.available.toFixed(), r.locked.toFixed()]),
    });
    const balanceRows = async who => prisma.balance.count({ where: { userId: who } });
    // Every unit credited by demo top-up is still somewhere in DemoBalance: nothing minted, nothing lost.
    const conserved = async () => {
      const rows = await prisma.demoBalance.findMany();
      const total = {};
      for (const r of rows) { assert(!r.available.isNegative() && !r.locked.isNegative(), `negative demo row ${r.userId} ${r.asset}`); total[r.asset] = new BigNumber(total[r.asset] ?? 0).plus(r.available.toFixed()).plus(r.locked.toFixed()); }
      for (const asset of new Set([...Object.keys(total), ...Object.keys(credited)])) assert.equal((total[asset] ?? new BigNumber(0)).toFixed(), new BigNumber(credited[asset] ?? 0).toFixed(), `DemoBalance total of ${asset}`);
    };

    // Liquidity inventory: credited through demo top-up only, as on production.
    await topUp(LIQ, 'BTC', '1'); await topUp(LIQ, 'USDT', '10000'); await topUp(LIQ, 'USD', '10000'); await topUp(LIQ, 'EUR', '10000');
    for (const who of ['qa-tester', 'qa-double', 'qa-revoked', 'qa-blocked', 'qa-switch', 'qa-dual', NATIVE, 'qa-off', 'qa-stale', 'qa-roll', 'qa-other', 'qa-lockwait']) await topUp(who, 'USDT', '50');
    await topUp('qa-racer', 'USDT', '100'); await topUp('qa-daily', 'USDT', '200');
    for (const id of drains) await topUp(id, 'USDT', '100');
    await topUp('qa-admin', 'USDT', '50');
    await demo.topUp({ userId: 'qa-admin', asset: 'VTA', amount: '10', performedByAdminId: 'qa-admin', note: 'admin own VTA simulation' }); credited.VTA = '10';
    // Ordinary Balance only where an account already holds it; the bystander has both ledgers.
    await credit('qa-dual', 'USD', '100'); await credit('qa-third', 'USD', '100'); await topUp('qa-third', 'USDT', '20');
    const thirdBefore = await rowsOf('qa-third');

    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-fixture-drop-response'] === 'yes') res.json = () => { res.socket.destroy(); return res; }; next(); });
    let liveApi = walletActivityRouter(prisma, conversion, true);
    app.use('/__default_off', walletActivityRouter(prisma, conversion));
    app.use('/api/v1', (req, res, next) => liveApi(req, res, next));
    // A native Cross tester's wallet is valued from DemoBalance (as on production); everyone else withdraws from Balance.
    app.use('/api/v1', withdrawalsRouter(prisma, { tradingWallet: async actor => (await prisma.demoBalance.findMany({ where: { userId: actor.userId } })).map(r => ({ asset: r.asset, available: r.available.toFixed() })) }));
    app.use((error, req, res, next) => { console.error(error); res.status(500).json({ code: 'FIXTURE_ERROR' }); });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sessions = new Map();
    const token = async who => {
      if (!sessions.has(who)) { const id = randomUUID(); await prisma.session.create({ data: { id, userId: who, lastSeenAt: new Date() } }); sessions.set(who, id); }
      return jwt.sign({ sub: who, sid: sessions.get(who) }, process.env.JWT_SECRET, { expiresIn: '12h' });
    };
    const api = async (method, route, who, body, { drop = false, base = '/api/v1' } = {}) => {
      const headers = { 'Content-Type': 'application/json', ...(drop ? { 'X-Fixture-Drop-Response': 'yes' } : {}) };
      if (who) headers.Authorization = 'Bearer ' + await token(who);
      const response = await fetch(origin + base + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    };

    await check('the demo withdrawal guard is on whenever a demo ledger exists (forced by DEMO_SPOT_ENABLED)', async () => {
      assert.equal(demoWithdrawalGuardEnabled(process.env), true);
      assert.equal(demoWithdrawalGuardEnabled({ ...process.env, DEMO_WITHDRAWAL_GUARD_ENABLED: 'false' }), true);
      assert.equal(await demoSpotLedger(prisma, 'qa-tester', true), 'demo');
      assert.equal(await demoSpotLedger(prisma, 'qa-dual', true), 'spot');
      assert.equal(await demoSpotLedger(prisma, 'qa-zero', true), 'none');
    });
    await check('default-OFF server switch: no conversion route exists, also for demo accounts; nothing written', async () => {
      const before = await rowsOf('qa-tester');
      for (const [method, route, body] of [['GET', '/wallet/conversion/availability'], ['GET', '/wallet/conversion/assets'], ['POST', '/wallet/conversion/quote', { fromAsset: 'USDT', toAsset: 'BTC', amount: '1' }], ['POST', '/wallet/conversion/confirm', { quoteId: randomUUID() }]]) {
        const r = await api(method, route, 'qa-tester', body, { base: '/__default_off' });
        assert.equal(r.status, 404); assert.equal(r.body.code, 'NOT_FOUND');
      }
      assert.equal(await prisma.auditLog.count({ where: { action: 'WALLET_CONVERSION_QUOTED' } }), 0);
      assert.equal(await rowsOf('qa-tester'), before);
    });
    await check('availability: a demo tester is offered Convert on DemoBalance; the liquidity account itself is not', async () => {
      assert.deepEqual((await api('GET', '/wallet/conversion/availability', 'qa-tester')).body, { convertible: true, ledger: 'demo' });
      assert.deepEqual(await conversion.availability(LIQ), { convertible: false, ledger: 'demo' });
    });
    await check('new account with zero balance: nothing to convert, refused before any write, no balance row created', async () => {
      const assets = await conversion.assets('qa-zero');
      assert(assets.length > 0 && assets.every(a => a.available === '0'));
      await assert.rejects(conversion.quote('qa-zero', 'USDT', 'BTC', '1'), { code: 'INSUFFICIENT_BALANCE' });
      await assert.rejects(conversion.quote('qa-zero', 'USD', 'EUR', '1'), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(await prisma.balance.count({ where: { userId: 'qa-zero' } }), 0);
      assert.equal(await prisma.demoBalance.count({ where: { userId: 'qa-zero' } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { userId: 'qa-zero' } }), 0);
    });
    let testerBtc;
    await check('50 admin-credited demo USDT convert to BTC inside DemoBalance at the bid/ask with 0% fee; the liquidity account is the counterparty; Balance untouched', async () => {
      assert.equal((await conversion.assets('qa-tester')).find(a => a.asset === 'USDT').available, '50');
      const q = await conversion.quote('qa-tester', 'USDT', 'BTC', '50');
      assert.equal(q.ledger, 'demo'); assert.equal(q.fee, '0');
      assert.equal(q.toAmount, new BigNumber(50).times('0.997').div('60010').decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed());
      // The quote reserves nothing.
      assert.equal(await demoOf('qa-tester', 'USDT'), '50');
      // Liquidity account blocked after the quote: refused, nothing moves; then it holds ordinary Balance: refused again.
      await prisma.user.update({ where: { id: LIQ }, data: { blockedAt: new Date() } });
      await assert.rejects(conversion.confirm('qa-tester', q.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      await prisma.user.update({ where: { id: LIQ }, data: { blockedAt: null } });
      await credit(LIQ, 'USD', '1');
      await assert.rejects(conversion.confirm('qa-tester', q.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      await credit(LIQ, 'USD', '-1');
      assert.equal(await demoOf('qa-tester', 'USDT'), '50'); assert.equal(await demoOf(LIQ, 'BTC'), '1');
      const receipt = await conversion.confirm('qa-tester', q.quoteId);
      assert.equal(receipt.status, 'APPLIED'); assert.equal(receipt.ledger, 'demo'); assert.equal(receipt.operationId, `conversion:${q.quoteId}`);
      testerBtc = q.toAmount;
      assert.equal(await demoOf('qa-tester', 'USDT'), '0'); assert.equal(await demoOf('qa-tester', 'BTC'), q.toAmount);
      assert.equal(await demoOf(LIQ, 'USDT'), '10050'); assert.equal(await demoOf(LIQ, 'BTC'), new BigNumber(1).minus(q.toAmount).toFixed());
      assert.equal(await balanceRows('qa-tester'), 0);
      assert.equal(await prisma.auditLog.count({ where: { action: 'WALLET_DEMO_CONVERTED', id: `conversion:${q.quoteId}` } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'WALLET_CONVERTED' } }), 0);
      await conserved();
    });
    await check('insufficient demo funds: more than available is refused at quote; funds spent by a demo order after the quote refuse the confirm; nothing moves', async () => {
      await assert.rejects(conversion.quote('qa-switch', 'USDT', 'BTC', '50.000001'), { code: 'INSUFFICIENT_BALANCE' });
      const q = await conversion.quote('qa-switch', 'USDT', 'BTC', '40');
      await demo.placeOrder({ userId: 'qa-switch', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('50000'), quantity: new BigNumber('0.0004') }); // locks 20 USDT
      const before = await rowsOf('qa-switch');
      await assert.rejects(conversion.confirm('qa-switch', q.quoteId), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(await rowsOf('qa-switch'), before); assert.equal(await lockedOf('qa-switch', 'USDT'), '20');
      await conserved();
    });
    await check('an account that gets ordinary Balance after its demo quote: the confirm settles nothing on either ledger', async () => {
      const q = await conversion.quote('qa-switch', 'USDT', 'BTC', '10');
      await credit('qa-switch', 'USD', '1');
      const before = await rowsOf('qa-switch');
      await assert.rejects(conversion.confirm('qa-switch', q.quoteId), { code: 'QUOTE_CHANGED' });
      assert.equal(await rowsOf('qa-switch'), before);
    });
    await check('an account holding ordinary Balance converts on Balance only; its DemoBalance is never touched', async () => {
      const demoBefore = await demoOf('qa-dual', 'USDT');
      const q = await balanceService.quote('qa-dual', 'USD', 'EUR', '10');
      assert.equal(q.ledger, 'spot');
      const receipt = await balanceService.confirm('qa-dual', q.quoteId);
      assert.equal(receipt.ledger, 'spot');
      const usd = await prisma.balance.findUnique({ where: { userId_asset: { userId: 'qa-dual', asset: 'USD' } } });
      assert.equal(usd.available.toFixed(), '90');
      assert.equal(await demoOf('qa-dual', 'USDT'), demoBefore); assert.equal(await demoOf('qa-dual', 'EUR'), '0');
      // Without a verified reserve the same Balance conversion is refused: demo backing never stands in for one.
      await assert.rejects(conversion.quote('qa-dual', 'USD', 'EUR', '10'), { code: 'RESERVE_UNVERIFIED' });
      await conserved();
    });
    await check('concurrent demo orders and conversions on one balance: never overdrawn, every unit accounted for', async () => {
      const quotes = await Promise.all([0, 1, 2, 3].map(() => conversion.quote('qa-racer', 'USDT', 'BTC', '30')));
      const ops = [
        ...quotes.map(q => () => conversion.confirm('qa-racer', q.quoteId)),
        ...[0, 1, 2].map(() => () => demo.placeOrder({ userId: 'qa-racer', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('50000'), quantity: new BigNumber('0.0006') })),
        () => demo.placeOrder({ userId: 'qa-racer', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.0001') }),
      ];
      const results = await Promise.allSettled(ops.map(op => op()));
      for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'INSUFFICIENT_BALANCE', String(r.reason?.stack || r.reason));
      const converted = results.slice(0, 4).filter(r => r.status === 'fulfilled').length;
      assert(converted <= 3 && results.some(r => r.status === 'rejected'));
      const available = new BigNumber(await demoOf('qa-racer', 'USDT')), locked = new BigNumber(await lockedOf('qa-racer', 'USDT'));
      assert(available.gte(0) && locked.gte(0));
      const open = await prisma.demoOrder.findMany({ where: { userId: 'qa-racer', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
      assert.equal(locked.toFixed(), open.reduce((s, o) => s.plus(new BigNumber(o.price.toFixed()).times(o.remainingQuantity.toFixed())), new BigNumber(0)).toFixed());
      const trades = await prisma.demoTrade.findMany({ where: { OR: [{ makerOrderId: { in: (await prisma.demoOrder.findMany({ where: { userId: 'qa-racer' } })).map(o => o.id) } }] } });
      const takerCost = (await prisma.demoTrade.findMany({ where: { takerUserId: 'qa-racer' } })).reduce((s, t) => s.plus(new BigNumber(t.price.toFixed()).times(t.quantity.toFixed())), new BigNumber(0));
      assert.equal(trades.length, 0); // nothing rested against the racer's own bids
      assert.equal(available.plus(locked).plus(30 * converted).plus(takerCost).toFixed(), '100');
      await conserved();
    });
    await check('concurrent conversions can never take more than the liquidity inventory holds', async () => {
      const amount = new BigNumber(30).times('0.997').div('3001').decimalPlaces(18, BigNumber.ROUND_DOWN);
      await topUp(LIQ, 'ETH', amount.times('2.5').toFixed());
      const quotes = await Promise.all(drains.map(id => conversion.quote(id, 'USDT', 'ETH', '30').catch(error => error)));
      // Quotes beyond the inventory are already refused early; the confirms race for what is left.
      const issued = quotes.filter(q => !(q instanceof Error));
      assert(issued.length >= 2);
      const results = await Promise.allSettled(issued.map(q => conversion.confirm(drains[quotes.indexOf(q)], q.quoteId)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
      for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'INSUFFICIENT_LIQUIDITY');
      assert.equal(await demoOf(LIQ, 'ETH'), amount.times('0.5').toFixed());
      await assert.rejects(conversion.quote(drains[5], 'USDT', 'ETH', '30'), { code: 'INSUFFICIENT_LIQUIDITY' });
      await conserved();
    });
    let doubleQuote, lostQuote, lostReceipt;
    await check('double confirm click: five concurrent confirms of one quote return one identical receipt and debit once', async () => {
      const q = await api('POST', '/wallet/conversion/quote', 'qa-double', { fromAsset: 'USDT', toAsset: 'BTC', amount: '20' });
      assert.equal(q.status, 200); assert.equal(q.body.ledger, 'demo'); doubleQuote = q.body;
      const results = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/wallet/conversion/confirm', 'qa-double', { quoteId: q.body.quoteId })));
      assert(results.every(r => r.status === 200));
      assert(results.every(r => JSON.stringify(r.body) === JSON.stringify(results[0].body)));
      assert.equal(await demoOf('qa-double', 'USDT'), '30');
      assert.equal(await prisma.auditLog.count({ where: { id: `conversion:${q.body.quoteId}` } }), 1);
    });
    await check('lost response: the receipt is recovered, a replay returns the SAME receipt and debits nothing', async () => {
      const q = await api('POST', '/wallet/conversion/quote', 'qa-double', { fromAsset: 'USDT', toAsset: 'EUR', amount: '10' });
      assert.equal(q.status, 200); lostQuote = q.body;
      await assert.rejects(api('POST', '/wallet/conversion/confirm', 'qa-double', { quoteId: q.body.quoteId }, { drop: true }));
      assert.equal(await demoOf('qa-double', 'USDT'), '20');
      const receipt = await api('GET', `/wallet/conversion/receipt/${q.body.quoteId}`, 'qa-double');
      assert.equal(receipt.status, 200); assert.equal(receipt.body.status, 'APPLIED'); assert.equal(receipt.body.ledger, 'demo');
      const replay = await api('POST', '/wallet/conversion/confirm', 'qa-double', { quoteId: q.body.quoteId });
      assert.deepEqual(replay.body, receipt.body); lostReceipt = receipt.body;
      assert.equal(await demoOf('qa-double', 'USDT'), '20');
      assert.equal(await demoOf('qa-double', 'EUR'), new BigNumber(10).times('0.997').div('1.081').decimalPlaces(2, BigNumber.ROUND_DOWN).toFixed());
    });
    await check('the demo result cannot be withdrawn: Balance holds none of it, nothing is filed; a native demo-valued wallet is refused by the guard', async () => {
      const options = await api('GET', '/withdrawals/options', 'qa-tester');
      assert.equal(options.status, 200); assert.equal(options.body.source, 'SPOT'); assert.deepEqual(options.body.assets, []);
      const w = await api('POST', '/withdrawals', 'qa-tester', { asset: 'BTC', network: 'BTC', toAddress: 'bc1qfixtureaddress0000000000000000000000', amount: testerBtc });
      assert.equal(w.status, 400, JSON.stringify(w.body)); assert.match(w.body.error, /Insufficient BTC balance/);
      // The native tester converts too, then tries to withdraw from the Cross wallet valued from DemoBalance.
      const q = await conversion.quote(NATIVE, 'USDT', 'BTC', '50'); await conversion.confirm(NATIVE, q.quoteId);
      const nativeOptions = await api('GET', '/withdrawals/options', NATIVE);
      assert.equal(nativeOptions.body.source, 'TRADING'); assert.deepEqual(nativeOptions.body.assets, []);
      const nw = await api('POST', '/withdrawals', NATIVE, { asset: 'BTC', network: 'BTC', toAddress: 'bc1qfixtureaddress0000000000000000000000', amount: q.toAmount });
      assert.equal(nw.status, 403); assert.equal(nw.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
      assert.equal(await prisma.withdrawal.count(), 0);
      assert.equal(await demoOf('qa-tester', 'BTC'), testerBtc);
    });
    await check('session revocation: quote and confirm are refused at once; nothing moves', async () => {
      const q = await api('POST', '/wallet/conversion/quote', 'qa-revoked', { fromAsset: 'USDT', toAsset: 'BTC', amount: '10' });
      assert.equal(q.status, 200);
      const before = await rowsOf('qa-revoked');
      await prisma.session.update({ where: { id: sessions.get('qa-revoked') }, data: { revokedAt: new Date() } });
      assert.equal((await api('POST', '/wallet/conversion/confirm', 'qa-revoked', { quoteId: q.body.quoteId })).status, 401);
      assert.equal((await api('POST', '/wallet/conversion/quote', 'qa-revoked', { fromAsset: 'USDT', toAsset: 'BTC', amount: '1' })).status, 401);
      assert.equal(await rowsOf('qa-revoked'), before);
      assert.equal(await prisma.auditLog.count({ where: { id: `conversion:${q.body.quoteId}` } }), 0);
    });
    await check('blocked account: a block set after the quote refuses the confirm, and a new quote; nothing moves', async () => {
      const q = await conversion.quote('qa-blocked', 'USDT', 'BTC', '10');
      await prisma.user.update({ where: { id: 'qa-blocked' }, data: { blockedAt: new Date() } });
      const before = await rowsOf('qa-blocked');
      await assert.rejects(conversion.confirm('qa-blocked', q.quoteId), { code: 'ACCOUNT_BLOCKED' });
      const http = await api('POST', '/wallet/conversion/quote', 'qa-blocked', { fromAsset: 'USDT', toAsset: 'BTC', amount: '1' });
      assert.notEqual(http.status, 200);
      assert.equal(await rowsOf('qa-blocked'), before);
    });
    await check('listing and simulation assets never convert into liquid assets, also from the demo ledger', async () => {
      for (const [from, to] of [['VTA', 'BTC'], ['VTA', 'USDT'], ['USDT', 'VTA'], ['USDT', 'NRX'], ['NRX', 'USD']]) {
        await assert.rejects(conversion.quote('qa-admin', from, to, '1'), { code: 'UNSUPPORTED_ASSET' });
      }
      assert(!(await conversion.assets('qa-admin')).some(a => ['VTA', 'NRX'].includes(a.asset)));
      assert.equal(parseConversionAssets('USD:2,VTA:8'), null); assert.equal(parseConversionAssets('USD:2,NRX:8'), null);
      assert.equal(await demoOf('qa-admin', 'VTA'), '10');
    });
    await check('switches: with Demo Liquidity off, or Demo Spot off, demo funds convert nothing; nothing written', async () => {
      const before = await rowsOf('qa-off');
      await assert.rejects(build(prisma, { ...process.env, DEMO_LIQUIDITY_ENABLED: 'false' }).quote('qa-off', 'USDT', 'BTC', '10'), { code: 'INSUFFICIENT_LIQUIDITY' });
      await assert.rejects(build(prisma, { ...process.env, DEMO_SPOT_ENABLED: 'false' }).quote('qa-off', 'USDT', 'BTC', '10'), { code: 'INSUFFICIENT_BALANCE' });
      const q = await conversion.quote('qa-off', 'USDT', 'BTC', '10');
      await assert.rejects(build(prisma, { ...process.env, DEMO_LIQUIDITY_ENABLED: 'false' }).confirm('qa-off', q.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      await assert.rejects(build(prisma, { ...process.env, DEMO_SPOT_ENABLED: 'false' }).confirm('qa-off', q.quoteId), { code: 'QUOTE_CHANGED' });
      assert.equal(await rowsOf('qa-off'), before);
    });
    await check('daily limit counts demo conversions (current setting, here lowered to 100 USD)', async () => {
      const capped = build(prisma, process.env, limits('', '100', '100'));
      for (let i = 0; i < 2; i++) { const q = await capped.quote('qa-daily', 'USDT', 'BTC', '50'); await capped.confirm('qa-daily', q.quoteId); }
      await assert.rejects(capped.quote('qa-daily', 'USDT', 'BTC', '1'), { code: 'DAILY_LIMIT_EXCEEDED' });
      await assert.rejects(capped.quote('qa-daily', 'USDT', 'BTC', '101'), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(await demoOf('qa-daily', 'USDT'), '100');
    });
    await check('stale, changed or missing price at confirm, and an abandoned quote: refused, nothing moves, nothing stays reserved', async () => {
      const before = await rowsOf('qa-stale');
      let q = await conversion.quote('qa-stale', 'USDT', 'BTC', '10');
      const saved = now; now += 15_000;
      await assert.rejects(conversion.confirm('qa-stale', q.quoteId), { code: 'QUOTE_EXPIRED' });
      now = saved;
      q = await conversion.quote('qa-stale', 'USDT', 'BTC', '10');
      feedBook.BTC = ['60000', '60011'];
      await assert.rejects(conversion.confirm('qa-stale', q.quoteId), { code: 'QUOTE_CHANGED' });
      feedBook.BTC = ['60000', '60010'];
      failFeed = true;
      await assert.rejects(conversion.confirm('qa-stale', q.quoteId), { code: 'PRICE_UNAVAILABLE' });
      failFeed = false;
      // An abandoned quote reserved nothing: the full balance is quotable again.
      await conversion.quote('qa-stale', 'USDT', 'BTC', '50');
      assert.equal(await rowsOf('qa-stale'), before);
      assert.equal(await prisma.auditLog.count({ where: { userId: 'qa-stale', action: 'WALLET_DEMO_CONVERTED' } }), 0);
    });
    await check('another account can neither confirm nor read a demo quote or its receipt', async () => {
      const q = await conversion.quote('qa-other', 'USDT', 'BTC', '10');
      const before = await rowsOf('qa-other');
      await assert.rejects(conversion.confirm('qa-roll', q.quoteId), { code: 'QUOTE_NOT_FOUND' });
      assert.equal(await rowsOf('qa-other'), before);
      const receipt = await conversion.confirm('qa-other', q.quoteId);
      assert.equal(await conversion.status('qa-roll', q.quoteId), null);
      assert.equal((await api('GET', `/wallet/conversion/receipt/${q.quoteId}`, 'qa-roll')).body, null);
      assert.deepEqual(await conversion.status('qa-other', q.quoteId), receipt);
    });
    await check('rollback: a failed receipt write undoes all four DemoBalance legs; a short liquidity leg undoes the user debit', async () => {
      const q = await conversion.quote('qa-roll', 'USDT', 'BTC', '10');
      const user = await rowsOf('qa-roll'), liq = await rowsOf(LIQ);
      // A conflicting audit row with the receipt's id makes the receipt insert fail after all four balance writes.
      await prisma.auditLog.create({ data: { id: `conversion:${q.quoteId}`, userId: 'qa-roll', action: 'FIXTURE_CONFLICT', metadata: {} } });
      await assert.rejects(conversion.confirm('qa-roll', q.quoteId), error => error?.code === 'P2002');
      assert.equal(await rowsOf('qa-roll'), user); assert.equal(await rowsOf(LIQ), liq);
      await prisma.auditLog.delete({ where: { id: `conversion:${q.quoteId}` } });
      // Liquidity drained between quote and confirm: the user leg (written first) is rolled back with it.
      const eth = await conversion.quote('qa-roll', 'USDT', 'ETH', '10');
      const inventory = await demoOf(LIQ, 'ETH');
      await prisma.demoBalance.update({ where: { userId_asset: { userId: LIQ, asset: 'ETH' } }, data: { available: '0' } });
      await assert.rejects(conversion.confirm('qa-roll', eth.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      assert.equal(await rowsOf('qa-roll'), user);
      await prisma.demoBalance.update({ where: { userId_asset: { userId: LIQ, asset: 'ETH' } }, data: { available: inventory } });
      await conserved();
      // The original quote still confirms once the conflict is gone: exactly one receipt.
      await conversion.confirm('qa-roll', q.quoteId);
      assert.equal(await demoOf('qa-roll', 'USDT'), '40');
      await conserved();
    });
    await check('rounding to zero and oversized requests are refused before any write', async () => {
      const before = await rowsOf('qa-roll');
      const quotes = () => prisma.auditLog.count({ where: { userId: 'qa-roll', action: 'WALLET_CONVERSION_QUOTED' } });
      const quoted = await quotes();
      await assert.rejects(conversion.quote('qa-roll', 'USDT', 'BTC', '0.000001'), { code: 'INVALID_CONVERSION' });
      await assert.rejects(conversion.quote('qa-roll', 'USDT', 'BTC', '0.0000001'), { code: 'INVALID_CONVERSION' });
      await topUp('qa-roll', 'USDT', '2000');
      await assert.rejects(conversion.quote('qa-roll', 'USDT', 'BTC', '1004'), { code: 'LIMIT_EXCEEDED' }); // 1004 × 0.997 > 1000 USD
      await assert.rejects(conversion.quote('qa-roll', 'USDT', 'BTC', '1000000000000000000'), { code: 'INVALID_CONVERSION' });
      assert.equal(await quotes(), quoted, 'no quote row for a refused request');
      assert.equal(await demoOf('qa-roll', 'USDT'), new BigNumber(JSON.parse(before).demo.find(r => r[0] === 'USDT')[1]).plus(2000).toFixed());
    });
    await check('after a restart (new DB client and service, feed down) history and receipts are intact; a replay debits nothing', async () => {
      restarted = new PrismaClient({ datasources: { db: { url } } });
      failFeed = true;
      const fresh = build(restarted);
      liveApi = walletActivityRouter(restarted, fresh, true);
      assert.deepEqual(await fresh.confirm('qa-double', lostQuote.quoteId), lostReceipt);
      const history = await api('GET', '/wallet/activity', 'qa-double');
      assert.equal(history.status, 200);
      const conversions = history.body.filter(item => item.kind === 'conversion');
      assert.deepEqual(conversions.map(item => [item.id, item.ledger, item.asset, item.amount, item.toAsset]).sort(), [
        [`conversion:${doubleQuote.quoteId}`, 'demo', 'USDT', '-20', 'BTC'], [`conversion:${lostQuote.quoteId}`, 'demo', 'USDT', '-10', 'EUR']].sort());
      assert.equal(history.body.length, 2, 'no previews, top-ups or refusals in the history');
      assert.deepEqual((await api('GET', '/wallet/activity', 'qa-zero')).body, []);
      assert.equal(await demoOf('qa-double', 'USDT'), '20');
      failFeed = false;
    });
    await check('a demo quote that expires, or a block set, while the confirm waits for the demo book lock is refused; nothing moves', async () => {
      // A demo Spot fill (or another conversion) holds the demo book lock: a separate session takes it the same way.
      const holder = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_wallet_demo_conversion_fixture' }); await holder.connect();
      const waiting = async () => (await sql.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n;
      try {
        for (const during of ['expiry', 'block']) {
          now = Date.now();
          const q = await conversion.quote('qa-lockwait', 'USDT', 'BTC', '10');
          const before = await rowsOf('qa-lockwait'), liqBefore = await rowsOf(LIQ);
          await holder.query(`SELECT pg_advisory_lock(hashtextextended('demo-spot-book', 0))`);
          const outcome = conversion.confirm('qa-lockwait', q.quoteId).then(receipt => ({ receipt }), error => ({ error }));
          for (let i = 0; i < 400 && await waiting() === 0; i++) await new Promise(resolve => setTimeout(resolve, 25));
          assert.equal(await waiting(), 1, 'the confirm waits on the demo book lock');
          if (during === 'expiry') now += 15001; else await prisma.user.update({ where: { id: 'qa-lockwait' }, data: { blockedAt: new Date() } });
          await holder.query(`SELECT pg_advisory_unlock(hashtextextended('demo-spot-book', 0))`);
          const { receipt, error } = await outcome;
          assert.equal(error?.code, during === 'expiry' ? 'QUOTE_EXPIRED' : 'ACCOUNT_BLOCKED', `${during}: ${receipt ? 'APPLIED ' + receipt.operationId : error}`);
          assert.equal(await rowsOf('qa-lockwait'), before); assert.equal(await rowsOf(LIQ), liqBefore);
          assert.equal(await prisma.auditLog.count({ where: { id: `conversion:${q.quoteId}` } }), 0);
          await prisma.user.update({ where: { id: 'qa-lockwait' }, data: { blockedAt: null } });
        }
      } finally { await holder.end(); now = Date.now(); }
      await conserved();
    });
    await check('session revoked during a queued confirmation: HTTP funds path rejects before commit', async () => {
      const holder = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_wallet_demo_conversion_fixture' });
      await holder.connect();
      let locked = false;
      try {
        const q = await api('POST', '/wallet/conversion/quote', 'qa-lockwait', { fromAsset: 'USDT', toAsset: 'BTC', amount: '10' });
        assert.equal(q.status, 200);
        const before = await rowsOf('qa-lockwait'), liqBefore = await rowsOf(LIQ);
        await holder.query(`SELECT pg_advisory_lock(hashtextextended('demo-spot-book', 0))`); locked = true;
        const pending = api('POST', '/wallet/conversion/confirm', 'qa-lockwait', { quoteId: q.body.quoteId });
        let waiting = 0;
        for (let i = 0; i < 400; i++) {
          waiting = (await sql.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n;
          if (waiting > 0) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waiting > 0, 'confirm must be blocked on the shared book lock before revocation');
        await prisma.session.update({ where: { id: sessions.get('qa-lockwait') }, data: { revokedAt: new Date() } });
        await holder.query(`SELECT pg_advisory_unlock(hashtextextended('demo-spot-book', 0))`); locked = false;
        const response = await pending;
        assert.equal(response.status, 401, JSON.stringify(response.body));
        assert.equal(response.body.code, 'SESSION_REVOKED');
        assert.equal(await rowsOf('qa-lockwait'), before); assert.equal(await rowsOf(LIQ), liqBefore);
        assert.equal(await prisma.auditLog.count({ where: { id: `conversion:${q.body.quoteId}` } }), 0);
      } finally {
        if (locked) await holder.query(`SELECT pg_advisory_unlock(hashtextextended('demo-spot-book', 0))`);
        await holder.end();
      }
    });
    await check('USD/EUR/USDC demo destinations require available inventory; bid/ask round trips preserve spread and never touch Balance', async () => {
      const actor = 'qa-currency-matrix';
      await prisma.user.create({ data: { id: actor, email: `${actor}@example.invalid`, passwordHash: 'fixture', referralCode: actor, role: 'USER', kycStatus: 'APPROVED' } });
      await topUp(actor, 'USDT', '100');
      const ordinaryBefore = JSON.stringify(await prisma.balance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }));
      for (const destination of ['USD', 'EUR', 'USDC']) {
        const key = { userId_asset: { userId: LIQ, asset: destination } };
        const inventory = await prisma.demoBalance.findUnique({ where: key });
        if (inventory) await prisma.demoBalance.update({ where: key, data: { available: '0', locked: inventory.available.plus(inventory.locked) } });
        const before = await rowsOf(actor);
        await assert.rejects(conversion.quote(actor, 'USDT', destination, '10'), { code: 'INSUFFICIENT_LIQUIDITY' });
        assert.equal(await rowsOf(actor), before);
        if (inventory) await prisma.demoBalance.update({ where: key, data: { available: inventory.available, locked: inventory.locked } });
        else await topUp(LIQ, destination, '100'); // synthetic fixture inventory only
        const start = new BigNumber(await demoOf(actor, 'USDT'));
        const forward = await conversion.quote(actor, 'USDT', destination, '10');
        assert.equal(forward.fee, '0'); assert.equal(forward.pricing, 'bid-ask');
        await conversion.confirm(actor, forward.quoteId);
        const reverse = await conversion.quote(actor, destination, 'USDT', forward.toAmount);
        assert.equal(reverse.fee, '0');
        await conversion.confirm(actor, reverse.quoteId);
        assert(new BigNumber(await demoOf(actor, 'USDT')).lt(start), 'Market spread must survive a zero platform fee');
        assert.equal(await balanceRows(actor), 0);
        await conserved();
      }
      assert.equal(JSON.stringify(await prisma.balance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] })), ordinaryBefore);
    });
    await check('third-party balances unchanged; no demo account holds ordinary Balance; every demo unit accounted for', async () => {
      assert.equal(await rowsOf('qa-third'), thirdBefore);
      for (const who of ['qa-tester', 'qa-racer', 'qa-double', 'qa-revoked', 'qa-blocked', 'qa-daily', 'qa-off', NATIVE, 'qa-admin', ...drains]) assert.equal(await balanceRows(who), 0, who);
      const liq = await prisma.balance.findMany({ where: { userId: LIQ } });
      assert(liq.every(r => r.available.isZero() && r.locked.isZero()));
      assert.equal(await prisma.auditLog.count({ where: { action: 'WALLET_CONVERTED' } }), 1); // the dual account's Balance conversion only
      await conserved();
    });
    await check('no outbound network request', async () => { assert.deepEqual(outbound, []); });
    const summary = { database: 'disposable loopback PostgreSQL', postgresVersion, passed: checks, checks: checks.length, fee: '0',
      demoReceipts: await prisma.auditLog.count({ where: { action: 'WALLET_DEMO_CONVERTED' } }), balanceReceipts: await prisma.auditLog.count({ where: { action: 'WALLET_CONVERTED' } }),
      withdrawals: await prisma.withdrawal.count(), productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2));
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    await restarted?.$disconnect(); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
