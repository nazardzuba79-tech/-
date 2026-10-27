/** Real built frontend + unchanged auth/referral routes on a disposable PostgreSQL.
 * Public hostnames are intercepted in Chromium and forwarded ONLY to loopback.
 * This proves application behavior, NOT live RU hosting or access from a Russian ISP. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const target = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.REFERRAL_REGION_QA !== '1' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/voltex_referral_regions') {
  throw new Error('Refusing anything except the named disposable loopback PostgreSQL');
}
// Short synthetic JWT secret intentionally leaves the notification publisher unconfigured.
process.env.JWT_SECRET = 'referral-local-qa-only';
process.env.EMAIL_VERIFICATION_SECRET = 'referral-region-verification-local-synthetic-only';
process.env.API_KEY_ENCRYPTION_SECRET = '1'.repeat(64); // Synthetic disposable password-vault key.
process.env.REGISTRATION_OPEN = 'true';
process.env.ADMIN_EMAIL = 'not-a-registration-test@example.invalid';
const egress = [];
global.fetch = async () => { egress.push('DENIED'); throw new Error('External network disabled by referral QA'); };
const express = require('express'), request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { authRouter } = require('../dist/api/routes/auth');
const { referralRouter } = require('../dist/api/routes/referral');
const { requireAuth } = require('../dist/api/middleware/auth');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const db = new PrismaClient(), app = express();
const out = path.resolve(process.env.QA_OUT || 'output/referral-regions');
fs.mkdirSync(out, { recursive: true });
const checks = [], browserErrors = [], signupBodies = [], unexpectedWrites = [], routeErrors = [];
const closingContexts = new WeakSet();
let tearingDown = false;
const codeKey = 'exchange_referral_code', regionKey = 'exchange_referral_region';
const password = 'SyntheticReferralPass123';
const origins = { world: 'https://voltextech.net', ru: 'https://ru.voltextech.net' };
const auth = requireAuth(db);
app.use(express.json());
app.use('/api/v1', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/auth/register') signupBodies.push(req.body);
  if (!['GET', 'HEAD'].includes(req.method) && !['/auth/register', '/auth/login'].includes(req.path)) {
    unexpectedWrites.push(req.path); return res.status(405).json({ error: 'Fixture write denied' });
  }
  next();
});
app.use('/api/v1', authRouter(db, { countryDetection: { detect: async () => null } }));
app.use('/api/v1', referralRouter(db));
app.get('/api/v1/me', auth, async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.userId }, select: {
    id: true, email: true, displayName: true, avatarUrl: true, role: true, kycStatus: true,
    createdAt: true, country: true, phone: true, twoFactorEnabled: true,
  } });
  res.json({ ...user, isAdmin: user.role === 'ADMIN' });
});
// Banking rendering fixtures only; no placements, profit calculation or rewards are executed.
const cardYield = { annualRate: '0', asset: 'USDT', locked: false, availableCardBalance: null, accruedReward: null, dataStatus: 'UNAVAILABLE' };
app.get('/api/v1/banking/config', auth, (_, res) => res.json({ programs: [], assets: [], rewardCurrencyRule: 'SAME_ASSET', usdValuesAreReferenceOnly: true, cardYield }));
app.get('/api/v1/banking/me', auth, (_, res) => res.json({ placements: [], ledger: [], summary: { totalUsd: null, accruedUsd: null, activeCount: 0 }, cardYield }));
app.get('/api/v1/banking/state', auth, (_, res) => res.json({ placements: [], ledger: [], summary: { totalUsd: null, accruedUsd: null, activeCount: 0 }, cardYield }));
app.get('/api/v1/banking/referral', auth, async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.userId }, select: { referralCode: true } });
  res.json({ referralCode: user.referralCode, referredCount: await db.user.count({ where: { referredById: req.userId } }), referralPercent: 20, rewardsByAsset: [], recentRewards: [] });
});
// Unrelated market feeds are explicitly unavailable, never successful malformed JSON.
app.use('/api/v1', (_, res) => res.status(503).json({ error: 'Offline market fixture' }));
const dist = path.resolve('frontend/dist');
app.use(express.static(dist));
app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Synthetic API failure' }); });

async function finances() {
  return Object.fromEntries(await Promise.all(['balance', 'demoBalance', 'order', 'deposit', 'withdrawal', 'referralReward'].map(async key => [key, await db[key].count()])));
}

(async () => {
  const nonce = randomUUID();
  const ownerEmail = `referrer-${nonce}@example.invalid`;
  const seed = await request(app).post('/api/v1/auth/register').send({ email: ownerEmail, password });
  assert.equal(seed.status, 201);
  const owner = await db.user.findUnique({ where: { email: ownerEmail } });
  const before = await finances();
  assert.ok(Object.values(before).every(n => n === 0), 'fixture starts without financial rows');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const loopback = `http://127.0.0.1:${server.address().port}`;
  let browser;
  async function context(width, token) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, serviceWorkers: 'block' });
    await ctx.addInitScript(({ token }) => {
      localStorage.setItem('exchange_lang', 'ru');
      if (token && !localStorage.getItem('exchange_token')) localStorage.setItem('exchange_token', token);
      // Capture the real copy button's argument without changing the operator's clipboard.
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedReferral = text; } } });
    }, { token });
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url());
      try {
        if (Object.values(origins).includes(url.origin)) {
          const response = await route.fetch({ url: loopback + url.pathname + url.search, maxRedirects: 0 });
          return await route.fulfill({ response });
        }
        // Home's market providers/fonts are offline fixtures; nothing reaches a public network.
        if (url.hostname === 'fonts.googleapis.com') return await route.fulfill({ contentType: 'text/css', body: '' });
        return await route.fulfill({ status: 503, json: { error: 'Offline market fixture' } });
      } catch (error) {
        if (tearingDown || closingContexts.has(ctx)) return;
        routeErrors.push({ url: url.pathname, error: error.message });
        await route.abort().catch(() => {});
      }
    });
    if (ctx.routeWebSocket) await ctx.routeWebSocket('**/*', ws => ws.close());
    return ctx;
  }
  async function profile(page, origin) {
    await page.goto(origin + '/settings?tab=referral');
    await page.locator('[data-referral-link]').waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
  async function closeContext(ctx) {
    // Context shutdown can cancel in-flight read fixtures; never hide active errors.
    closingContexts.add(ctx);
    await ctx.close();
  }
  function watch(page) { page.on('pageerror', error => browserErrors.push(error.message)); }
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    // Unauthenticated visits, ordinary same-origin marketing CTA and unchanged registration.
    for (const [region, width] of [['world', 1440], ['ru', 390]]) {
      const ctx = await context(width), page = await ctx.newPage(); watch(page);
      const origin = origins[region];
      await page.goto(`${origin}/${owner.referralCode}`);
      await page.waitForURL(url => url.origin === origin && url.pathname === '/');
      await page.waitForFunction(key => localStorage.getItem(key), codeKey);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), codeKey), owner.referralCode);
      assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null);
      const homeSignup = page.locator('a[href="/register"]:visible').first();
      await homeSignup.click();
      await page.waitForURL(url => url.origin === origin && url.pathname === '/register');
      // Exercise the existing safe return path and avoid mounting an unrelated trading terminal.
      await page.evaluate(() => history.replaceState(history.state, '', '/register?next=%2Fsettings%3Ftab%3Dreferral'));
      const email = `${region}-${nonce}@example.invalid`;
      await page.locator('#reg-email').fill(email);
      await page.locator('#reg-password').fill(password);
      await page.locator('form button[type="submit"]').click();
      await page.waitForFunction(() => Boolean(localStorage.getItem('exchange_token')));
      await page.waitForURL(url => url.pathname !== '/register');
      assert.equal(new URL(page.url()).origin, origin, 'registration never leaves the visitor origin');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), codeKey), null);
      const body = signupBodies.find(row => row.email === email);
      assert.equal(body.ref, owner.referralCode);
      const registered = await db.user.findUnique({ where: { email } });
      assert.equal(registered.referredById, owner.id);
      checks.push({ name: `${region}: guest link → home CTA → registration → shared referredById`, result: 'PASS' });
      await closeContext(ctx);
    }
    for (const width of [1440, 390]) {
      const ctx = await context(width, seed.body.token), page = await ctx.newPage(); watch(page);
      for (const origin of Object.values(origins)) {
        await profile(page, origin);
        for (const region of ['world', 'ru']) {
          await page.locator(`[data-referral-region="${region}"]`).click();
          const link = `${origins[region]}/${owner.referralCode}`;
          assert.equal(await page.locator('[data-referral-link]').textContent(), link);
          await page.locator('[data-copy-referral]').click();
          assert.equal(await page.evaluate(() => window.__copiedReferral), link);
          await page.reload(); await page.locator('[data-referral-link]').waitFor();
          assert.equal(await page.locator(`[data-referral-region="${region}"]`).getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('[data-referral-link]').textContent(), link);
          assert.equal(await page.evaluate(key => localStorage.getItem(key), regionKey), region);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          // Reload starts at the top on mobile; include the actual controls in evidence.
          if (width < 768) await page.locator('[data-referral-link]').evaluate(el => el.scrollIntoView({ block: 'center' }));
          await page.screenshot({ path: path.join(out, `profile-${new URL(origin).hostname}-${region}-${width}.png`) });
        }
        const stats = await page.evaluate(async () => (await fetch('/api/v1/referral/me', { headers: { Authorization: `Bearer ${localStorage.getItem('exchange_token')}` } })).json());
        assert.equal(stats.referralCode, owner.referralCode);
        assert.equal(stats.referredCount, 2);
        assert.deepEqual(stats.rewardsByAsset, []);
        await page.goto(origin + '/banking');
        await page.locator('[data-banking-referral-link]').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-banking-referral-link]')?.textContent?.startsWith('https://'));
        const link = `${origins.ru}/${owner.referralCode}`;
        assert.equal(await page.locator('[data-banking-referral-link]').textContent(), link);
        await page.locator('[data-copy-banking-referral]').click();
        assert.equal(await page.evaluate(() => window.__copiedReferral), link);
        checks.push({ name: `${new URL(origin).hostname} ${width}: choose/copy/reload, shared stats=2, Banking preference`, result: 'PASS' });
      }
      await closeContext(ctx);
    }
    assert.deepEqual(await finances(), before, 'registration and sharing write no financial rows');
    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(egress, []);
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(routeErrors, []);
    const report = { result: 'PASS', scope: 'Disposable PostgreSQL + real auth/referral routes + built frontend. Hostnames intercepted to loopback; no live RU or Russian ISP claim.', checks, browserErrors, routeErrors, unexpectedWrites, externalServerCalls: egress.length, financialRowsUnchanged: true };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    tearingDown = true;
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.$disconnect();
  }
})().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; });
