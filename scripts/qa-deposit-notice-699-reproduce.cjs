/** Issue #699 reproduction — the incident shape against any build (before/after).
 *
 * Synthetic values only. Five native TRX dust transfers mined 14–15 hours before a scan (after the last
 * evening slot, found by the next noon slot), one real USDT receipt and one old
 * transfer. Prints what reaches Telegram. Same isolation as qa-deposit-notice-699:
 * temporary PostgreSQL, local TronGrid, the build's own Worker code, fake Telegram.
 *
 * Usage: QA699_PG_BIN=… node scripts/qa-deposit-notice-699-reproduce.cjs [repoRoot]
 *   repoRoot defaults to this checkout; pass a built checkout of another revision
 *   (dist/ + workers/notification-edge/src/core.js) to compare.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), net = require('node:net'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const here = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || here);
const express = require('express');
const { PrismaClient } = require('@prisma/client');
process.env.JWT_SECRET = 'isolated-notice-699-fixture-not-a-production-secret';
delete process.env.DATABASE_URL;
const { DepositWatchService } = require(path.join(target, 'dist/services/deposits/DepositWatchService'));
const notifications = require(path.join(target, 'dist/services/TelegramNotifications'));
const H = (n) => BigInt(n).toString(16).padStart(64, '0'), T = '41' + '11'.repeat(20), TOKEN = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const run = (bin, args, stdio = 'pipe') => spawnSync(bin, args, { encoding: 'utf8', stdio, timeout: 120_000 });
(async () => {
  const configured = process.env.QA699_PG_BIN;
  assert(configured && path.isAbsolute(configured), 'QA699_PG_BIN must be the absolute PostgreSQL tool directory');
  const bin = (name) => path.join(fs.realpathSync(configured), name);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-notice-699-repro-')), dir = path.join(base, 'data');
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  assert.equal(run(bin('initdb'), ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']).status, 0);
  assert.equal(run(bin('pg_ctl'), ['-D', dir, '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${base}`, 'start', '-w'], 'ignore').status, 0);
  let prisma, server;
  try {
    for (const m of fs.readdirSync(path.join(target, 'prisma/migrations')).sort()) {
      const file = path.join(target, 'prisma/migrations', m, 'migration.sql');
      if (fs.existsSync(file)) assert.equal(run(bin('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-f', file]).status, 0, m);
    }
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${port}/postgres` } } });
    const now = Date.now(), head = 90_000_000;
    const txs = [[1, 'TRX', 5, 15 * HOUR], [2, 'TRX', 2, 14 * HOUR + 50 * MIN], [3, 'TRX', 4, 14 * HOUR + 40 * MIN], [4, 'TRX', 1, 14 * HOUR + 30 * MIN], [5, 'TRX', 3, 13 * HOUR + 45 * MIN],
      [6, 'USDT', 1010_000000, 30 * MIN], [7, 'TRX', 1500250000, 4 * DAY]].map(([n, asset, sun, age]) => ({ id: H(n), asset, sun: String(sun), ts: now - age, block: head - Math.round(age / 3000) }));
    const native = (t) => ({ txID: t.id, block_timestamp: t.ts, ret: [{ contractRet: 'SUCCESS' }], raw_data: { contract: [{ type: 'TransferContract', parameter: { type_url: 'type.googleapis.com/protocol.TransferContract', value: { owner_address: '41' + '55'.repeat(20), to_address: T, amount: Number(t.sun) } } }] } });
    const app = express(); app.use(express.json());
    app.get(['/v1/accounts/:a/transactions', '/v1/accounts/:a/transactions/trc20'], (req, res) => {
      const token = req.path.endsWith('/trc20');
      const rows = txs.filter((t) => (token ? t.asset === 'USDT' : t.asset === 'TRX') && t.ts >= Number(req.query.min_timestamp) && t.ts <= Number(req.query.max_timestamp)).sort((a, b) => a.ts - b.ts);
      const offset = Number(req.query.fingerprint || 0), limit = Number(req.query.limit || 200);
      res.json({ success: true, data: rows.slice(offset, offset + limit).map((t) => (token ? { transaction_id: t.id, to: T, value: t.sun, block_timestamp: t.ts, token_info: { address: TOKEN } } : native(t))), meta: offset + limit < rows.length ? { fingerprint: String(offset + limit) } : {} });
    });
    app.all('/wallet/getnowblock', (_q, res) => res.json({ block_header: { raw_data: { number: head } } }));
    app.post(['/wallet/gettransactionbyid', '/walletsolidity/gettransactionbyid'], (req, res) => { const t = txs.find((x) => x.id === req.body.value); res.json(t ? native(t) : {}); });
    app.post(['/wallet/gettransactioninfobyid', '/walletsolidity/gettransactioninfobyid'], (req, res) => { const t = txs.find((x) => x.id === req.body.value); if (!t) return res.json({});
      const token = t.asset === 'USDT'; res.json({ id: t.id, blockNumber: t.block, blockTimeStamp: t.ts, receipt: token ? { result: 'SUCCESS' } : { net_usage: 268 },
        ...(token ? { log: [{ address: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c', topics: [TOPIC, '0'.repeat(64), '0'.repeat(24) + T.slice(2)], data: BigInt(t.sun).toString(16).padStart(64, '0') }] } : {}) }); });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const core = await import(pathToFileURL(path.join(target, 'workers/notification-edge/src/core.js')).href);
    const sent = [], stores = new Map();
    const send = async (_u, init) => { sent.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: sent.length } }); };
    const baseEnv = { TELEGRAM_BOT_TOKEN: 'fixture-token', TELEGRAM_CHAT_ID: 'fixture-chat', DEPOSIT_SIGNING_PUBLIC_KEY: notifications.notificationPublicKey() };
    const env = { ...baseEnv, EVENTS: { idFromName: (n) => n, get: (name) => ({ fetch: (request) => {
      if (!stores.has(name)) { let record, lock = Promise.resolve(); const s = { get: async () => record, put: async (_k, v) => { record = v; }, setAlarm: async () => {}, transaction: (fn) => { const r = lock.then(() => fn(s)); lock = r.catch(() => {}); return r; } }; stores.set(name, new core.Delivery({ storage: s }, baseEnv, send)); }
      return stores.get(name).fetch(request); } }) } };
    const toWorker = (url, init) => core.handle(new Request(String(url), { method: init.method, headers: init.headers, body: init.body }), env);
    const config = { chain: 'tron', type: 'tron', treasuryAddress: T, nativeAsset: 'TRX', minConfirmations: 19, tokens: { USDT: { contractAddress: TOKEN, decimals: 6 } }, apiUrl: origin };
    const limits = { pageSize: 50, initialBackfillMs: 7 * DAY, maxPagesPerRun: 80, maxProviderCallsPerRun: 600, maxVerificationsPerRun: 60, anonymousRequestIntervalMs: 0, maxRunMs: 120_000 };
    const extra = notifications.notifyDepositDigest ? [(d) => notifications.notifyDepositDigest(d, toWorker)] : [];
    const watch = new DepositWatchService(prisma, async () => config, (u, i) => fetch(u, i), Date.now, limits, (t) => notifications.notifyDeposit(t, toWorker), ...extra);
    const info = console.info; console.info = () => {};
    const summary = await watch.runOnce('admin'); console.info = info;
    assert.equal(summary.ok, true, summary.error || 'scan failed');
    const first = sent.map((t) => t.split('\n')[0]);
    const result = { transfersStored: await prisma.deposit.count(), telegramMessages: sent.length,
      individualAlertsForDust: first.filter((l) => /^Нове надходження: 0\.00000\d TRX$/.test(l)).length,
      individualAlertsForOldTransfer: first.filter((l) => l.includes('1500.25')).length,
      individualAlertsForRealNewReceipt: first.filter((l) => l === 'Нове надходження: 1010 USDT').length,
      digests: first.filter((l) => l === 'Зведення перевірки надходжень').length,
      messagesWithTransactionTime: sent.filter((t) => /Час транзакці/.test(t)).length, firstLines: first };
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--expect-fixed')) {
      assert.equal(result.individualAlertsForDust, 0, 'dust must not be announced one by one');
      assert.equal(result.individualAlertsForOldTransfer, 0, 'an old transfer is not a new receipt');
      assert.equal(result.individualAlertsForRealNewReceipt, 1); assert.equal(result.digests, 1); assert.equal(result.telegramMessages, 2);
      assert.equal(result.transfersStored, 7, 'every transfer stays in the database');
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    run(bin('pg_ctl'), ['-D', dir, 'stop', '-m', 'fast', '-w']); fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
