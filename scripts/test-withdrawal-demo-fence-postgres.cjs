'use strict';
/* Issue #617 P0: a demo-valued (unheld) withdrawal is never filed, approved or SENT, whatever the demo switches.
 * DISPOSABLE PostgreSQL only; real withdrawal and admin routers and WithdrawalService; synthetic identities;
 * the Cross trading wallet reader is a fixture valued from DemoBalance, as the native wallet is. Outbound network denied.
 * Ignores DATABASE_URL; never starts src/index. Requires WALLET_QA_PG_BIN (PostgreSQL tool directory). */
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('node:assert/strict'), { spawnSync } = require('child_process'), { createRequire } = require('module');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.WALLET_QA_DEPS || 'output/wallet-qa-deps/package.json'));
const out = path.join(root, 'output/withdrawal-demo-fence'); fs.mkdirSync(out, { recursive: true });
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = 'isolated-withdrawal-demo-fence-fixture-only';
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-withdrawal-demo-fence-fixture-only';
process.env.API_KEY_ENCRYPTION_SECRET = require('crypto').randomBytes(32).toString('hex');
for (const key of Object.keys(process.env)) if (/^(DEMO_|PRIVATE_TRADING_|WALLET_CONVERSION_)/.test(key)) delete process.env[key];
const OWNER = '00000000-0000-4000-8000-0000000000a1', NATIVE = '00000000-0000-4000-8000-0000000000b2', LONE = '00000000-0000-4000-8000-0000000000c3';
// Simulation-only identities exactly as production configures them: the private-trading owner and native Cross testers.
Object.assign(process.env, { PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: OWNER, PRIVATE_TRADING_TEST_USER_IDS: `${NATIVE},${LONE}` });
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const express = require('express'), jwt = require('jsonwebtoken');
const { WithdrawalService } = require('../src/services/WithdrawalService');
const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { withdrawalsRouter } = require('../src/api/routes/withdrawals');
const { adminWithdrawalsRouter } = require('../src/api/routes/adminWithdrawals');
function run(bin, args, stdio = 'pipe') { return spawnSync(bin, args, { cwd: root, encoding: 'utf8', stdio, timeout: 120000, windowsHide: true }); }
function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

// Every combination of the three demo switches the old guard depended on.
const SWITCHES = ['DEMO_SPOT_ENABLED', 'DEMO_LIQUIDITY_ENABLED', 'DEMO_WITHDRAWAL_GUARD_ENABLED'];
const COMBOS = [[], ['DEMO_SPOT_ENABLED'], ['DEMO_LIQUIDITY_ENABLED'], ['DEMO_WITHDRAWAL_GUARD_ENABLED'], SWITCHES];
const label = combo => combo.length ? combo.join('+') : 'every demo switch OFF';
const setSwitches = combo => { for (const key of SWITCHES) delete process.env[key]; for (const key of combo) process.env[key] = 'true'; };

async function main() {
  const configuredBin = process.env.WALLET_QA_PG_BIN;
  assert(configuredBin && path.isAbsolute(configuredBin), 'WALLET_QA_PG_BIN must be the absolute PostgreSQL tool directory (never a DB URL)');
  const exe = process.platform === 'win32' ? '.exe' : '';
  const bin = Object.fromEntries(['initdb', 'pg_ctl'].map(name => [name, path.join(fs.realpathSync(configuredBin), name + exe)]));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-withdrawal-fence-fixture-')), 'data');
  const port = await freePort();
  const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'postgres-control.log'), 'w'); let start;
  const socket = process.platform === 'win32' ? '' : ` -k ${path.dirname(dir)}`;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}${socket}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);
  let sql, prisma, server;
  const checks = [], failures = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push(name); console.log('PASS ' + name); }
    catch (error) { failures.push({ name, error: String(error?.message ?? error) }); console.log('FAIL ' + name + '\n  ' + String(error?.message ?? error).split('\n').slice(0, 6).join('\n  ')); }
  };
  const loopback = 'http://127.0.0.1:'; const realFetch = globalThis.fetch; const outbound = [];
  globalThis.fetch = (url, init) => { if (!String(url).startsWith(loopback)) { outbound.push(String(url)); return Promise.reject(new Error('outbound network denied in QA')); } return realFetch(url, init); };
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await sql.connect();
    await sql.query('CREATE DATABASE voltex_withdrawal_fence_fixture'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_withdrawal_fence_fixture' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    const people = { 'qa-admin': 'ADMIN', [OWNER]: 'ADMIN', [NATIVE]: 'USER', [LONE]: 'USER', 'qa-mixed': 'USER', 'qa-plain': 'USER' };
    for (const [id, role] of Object.entries(people)) {
      await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ($1,$2,'fixture',$1,$3,'APPROVED',now(),now())`,
        [id, `${id.replace(/[^a-z0-9]/gi, '')}@example.invalid`, role]);
    }
    const url = `postgresql://postgres@127.0.0.1:${port}/voltex_withdrawal_fence_fixture?connection_limit=24&sslmode=disable`;
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const demo = new DemoTradingService(prisma, new MatchingEngine());
    const adjust = new BalanceAdjustmentService(prisma);
    const topUp = (who, asset, amount) => demo.topUp({ userId: who, asset, amount, performedByAdminId: 'qa-admin', note: 'synthetic demo credit' });
    const credit = (who, asset, amount) => adjust.adjustOnce({ userId: who, asset, amount, reason: 'synthetic real-ledger fixture', performedByAdminId: 'qa-admin', idempotencyKey: randomUUID() });

    // Provenance as production has it: demo top-ups (DEMO_BALANCE_ADJUSTED), a native Cross wallet initialized from
    // DemoBalance (source DEMO_BALANCE), a demo conversion receipt, and real Balance credits.
    for (const who of [OWNER, NATIVE]) await topUp(who, 'USDT', '1000');
    for (const who of [OWNER, NATIVE]) await prisma.nativeDemoAccount.create({ data: { userId: who, revision: 1, payload: { revision: 1, deposit: '1000', commands: [], createdAt: Date.now(), source: 'DEMO_BALANCE' } } });
    await credit(OWNER, 'USDT', '500'); await credit(NATIVE, 'USDT', '500');
    await topUp('qa-mixed', 'USDT', '300'); await credit('qa-mixed', 'USDT', '200');
    await prisma.auditLog.create({ data: { id: `conversion:${randomUUID()}`, userId: 'qa-mixed', action: 'WALLET_DEMO_CONVERTED', metadata: { fromAsset: 'USDT', toAsset: 'BTC', fromAmount: '10', toAmount: '0.0001', ledger: 'demo' } } });
    await credit('qa-plain', 'USDT', '100'); await credit(LONE, 'USDT', '100'); await topUp(LONE, 'USDT', '50');

    const app = express(); app.use(express.json());
    // The Cross wallet of a simulation-only account, valued from its DemoBalance (null when it has no native wallet), as in production.
    const tradingWallet = async actor => (await prisma.nativeDemoAccount.findUnique({ where: { userId: actor.userId } }))
      ? (await prisma.demoBalance.findMany({ where: { userId: actor.userId } })).map(r => ({ asset: r.asset, available: r.available.toFixed() }))
      : null;
    app.use('/api/v1', withdrawalsRouter(prisma, { tradingWallet }));
    app.use('/api/v1', adminWithdrawalsRouter(prisma));
    app.use((error, req, res, next) => { console.error(error); res.status(500).json({ code: 'FIXTURE_ERROR' }); });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sessions = new Map();
    const token = async who => {
      if (!sessions.has(who)) { const id = randomUUID(); await prisma.session.create({ data: { id, userId: who, lastSeenAt: new Date() } }); sessions.set(who, id); }
      return jwt.sign({ sub: who, sid: sessions.get(who) }, process.env.JWT_SECRET);
    };
    const api = async (method, route, who, body) => {
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token(who) };
      const response = await fetch(origin + '/api/v1' + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const request = (who, amount = '10', asset = 'USDT') => api('POST', '/withdrawals', who, { asset, network: 'TRC20', toAddress: 'TQfixtureAddress000000000000000000', amount });
    const balanceOf = async (who, asset = 'USDT') => { const b = await prisma.balance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return { available: b?.available.toFixed() ?? '0', locked: b?.locked.toFixed() ?? '0' }; };
    const demoOf = async (who, asset = 'USDT') => (await prisma.demoBalance.findUnique({ where: { userId_asset: { userId: who, asset } } }))?.available.toFixed() ?? '0';
    const unheldRows = () => prisma.withdrawal.findMany({ where: { balanceHeld: false }, orderBy: { createdAt: 'asc' } });
    // Pre-existing demo-valued claims, as they may already exist on production (filed while the guard was off).
    const historic = async (who, status) => (await prisma.withdrawal.create({ data: { userId: who, asset: 'USDT', network: 'TRC20', toAddress: 'TQhistoric000000000000000000000000', amount: '25', status, balanceHeld: false } })).id;

    await check('adverse control (Codex 6395962055): with every demo switch OFF a native Cross wallet valued from DemoBalance files nothing (403) and no claim reaches APPROVED or SENT', async () => {
      setSwitches([]);
      const before = (await unheldRows()).length;
      const filed = await request(NATIVE);
      assert.equal(filed.status, 403, 'request: ' + JSON.stringify(filed.body));
      assert.equal(filed.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
      assert.equal((await unheldRows()).length, before, 'no unheld Withdrawal row');
      const id = await historic(NATIVE, 'PENDING');
      const approve = await api('POST', `/admin/withdrawals/${id}/approve`, 'qa-admin', {});
      assert.equal(approve.status, 403, 'approve: ' + JSON.stringify(approve.body));
      assert.equal((await prisma.withdrawal.findUnique({ where: { id } })).status, 'PENDING');
    });
    for (const combo of COMBOS) {
      await check(`${label(combo)}: owner and native tester — options list nothing, POST 403, no row, Balance and DemoBalance untouched`, async () => {
        setSwitches(combo);
        for (const who of [OWNER, NATIVE]) {
          const before = { real: await balanceOf(who), demo: await demoOf(who), rows: await prisma.withdrawal.count({ where: { userId: who } }) };
          const options = await api('GET', '/withdrawals/options', who);
          assert.equal(options.status, 200); assert.equal(options.body.source, 'TRADING'); assert.deepEqual(options.body.assets, [], who + ' options');
          for (const amount of ['1', '999', '1000']) {
            const filed = await request(who, amount);
            assert.equal(filed.status, 403, `${who} ${amount}: ${JSON.stringify(filed.body)}`); assert.equal(filed.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
          }
          assert.deepEqual({ real: await balanceOf(who), demo: await demoOf(who), rows: await prisma.withdrawal.count({ where: { userId: who } }) }, before, who);
        }
      });
      await check(`${label(combo)}: a forged direct service call files nothing, before any read or write`, async () => {
        setSwitches(combo);
        const before = await prisma.withdrawal.count();
        const service = new WithdrawalService(prisma);
        await assert.rejects(service.requestUnheldWithdrawal({ userId: NATIVE, asset: 'USDT', network: 'TRC20', toAddress: 'TQforged0000000000000000000000000', amount: '5', available: '1000000' }),
          error => error?.code === 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        assert.equal(await prisma.withdrawal.count(), before);
      });
      await check(`${label(combo)}: historic PENDING and APPROVED demo-valued claims are never approved or SENT (route and service); reject stays possible and credits nothing`, async () => {
        setSwitches(combo);
        const pending = await historic(OWNER, 'PENDING'), approved = await historic(NATIVE, 'APPROVED');
        const audit = await prisma.auditLog.count({ where: { action: { in: ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_SENT'] } } });
        const real = { owner: await balanceOf(OWNER), native: await balanceOf(NATIVE) };
        let r = await api('POST', `/admin/withdrawals/${pending}/approve`, 'qa-admin', {});
        assert.equal(r.status, 403, 'approve ' + JSON.stringify(r.body)); assert.equal(r.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        r = await api('POST', `/admin/withdrawals/${approved}/mark-sent`, 'qa-admin', { txHash: '0xfixture' + randomUUID() });
        assert.equal(r.status, 403, 'mark-sent ' + JSON.stringify(r.body)); assert.equal(r.body.code, 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        const service = new WithdrawalService(prisma);
        await assert.rejects(service.approveWithdrawal({ withdrawalId: pending, performedByAdminId: 'qa-admin' }), e => e?.code === 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        await assert.rejects(service.markSent({ withdrawalId: approved, performedByAdminId: 'qa-admin', txHash: '0xforged' }), e => e?.code === 'DEMO_FUNDS_NOT_WITHDRAWABLE');
        assert.equal((await prisma.withdrawal.findUnique({ where: { id: pending } })).status, 'PENDING');
        assert.equal((await prisma.withdrawal.findUnique({ where: { id: approved } })).status, 'APPROVED');
        assert.equal((await prisma.withdrawal.findUnique({ where: { id: approved } })).txHash, null);
        assert.equal(await prisma.auditLog.count({ where: { action: { in: ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_SENT'] } } }), audit);
        for (const id of [pending, approved]) {
          r = await api('POST', `/admin/withdrawals/${id}/reject`, 'qa-admin', { reason: 'demo-valued' });
          assert.equal(r.status, 200, 'reject ' + JSON.stringify(r.body)); assert.equal(r.body.status, 'REJECTED');
        }
        assert.deepEqual({ owner: await balanceOf(OWNER), native: await balanceOf(NATIVE) }, real, 'nothing credited back: nothing was held');
      });
    }
    await check('concurrency: 8 parallel demo-valued requests and 6 parallel approvals of one historic claim — none succeeds', async () => {
      setSwitches([]);
      const before = await prisma.withdrawal.count();
      const filed = await Promise.all(Array.from({ length: 8 }, (_, i) => request(i % 2 ? NATIVE : OWNER, '100')));
      assert(filed.every(r => r.status === 403), JSON.stringify(filed.map(r => r.status)));
      assert.equal(await prisma.withdrawal.count(), before);
      const id = await historic(NATIVE, 'PENDING');
      const approvals = await Promise.all(Array.from({ length: 6 }, () => api('POST', `/admin/withdrawals/${id}/approve`, 'qa-admin', {})));
      assert(approvals.every(r => r.status === 403), JSON.stringify(approvals.map(r => r.status)));
      assert.equal((await prisma.withdrawal.findUnique({ where: { id } })).status, 'PENDING');
    });
    for (const combo of [[], SWITCHES]) {
      await check(`${label(combo)}: a mixed account (real Balance + demo top-up + demo conversion history + DemoBalance) withdraws its real Balance exactly as before: held, APPROVED, SENT; DemoBalance untouched`, async () => {
        setSwitches(combo);
        const demoBefore = await demoOf('qa-mixed'), real = await balanceOf('qa-mixed');
        const filed = await request('qa-mixed', '20');
        assert.equal(filed.status, 200, JSON.stringify(filed.body)); assert.equal(filed.body.balanceHeld, true); assert.equal(filed.body.status, 'PENDING');
        assert.deepEqual(await balanceOf('qa-mixed'), { available: new BigNumber(real.available).minus(20).toFixed(), locked: new BigNumber(real.locked).plus(20).toFixed() });
        let r = await api('POST', `/admin/withdrawals/${filed.body.id}/approve`, 'qa-admin', {}); assert.equal(r.status, 200); assert.equal(r.body.status, 'APPROVED');
        r = await api('POST', `/admin/withdrawals/${filed.body.id}/mark-sent`, 'qa-admin', { txHash: '0xreal' + randomUUID() }); assert.equal(r.status, 200); assert.equal(r.body.status, 'SENT');
        assert.deepEqual(await balanceOf('qa-mixed'), { available: new BigNumber(real.available).minus(20).toFixed(), locked: real.locked });
        assert.equal(await demoOf('qa-mixed'), demoBefore);
        // More than the real Balance is refused: demo funds never top up a held request.
        const over = await request('qa-mixed', new BigNumber(real.available).minus(20).plus(1).toFixed());
        assert.equal(over.status, 400); assert.match(over.body.error, /Insufficient USDT balance/);
      });
    }
    await check('a configured tester without a Cross wallet keeps the ordinary Balance path; an ordinary account is unaffected; a REJECTED held request returns the lock', async () => {
      for (const combo of [[], SWITCHES]) {
        setSwitches(combo);
        for (const who of [LONE, 'qa-plain']) {
          const real = await balanceOf(who);
          const filed = await request(who, '5');
          assert.equal(filed.status, 200, who + ' ' + JSON.stringify(filed.body)); assert.equal(filed.body.balanceHeld, true);
          const r = await api('POST', `/admin/withdrawals/${filed.body.id}/reject`, 'qa-admin', { reason: 'fixture' });
          assert.equal(r.status, 200); assert.deepEqual(await balanceOf(who), real, who);
        }
      }
    });
    await check('held requests under concurrency and repetition: one approval wins, one SENT, the lock is released exactly once', async () => {
      setSwitches([]);
      const real = await balanceOf('qa-plain');
      const filed = await request('qa-plain', '7'); assert.equal(filed.status, 200);
      const approvals = await Promise.all(Array.from({ length: 5 }, () => api('POST', `/admin/withdrawals/${filed.body.id}/approve`, 'qa-admin', {})));
      assert.equal(approvals.filter(r => r.status === 200).length, 1); assert(approvals.filter(r => r.status !== 200).every(r => r.status === 400));
      const sends = await Promise.all(Array.from({ length: 4 }, (_, i) => api('POST', `/admin/withdrawals/${filed.body.id}/mark-sent`, 'qa-admin', { txHash: '0xonce' + i })));
      assert.equal(sends.filter(r => r.status === 200).length, 1);
      assert.deepEqual(await balanceOf('qa-plain'), { available: new BigNumber(real.available).minus(7).toFixed(), locked: real.locked });
    });
    await check('no demo-valued claim was created, approved or SENT by any check above', async () => {
      const rows = await unheldRows();
      assert(rows.every(r => r.toAddress.startsWith('TQhistoric')), 'only the fixture historic rows are unheld');
      assert(rows.every(r => ['PENDING', 'APPROVED', 'REJECTED'].includes(r.status)), JSON.stringify(rows.map(r => r.status)));
      const approvedOrSent = await prisma.auditLog.findMany({ where: { action: { in: ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_SENT'] } } });
      const ids = new Set(rows.map(r => r.id));
      assert(approvedOrSent.every(a => !ids.has(a.metadata.withdrawalId)), 'no approval or payout audit for an unheld row');
      assert.equal(await prisma.withdrawal.count({ where: { balanceHeld: false, status: 'SENT' } }), 0);
    });
    await check('no outbound network request', async () => { assert.deepEqual(outbound, []); });
    const summary = { database: 'disposable loopback PostgreSQL', passed: checks.length, failed: failures.length, failures, checks,
      unheldRows: (await unheldRows()).map(r => r.status), sentUnheld: await prisma.withdrawal.count({ where: { balanceHeld: false, status: 'SENT' } }), productionTouched: false };
    fs.writeFileSync(path.join(out, 'postgres-results.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, sentUnheld: summary.sentUnheld }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
