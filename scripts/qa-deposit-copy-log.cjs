/** LOCAL-ONLY QA: «Копировали адрес» and the existing manual deposit credit.
 *
 * Real pieces: a throwaway Postgres cluster with every migration applied by
 * `prisma migrate deploy`; the compiled routers (dist/) for copy notes,
 * deposits, the admin deposit registry, balances, admin and account; the real
 * DepositBatchService re-proving transfers against a LOCAL TronGrid fixture
 * (the fixture of scripts/qa-deposit-packages.cjs); the real production-built
 * frontend in Chromium, served from another origin than the API so CORS
 * preflights happen as in production. Nothing reaches a production database,
 * account, wallet or network; no real money moves.
 *
 *   npx tsc
 *   VITE_MANUAL_DEPOSIT_CATALOGUE=true VITE_API_URL=http://127.0.0.1:47811/api/v1 \
 *     npx vite build --outDir <dir> (in frontend/)
 *   QA_FRONTEND_DIST=<dir> node scripts/qa-deposit-copy-log.cjs
 *
 * PG_BIN: Postgres binaries (default /usr/lib/postgresql/16/bin); as root,
 * initdb/pg_ctl run as `postgres`. QA_OUT: screenshots + report.json (default:
 * a temp directory). QA_API_PORT / QA_WEB_PORT must match the build (47811/47812).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events');
const { spawnSync, execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const PG_BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const OUT = path.resolve(process.env.QA_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'qa-deposit-copy-log-')));
const FRONTEND = process.env.QA_FRONTEND_DIST ? path.resolve(process.env.QA_FRONTEND_DIST) : null;
const API_PORT = Number(process.env.QA_API_PORT || 47811), WEB_PORT = Number(process.env.QA_WEB_PORT || 47812);
fs.mkdirSync(OUT, { recursive: true });
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.API_KEY_ENCRYPTION_SECRET = randomBytes(32).toString('hex');
process.env.EMAIL_VERIFICATION_SECRET ??= randomBytes(32).toString('hex');

// Synthetic chain: the TronGrid fixture of qa-deposit-packages.cjs.
const TREASURY = '41' + '11'.repeat(20);
const OTHER = '41' + '22'.repeat(20);
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// What the deposit dialog shows (the address catalogue). Synthetic, valid formats.
const CAT_TRON = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const CAT_XRP = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const hash = (n) => BigInt(n).toString(16).padStart(64, '0');

async function freePort() {
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const { port } = probe.address(); await new Promise((r) => probe.close(r)); return port;
}

async function startDatabase() {
  const port = await freePort();
  const asRoot = process.getuid?.() === 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-copy-log-pg-'));
  const data = path.join(dir, 'data'), log = path.join(dir, 'postgres.log');
  if (asRoot) {
    const uid = Number(execFileSync('id', ['-u', 'postgres']).toString().trim());
    const gid = Number(execFileSync('id', ['-g', 'postgres']).toString().trim());
    fs.chownSync(dir, uid, gid);
  }
  const pg = (bin, args) => {
    const run = asRoot ? spawnSync('runuser', ['-u', 'postgres', '--', path.join(PG_BIN, bin), ...args], { encoding: 'utf8' })
      : spawnSync(path.join(PG_BIN, bin), args, { encoding: 'utf8' });
    assert.equal(run.status, 0, `${bin}: ${run.stderr || run.stdout}`);
  };
  pg('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  // A non-UTC server zone: receivedAt must still be stored and read as UTC.
  pg('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${dir} -c timezone=Europe/Kyiv`, 'start', '-w']);
  return { url: `postgresql://postgres@127.0.0.1:${port}/postgres`, stop: () => pg('pg_ctl', ['-D', data, 'stop', '-m', 'fast', '-w']) };
}

function tronFixture(express) {
  const state = { head: 100_000, txs: new Map(), outage: false, calls: 0, seq: 0 };
  const norm = (a) => String(a).toLowerCase().replace(/^0x/, '').replace(/^41(?=[0-9a-f]{40}$)/, '');
  const app = express(); app.use(express.json());
  app.use((_req, res, next) => { state.calls++; if (state.outage) return res.status(503).json({ error: 'fixture outage' }); next(); });
  const info = (solidity) => (req, res) => {
    const t = state.txs.get(String(req.body?.value ?? '').toLowerCase());
    if (!t || t.block > state.head || (solidity && !t.solidified)) return res.json({});
    res.json({ id: t.id, blockNumber: t.block, blockTimeStamp: t.ts, receipt: { result: 'SUCCESS' },
      log: [{ address: t.contractHex ?? USDT_HEX, topics: [TRANSFER_TOPIC, '0'.repeat(24) + '55'.repeat(20), '0'.repeat(24) + norm(t.to)],
        data: BigInt(t.raw).toString(16).padStart(64, '0') }] });
  };
  app.post('/walletsolidity/gettransactioninfobyid', info(true));
  app.post('/wallet/gettransactioninfobyid', info(false));
  app.get('/wallet/getnowblock', (_req, res) => res.json({ block_header: { raw_data: { number: state.head } } }));
  app.post('/wallet/getnowblock', (_req, res) => res.json({ block_header: { raw_data: { number: state.head } } }));
  /** A USDT transfer, confirmed and solidified unless told otherwise. */
  function send(n, amount, o = {}) {
    const [whole, frac = ''] = String(amount).split('.');
    const raw = BigInt(whole + frac.padEnd(6, '0').slice(0, 6)).toString();
    const t = { id: hash(n), to: o.to ?? TREASURY, raw, block: o.block ?? state.head - 30, ts: Date.now() - 60_000 + state.seq++,
      solidified: o.solidified ?? true, contractHex: o.contractHex };
    state.txs.set(t.id, t);
    return t.id;
  }
  return { app, state, send };
}

async function main() {
  const database = await startDatabase();
  process.env.DATABASE_URL = database.url; process.env.DIRECT_URL = database.url;
  const report = { out: OUT, scope: 'Throwaway Postgres + synthetic TronGrid fixture + local build. Not production.', checks: [], sql: {}, http: {}, notes: [] };
  const check = (label, ok, detail) => { assert.ok(ok, `${label}${detail ? ` — ${detail}` : ''}`); report.checks.push(detail ? `${label} — ${detail}` : label); console.log('PASS', label, detail ?? ''); };
  let browser, apiServer, webServer, chainServer, prisma;
  try {
    const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, encoding: 'utf8', env: process.env });
    assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);
    report.migrations = (migrate.stdout.match(/Applying migration/g) || []).length;

    const express = require('express');
    const cors = require('cors');
    const rateLimit = require('express-rate-limit').default ?? require('express-rate-limit');
    const jwt = require('jsonwebtoken');
    const request = require('supertest');
    const { PrismaClient } = require('@prisma/client');
    const BigNumber = require('bignumber.js');

    const fixture = tronFixture(express);
    chainServer = fixture.app.listen(0, '127.0.0.1'); await once(chainServer, 'listening');
    for (const name of Object.keys(process.env)) if (/^(ETHEREUM|BSC|POLYGON|ARBITRUM|AVALANCHE|BITCOIN|SOLANA|TON|TRON)_/.test(name)) delete process.env[name];
    Object.assign(process.env, { TRON_NATIVE_ASSET: 'TRX', TRON_TREASURY_ADDRESS: TREASURY, TRON_TOKENS: `USDT:${USDT}:6`,
      TRON_API_URL: `http://127.0.0.1:${chainServer.address().port}`, TRON_MIN_CONFIRMATIONS: '19', DEPOSIT_WATCHER_SCHEDULE: 'off' });

    const dist = (p) => require(path.join(root, 'dist', p));
    const { depositAddressCopiesRouter, isDepositCopyEventRequest } = dist('api/routes/depositAddressCopies');
    const { adminDepositsRouter } = dist('api/routes/adminDeposits');
    const { depositsRouter } = dist('api/routes/deposits');
    const { balancesRouter } = dist('api/routes/balances');
    const { adminRouter } = dist('api/routes/admin');
    const { accountRouter } = dist('api/routes/account');
    const { depositCatalogueRouter } = dist('api/routes/depositCatalogue');
    const { DepositCatalogue } = dist('services/depositCatalogue/service');
    const { BackgroundWorkCoordinator } = dist('services/BackgroundWorkCoordinator');
    const { AdminUserDeletionService } = dist('services/AdminUserDeletionService');
    const { requireAuth } = dist('api/middleware/auth');

    const sql = [];
    prisma = new PrismaClient({ datasources: { db: { url: `${database.url}?connection_limit=12` } }, log: [{ emit: 'event', level: 'query' }] });
    prisma.$on('query', (e) => sql.push(e.query));
    const measure = async (label, fn) => {
      const from = sql.length; const result = await fn();
      const statements = sql.slice(from).filter((q) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/i.test(q.trim()));
      report.sql[label] = { count: statements.length, statements: statements.map((q) => q.replace(/\s+/g, ' ').slice(0, 160)) };
      Object.defineProperty(report.sql[label], 'full', { value: statements, enumerable: false });
      return result;
    };

    // Accounts: admin x2, three clients, a referrer, one to delete.
    const ids = { admin: randomUUID(), admin2: randomUUID(), u1: randomUUID(), u2: randomUUID(), u3: randomUUID(), ref: randomUUID(), gone: randomUUID(), u4: randomUUID(), u5: randomUUID() };
    const make = (id, email, extra = {}) => prisma.user.create({ data: { id, email, passwordHash: 'qa-only', referralCode: id.slice(0, 12), ...extra } });
    await make(ids.admin, 'admin@example.invalid', { role: 'ADMIN', displayName: 'QA Admin' });
    await make(ids.admin2, 'admin2@example.invalid', { role: 'ADMIN' });
    await make(ids.ref, 'referrer@example.invalid');
    await make(ids.u1, 'olena@example.invalid', { displayName: 'Олена (новая)' });
    await make(ids.u2, 'taras@example.invalid', { displayName: 'Тарас', referredById: ids.ref });
    await make(ids.u3, 'ivan@example.invalid', { displayName: '<b>Иван</b>' });
    await make(ids.gone, 'gone@example.invalid');
    await make(ids.u4, 'maria@example.invalid', { displayName: 'Мария' });
    await make(ids.u5, 'petro@example.invalid', { displayName: 'Петро' });
    // U2 already holds funds; U1 has no Balance row at all.
    await prisma.balance.create({ data: { userId: ids.u2, asset: 'USDT', available: '10', locked: '5' } });
    await prisma.balance.create({ data: { userId: ids.u2, asset: 'BTC', available: '0.5', locked: '0' } });
    await prisma.balance.create({ data: { userId: ids.u3, asset: 'USDT', available: '1', locked: '0' } });
    await prisma.futuresBalance.create({ data: { userId: ids.u2, asset: 'USDT', available: '70', locked: '0' } });
    const tokens = {};
    for (const [name, id] of Object.entries(ids)) {
      const session = await prisma.session.create({ data: { userId: id } });
      tokens[name] = jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '48h' });
    }

    // The production middleware order: CORS, JSON, the app-wide limiter (which
    // leaves the copy note alone), the background re-check, then the routes.
    const loop = { name: 'deposit-watch', asleep: true, nudges: 0, nudge() { this.nudges++; } };
    const coordinator = new BackgroundWorkCoordinator([loop], { activityCooldownMs: 0 });
    coordinator.start();
    const catalogueStore = { revision: 'r1', document: { schemaVersion: 1, overrides: [], baseline: [
      { assetId: 'tether', networkId: 'tron', address: CAT_TRON, enabled: true, memo: '', memoLabel: '' },
      { assetId: 'ripple', networkId: 'xrp', address: CAT_XRP, enabled: true, memo: '77', memoLabel: 'Destination tag' },
    ] } };
    const catalogue = new DepositCatalogue({ read: async () => structuredClone(catalogueStore), replace: async () => { throw new Error('read-only'); } }, async () => []);
    const prices = { getTicker: async () => null };
    const http = { options: 0, copyOptions: 0, copyPosts: 0, copyAdminReads: 0, other: 0 };
    const api = express();
    api.set('trust proxy', 1);
    api.use((req, _res, next) => {
      if (req.method === 'OPTIONS') { http.options++; if (req.path === '/api/v1/deposit-address-copies') http.copyOptions++; }
      else if (req.path === '/api/v1/deposit-address-copies') http.copyPosts++;
      else if (req.path === '/api/v1/admin/deposit-address-copies') http.copyAdminReads++;
      else http.other++;
      next();
    });
    api.use(cors({ origin: [`http://127.0.0.1:${WEB_PORT}`] }));
    api.use(express.json({ limit: '100kb' }));
    // The production skip predicate; a QA-sized budget so the browser's shell
    // reads never hit it (the number is not what is under test).
    const APP_LIMIT = 600;
    api.use(rateLimit({ windowMs: 60_000, limit: APP_LIMIT, standardHeaders: true, legacyHeaders: false, skip: isDepositCopyEventRequest }));
    api.use(coordinator.middleware());
    api.use('/api/v1', depositAddressCopiesRouter(prisma));
    api.use('/api/v1', depositCatalogueRouter(prisma, catalogue));
    api.use('/api/v1', adminDepositsRouter(prisma, prices), depositsRouter(prisma, prices), balancesRouter(prisma));
    api.use('/api/v1', adminRouter(prisma), accountRouter(prisma));
    // Shell reads the pages ask for, from the same ledger (no market data here).
    const auth = requireAuth(prisma);
    const ledger = async (model, userId) => (await prisma[model].findMany({ where: { userId } }))
      .map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString(), priceUsd: b.asset === 'BTC' ? 100000 : 1,
        valueUsd: (Number(b.available) + Number(b.locked)) * (b.asset === 'BTC' ? 100000 : 1) }));
    api.get('/api/v1/wallet/overview', auth, async (req, res) => {
      const spot = await ledger('balance', req.userId), futures = await ledger('futuresBalance', req.userId);
      const s = spot.reduce((a, r) => a + r.valueUsd, 0), f = futures.reduce((a, r) => a + r.valueUsd, 0);
      res.json({ real: { spot, futures, spotValueUsd: s, futuresValueUsd: f, totalValueUsd: s + f }, presentation: null, displaySpotUsd: s, displayFuturesUsd: f, displayTotalUsd: s + f, btcPriceUsd: 100000 });
    });
    api.get('/api/v1/futures/balances', auth, async (req, res) => res.json(await ledger('futuresBalance', req.userId)));
    api.get('/api/v1/wallet/performance', auth, (_req, res) => res.json({ ageDays: 0, startedOn: null, periods: {} }));
    api.get('/api/v1/trades/me', auth, (_req, res) => res.json([]));
    api.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside this QA scope', path: req.path }));
    apiServer = api.listen(API_PORT, '127.0.0.1'); await once(apiServer, 'listening');
    const as = (name) => ({
      get: (p) => request(api).get('/api/v1' + p).set('Authorization', `Bearer ${tokens[name]}`),
      post: (p, body = {}) => request(api).post('/api/v1' + p).set('Authorization', `Bearer ${tokens[name]}`).send(body),
    });

    // ── A. The copy note on real Postgres ─────────────────────────────────
    const ledgerSnapshot = async () => JSON.stringify({
      deposits: await prisma.deposit.count(), claims: await prisma.depositClaim.count(), batches: await prisma.depositBatch.count(),
      balances: (await prisma.balance.findMany({ orderBy: [{ userId: 'asc' }, { asset: 'asc' }] })).map((b) => `${b.userId}:${b.asset}:${b.available}:${b.locked}`),
      audit: await prisma.auditLog.count(),
    });
    const ledgerBefore = await ledgerSnapshot();
    const note = (over = {}) => ({ eventId: randomUUID(), asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address: CAT_TRON, source: 'wallet', ...over });

    const first = note({ clientCopiedAt: new Date(Date.now() - 4_000).toISOString() });
    const created = await measure('copy note: first delivery', () => as('u1').post('/deposit-address-copies', first));
    check('A1 a signed-in copy is one row, authored by the session', created.status === 201, `status ${created.status}`);
    const row = await prisma.depositAddressCopyEvent.findUniqueOrThrow({ where: { userId_eventId: { userId: ids.u1, eventId: first.eventId } } });
    check('A1 the row holds exactly the copied rail and address', row.asset === 'USDT' && row.network === 'tron' && row.destinationId === 'tether:tron'
      && row.addressSnapshot === CAT_TRON && row.source === 'wallet' && row.memoSnapshot === null);
    check('A1 receivedAt is the server clock in UTC (Postgres runs in Europe/Kyiv)', Math.abs(row.receivedAt.getTime() - Date.now()) < 10_000, row.receivedAt.toISOString());
    check('A1 the device time is kept separately', Math.abs(row.clientCopiedAt.getTime() - Date.parse(first.clientCopiedAt)) < 2);

    const again = await measure('copy note: same eventId again', () => as('u1').post('/deposit-address-copies', first));
    const count1 = await prisma.depositAddressCopyEvent.count();
    check('A2 a retried eventId adds nothing and keeps the first time', again.status === 200 && again.body.duplicate === true
      && again.body.id === created.body.id && again.body.receivedAt === created.body.receivedAt && count1 === 1);
    const conflict = await measure('copy note: eventId reused for another address', () => as('u1').post('/deposit-address-copies', { ...first, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }));
    check('A3 the same eventId with another payload is refused', conflict.status === 409 && (await prisma.depositAddressCopyEvent.count()) === 1);
    check('A4 the same eventId from another account is that account\'s own note', (await as('u2').post('/deposit-address-copies', first)).status === 201);
    check('A5 a body naming a user is refused', (await as('u1').post('/deposit-address-copies', { ...note(), userId: ids.u2 })).status === 400);
    check('A5 no token, no note', (await request(api).post('/api/v1/deposit-address-copies').send(note())).status === 401);
    const xrp = await as('u3').post('/deposit-address-copies', note({ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: CAT_XRP, memo: '77', source: 'header' }));
    check('A6 a memo rail keeps its tag', xrp.status === 201 && (await prisma.depositAddressCopyEvent.findFirst({ where: { userId: ids.u3 } })).memoSnapshot === '77');
    check('A7 the copy notes changed no deposit, claim, batch, balance or audit row', (await ledgerSnapshot()) === ledgerBefore);

    // Background loops: a note does not wake them; a financial write still does.
    loop.nudges = 0;
    await as('u1').post('/deposit-address-copies', note({ address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' }));
    check('A8 a copy note does not re-check the sleeping loops', loop.nudges === 0 && coordinator.stats.activityRechecks === 0);
    const claim = await as('u3').post('/deposits/claim/tron', { txHash: hash(9_999), asset: 'USDT' });
    check('A8 an ordinary write still re-checks them', claim.status < 400 && loop.nudges === 1, `claim ${claim.status}, nudges ${loop.nudges}`);

    // Own limits: per account (30 / 10 min) and per address (60 / min); the
    // app-wide 120/min budget is untouched by notes.
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await as('u2').post('/deposit-address-copies', note())).status);
    check('A9 the 31st note of one account in 10 minutes is refused (429)', statuses.slice(0, 29).every((s) => s === 201) && statuses[30] === 429, statuses.slice(-3).join(','));
    const plain = await as('u1').get('/balances');
    check('A9 the notes did not spend the app-wide budget', plain.status === 200 && Number(plain.headers['ratelimit-remaining']) >= APP_LIMIT - 5, `remaining ${plain.headers['ratelimit-remaining']} of ${APP_LIMIT}`);

    // Admin journal: keyset pages of 25, newest first, one SELECT with the account.
    await prisma.depositAddressCopyEvent.deleteMany({});
    const base = Date.now() - 60 * 60_000;
    for (let i = 0; i < 60; i++) {
      const user = [ids.u1, ids.u2, ids.u3][i % 3];
      await prisma.depositAddressCopyEvent.create({ data: { eventId: randomUUID(), userId: user, asset: i % 4 ? 'USDT' : 'XRP', network: i % 4 ? 'tron' : 'xrp',
        destinationId: i % 4 ? 'tether:tron' : 'ripple:xrp', addressSnapshot: i % 4 ? CAT_TRON : CAT_XRP, source: 'wallet',
        receivedAt: new Date(base + Math.floor(i / 2) * 60_000) } }); // pairs share a time: the id breaks the tie
    }
    const pages = [];
    let cursor = '';
    const nonAdmin = await as('u1').get('/admin/deposit-address-copies');
    check('A10 clients cannot read the journal', nonAdmin.status === 403);
    do {
      const res = await measure(`admin journal: page ${pages.length + 1}`, () => as('admin').get(`/admin/deposit-address-copies${cursor ? `?before=${cursor}` : ''}`));
      assert.equal(res.status, 200);
      pages.push(res.body.items); cursor = res.body.nextCursor ?? '';
    } while (cursor);
    const all = pages.flat();
    const sorted = [...all].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
    check('A10 pages of 25/25/10, newest first, nothing lost or repeated', pages.map((p) => p.length).join('/') === '25/25/10'
      && new Set(all.map((r) => r.id)).size === 60 && JSON.stringify(all.map((r) => r.id)) === JSON.stringify(sorted.map((r) => r.id)));
    const journalSql = Object.entries(report.sql).filter(([k]) => k.startsWith('admin journal'));
    check('A10 each page is one journal SELECT joined with the account (no per-row lookups)',
      journalSql.length === 3 && journalSql.every(([, v]) => v.count === 3 && v.full.filter((q) => q.includes('"DepositAddressCopyEvent"')).length === 1), 'auth + role + 1 SELECT per page');
    check('A10 rows carry the account and the network name', all[0].email && all.some((r) => r.displayName === '<b>Иван</b>') && all.some((r) => r.networkName === 'XRP Ledger'));
    const byEmail = await as('admin').get('/admin/deposit-address-copies?user=taras@');
    const byUid = await as('admin').get(`/admin/deposit-address-copies?user=${ids.u3}`);
    const byAsset = await as('admin').get('/admin/deposit-address-copies?asset=xrp');
    check('A11 filters by email, UID and coin', byEmail.body.items.length === 20 && byEmail.body.items.every((r) => r.userId === ids.u2)
      && byUid.body.items.every((r) => r.userId === ids.u3) && byAsset.body.items.length === 15 && byAsset.body.items.every((r) => r.asset === 'XRP'));
    const wildcard = await as('admin').get('/admin/deposit-address-copies?user=%25');
    check('A11 a % in the filter is a character, not a wildcard', wildcard.status === 200 && wildcard.body.items.length === 0);

    // ── B. The existing manual credit, for several ordinary users ─────────
    const recorded = async (n) => {
      const res = await as('admin').post('/admin/deposits/check-tx', { chain: 'tron', txHash: hash(n), asset: 'USDT' });
      assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body;
    };
    const depositOf = (n) => prisma.deposit.findUniqueOrThrow({ where: { chain_txHash: { chain: 'tron', txHash: hash(n) } } });
    const attribute = async (n, who, as_ = 'admin') => as(as_).post(`/admin/deposits/${(await depositOf(n)).id}/attribute`, { userId: who });
    const preview = async (userId) => (await as('admin').get(`/admin/deposit-packages/preview?userId=${userId}&chain=tron&asset=USDT`)).body;
    const confirm = (p, key = randomUUID(), who = 'admin') => as(who).post('/admin/deposit-packages/confirm', {
      userId: p.userId, chain: 'tron', asset: 'USDT', depositIds: p.transfers.map((t) => t.id), token: p.token, idempotencyKey: key });
    const bal = async (userId, asset = 'USDT') => prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } });

    fixture.send(101, '300.123456');               // U1, new account
    fixture.send(102, '150'); fixture.send(103, '200'); // U2, existing account, referred
    fixture.send(104, '299.999999');                // U3, below the minimum, then topped up
    for (const n of [101, 102, 103, 104]) await recorded(n);
    check('B0 detected transfers start unattributed and change no balance', (await prisma.deposit.count({ where: { userId: null } })) === 4 && !(await bal(ids.u1)));
    // Admin picks each client by UID from the full client list.
    const clients = (await as('admin').get('/admin/clients')).body;
    check('B1 the client list the picker uses includes every account', [ids.u1, ids.u2, ids.u3].every((id) => clients.some((c) => c.id === id)));
    for (const [n, who] of [[101, ids.u1], [102, ids.u2], [103, ids.u2], [104, ids.u3]]) assert.equal((await attribute(n, who)).status, 200);
    check('B1 attribution alone credits nothing', !(await bal(ids.u1)) && (await bal(ids.u2)).available.toString() === '10');

    const p1 = await preview(ids.u1), p2 = await preview(ids.u2), p3 = await preview(ids.u3);
    check('B2 each preview is that user\'s own package', p1.userId === ids.u1 && p1.total === '300.123456' && p1.transfers.length === 1
      && p2.total === '350' && p2.transfers.length === 2 && p3.total === '299.999999' && !p3.minimumReached);
    check('B2 the preview shows the balance before and after', p1.balanceAvailable === '0' && p1.balanceAfter === '300.123456' && p2.balanceAvailable === '10' && p2.balanceAfter === '360');
    const below = await confirm(p3);
    check('B3 below the minimum: refused, nothing credited', below.status === 409 && below.body.code === 'BELOW_MINIMUM' && (await bal(ids.u3)).available.toString() === '1');

    const c1 = await measure('credit: confirm one package', () => confirm(p1));
    check('B4 a new account: its Balance row is created with the exact amount', c1.status === 200 && (await bal(ids.u1)).available.toString() === '300.123456' && (await bal(ids.u1)).locked.toString() === '0');
    const key2 = randomUUID();
    const [d1, d2] = await Promise.all([confirm(p2, key2), confirm(p2, key2)]);
    const u2After = await bal(ids.u2);
    check('B5 a double click (same key, at once) credits once', d1.status === 200 && d2.status === 200 && [d1.body.replayed, d2.body.replayed].filter(Boolean).length <= 1
      && d1.body.batchId === d2.body.batchId && u2After.available.toString() === '360');
    check('B5 an existing account: only available grows; locked and other assets stay', u2After.locked.toString() === '5'
      && (await bal(ids.u2, 'BTC')).available.toString() === '0.5' && (await prisma.futuresBalance.findFirst({ where: { userId: ids.u2 } })).available.toString() === '70');
    const refBal = await bal(ids.ref);
    check('B6 the referral reward is paid once, 5 % of each transfer', refBal.available.toString() === '17.5' && (await prisma.referralReward.count({ where: { referrerId: ids.ref } })) === 2);
    const late = await confirm(p2, key2);
    check('B7 a retry after a lost answer (same key) returns the first result, no second credit', late.status === 200 && late.body.replayed === true
      && (await bal(ids.u2)).available.toString() === '360' && (await bal(ids.ref)).available.toString() === '17.5');
    const stale = await confirm(p2);
    check('B8 the credited package cannot be credited again', stale.status === 409 && (await bal(ids.u2)).available.toString() === '360');
    check('B9 every credit has its audit rows', (await prisma.auditLog.count({ where: { action: 'DEPOSIT_BATCH_CREDITED' } })) === 2);

    // U3: top up past the minimum; two admins at once with different keys.
    fixture.send(105, '0.000001'); await recorded(105); await attribute(105, ids.u3);
    const p3b = await preview(ids.u3);
    check('B10 the top-up joins the package: exactly 300', p3b.total === '300' && p3b.minimumReached);
    const [r1, r2] = await Promise.all([confirm(p3b, randomUUID(), 'admin'), confirm(p3b, randomUUID(), 'admin2')]);
    check('B10 two admins at once: one credit, the other refused', [r1.status, r2.status].sort().join() === '200,409' && (await bal(ids.u3)).available.toString() === '301');

    // Refusals that must leave money untouched.
    fixture.send(106, '400', { to: OTHER });
    const wrong = await as('admin').post('/admin/deposits/check-tx', { chain: 'tron', txHash: hash(106), asset: 'USDT' });
    check('B11 a transfer to another address is not recorded', wrong.body.ok === false && !(await prisma.deposit.findFirst({ where: { txHash: hash(106) } })));
    fixture.send(107, '400', { contractHex: '33'.repeat(20) });
    const fake = await as('admin').post('/admin/deposits/check-tx', { chain: 'tron', txHash: hash(107), asset: 'USDT' });
    check('B11 a fake token contract is not recorded', fake.body.ok === false);
    fixture.send(108, '500', { block: fixture.state.head - 3, solidified: false }); await recorded(108); await attribute(108, ids.u1);
    const p1b = await preview(ids.u1);
    check('B12 too few confirmations: not in the package', p1b.transfers.length === 0 && p1b.unconfirmedCount === 1);
    fixture.state.txs.get(hash(108)).block = fixture.state.head - 40; fixture.state.txs.get(hash(108)).solidified = true;
    await recorded(108);
    const p1c = await preview(ids.u1);
    fixture.state.outage = true;
    const down = await confirm(p1c);
    fixture.state.outage = false;
    check('B13 the chain check unavailable at confirm: refused, nothing credited', down.status === 503 && (await bal(ids.u1)).available.toString() === '300.123456');
    fixture.send(109, '50'); await recorded(109); await attribute(109, ids.u1);
    const changed = await confirm(p1c);
    check('B14 a transfer that joined after the preview: re-review required', changed.status === 409 && changed.body.code === 'PACKAGE_CHANGED');
    const ok1 = await confirm(await preview(ids.u1));
    check('B14 after a fresh preview it credits exactly 550 more', ok1.status === 200 && (await bal(ids.u1)).available.toString() === '850.123456');

    // Who may do what.
    fixture.send(110, '400'); await recorded(110);
    const t110 = (await depositOf(110)).id;
    const asClient = await as('u1').post(`/admin/deposits/${t110}/attribute`, { userId: ids.u1 });
    const asGuest = await request(api).post(`/api/v1/admin/deposits/${t110}/attribute`).send({ userId: ids.u1 });
    const clientConfirm = await confirm(await preview(ids.u2), randomUUID(), 'u2');
    check('B15 a client or a guest cannot attribute or credit', asClient.status === 403 && asGuest.status === 401 && clientConfirm.status === 403);
    const selfClaim = await as('u2').post('/deposits/claim/tron', { txHash: hash(110), asset: 'USDT' });
    check('B15 a client claim takes nothing', selfClaim.status < 500 && (await depositOf(110)).userId === null && (await bal(ids.u2)).available.toString() === '360');
    await prisma.user.update({ where: { id: ids.u3 }, data: { blockedAt: new Date(), blockedReason: 'QA' } });
    const blocked = await attribute(110, ids.u3);
    report.notes.push(`A blocked account (blockedAt set) can still be attributed and credited: attribute → ${blocked.status}. No such rule exists in the credit path; not changed here.`);
    await as('admin').post(`/admin/deposits/${t110}/attribute`, { userId: null, reassign: true });
    // Copy notes play no part in a credit (U2 has none since the reset; U3 has some).
    check('B16 a credit needs no copy note, and a copy note attributes nothing', (await prisma.depositAddressCopyEvent.count({ where: { userId: ids.u2, receivedAt: { gt: new Date(Date.now() - 60_000) } } })) === 0
      && (await depositOf(110)).userId === null);
    const wallet = (await as('u1').get('/balances')).body;
    check('B17 the client\'s spot balance shows the credit', wallet.some((b) => b.asset === 'USDT' && b.available === '850.123456'));

    // Account deletion: copy notes go with the account; nothing financial is rewritten.
    const goneSession = tokens.gone;
    await request(api).post('/api/v1/deposit-address-copies').set('Authorization', `Bearer ${goneSession}`).send(note());
    const before = await prisma.depositAddressCopyEvent.count();
    const { AccountDeletionGate } = dist('services/AccountDeletionGate');
    const { MatchingEngine } = dist('matching-engine/MatchingEngine');
    await new AdminUserDeletionService(prisma, new AccountDeletionGate(), { spot: new MatchingEngine(), futures: new MatchingEngine(), demo: new MatchingEngine() })
      .delete(ids.admin, ids.gone);
    check('B18 deleting an account deletes its copy notes, and only those', (await prisma.depositAddressCopyEvent.count()) === before - 1
      && (await prisma.depositAddressCopyEvent.count({ where: { userId: ids.u1 } })) === 20);
    const toGone = await attribute(110, ids.gone);
    check('B18 a deleted account cannot receive a transfer', toGone.status === 404);
    // Roll-back compatibility: the previous release never names the table; a
    // plain user delete (what any code does) still works with notes present.
    const raw = randomUUID();
    await make(raw, 'raw@example.invalid');
    await prisma.depositAddressCopyEvent.create({ data: { eventId: randomUUID(), userId: raw, asset: 'USDT', network: 'tron', addressSnapshot: CAT_TRON, source: 'wallet' } });
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE id = '${raw}'`);
    check('B19 a plain DELETE of a user cascades its notes (older code keeps working)', (await prisma.depositAddressCopyEvent.count({ where: { userId: raw } })) === 0);
    const migrationSql = fs.readFileSync(path.join(root, 'prisma/migrations/20261001120000_deposit_address_copy_event/migration.sql'), 'utf8');
    const statements = migrationSql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    check('B19 the migration only creates the new table, its indexes and its key', statements.every((s) => /^(CREATE TABLE "DepositAddressCopyEvent"|CREATE (UNIQUE )?INDEX "DepositAddressCopyEvent_|ALTER TABLE "DepositAddressCopyEvent" ADD CONSTRAINT)/.test(s)), `${statements.length} statements`);

    // ── C. Browser: the real build, two origins ───────────────────────────
    // A READY package for a fresh test account, credited in the browser below.
    fixture.send(111, '300'); await recorded(111); await attribute(111, ids.u4);
    if (FRONTEND) await browserPart({ express, prisma, tokens, ids, http, check, report, sql });
    else report.notes.push('QA_FRONTEND_DIST not set: browser part skipped.');

    report.http = http;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`ALL PASS (${report.checks.length}) → ${OUT}`);
  } finally {
    await browser?.close().catch(() => {});
    for (const s of [apiServer, webServer, chainServer]) s?.close();
    await prisma?.$disconnect().catch(() => {});
    database.stop();
  }

  async function browserPart({ express, prisma, tokens, ids, http, check, report }) {
    const web = express();
    web.use(express.static(FRONTEND, { index: false, redirect: false }));
    web.get('*', (_req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
    webServer = web.listen(WEB_PORT, '127.0.0.1'); await once(webServer, 'listening');
    const origin = `http://127.0.0.1:${WEB_PORT}`;
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
    browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined });
    const open = async (who, { width = 1440, height = 900, clipboard = 'ok' } = {}) => {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', isMobile: width < 500, hasTouch: width < 500 });
      await context.addInitScript(([token, mode]) => {
        if (token) localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru');
        window.__copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return mode === 'fail' ? Promise.reject(new Error('Denied')) : Promise.resolve(); } } });
      }, [who ? tokens[who] : null, clipboard]);
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const posts = []; page.on('request', (r) => { if (r.url().includes('/deposit-address-copies')) posts.push(r.method()); });
      const failed = []; page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      page.__failed = failed;
      return { context, page, errors, posts, failed };
    };
    const notes = (userId) => prisma.depositAddressCopyEvent.findMany({ where: { userId }, orderBy: { receivedAt: 'asc' } });
    const until = async (fn, ms = 8_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
    const openDeposit = async (page) => {
      await page.goto(origin + '/wallet');
      // The Wallet's own Deposit button (the header has another one).
      try { await page.getByRole('button', { name: 'Внести', exact: true }).first().click(); }
      catch (error) { await page.screenshot({ path: path.join(OUT, 'debug-wallet.png') }); console.error('API failures:', [...new Set(page.__failed)].join(', ')); throw error; }
      await page.getByTestId('deposit-address').waitFor();
    };
    await prisma.depositAddressCopyEvent.deleteMany({});

    // C1: copy → one note; preflight + POST cross-origin.
    let s = await open('u1');
    await openDeposit(s.page);
    await s.page.screenshot({ path: path.join(OUT, 'client-deposit-dialog-1440.png') });
    const opt0 = http.copyOptions, post0 = http.copyPosts, other0 = http.other;
    await s.page.getByRole('button', { name: 'Копировать адрес' }).click();
    await s.page.getByText('Адрес скопирован').first().waitFor();
    check('C1 the copy itself is unchanged: «Адрес скопирован»', (await s.page.evaluate(() => window.__copied)).includes(CAT_TRON));
    check('C1 one copy = one note, from the Wallet, the address that was copied', await until(async () => (await notes(ids.u1)).length === 1)
      && (await notes(ids.u1))[0].source === 'wallet' && (await notes(ids.u1))[0].addressSnapshot === CAT_TRON);
    report.oneCopy = { preflight: http.copyOptions - opt0, post: http.copyPosts - post0, otherApiRequests: http.other - other0 };
    check('C1 one copy, cross-origin: one CORS preflight + one POST, no other API request', report.oneCopy.post === 1 && report.oneCopy.preflight === 1 && report.oneCopy.otherApiRequests === 0, JSON.stringify(report.oneCopy));
    // Double press within 2 s: still one more note only.
    // Past the 2 s guard of the first copy, then two quick presses.
    await s.page.waitForTimeout(2_100);
    const before2 = (await notes(ids.u1)).length;
    await s.page.getByRole('button', { name: /Копировать адрес|Адрес скопирован/ }).click();
    await s.page.getByRole('button', { name: /Копировать адрес|Адрес скопирован/ }).click();
    await until(async () => (await notes(ids.u1)).length > before2, 3_000);
    check('C2 two presses in a row: one note', (await notes(ids.u1)).length === before2 + 1);
    // QR and memo: nothing.
    const n0 = (await notes(ids.u1)).length;
    await s.page.locator('.dc-qr-button').click(); await s.page.locator('.dc-qr-button').click();
    await s.page.locator('.dc-asset-trigger').click();
    await s.page.getByRole('option').filter({ hasText: 'XRP' }).click();
    await s.page.getByRole('button', { name: 'Копировать memo' }).click();
    await s.page.getByText('Memo скопировано').waitFor();
    await new Promise((r) => setTimeout(r, 1_500));
    check('C3 QR, coin change and Memo copy add no note', (await notes(ids.u1)).length === n0);
    // Copy then leave at once: the note still lands.
    await s.page.waitForTimeout(2_100);
    await s.page.getByRole('button', { name: 'Копировать адрес' }).click();
    await s.page.keyboard.press('Escape');
    await s.page.goto(origin + '/markets');
    check('C4 copy, close and navigate away at once: the note still lands', await until(async () => (await notes(ids.u1)).some((r) => r.asset === 'XRP' && r.memoSnapshot === '77')));
    await s.context.close();

    // C5: clipboard refused → no note.
    s = await open('u1', { clipboard: 'fail' });
    const n1 = (await notes(ids.u1)).length;
    await openDeposit(s.page);
    await s.page.getByRole('button', { name: 'Копировать адрес' }).click();
    await s.page.getByRole('alert').filter({ hasText: /скопировать/i }).first().waitFor();
    await new Promise((r) => setTimeout(r, 1_000));
    check('C5 a refused clipboard: error shown, no note', (await notes(ids.u1)).length === n1);
    await s.context.close();

    // C6: offline copy → waits; back online → one note.
    s = await open('u4');
    await openDeposit(s.page);
    await s.context.setOffline(true);
    await s.page.getByRole('button', { name: 'Копировать адрес' }).click();
    await s.page.getByText('Адрес скопирован').first().waitFor();
    await new Promise((r) => setTimeout(r, 500));
    const waiting = await s.page.evaluate(() => JSON.parse(localStorage.getItem('voltex.depositCopyOutbox.v1') || '[]').length);
    await s.context.setOffline(false);
    await s.page.evaluate(() => window.dispatchEvent(new Event('online')));
    check('C6 offline: kept on the device, sent once when the network returns', waiting === 1 && await until(async () => (await notes(ids.u4)).length === 1));
    await s.page.waitForTimeout(500);
    check('C6 the outbox is empty after delivery', (await s.page.evaluate(() => localStorage.getItem('voltex.depositCopyOutbox.v1'))) === null);

    // C7: offline copy as U4, then another account signs in: never sent as U5.
    await s.page.waitForTimeout(2_100);
    await s.context.setOffline(true);
    await s.page.getByRole('button', { name: /Копировать адрес|Адрес скопирован/ }).click();
    await new Promise((r) => setTimeout(r, 400));
    await s.page.evaluate((token) => { localStorage.setItem('exchange_token', token); window.dispatchEvent(new StorageEvent('storage', { key: 'exchange_token' })); }, tokens.u5);
    await s.context.setOffline(false);
    await s.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await new Promise((r) => setTimeout(r, 1_500));
    check('C7 an account switch drops the waiting note: nothing sent as the new account', (await notes(ids.u4)).length === 1 && (await notes(ids.u5)).length === 0
      && (await s.page.evaluate(() => localStorage.getItem('voltex.depositCopyOutbox.v1'))) === null);
    await s.context.close();

    // C8: a guest copies nothing to the server.
    s = await open(null);
    const guestPosts0 = http.copyPosts;
    await s.page.goto(origin + '/');
    await new Promise((r) => setTimeout(r, 800));
    check('C8 a guest page sends no note', http.copyPosts === guestPosts0);
    await s.context.close();

    // C9: the admin journal at three widths; 12 h with the section open.
    // A delayed note (device clock 10 min earlier) for the screenshots.
    await prisma.depositAddressCopyEvent.create({ data: { eventId: randomUUID(), userId: ids.u3, asset: 'USDT', network: 'tron', destinationId: 'tether:tron',
      addressSnapshot: CAT_TRON, source: 'otc', clientCopiedAt: new Date(Date.now() - 10 * 60_000) } });
    for (const [width, height] of [[1440, 900], [390, 844], [320, 700]]) {
      s = await open('admin', { width, height });
      await s.page.clock.install();
      await s.page.goto(origin + '/admin/deposits');
      await s.page.locator('[data-deposit-view="copies"]').waitFor();
      const reads0 = http.copyAdminReads;
      await s.page.locator('[data-deposit-view="copies"]').click();
      await s.page.locator('[data-copy-row]').first().waitFor();
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await s.page.screenshot({ path: path.join(OUT, `admin-copies-${width}.png`), fullPage: width > 500 });
      check(`C9 journal at ${width}px: rows, Kyiv time, no sideways scroll`, (await s.page.locator('[data-copy-row]').count()) >= 4
        && (await s.page.getByText('Время — Киев').count()) === 1 && overflow <= 0, `overflow ${overflow}`);
      if (width === 1440) {
        await s.page.locator('[data-copy-row]').first().getByRole('button', { name: 'Показать полностью' }).click();
        await s.page.screenshot({ path: path.join(OUT, 'admin-copies-1440-expanded.png') });
        await s.page.clock.fastForward(12 * 60 * 60_000);
        await s.page.waitForTimeout(300);
        check('C10 12 hours with the journal open: no read of its own', http.copyAdminReads === reads0 + 1, `reads ${http.copyAdminReads - reads0}`);
        // After 12 h the tab is asleep (the app's own idle rule). A first
        // touch wakes it; then «Обновить» reads the journal once.
        const asleep = await s.page.locator('[data-browser-phase]').getAttribute('data-browser-phase', { timeout: 2_000 }).catch(() => null);
        await s.page.mouse.click(8, 8);
        await s.page.waitForFunction(() => !document.querySelector('[data-browser-phase]'), null, { timeout: 15_000 }).catch(() => {});
        report.notes.push(`After 12 h the admin tab was «${asleep}»; one click woke it before «Обновить».`);
        await s.page.locator('[data-copies-refresh]').click();
        await until(async () => http.copyAdminReads >= reads0 + 2, 15_000);
        await s.page.waitForTimeout(500);
        await s.page.screenshot({ path: path.join(OUT, 'admin-copies-after-12h-refresh.png') });
        check('C10 «Обновить» reads once', http.copyAdminReads === reads0 + 2, `reads ${http.copyAdminReads - reads0}, phase ${await s.page.locator('[data-browser-phase]').getAttribute('data-browser-phase').catch(() => 'active')}`);
      }
      check(`C9 ${width}px: no page errors`, s.errors.length === 0, s.errors.join(' | '));
      await s.context.close();
    }

    // C11: the manual credit in the browser, on a test account (U4, no prior balance).
    s = await open('admin', { width: 1440, height: 900 });
    await s.page.goto(origin + '/admin/deposits');
    await s.page.locator('[data-deposit-tab="ready"]').click();
    await s.page.locator('[data-open-package]').first().click();
    await s.page.locator('[data-credit-drawer] [data-package-total]').waitFor();
    await s.page.screenshot({ path: path.join(OUT, 'admin-credit-drawer-1440.png') });
    const drawerText = await s.page.locator('[data-credit-drawer]').innerText();
    check('C11 the drawer names the test account and its exact package', drawerText.includes('maria@example.invalid') && drawerText.includes(ids.u4)
      && (await s.page.locator('[data-credit-drawer] [data-package-total]').innerText()).startsWith('300') && (await s.page.locator('[data-credit-drawer] [data-balance-after]').innerText()) === '300');
    await s.page.locator('[data-confirm-credit]').click();
    await s.page.getByText(/Зачислено 300 USDT/).waitFor();
    await s.page.screenshot({ path: path.join(OUT, 'admin-credit-done-1440.png') });
    const u4 = await prisma.balance.findUnique({ where: { userId_asset: { userId: ids.u4, asset: 'USDT' } } });
    check('C11 confirmed in the browser: exactly 300 USDT on the chosen account', u4?.available.toString() === '300' && u4.locked.toString() === '0');
    await s.context.close();
    s = await open('u4', { width: 1440, height: 900 });
    await s.page.goto(origin + '/wallet');
    await s.page.getByText('300', { exact: false }).first().waitFor();
    await s.page.screenshot({ path: path.join(OUT, 'client-wallet-after-credit-1440.png') });
    await s.context.close();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
