/** Issue #699 acceptance — «Нове надходження» must mean a new on-chain receipt.
 *
 * Real, disposable PostgreSQL (a new temporary cluster from QA699_PG_BIN, loopback
 * only), the COMPILED production watcher and notification signer (dist/), the REAL
 * notification Worker code (workers/notification-edge/src/core.js) with in-memory
 * Durable Object storage, a LOCAL TronGrid fixture and a fake Telegram.
 * It never reads DATABASE_URL, never contacts TronGrid, Cloudflare, Telegram or
 * production, and moves no funds. A pass here is not production evidence.
 *
 * Usage: npm run build && QA699_PG_BIN="$(pg_config --bindir)" node scripts/qa-deposit-notice-699.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const express = require('express');
const BigNumber = require('bignumber.js');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.env.QA699_OUT || 'output/deposit-notice-699');
fs.mkdirSync(out, { recursive: true });

// One shifted clock for the API and the Worker (same process). PostgreSQL keeps real time.
const realNow = Date.now.bind(Date);
let shiftMs = 0;
Date.now = () => realNow() + shiftMs;

process.env.JWT_SECRET = 'isolated-notice-699-fixture-not-a-production-secret';
for (const name of ['DEPOSIT_NOTICE_FRESH_HOURS', 'DEPOSIT_NOTICE_MICRO_TRX', 'DEPOSIT_NOTICE_MICRO_USDT', 'DEPOSIT_NOTICE_DIGEST', 'DATABASE_URL']) delete process.env[name];

const { DepositWatchService } = require('../dist/services/deposits/DepositWatchService');
const { notifyDeposit, notifyDepositDigest, notificationPublicKey } = require('../dist/services/TelegramNotifications');
const { noticePolicyFromEnv } = require('../dist/services/deposits/depositNoticePolicy');

const T = '41' + '11'.repeat(20), OTHER = '41' + '22'.repeat(20), TOKEN = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const H = (n) => BigInt(n).toString(16).padStart(64, '0');
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const kyiv = (ms) => new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const run = (bin, args, stdio = 'pipe') => spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120_000 });
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function startDatabase() {
  const configured = process.env.QA699_PG_BIN;
  assert(configured && path.isAbsolute(configured), 'QA699_PG_BIN must be the absolute PostgreSQL tool directory (never a database URL)');
  const bin = Object.fromEntries(['initdb', 'pg_ctl', 'psql'].map((name) => [name, path.join(fs.realpathSync(configured), name)]));
  for (const tool of Object.values(bin)) assert(fs.statSync(tool).isFile(), `Missing PostgreSQL tool: ${tool}`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-notice-699-'));
  const dir = path.join(base, 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(base, 'pg-ctl.log'), 'w');
  let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${base}`, 'start', '-w'], ['ignore', fd, fd]); }
  finally { fs.closeSync(fd); }
  assert.equal(start.status, 0, 'temporary PostgreSQL did not start');
  const psql = (args) => run(bin.psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t', ...args]);
  return { url: `postgresql://postgres@127.0.0.1:${port}/postgres`, psql,
    stop: () => { const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); fs.rmSync(base, { recursive: true, force: true }); assert.equal(stop.status, 0, stop.stderr); } };
}

/** The real Worker entry (`handle`) over in-memory Durable Object storage that
 * survives a simulated Worker restart, with a switchable fake Telegram. */
async function workerFixture() {
  const core = await import(pathToFileURL(path.join(root, 'workers/notification-edge/src/core.js')).href);
  const telegram = { mode: 'ok', sent: [], attempts: 0 };
  const send = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/botfixture-token\/sendMessage$/);
    telegram.attempts++;
    if (telegram.mode === 'timeout') throw new Error('fixture timeout after the request left');
    if (telegram.mode === 'reject') return Response.json({ ok: false, error_code: 429 }, { status: 429 });
    telegram.sent.push(JSON.parse(init.body).text);
    return Response.json({ ok: true, result: { message_id: telegram.sent.length } });
  };
  const stores = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) {
      let record, lock = Promise.resolve();
      const s = { get: async () => record, put: async (_k, v) => { record = structuredClone(v); }, setAlarm: async () => {}, deleteAll: async () => { record = undefined; },
        transaction: (fn) => { const r = lock.then(() => fn(s)); lock = r.catch(() => {}); return r; } };
      stores.set(name, s);
    }
    return stores.get(name);
  };
  let objects = new Map();
  const base = { TELEGRAM_BOT_TOKEN: 'fixture-token', TELEGRAM_CHAT_ID: 'fixture-chat', DEPOSIT_SIGNING_PUBLIC_KEY: notificationPublicKey() };
  const env = { ...base, EVENTS: { idFromName: (name) => name, get: (name) => ({ fetch: (request) => {
    if (!objects.has(name)) objects.set(name, new core.Delivery({ storage: storeFor(name) }, base, send));
    return objects.get(name).fetch(request);
  } }) } };
  const link = { mode: 'new', requests: [] };
  /** fetch used by the API signer: routes the signed request into the Worker. */
  const fetchWorker = async (url, init) => {
    const { pathname, origin } = new URL(String(url));
    assert.equal(origin, 'https://notify.voltextech.net');
    link.requests.push({ pathname, body: JSON.parse(init.body) });
    if (link.mode === 'down') throw new Error('fixture: Worker unreachable');
    // The Worker deployed before #699: unknown fields and routes are refused.
    // The Worker answers that this exact digest is malformed (no retry can deliver it).
    if (link.mode === 'invalid-digest' && pathname === '/v1/deposit-digest') return Response.json({ status: 'INVALID_EVENT' }, { status: 400 });
    if (link.mode === 'pre699') return pathname === '/v1/deposit' ? Response.json({ status: 'INVALID_EVENT' }, { status: 400 }) : Response.json({ status: 'NOT_FOUND' }, { status: 404 });
    return core.handle(new Request(String(url), { method: init.method, headers: init.headers, body: init.body }), env);
  };
  return { telegram, link, fetchWorker, restartWorker: () => { objects = new Map(); }, claims: () => stores.size };
}

async function main() {
  const database = await startDatabase();
  let prisma, server;
  const checks = [];
  const test = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  try {
    for (const dir of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', dir, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const applied = database.psql(['-f', file]);
      assert.equal(applied.status, 0, `${dir}: ${applied.stderr}`);
    }
    prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
    const user = await prisma.user.create({ data: { email: 'notice699@example.invalid', passwordHash: 'fixture-only', referralCode: 'notice699', role: 'USER' } });
    await prisma.balance.create({ data: { userId: user.id, asset: 'USDT', available: '321.123' } });
    await prisma.balance.create({ data: { userId: user.id, asset: 'TRX', available: '77' } });
    await prisma.demoBalance.create({ data: { userId: user.id, asset: 'USDT', available: '1000' } });
    const encode = (x) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const financial = async () => encode({ balance: await prisma.balance.findMany({ orderBy: { id: 'asc' } }), demo: await prisma.demoBalance.findMany({ orderBy: { id: 'asc' } }),
      futures: await prisma.futuresBalance.count(), batches: await prisma.depositBatch.count(), withdrawals: await prisma.withdrawal.count(), referrals: await prisma.referralReward.count() });
    const baseline = await financial();
    // FIXTURE ONLY: the temporary database follows the same shifted clock as the
    // API and the Worker, so «a day later» is consistent everywhere. Production
    // rows keep the database's own insertion time; no trigger exists there.
    const fixtureClock = database.psql(['-c', `CREATE TABLE qa_clock (shift_ms bigint NOT NULL); INSERT INTO qa_clock VALUES (0);
      CREATE FUNCTION qa_shift_created() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW."createdAt" := NEW."createdAt" + make_interval(secs => (SELECT shift_ms FROM qa_clock) / 1000.0); RETURN NEW; END $$;
      CREATE TRIGGER qa_shift_deposit BEFORE INSERT ON "Deposit" FOR EACH ROW EXECUTE FUNCTION qa_shift_created();
      CREATE TRIGGER qa_shift_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION qa_shift_created();`]);
    assert.equal(fixtureClock.status, 0, fixtureClock.stderr);
    const advance = async (ms) => { shiftMs += ms; await prisma.$executeRawUnsafe(`UPDATE qa_clock SET shift_ms = ${Math.trunc(shiftMs)}`); };

    // ── Local TronGrid ────────────────────────────────────────────────────
    const start = realNow();
    let head = 90_000_000, outage = false;
    const txs = [];
    /** `age` = how long before the current (fixture) time the transaction was mined. */
    const add = (n, asset, sun, age, extra = {}) => { const t = { n, id: H(n), asset, sun: String(sun), to: T, ts: Date.now() - age, finalized: true, success: true, ...extra };
      t.block = t.block ?? head - Math.max(19, Math.round(age / 3000)); txs.push(t); return t; };
    const native = (t) => ({ txID: t.id, block_timestamp: t.ts, blockNumber: t.block, ret: [{ contractRet: t.success ? 'SUCCESS' : 'REVERT' }],
      raw_data: { contract: [{ type: 'TransferContract', parameter: { type_url: 'type.googleapis.com/protocol.TransferContract', value: { owner_address: '41' + '55'.repeat(20), to_address: t.to, amount: Number(t.sun) } } }] } });
    const app = express(); app.use(express.json());
    const listed = [];
    app.use((req, res, next) => { if (outage) return res.status(503).json({ error: 'fixture outage' }); next(); });
    app.get(['/v1/accounts/:address/transactions', '/v1/accounts/:address/transactions/trc20'], (req, res) => {
      listed.push(req.params.address);
      const token = req.path.endsWith('/trc20');
      let rows = txs.filter((t) => (token ? t.asset === 'USDT' : t.asset === 'TRX')).sort((a, b) => a.ts - b.ts);
      if (req.query.min_timestamp) rows = rows.filter((t) => t.ts >= Number(req.query.min_timestamp));
      if (req.query.max_timestamp) rows = rows.filter((t) => t.ts <= Number(req.query.max_timestamp));
      if (!token) rows = rows.filter((t) => t.finalized); // only_confirmed=true
      const offset = Number(req.query.fingerprint || 0), limit = Number(req.query.limit || 200), page = rows.slice(offset, offset + limit);
      // A provider may list the same transfer twice (overlap, reorg replay): the watcher must store it once.
      const items = page.flatMap((t) => { const item = token ? { transaction_id: t.id, to: t.to, value: t.sun, block_timestamp: t.ts, token_info: { address: TOKEN } } : native(t); return t.listTwice ? [item, item] : [item]; });
      res.json({ success: true, data: items, meta: offset + limit < rows.length ? { fingerprint: String(offset + limit) } : {} });
    });
    app.all('/wallet/getnowblock', (_req, res) => res.json({ block_header: { raw_data: { number: head } } }));
    app.post(['/wallet/gettransactionbyid', '/walletsolidity/gettransactionbyid'], (req, res) => { const t = txs.find((x) => x.id === req.body.value); res.json(!t || (req.path.includes('solidity') && !t.finalized) ? {} : native(t)); });
    app.post(['/wallet/gettransactioninfobyid', '/walletsolidity/gettransactioninfobyid'], (req, res) => {
      const t = txs.find((x) => x.id === req.body.value);
      if (!t || (req.path.includes('solidity') && !t.finalized)) return res.json({});
      const token = t.asset === 'USDT';
      res.json({ id: t.id, blockNumber: t.block, blockTimeStamp: t.ts, ...(!t.success ? { result: 'FAILED' } : {}), receipt: token ? { result: t.success ? 'SUCCESS' : 'REVERT' } : { net_usage: 268 },
        ...(token ? { log: [{ address: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c', topics: [TOPIC, '0'.repeat(64), '0'.repeat(24) + t.to.slice(2)], data: BigInt(t.sun).toString(16).padStart(64, '0') }] } : {}) });
    });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const config = { chain: 'tron', type: 'tron', treasuryAddress: T, nativeAsset: 'TRX', minConfirmations: 19, tokens: { USDT: { contractAddress: TOKEN, decimals: 6 } }, apiUrl: origin };
    const fetchChain = (url, init) => { assert.equal(new URL(String(url)).origin, origin, 'external network forbidden'); return fetch(url, init); };

    const worker = await workerFixture();
    const { telegram, link } = worker;
    // Local fixture limits only: one run may finish a 7-day backfill. Production budgets are unchanged.
    const limits = { pageSize: 50, initialBackfillMs: 7 * DAY, maxPagesPerRun: 80, maxProviderCallsPerRun: 600, maxVerificationsPerRun: 60, anonymousRequestIntervalMs: 0, maxRunMs: 120_000 };
    let failAck = null; // inject one failure on a given AuditLog write, AFTER the Worker answered
    const auditProxy = new Proxy(prisma.auditLog, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'upsert') return async (args) => { if (failAck === 'fresh' && args.create?.action === 'DEPOSIT_NOTIFICATION_DELIVERY') { failAck = null; throw new Error('fixture crash after the Worker delivered'); } return target.upsert(args); };
      if (key === 'createMany') return (args) => { if (failAck === 'digest' && args.data?.[0]?.action === 'DEPOSIT_NOTICE_DIGEST_DELIVERY') { failAck = null; throw new Error('fixture crash after the Worker delivered the digest'); } return target.createMany(args); };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const client = new Proxy(prisma, { get(target, key) {
      if (key === 'auditLog') return auditProxy;
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const makeWatch = (policy = noticePolicyFromEnv({})) => new DepositWatchService(client, async () => config, fetchChain, () => Date.now(), limits,
      (transfer) => notifyDeposit(transfer, worker.fetchWorker), (digest) => notifyDepositDigest(digest, worker.fetchWorker), policy);
    let watch = makeWatch();
    const scan = async () => { const r = await watch.runOnce('admin'); assert.equal(r.ok, true, r.error || 'scan failed'); return r; };
    const deposit = (n) => prisma.deposit.findUnique({ where: { chain_txHash: { chain: 'tron', txHash: H(n) } } });
    const notice = async (n) => { const d = await deposit(n); return d ? prisma.auditLog.findUnique({ where: { id: `deposit-notice:${d.id}` } }) : null; };
    const fresh = () => telegram.sent.filter((t) => t.startsWith('Нове надходження'));
    const digests = () => telegram.sent.filter((t) => t.startsWith('Зведення перевірки надходжень'));
    const noSecretsInLog = [];
    const realInfo = console.info, realWarn = console.warn;
    console.info = (...a) => { noSecretsInLog.push(a.join(' ')); }; console.warn = (...a) => { noSecretsInLog.push(a.join(' ')); };

    // The incident SHAPE with synthetic values: five native dust transfers 14–15 h
    // before the scan, plus older history and real receipts. No real transaction,
    // amount or time is used anywhere in this file.
    add(1, 'TRX', 1500250000, 3 * DAY + 12 * HOUR);          // real amount, but already 3.5 days old when first recorded
    add(2, 'TRX', 2, 5 * DAY);                                // old dust
    add(3, 'USDT', 500_000000, 6 * DAY);                      // old real USDT
    add(4, 'USDT', 1010_000000, 30 * MIN, { listTwice: true }); // new real USDT (listed twice by the provider)
    add(5, 'TRX', 25_000000, 14 * HOUR);                      // new real TRX sent after the last evening scan
    for (const [n, sun, age] of [[6, 5, 15 * HOUR], [7, 2, 14 * HOUR + 50 * MIN], [8, 4, 14 * HOUR + 40 * MIN], [9, 1, 14 * HOUR + 30 * MIN], [10, 3, 13 * HOUR + 45 * MIN]]) add(n, 'TRX', sun, age);
    add(11, 'USDT', 1, 2 * HOUR);                             // 0.000001 USDT dust
    add(12, 'USDT', 3_000000, 10 * MIN, { finalized: false, block: head - 3 }); // mined, not yet irreversible
    add(13, 'TRX', 5_000000, 4 * HOUR, { to: OTHER });        // not ours
    add(14, 'TRX', 6_000000, 4 * HOUR, { success: false });   // failed on chain

    await test('first scan of a watched address: only genuinely new receipts are announced, each once, with the chain time', async () => {
      const r = await scan();
      assert.equal(r.backlog, false, 'fixture limits let one run finish the 7-day backfill');
      assert.deepEqual(fresh().map((t) => t.split('\n')[0]).sort(), ['Нове надходження: 1010 USDT', 'Нове надходження: 25 TRX']);
      const usdt = fresh().find((t) => t.includes('USDT')), trx = fresh().find((t) => t.includes('25 TRX'));
      const d4 = await deposit(4), d5 = await deposit(5);
      assert.equal(usdt, ['Нове надходження: 1010 USDT', '', 'Мережа: TRON (TRC-20)', `Час транзакції: ${kyiv(txs[3].ts)} (Київ)`, `Виявлено: ${kyiv(d4.createdAt.getTime())} (Київ)`,
        `TXID: ${H(4)}`, `Підтвердження: ${d4.confirmations} (мінімум 19)`, 'Статус: підтверджено в блокчейні; очікує ручної перевірки'].join('\n'));
      assert.equal(trx.split('\n').slice(0, 5).join('\n'), ['Нове надходження: 25 TRX', '', 'Мережа: TRON (Native)', `Час транзакції: ${kyiv(txs[4].ts)} (Київ)`, `Виявлено: ${kyiv(d5.createdAt.getTime())} (Київ)`].join('\n'));
      assert.equal(d4.blockTimestamp.getTime(), txs[3].ts); assert.equal(d5.blockTimestamp.getTime(), txs[4].ts);
      assert.equal(r.notices.fresh, 2); assert.equal(r.notices.sent, 2);
    });
    await test('five native dust transfers, old dust, USDT dust and old real transfers: ONE digest, never «Нове надходження»', async () => {
      assert.equal(digests().length, 1);
      const text = digests()[0];
      const dust = txs.filter((t) => [2, 6, 7, 8, 9, 10].includes(t.n));
      assert.equal(text, ['Зведення перевірки надходжень', '',
        'Мікроперекази (менше 1 TRX; можливий dust): 6 шт., разом 0.000017 TRX', 'Мережа: TRON (Native)',
        `Час транзакцій: ${kyiv(Math.min(...dust.map((t) => t.ts)))} – ${kyiv(Math.max(...dust.map((t) => t.ts)))} (Київ)`, '',
        'Мікроперекази (менше 1 USDT; можливий dust): 1 шт., разом 0.000001 USDT', 'Мережа: TRON (TRC-20)', `Час транзакцій: ${kyiv(txs.find((t) => t.n === 11).ts)} (Київ)`, '',
        'Старі перекази, вперше знайдені зараз: 1 шт., разом 1500.25 TRX', 'Мережа: TRON (Native)', `Час транзакцій: ${kyiv(txs[0].ts)} (Київ)`, '',
        'Старі перекази, вперше знайдені зараз: 1 шт., разом 500 USDT', 'Мережа: TRON (TRC-20)', `Час транзакцій: ${kyiv(txs[2].ts)} (Київ)`, '',
        'Окремі сповіщення про ці перекази не надсилаються.',
        'Нічого не зараховано автоматично; усі записи збережено в адмінці («Пополнения») для ручної перевірки.'].join('\n'));
      assert.equal(telegram.sent.length, 3, 'two real receipts + one digest; not one message per transfer');
      assert.doesNotMatch(text, /[a-f0-9]{64}|TXID/);
      for (const n of [1, 2, 3, 6, 7, 8, 9, 10, 11]) {
        const record = await notice(n);
        assert.equal(record.action, 'DEPOSIT_NOTICE_DIGESTED', `tx ${n}`);
        assert.equal(record.metadata.noticeClass, [1, 3].includes(n) ? 'HISTORICAL' : 'MICRO');
        assert.equal(record.metadata.deliveryStatus, 'SENT');
        assert.match(record.metadata.digestId, /^deposit-digest:tron:\d{4}-\d{2}-\d{2}$/);
      }
      for (const n of [4, 5]) { const record = await notice(n); assert.equal(record.action, 'DEPOSIT_NOTIFICATION_DELIVERY'); assert.equal(record.metadata.noticeClass, 'FRESH'); }
    });
    await test('old transfers and dust stay in the database for the admin: proven, PENDING, unattributed, never ignored, hidden or deleted', async () => {
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
        const d = await deposit(n);
        assert.ok(d, `tx ${n} stored`); assert.equal(d.status, 'PENDING'); assert.equal(d.userId, null); assert.equal(d.ignoredAt, null);
        assert.ok(d.verifiedAt && d.finalized && d.verifyError === null); assert.equal(d.blockTimestamp.getTime(), txs.find((t) => t.n === n).ts);
      }
      assert.equal((await deposit(1)).amount.toString(), '1500.25');
      assert.equal(new BigNumber((await deposit(6)).amount.toString()).toFixed(), '0.000005');
      assert.equal(await deposit(13), null, 'another recipient is never stored'); assert.equal(await deposit(14), null, 'a failed native transaction is never stored');
      assert.equal(await prisma.deposit.count({ where: { txHash: H(4) } }), 1, 'a transfer listed twice is one row');
    });
    await test('mined but not yet irreversible: no message until finality, then exactly one with the ORIGINAL chain time', async () => {
      const pending = await deposit(12);
      assert.equal(pending.finalized, false); assert.equal(await notice(12), null);
      assert.equal(telegram.sent.some((t) => t.includes(H(12))), false);
      const before = telegram.sent.length;
      await advance(3 * HOUR); head += 3600; txs.find((t) => t.n === 12).finalized = true; // confirmation arrives three hours late
      watch = makeWatch(); await scan();
      assert.equal(telegram.sent.length, before + 1);
      const text = telegram.sent[before];
      assert.match(text, /^Нове надходження: 3 USDT\n/);
      assert.ok(text.includes(`Час транзакції: ${kyiv(txs.find((t) => t.n === 12).ts)} (Київ)`), 'late confirmation keeps the real transaction time');
      assert.equal((await notice(12)).metadata.noticeClass, 'FRESH');
    });
    await test('rescan, API restart, redeploy and Worker restart: nothing is announced twice', async () => {
      const sent = telegram.sent.length, rows = await prisma.deposit.count(), journal = await prisma.auditLog.count();
      for (let i = 0; i < 4; i++) { await advance(5 * MIN); if (i % 2) worker.restartWorker(); watch = makeWatch(); const r = await scan(); assert.equal(r.notices.sent, 0); assert.equal(r.notices.digested, 0); }
      // A redeploy that replays every announced receipt directly at the Worker still cannot send.
      for (const n of [4, 5, 12]) { const row = await deposit(n); assert.equal(await notifyDeposit({ ...row, requiredConfirmations: 19 }, worker.fetchWorker), 'SENT', 'DUPLICATE of the original SENT'); }
      assert.equal(telegram.sent.length, sent); assert.equal(await prisma.deposit.count(), rows); assert.equal(await prisma.auditLog.count(), journal);
    });
    await test('rows already announced by the release before #699 keep their record and are never sent again', async () => {
      const legacy = await prisma.deposit.create({ data: { chain: 'tron', txHash: H(900), asset: 'TRX', amount: '40', status: 'PENDING', source: 'watcher', recipientAddress: T,
        confirmations: 30, finalized: true, verifiedAt: new Date(Date.now()), blockTimestamp: new Date(Date.now() - HOUR) } });
      await prisma.auditLog.create({ data: { id: `deposit-notice:${legacy.id}`, action: 'DEPOSIT_NOTIFICATION_DELIVERY', metadata: { depositId: legacy.id, asset: 'TRX', chain: 'tron', deliveryStatus: 'SENT' } } });
      const sent = telegram.sent.length; await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent);
    });
    await test('more dust the same day adds no Telegram message; the next Kyiv day gets exactly one digest for it', async () => {
      const sent = telegram.sent.length;
      add(20, 'TRX', 4, 60_000); add(21, 'TRX', 7, 40_000); add(22, 'USDT', 9, 20_000);
      await advance(5 * MIN); let r = await scan();
      assert.equal(telegram.sent.length, sent, 'no message for dust after today\'s digest'); assert.equal(r.notices.digest, 'ALREADY_TODAY'); assert.equal(r.notices.micro, 3);
      for (const n of [20, 21, 22]) { assert.ok(await deposit(n), 'dust is stored'); assert.equal(await notice(n), null); }
      await advance(5 * MIN); r = await scan(); assert.equal(telegram.sent.length, sent);
      await advance(DAY); head += 28_800; watch = makeWatch(); r = await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.equal(r.notices.digest, 'SENT'); assert.equal(r.notices.digested, 3);
      assert.match(telegram.sent[sent], /^Зведення перевірки надходжень\n\nМікроперекази \(менше 1 TRX; можливий dust\): 2 шт\., разом 0\.000011 TRX\n[\s\S]*Мікроперекази \(менше 1 USDT; можливий dust\): 1 шт\., разом 0\.000009 USDT\n/);
      await advance(5 * MIN); await scan(); worker.restartWorker(); await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent + 1);
    });
    await test('notification Worker unreachable: a real receipt is not lost and is sent exactly once when it returns', async () => {
      const sent = telegram.sent.length;
      add(30, 'USDT', 250_000000, MIN);
      link.mode = 'down'; await advance(5 * MIN); let r = await scan();
      assert.equal(telegram.sent.length, sent); assert.equal(r.notices.fresh, 1); assert.equal(r.notices.sent, 0); assert.equal(await notice(30), null);
      await advance(5 * MIN); r = await scan(); assert.equal(telegram.sent.length, sent);
      link.mode = 'new'; await advance(5 * MIN); r = await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.match(telegram.sent[sent], /^Нове надходження: 250 USDT\n/); assert.equal(r.notices.sent, 1);
      await advance(5 * MIN); await scan(); assert.equal(telegram.sent.length, sent + 1);
    });
    await test('cutover order: the Worker from before #699 refuses the new event, so nothing is lost or mislabelled; the new Worker then sends it once', async () => {
      const sent = telegram.sent.length;
      add(31, 'TRX', 80_000000, MIN);
      link.mode = 'pre699'; await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent); assert.equal(await notice(31), null);
      link.mode = 'new'; await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.match(telegram.sent[sent], /^Нове надходження: 80 TRX\n\nМережа: TRON \(Native\)\nЧас транзакції: /);
    });
    await test('API crash after the Worker delivered but before the record was written: the replay is the SAME event, one message', async () => {
      const sent = telegram.sent.length, attempts = telegram.attempts;
      add(32, 'USDT', 700_000000, MIN);
      failAck = 'fresh'; await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.equal(await notice(32), null, 'no record yet: the row is still due');
      await advance(5 * MIN); watch = makeWatch(); await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.equal(telegram.attempts, attempts + 1, 'Telegram was called once');
      assert.equal((await notice(32)).metadata.deliveryStatus, 'SENT');
    });
    await test('ambiguous Telegram timeout: never a second attempt (existing at-most-once rule), outcome recorded as UNKNOWN', async () => {
      const sent = telegram.sent.length, attempts = telegram.attempts;
      add(33, 'TRX', 90_000000, MIN);
      telegram.mode = 'timeout'; await advance(5 * MIN); await scan(); telegram.mode = 'ok';
      assert.equal(telegram.attempts, attempts + 1); assert.equal((await notice(33)).metadata.deliveryStatus, 'UNKNOWN');
      await advance(5 * MIN); await scan(); worker.restartWorker(); await advance(5 * MIN); await scan();
      assert.equal(telegram.attempts, attempts + 1); assert.equal(telegram.sent.length, sent);
      assert.ok(await deposit(33), 'the transfer itself is stored for the admin');
    });
    await test('digest under failures: Worker down → pending; crash after delivery → replay is DUPLICATE; one digest in Telegram', async () => {
      await advance(DAY); head += 28_800; watch = makeWatch();
      add(40, 'TRX', 5, 30 * MIN); add(41, 'TRX', 6, 20 * MIN);
      const sent = telegram.sent.length, attempts = telegram.attempts;
      link.mode = 'down'; let r = await scan();
      assert.equal(r.notices.digest, 'PENDING'); assert.equal(telegram.sent.length, sent);
      const claims = await prisma.auditLog.findMany({ where: { action: 'DEPOSIT_NOTICE_DIGEST_CLAIMED' }, orderBy: { createdAt: 'asc' } });
      const open = claims[claims.length - 1];
      assert.equal(open.metadata.depositIds.length, 2); assert.equal(await notice(40), null);
      add(42, 'TRX', 8, MIN); // arrives while the claim is open: it must wait for a later digest
      link.mode = 'new'; failAck = 'digest'; await advance(5 * MIN); r = await scan();
      assert.equal(telegram.sent.length, sent + 1, 'the claimed digest reached Telegram'); assert.equal(await notice(40), null, 'crash before the record');
      assert.match(telegram.sent[sent], /Мікроперекази \(менше 1 TRX; можливий dust\): 2 шт\., разом 0\.000011 TRX/);
      await advance(5 * MIN); watch = makeWatch(); r = await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.equal(telegram.attempts, attempts + 1, 'the replay did not call Telegram');
      assert.equal(r.notices.digest, 'SENT'); assert.equal((await notice(40)).metadata.digestId, open.id); assert.equal((await notice(41)).metadata.deliveryStatus, 'SENT');
      assert.equal(await notice(42), null, 'not part of the delivered digest');
      await advance(5 * MIN); r = await scan(); assert.equal(r.notices.digest, 'ALREADY_TODAY'); assert.equal(telegram.sent.length, sent + 1);
      await advance(DAY); head += 28_800; watch = makeWatch(); r = await scan();
      assert.equal(telegram.sent.length, sent + 2); assert.match(telegram.sent[sent + 1], /Мікроперекази \(менше 1 TRX; можливий dust\): 1 шт\., разом 0\.000008 TRX/);
    });
    await test('TronGrid outage: no message, no invented row, cursors kept; the next scan continues', async () => {
      const sent = telegram.sent.length, rows = await prisma.deposit.count();
      const before = encode(await prisma.depositWatchCursor.findMany({ orderBy: { id: 'asc' } }));
      add(50, 'USDT', 120_000000, MIN);
      outage = true; await advance(5 * MIN); const failed = await watch.runOnce('admin'); outage = false;
      assert.equal(failed.ok, false); assert.equal(telegram.sent.length, sent); assert.equal(await prisma.deposit.count(), rows);
      const after = await prisma.depositWatchCursor.findMany({ orderBy: { id: 'asc' } });
      for (const c of after) assert.equal(c.scannedThroughMs.toString(), JSON.parse(before).find((p) => p.id === c.id).scannedThroughMs);
      await advance(5 * MIN); await scan();
      assert.equal(telegram.sent.length, sent + 1); assert.match(telegram.sent[sent], /^Нове надходження: 120 USDT\n/);
    });
    await test('digest switched off: dust and history are journalled without any Telegram call', async () => {
      const sent = telegram.sent.length, attempts = telegram.attempts, requests = link.requests.length;
      add(60, 'TRX', 3, MIN); add(61, 'USDT', 2, MIN);
      watch = makeWatch(noticePolicyFromEnv({ DEPOSIT_NOTICE_DIGEST: 'off' })); await advance(5 * MIN); const r = await scan();
      assert.equal(r.notices.digest, 'OFF'); assert.equal(telegram.sent.length, sent); assert.equal(telegram.attempts, attempts); assert.equal(link.requests.length, requests);
      for (const n of [60, 61]) { const record = await notice(n); assert.equal(record.action, 'DEPOSIT_NOTICE_SUPPRESSED'); assert.equal(record.metadata.noticeClass, 'MICRO'); assert.ok(await deposit(n)); }
      watch = makeWatch();
    });
    await test('recorded three days late while the address was already watched (scanner pause): still ONE new-receipt alert with the real time', async () => {
      const sent = telegram.sent.length;
      const late = add(70, 'USDT', 333_000000, MIN);
      await advance(3 * DAY); head += 86_400; watch = makeWatch(); const r = await scan();
      const row = await deposit(70);
      assert.ok(row.createdAt.getTime() - row.blockTimestamp.getTime() > 2 * DAY, 'recorded more than 48 h after the block');
      assert.equal(telegram.sent.length, sent + 1); assert.equal(r.notices.fresh, 1); assert.equal(r.notices.historical, 0);
      assert.match(telegram.sent[sent], /^Нове надходження: 333 USDT\n/); assert.ok(telegram.sent[sent].includes(`Час транзакції: ${kyiv(late.ts)} (Київ)`));
      await advance(5 * MIN); await scan(); assert.equal(telegram.sent.length, sent + 1);
    });
    await test('an old TXID entered by an admin is history: no «Нове надходження», one line in the digest, row kept', async () => {
      const sent = telegram.sent.length;
      const old = await prisma.deposit.create({ data: { chain: 'tron', txHash: H(901), asset: 'TRX', amount: '900', status: 'PENDING', source: 'admin_check', recipientAddress: T,
        confirmations: 90_000, finalized: true, verifiedAt: new Date(Date.now()), blockTimestamp: new Date(Date.now() - 3 * DAY) } });
      await advance(5 * MIN); const r = await scan();
      assert.equal(r.notices.historical, 1); assert.equal(r.notices.fresh, 0);
      assert.equal(telegram.sent.length, sent + 1);
      assert.match(telegram.sent[sent], /^Зведення перевірки надходжень\n\nСтарі перекази, вперше знайдені зараз: 1 шт\., разом 900 TRX\nМережа: TRON \(Native\)\nЧас транзакцій: /);
      assert.equal((await prisma.auditLog.findUnique({ where: { id: `deposit-notice:${old.id}` } })).metadata.noticeClass, 'HISTORICAL');
      assert.equal((await prisma.deposit.findUnique({ where: { id: old.id } })).status, 'PENDING');
    });
    await test('an earlier day\'s digest delivered late still counts as today\'s one message', async () => {
      await advance(DAY); head += 28_800; watch = makeWatch();
      add(80, 'TRX', 4, 10 * MIN);
      link.mode = 'down'; let r = await scan(); assert.equal(r.notices.digest, 'PENDING');
      const sent = telegram.sent.length;
      await advance(DAY); head += 28_800; link.mode = 'new'; watch = makeWatch();
      add(81, 'TRX', 5, MIN); await advance(5 * MIN);
      r = await scan(); assert.equal(telegram.sent.length, sent + 1, 'yesterday\'s claim is delivered'); assert.ok((await notice(80)) && !(await notice(81)));
      await advance(5 * MIN); r = await scan(); assert.equal(r.notices.digest, 'ALREADY_TODAY'); assert.equal(telegram.sent.length, sent + 1, 'no second digest the same Kyiv day');
      await advance(DAY); head += 28_800; watch = makeWatch(); r = await scan();
      assert.equal(telegram.sent.length, sent + 2); assert.equal((await notice(81)).metadata.deliveryStatus, 'SENT');
    });
    await test('a digest the Worker refuses as malformed is closed as REJECTED and cannot block later digests', async () => {
      await advance(DAY); head += 28_800; watch = makeWatch();
      add(90, 'TRX', 6, 10 * MIN);
      const sent = telegram.sent.length;
      link.mode = 'invalid-digest'; let r = await scan(); link.mode = 'new';
      assert.equal(r.notices.digest, 'REJECTED'); assert.equal(telegram.sent.length, sent);
      const record = await notice(90); assert.equal(record.action, 'DEPOSIT_NOTICE_DIGESTED'); assert.equal(record.metadata.deliveryStatus, 'REJECTED');
      assert.ok(await deposit(90), 'the transfer is still stored');
      await advance(DAY); head += 28_800; watch = makeWatch(); add(91, 'TRX', 7, 10 * MIN); r = await scan();
      assert.equal(r.notices.digest, 'SENT'); assert.equal(telegram.sent.length, sent + 1);
    });
    await test('signed events: deposit carries the chain time separately from the record time; digests carry no transfer identity', async () => {
      const deposits = link.requests.filter((r) => r.pathname === '/v1/deposit'), summaries = link.requests.filter((r) => r.pathname === '/v1/deposit-digest');
      assert.ok(deposits.length > 0 && summaries.length > 0);
      for (const { body } of deposits) {
        assert.deepEqual(Object.keys(body).sort(), ['amount', 'asset', 'blockTime', 'confirmations', 'eventId', 'eventType', 'finalized', 'network', 'proofStatus', 'requiredConfirmations', 'timestamp', 'txHash']);
        const tx = txs.find((t) => t.id === body.txHash); if (tx) assert.equal(body.blockTime, tx.ts, 'blockTime is the chain time');
        assert.ok(body.timestamp >= body.blockTime - 10 * MIN);
      }
      for (const { body } of summaries) { assert.deepEqual(Object.keys(body).sort(), ['eventId', 'eventType', 'groups', 'timestamp']); assert.doesNotMatch(JSON.stringify(body), /txHash|[a-f0-9]{64}|41(11){20}/); }
    });
    await test('never one Telegram message per dust transfer; every real receipt exactly once; only approved recipients were scanned', async () => {
      const real = { 4: '1010 USDT', 5: '25 TRX', 12: '3 USDT', 30: '250 USDT', 31: '80 TRX', 32: '700 USDT', 50: '120 USDT', 70: '333 USDT' };
      for (const [n, label] of Object.entries(real)) assert.equal(telegram.sent.filter((t) => t.includes(`TXID: ${H(n)}`)).length, 1, `${label} announced once`);
      assert.equal(fresh().length, Object.keys(real).length);
      const dustIds = txs.filter((t) => new BigNumber(t.sun).shiftedBy(-6).isLessThan(1)).map((t) => t.id);
      assert.ok(dustIds.length >= 15);
      for (const id of dustIds) assert.equal(telegram.sent.some((t) => t.includes(id)), false, 'a dust TXID never appears in Telegram');
      assert.equal(telegram.sent.some((t) => t.includes(H(1)) || t.includes(H(3)) || t.includes(H(901))), false, 'old transfers are never individual alerts');
      assert.equal(digests().length, 8);
      // One digest message per Kyiv day at most, over the whole simulated period.
      const ackDays = (await prisma.auditLog.findMany({ where: { action: 'DEPOSIT_NOTICE_DIGEST_DELIVERY' } })).filter((a) => a.metadata.deliveryStatus === 'SENT').map((a) => a.metadata.deliveredDay);
      assert.equal(new Set(ackDays).size, ackDays.length, 'never two delivered digests on one Kyiv day');
      assert.ok(listed.length > 0 && listed.every((a) => a === T));
    });
    await test('logs carry counts only: no TXID, amount, address, token or secret', async () => {
      const text = noSecretsInLog.join('\n');
      assert.match(text, /\[deposit-watch\] notices \{"fresh":/);
      assert.doesNotMatch(text, /[a-f0-9]{64}|41(11){20}|fixture-token|isolated-notice-699|1500\.25/);
    });
    await test('no credit, attribution or balance change: Balance / DemoBalance / Futures / batches / withdrawals / referral untouched', async () => {
      assert.equal(await financial(), baseline);
      assert.equal(await prisma.deposit.count({ where: { OR: [{ status: 'CREDITED' }, { userId: { not: null } }, { batchId: { not: null } }, { ignoredAt: { not: null } }] } }), 0);
      assert.equal(await prisma.deposit.count(), txs.filter((t) => t.to === T && t.success).length + 2, 'every transfer to the treasury is retained (plus the two seeded rows)');
    });

    console.info = realInfo; console.warn = realWarn;
    const version = database.psql(['-c', 'SELECT version()']).stdout.trim();
    const report = { status: 'PASS', scope: 'isolated disposable PostgreSQL, local TronGrid fixture, real Worker code with in-memory storage, fake Telegram; not production evidence',
      checks, postgres: version, telegramMessages: telegram.sent.length, individualAlerts: fresh().length, digests: digests().length, telegramAttempts: telegram.attempts,
      transfersStored: await prisma.deposit.count(), simulatedHours: Math.round(shiftMs / HOUR), wallClockMs: realNow() - start, balancesUnchanged: true };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    database.stop();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
