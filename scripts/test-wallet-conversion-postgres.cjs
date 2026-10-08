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
const { WalletConversionService } = require('../src/services/WalletConversionService');
const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
const { mutateSpotBalance } = require('../src/services/WalletMutation');
const BigNumber = require('bignumber.js');
const { walletActivityRouter } = require('../src/api/routes/walletActivity');
const express = require('express'), jwt = require('jsonwebtoken');
function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function main() {
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-wallet-conversion-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
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
    const prices = { read: async () => { if (failFeed) throw new Error('fixture outage'); return { fetchedAt: now, values: new Map([['USD', '1'], ['EUR', eurPrice], ['BTC', '60000'], ['USDT', '0.998']]) }; } };
    const conversion = new WalletConversionService(prisma, prices, () => now);
    const snapshot = async () => (await prisma.balance.findMany({ where: { userId: user }, orderBy: { asset: 'asc' } })).map(r => ({ asset: r.asset, available: r.available.toString(), locked: r.locked.toString() }));
    await prisma.balance.create({ data: { userId: user, asset: 'USD', available: '0', locked: '7' } });
    const adjust = new BalanceAdjustmentService(prisma);
    await adjust.adjustOnce({ userId: user, asset: 'USD', amount: '100', reason: 'private fixture reason', performedByAdminId: 'qa-wallet-admin', idempotencyKey: randomUUID() });
    await prisma.auditLog.create({ data: { userId: user, action: 'DEMO_BALANCE_ADJUSTED', metadata: { asset: 'USD', delta: '999999' } } });
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-fixture-drop-response'] === 'yes') res.json = () => { res.socket.destroy(); return res; }; next(); });
    app.use('/api/v1', walletActivityRouter(prisma, conversion));
    if (process.env.WALLET_QA_BROWSER === '1') {
      app.use('/api', (_, res) => res.status(404).json({ code: 'UNEXPECTED_FIXTURE_ROUTE' }));
      app.use(express.static(path.join(root, 'frontend/dist')));
      app.get('*', (_, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
    }
    app.use((error, req, res, next) => res.status(500).json({ code: 'FIXTURE_ERROR' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = async (route, body, actor = user, drop = false, purpose) => {
      const response = await fetch(origin + '/api/v1' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ sub: actor, ...(purpose ? { purpose } : {}) }, process.env.JWT_SECRET) } : {}), 'Content-Type': 'application/json', ...(drop ? { 'X-Fixture-Drop-Response': 'yes' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
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
    await check('fiat to crypto and crypto to fiat preserve exact 18-decimal arithmetic', async () => {
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
      failFeed = true; await assert.rejects(conversion.confirm(user, q.quoteId)); failFeed = false;
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
    if (process.env.WALLET_QA_BROWSER === '1') await require('./qa-wallet-conversion.cjs').run({ origin, token: jwt.sign({ sub: user }, process.env.JWT_SECRET), prisma, user, out });
    const report = { database: 'disposable loopback PostgreSQL', passed: checks, checks: checks.length, fee: '0', finalBalances: await snapshot(), productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
