/** LOCAL candidate integration QA. Never reads production credentials or databases.
 * Build the normal backend/frontend, then node scripts/qa-card-production.cjs nginx.exe mime.types.
 * Actual compiled Card router/service/requireAuth; only database, USD quotes and
 * unrelated account/market reads are explicit fixtures. Local transaction mutex
 * and rollback preserve the service's real submission/idempotence semantics.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const nginx = path.resolve(process.argv[2] || 'nginx');
const mime = path.resolve(process.argv[3] || '/etc/nginx/mime.types');
const dist = path.join(root, 'frontend/dist');
const output = path.join(root, 'node_modules/.cache/qa-card');
const unix = value => value.replace(/\\/g, '/');
const sha = value => createHash('sha256').update(value).digest('hex');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { cardRouter } = require('../dist/api/routes/card');
const { requireAuth } = require('../dist/api/middleware/auth');

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening'); const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}

function memoryDatabase() {
  const users = new Map(), sessions = new Map(), applications = new Map(), audits = [];
  let transactionTail = Promise.resolve(), transactionCount = 0;
  const db = {
    user: { async findUnique({ where }) { return users.get(where.id) || null; } },
    deposit: { async findMany({ where }) {
      assert.equal(where.status, 'CREDITED');
      return users.get(where.userId)?.deposits.filter(row => row.status === 'CREDITED') || [];
    } },
    trade: { async findMany({ where }) {
      const id = where.OR[0].takerUserId;
      assert.equal(where.OR[0].makerUserId.not, id);
      assert.equal(where.OR[1].makerUserId, id);
      assert.equal(where.OR[1].takerUserId.not, id);
      return users.get(id)?.trades.filter(row => row.takerUserId !== row.makerUserId) || [];
    } },
    cardApplication: {
      async findUnique({ where }) { return applications.get(where.userId) || null; },
      async create({ data }) {
        assert(users.has(data.userId));
        if (applications.has(data.userId)) throw Object.assign(new Error('Unique user application'), { code: 'P2002' });
        const row = { id: 'local-card-' + (applications.size + 1), submittedAt: new Date(), ...structuredClone(data) };
        applications.set(data.userId, row); return row;
      },
    },
    auditLog: { async create({ data }) { audits.push(structuredClone(data)); return data; } },
    session: {
      async findUnique({ where }) { return sessions.get(where.id) || null; },
      async update({ where, data }) { Object.assign(sessions.get(where.id), data); return sessions.get(where.id); },
    },
    async $transaction(callback, options) {
      assert.equal(options.isolationLevel, 'Serializable');
      const previous = transactionTail;
      let release; transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      const before = structuredClone([...applications]), auditBefore = structuredClone(audits);
      transactionCount++;
      try { return await callback(db); }
      catch (error) {
        applications.clear(); for (const [id, row] of before) applications.set(id, row);
        audits.splice(0, audits.length, ...auditBefore); throw error;
      } finally { release(); }
    },
  };
  function account(kycStatus = 'APPROVED', deposit = '5000', volume = '0', unknownVolume = false) {
    const id = 'local-card-user-' + users.size, sid = 'local-card-session-' + users.size;
    const row = { id, kycStatus, blockedAt: null, cardWaitlistJoinedAt: null,
      deposits: [{ asset: 'USDT', amount: deposit, status: 'CREDITED' }, { asset: 'USDT', amount: '999999', status: 'PENDING' }],
      trades: [{ pair: unknownVolume ? 'BTC/UNKNOWN' : 'BTC/USDT', price: '1', quantity: unknownVolume ? '1' : volume, takerUserId: id, makerUserId: 'counterparty' }],
    };
    // No-volume history has no fills, rather than a zero-quantity invalid fill.
    if (!unknownVolume && volume === '0') row.trades = [];
    users.set(id, row); sessions.set(sid, { id: sid, userId: id, revokedAt: null, lastSeenAt: new Date() });
    return { id, sid, token: jwt.sign({ sub: id, sid }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  }
  return { db, users, sessions, applications, audits, account, transactionCount: () => transactionCount };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.existsSync(path.join(dist, 'index.html')), 'Normal production build required');
  const fixture = memoryDatabase();
  const app = express(), apiLog = [];
  app.use(express.json());
  app.use((req, res, next) => {
    apiLog.push({ method: req.method, path: req.path });
    if (!['GET', 'HEAD'].includes(req.method) && !(req.method === 'POST' && /^\/api\/v1\/card\/(application|waitlist\/join)$/.test(req.path))) {
      return res.status(405).json({ error: 'Only isolated Card QA writes are available' });
    }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use('/api/v1', cardRouter(fixture.db, { async pricesFor(assets) {
    return new Map(assets.map(asset => [asset, ['USDT', 'USD'].includes(asset) ? 1 : null]));
  } }));
  const auth = requireAuth(fixture.db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'local-card@example.invalid',
    displayName: 'Local Card QA', avatarUrl: null, isAdmin: false, kycStatus: fixture.users.get(req.userId).kycStatus,
    twoFactorEnabled: false, createdAt: '2026-09-06T00:00:00Z' }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_req, res) => res.json([]));
  app.get('/api/v1/wallet/portfolio-history', auth, (_req, res) => res.json({ points: [] }));
  app.get('/api/v1/support/conversations/mine', auth, (_req, res) => res.json({ conversation: null }));
  app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ tickers: [] }));
  app.use((req, res) => res.status(404).json({ error: 'Unrelated QA endpoint not implemented', path: req.path }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const run = fs.mkdtempSync(path.join(output, 'nginx-'));
  fs.mkdirSync(path.join(run, 'logs')); fs.mkdirSync(path.join(run, 'temp'));
  const block = fs.readFileSync(path.join(root, 'frontend/nginx.conf'), 'utf8')
    .replace('listen 80;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root "${unix(dist)}";`)
    .replace('    index index.html;', `    index index.html;\n    location /api/ { proxy_pass ${apiOrigin}; }`);
  fs.writeFileSync(path.join(run, 'qa.conf'), `daemon off;\nmaster_process off;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents { worker_connections 256; }\nhttp { include "${unix(mime)}";\n${block}\n}`);
  const args = ['-p', unix(run) + '/', '-c', 'qa.conf'];
  const syntax = spawnSync(nginx, [...args, '-t'], { cwd: run, encoding: 'utf8', windowsHide: true });
  if (syntax.status !== 0) await new Promise(resolve => server.close(resolve));
  assert.equal(syntax.status, 0, syntax.error?.message || syntax.stderr);
  const child = spawn(nginx, args, { cwd: run, windowsHide: true, stdio: 'ignore' });
  let browser;
  const report = { environment: 'LOCAL QA ONLY', origin, checkedAt: new Date().toISOString(),
    handling: 'Actual production Card router/service/requireAuth, in-memory serialized rollback transactions; local USD fixture quotes',
    apiChecks: [], widths: [], languages: [], assets: [], requests: apiLog, blockedRemoteRequests: [] };
  async function request(user, method = 'GET', route = '/card/application/me', body) {
    const response = await fetch(origin + '/api/v1' + route, { method,
      headers: { ...(user ? { Authorization: 'Bearer ' + user.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), data: await response.json() };
  }
  try {
    for (let tries = 0; tries < 100; tries++) {
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
      if (tries === 99) throw new Error('QA nginx did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const matrix = [
      ['A', 'NOT_STARTED', '6000', '60000', false, false],
      ['B', 'APPROVED', '4999.99', '49999.99', false, false],
      ['C', 'APPROVED', '5000', '0', true, false],
      ['D', 'APPROVED', '0', '50000', true, false],
      ['E', 'APPROVED', '6000', '0', true, true],
    ];
    for (const [caseId, kyc, deposit, volume, eligible, unknown] of matrix) {
      const user = fixture.account(kyc, deposit, volume, unknown), result = await request(user);
      assert.equal(result.status, 200); assert.match(result.cache, /no-store/);
      assert.equal(result.data.eligibility.eligible, eligible, caseId);
      assert.equal(result.data.application, null);
      const submitted = await request(user, 'POST', '/card/application', { product: 'TITANIUM' });
      assert.equal(submitted.status, eligible ? 200 : 403, caseId);
      if (eligible) assert.equal(submitted.data.application.status, 'SUBMITTED');
      report.apiChecks.push({ caseId, kyc, deposit, volume, unknownVolume: unknown, eligible, submitStatus: submitted.status });
    }
    const replay = fixture.account();
    const [first, second] = await Promise.all([request(replay, 'POST', '/card/application', { product: 'BLACK_SIGNATURE' }), request(replay, 'POST', '/card/application', { product: 'BLACK_SIGNATURE' })]);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.deepEqual(first.data.application, second.data.application);
    assert.equal(fixture.audits.filter(row => row.userId === replay.id).length, 1);
    const other = await request(replay, 'POST', '/card/application', { product: 'TITANIUM' });
    assert.equal(other.status, 409); assert.deepEqual(other.data.application, first.data.application);
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(null, 'POST', '/card/application', { product: 'TITANIUM' })).status, 401);
    assert.equal((await request(replay, 'POST', '/card/application', { product: 'TITANIUM', userId: 'other', eligible: true })).status, 400);
    assert.equal((await request(replay, 'POST', '/card/application', { product: 'ICY_WHITE' })).status, 400);
    assert.equal((await request(replay, 'POST', '/card/waitlist/join', {})).status, 410);
    const revoked = fixture.account(); fixture.sessions.get(revoked.sid).revokedAt = new Date();
    assert.equal((await request(revoked)).status, 401);
    report.apiChecks.push({ caseId: 'F-I', concurrentSameProduct: 200, uniqueApplication: true, auditEvents: 1,
      differentProduct: 409, unauthenticated: 401, fakeOwnership: 400, invalidProduct: 400, legacyPost: 410, revokedSession: 401 });
    // Verify the in-memory adapter rolls back both writes if a transaction fails.
    const savedRows = JSON.stringify([...fixture.applications]), savedAudits = JSON.stringify(fixture.audits);
    const rollbackUser = fixture.account();
    await assert.rejects(fixture.db.$transaction(async tx => {
      await tx.cardApplication.create({ data: { userId: rollbackUser.id, product: 'TITANIUM', status: 'SUBMITTED' } });
      await tx.auditLog.create({ data: { userId: rollbackUser.id, action: 'ROLLBACK_TEST' } });
      throw new Error('intentional local rollback test');
    }, { isolationLevel: 'Serializable' }), /intentional local rollback/);
    assert.equal(JSON.stringify([...fixture.applications]), savedRows); assert.equal(JSON.stringify(fixture.audits), savedAudits);
    for (const filename of fs.readdirSync(path.join(root, 'frontend/public/cards/crypto-card-final'))) {
      const response = await fetch(origin + '/cards/crypto-card-final/' + filename);
      assert.equal(response.status, 200);
      const body = Buffer.from(await response.arrayBuffer()), original = fs.readFileSync(path.join(root, 'frontend/public/cards/crypto-card-final', filename));
      assert.equal(sha(body), sha(original));
      const type = response.headers.get('content-type');
      if (filename.endsWith('.png')) assert.match(type, /image\/png/);
      if (filename.endsWith('.webp')) assert.match(type, /image\/webp/);
      if (filename.endsWith('.jpg')) assert.match(type, /image\/jpeg/);
      report.assets.push({ filename, bytes: body.length, sha256: sha(body), contentType: type });
    }
    console.log('Card A-I, actual auth, transactional persistence and all fifteen build assets PASS');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    async function contextFor(width, user, lang = 'ru') {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(({ token, lang }) => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', lang); }, { token: user.token, lang });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        // Existing main typography uses Google Fonts; Card masters, scenes and
        // the page-specific Fraunces font still must load from the local build.
        const inheritedFont = ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
        if (/^https?:$/.test(url.protocol) && url.origin !== origin && !inheritedFont) {
          report.blockedRemoteRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      return context;
    }
    async function load(page, action = 'apply') {
      const response = await page.goto(origin + '/card', { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.locator('.crypto-card-page').waitFor();
      await page.locator(`[data-card-application-state="${action}"]`).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.voltex-prelaunch-notice').count(), 1);
      assert.match(await page.locator('.voltex-prelaunch-notice').innerText(), /DEMO \/ PRE-LAUNCH/);
    }
    async function inspect(page) {
      for (const section of await page.locator('.crypto-card-page main > section').all()) {
        await section.scrollIntoViewIfNeeded(); await page.waitForTimeout(60);
      }
      // Some photographic images live far from a tall section's center. Reveal
      // each lazy image individually before waiting for its native decode.
      for (const image of await page.locator('.crypto-card-page img').all()) {
        if (!(await image.isVisible())) continue;
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(image => Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('Image decode timeout: ' + image.getAttribute('src'))), 15000))]));
      }
      const images = await page.evaluate(async () => {
        const found = [...document.querySelectorAll('.crypto-card-page img')].filter(image => {
          const box = image.getBoundingClientRect(); return box.width > 0 && box.height > 0;
        });
        await Promise.all(found.map(image => image.decode()));
        const svgSources = [...new Set([...document.querySelectorAll('.crypto-card-page image')].map(image => image.getAttribute('href')))];
        const svg = await Promise.all(svgSources.map(src => new Promise((resolve, reject) => {
          const image = new Image(); image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Broken SVG source ' + src)); image.src = src;
        })));
        return { raster: found.map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })), svg };
      });
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        sections: document.querySelectorAll('.crypto-card-page main > section').length,
        products: [...document.querySelectorAll('[data-card-product]')].map(node => node.getAttribute('data-card-product')),
      }));
      assert.equal(geometry.sections, 12); assert.equal(geometry.scrollWidth, geometry.width);
      assert.deepEqual(geometry.products, ['TITANIUM', 'BLACK_SIGNATURE']);
      for (const image of [...images.raster, ...images.svg]) {
        assert(image.width > 0 && image.height > 0);
        if (/voltex-(titanium|black-signature)-final\.png$/.test(image.src)) assert.deepEqual([image.width, image.height], [1580, 996]);
      }
      return { ...geometry, images };
    }
    for (const width of [1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375]) {
      const user = fixture.account(), context = await contextFor(width, user), page = await context.newPage();
      const errors = [], consoleErrors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
      await load(page); console.log('Card width ' + width + ' loaded'); const initial = await inspect(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `card-${width}-hero.jpg`), type: 'jpeg', quality: 60 });
      await page.screenshot({ path: path.join(output, `card-${width}-full.jpg`), type: 'jpeg', quality: 55, fullPage: true });
      await page.locator('#cards').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `card-${width}-comparison.jpg`), type: 'jpeg', quality: 60 });
      await page.locator('.crypto-card-page summary').first().click();
      assert.equal(await page.locator('.crypto-card-page details').first().getAttribute('open'), '');
      if (width < 1024) {
        await page.getByRole('button', { name: 'Открыть разделы карты', exact: true }).click();
        await page.locator('#crypto-card-mobile-sections a[href="#apply"]').click();
        assert.equal(await page.locator('#crypto-card-mobile-sections').count(), 0);
      } else await page.locator('.crypto-card-section-nav a[href="#apply"]').click();
      const panel = page.locator('[data-card-application-state="apply"]');
      await panel.locator('select').selectOption('BLACK_SIGNATURE');
      await panel.locator('select').selectOption('TITANIUM');
      await panel.scrollIntoViewIfNeeded();
      const before = fixture.audits.length;
      // Two native activation events in the same turn exercise the controller guard.
      await panel.getByRole('button', { name: 'Получить карту', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.locator('[data-card-application-state="submitted"]').waitFor();
      assert.equal(fixture.audits.length, before + 1);
      const saved = (await request(user)).data.application;
      assert.equal(saved.product, 'TITANIUM');
      assert.equal((await page.reload({ waitUntil: 'domcontentloaded' })).status(), 200);
      await page.locator('[data-card-application-state="submitted"]').waitFor();
      assert((await page.locator('[data-card-application-state="submitted"]').innerText()).includes(saved.id));
      assert.deepEqual((await request(user)).data.application, saved);
      await page.locator('[data-card-application-state="submitted"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `card-${width}-application.jpg`), type: 'jpeg', quality: 65 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
      report.widths.push({ width, ...initial, application: saved, f5: 200, duplicateClickAuditCount: 1, errors, consoleErrors });
      await context.close(); console.log('Card width ' + width + ' PASS');
    }
    // A second product/account, UI state matrix and all seven languages on desktop/mobile.
    for (const width of [1440, 390]) {
      const black = fixture.account('APPROVED', '0', '50000'), context = await contextFor(width, black), page = await context.newPage();
      await load(page); await page.locator('[data-card-application-state="apply"] select').selectOption('BLACK_SIGNATURE');
      await page.locator('[data-card-application-state="apply"] button').click();
      await page.locator('[data-card-application-state="submitted"]').waitFor();
      assert.equal((await request(black)).data.application.product, 'BLACK_SIGNATURE');
      await page.reload(); await page.locator('[data-card-application-state="submitted"]').waitFor();
      await context.close();
      for (const [action, user] of [['verify', fixture.account('NOT_STARTED', '6000', '60000')], ['fund', fixture.account('APPROVED', '4999.99', '49999.99')]]) {
        const ctx = await contextFor(width, user), pg = await ctx.newPage(); await load(pg, action);
        const panel = pg.locator('[data-card-application-state]');
        assert.equal(await panel.locator('select').count(), 0);
        if (action === 'verify') assert.equal(await panel.locator('a').getAttribute('href'), '/settings?tab=verification');
        else assert.match(await panel.innerText(), /5 000 или.*50 000/);
        await panel.scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(output, `card-${width}-${action}.jpg`), type: 'jpeg', quality: 60 });
        await ctx.close();
      }
      for (const lang of ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko']) {
        const user = fixture.account(), ctx = await contextFor(width, user, lang), pg = await ctx.newPage();
        const errors = []; pg.on('pageerror', error => errors.push(error.message));
        pg.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        await load(pg); const checks = await inspect(pg);
        assert.equal(await pg.locator('.crypto-card-page').getAttribute('lang'), lang);
        const title = await pg.locator('.crypto-card-page h1').innerText(); assert(title.trim());
        assert.deepEqual(errors, []); report.languages.push({ width, lang, title, scrollWidth: checks.scrollWidth, errors });
        await ctx.close();
      }
    }
    const switchUser = fixture.account(), switchContext = await contextFor(1440, switchUser), switchPage = await switchContext.newPage();
    await load(switchPage);
    await switchPage.getByRole('button', { name: 'Language / Язык / 语言', exact: true }).click();
    await switchPage.getByRole('button', { name: 'EN', exact: true }).click();
    await switchPage.locator('.crypto-card-page[lang="en"]').waitFor();
    assert.equal(await switchPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await switchContext.close();
    assert.deepEqual(report.blockedRemoteRequests, []);
    report.transactions = fixture.transactionCount(); report.persistedApplications = fixture.applications.size;
    report.auditEvents = fixture.audits.length; report.languageSwitch = 'RU to EN via real navigation control';
    report.status = 'PASS';
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, widths: report.widths.length, languages: report.languages.length,
      assets: report.assets.length, persistedApplications: report.persistedApplications, output }));
  } catch (error) {
    report.status = 'FAIL'; report.failure = error.stack;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); throw error;
  } finally {
    if (browser) await browser.close();
    child.kill(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
