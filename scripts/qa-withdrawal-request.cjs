/** LOCAL-ONLY end-to-end QA of the withdrawal request: client → admin queue.
 *
 * Real pieces: a throwaway Postgres cluster with every migration applied by
 * `prisma migrate deploy`; the real withdrawals, admin-withdrawals, admin
 * (alerts) and account routers; the real NativeDemoService and its wallet
 * projection on an in-memory repository and a fixture market (the pattern of
 * scripts/serve-wallet-review.cjs); the real production-built frontend in
 * Chromium. Nothing here reaches a production database, account, credential
 * or the network, and nothing is paid out anywhere.
 *
 * Three accounts: an ordinary client (spot 500 USDT, futures 300 USDT), a
 * Cross trading account (a configured test account: 12 500 USDT and
 * 0.25 BTC in the trading simulation, no spot funds) and an admin.
 *
 *   npx tsc && npm run build --prefix frontend && node scripts/qa-withdrawal-request.cjs
 *
 * PG_BIN: the Postgres binaries (default /usr/lib/postgresql/16/bin). As root,
 * initdb and pg_ctl run as the `postgres` user. QA_OUT: where the screenshots
 * and report.json go (default: a temp directory). QA_FRONTEND_DIST with
 * QA_BEFORE=1: photograph another build (e.g. main) without the checks.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events');
const { spawnSync, execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const PG_BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const OUT = path.resolve(process.env.QA_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'qa-withdrawal-')));
const FRONTEND = path.resolve(process.env.QA_FRONTEND_DIST || path.join(root, 'frontend/dist'));
const BEFORE = process.env.QA_BEFORE === '1';
fs.mkdirSync(OUT, { recursive: true });

const TRADER = randomUUID(), OWNER = randomUUID();
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.PRIVATE_TRADING_ENABLED = 'true';
process.env.PRIVATE_TRADING_OWNER_ID = OWNER;
process.env.PRIVATE_TRADING_TEST_USER_IDS = TRADER;

async function freePort() {
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const { port } = probe.address(); await new Promise((r) => probe.close(r)); return port;
}

async function startDatabase() {
  const port = await freePort();
  const asRoot = process.getuid?.() === 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-withdrawal-pg-'));
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
  pg('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${dir}`, 'start', '-w']);
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  return { url, stop: () => pg('pg_ctl', ['-D', data, 'stop', '-m', 'fast', '-w']) };
}

/** The fixture market of serve-wallet-review.cjs: deterministic marks, a spread. */
const MARKS = { BTCUSDT: '100000' };
const market = {
  async freshQuote(symbol) {
    const mark = MARKS[symbol]; if (!mark) throw new Error('NO_INSTRUMENT'); const now = Date.now();
    return { provider: 'bybit', symbol, bids: [{ price: String(Number(mark) * 0.9999), quantity: '50' }],
      asks: [{ price: String(Number(mark) * 1.0001), quantity: '50' }], markPrice: mark, lastPrice: mark, fundingRate: '0.0001',
      nextFundingTime: (Math.floor(now / 28800000) + 1) * 28800000, providerTimestamp: now, bookGeneratedAt: now,
      markProviderTimestamp: now, fetchedAt: now };
  },
  async instrument() { throw new Error('NO_INSTRUMENT'); },
};

async function main() {
  const database = await startDatabase();
  process.env.DATABASE_URL = database.url; process.env.DIRECT_URL = database.url;
  const report = { out: OUT, frontend: FRONTEND, before: BEFORE, checks: [], failures: [] };
  let browser, server, prisma;
  try {
    const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, encoding: 'utf8', env: process.env });
    assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);
    report.migrations = (migrate.stdout.match(/Applying migration/g) || []).length;

    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { PrismaClient } = require('@prisma/client');
    const dist = (p) => require(path.join(root, 'dist', p));
    const { withdrawalsRouter } = dist('api/routes/withdrawals');
    const { adminWithdrawalsRouter } = dist('api/routes/adminWithdrawals');
    const { adminRouter } = dist('api/routes/admin');
    const { accountRouter } = dist('api/routes/account');
    const { requireAuth } = dist('api/middleware/auth');
    const { NativeDemoService } = dist('private-trading/native/service');
    const { nativeDemoRoutes } = dist('private-trading/native/routes');
    const { emptyDemoState } = dist('private-trading/native/engine');
    const { withdrawableRows } = dist('private-trading/native/withdrawable');

    prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
    const user = (id, email, extra = {}) => prisma.user.create({ data: { id, email, passwordHash: 'qa-only', referralCode: id.slice(0, 12), ...extra } });
    await user('qa-admin', 'admin@example.invalid', { role: 'ADMIN', displayName: 'QA Admin' });
    await user('qa-client', 'client@example.invalid', { displayName: 'QA Client' });
    await user(TRADER, 'trader@example.invalid', { displayName: 'QA Trader' });
    await prisma.balance.create({ data: { userId: 'qa-client', asset: 'USDT', available: '500', locked: '0' } });
    await prisma.futuresBalance.create({ data: { userId: 'qa-client', asset: 'USDT', available: '300', locked: '0' } });
    const tokens = {};
    for (const id of ['qa-admin', 'qa-client', TRADER]) {
      const session = await prisma.session.create({ data: { userId: id } });
      tokens[id] = jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    }

    // The Cross trading account: the real engine and wallet projection, in memory.
    const holdings = [{ asset: 'USDT', available: '12500', locked: '0' }, { asset: 'BTC', available: '0.25', locked: '0' }];
    let row = null;
    const repository = {
      async read() { return row ? structuredClone(row) : null; },
      async available() { return row ? null : holdings[0].available; },
      async holdings() { return structuredClone(holdings); },
      async revision() { return row ? structuredClone(row) : null; },
      async prior() { return null; },
      async initialize() {
        if (row) return structuredClone(row);
        const deposit = holdings[0].available; holdings[0].available = '0';
        row = { revision: 1, deposit, commands: [], snapshot: emptyDemoState(deposit, Date.now()), createdAt: Date.now(), source: 'QA_FIXTURE' };
        return structuredClone(row);
      },
      async commit(_a, expected, next) { row = structuredClone({ ...next, revision: expected + 1 }); return structuredClone(row); },
    };
    const native = new NativeDemoService(repository, market);
    const traderActor = { userId: TRADER, sessionId: 'qa', expiresAt: Date.now() + 3600000 };
    await native.initialize(traderActor, 'qa-open-account');

    const app = express();
    app.use(express.json());
    app.use('/api/v1', withdrawalsRouter(prisma, {
      tradingWallet: async (actor) => {
        if (actor.userId !== TRADER) return null;
        const wallet = await native.wallet(actor);
        return wallet ? withdrawableRows(wallet) : null;
      },
    }));
    app.use('/api/v1', adminWithdrawalsRouter(prisma));
    app.use('/api/v1', adminRouter(prisma));
    app.use('/api/v1', accountRouter(prisma));
    const auth = requireAuth(prisma);
    app.use('/api/v1/private-trading', auth, (req, res, next) => {
      if (req.userId !== TRADER) return res.status(403).json({ error: 'Режим недоступен', code: 'private_access_denied' });
      res.locals.actor = traderActor; next();
    });
    app.get('/api/v1/private-trading/access', (_req, res) => res.json({ allowed: true, nativeAvailable: true, simulationOnly: true }));
    app.use('/api/v1/private-trading/native', nativeDemoRoutes(native, (res) => res.locals.actor));
    // The ordinary client's ledger, read from the same database.
    const ledger = async (model, userId) => (await prisma[model].findMany({ where: { userId } }))
      .map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString(), priceUsd: 1, valueUsd: Number(b.available) + Number(b.locked) }));
    app.get('/api/v1/wallet/overview', auth, async (req, res) => {
      const spot = await ledger('balance', req.userId), futures = await ledger('futuresBalance', req.userId);
      const spotValueUsd = spot.reduce((s, r) => s + r.valueUsd, 0), futuresValueUsd = futures.reduce((s, r) => s + r.valueUsd, 0);
      res.json({ real: { spot, futures, spotValueUsd, futuresValueUsd, totalValueUsd: spotValueUsd + futuresValueUsd },
        presentation: null, displaySpotUsd: spotValueUsd, displayFuturesUsd: futuresValueUsd, displayTotalUsd: spotValueUsd + futuresValueUsd, btcPriceUsd: 100000 });
    });
    app.get('/api/v1/balances', auth, async (req, res) => res.json(await ledger('balance', req.userId)));
    app.get('/api/v1/futures/balances', auth, async (req, res) => res.json(await ledger('futuresBalance', req.userId)));
    app.get('/api/v1/wallet/performance', auth, (_req, res) => res.json({ ageDays: 0, startedOn: null, periods: {} }));
    app.get(['/api/v1/deposits/me', '/api/v1/trades/me'], auth, (_req, res) => res.json([]));
    app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ source: 'QA', rankings: [
      { symbol: 'USDT', name: 'Tether', rank: 1, image: '', categories: [], price: 1, changePercent24h: 0, changePercent7d: null, changePercent30d: null, volume24h: 0, marketCap: null, sparkline: [] },
      { symbol: 'BTC', name: 'Bitcoin', rank: 2, image: '', categories: [], price: 100000, changePercent24h: 0, changePercent7d: null, changePercent30d: null, volume24h: 0, marketCap: null, sparkline: [] },
    ] }));
    app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside the withdrawal QA scope', path: req.path }));
    app.use(express.static(FRONTEND, { index: false, redirect: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;

    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
    browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
    const test = async (name, fn) => {
      try { await fn(); report.checks.push(name); console.log('PASS ' + name); }
      catch (error) { report.failures.push({ name, error: String(error.stack || error) }); console.error('FAIL ' + name + '\n' + (error.stack || error)); }
    };
    const open = async (userId, route, viewport = { width: 1440, height: 900 }) => {
      const context = await browser.newContext({ viewport, locale: 'ru-RU', isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await context.addInitScript(([token]) => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); }, [tokens[userId]]);
      const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin + route); await page.waitForTimeout(1800);
      return { page, context, errors };
    };
    const dialog = (page) => page.getByRole('dialog');
    const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

    if (BEFORE) {
      for (const [who, name] of [[TRADER, 'before-trader'], ['qa-client', 'before-client']]) {
        const { page, context } = await open(who, '/wallet?action=withdraw');
        await page.waitForTimeout(800); await shot(page, name); await context.close();
      }
      return;
    }

    const TRON = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    await test('ordinary client: the Wallet button opens the panel on the spot account and a request holds the amount', async () => {
      const { page, context, errors } = await open('qa-client', '/wallet');
      await page.getByRole('button', { name: 'Вывести', exact: true }).first().click();
      const d = dialog(page);
      await d.getByText('Со спотового счёта').waitFor();
      await d.getByText('Вывод может занимать до 60 минут.').waitFor();
      await d.getByLabel('Адрес кошелька').fill(EVM);
      await d.getByText('Адрес похож на другую сеть', { exact: false }).waitFor();
      await d.getByLabel('Адрес кошелька').fill(TRON);
      await d.getByLabel('Сумма').fill('600');
      await d.getByText('Можно вывести не больше', { exact: false }).waitFor();
      assert.equal(await d.getByRole('button', { name: 'Вывести', exact: true }).isDisabled(), true);
      await d.getByLabel('Сумма').fill('120,5');
      // Typed text is the Wallet's dark ink, not the exchange's white.
      const fill = await d.getByLabel('Адрес кошелька').evaluate((el) => getComputedStyle(el).webkitTextFillColor);
      assert.equal(fill, 'rgb(23, 32, 51)', 'address text colour ' + fill);
      assert.equal(await d.getByText('TRON (TRC20)').count() > 0, true, 'USDT opens on TRC20');
      await page.mouse.move(2, 2); await page.waitForTimeout(250);
      await shot(page, 'client-form');
      await d.getByRole('button', { name: 'Вывести', exact: true }).click();
      await d.getByText('Заявка на вывод принята').waitFor();
      await shot(page, 'client-done');
      const w = await prisma.withdrawal.findFirst({ where: { userId: 'qa-client' } });
      assert.equal(w.status, 'PENDING'); assert.equal(w.balanceHeld, true); assert.equal(w.amount.toString(), '120.5');
      assert.equal(w.network, 'TRC20'); assert.equal(w.toAddress, TRON);
      const b = await prisma.balance.findFirst({ where: { userId: 'qa-client', asset: 'USDT' } });
      assert.equal(b.available.toString(), '379.5'); assert.equal(b.locked.toString(), '120.5');
      assert.deepEqual(errors, []); await context.close();
    });

    await test('Cross trading account: the unified strip button opens the panel on the trading account; nothing is held', async () => {
      const { page, context, errors } = await open(TRADER, '/wallet');
      await page.locator('.wallet-side-nav .wallet-nav-item').filter({ hasText: /Unified|Единый/ }).first().click().catch(() => {});
      await page.waitForTimeout(600);
      const strip = page.locator('.wallet-action-withdraw');
      if (await strip.count()) await strip.first().click(); else await page.getByRole('button', { name: 'Вывести', exact: true }).first().click();
      const d = dialog(page);
      await d.getByText('С торгового счёта').waitFor();
      await d.getByText('12 500', { exact: false }).first().waitFor();
      await d.getByLabel('Адрес кошелька').fill(TRON);
      await d.getByLabel('Сумма').fill('2000');
      await page.mouse.move(2, 2); await page.waitForTimeout(250);
      await shot(page, 'trader-form');
      await d.getByRole('button', { name: 'Вывести', exact: true }).click();
      await d.getByText('Заявка на вывод принята').waitFor();
      const w = await prisma.withdrawal.findFirst({ where: { userId: TRADER } });
      assert.equal(w.status, 'PENDING'); assert.equal(w.balanceHeld, false); assert.equal(w.amount.toString(), '2000');
      assert.equal(await prisma.balance.count({ where: { userId: TRADER } }), 0, 'no Balance row was created or moved');
      assert.deepEqual(errors, []); await context.close();
    });

    await test('Cross trading account: a second request sees what the first already claimed', async () => {
      const { page, context } = await open(TRADER, '/wallet?action=withdraw');
      const d = dialog(page);
      await d.getByText('10 500', { exact: false }).first().waitFor();
      await d.getByLabel('Адрес кошелька').fill(TRON);
      await d.getByLabel('Сумма').fill('11000');
      await d.getByText('Можно вывести не больше', { exact: false }).waitFor();
      // The server refuses the same over-claim on its own.
      const res = await fetch(origin + '/api/v1/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[TRADER] },
        body: JSON.stringify({ asset: 'USDT', network: 'TRC20', toAddress: TRON, amount: '11000' }) });
      assert.equal(res.status, 400);
      await context.close();
    });

    await test('phone 390: the panel fits without sideways scroll', async () => {
      const { page, context } = await open('qa-client', '/wallet?action=withdraw', { width: 390, height: 844 });
      await dialog(page).getByText('Вывод может занимать до 60 минут.').waitFor();
      await shot(page, 'client-phone');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await context.close();
    });

    await test('admin: both requests are in «Выводы» with their waiting time; approve → sent releases the hold; reject gives nothing back', async () => {
      const { page, context, errors } = await open('qa-admin', '/admin/withdrawals', { width: 1440, height: 900 });
      await page.getByText('client@example.invalid').first().waitFor();
      await page.getByText('trader@example.invalid').first().waitFor();
      await page.getByText('торговый счёт · без блокировки').waitFor();
      await page.getByText(/ждёт \d+ мин/).first().waitFor();
      await shot(page, 'admin-queue');
      const clientRow = page.locator('.admin-history-grid').filter({ hasText: 'client@example.invalid' });
      await clientRow.getByRole('button', { name: 'Одобрить' }).click(); await page.waitForTimeout(500);
      page.once('dialog', (d) => d.accept('0xqa-txid'));
      await clientRow.getByRole('button', { name: 'Отправлено' }).click(); await page.waitForTimeout(700);
      const traderRow = page.locator('.admin-history-grid').filter({ hasText: 'trader@example.invalid' }).first();
      page.once('dialog', (d) => d.accept('QA'));
      await traderRow.getByRole('button', { name: 'Отклонить' }).click(); await page.waitForTimeout(700);
      await shot(page, 'admin-after');
      const sent = await prisma.withdrawal.findFirst({ where: { userId: 'qa-client' } });
      assert.equal(sent.status, 'SENT'); assert.equal(sent.txHash, '0xqa-txid');
      const b = await prisma.balance.findFirst({ where: { userId: 'qa-client', asset: 'USDT' } });
      assert.equal(b.available.toString(), '379.5'); assert.equal(b.locked.toString(), '0');
      const rejected = await prisma.withdrawal.findFirst({ where: { userId: TRADER } });
      assert.equal(rejected.status, 'REJECTED');
      assert.equal(await prisma.balance.count({ where: { userId: TRADER } }), 0);
      assert.deepEqual(errors, []); await context.close();
    });
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close().catch(() => {});
    server?.close();
    await prisma?.$disconnect().catch(() => {});
    database.stop();
    console.log(JSON.stringify({ out: OUT, passed: report.checks.length, failed: report.failures.length }));
    if (report.failures.length) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
