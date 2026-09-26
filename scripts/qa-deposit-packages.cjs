/** Deposit packages acceptance — REAL PostgreSQL, the compiled production
 * routers/services (dist/), and a deterministic LOCAL TronGrid fixture.
 * It never reads DATABASE_URL, never contacts TronGrid or production, and
 * moves no real funds. A pass here is not proof of a production deposit.
 *
 * Database: QA_PG_ADMIN_URL (an existing disposable local server; a fresh
 * database is created and dropped) or an embedded-postgres cluster from
 * node_modules/.cache/deposit-qa (CI).  Build first: npm run build.
 * Usage: node scripts/qa-deposit-packages.cjs [--browser]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');

const qaRequire = createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));
const output = path.resolve('output/deposit-packages');
fs.mkdirSync(output, { recursive: true });

const TREASURY = '41' + '11'.repeat(20);
const TREASURY_2 = '41' + '44'.repeat(20);
const OTHER = '41' + '22'.repeat(20);
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const FAKE_TOKEN_HEX = '33'.repeat(20);
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ADMIN = '00000000-0000-4000-8000-00000000000a';
const ADMIN_2 = '00000000-0000-4000-8000-00000000000b';
const REFERRER = '00000000-0000-4000-8000-00000000000c';
const WATCHER_TOKEN = 'qa-watcher-token-' + 'x'.repeat(40);
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (n) => BigInt(n).toString(16).padStart(64, '0');
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

async function startDatabase() {
  if (process.env.QA_PG_ADMIN_URL) {
    const { Client } = require(require.resolve('pg', { paths: [path.resolve('node_modules/.cache/deposit-qa'), process.cwd()] }));
    const name = `voltex_deposit_qa_${process.pid}_${Date.now()}`;
    const admin = new Client({ connectionString: process.env.QA_PG_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.QA_PG_ADMIN_URL); url.pathname = `/${name}`;
    const db = new Client({ connectionString: url.toString() });
    await db.connect();
    return { url: url.toString(), db, stop: async () => { await db.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); } };
  }
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const bin = qaRequire(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const scratch = process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Temp') : os.tmpdir();
  const dataDir = path.join(fs.mkdtempSync(path.join(scratch, 'voltex-deposit-qa-')), 'data');
  const init = spawnSync(bin.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const logFile = path.join(output, 'postgres.log');
  const controlLog = path.join(output, 'pg-ctl.log');
  const fd = fs.openSync(controlLog, 'w');
  let start;
  try { start = spawnSync(bin.pg_ctl, ['-D', dataDir, '-l', logFile, '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], { windowsHide: true, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  assert.equal(start.status, 0, fs.readFileSync(controlLog, 'utf8'));
  const db = new (qaRequire('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await db.connect();
  return { url: `postgresql://postgres@127.0.0.1:${port}/postgres`, db, stop: async () => {
    await db.end();
    const stop = spawnSync(bin.pg_ctl, ['-D', dataDir, 'stop', '-m', 'fast', '-w'], { windowsHide: true, encoding: 'utf8' });
    assert.equal(stop.status, 0, stop.stderr);
  } };
}

/** Local TronGrid: listings (paged, time-bounded), node tx info (solidity +
 * full), chain head. Every behaviour a test needs is a switch here. */
/** Simulated wall clock for the watcher: each scan is "5 minutes later". */
const clock = { t: Date.now() };

function tronFixture() {
  const state = { head: 100_000, txs: new Map(), outage: false, rateLimited: false, malformedList: false, failAfterCalls: null, calls: [], seq: 0, nowMs: Date.now() };
  const norm = (a) => String(a).toLowerCase().replace(/^0x/, '').replace(/^41(?=[0-9a-f]{40}$)/, '');
  const b58 = { [USDT]: USDT_HEX };
  const toHex = (a) => (b58[a] ?? norm(a));
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    state.calls.push(req.path);
    if (state.failAfterCalls !== null && state.calls.length > state.failAfterCalls) return res.status(503).json({ error: 'fixture outage' });
    if (state.outage) return res.status(503).json({ error: 'fixture outage' });
    if (state.rateLimited) return res.set('Retry-After', '120').status(429).json({ error: 'rate limited' });
    next();
  });
  app.get('/v1/accounts/:address/transactions/trc20', (req, res) => {
    if (state.malformedList) return res.json({ success: true, data: [{ transaction_id: 'not-a-hash', to: req.params.address, value: '1', block_timestamp: 1 }] });
    const q = req.query; const limit = Number(q.limit ?? 20);
    let items = [...state.txs.values()].filter((t) => t.block <= state.head && norm(t.listTo ?? t.to) === norm(req.params.address)
      && toHex(t.listContract ?? t.contract) === toHex(q.contract_address));
    if (q.min_timestamp) items = items.filter((t) => t.ts >= Number(q.min_timestamp));
    if (q.max_timestamp) items = items.filter((t) => t.ts <= Number(q.max_timestamp));
    items.sort((a, b) => (q.order_by === 'block_timestamp,asc' ? a.ts - b.ts || a.seq - b.seq : b.ts - a.ts || b.seq - a.seq));
    const offset = q.fingerprint ? Number(Buffer.from(String(q.fingerprint), 'base64').toString()) : 0;
    const page = items.slice(offset, offset + limit);
    // One listing item per Transfer log to this address (several per tx possible).
    const data = page.flatMap((t) => (t.listTo ? [{ ...t.logs[0], to: t.listTo }] : t.logs.filter((l) => norm(l.to) === norm(req.params.address))).map((l) => ({
      transaction_id: t.id, to: req.params.address, value: l.value, block_timestamp: t.ts, token_info: { address: USDT, decimals: 6 } })));
    res.json({ success: true, data, meta: offset + limit < items.length ? { fingerprint: Buffer.from(String(offset + limit)).toString('base64') } : {} });
  });
  const info = (solidity) => (req, res) => {
    const t = state.txs.get(String(req.body?.value ?? '').toLowerCase());
    if (!t || t.block > state.head || t.dropped || (solidity && !t.solidified)) return res.json({});
    res.json({ id: t.id, blockNumber: t.block, blockTimeStamp: t.ts, ...(t.success ? {} : { result: 'FAILED' }),
      receipt: { result: t.success ? 'SUCCESS' : 'REVERT' },
      log: t.logs.map((l) => ({ address: l.contractHex ?? USDT_HEX, topics: [TRANSFER_TOPIC, '0'.repeat(24) + '55'.repeat(20), '0'.repeat(24) + norm(l.to)],
        data: BigInt(l.value).toString(16).padStart(64, '0') })) });
  };
  app.post('/walletsolidity/gettransactioninfobyid', info(true));
  app.post('/wallet/gettransactioninfobyid', info(false));
  app.get('/wallet/getnowblock', (_req, res) => res.json({ block_header: { raw_data: { number: state.head } } }));
  /** A confirmed USDT transfer (default: to TREASURY, 30 blocks deep, solidified). */
  function send(n, amount, o = {}) {
    const raw = new BigNumber(amount).shiftedBy(6).toFixed(0);
    const t = { id: hash(n), seq: state.seq++, to: o.to ?? TREASURY, contract: USDT, block: o.block ?? state.head - 30,
      // A new transfer happens "now" (just older than the watcher's safety lag).
      ts: o.ts ?? clock.t - 3 * 60_000 + state.seq, success: o.success ?? true, solidified: o.solidified ?? true,
      listTo: o.listTo, listContract: o.listContract,
      logs: o.logs ?? [{ to: o.to ?? TREASURY, value: raw, contractHex: o.contractHex }] };
    state.txs.set(t.id, t);
    return t.id;
  }
  return { app, state, send };
}

async function main() {
  const report = { scope: 'Disposable PostgreSQL + synthetic local TronGrid fixture. Not a production deposit.', checks: [], measurements: {}, browser: [] };
  const test = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  const database = await startDatabase();
  const { db } = database;
  let prisma, chainServer, appServer, browser;
  try {
    for (const dir of fs.readdirSync('prisma/migrations').sort()) {
      const file = path.join('prisma/migrations', dir, 'migration.sql');
      if (fs.existsSync(file)) await db.query(fs.readFileSync(file, 'utf8'));
    }
    const sqlLog = [];
    prisma = new PrismaClient({ datasources: { db: { url: `${database.url}?connection_limit=16` } }, log: [{ emit: 'event', level: 'query' }] });
    prisma.$on('query', (e) => sqlLog.push(e.query));

    const fixture = tronFixture();
    chainServer = await listen(fixture.app);
    for (const name of Object.keys(process.env)) if (/^(ETHEREUM|BSC|POLYGON|ARBITRUM|AVALANCHE|BITCOIN|SOLANA|TON|TRON)_/.test(name)) delete process.env[name];
    Object.assign(process.env, {
      JWT_SECRET: 'isolated-deposit-qa-not-a-production-secret', API_KEY_ENCRYPTION_SECRET: 'ab'.repeat(32), DEPOSIT_WATCHER_TOKEN: WATCHER_TOKEN, DEPOSIT_WATCHER_SCHEDULE: 'off',
      TRON_NATIVE_ASSET: 'TRX', TRON_TREASURY_ADDRESS: TREASURY, TRON_TOKENS: `USDT:${USDT}:6`,
      TRON_API_URL: `http://127.0.0.1:${chainServer.address().port}`, TRON_MIN_CONFIRMATIONS: '19',
    });
    const { adminDepositsRouter } = require('../dist/api/routes/adminDeposits');
    const { depositsRouter } = require('../dist/api/routes/deposits');
    const { balancesRouter } = require('../dist/api/routes/balances');
    const { depositWatchInternalRouter } = require('../dist/api/routes/depositWatchInternal');
    const { DepositWatchService } = require('../dist/services/deposits/DepositWatchService');
    const { DepositWatchScheduler } = require('../dist/services/deposits/DepositWatchScheduler');
    const { TreasuryWalletService } = require('../dist/services/TreasuryWalletService');

    const treasury = new TreasuryWalletService(prisma);
    const resolveChain = (c) => treasury.resolve(c);
    const limits = { pageSize: 10, maxPagesPerRun: 3, initialBackfillMs: 2 * 60 * 60_000, maxWindowMs: 24 * 60 * 60_000 };
    const watch = new DepositWatchService(prisma, resolveChain, fetch, () => clock.t, limits);
    const prices = { getTicker: async () => null };
    const app = express(); app.use(express.json());
    app.use('/api/v1', depositWatchInternalRouter(watch), adminDepositsRouter(prisma, prices, { watch }), depositsRouter(prisma, prices), balancesRouter(prisma));
    const auth = (id) => 'Bearer ' + jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const as = (id) => ({
      get: (p) => request(app).get('/api/v1' + p).set('Authorization', auth(id)),
      post: (p, body = {}) => request(app).post('/api/v1' + p).set('Authorization', auth(id)).send(body),
    });
    const admin = as(ADMIN);

    const users = {};
    let userSeq = 1;
    async function makeUser(label, extra = {}) {
      const id = uid(userSeq++);
      await prisma.user.create({ data: { id, email: `${label}@deposit.invalid`, role: 'USER', passwordHash: 'not-a-login', referralCode: `qa-${id}`, ...extra } });
      users[label] = id; return id;
    }
    await prisma.user.create({ data: { id: ADMIN, email: 'admin@deposit.invalid', role: 'ADMIN', passwordHash: 'not-a-login', referralCode: 'qa-admin' } });
    await prisma.user.create({ data: { id: ADMIN_2, email: 'admin2@deposit.invalid', role: 'ADMIN', passwordHash: 'not-a-login', referralCode: 'qa-admin-2' } });
    await prisma.user.create({ data: { id: REFERRER, email: 'referrer@deposit.invalid', role: 'USER', passwordHash: 'not-a-login', referralCode: 'qa-ref' } });

    const balance = async (userId, asset = 'USDT') => (await prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } }))?.available.toString() ?? '0';
    const row = (n) => prisma.deposit.findUniqueOrThrow({ where: { chain_txHash: { chain: 'tron', txHash: hash(n) } } });
    const scan = async () => { clock.t += 5 * 60_000; const r = await admin.post('/admin/deposit-watch/run'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
    const attribute = async (n, userId, reassign = false) => admin.post(`/admin/deposits/${(await row(n)).id}/attribute`, { userId, reassign });
    const pkgOf = async (userId) => (await admin.get('/admin/deposit-queue')).body.packages.find((p) => p.userId === userId && p.asset === 'USDT');
    const preview = async (userId) => { const r = await admin.get(`/admin/deposit-packages/preview?userId=${userId}&chain=tron&asset=USDT`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
    const confirm = (p, key = crypto.randomUUID(), who = admin) => who.post('/admin/deposit-packages/confirm', {
      userId: p.userId, chain: 'tron', asset: 'USDT', depositIds: p.transfers.map((t) => t.id), token: p.token, idempotencyKey: key });
    const totalCredited = async () => (await prisma.deposit.findMany({ where: { status: 'CREDITED' } })).reduce((s, d) => s.plus(d.amount.toString()), new BigNumber(0));

    // ── 1–2, 10: small transfers are kept; attribution never credits; top-up reaches READY without credit
    await test('1/10. 15 and 20 are stored unattributed; attribution is audited and changes no balance', async () => {
      const a = await makeUser('a'), b = await makeUser('b');
      fixture.send(1, '15'); fixture.send(2, '20');
      const s = await scan(); assert.equal(s.ok, true, JSON.stringify(s));
      for (const n of [1, 2]) { const d = await row(n); assert.equal(d.userId, null); assert.ok(d.verifiedAt); assert.equal(d.finalized, true); }
      const q = (await admin.get('/admin/deposit-queue')).body;
      assert.ok(q.rows.filter((r) => r.state === 'UNATTRIBUTED').some((r) => r.txHash === hash(1) && r.amount === '15'));
      assert.equal((await attribute(1, a)).status, 200); assert.equal((await attribute(2, b)).status, 200);
      assert.equal(await balance(a), '0'); assert.equal(await balance(b), '0');
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_ATTRIBUTED' } }), 2);
      const pa = await pkgOf(a), pb = await pkgOf(b);
      assert.equal(pa.state, 'AWAITING_TOPUP'); assert.equal(pa.total, '15'); assert.equal(pa.remaining, '285');
      assert.equal(pb.state, 'AWAITING_TOPUP'); assert.equal(pb.total, '20'); assert.equal(pb.remaining, '280');
      // Moving an attributed transfer needs an explicit reassign.
      assert.equal((await attribute(1, b)).status, 409);
    });

    await test('2/5/7. 15+285 and 20+280 reach READY; 300 and 500 single transfers READY; nothing auto-credits; clients never summed', async () => {
      fixture.send(3, '285'); fixture.send(4, '280');
      const e = await makeUser('e'), f = await makeUser('f');
      fixture.send(5, '300'); fixture.send(6, '500');
      await scan();
      await attribute(3, users.a); await attribute(4, users.b); await attribute(5, e); await attribute(6, f);
      for (let i = 0; i < 3; i++) await scan(); // repeated discovery never credits
      const pa = await pkgOf(users.a), pb = await pkgOf(users.b), pe = await pkgOf(e), pf = await pkgOf(f);
      assert.deepEqual([pa.state, pa.total], ['READY', '300']); assert.deepEqual([pb.state, pb.total], ['READY', '300']);
      assert.deepEqual([pe.state, pe.total], ['READY', '300']); assert.deepEqual([pf.state, pf.total], ['READY', '500']);
      assert.equal(pa.transfers.length, 2); assert.ok(pa.transfers.every((t) => [hash(1), hash(3)].includes(t.txHash)));
      for (const id of [users.a, users.b, e, f]) assert.equal(await balance(id), '0');
      assert.equal(await prisma.depositBatch.count(), 0);
      assert.equal(await prisma.deposit.count({ where: { status: 'CREDITED' } }), 0);
    });

    await test('16. before Confirm: no pending row, amount or balance in client APIs; claim answer is neutral', async () => {
      const client = as(users.a);
      assert.deepEqual((await client.get('/deposits/me')).body, []);
      const bal = (await client.get('/balances')).body;
      assert.ok(!JSON.stringify(bal).includes('285') && !JSON.stringify(bal).includes('300'), JSON.stringify(bal));
      const claim = await client.post('/deposits/claim/tron', { txHash: hash(3), asset: 'USDT' });
      assert.equal(claim.status, 202); assert.equal(claim.body.status, 'SUBMITTED');
      assert.ok(!JSON.stringify(claim.body).includes('285')); assert.ok(!/зачисл(ен|ено)\b/i.test(claim.body.message.replace('после зачисления', '')));
    });

    await test('3/15. 15+20+265 → Confirm credits exactly 300 once; audit + referral only at approval, exactly once', async () => {
      const c = await makeUser('c', { referredById: REFERRER });
      fixture.send(7, '15'); fixture.send(8, '20'); await scan();
      await attribute(7, c); await attribute(8, c);
      const p35 = await pkgOf(c); assert.equal(p35.total, '35'); assert.equal(p35.remaining, '265'); assert.equal(p35.state, 'AWAITING_TOPUP');
      fixture.send(9, '265'); await scan(); await attribute(9, c);
      assert.equal(await prisma.referralReward.count(), 0);
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED' } }), 0);
      const p = await preview(c);
      assert.equal(p.total, '300'); assert.equal(p.minimumReached, true); assert.equal(p.balanceAvailable, '0'); assert.equal(p.balanceAfter, '300');
      const r = await confirm(p); assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.totalAmount, '300'); assert.equal(await balance(c), '300');
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED', userId: c } }), 3);
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_BATCH_CREDITED', userId: c } }), 1);
      assert.equal(await prisma.referralReward.count({ where: { referredUserId: c } }), 3);
      assert.equal(await balance(REFERRER), '15');
      for (const n of [7, 8, 9]) { const d = await row(n); assert.equal(d.status, 'CREDITED'); assert.equal(d.batchId, r.body.batchId); assert.ok(d.creditedAt); }
      const client = as(c);
      const mine = (await client.get('/deposits/me')).body;
      assert.equal(mine.length, 3); assert.equal(mine.reduce((s, d) => s.plus(d.amount), new BigNumber(0)).toString(), '300');
    });

    await test('4. 15+300 → Confirm credits exactly 315', async () => {
      const d = await makeUser('d');
      fixture.send(10, '15'); fixture.send(11, '300'); await scan(); await attribute(10, d); await attribute(11, d);
      const p = await preview(d); assert.equal(p.total, '315');
      assert.equal((await confirm(p)).status, 200); assert.equal(await balance(d), '315');
    });

    await test('6/8. 299.999999 is below the minimum (UI and API); an old CREDITED package never counts toward a new one', async () => {
      const g = await makeUser('g');
      fixture.send(12, '299.999999'); await scan(); await attribute(12, g);
      const p = await preview(g); assert.equal(p.minimumReached, false); assert.equal(p.state, 'AWAITING_TOPUP'); assert.equal(p.remaining, '0.000001');
      const r = await confirm(p); assert.equal(r.status, 409); assert.equal(r.body.code, 'BELOW_MINIMUM'); assert.equal(await balance(g), '0');
      fixture.send(13, '15'); await scan(); await attribute(13, users.c);
      const pc = await preview(users.c); assert.equal(pc.total, '15'); assert.equal(pc.minimumReached, false);
      assert.equal((await confirm(pc)).body.code, 'BELOW_MINIMUM'); assert.equal(await balance(users.c), '300');
    });

    await test('12. the legacy one-transfer manual-credit endpoint is closed (410) and credits nothing', async () => {
      const r = await admin.post('/admin/deposits/manual-credit', { userId: users.g, chain: 'tron', txHash: hash(12), asset: 'USDT', amount: '999' });
      assert.equal(r.status, 410); assert.equal(await balance(users.g), '0');
      assert.equal((await as(users.g).post('/admin/deposits/manual-credit', {})).status, 403);
    });

    await test('11. public claim / forged fields cannot take, lock, credit or bypass anything', async () => {
      const x = await makeUser('x'), y = await makeUser('y');
      fixture.send(14, '400'); await scan();
      for (const who of [x, y]) {
        const r = await as(who).post('/deposits/claim/tron', { txHash: hash(14), asset: 'USDT', userId: who, performedByAdminId: ADMIN, status: 'CREDITED', amount: '99999' });
        assert.equal(r.status, 202, JSON.stringify(r.body));
      }
      assert.equal((await row(14)).userId, null);
      assert.equal(await prisma.depositClaim.count({ where: { txHash: hash(14) } }), 2);
      assert.equal(await balance(x), '0'); assert.equal(await balance(y), '0');
      const unknown = await as(x).post('/deposits/claim/tron', { txHash: hash(999999), asset: 'USDT' });
      assert.equal(unknown.status, 202); // no oracle: an unknown hash answers the same
      const q = (await admin.get('/admin/deposit-queue')).body;
      assert.equal(q.rows.find((r) => r.txHash === hash(14)).claims.length, 2);
      // A client cannot call admin routes.
      assert.equal((await as(x).post(`/admin/deposits/${(await row(14)).id}/attribute`, { userId: x })).status, 403);
      assert.equal((await as(x).post('/admin/deposit-packages/confirm', {})).status, 403);
    });

    await test('13. double submit, retry after timeout, two admins, overlapping confirms: exactly one financial effect', async () => {
      const h = await makeUser('h');
      fixture.send(15, '120'); fixture.send(16, '230'); await scan(); await attribute(15, h); await attribute(16, h);
      const p = await preview(h); const key = crypto.randomUUID();
      const same = await Promise.all(Array.from({ length: 6 }, () => confirm(p, key)));
      for (const r of same) assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(new Set(same.map((r) => r.body.batchId)).size, 1);
      assert.equal(await balance(h), '350');
      const retry = await confirm(p, key); assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true); assert.equal(await balance(h), '350');
      const other = await confirm(p, crypto.randomUUID(), as(ADMIN_2)); assert.equal(other.status, 409); assert.equal(await balance(h), '350');
      // Two different admins racing on a fresh package.
      const i = await makeUser('i');
      fixture.send(17, '310'); await scan(); await attribute(17, i);
      const pi = await preview(i);
      const race = await Promise.all([confirm(pi, crypto.randomUUID()), confirm(pi, crypto.randomUUID(), as(ADMIN_2)), confirm(pi, crypto.randomUUID())]);
      assert.equal(race.filter((r) => r.status === 200).length, 1, JSON.stringify(race.map((r) => [r.status, r.body.code])));
      assert.equal(await balance(i), '310'); assert.equal(await prisma.depositBatch.count({ where: { userId: i } }), 1);
      // A key reused for another package is refused.
      const j = await makeUser('j'); fixture.send(18, '301'); await scan(); await attribute(18, j);
      const reuse = await confirm(await preview(j), key); assert.equal(reuse.status, 409); assert.equal(reuse.body.code, 'IDEMPOTENCY_MISMATCH');
    });

    await test('13b. a transfer arriving between Preview and Confirm is never silently added: re-review required', async () => {
      const j = users.j; const before = await preview(j);
      fixture.send(19, '5'); await scan(); await attribute(19, j);
      const r = await confirm(before); assert.equal(r.status, 409); assert.equal(r.body.code, 'PACKAGE_CHANGED'); assert.equal(await balance(j), '0');
      const again = await preview(j); assert.equal(again.total, '306');
      assert.equal((await confirm(again)).status, 200); assert.equal(await balance(j), '306');
    });

    await test('14. a failure in the middle of the credit rolls everything back', async () => {
      const k = await makeUser('k'); fixture.send(20, '300'); fixture.send(21, '50'); await scan(); await attribute(20, k); await attribute(21, k);
      await db.query(`CREATE FUNCTION qa_fail_batch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA forced failure'; END $$;
        CREATE TRIGGER qa_fail_batch_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.action = 'DEPOSIT_BATCH_CREDITED') EXECUTE FUNCTION qa_fail_batch_audit();`);
      try { const r = await confirm(await preview(k)); assert.equal(r.status, 500); }
      finally { await db.query('DROP TRIGGER qa_fail_batch_audit ON "AuditLog"; DROP FUNCTION qa_fail_batch_audit();'); }
      assert.equal(await balance(k), '0'); assert.equal(await prisma.depositBatch.count({ where: { userId: k } }), 0);
      for (const n of [20, 21]) { const d = await row(n); assert.notEqual(d.status, 'CREDITED'); assert.equal(d.batchId, null); }
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED', userId: k } }), 0);
      assert.equal((await confirm(await preview(k))).status, 200); assert.equal(await balance(k), '350');
    });

    await test('9/21. unattributed, unconfirmed, failed, wrong-contract, wrong-recipient and reorged transfers never make a package ready', async () => {
      const m = await makeUser('m');
      fixture.send(22, '400');                                   // unattributed: no package at all
      fixture.send(23, '250'); fixture.send(24, '100', { solidified: false, block: fixture.state.head - 2 }); // 250 confirmed + 100 not final
      fixture.send(25, '500', { success: false });               // failed on chain
      fixture.send(26, '500', { logs: [{ to: TREASURY, value: '500000000', contractHex: FAKE_TOKEN_HEX }] }); // listed as USDT, log from another contract
      fixture.send(27, '500', { listTo: TREASURY, logs: [{ to: OTHER, value: '500000000' }] }); // listed to us, paid elsewhere
      await scan();
      for (const n of [23, 24, 25, 26, 27]) await attribute(n, m);
      const q = (await admin.get('/admin/deposit-queue')).body;
      const state = (n) => q.rows.find((r) => r.txHash === hash(n))?.state;
      assert.equal(state(22), 'UNATTRIBUTED'); assert.equal(state(24), 'AWAITING_CONFIRMATIONS');
      for (const n of [25, 26, 27]) assert.equal(state(n), 'NEEDS_REVIEW', `${n}: ${JSON.stringify(q.rows.find((r) => r.txHash === hash(n)))}`);
      const pm = q.packages.find((p) => p.userId === m);
      assert.equal(pm.total, '250'); assert.equal(pm.unconfirmedTotal, '100'); assert.equal(pm.state, 'AWAITING_TOPUP');
      assert.equal((await confirm(await preview(m))).body.code, 'BELOW_MINIMUM');
      // Reorg: a proven, final transfer that the chain no longer returns cannot be credited.
      const r = await makeUser('r'); fixture.send(28, '300'); await scan(); await attribute(28, r);
      const pr = await preview(r); assert.equal(pr.state, 'READY');
      fixture.state.txs.get(hash(28)).dropped = true;
      const res = await confirm(pr); assert.equal(res.status, 409); assert.equal(res.body.code, 'PROOF_FAILED'); assert.equal(await balance(r), '0');
      fixture.state.txs.get(hash(28)).dropped = false;
      // Unfinalized transfer becomes eligible once final; confirmation count comes from the chain head, not a placeholder.
      fixture.state.txs.get(hash(24)).solidified = true; fixture.state.txs.get(hash(24)).block = fixture.state.head - 25;
      await scan();
      const d24 = await row(24); assert.equal(d24.finalized, true); assert.equal(d24.confirmations, 26);
      assert.equal((await pkgOf(m)).total, '350');
    });

    await test('20. several events in one TX are one transfer; a legacy CREDITED hash is never re-created or re-credited', async () => {
      const n = await makeUser('n');
      fixture.send(29, '0', { logs: [{ to: TREASURY, value: '100000000' }, { to: TREASURY, value: '250000000' }, { to: OTHER, value: '999000000' }] });
      await prisma.deposit.create({ data: { chain: 'tron', txHash: hash(30), asset: 'USDT', amount: '700', status: 'CREDITED', userId: n, confirmations: 40, source: 'legacy' } });
      fixture.send(30, '700');
      const before = await balance(n);
      await scan();
      assert.equal(await prisma.deposit.count({ where: { txHash: hash(29) } }), 1);
      const d = await row(29); assert.equal(d.amount.toString(), '350'); assert.ok(d.verifiedAt);
      assert.equal(await prisma.deposit.count({ where: { txHash: hash(30) } }), 1);
      assert.equal((await row(30)).status, 'CREDITED'); assert.equal(await balance(n), before);
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED', userId: n } }), 0);
    });

    await test('17/18. >20 transfers between scans: paged, resumable after a crash between pages and inside a page write; none lost or doubled', async () => {
      const base = clock.t - 4 * 60_000;
      for (let i = 0; i < 45; i++) fixture.send(1000 + i, '1', { ts: base + i * 100 });
      // Crash while the provider serves page 2 of this window.
      fixture.state.failAfterCalls = fixture.state.calls.length + 2;
      const first = await scan(); assert.equal(first.ok, false); fixture.state.failAfterCalls = null;
      const cursor = await prisma.depositWatchCursor.findFirstOrThrow({ where: { address: TREASURY } });
      assert.ok(cursor.windowEndMs !== null || cursor.pageCursor === null);
      // Crash inside the page transaction (cursor write fails → the page's rows roll back too).
      await db.query(`CREATE FUNCTION qa_fail_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA cursor failure'; END $$;
        CREATE TRIGGER qa_fail_cursor BEFORE UPDATE ON "DepositWatchCursor" FOR EACH ROW WHEN (NEW."pageCursor" IS DISTINCT FROM OLD."pageCursor" AND NEW."pageCursor" IS NOT NULL) EXECUTE FUNCTION qa_fail_cursor();`);
      const countBefore = await prisma.deposit.count({ where: { txHash: { in: Array.from({ length: 45 }, (_, i) => hash(1000 + i)) } } });
      try { const crashed = await scan(); assert.equal(crashed.ok, false); }
      finally { await db.query('DROP TRIGGER qa_fail_cursor ON "DepositWatchCursor"; DROP FUNCTION qa_fail_cursor();'); }
      assert.equal(await prisma.deposit.count({ where: { txHash: { in: Array.from({ length: 45 }, (_, i) => hash(1000 + i)) } } }), countBefore);
      let runs = 0, last;
      do { last = await scan(); runs++; } while ((last.backlog || !last.ok) && runs < 12);
      const stored = await prisma.deposit.findMany({ where: { txHash: { in: Array.from({ length: 45 }, (_, i) => hash(1000 + i)) } } });
      assert.equal(stored.length, 45); assert.equal(new Set(stored.map((s) => s.txHash)).size, 45);
      assert.equal(await prisma.deposit.count({ where: { chain: 'tron' } }), await prisma.deposit.count({ where: { chain: 'tron' } }));
      report.measurements.backlog45 = { runsToDrain: runs + 2, pageSize: limits.pageSize, maxPagesPerRun: limits.maxPagesPerRun };
    });

    await test('19. provider outage and rate limit are errors, never an empty success; stored queue stays readable', async () => {
      const cursorBefore = await prisma.depositWatchCursor.findFirstOrThrow({ where: { address: TREASURY } });
      fixture.state.outage = true;
      fixture.send(40, '77');
      const r = await scan(); assert.equal(r.ok, false); assert.match(r.error, /HTTP 503|reach/);
      const status = (await admin.get('/admin/deposit-watch')).body; assert.equal(status.providerStatus, 'UNAVAILABLE');
      const q = await admin.get('/admin/deposit-queue'); assert.equal(q.status, 200); assert.ok(q.body.rows.length > 0);
      const cursorAfter = await prisma.depositWatchCursor.findFirstOrThrow({ where: { address: TREASURY } });
      assert.equal(cursorAfter.scannedThroughMs, cursorBefore.scannedThroughMs);
      fixture.state.outage = false; fixture.state.rateLimited = true;
      await watch.setEnabled(true, ADMIN);
      const limited = await watch.runOnce('admin'); assert.equal(limited.ok, false);
      assert.match((await prisma.depositWatchState.findUniqueOrThrow({ where: { id: 'tron' } })).providerStatus, /^RATE_LIMITED:\d+$/);
      const skipped = await watch.runOnce('schedule'); assert.equal(skipped.skipped, 'RATE_LIMITED');
      fixture.state.rateLimited = false;
      await prisma.depositWatchState.update({ where: { id: 'tron' }, data: { providerStatus: 'OK' } });
      await watch.setEnabled(false, ADMIN);
      const paused = await watch.runOnce('schedule'); assert.equal(paused.skipped, 'PAUSED');
      await scan(); assert.ok((await row(40)).verifiedAt);
      // Malformed page: stop, keep cursor, show error.
      fixture.state.malformedList = true; fixture.send(41, '1');
      const bad = await scan(); assert.equal(bad.ok, false); fixture.state.malformedList = false;
      assert.ok((await prisma.depositWatchCursor.findFirstOrThrow({ where: { address: TREASURY } })).lastError);
      await scan();
      // Concurrent runs: one lease.
      const both = await Promise.all([watch.runOnce('admin'), watch.runOnce('admin')]);
      assert.equal(both.filter((s) => s.skipped === 'LEASE_HELD').length, 1);
    });

    await test('22. treasury address change keeps the old queue, its proof and its own checkpoint', async () => {
      const t = await makeUser('t');
      fixture.send(50, '200'); await scan(); await attribute(50, t);
      await treasury.upsert('tron', TREASURY_2, ADMIN);
      fixture.send(51, '150', { to: TREASURY_2 });
      await scan(); await scan(); await attribute(51, t);
      const cursors = await prisma.depositWatchCursor.findMany({ where: { chain: 'tron' } });
      assert.deepEqual(new Set(cursors.map((c) => c.address)), new Set([TREASURY, TREASURY_2]));
      const p = await preview(t); assert.equal(p.total, '350');
      assert.deepEqual(new Set(p.transfers.map((x) => x.recipientAddress)), new Set([TREASURY, TREASURY_2]));
      assert.equal((await confirm(p)).status, 200); assert.equal(await balance(t), '350');
      await treasury.upsert('tron', TREASURY, ADMIN);
    });

    await test('23. watcher credentials run a scan only: no admin route, no credit, no balance', async () => {
      const tick = (token) => request(app).post('/api/v1/internal/deposit-watch/tick').set('Authorization', `Bearer ${token}`);
      assert.equal((await tick('wrong')).status, 401);
      const before = await totalCredited();
      const ok = await tick(WATCHER_TOKEN); assert.equal(ok.status, 200); assert.ok(['PAUSED', null].includes(ok.body.skipped));
      assert.ok(!('batchId' in ok.body)); assert.deepEqual(await totalCredited(), before);
      for (const [method, p] of [['get', '/admin/deposit-queue'], ['post', '/admin/deposit-packages/confirm'], ['post', '/admin/deposit-watch/run'], ['get', '/balances']]) {
        const r = await request(app)[method]('/api/v1' + p).set('Authorization', `Bearer ${WATCHER_TOKEN}`).send({});
        assert.equal(r.status, 401, `${p} → ${r.status}`);
      }
      const saved = process.env.DEPOSIT_WATCHER_TOKEN; delete process.env.DEPOSIT_WATCHER_TOKEN;
      assert.equal((await tick(WATCHER_TOKEN)).status, 404); process.env.DEPOSIT_WATCHER_TOKEN = saved;
      const src = fs.readFileSync('src/services/deposits/DepositWatchService.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const forbidden of ['balance.', 'futuresBalance', 'referralReward', 'depositBatch', 'DepositBatchService', 'withdrawal', 'performedByAdminId']) {
        assert.ok(!src.includes(forbidden), `watcher source must not contain ${forbidden}`);
      }
      // The watcher never sets a transfer's owner.
      assert.ok(!/deposit\.(update|updateMany|upsert|create|createMany)\([^;]*userId/.test(src), 'watcher must not write Deposit.userId');
    });

    await test('Cadence + load: automatic scan every 6 h only; empty cycle, NOT_DUE and paused cost ~nothing; manual scan keeps checkpoint and schedule', async () => {
      const { watcherIntervalMs } = require('../dist/services/deposits/DepositWatchService');
      assert.equal(watcherIntervalMs({}), 6 * 60 * 60_000);
      assert.equal(watcherIntervalMs({ DEPOSIT_WATCHER_INTERVAL_MINUTES: '5' }), 6 * 60 * 60_000); // frequent polling refused
      assert.equal(watcherIntervalMs({ DEPOSIT_WATCHER_INTERVAL_MINUTES: '720' }), 12 * 60 * 60_000);
      // Production limits (200 per page, 10 pages per run, 6 h cadence).
      const prodWatch = new DepositWatchService(prisma, resolveChain, fetch, () => clock.t);
      const SIX_H = 6 * 60 * 60_000;
      await prodWatch.setEnabled(true, ADMIN);
      const measure = async (fn) => {
        const c = fixture.state.calls.length, q = sqlLog.length, t = Date.now(), creditBefore = await prisma.depositBatch.count();
        const result = await fn();
        const financialWrites = sqlLog.slice(q).filter((x) => /(INSERT INTO|UPDATE) "public"\."(Balance|DepositBatch|ReferralReward|FuturesBalance|Withdrawal)"/.test(x)).length;
        assert.equal(await prisma.depositBatch.count(), creditBefore);
        return { result: result.skipped ?? (result.ok ? 'ran' : 'failed'), providerCalls: fixture.state.calls.length - c, sqlStatements: sqlLog.length - q,
          financialWrites, providerBytes: result.providerBytes ?? 0, newTransfers: result.newTransfers ?? 0, durationMs: Date.now() - t };
      };
      // Drain anything outstanding, then a scheduled run with nothing new.
      for (let i = 0; i < 6; i++) { clock.t += SIX_H; const r = await prodWatch.runOnce('schedule'); if (r.ok && !r.backlog && r.unfinalized === 0 && r.verified === 0 && r.newTransfers === 0) break; }
      clock.t += SIX_H;
      const empty = await measure(() => prodWatch.runOnce('schedule'));
      assert.equal(empty.result, 'ran'); assert.equal(empty.financialWrites, 0); assert.equal(empty.newTransfers, 0);
      const notDue = await measure(() => prodWatch.runOnce('schedule'));
      assert.equal(notDue.result, 'NOT_DUE'); assert.equal(notDue.providerCalls, 0);
      // A manual scan between automatic slots: finds new transfers, keeps the checkpoint, does not move the schedule.
      const lastScheduled = (await prisma.depositWatchState.findUniqueOrThrow({ where: { id: 'tron' } })).lastScheduledRunAt;
      clock.t += 60 * 60_000;
      for (let i = 0; i < 5; i++) fixture.send(2000 + i, '10', { ts: clock.t - 3 * 60_000 - i * 1000 });
      const manual = await measure(() => prodWatch.runOnce('admin'));
      assert.equal(manual.result, 'ran'); assert.equal(manual.newTransfers, 5); assert.equal(manual.financialWrites, 0);
      assert.deepEqual((await prisma.depositWatchState.findUniqueOrThrow({ where: { id: 'tron' } })).lastScheduledRunAt, lastScheduled);
      assert.equal((await prodWatch.runOnce('schedule')).skipped, 'NOT_DUE');
      clock.t += 5 * 60 * 60_000;
      for (let i = 0; i < 5; i++) fixture.send(2100 + i, '10', { ts: clock.t - 3 * 60_000 - i * 1000 });
      const withDeposits = await measure(() => prodWatch.runOnce('schedule'));
      assert.equal(withDeposits.result, 'ran'); assert.equal(withDeposits.newTransfers, 5); assert.equal(withDeposits.financialWrites, 0);
      const stored = await prisma.deposit.findMany({ where: { txHash: { in: [...Array.from({ length: 5 }, (_, i) => hash(2000 + i)), ...Array.from({ length: 5 }, (_, i) => hash(2100 + i))] } } });
      assert.equal(stored.length, 10); assert.ok(stored.every((d) => d.userId === null && d.status === 'PENDING'));
      // Finalized, proven transfers are not re-proven by later runs.
      clock.t += SIX_H;
      const again = await measure(() => prodWatch.runOnce('schedule'));
      assert.equal(again.providerCalls, empty.providerCalls);
      // Scheduler: one timer at the next slot, nothing while paused.
      const scheduler = new DepositWatchScheduler(prodWatch, SIX_H, () => clock.t);
      scheduler.setEnabled(true, clock.t - 60 * 60_000);
      assert.equal(scheduler.nextDelayMs(clock.t - 60 * 60_000), 5 * 60 * 60_000);
      assert.equal(scheduler.nextDelayMs(clock.t - 7 * 60 * 60_000), 60_000); // overdue after a sleep: shortly after start
      scheduler.setEnabled(false); assert.equal(scheduler.nextDelayMs(0), null); scheduler.stop();
      await prodWatch.setEnabled(false, ADMIN);
      clock.t += SIX_H;
      const paused = await measure(() => prodWatch.runOnce('schedule'));
      assert.equal(paused.result, 'PAUSED'); assert.equal(paused.providerCalls, 0);
      report.measurements = { ...report.measurements, cadence: { intervalHours: 6, automaticScansPerDay: 4 },
        emptyScheduledCycle: empty, notDueTrigger: notDue, pausedTrigger: paused, manualScanWith5: manual, scheduledCycleWith5: withDeposits, laterEmptyCycle: again };
    });

    if (process.argv.includes('--browser')) await browserQa({ app, admin, fixture, scan, attribute, balance, makeUser, auth, output, report, users, prisma });

    await test('Reconciliation: every CREDITED row has one admin audit; balances equal credited sums', async () => {
      const credited = await prisma.deposit.findMany({ where: { status: 'CREDITED', source: { not: 'legacy' } } });
      for (const d of credited) {
        const logs = await prisma.auditLog.findMany({ where: { action: 'DEPOSIT_CREDITED', metadata: { path: ['depositId'], equals: d.id } } });
        assert.equal(logs.length, 1); assert.equal(logs[0].metadata.manual, true); assert.ok([ADMIN, ADMIN_2].includes(logs[0].metadata.performedByAdminId));
        assert.ok(d.batchId);
      }
      const batches = await prisma.depositBatch.findMany({ include: { deposits: true } });
      for (const b of batches) {
        assert.equal(b.deposits.reduce((s, d) => s.plus(d.amount.toString()), new BigNumber(0)).toString(), new BigNumber(b.totalAmount.toString()).toString());
        assert.ok(new BigNumber(b.usdValue.toString()).gte(300));
      }
      report.reconciliation = { batches: batches.length, creditedTransfers: credited.length };
    });
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (appServer) await new Promise((r) => appServer.close(r));
    if (chainServer) await new Promise((r) => chainServer.close(r));
    if (prisma) await prisma.$disconnect();
    await database.stop();
  }
}

async function browserQa(ctx) {
  const { app, fixture, scan, attribute, balance, makeUser, auth, output, report, prisma } = ctx;
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  const client = await makeUser('browser');
  const who = { current: ADMIN };
  app.get('/api/v1/me', (_req, res) => res.json(who.current === ADMIN
    ? { id: ADMIN, email: 'admin@deposit.invalid', role: 'ADMIN', isAdmin: true, displayName: 'LOCAL QA' }
    : { id: client, email: 'browser@deposit.invalid', role: 'USER', isAdmin: false, displayName: 'CLIENT QA' }));
  app.get('/api/v1/admin/clients', async (_req, res) => res.json((await prisma.user.findMany({ where: { role: 'USER' }, select: { id: true, email: true } }))));
  app.get('/api/v1/*', (_req, res) => res.status(503).json({ error: 'No fixture for unrelated API' }));
  app.use(express.static(path.resolve('frontend/dist'), { index: false }));
  app.get('*', (_req, res) => res.type('html').send(fs.readFileSync('frontend/dist/index.html', 'utf8').replace('<head>',
    `<head><script>localStorage.setItem('exchange_token',${JSON.stringify(auth(who.current).slice(7))});localStorage.setItem('exchange_lang','ru');</script>`)));
  const server = await listen(app); const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}), headless: true });
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/503|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      const apiCalls = []; page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1/admin/deposit')) apiCalls.push(`${r.method()} ${u.pathname}`); });
      const n = 5000 + width;
      fixture.send(n, '15'); await scan();
      who.current = ADMIN;
      await page.goto(origin + '/admin/deposits#unattributed');
      const unattributed = page.locator(`[data-deposit-row]`).filter({ hasText: '15' }).filter({ has: page.locator(`[title="${hash(n)}"]`) });
      await unattributed.waitFor();
      await unattributed.getByRole('combobox').selectOption(client);
      await unattributed.getByRole('button', { name: 'Привязать к пользователю' }).click();
      await page.getByRole('status').filter({ hasText: 'Баланс не изменён' }).waitFor();
      assert.equal(await balance(client), width === 1440 ? '0' : '300');
      await page.locator('[data-deposit-tab="topup"]').click();
      const card = page.locator(`[data-package$="|tron|USDT"]`).filter({ hasText: 'browser@deposit.invalid' });
      await card.locator('[data-package-remaining]').filter({ hasText: '285 USDT' }).waitFor();
      await card.locator('[data-package-credit="unavailable"]').waitFor();
      await page.screenshot({ path: path.join(output, `awaiting-topup-${width}.png`), fullPage: true });
      clock.t += 5 * 60_000; // the owner presses the button some minutes later
      fixture.send(n + 1, '285');
      await page.locator('[data-watcher-run]').click();
      await page.getByRole('status').filter({ hasText: 'Проверка выполнена' }).waitFor();
      await attribute(n + 1, client);
      await page.reload();
      await page.locator('[data-deposit-tab="ready"]').click();
      const ready = page.locator(`[data-package-state="READY"]`).filter({ hasText: 'browser@deposit.invalid' });
      await ready.locator('[data-package-total]').filter({ hasText: '300 USDT' }).waitFor();
      await page.screenshot({ path: path.join(output, `ready-${width}.png`), fullPage: true });
      const before = await balance(client);
      await ready.getByRole('button', { name: 'Проверить и зачислить' }).click();
      await page.locator('[data-package-total]').last().waitFor();
      await page.locator('[data-cancel-credit]').click();
      assert.equal(await balance(client), before);
      assert.equal(apiCalls.filter((c) => c.endsWith('/confirm')).length, 0);
      await ready.getByRole('button', { name: 'Проверить и зачислить' }).click();
      await page.locator('[data-balance-after]').filter({ hasText: new BigNumber(before).plus(300).toString() }).waitFor();
      await page.screenshot({ path: path.join(output, `confirm-drawer-${width}.png`), fullPage: true });
      // Client, before Confirm: nothing pending is visible to them.
      const clientView = await request(app).get('/api/v1/deposits/me').set('Authorization', auth(client));
      assert.ok(!clientView.body.some((d) => d.txHash === hash(n) || d.txHash === hash(n + 1)));
      await page.locator('[data-confirm-credit]').dblclick();
      await page.getByRole('status').filter({ hasText: 'Зачислено 300 USDT' }).waitFor();
      assert.equal(await balance(client), new BigNumber(before).plus(300).toString());
      assert.equal(apiCalls.filter((c) => c.endsWith('/confirm')).length, 1, JSON.stringify(apiCalls));
      assert.equal(await prisma.depositBatch.count({ where: { userId: client } }), width === 1440 ? 1 : 2);
      const after = await request(app).get('/api/v1/deposits/me').set('Authorization', auth(client));
      assert.ok(after.body.some((d) => d.txHash === hash(n)) && after.body.some((d) => d.txHash === hash(n + 1)));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'horizontal overflow');
      // Hidden tab: no scheduled UI polling.
      const beforeHidden = apiCalls.length;
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(1500);
      assert.equal(apiCalls.length, beforeHidden);
      const queueLoads = apiCalls.filter((c) => c === 'GET /api/v1/admin/deposit-queue').length;
      assert.deepEqual(errors, []);
      report.browser.push({ width, attributeWithoutCredit: 'PASS', remaining285: 'PASS', ready300: 'PASS', cancelNoEffect: 'PASS', confirmOnce: 'PASS',
        clientBeforeConfirm: 'nothing pending', clientAfterConfirm: 'credited visible', overflow: false, hiddenTabRequests: 0, queueLoads, consoleErrors: 0 });
      console.log(`PASS browser ${width}`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
