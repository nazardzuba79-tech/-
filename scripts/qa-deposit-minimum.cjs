/** Isolated acceptance: real Prisma/PostgreSQL, production routers/services,
 * deterministic local TRON HTTP fixture. NEVER reads DATABASE_URL or contacts
 * production. Build first; see docs/DEPOSIT_MINIMUM_ACCEPTANCE.md for tooling.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const qa = createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));
const output = path.resolve('output/deposit-minimum');
fs.mkdirSync(output, { recursive: true });
const treasury = '41' + '11'.repeat(20);
const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const userId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const hash = n => n.toString(16).padStart(64, '0');

async function main() {
  const report = { scope: 'Disposable localhost PostgreSQL; synthetic on-chain fixture, not production', checks: [], browser: [] };
  const test = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const dataDir = fs.mkdtempSync(path.resolve('node_modules/.cache/deposit-qa/cluster-'));
  const init = spawnSync(bin.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const child = spawn(bin.postgres, ['-D', dataDir, '-h', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => reject(Error(`PostgreSQL exited ${code}`)));
    child.stderr.on('data', value => { if (String(value).includes('ready to accept connections')) resolve(); });
  });
  const db = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  let prisma, chainServer, appServer, browser;
  try {
    await db.connect();
    for (const dir of fs.readdirSync('prisma/migrations').sort()) {
      const file = path.join('prisma/migrations', dir, 'migration.sql');
      if (fs.existsSync(file)) await db.query(fs.readFileSync(file, 'utf8'));
    }
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${port}/postgres?connection_limit=12` } } });
    for (const [id, role] of [[userId, 'USER'], [adminId, 'ADMIN']]) {
      await prisma.user.create({ data: { id, email: `${role.toLowerCase()}@deposit.invalid`, role, passwordHash: 'not-a-login', referralCode: id } });
    }
    const transfers = new Map(); let providerDown = false; let verifyCalls = 0;
    function transfer(n, amount, overrides = {}) {
      transfers.set(hash(n), { amount, confirmations: 25, asset: contract, to: treasury, ...overrides }); return hash(n);
    }
    const chain = express();
    chain.use((req, res, next) => providerDown ? res.status(503).json({ error: 'local fixture outage' }) : next());
    chain.get('/v1/accounts/:address/transactions/trc20', (_req, res) => res.json({ success: true, data: [...transfers].map(([txHash, t]) => ({
      transaction_id: txHash, to: t.to, value: new BigNumber(t.amount).shiftedBy(6).toFixed(0), block_timestamp: Date.now(), token_info: { address: t.asset },
    })) }));
    chain.get('/v1/transactions/:hash/events', (req, res) => {
      verifyCalls++; const t = transfers.get(req.params.hash);
      res.json({ success: true, data: t ? [{ event_name: 'Transfer', contract_address: t.asset, block_number: 2000 - t.confirmations + 1,
        result: { to: t.to, value: new BigNumber(t.amount).shiftedBy(6).toFixed(0) } }] : [] });
    });
    chain.get('/wallet/getnowblock', (_req, res) => res.json({ block_header: { raw_data: { number: 2000 } } }));
    chainServer = await listen(chain);
    // Explicit local-only environment: remove inherited chain credentials/config.
    for (const name of Object.keys(process.env)) if (/^(ETHEREUM|BSC|POLYGON|ARBITRUM|AVALANCHE|BITCOIN|SOLANA|TON|TRON)_/.test(name)) delete process.env[name];
    Object.assign(process.env, { JWT_SECRET: 'isolated-deposit-qa-not-a-production-secret', TRON_NATIVE_ASSET: 'TRX', TRON_TREASURY_ADDRESS: treasury,
      TRON_TOKENS: `USDT:${contract}:6`, TRON_API_URL: `http://127.0.0.1:${chainServer.address().port}`, TRON_MIN_CONFIRMATIONS: '19' });
    const { adminDepositsRouter } = require('../dist/api/routes/adminDeposits');
    const { depositsRouter } = require('../dist/api/routes/deposits');
    const { DepositService } = require('../dist/services/DepositService');
    const { loadChainConfig } = require('../dist/config/chains');
    const price = { getTicker: async () => null };
    const service = new DepositService(prisma, loadChainConfig('tron'), price);
    const auth = id => 'Bearer ' + jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const app = express(); app.use(express.json());
    app.use('/api/v1', adminDepositsRouter(prisma, price), depositsRouter(prisma, price));
    const claim = (txHash, extra = {}) => request(app).post('/api/v1/deposits/claim/tron').set('Authorization', auth(userId)).send({ txHash, asset: 'USDT', ...extra });
    const approve = (txHash, id = adminId) => request(app).post('/api/v1/admin/deposits/manual-credit').set('Authorization', auth(id))
      .send({ txHash, chain: 'tron', asset: 'USDT', userId, amount: '999999999' });
    const incoming = () => request(app).get('/api/v1/admin/deposits/incoming?includeStatus=true').set('Authorization', auth(adminId));
    const balance = async () => (await prisma.balance.findUnique({ where: { userId_asset: { userId, asset: 'USDT' } } }))?.available.toString() ?? '0';
    const row = txHash => prisma.deposit.findUniqueOrThrow({ where: { chain_txHash: { chain: 'tron', txHash } } });
    let below;
    await test('299 USDT: recorded BELOW_MINIMUM, visible to admin, no automatic credit', async () => {
      below = transfer(1, '299'); const r = await claim(below); assert.equal(r.status, 200); assert.equal(r.body.status, 'BELOW_MINIMUM');
      assert.equal(r.body.minDepositUsd, 300); assert.match(r.body.message, /ручной/); assert.equal(await balance(), '0');
      const history = await request(app).get('/api/v1/admin/deposits').set('Authorization', auth(adminId));
      assert.ok(history.body.some(d => d.txHash === below && d.status === 'BELOW_MINIMUM' && d.userEmail === 'user@deposit.invalid'));
    });
    await test('Non-admin cannot override minimum', async () => {
      assert.equal((await approve(below, userId)).status, 403);
      await assert.rejects(service.claimDeposit({ userId, asset: 'USDT', txHash: below, performedByAdminId: userId }), /Admin access/);
      assert.equal(await balance(), '0');
    });
    await test('Concurrent manual approves: same row, exact verified 299, one audit/credit; frontend amount ignored', async () => {
      const before = (await row(below)).id, calls = verifyCalls;
      const responses = await Promise.all(Array.from({ length: 8 }, () => approve(below)));
      for (const r of responses) { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'CREDITED'); }
      assert.ok(verifyCalls > calls); assert.equal(await balance(), '299'); assert.equal((await row(below)).id, before);
      assert.equal(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED' } }), 1);
      const again = await approve(below); assert.equal(again.body.amount, '299'); assert.equal(await balance(), '299');
    });
    await test('300 USDT auto-credits; concurrent first claims and case aliases create one Deposit', async () => {
      const txHash = transfer(10, '300');
      for (const r of await Promise.all([claim(txHash), claim(txHash.toUpperCase()), claim(txHash)])) assert.equal(r.body.status, 'CREDITED', JSON.stringify(r.body));
      assert.equal(await balance(), '599'); assert.equal(await prisma.deposit.count({ where: { txHash } }), 1);
    });
    await test('10 and 100 USDT TRC20: detected without claim, persisted unassigned BELOW_MINIMUM', async () => {
      transfer(20, '10'); transfer(21, '100'); const r = await incoming(); assert.equal(r.status, 200); assert.deepEqual(r.body.failedChains, []);
      for (const n of [20, 21]) { const d = r.body.transfers.find(d => d.txHash === hash(n)); assert.equal(d.status, 'BELOW_MINIMUM'); assert.equal((await row(hash(n))).userId, null); }
      assert.equal(await balance(), '599');
      await claim(hash(21)); assert.equal((await row(hash(21))).userId, userId); assert.equal(await balance(), '599');
    });
    await test('Unassigned transfer admin approval updates original row', async () => {
      const id = (await row(hash(20))).id; assert.equal((await approve(hash(20))).body.status, 'CREDITED');
      assert.equal((await row(hash(20))).id, id); assert.equal(await balance(), '609');
    });
    await test('Insufficient confirmations cannot be overridden; later retry re-verifies', async () => {
      const txHash = transfer(30, '50', { confirmations: 2 });
      assert.equal((await approve(txHash)).body.status, 'BELOW_MINIMUM'); assert.equal(await balance(), '609');
      transfer(30, '50'); assert.equal((await approve(txHash)).body.status, 'CREDITED'); assert.equal(await balance(), '659');
    });
    await test('Recipient/asset/amount mismatch and provider outage fail closed', async () => {
      for (const [n, overrides] of [[40, { to: '41' + '22'.repeat(20) }], [41, { asset: '41' + '33'.repeat(20) }]]) {
        const txHash = transfer(n, '500', overrides); assert.equal((await approve(txHash)).status, 400); transfers.delete(txHash);
      }
      const txHash = transfer(42, '99'); await claim(txHash); transfer(42, '100');
      assert.equal((await approve(txHash)).status, 400); transfer(42, '99');
      transfer(44, '10'); await incoming();
      providerDown = true; assert.equal((await approve(txHash)).status, 400);
      const r = await incoming(); assert.deepEqual(r.body.failedChains, ['tron']); assert.ok(r.body.transfers.length > 0);
      assert.equal((await request(app).get('/api/v1/admin/deposits/incoming').set('Authorization', auth(adminId))).status, 503);
      providerDown = false; assert.equal(await balance(), '659');
    });
    await test('Financial write failure rolls back status and credit', async () => {
      const txHash = transfer(43, '80'); await claim(txHash);
      await db.query(`CREATE FUNCTION qa_reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA forced audit failure'; END $$;
        CREATE TRIGGER qa_reject_credit BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.action = 'DEPOSIT_CREDITED') EXECUTE FUNCTION qa_reject_credit();`);
      try { await assert.rejects(service.claimDeposit({ userId, txHash, asset: 'USDT', performedByAdminId: adminId })); }
      finally { await db.query('DROP TRIGGER qa_reject_credit ON "AuditLog"; DROP FUNCTION qa_reject_credit();'); }
      assert.equal((await row(txHash)).status, 'BELOW_MINIMUM'); assert.equal(await balance(), '659');
    });
    await test('Distinct simultaneous credits preserve both increments', async () => {
      const a = transfer(50, '350'), b = transfer(51, '400');
      assert.equal((await Promise.all([claim(a), claim(b)])).every(r => r.body.status === 'CREDITED'), true);
      assert.equal(await balance(), '1409');
    });
    await test('Persisted incoming survives provider recent window', async () => {
      const txHash = transfer(60, '10'); await incoming(); transfers.delete(txHash);
      assert.ok((await incoming()).body.transfers.some(d => d.txHash === txHash));
    });
    await test('Known-owner pending 350 automatically credits when confirmations arrive', async () => {
      const txHash = transfer(70, '350', { confirmations: 2 }); const before = Number(await balance());
      assert.equal((await claim(txHash)).body.status, 'PENDING'); assert.equal(Number(await balance()), before);
      transfer(70, '350'); await incoming();
      assert.equal((await row(txHash)).status, 'CREDITED'); assert.equal(Number(await balance()), before + 350);
    });
    await test('Existing 5% referral policy applies once to concurrent manual approvals', async () => {
      await prisma.user.update({ where: { id: userId }, data: { referredById: adminId } });
      const txHash = transfer(71, '299'); await claim(txHash);
      const results = await Promise.all([approve(txHash), approve(txHash)]);
      for (const r of results) assert.equal(r.body.status, 'CREDITED');
      const id = (await row(txHash)).id;
      assert.equal(await prisma.referralReward.count({ where: { depositId: id } }), 1);
      assert.equal((await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: adminId, asset: 'USDT' } } })).available.toString(), '14.95');
      await prisma.user.update({ where: { id: userId }, data: { referredById: null } });
    });
    await test('Fractional verified amount credits exactly; a different claimant cannot take the same hash', async () => {
      const txHash = transfer(72, '299.123456'), before = new BigNumber(await balance());
      assert.equal((await claim(txHash)).body.status, 'BELOW_MINIMUM');
      const result = await approve(txHash); assert.equal(result.body.amount, '299.123456');
      assert.equal(await balance(), before.plus('299.123456').toString());
      const other = await request(app).post('/api/v1/deposits/claim/tron').set('Authorization', auth(adminId)).send({ txHash, asset: 'USDT' });
      assert.equal(other.status, 400); assert.equal(await balance(), before.plus('299.123456').toString());
    });
    if (process.argv.includes('--browser')) {
      const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
      const fixtureUser = { id: adminId, email: 'admin@deposit.invalid', role: 'ADMIN', isAdmin: true, displayName: 'LOCAL QA' };
      app.get('/api/v1/me', (_req, res) => res.json(fixtureUser));
      app.get('/api/v1/admin/clients', (_req, res) => res.json([{ id: userId, email: 'user@deposit.invalid' }]));
      app.get('/api/v1/*', (_req, res) => res.status(503).json({ error: 'No fixture for unrelated API' }));
      app.use(express.static(path.resolve('frontend/dist'), { index: false }));
      app.get('*', (_req, res) => res.type('html').send(fs.readFileSync('frontend/dist/index.html', 'utf8').replace('<head>',
        `<head><script>localStorage.setItem('exchange_token',${JSON.stringify(auth(adminId).slice(7))});localStorage.setItem('exchange_lang','ru');</script>`)));
      appServer = await listen(app); const origin = `http://127.0.0.1:${appServer.address().port}`;
      browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
      const context = await browser.newContext();
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      for (const width of [1440, 390]) {
        const txHash = transfer(width, '299'); await claim(txHash);
        await page.setViewportSize({ width, height: 900 });
        const loaded = page.waitForResponse(r => r.url().includes('/admin/deposits/incoming'));
        await page.goto(origin + '/admin/deposits'); await loaded;
        const item = page.locator('.admin-history-grid').filter({ has: page.locator(`[title="${txHash}"]`) });
        // Full hash is carried in the copy control's title; no force clicks.
        await item.getByText('BELOW_MINIMUM', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `below-minimum-${width}.png`), fullPage: true });
        const before = Number(await balance());
        await item.getByRole('button', { name: 'Зачислить вручную', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Депозит зачислен.' }).waitFor();
        await item.getByText('CREDITED', { exact: true }).waitFor(); assert.equal(Number(await balance()), before + 299);
        await page.reload(); await item.getByText('CREDITED', { exact: true }).waitFor();
        assert.equal(await item.getByRole('button', { name: 'Зачислить вручную', exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        providerDown = true; await page.getByRole('button', { name: 'Обновить входящие' }).click();
        await page.getByRole('alert').filter({ hasText: 'загружены не полностью' }).waitFor();
        assert.equal(await page.getByText('В доступной ленте нет непривязанных переводов.').count(), 0);
        await page.screenshot({ path: path.join(output, `provider-outage-${width}.png`), fullPage: true });
        providerDown = false; report.browser.push({ width, manualCredit: 'PASS', reload: 'PASS', outage: 'PASS', overflow: false });
      }
      await page.goto(origin + '/wallet?action=deposit');
      await page.getByText('Минимальная сумма пополнения — от 300 $ в эквиваленте.', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'deposit-warning.png'), fullPage: true });
      report.browser.push({ depositWarning: 'PASS' });
      assert.deepEqual(errors, []); console.log('PASS browser 1440 + 390');
    }
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (appServer) await new Promise(resolve => appServer.close(resolve));
    if (chainServer) await new Promise(resolve => chainServer.close(resolve));
    if (prisma) await prisma.$disconnect();
    await db.end();
    const stop = spawnSync(bin.pg_ctl, ['-D', dataDir, 'stop', '-m', 'fast', '-w'], { windowsHide: true, encoding: 'utf8' });
    assert.equal(stop.status, 0, stop.stderr);
  }
}
const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
main().catch(error => { console.error(error); process.exitCode = 1; });
