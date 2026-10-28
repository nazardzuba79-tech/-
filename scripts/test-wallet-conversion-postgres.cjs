/* Real isolated PostgreSQL only. Ignores DATABASE_URL; never starts src/index. */
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('node:assert/strict'), { spawnSync } = require('child_process'), { createRequire } = require('module');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.WALLET_QA_DEPS || 'output/wallet-qa-deps/package.json'));
const out = path.join(root, 'output/wallet-conversion'); fs.mkdirSync(out, { recursive: true });
process.env.JWT_SECRET = 'isolated-wallet-conversion-fixture-only';
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-wallet-conversion-fixture-only';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { WalletConversionService, parseConversionAssets, parseConversionReserves, walletConversionConfig, DEFAULT_CONVERSION_ASSETS } = require('../src/services/WalletConversionService');
const { WithdrawalService } = require('../src/services/WithdrawalService');
const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
const { mutateSpotBalance } = require('../src/services/WalletMutation');
const BigNumber = require('bignumber.js');
const { walletActivityRouter } = require('../src/api/routes/walletActivity');
const express = require('express'), jwt = require('jsonwebtoken');
function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function main() {
  // Linux CI uses the runner's PostgreSQL tools, not an embedded binary linked
  // against obsolete ICU libraries. This is ONLY a binary path: never a DB URL.
  const configuredBin = process.env.WALLET_QA_PG_BIN;
  if (configuredBin) assert(path.isAbsolute(configuredBin), 'PostgreSQL tool directory must be absolute');
  const bin = configuredBin
    ? Object.fromEntries(['initdb', 'pg_ctl'].map(name => [name, path.join(fs.realpathSync(configuredBin), name + (process.platform === 'win32' ? '.exe' : ''))]))
    : qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  for (const name of ['initdb', 'pg_ctl']) assert(fs.statSync(bin[name]).isFile(), `Missing fixture PostgreSQL tool: ${name}`);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-wallet-conversion-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  const socketOptions = process.platform === 'win32' ? '' : ` -k ${path.dirname(dir)}`;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}${socketOptions}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);
  let sql, prisma, server;
  const checks = []; const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await sql.connect();
    await sql.query('CREATE DATABASE voltex_wallet_conversion_fixture'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_wallet_conversion_fixture' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES
      ('qa-wallet-user','wallet@example.invalid','fixture','qa-wallet-user','USER','APPROVED',now(),now()),
      ('qa-wallet-other','other@example.invalid','fixture','qa-wallet-other','USER','APPROVED',now(),now()),
      ('qa-wallet-admin','admin@example.invalid','fixture','qa-wallet-admin','ADMIN','APPROVED',now(),now())`);
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${port}/voltex_wallet_conversion_fixture?connection_limit=16&sslmode=disable` } } });
    const user = 'qa-wallet-user'; let now = Date.now(), failFeed = false, eurPrice = '1.25';
    // USD per unit, [bid, ask]. USDT carries a real spread; SOL is priced by the feed but is NOT on the admission list.
    const book = () => ({ USD: ['1', '1'], EUR: [eurPrice, eurPrice], BTC: ['60000', '60000'], USDT: ['0.997', '0.998'], SOL: ['150', '150.1'] });
    // Book depth near the touch, per 'ASSET:side' (null = unknown); anything not listed is deep.
    const thinBook = {};
    const prices = { read: async () => {
      if (failFeed) throw new Error('fixture outage');
      const entries = Object.entries(book());
      return { fetchedAt: now, bid: new Map(entries.map(([asset, [bid]]) => [asset, bid])), ask: new Map(entries.map(([asset, [, ask]]) => [asset, ask])) };
    }, depth: async (asset, side) => `${asset}:${side}` in thinBook ? thinBook[`${asset}:${side}`] : '1000000000' };
    // Synthetic operator-verified reserves, ample for the checks that are not about them.
    const admitted = parseConversionAssets(DEFAULT_CONVERSION_ASSETS);
    const limits = (reserves, maxUsd = '1000', dailyUsd = '5000', assets = admitted) => ({ maxUsd: new BigNumber(maxUsd), dailyUsd: new BigNumber(dailyUsd), reserves: parseConversionReserves(reserves, assets) });
    const AMPLE = 'USD:1000000,EUR:1000000,USDT:1000000,USDC:1000000,BTC:100,ETH:1000';
    const conversion = new WalletConversionService(prisma, prices, () => now, admitted, limits(AMPLE));
    const fund = async (id, asset, amount) => {
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ($1,$2,'fixture',$1,'USER','APPROVED',now(),now()) ON CONFLICT (id) DO NOTHING`, [id, `${id}@example.invalid`]);
      await adjust.adjustOnce({ userId: id, asset, amount, reason: 'limits fixture', performedByAdminId: 'qa-wallet-admin', idempotencyKey: randomUUID() });
    };
    const balanceOf = async (id, asset) => (await prisma.balance.findUnique({ where: { userId_asset: { userId: id, asset } } }))?.available.toString() ?? '0';
    // Net amount of an asset all conversions have created: credited minus debited.
    const exposure = async asset => new BigNumber((await sql.query(`SELECT (COALESCE(SUM(CASE WHEN metadata->>'toAsset' = $1 THEN (metadata->>'toAmount')::numeric END), 0)
      - COALESCE(SUM(CASE WHEN metadata->>'fromAsset' = $1 THEN (metadata->>'fromAmount')::numeric END), 0))::text AS v FROM "AuditLog" WHERE action = 'WALLET_CONVERTED'`, [asset])).rows[0].v);
    const snapshot = async () => (await prisma.balance.findMany({ where: { userId: user }, orderBy: { asset: 'asc' } })).map(r => ({ asset: r.asset, available: r.available.toString(), locked: r.locked.toString() }));
    await prisma.balance.create({ data: { userId: user, asset: 'USD', available: '0', locked: '7' } });
    const adjust = new BalanceAdjustmentService(prisma);
    await adjust.adjustOnce({ userId: user, asset: 'USD', amount: '100', reason: 'private fixture reason', performedByAdminId: 'qa-wallet-admin', idempotencyKey: randomUUID() });
    await prisma.auditLog.create({ data: { userId: user, action: 'DEMO_BALANCE_ADJUSTED', metadata: { asset: 'USD', delta: '999999' } } });
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-fixture-drop-response'] === 'yes') res.json = () => { res.socket.destroy(); return res; }; next(); });
    // Opt-in fixture remains disposable. Second mount verifies API default OFF.
    app.use('/__wallet_default_off', walletActivityRouter(prisma, conversion));
    // Delegating mount: the browser phase gets a fresh API instance (as after a restart), so the
    // per-user write limit it meets is its own, not the budget the direct checks above used up.
    let liveApi = walletActivityRouter(prisma, conversion, true);
    app.use('/api/v1', (req, res, next) => liveApi(req, res, next));
    if (process.env.WALLET_QA_BROWSER === '1') {
      app.use('/api', (_, res) => res.status(404).json({ code: 'UNEXPECTED_FIXTURE_ROUTE' }));
      // WALLET_QA_DIST: another built bundle, e.g. the default-OFF production-style build.
      const dist = path.resolve(root, process.env.WALLET_QA_DIST || 'frontend/dist');
      app.use(express.static(dist));
      app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
    }
    app.use((error, req, res, next) => res.status(500).json({ code: 'FIXTURE_ERROR' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    // Use an actual durable session for every money-moving HTTP request.
    const primarySessionId = randomUUID();
    await prisma.session.create({ data: { id: primarySessionId, userId: user, lastSeenAt: new Date() } });
    const activeToken = jwt.sign({ sub: user, sid: primarySessionId }, process.env.JWT_SECRET, { expiresIn: '12h' });
    const api = async (route, body, actor = user, drop = false, purpose) => {
      const response = await fetch(origin + '/api/v1' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(actor ? { Authorization: 'Bearer ' + (actor === user && !purpose ? activeToken : jwt.sign({ sub: actor, ...(purpose ? { purpose } : {}) }, process.env.JWT_SECRET, { expiresIn: '12h' })) } : {}), 'Content-Type': 'application/json', ...(drop ? { 'X-Fixture-Drop-Response': 'yes' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    await check('default-OFF conversion denies quote/confirm/receipt without any write', async () => {
      const before = await snapshot();
      const quotesBefore = await prisma.auditLog.count({ where: { userId: user, action: 'WALLET_CONVERSION_QUOTED' } });
      const disabled = async (route, body) => {
        const response = await fetch(origin + '/__wallet_default_off' + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Authorization: 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, body: await response.json() };
      };
      for (const [path, body] of [
        ['/wallet/conversion/availability', undefined],
        ['/wallet/conversion/assets', undefined],
        ['/wallet/conversion/quote', { fromAsset: 'USD', toAsset: 'EUR', amount: '1' }],
        ['/wallet/conversion/confirm', { quoteId: randomUUID() }],
        ['/wallet/conversion/receipt/' + randomUUID(), undefined],
      ]) {
        const result = await disabled(path, body);
        assert.equal(result.status, 404);
        assert.equal(result.body.code, 'NOT_FOUND');
      }
      assert.equal((await disabled('/wallet/activity')).status, 200);
      assert.equal(await prisma.auditLog.count({ where: { userId: user, action: 'WALLET_CONVERSION_QUOTED' } }), quotesBefore);
      assert.deepEqual(await snapshot(), before);
    });
    await check('owner-filtered adjustment history; admin reason/actor and Demo excluded', async () => {
      const result = await api('/wallet/activity'); assert.equal(result.status, 200); assert.equal(result.body.length, 1);
      assert.equal(result.body[0].amount, '100'); assert.equal(result.body[0].kind, 'adjustment');
      assert(!JSON.stringify(result).includes('private fixture reason')); assert(!JSON.stringify(result).includes('qa-wallet-admin'));
      assert.deepEqual((await api('/wallet/activity', undefined, 'qa-wallet-other')).body, []);
    });
    await check('manual credit converts to fiat, one exact zero-fee receipt despite concurrent retries', async () => {
      const before = await snapshot(); const q = await conversion.quote(user, 'USD', 'EUR', '25'); assert.deepEqual(await snapshot(), before);
      const receipts = await Promise.all(Array.from({ length: 12 }, () => conversion.confirm(user, q.quoteId)));
      assert(receipts.every(r => r.operationId === receipts[0].operationId && r.fee === '0' && r.toAmount === '20'));
      assert.equal(await prisma.auditLog.count({ where: { id: receipts[0].operationId } }), 1);
      assert.deepEqual(await snapshot(), [{ asset: 'EUR', available: '20', locked: '0' }, { asset: 'USD', available: '75', locked: '7' }]);
    });
    await check('fiat to crypto and crypto to fiat keep exact decimals at each asset\'s places (BTC 8, USD 2)', async () => {
      const q = await conversion.quote(user, 'EUR', 'BTC', '6'); await conversion.confirm(user, q.quoteId);
      assert.equal((await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'BTC' } } })).available.toString(), '0.000125');
      const reverse = await conversion.quote(user, 'BTC', 'USD', '0.000125'); await conversion.confirm(user, reverse.quoteId);
      assert.equal(reverse.toAmount, '7.5'); assert.equal(reverse.fee, '0');
    });
    await check('distinct quotes cannot double-spend; locked funds survive', async () => {
      const quotes = await Promise.all([conversion.quote(user, 'USD', 'EUR', '70'), conversion.quote(user, 'USD', 'EUR', '70')]);
      const result = await Promise.allSettled(quotes.map(q => conversion.confirm(user, q.quoteId)));
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(result.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_BALANCE');
      const usd = await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USD' } } }); assert.equal(usd.available.toString(), '12.5'); assert.equal(usd.locked.toString(), '7');
    });
    await check('audit insertion failure rolls back BOTH balance legs', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '2'), before = await snapshot();
      await sql.query(`CREATE FUNCTION qa_wallet_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'conversion:${q.quoteId}' THEN RAISE EXCEPTION 'isolated receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_wallet_reject BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION qa_wallet_reject()`);
      await assert.rejects(conversion.confirm(user, q.quoteId)); assert.deepEqual(await snapshot(), before); assert.equal(await conversion.status(user, q.quoteId), null);
      await sql.query('DROP TRIGGER qa_wallet_reject ON "AuditLog"; DROP FUNCTION qa_wallet_reject()');
    });
    await check('destination write failure rolls back source debit', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '2'), before = await snapshot();
      await sql.query(`CREATE FUNCTION qa_wallet_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.asset = 'EUR' THEN RAISE EXCEPTION 'isolated destination failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_wallet_reject BEFORE UPDATE ON "Balance" FOR EACH ROW EXECUTE FUNCTION qa_wallet_reject()`);
      await assert.rejects(conversion.confirm(user, q.quoteId)); assert.deepEqual(await snapshot(), before);
      await sql.query('DROP TRIGGER qa_wallet_reject ON "Balance"; DROP FUNCTION qa_wallet_reject()');
    });
    await check('expiry, changed price, outage, other owner, malformed payload do not mutate', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '1'), before = await snapshot();
      eurPrice = '1.3'; await assert.rejects(conversion.confirm(user, q.quoteId), { code: 'QUOTE_CHANGED' }); eurPrice = '1.25';
      failFeed = true; await assert.rejects(conversion.confirm(user, q.quoteId), { code: 'PRICE_UNAVAILABLE' }); failFeed = false;
      await assert.rejects(conversion.confirm('qa-wallet-other', q.quoteId), { code: 'QUOTE_NOT_FOUND' });
      now += 15001; await assert.rejects(conversion.confirm(user, q.quoteId), { code: 'QUOTE_EXPIRED' }); now = Date.now();
      for (const body of [{ fromAsset: 'USD', toAsset: 'EUR', amount: '1', toAmount: '999' }, { quoteId: q.quoteId, fromAmount: '0' }]) assert.equal((await api(body.fromAsset ? '/wallet/conversion/quote' : '/wallet/conversion/confirm', body)).status, 400);
      assert.deepEqual(await snapshot(), before);
    });
    await check('concurrent credit and reserve use existing atomic writers without lost updates', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '2');
      await Promise.all([conversion.confirm(user, q.quoteId), adjust.adjustOnce({ userId: user, asset: 'USD', amount: '10', reason: 'concurrent fixture credit', performedByAdminId: 'qa-wallet-admin', idempotencyKey: randomUUID() }), prisma.$transaction(tx => mutateSpotBalance(tx, user, 'USD', { available: new BigNumber(-3), locked: new BigNumber(3) }))]);
      const usd = await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USD' } } }); assert.equal(usd.available.toString(), '17.5'); assert.equal(usd.locked.toString(), '10');
    });
    await check('lost response recovers SAME receipt without provider or second debit', async () => {
      const q = (await api('/wallet/conversion/quote', { fromAsset: 'USD', toAsset: 'EUR', amount: '1' })).body;
      await assert.rejects(api('/wallet/conversion/confirm', { quoteId: q.quoteId }, user, true));
      const before = await snapshot(); failFeed = true;
      const receipt = await api('/wallet/conversion/receipt/' + q.quoteId); assert.equal(receipt.body.status, 'APPLIED');
      const retry = await api('/wallet/conversion/confirm', { quoteId: q.quoteId }); assert.deepEqual(retry.body, receipt.body);
      assert.equal((await api('/wallet/conversion/receipt/' + q.quoteId, undefined, 'qa-wallet-other')).body, null);
      assert.deepEqual(await snapshot(), before); failFeed = false;
    });
    await check('as after a restart (new service instance and DB client, feed down) the receipt is read back and a replay debits nothing', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '1'); const first = await conversion.confirm(user, q.quoteId);
      const before = await snapshot();
      const restarted = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${port}/voltex_wallet_conversion_fixture?connection_limit=4&sslmode=disable` } } });
      try {
        const fresh = new WalletConversionService(restarted, { read: async () => { throw new Error('feed down after restart'); }, depth: async () => { throw new Error('feed down after restart'); } }, () => now, admitted, limits(AMPLE));
        assert.deepEqual(await fresh.status(user, q.quoteId), first);
        assert.deepEqual(await fresh.confirm(user, q.quoteId), first);
        assert.equal(await fresh.status('qa-wallet-other', q.quoteId), null);
      } finally { await restarted.$disconnect(); }
      assert.deepEqual(await snapshot(), before);
    });
    await check('anonymous, deleted, revoked-session and pending-2FA identities denied', async () => {
      assert.equal((await api('/wallet/activity', undefined, null)).status, 401);
      assert.equal((await api('/wallet/activity', undefined, 'deleted-fixture')).status, 401);
      assert.equal((await api('/wallet/conversion/assets', undefined, user, false, '2fa')).status, 401);
      await prisma.session.create({ data: { id: 'revoked-fixture', userId: user, lastSeenAt: new Date(), revokedAt: new Date() } });
      const token = jwt.sign({ sub: user, sid: 'revoked-fixture' }, process.env.JWT_SECRET);
      assert.equal((await fetch(origin + '/api/v1/wallet/activity', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
    });
    await check('history contains each durable conversion once, never previews or reserve activity', async () => {
      const history = (await api('/wallet/activity')).body;
      assert.equal(history.filter(r => r.kind === 'conversion').length, await prisma.auditLog.count({ where: { userId: user, action: 'WALLET_CONVERTED' } }));
      assert(history.every(r => r.kind === 'adjustment' || (r.kind === 'conversion' && new BigNumber(r.amount).lt(0) && new BigNumber(r.toAmount).gt(0))));
    });
    await check('concurrent expiry cannot report rejection while original receipt is committing', async () => {
      const q = await conversion.quote(user, 'USD', 'EUR', '0.5');
      let entered, release;
      const reached = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
      let paused = false;
      prisma.$use(async (params, next) => {
        if (!paused && params.model === 'AuditLog' && params.action === 'create' && params.args.data.id === 'conversion:' + q.quoteId) { paused = true; entered(); await gate; }
        return next(params);
      });
      const first = conversion.confirm(user, q.quoteId); await reached;
      now += 15001; const second = conversion.confirm(user, q.quoteId); release();
      const [a, b] = await Promise.all([first, second]); assert.equal(a.operationId, b.operationId);
      assert.equal(await prisma.auditLog.count({ where: { id: a.operationId } }), 1); now = Date.now();
    });
    await check('availability offers Convert only where the server accepts it: verified reserve, unblocked account', async () => {
      assert.deepEqual((await api('/wallet/conversion/availability')).body, { convertible: true, ledger: 'spot' });
      assert.deepEqual(await new WalletConversionService(prisma, prices, () => now, admitted, limits('')).availability(user), { convertible: false, ledger: 'spot' });
      await prisma.user.update({ where: { id: user }, data: { blockedAt: new Date() } });
      try { assert.deepEqual((await api('/wallet/conversion/availability')).body, { convertible: false, ledger: 'spot' }); }
      finally { await prisma.user.update({ where: { id: user }, data: { blockedAt: null } }); }
    });
    await check('an admin block refuses the quote, and a block set after the quote refuses the confirmation; nothing moves', async () => {
      const before = await snapshot();
      await prisma.user.update({ where: { id: user }, data: { blockedAt: new Date() } });
      await assert.rejects(conversion.quote(user, 'USD', 'EUR', '1'), { code: 'ACCOUNT_BLOCKED' });
      assert.equal((await api('/wallet/conversion/quote', { fromAsset: 'USD', toAsset: 'EUR', amount: '1' })).status, 403);
      await prisma.user.update({ where: { id: user }, data: { blockedAt: null } });
      const q = await conversion.quote(user, 'USD', 'EUR', '1');
      await prisma.user.update({ where: { id: user }, data: { blockedAt: new Date() } });
      await assert.rejects(conversion.confirm(user, q.quoteId), { code: 'ACCOUNT_BLOCKED' });
      await prisma.user.update({ where: { id: user }, data: { blockedAt: null } });
      assert.deepEqual(await snapshot(), before);
      assert.equal(await conversion.status(user, q.quoteId), null);
    });
    await check('admission: a feed-priced asset off the list is refused at quote AND at confirm (list changed by a restart)', async () => {
      const before = await snapshot();
      await assert.rejects(conversion.quote(user, 'USD', 'SOL', '1'), { code: 'UNSUPPORTED_ASSET' });
      const widerAssets = parseConversionAssets(DEFAULT_CONVERSION_ASSETS + ',SOL:9');
      const wider = new WalletConversionService(prisma, prices, () => now, widerAssets, limits(AMPLE + ',SOL:1000', '1000', '5000', widerAssets));
      const q = await wider.quote(user, 'USD', 'SOL', '1.5');
      await assert.rejects(conversion.confirm(user, q.quoteId), { code: 'UNSUPPORTED_ASSET' });
      assert.deepEqual(await snapshot(), before);
      for (const asset of ['NRX', 'VTA', 'AITH']) await assert.rejects(conversion.quote(user, asset, 'USD', '1'), { code: 'UNSUPPORTED_ASSET' });
      await assert.rejects(conversion.quote(user, 'USD', 'EUR', '0.001'), { code: 'INVALID_CONVERSION' }); // a tenth of a cent
    });
    await check('0% fee keeps the market spread: a USD→USDT→USD round trip on the ledger returns less, never more', async () => {
      const usd = async () => new BigNumber((await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USD' } } })).available.toString());
      const start = await usd();
      const there = await conversion.quote(user, 'USD', 'USDT', '5'); await conversion.confirm(user, there.quoteId); // bought at the 0.998 ask
      assert.equal(there.toAmount, '5.01002');
      const back = await conversion.quote(user, 'USDT', 'USD', there.toAmount); await conversion.confirm(user, back.quoteId); // sold at the 0.997 bid
      assert.equal(back.toAmount, '4.99');
      assert((await usd()).lt(start), 'a round trip created money');
      assert.equal((await usd()).toFixed(), start.minus('0.01').toFixed());
    });
    await check('DemoBalance never funds a conversion and is never touched by one', async () => {
      await prisma.demoBalance.create({ data: { userId: user, asset: 'USDT', available: '1000', locked: '0' } });
      const demo = async () => JSON.stringify(await prisma.demoBalance.findMany({ where: { userId: user } }));
      const demoBefore = await demo();
      await assert.rejects(conversion.quote(user, 'USDT', 'USD', '10'), { code: 'INSUFFICIENT_BALANCE' }); // no REAL USDT
      const q = await conversion.quote(user, 'USD', 'USDT', '2'); await conversion.confirm(user, q.quoteId);
      assert.equal(await demo(), demoBefore);
    });
    await check('withdrawals and many conversions race on one balance: never overdrawn, every unit accounted for', async () => {
      await adjust.adjustOnce({ userId: user, asset: 'USDT', amount: '100', reason: 'race fixture', performedByAdminId: 'qa-wallet-admin', idempotencyKey: randomUUID() });
      const start = await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USDT' } } });
      const startUsd = (await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USD' } } })).available.toString();
      const quotes = await Promise.all(Array.from({ length: 10 }, () => conversion.quote(user, 'USDT', 'USD', '15')));
      const withdrawals = new WithdrawalService(prisma);
      const results = await Promise.allSettled([
        ...quotes.map(q => conversion.confirm(user, q.quoteId)),
        ...[1, 2, 3].map(() => withdrawals.requestWithdrawal({ userId: user, asset: 'USDT', network: 'fixture', toAddress: 'fixture-address', amount: '30' })),
      ]);
      const converted = results.slice(0, 10).filter(r => r.status === 'fulfilled').map(r => r.value);
      const withdrawn = results.slice(10).filter(r => r.status === 'fulfilled').length;
      for (const r of results.filter(r => r.status === 'rejected')) assert.match(String(r.reason.code || r.reason.message), /INSUFFICIENT_BALANCE|Insufficient USDT balance/);
      const usdt = await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USDT' } } });
      const usd = await prisma.balance.findUnique({ where: { userId_asset: { userId: user, asset: 'USD' } } });
      assert(new BigNumber(usdt.available.toString()).gte(0));
      const spent = new BigNumber(15).times(converted.length).plus(new BigNumber(30).times(withdrawn));
      assert.equal(new BigNumber(start.available.toString()).minus(spent).toFixed(), new BigNumber(usdt.available.toString()).toFixed());
      assert.equal(new BigNumber(start.locked.toString()).plus(30 * withdrawn).toFixed(), new BigNumber(usdt.locked.toString()).toFixed());
      const credited = converted.reduce((sum, r) => sum.plus(r.toAmount), new BigNumber(0));
      assert.equal(new BigNumber(startUsd).plus(credited).toFixed(), new BigNumber(usd.available.toString()).toFixed());
      assert(converted.length + withdrawn > 0 && spent.lte(100), `spent ${spent.toFixed()} of 100`);
      assert.equal(await prisma.auditLog.count({ where: { userId: user, action: 'WALLET_CONVERTED', id: { in: quotes.map(q => 'conversion:' + q.quoteId) } } }), converted.length);
    });
    await check('an account without owner/admin-issued funds converts nothing: refused before any write, nothing granted', async () => {
      const unfunded = 'qa-wallet-unfunded';
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ('${unfunded}','unfunded@example.invalid','fixture','${unfunded}','USER','APPROVED',now(),now())`);
      const listed = await api('/wallet/conversion/assets', undefined, unfunded);
      assert.equal(listed.status, 200); assert(listed.body.length > 0 && listed.body.every(a => a.available === '0'));
      for (const [fromAsset, toAsset] of [['USD', 'EUR'], ['USDT', 'BTC'], ['BTC', 'USD']]) {
        const refused = await api('/wallet/conversion/quote', { fromAsset, toAsset, amount: '1' }, unfunded);
        assert.equal(refused.status, 409); assert.equal(refused.body.code, 'INSUFFICIENT_BALANCE');
      }
      assert.equal(await prisma.balance.count({ where: { userId: unfunded } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { userId: unfunded } }), 0);
    });

    await check('default limits: with no operator-verified reserve configured, every destination is refused before any write', async () => {
      const defaults = walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true' });
      assert.equal(defaults.limits.reserves.size, 0);
      const unconfigured = new WalletConversionService(prisma, prices, () => now, defaults.assets, defaults.limits);
      const before = await snapshot(), quotes = await prisma.auditLog.count({ where: { userId: user } });
      for (const [fromAsset, toAsset] of [['USD', 'EUR'], ['USD', 'BTC'], ['USD', 'USDT'], ['EUR', 'USD']]) {
        await assert.rejects(unconfigured.quote(user, fromAsset, toAsset, '1'), { code: 'RESERVE_UNVERIFIED' });
      }
      assert.deepEqual(await snapshot(), before);
      assert.equal(await prisma.auditLog.count({ where: { userId: user } }), quotes);
    });
    await check('single-conversion limit: refused at quote, and at confirm when the limit was lowered after the quote; nothing moves', async () => {
      const big = 'qa-wallet-limit'; await fund(big, 'USD', '3000');
      const result = await api('/wallet/conversion/quote', { fromAsset: 'USD', toAsset: 'EUR', amount: '1000.01' }, big);
      assert.equal(result.status, 409); assert.equal(result.body.code, 'LIMIT_EXCEEDED');
      const q = await conversion.quote(big, 'USD', 'EUR', '600');
      const lowered = new WalletConversionService(prisma, prices, () => now, admitted, limits(AMPLE, '500'));
      await assert.rejects(lowered.confirm(big, q.quoteId), { code: 'LIMIT_EXCEEDED' });
      assert.equal(await balanceOf(big, 'USD'), '3000'); assert.equal(await balanceOf(big, 'EUR'), '0');
      assert.equal(await conversion.status(big, q.quoteId), null);
    });
    await check('daily limit: rolling 24 hours, and it holds under concurrent confirms of quotes that each fit alone', async () => {
      const daily = 'qa-wallet-daily'; await fund(daily, 'USD', '1000');
      // Earlier receipts written the way Prisma writes them: 25 h ago no longer counts, 23 h ago still does.
      for (const [hours, amount] of [[25, '900'], [23, '50']]) {
        await prisma.auditLog.create({ data: { id: `conversion:${randomUUID()}`, userId: daily, action: 'WALLET_CONVERTED', createdAt: new Date(now - hours * 3_600_000),
          metadata: { fromAsset: 'USD', toAsset: 'EUR', fromAmount: amount, toAmount: '0', fromPriceUsd: '1', toPriceUsd: '1.25' } } });
      }
      const capped = new WalletConversionService(prisma, prices, () => now, admitted, limits(AMPLE, '100', '250'));
      const quotes = await Promise.all(Array.from({ length: 6 }, () => capped.quote(daily, 'USD', 'EUR', '100')));
      const results = await Promise.allSettled(quotes.map(q => capped.confirm(daily, q.quoteId)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
      for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'DAILY_LIMIT_EXCEEDED');
      assert.equal(await balanceOf(daily, 'USD'), '800'); assert.equal(await balanceOf(daily, 'EUR'), '160');
      await assert.rejects(capped.quote(daily, 'USD', 'EUR', '1'), { code: 'DAILY_LIMIT_EXCEEDED' }); // 50 + 200 = 250 used
      // Another account is not counted against this one.
      const other = 'qa-wallet-daily-2'; await fund(other, 'USD', '200');
      const own = await capped.quote(other, 'USD', 'EUR', '100'); await capped.confirm(other, own.quoteId);
      assert.equal(await balanceOf(other, 'EUR'), '80');
    });
    await check('reserve: many accounts converting into BTC at once can never jointly exceed its verified reserve', async () => {
      const users = Array.from({ length: 8 }, (_, i) => `qa-wallet-reserve-${i}`);
      for (const id of users) await fund(id, 'USD', '100');
      const reserve = (await exposure('BTC')).plus('0.001'); // room for exactly 2.5 conversions of 0.0004 BTC
      const capped = new WalletConversionService(prisma, prices, () => now, admitted, limits(`${AMPLE.replace('BTC:100', 'BTC:' + reserve.toFixed())}`));
      const quotes = await Promise.all(users.map(id => capped.quote(id, 'USD', 'BTC', '24')));
      assert(quotes.every(q => q.toAmount === '0.0004'));
      const results = await Promise.allSettled(quotes.map((q, i) => capped.confirm(users[i], q.quoteId)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
      for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'RESERVE_EXHAUSTED');
      assert((await exposure('BTC')).lte(reserve));
      assert.equal((await exposure('BTC')).toFixed(), reserve.minus('0.0002').toFixed());
      const credited = (await Promise.all(users.map(id => balanceOf(id, 'BTC')))).filter(v => v !== '0');
      assert.deepEqual(credited, ['0.0004', '0.0004']);
      // Selling BTC back frees the same reserve for others.
      const winner = users[results.findIndex(r => r.status === 'fulfilled')];
      const back = await capped.quote(winner, 'BTC', 'USD', '0.0004'); await capped.confirm(winner, back.quoteId);
      const loser = users[results.findIndex(r => r.status === 'rejected')];
      const again = await capped.quote(loser, 'USD', 'BTC', '24'); await capped.confirm(loser, again.quoteId);
      assert.equal(await balanceOf(loser, 'BTC'), '0.0004');
    });
    await check('liquidity: a thin book refuses the quote, and a book that thins after the quote refuses the confirm; nothing moves', async () => {
      const thin = 'qa-wallet-thin'; await fund(thin, 'USD', '500');
      thinBook['BTC:ask'] = '0.001';
      await assert.rejects(conversion.quote(thin, 'USD', 'BTC', '120'), { code: 'INSUFFICIENT_LIQUIDITY' }); // 0.002 BTC wanted
      const q = await conversion.quote(thin, 'USD', 'BTC', '60');
      thinBook['BTC:ask'] = '0.0005';
      await assert.rejects(conversion.confirm(thin, q.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      thinBook['BTC:ask'] = null; // depth unknown
      await assert.rejects(conversion.confirm(thin, q.quoteId), { code: 'INSUFFICIENT_LIQUIDITY' });
      delete thinBook['BTC:ask'];
      assert.equal(await balanceOf(thin, 'USD'), '500'); assert.equal(await balanceOf(thin, 'BTC'), '0');
      const ok = await conversion.confirm(thin, q.quoteId); assert.equal(ok.toAmount, '0.001');
      // A receipt once committed is returned even when the book later empties (lost-response recovery).
      thinBook['BTC:ask'] = null; assert.deepEqual(await conversion.confirm(thin, q.quoteId), ok); delete thinBook['BTC:ask'];
    });
    await check('a quote that expires, or a block set, while the confirm waits for the shared reserve lock is refused; nothing moves', async () => {
      const waiter = 'qa-wallet-lockwait'; await fund(waiter, 'USD', '10');
      // Another account's confirm holds the shared lock: a separate session takes it, as a committing conversion would.
      const holder = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_wallet_conversion_fixture' }); await holder.connect();
      const waiting = async () => (await sql.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n;
      try {
        for (const during of ['expiry', 'block']) {
          now = Date.now();
          const q = await conversion.quote(waiter, 'USD', 'EUR', '1');
          const before = JSON.stringify(await prisma.balance.findMany({ where: { userId: waiter }, orderBy: { asset: 'asc' } }));
          await holder.query(`SELECT pg_advisory_lock(hashtextextended('wallet-conversion:reserves', 0))`);
          const outcome = conversion.confirm(waiter, q.quoteId).then(receipt => ({ receipt }), error => ({ error }));
          for (let i = 0; i < 400 && await waiting() === 0; i++) await new Promise(resolve => setTimeout(resolve, 25));
          assert.equal(await waiting(), 1, 'the confirm waits on the shared lock');
          if (during === 'expiry') now += 15001; else await prisma.user.update({ where: { id: waiter }, data: { blockedAt: new Date() } });
          await holder.query(`SELECT pg_advisory_unlock(hashtextextended('wallet-conversion:reserves', 0))`);
          const { receipt, error } = await outcome;
          assert.equal(error?.code, during === 'expiry' ? 'QUOTE_EXPIRED' : 'ACCOUNT_BLOCKED', `${during}: ${receipt ? 'APPLIED ' + receipt.operationId : error}`);
          assert.equal(JSON.stringify(await prisma.balance.findMany({ where: { userId: waiter }, orderBy: { asset: 'asc' } })), before);
          assert.equal(await prisma.auditLog.count({ where: { id: `conversion:${q.quoteId}` } }), 0);
          await prisma.user.update({ where: { id: waiter }, data: { blockedAt: null } });
        }
      } finally { await holder.end(); now = Date.now(); }
    });
    if (process.env.WALLET_QA_BROWSER === '1') liveApi = walletActivityRouter(prisma, conversion, true);
    if (process.env.WALLET_QA_BROWSER === '1') await require('./qa-wallet-conversion.cjs').run({ origin, token: activeToken, prisma, user, out, thinBook, fund });
    const report = { database: 'disposable loopback PostgreSQL', passed: checks, checks: checks.length, fee: '0', finalBalances: await snapshot(), productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
