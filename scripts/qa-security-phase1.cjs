/** Isolated Phase 1 routing QA: normal built App, AuthPage, RegisterPanel and
 * BrowserRouter through the repository's nginx SPA configuration. Authentication
 * responses are explicit local fixtures, NOT production accounts or real login.
 * Copy responses use the unchanged canonical service with in-memory storage.
 * All external HTTP/WebSocket traffic is blocked, including fonts and market
 * feeds. This verifies navigation, not live quotes, fills or email delivery.
 *
 * Build backend/frontend normally with VITE_API_URL unset or /api/v1, then:
 * QA_PLAYWRIGHT_MODULE=<installed module> node scripts/qa-security-phase1.cjs
 *   <nginx executable> <mime.types> <outside-Git artifact directory>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const nginx = path.resolve(process.argv[2] || 'nginx');
const mime = path.resolve(process.argv[3] || '/etc/nginx/mime.types');
const output = path.resolve(process.argv[4] || path.join(root, 'node_modules/.cache/security-phase1'));
const unix = value => value.replace(/\\/g, '/');
const hash = value => createHash('sha256').update(value).digest('hex');

// Never consume an inherited production credential or database connection.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { requireAuth } = require('../dist/api/middleware/auth');
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const futures = require('../dist/config/futuresConfig');

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening'); const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}

function localFixtures() {
  const sessions = new Map(), users = new Map(), scenarios = new Map(), pending = new Map();
  const db = {
    session: {
      async findUnique({ where }) { return sessions.get(where.id) || null; },
      async update({ where, data }) { Object.assign(sessions.get(where.id), data); return sessions.get(where.id); },
    },
    copyStrategyOwner: { async findUnique() { return null; } },
    user: { async findUnique({ where }) { return users.get(where.id) || null; } },
    copyPerformanceScenario: {
      async findUnique({ where }) { const row = scenarios.get(where.id); return row ? { ...row } : null; },
      async create({ data }) {
        if (scenarios.has(data.id)) throw Object.assign(new Error('Existing QA scenario'), { code: 'P2002' });
        const row = { ...data, revision: 0 }; scenarios.set(data.id, row); return { ...row };
      },
      async updateMany({ where, data }) {
        const row = scenarios.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        scenarios.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 };
      },
    },
  };
  function account(admin = false) {
    const id = 'isolated-routing-user-' + users.size, sid = 'isolated-routing-session-' + users.size;
    users.set(id, { id, email: 'routing-fixture@example.invalid', displayName: 'Isolated Routing QA',
      avatarUrl: null, isAdmin: admin, kycStatus: 'NOT_STARTED', twoFactorEnabled: false,
      createdAt: '2025-01-01T00:00:00Z' });
    sessions.set(sid, { id: sid, userId: id, revokedAt: null, lastSeenAt: new Date() });
    return { id, token: jwt.sign({ sub: id, sid }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  }
  return { db, sessions, users, pending, account };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.existsSync(path.join(dist, 'index.html')), 'A normal production frontend build is required');
  const fixture = localFixtures(), app = express(), requests = [], unexpectedApi = [];
  app.use(express.json());
  app.use((req, res, next) => {
    requests.push({ method: req.method, path: req.path });
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && !/^\/api\/v1\/auth\/(login|login\/2fa|register)$/.test(req.path)) {
      unexpectedApi.push(req.method + ' ' + req.path);
      return res.status(405).json({ error: 'Only isolated authentication fixtures accept writes' });
    }
    next();
  });
  app.post('/api/v1/auth/login', (req, res) => {
    assert.equal(req.body.password, 'RoutingQA-only-123');
    assert(['normal', 'twofa', 'admin'].some(prefix => req.body.email === prefix + '@example.invalid'));
    if (req.body.email === 'twofa@example.invalid') {
      const pendingToken = randomBytes(16).toString('hex'); fixture.pending.set(pendingToken, true);
      return res.json({ requires2fa: true, pendingToken });
    }
    res.json({ token: fixture.account(req.body.email === 'admin@example.invalid').token });
  });
  app.post('/api/v1/auth/login/2fa', (req, res) => {
    assert.equal(req.body.code, '123456'); assert(fixture.pending.delete(req.body.pendingToken));
    res.json({ token: fixture.account().token });
  });
  app.post('/api/v1/auth/register', (req, res) => {
    assert.equal(req.body.email, 'register@example.invalid'); assert.equal(req.body.password, 'RoutingQA-only-123');
    res.json({ token: fixture.account().token });
  });
  const auth = requireAuth(fixture.db);
  app.get('/api/v1/me', auth, (req, res) => res.json(fixture.users.get(req.userId)));
  app.use('/api/v1', copyPerformanceRouter(fixture.db,
    new CopyPerformanceService(fixture.db, () => new Date('2026-09-06T12:00:00Z'))));

  // Explicit empty local account/market fixtures. No quotes, balances, orders or
  // profit numbers are manufactured to make unrelated product pages look live.
  app.get('/api/v1/wallet/overview', auth, (_req, res) => res.json({
    real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 },
    presentation: null, displayTotalUsd: 0, displaySpotUsd: 0, displayFuturesUsd: 0, btcPriceUsd: null,
  }));
  app.get('/api/v1/wallet/performance', auth, (_req, res) => res.json({
    ageDays: 0, startedOn: null, periods: Object.fromEntries(['7d', '30d', '90d', '1y', 'all'].map(period =>
      [period, { period, available: false, points: [], startDate: null, endDate: null,
        startEquity: null, endEquity: null, absolutePnl: null, percent: null }])),
  }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_req, res) => res.json({ points: [] }));
  app.get('/api/v1/card/application/me', auth, (_req, res) => res.json({ application: null, eligibility: {
    verificationApproved: false, depositEligible: false, tradingVolumeEligible: false, eligible: false,
    qualifyingDepositUsd: 0, qualifyingTradingVolumeUsd: 0,
    depositValuationComplete: true, tradingVolumeValuationComplete: true,
  } }));
  app.get('/api/v1/support/conversations/mine', auth, (_req, res) => res.json({ conversation: null }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances', '/api/v1/orders/me', '/api/v1/trades/me',
    '/api/v1/deposits/me', '/api/v1/withdrawals/me', '/api/v1/futures/orders/me', '/api/v1/futures/positions',
    '/api/v1/futures/positions/history', '/api/v1/account/security-log', '/api/v1/me/sessions', '/api/v1/products'],
  auth, (_req, res) => res.json([]));
  app.get(['/api/v1/admin/users', '/api/v1/admin/deposits', '/api/v1/admin/withdrawals',
    '/api/v1/admin/kyc', '/api/v1/admin/clients'], auth, (req, res) => fixture.users.get(req.userId).isAdmin
    ? res.json([]) : res.status(403).json({ error: 'Forbidden by local role fixture' }));
  app.get('/api/v1/market/featured-trader', (_req, res) => res.json({ avatarUrl: null }));
  app.get('/api/v1/market/global', (_req, res) => res.json({ global: null, fearGreed: null }));
  app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ source: 'isolated-unavailable', rankings: [] }));
  app.get('/api/v1/market/external/symbols', (_req, res) => res.json({ source: 'isolated-unavailable', symbols: [] }));
  app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ source: 'isolated-unavailable', tickers: [] }));
  app.get('/api/v1/market/external/tickers/:pair', (_req, res) => res.json({ source: 'isolated-unavailable', ticker: null }));
  app.get('/api/v1/market/external/orderbook/:pair', (req, res) => res.json({ pair: req.params.pair, bids: [], asks: [], timestamp: Date.now() }));
  app.get('/api/v1/market/external/candles/:pair', (req, res) => res.json({ pair: req.params.pair, interval: req.query.interval, candles: [] }));
  app.get('/api/v1/market/external/trades/:pair', (req, res) => res.json({ pair: req.params.pair, trades: [] }));
  app.get('/api/v1/cfd/tickers', (_req, res) => res.json({ source: 'isolated-unavailable', configured: false, tickers: [] }));
  app.get('/api/v1/futures/config', (_req, res) => res.json({ symbols: futures.CORE_FUTURES_SYMBOLS,
    minLeverage: futures.MIN_LEVERAGE, maxLeverage: futures.MAX_LEVERAGE,
    newAccountMaxLeverage: futures.NEW_ACCOUNT_MAX_LEVERAGE, newAccountPeriodDays: futures.NEW_ACCOUNT_PERIOD_DAYS,
    fundingIntervalHours: futures.FUNDING_INTERVAL_HOURS,
    highLeverageWarningThreshold: futures.HIGH_LEVERAGE_WARNING_THRESHOLD, leverageTiers: futures.LEVERAGE_TIERS,
  }));
  app.get('/api/v1/futures/mark-price/:pair', (req, res) => res.json({ symbol: req.params.pair, markPrice: null, indexPrice: null }));
  app.get('/api/v1/futures/funding-rate/:pair', (req, res) => res.json({ symbol: req.params.pair, history: [] }));
  app.get('/api/v1/futures/open-interest/:pair', (req, res) => res.json({ symbol: req.params.pair, openInterest: '0', openInterestValue: null }));
  app.use((req, res) => { unexpectedApi.push(req.method + ' ' + req.path); res.status(404).json({ error: 'Unimplemented local fixture endpoint' }); });
  app.use((error, _req, res, _next) => { unexpectedApi.push(error.message); res.status(500).json({ error: 'Local QA fixture assertion failed' }); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const run = fs.mkdtempSync(path.join(output, 'nginx-'));
  fs.mkdirSync(path.join(run, 'logs')); fs.mkdirSync(path.join(run, 'temp'));
  const config = fs.readFileSync(path.join(root, 'frontend/nginx.conf'), 'utf8')
    .replace('listen 80;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root "${unix(dist)}";`)
    .replace('    index index.html;', `    index index.html;\n    location /api/ { proxy_pass ${apiOrigin}; }`);
  fs.writeFileSync(path.join(run, 'qa.conf'), `daemon off;\nmaster_process off;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents { worker_connections 256; }\nhttp { include "${unix(mime)}";\n${config}\n}`);
  const args = ['-p', unix(run) + '/', '-c', 'qa.conf'];
  const syntax = spawnSync(nginx, [...args, '-t'], { cwd: run, encoding: 'utf8', windowsHide: true });
  if (syntax.status !== 0) await new Promise(resolve => server.close(resolve));
  assert.equal(syntax.status, 0, syntax.error?.message || syntax.stderr);
  const child = spawn(nginx, args, { cwd: run, windowsHide: true, stdio: 'ignore' });
  const report = { environment: 'ISOLATED LOCAL QA ONLY', origin, checkedAt: new Date().toISOString(),
    frontendIndexSha256: hash(fs.readFileSync(path.join(dist, 'index.html'))),
    installedRouterDom: JSON.parse(fs.readFileSync(path.join(root, 'frontend/node_modules/react-router-dom/package.json'))).version,
    installedRouter: JSON.parse(fs.readFileSync(path.join(root, 'frontend/node_modules/react-router/package.json'))).version,
    auth: 'Local response fixture; actual built UI and actual JWT/session middleware for protected reads',
    market: 'Explicitly empty/unavailable; no external HTTP or WebSocket connection permitted',
    routes: [], flows: [], attacks: [], browserErrors: [], consoleErrors: [], blockedResources: [],
    blockedWebSockets: [], externalNavigationAttempts: [], requests, unexpectedApi };
  let browser;
  const writeReport = () => fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify(report, null, 2));
  try {
    assert.equal(report.installedRouterDom, '7.18.3'); assert.equal(report.installedRouter, '7.18.3');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
      if (attempt === 99) throw new Error('Local nginx did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || 'msedge', headless: true });
    async function newPage(width, token = null) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      await context.addInitScript(({ token }) => {
        if (token) localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru'); localStorage.setItem('voltex_trading_mode', 'spot');
        window.__qaHistoryErrors = [];
        // Observational wrapper only: invoke native history unchanged and
        // rethrow every exception, so failures cannot be hidden by the harness.
        for (const name of ['pushState', 'replaceState']) {
          const native = history[name].bind(history);
          history[name] = (...args) => {
            try { return native(...args); }
            catch (error) { window.__qaHistoryErrors.push({ method: name, name: error.name, message: error.message }); throw error; }
          };
        }
      }, { token });
      await context.routeWebSocket('**', socket => {
        report.blockedWebSockets.push(socket.url()); socket.close({ code: 1001, reason: 'Isolated QA: external feeds unavailable' });
      });
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === origin) return route.continue();
        if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
        const record = { url: url.origin + url.pathname, type: req.resourceType() };
        if (req.isNavigationRequest()) report.externalNavigationAttempts.push(record);
        else report.blockedResources.push(record);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.browserErrors.push(error.message));
      page.on('console', event => {
        if (event.type() !== 'error') return;
        const entry = { text: event.text(), url: event.location().url };
        // Only failed resources explicitly blocked by this context are excluded
        // from application errors; their URLs remain in the separate evidence.
        if (entry.text.includes('net::ERR_BLOCKED_BY_CLIENT') && report.blockedResources.some(item => entry.url.startsWith(item.url))) return;
        report.consoleErrors.push(entry);
      });
      return { page, context };
    }
    const selectors = { '/login': '#login-email', '/register': '#reg-email', '/trade': '.trade-terminal',
      '/futures': '.trade-terminal', '/card': '.crypto-card-page', '/wallet': '.vx-wallet',
      '/copy-trading': '[data-trader-id="VX-KSENIA"] .mini-chart-line', '/settings': '.settings-arctic-root',
      '/admin/users': '.admin-page-grid', '/': '.vx-home' };
    async function settled(page, target) {
      const parsed = new URL(target, origin);
      await page.waitForURL(url => url.origin === origin && url.pathname === parsed.pathname && url.search === parsed.search, { timeout: 30000 });
      await page.locator(selectors[parsed.pathname] || 'main').first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(180);
      assert.equal(new URL(page.url()).origin, origin);
      assert.deepEqual(await page.evaluate(() => window.__qaHistoryErrors), [], 'Native history methods must not throw');
      assert.deepEqual(report.externalNavigationAttempts, [], 'No external navigation may even be attempted');
    }
    async function submit(page, mode = 'login', admin = false) {
      if (mode === 'register') {
        await page.locator('#reg-email').fill('register@example.invalid');
        await page.locator('#reg-password').fill('RoutingQA-only-123');
      } else {
        await page.locator('#login-email').fill((mode === 'twofa' ? 'twofa' : admin ? 'admin' : 'normal') + '@example.invalid');
        await page.locator('#login-password').fill('RoutingQA-only-123');
      }
      await page.locator('.vx-auth-form button[type="submit"]').click();
      if (mode === 'twofa') {
        await page.locator('#login-2fa').waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null, '2FA challenge must not grant a session');
        await page.locator('#login-2fa').fill('123456');
        await page.locator('.vx-auth-form button[type="submit"]').click();
      }
    }
    const targets = ['/trade?pair=BTC%2FUSDT', '/card', '/wallet', '/copy-trading', '/futures?pair=BTC%2FUSDT'];
    const attacks = [
      ['mixed literal', '/\\evil.example'], ['mixed encoded', encodeURIComponent('/\\evil.example')],
      ['backslash', encodeURIComponent('\\evil.example')], ['protocol relative', encodeURIComponent('//evil.example')],
      ['HTTPS absolute', encodeURIComponent('https://evil.example')], ['HTTP absolute', encodeURIComponent('http://evil.example')],
      ['encoded inner backslash', encodeURIComponent('/%5cevil.example')],
      ['carriage return', encodeURIComponent('/\revil.example')], ['newline', encodeURIComponent('/\nevil.example')],
      ['tab', encodeURIComponent('/\tevil.example')], ['NUL', encodeURIComponent('/\0evil.example')],
      ['DEL', encodeURIComponent('/\x7fevil.example')], ['malformed encoding', encodeURIComponent('/%ZZ')],
    ];
    for (const width of [1440, 390]) {
      for (const route of ['/login', '/register']) {
        const { page, context } = await newPage(width);
        assert.equal((await page.goto(origin + route)).status(), 200); await settled(page, route);
        assert.equal((await page.reload()).status(), 200); await settled(page, route);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.equal(scrollWidth, width);
        await page.screenshot({ path: path.join(output, `${route.slice(1)}-${width}.png`) });
        report.routes.push({ route, width, direct: 200, refresh: 200, scrollWidth }); await context.close();
      }
      for (const target of targets) {
        const { page, context } = await newPage(width);
        assert.equal((await page.goto(origin + target)).status(), 200);
        await page.locator('#login-email').waitFor();
        assert.equal(new URL(page.url()).pathname, '/login');
        assert.equal(new URL(page.url()).searchParams.get('next'), target);
        await submit(page); await settled(page, target);
        assert.equal((await page.reload()).status(), 200); await settled(page, target);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        report.routes.push({ route: target, width, protectedReturn: true, direct: 200, refresh: 200, scrollWidth,
          overflow: Math.max(0, scrollWidth - width) });
        await page.screenshot({ path: path.join(output, `${new URL(target, origin).pathname.slice(1)}-${width}.png`) });
        await context.close();
      }
      // Legitimate query strings survive actual login push and registration replace.
      for (const [mode, target] of [['login', '/settings'], ['register', '/trade?pair=BTC%2FUSDT'],
        ['twofa', '/card'], ['twofa', '/futures?pair=BTC%2FUSDT']]) {
        const { page, context } = await newPage(width);
        await page.goto(origin + (mode === 'register' ? '/register' : '/login') + '?next=' + encodeURIComponent(target));
        await submit(page, mode); await settled(page, target);
        report.flows.push({ mode, target, width, returned: true }); await context.close();
      }
      // Existing admin policy: anonymous -> homepage; ordinary member -> its
      // default terminal; actual admin-shaped /me -> nested Admin Users route.
      for (const role of ['guest', 'member', 'admin']) {
        const token = role === 'guest' ? null : fixture.account(role === 'admin').token;
        const { page, context } = await newPage(width, token);
        await page.goto(origin + '/admin');
        const destination = role === 'guest' ? '/' : role === 'member' ? '/trade' : '/admin/users';
        await settled(page, destination);
        if (role === 'admin') { assert.equal((await page.reload()).status(), 200); await settled(page, destination); }
        report.flows.push({ mode: 'admin gate', role, width, destination }); await context.close();
      }
      for (const [name, query] of attacks) {
        for (const mode of ['login', 'register', 'authenticated-replace']) {
          const token = mode === 'authenticated-replace' ? fixture.account().token : null;
          const { page, context } = await newPage(width, token);
          await page.goto(origin + (mode === 'register' ? '/register' : '/login') + '?next=' + query);
          if (mode !== 'authenticated-replace') await submit(page, mode);
          await settled(page, '/trade');
          report.attacks.push({ name, mode, width, destination: '/trade', externalAttempt: false, historyException: false });
          await context.close();
        }
      }
      // Malicious target must also be rejected after the actual second UI step.
      const { page, context } = await newPage(width);
      await page.goto(origin + '/login?next=' + encodeURIComponent('/\\evil.example'));
      await submit(page, 'twofa'); await settled(page, '/trade');
      report.attacks.push({ name: 'mixed slash 2FA', mode: 'twofa', width, destination: '/trade', externalAttempt: false, historyException: false });
      await context.close(); writeReport(); console.log(width + ': normal route/auth/admin/F5 and attack-regression matrix PASS');
    }
    assert.deepEqual(unexpectedApi, [], 'Every local fixture request must be explicitly implemented');
    assert.deepEqual(report.browserErrors, [], 'No uncaught browser runtime errors');
    assert.deepEqual(report.consoleErrors, [], 'No unexpected console errors');
    assert.deepEqual(report.externalNavigationAttempts, []);
    assert(requests.filter(row => !['GET', 'HEAD'].includes(row.method)).every(row => row.path.startsWith('/api/v1/auth/')));
    report.success = true; report.externalRequestsSent = 0; report.realAccountWrites = 0; report.financialWrites = 0;
    writeReport(); console.log('PASS: ' + path.join(output, 'browser-result.json'));
  } catch (error) {
    report.success = false; report.failure = error.stack; writeReport(); throw error;
  } finally {
    if (browser) await browser.close();
    spawnSync(nginx, [...args, '-s', 'quit'], { cwd: run, windowsHide: true, stdio: 'ignore' });
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
