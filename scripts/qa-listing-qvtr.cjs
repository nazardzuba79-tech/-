'use strict';
/**
 * QAVENTRA (QVTR/USDT), the candidate listing of 2026-10-28 13:00 UTC = 16:00 Moscow,
 * end to end in a local, disposable copy of the managed-listings system.
 *
 * Real pieces: the market-edge Worker bundle in workerd (Miniflare, SQLite
 * Durable Object on disk), this checkout's Render admin router with its auth
 * middleware, CloudflareListingStore and registry, the production frontend
 * bundle in Chromium. Synthetic: the admin and user accounts, every other
 * /api/v1 read, the venue (BTC/USDT only). Nothing leaves the machine.
 *
 * 1. Import through the Admin Listings FORM (worker A) and through the admin
 *    API with the JSON file (worker B): both store the same draft, equal to
 *    config/test-markets/qvtr-20261028.draft.json; the seed is the manual one
 *    and survives every save; a second QVTR is refused (DUPLICATE_TICKER).
 * 2. Private preview: 0.0140 → 0.1092 USDT after 24 h, nothing above 0.88858.
 * 3. LOCAL worker A only: publish with the timer off (staged, hidden), then
 *    start the timer — the exchange shows the countdown card, the logo at
 *    20/24/64 px, Spot search and Markets, desktop 1440 and phone 390.
 * 4. After the opening, in the browser only: the edge responses of the same
 *    published listing are computed by the Worker's own code
 *    (listingPublic.managedListingResponse) at a simulated server time; the
 *    local Worker's clock and the listing are never moved.
 *
 *   VITE_MARKET_EDGE_URL=http://127.0.0.1:8787 npx vite build --outDir <dir>   (in frontend/)
 *   QA_FRONTEND_DIST=<dir> node scripts/qa-listing-qvtr.cjs
 * Output: docs/qa/listing-qvtr/ (PNG + report.json), or QA_OUT.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'local-qa-only-qvtr-listing-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
delete process.env.LISTINGS_STORE_URL;
delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || (fs.existsSync('/opt/node22/lib/node_modules/playwright') ? '/opt/node22/lib/node_modules/playwright' : 'playwright'));
const edgeRequire = require('node:module').createRequire(path.join(root, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore } = require('../src/services/listings/store');
const { ManagedListingRegistry } = require('../src/services/listings/registry');
const { managedListingResponse } = require('../src/services/listings/listingPublic');
const { assertSpotListing } = require('../src/services/testMarkets/nrxSpot');
const { execFile } = require('node:child_process');

const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const output = path.resolve(process.env.QA_OUT || 'docs/qa/listing-qvtr');
const EDGE_PORT = 8787; // the bundle's VITE_MARKET_EDGE_URL
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const EDGE_B = `http://127.0.0.1:${Number(process.env.QA_EDGE_B_PORT || 8796)}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0602';
const file = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/qvtr-20261028.draft.json'), 'utf8'));
const logoPath = path.join(root, 'config/test-markets/qvtr-20261028.logo.svg');
const AT = Date.parse(file.listingAt), HOUR = 3_600_000, DAY = 24 * HOUR;
// Use the interior of a day, not exactly 48 h: a ticking browser legitimately
// renders 01 day immediately after the 48 h boundary. Test rollover separately.
// All clocks below are confined to localhost Chromium, workerd and the local admin router.
const QA_PRELISTING_NOW = AT - 2 * DAY - 6 * HOUR;
const DATE_LINE = '28.10.2026 — 13:00 UTC / 16:00 МСК';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
fs.mkdirSync(output, { recursive: true });

const report = { scope: 'Local only: Worker in workerd + this checkout\'s admin router + production bundle in Chromium. Publication and timer happen on the local Worker only.',
  candidate: { name: file.name, symbol: file.symbol, listingAt: file.listingAt, displayTimeZone: file.displayTimeZone, seed: file.seed, initialPrice: file.initialPrice },
  checks: [], failures: [], screenshots: [], renderCalls: [], outbound: 0, pageErrors: [] };
const check = (name) => { report.checks.push(name); console.log('✓', name); };
const step = async (name, fn) => {
  try { await fn(); check(name); } catch (error) {
    const msg = String(error && error.stack || error).replace(/\s+/g, ' ').slice(0, 600);
    report.failures.push(`${name}: ${msg}`); console.log('✗', name, '—', msg);
  }
};

async function startEdge(port, persist) {
  // The esbuild substitutions exist ONLY in this disposable workerd bundle; the
  // repository Worker source, canonical QVTR date and production bundle are untouched.
  // Every Date.now() inside this local Worker sees the same historical clock.
  const bundle = await build({ entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:*'],
    define: { 'Date.now': '__voltexQaNow' },
    banner: { js: 'const __voltexQaNow = () => ' + QA_PRELISTING_NOW + ';' },
  });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port });
  await mf.ready;
  return mf;
}

const accounts = { 'qa-admin': 'ADMIN', 'qa-user': 'USER' };
const prisma = {
  user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id] } : null) },
  session: { findUnique: async () => null, update: async () => null },
};
const tokens = { admin: jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET), user: jwt.sign({ sub: 'qa-user' }, process.env.JWT_SECRET) };
const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/market/test-assets': () => ({ serverTime: Date.now(), assets: [] }),
  '/market/display/spot-snapshot': () => ({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 }, tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] }, overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }],
  '/market/external/tickers': () => ({ tickers: [btc] }), '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }], '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }), '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }), '/market/snapshot': () => ({ pairs: [], fetchedAt: Date.now() }),
  '/futures/config': () => ({ symbols: [] }), '/market/display': () => ({ type: 'snapshot', rows: [] }), '/market/universe': () => ({ available: false, instruments: [] }),
};

async function renderFor(edge, label) {
  const store = new CloudflareListingStore(edge, STORE_TOKEN);
  const registry = new ManagedListingRegistry(store);
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.use('/api/v1', (req, _res, next) => { report.renderCalls.push(`${label} ${req.method} ${req.path}`); next(); });
  app.get('/api/v1/me', (req, res) => {
    const sub = String(req.headers.authorization || '').endsWith(tokens.user) ? 'qa-user' : 'qa-admin';
    res.json({ id: sub, email: `${sub}@example.invalid`, displayName: sub, role: accounts[sub], isAdmin: accounts[sub] === 'ADMIN', kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' });
  });
  app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry, () => QA_PRELISTING_NOW));
  app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
  app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
  app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA disallows writes' }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, { method = 'GET', body, ifMatch } = {}) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json', ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { store, registry, server, origin, api };
}

/** The stored draft without what the store assigns on creation. */
const comparable = (draft) => { const { simulationProfile: _p, wickModel: _w, ...rest } = draft; return rest; };
const edgeJson = async (base, p) => { const r = await fetch(`${base}${p}`, { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null) }; };

(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), `build the frontend first: QA_FRONTEND_DIST=${dist}`);
  const persistA = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-qvtr-qa-a-'));
  const persistB = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-qvtr-qa-b-'));
  let mfA, mfB, A, B, browser;
  let viaForm = null, viaApi = null, idA = null;

  const newPage = async (origin, width, who = 'admin', clock = null) => {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU', serviceWorkers: 'block' });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if (clock && u.startsWith(EDGE)) {
        // After the opening: the Worker's own response code, at a simulated server time, over the listing published on worker A.
        const published = await A.store.published();
        const response = managedListingResponse(new Request(u, { method: route.request().method() }), published.listings, clock.now(), published.revision);
        if (response) return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      if (u.startsWith(origin) || u.startsWith(EDGE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      if(new URL(u).hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:'/* isolated QA system fonts */'});
      return route.abort();
    });
    await context.addInitScript(([token, offset]) => {
      try { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); } catch {}
      if (offset) {
        const RealDate = Date;
        const realNow = RealDate.now.bind(RealDate);
        const qaClock = { offset };
        globalThis.__voltexQaClock = qaClock;
        class FixtureDate extends RealDate {
          constructor(...args) { if (args.length === 0) super(realNow() + qaClock.offset); else super(...args); }
          static now() { return realNow() + qaClock.offset; }
        }
        globalThis.Date = FixtureDate;
      }
    }, [tokens[who], clock ? clock.offset : QA_PRELISTING_NOW - Date.now()]);
    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(`${who}@${width}: ${error.message}`));
    return page;
  };
  const shot = async (page, name, options = {}) => { await page.screenshot({ path: path.join(output, name), animations: 'disabled', ...options }); report.screenshots.push(name); };

  try {
    mfA = await startEdge(EDGE_PORT, persistA);
    mfB = await startEdge(Number(new URL(EDGE_B).port), persistB);
    A = await renderFor(EDGE, 'A');
    B = await renderFor(EDGE_B, 'B');
    browser = await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_PATH ? {executablePath:process.env.QA_CHROMIUM_PATH} : {})});
    // Preserve an unrelated ECLAVO in BOTH disposable stores, not a renamed alias.
    const eclvFile=JSON.parse(fs.readFileSync(path.join(root,'config/test-markets/eclv-20261103.draft.json'),'utf8'));
    const {schemaVersion: _eclvSchema,...eclvConfig}=eclvFile;
    const eclvSnapshots=[];
    for(const instance of [A,B]) {
      assert.equal((await instance.api('/admin/listings',{method:'POST',body:{config:eclvConfig}})).status,201);
      eclvSnapshots.push((await instance.api('/admin/listings')).body.listings.find(l=>l.symbol==='ECLV'));
    }
    /* 1a. Import through the Admin Listings form on worker A, exactly as the owner would type it. */
    await step('form import (1440): every field typed in Admin → Listings, logo uploaded from the SVG file, «Сохранить черновик»', async () => {
      const page = await newPage(A.origin, 1440);
      await page.goto(`${A.origin}/admin/listings`);
      await page.locator('[data-create-listing]').click({ timeout: 20000 });
      await page.locator('[data-listing-form]').waitFor();
      const p = file.simulationProgram;
      await page.fill('[data-field="name"]', file.name);
      await page.fill('[data-field="symbol"]', file.symbol);
      await page.fill('[data-field="initialPrice"]', file.initialPrice);
      await page.fill('[data-field="ownerAllocation"]', file.ownerAllocation);
      await page.selectOption('[data-field="timeZone"]', 'Europe/Moscow');
      await page.fill('[data-field="wallTime"]', '2026-10-28T16:00');
      assert.match(await page.locator('[data-listing-utc]').innerText(), /28\.10\.2026 13:00 Всемирное время \(UTC\)/);
      await page.locator('.listing-seed label', { hasText: 'Вручную' }).locator('input').check();
      await page.fill('[data-field="seed"]', file.seed);
      await page.setInputFiles('[data-field="logo"]', logoPath);
      await page.locator('.listing-logo img').waitFor();
      // Movement: the scenario first (it presets the fine settings), then the numbers.
      await page.selectOption('[data-field="scenario"]', p.scenario);
      await page.fill('[data-field="first24hGainPercent"]', p.first24hGainPercent);
      await page.fill('[data-field="maxPrice"]', p.maxPrice);
      await page.locator('[data-movement-stages] > summary').click();
      while (await page.locator('[data-stage]').count() < p.stages.length) await page.locator('[data-add-stage]').click();
      for (const [index, stage] of p.stages.entries()) {
        await page.selectOption(`[data-field="stageType-${index}"]`, stage.type);
        await page.fill(`[data-field="stageDuration-${index}"]`, String(stage.durationHours));
        await page.fill(`[data-field="stageTarget-${index}"]`, stage.targetPrice);
      }
      await page.locator('[data-movement-advanced] > summary').click();
      await page.selectOption('[data-field="pullbackFrequency"]', p.pullbacks.frequency);
      await page.fill('[data-field="pullbackDuration"]', String(p.pullbacks.durationMinutes));
      await page.fill('[data-field="pullbackMin"]', p.pullbacks.minDepthPercent);
      await page.fill('[data-field="pullbackMax"]', p.pullbacks.maxDepthPercent);
      await page.selectOption('[data-field="candleIntensity"]', p.candles.intensity);
      await page.locator('[data-field="candleDiversity"]').fill(String(p.candles.diversity));
      await page.selectOption('[data-field="candlePauses"]', p.candles.pauseFrequency);
      await page.selectOption('[data-field="wickLength"]', p.wicks.length);
      await page.selectOption('[data-field="longWickFrequency"]', p.wicks.longFrequency);
      assert.equal(await page.locator('[data-field="tradable"]').isChecked(), false);
      await shot(page, 'admin-form-filled-1440.png', { fullPage: true });
      const saved = page.waitForResponse((r) => r.url().endsWith('/admin/listings') && r.request().method() === 'POST', { timeout: 20000 });
      await page.locator('[data-save-draft]').click();
      const response = await saved;
      assert.equal(response.status(), 201, await response.text());
      const body = await response.json();
      idA = body.id; viaForm = body.draft;
      await page.context().close();
    });

    await step('the form-made draft equals the JSON file exactly (store adds only its profile and wick model)', async () => {
      assert.ok(viaForm, 'no draft from the form');
      assert.deepEqual(comparable(viaForm), file);
      assert.ok(viaForm.simulationProfile && viaForm.wickModel === 'NATURAL_V1');
    });

    /* 1b. The single-draft import tool with the same JSON (worker B, a fresh store): preflight, one create, a repeat sends nothing. */
    // Asynchronous: the local Render B answers the tool from this very process.
    const importTool = (args = []) => new Promise((resolve) => {
      execFile(process.execPath, [path.join(root, 'scripts/qvtr-draft-import.cjs'), ...args], { encoding: 'utf8', timeout: 60000,
        env: { PATH: process.env.PATH, VOLTEX_API: B.origin, VOLTEX_MARKET: EDGE_B, VOLTEX_ADMIN_TOKEN: tokens.admin } }, (error, stdout, stderr) => {
        assert.ok(!stdout.includes(tokens.admin) && !stderr.includes(tokens.admin), 'the tool never prints the token');
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, out: `${stdout}${stderr}` });
      });
    });
    const posts = () => report.renderCalls.filter((call) => call === 'B POST /admin/listings').length - 1; // exclude the preserved ECLAVO fixture
    await step('import tool: the preflight is read-only and clean; --create makes ONE draft equal to the file and to the form-made one; a repeat --create sends nothing', async () => {
      const preflight = await importTool();
      assert.equal(preflight.code, 0, preflight.out);
      assert.match(preflight.out, /PREFLIGHT: OK — no QVTR/);
      assert.equal(posts(), 0, 'the preflight wrote nothing');
      const created = await importTool(['--create']);
      assert.equal(created.code, 0, created.out);
      assert.match(created.out, /CREATED one private draft qvtr-[0-9a-f]{8}/);
      assert.equal(posts(), 1);
      const listed = (await B.api('/admin/listings')).body.listings.filter(l => l.symbol === file.symbol);
      assert.equal(listed.length, 1);
      viaApi = listed[0].draft;
      assert.deepEqual(comparable(viaApi), file);
      assert.deepEqual(viaApi, viaForm, 'tool and form store the same configuration (same first-creation profile)');
      assert.equal(listed[0].activeVersion, null, 'never published');
      assert.equal(listed[0].countdown ?? null, null, 'no timer');
      const again = await importTool(['--create']);
      assert.equal(again.code, 0, again.out);
      assert.match(again.out, /NOT CREATED: already imported as qvtr-[0-9a-f]{8}; nothing sent/);
      assert.equal(posts(), 1, 'a repeat sends no second POST');
      report.importTool = { preflight: preflight.out.trim().split('\n'), create: created.out.trim().split('\n'), repeat: again.out.trim().split('\n').at(-1) };
      report.draft = { id: listed[0].id, scenario: viaApi.simulationProgram.scenario, simulationProfile: viaApi.simulationProfile, wickModel: viaApi.wickModel, seed: viaApi.seed };
    });

    await step('no duplicates, no new seed: a second QVTR is 409 DUPLICATE_TICKER (manual or automatic seed); saves keep the seed and profile; a stale save is 409', async () => {
      const { schemaVersion: _schema, ...config } = file;
      for (const body of [{ config }, { config: { ...config, seedMode: 'auto', seed: undefined } }, { config: { ...config, seed: 'qaventra-20261028-v2' } }]) {
        const again = await B.api('/admin/listings', { method: 'POST', body });
        assert.deepEqual([again.status, again.body.error], [409, 'DUPLICATE_TICKER'], JSON.stringify(again.body));
      }
      const listed = (await B.api('/admin/listings')).body.listings.filter(l => l.symbol === file.symbol);
      assert.equal(listed.filter((l) => l.symbol === 'QVTR').length, 1);
      const id = listed[0].id, revision = listed[0].draftRevision;
      const resaved = await B.api(`/admin/listings/${id}/draft`, { method: 'PUT', ifMatch: revision, body: { config } });
      assert.equal(resaved.status, 200, JSON.stringify(resaved.body));
      assert.deepEqual([resaved.body.draftRevision, resaved.body.draft.seed, resaved.body.draft.simulationProfile], [revision + 1, file.seed, viaApi.simulationProfile]);
      const stale = await B.api(`/admin/listings/${id}/draft`, { method: 'PUT', ifMatch: revision, body: { config } });
      assert.equal(stale.status, 409);
      const formAgain = await A.api('/admin/listings', { method: 'POST', body: { config } });
      assert.deepEqual([formAgain.status, formAgain.body.error], [409, 'DUPLICATE_TICKER']);
    });

    await step('importer refuses a differing existing QVTR without another POST, and ECLAVO is not a conflict', async () => {
      const before = (await B.api('/admin/listings')).body.listings.find(l => l.symbol === file.symbol);
      const { schemaVersion: _schema, ...config } = file;
      const changed = await B.api(`/admin/listings/${before.id}/draft`, { method:'PUT', ifMatch:before.draftRevision, body:{config:{...config,name:'SYNTHETIC DIFFERING QVTR'}} });
      assert.equal(changed.status,200,JSON.stringify(changed.body));
      const count=posts();
      for(const args of [[],['--create']]) { const run=await importTool(args); assert.equal(run.code,2,run.out); }
      assert.equal(posts(),count,'the importer never sends a POST when configuration differs');
      const restored=await B.api(`/admin/listings/${before.id}/draft`, { method:'PUT', ifMatch:changed.body.draftRevision, body:{config} });
      assert.equal(restored.status,200,JSON.stringify(restored.body));
    });

    /* 2. The private preview of the draft. */
    await step('private preview: 0.014 at 13:00 UTC, 0.1092 after 24 h (+680 %), every 5m/1h candle within (0, 0.88858]; 12:59:50 UTC has no candles', async () => {
      const first = await A.api(`/admin/listings/${idA}/preview?horizon=first24h&interval=5m`);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const summary = first.body.scenarioSummary;
      assert.deepEqual([summary.initialPrice, summary.first24hPrice, summary.maxPrice].map(Number), [0.014, 0.1092, 0.88858]);
      const candles = first.body.candles;
      assert.equal(candles[0].open, 0.014);
      assert.ok(Math.abs(candles.at(-1).close - 0.1092) < 1e-9, `24 h close ${candles.at(-1).close}`);
      const growth = await A.api(`/admin/listings/${idA}/preview?horizon=growth&interval=1h`);
      assert.equal(growth.status, 200);
      for (const c of [...candles, ...growth.body.candles]) assert.ok(c.low > 0 && c.high <= 0.88858, JSON.stringify(c));
      const before = await A.api(`/admin/listings/${idA}/preview?at=2026-10-28T12:59:50Z&interval=5m`);
      assert.deepEqual([before.body.asset.state.phase, before.body.candles.length], ['pre-listing', 0]);
      report.preview = { first24h: { ...summary, candles: candles.length, high: Math.max(...candles.map((c) => c.high)), low: Math.min(...candles.map((c) => c.low)) },
        growth: { ...growth.body.scenarioSummary, candles: growth.body.candles.length, high: Math.max(...growth.body.candles.map((c) => c.high)) } };
    });

    await step('draft only so far: the public catalogue is empty, Render does not know QVTR, the Worker called out to nothing', async () => {
      assert.deepEqual((await edgeJson(EDGE, '/market/listings')).body.assets, []);
      const pair = await fetch(`${EDGE}/market/test-assets/QVTR-USDT`);
      assert.notEqual(pair.status, 200);
      // Render's published view (its Spot gate and price source) has no QVTR: nothing exists to trade or value.
      assert.equal((await A.registry.authoritative()).some((item) => item.config.symbol === 'QVTR'), false);
      assert.equal(report.outbound, 0);
    });

    for (const width of [1440, 390]) {
      await step(`admin ${width}: the draft row shows UTC · Kyiv · Moscow; the form reopens with the same values; private preview renders`, async () => {
        const page = await newPage(A.origin, width);
        await page.goto(`${A.origin}/admin/listings`);
        await page.reload(); // Re-read the persisted draft, not just local form state.
        const row = page.locator('[data-listing-row="QVTR"]');
        await row.waitFor({ timeout: 20000 });
        const text = await row.innerText();
        for (const part of ['QVTR/USDT', 'QAVENTRA', 'Черновик', '28.10.2026 13:00 Всемирное время (UTC)', '28.10.2026 15:00 Киев (UTC+2)', '28.10.2026 16:00 Москва (UTC+3)']) assert.ok(text.includes(part), `${width}: ${part} in «${text}»`);
        await shot(page, `admin-draft-row-${width}.png`);
        await page.locator('[data-edit-listing="QVTR"]').click();
        await page.locator('[data-listing-form]').waitFor();
        assert.deepEqual(await Promise.all(['symbol', 'name', 'initialPrice', 'wallTime', 'timeZone', 'seed'].map((f) => page.inputValue(`[data-field="${f}"]`))),
          ['QVTR', 'QAVENTRA', '0.0140', '2026-10-28T16:00', 'Europe/Moscow', 'qaventra-20261028-v1']);
        await page.locator('[data-preview]').click();
        await page.locator('[data-listing-preview]').waitFor({ timeout: 30000 });
        await page.locator('[data-preview-summary]').scrollIntoViewIfNeeded();
        await shot(page, `admin-preview-${width}.png`);
        await page.context().close();
      });
    }

    /* 3. LOCAL worker A only: publish with the timer off, then start it. */
    await step('local publish (1440): «Опубликовать» with the timer unticked → staged, nothing on the exchange; «Запустить таймер» → running, QVTR/USDT public', async () => {
      const page = await newPage(A.origin, 1440);
      await page.goto(`${A.origin}/admin/listings`);
      await page.locator('[data-edit-listing="QVTR"]').click({ timeout: 20000 });
      await page.locator('[data-publish]').click();
      await page.locator('[data-publish-dialog]').waitFor();
      await page.locator('[data-field="publishStartTimer"]').uncheck();
      await shot(page, 'admin-publish-dialog-1440.png');
      const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/publish$/.test(r.url()));
      await page.locator('[data-confirm-publish]').click();
      assert.equal((await sent).postDataJSON().countdown, 'staged');
      await page.locator('[data-listing-timer="staged"]').waitFor({ timeout: 15000 });
      assert.deepEqual((await edgeJson(EDGE, '/market/listings')).body.assets, []);
      await page.locator('[data-timer-action="start"]').click();
      await page.locator('[data-listing-timer="running"]').waitFor({ timeout: 15000 });
      const assets = (await edgeJson(EDGE, '/market/listings')).body.assets;
      assert.deepEqual(assets.map((a) => [a.pair, a.countdown, a.state.phase, a.initialPrice, a.displayTimeZone, a.isTradable]), [['QVTR/USDT', 'running', 'pre-listing', 0.014, 'Europe/Moscow', false]]);
      assert.equal(assets[0].logo, file.logo);
      await A.registry.ensureFresh(3000);
      assert.throws(() => assertSpotListing('QVTR/USDT'), 'tradable:false refuses every order');
      await shot(page, 'admin-timer-running-1440.png');
      await page.context().close();
    });

    for (const width of [1440, 390]) {
      await step(`exchange ${width}: countdown card with the logo, QAVENTRA, QVTR/USDT, «${DATE_LINE}», 0.014000 USDT; the countdown ticks`, async () => {
        const page = await newPage(A.origin, width, 'user');
        await page.goto(`${A.origin}/trade?pair=QVTR%2FUSDT`);
        if (width < 600) await page.locator('#mobile-trade-chart').click({ timeout: 20000 });
        const card = page.locator('.vta-prelisting[data-countdown="running"]');
        await card.locator('.vta-countdown').waitFor({ timeout: 20000 });
        const text = await card.innerText();
        for (const part of ['QAVENTRA', 'QVTR/USDT', DATE_LINE, '0.014000 USDT']) assert.ok(text.includes(part), `${width}: ${part} in «${text}»`);
        const days = Math.floor((AT - QA_PRELISTING_NOW) / DAY);
        assert.equal((await card.locator('.vta-countdown-cell strong').allInnerTexts())[0], String(days).padStart(2, '0'));
        const mark = card.locator('.vta-prelisting-mark img');
        assert.equal(await mark.getAttribute('src'), file.logo);
        const box = await mark.boundingBox();
        report[`prelistingLogo${width}`] = box && { width: Math.round(box.width), height: Math.round(box.height) };
        const seconds = await card.locator('.vta-countdown-cell strong').nth(3).innerText();
        await page.waitForTimeout(2200);
        assert.notEqual(await card.locator('.vta-countdown-cell strong').nth(3).innerText(), seconds, 'the countdown does not tick');
        await page.reload();
        if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});
        await page.locator('.vta-prelisting[data-countdown="running"]').waitFor({timeout:20000});
        assert.ok((await card.innerText()).includes('QVTR/USDT'));
        assert.equal(await card.locator('.vta-prelisting-mark img').getAttribute('src'),file.logo);
        await shot(page, `exchange-countdown-${width}.png`);
        await page.context().close();
      });
    }

    await step('Spot search (1440): «QVTR» and «qvtr/usdt» find QVTR/USDT with the 20 px logo (the rail searches tickers, not names); the ticker bar shows the 24 px logo', async () => {
      const page = await newPage(A.origin, 1440, 'user');
      await page.goto(`${A.origin}/trade?pair=BTC%2FUSDT`);
      const search = page.locator('.pairs-search input');
      await search.waitFor({ timeout: 20000 });
      report.spotSearch = {};
      for (const query of ['QVTR', 'qaventra', 'qvtr/usdt']) {
        await search.fill(query);
        const row = page.locator('.pair-row[data-pair="QVTR/USDT"]');
        report.spotSearch[query] = await row.count() > 0 && await row.isVisible();
      }
      assert.equal(report.spotSearch.QVTR, true, 'ticker search');
      await search.fill('QVTR');
      const row = page.locator('.pair-row[data-pair="QVTR/USDT"]');
      const icon = row.locator('.p-icon img');
      assert.equal(await icon.getAttribute('src'), file.logo);
      assert.deepEqual([await icon.getAttribute('width'), await icon.getAttribute('height')], ['20', '20']);
      await shot(page, 'spot-search-1440.png');
      await row.locator('.pair-select').click();
      await page.locator('.vta-prelisting[data-countdown="running"]').waitFor({ timeout: 20000 });
      const header = page.locator('.ticker-bar .pair-selector img');
      await header.waitFor({ timeout: 10000 });
      assert.deepEqual([await header.getAttribute('src') === file.logo, await header.getAttribute('width')], [true, '24']);
      await shot(page, 'spot-selected-1440.png');
      await page.context().close();
    });

    await step('Spot search (390): the pair name opens the pair list; «QVTR» finds QVTR/USDT with the 20 px logo; it opens the countdown with the 24 px logo', async () => {
      const page = await newPage(A.origin, 390, 'user');
      await page.goto(`${A.origin}/trade?pair=BTC%2FUSDT`);
      // On the phone the pair name in the ticker bar opens the same pair list with its search focused.
      await page.locator('.ticker-bar .pair-selector').first().click({ timeout: 20000 });
      const search = page.locator('.pairs-search input');
      await search.waitFor({ timeout: 10000 });
      await search.fill('QVTR');
      const row = page.locator('.pair-row[data-pair="QVTR/USDT"]');
      await row.waitFor({ timeout: 10000 });
      const icon = row.locator('.p-icon img');
      assert.equal(await icon.getAttribute('src'), file.logo);
      assert.deepEqual([await icon.getAttribute('width'), await icon.getAttribute('height')], ['20', '20']);
      await shot(page, 'spot-search-390.png');
      await row.locator('.pair-select').click();
      await page.waitForURL(/QVTR/, { timeout: 10000 });
      if (!(await page.locator('.vta-prelisting').isVisible())) await page.locator('#mobile-trade-chart').click();
      await page.locator('.vta-prelisting[data-countdown="running"]').waitFor({ timeout: 20000 });
      const header = page.locator('.ticker-bar .pair-selector img');
      assert.deepEqual([await header.getAttribute('src') === file.logo, await header.getAttribute('width')], [true, '24']);
      await shot(page, 'spot-selected-390.png');
      await page.context().close();
    });

    for (const width of [1440, 390]) {
      await step(`Markets ${width}: the QVTR/USDT row with its logo and «${DATE_LINE}»`, async () => {
        const page = await newPage(A.origin, width, 'user');
        await page.goto(`${A.origin}/markets`);
        const row = page.locator('.test-market-row[data-pair="QVTR/USDT"]');
        await row.waitFor({ timeout: 20000 });
        assert.ok((await row.innerText()).includes(DATE_LINE), await row.innerText());
        assert.equal(await row.locator('img').first().getAttribute('src'), file.logo);
        await row.scrollIntoViewIfNeeded();
        await shot(page, `markets-${width}.png`);
        await page.context().close();
      });
    }

    /* Rollover and opening in the SAME mounted page. Both the served Worker
     * responses and the browser use this one adjustable, still-ticking clock.
     * Never advance the local persistent Worker or mutate a listing to test time. */
    for (const width of [1440, 390]) {
      await step(`clock boundaries ${width}: 02 days → 01 day 23 hours, then countdown → chart without reload`, async () => {
        const clock = { offset: AT - 2 * DAY - HOUR - Date.now(), now() { return Date.now() + this.offset; } };
        const page = await newPage(A.origin, width, 'user', clock);
        const candleResponses = [];
        page.on('response', async (r) => {
          if (/QVTR-USDT\/candles|spot-candles\/QVTR/i.test(r.url())) candleResponses.push(await r.json().catch(() => null));
        });
        const advanceTo = async (at) => {
          clock.offset = at - Date.now();
          await page.evaluate((offset) => { globalThis.__voltexQaClock.offset = offset; }, clock.offset);
        };
        await page.goto(`${A.origin}/trade?pair=QVTR%2FUSDT`);
        if (width < 600) await page.locator('#mobile-trade-chart').click({ timeout: 20000 });
        const card = page.locator('.vta-prelisting[data-countdown="running"]');
        await card.locator('.vta-countdown').waitFor({ timeout: 20000 });
        assert.equal(await card.locator('.vta-countdown-cell strong').first().innerText(), '02');
        await advanceTo(AT - 2 * DAY + 2000);
        await page.waitForFunction(() => {
          const cells = [...document.querySelectorAll('.vta-countdown-cell strong')].map((el) => el.textContent);
          return cells[0] === '01' && cells[1] === '23';
        }, null, { timeout: 10000 });
        await shot(page, `exchange-day-rollover-${width}.png`);
        // Approach opening but let real elapsed time cross it; no reload or
        // direct component/store calls may manufacture the transition.
        await advanceTo(AT - 8000);
        await page.waitForFunction(() => {
          const cells = [...document.querySelectorAll('.vta-countdown-cell strong')].map((el) => el.textContent);
          return cells.length === 4 && cells.slice(0, 3).every((value) => value === '00') && Number(cells[3]) > 0 && Number(cells[3]) <= 8;
        }, null, { timeout: 5000 });
        assert.ok(clock.now() < AT, 'countdown must still be visible before opening');
        await page.locator('.managed-demo-chart canvas').first().waitFor({ timeout: 30000 });
        assert.ok(clock.now() >= AT, 'chart must not appear early');
        assert.equal(await page.locator('.vta-prelisting').count(), 0);
        assert.ok(candleResponses.filter(Boolean).flatMap((b) => b.candles || []).some((c) => c.open === 0.014), 'opening candle must start at canonical 0.014');
        await shot(page, `exchange-opening-transition-${width}.png`);
        await page.context().close();
      });
    }

    /* 4. After the opening — browser only, the Worker's response code at a simulated server time. */
    const moments = [['open-plus-30m', AT + 30 * 60_000], ['open-plus-24h', AT + DAY], ['open-plus-7d', AT + 7 * DAY]];
    for (const width of [1440, 390]) {
      for (const [name, at] of moments) {
        await step(`after the opening ${width}, ${name}: the chart replaces the countdown, candles start at 0.014 and stay ≤ 0.88858`, async () => {
          const offset = at - Date.now();
          const clock = { offset, now: () => Date.now() + offset };
          const page = await newPage(A.origin, width, 'user', clock);
          const candleResponses = [];
          page.on('response', async (r) => { if (/QVTR-USDT\/candles|spot-candles\/QVTR/i.test(r.url())) candleResponses.push(await r.json().catch(() => null)); });
          await page.goto(`${A.origin}/trade?pair=QVTR%2FUSDT`);
          if (width < 600) await page.locator('#mobile-trade-chart').click({ timeout: 20000 });
          await page.locator('.managed-demo-chart canvas').first().waitFor({ timeout: 30000 });
          assert.equal(await page.locator('.vta-prelisting').count(), 0);
          await page.waitForTimeout(1500);
          const candles = candleResponses.filter(Boolean).flatMap((b) => b.candles || []);
          assert.ok(candles.length > 0, 'no candles were served');
          assert.ok(candles.every((c) => c.high <= 0.88858 && c.low > 0));
          if (name === 'open-plus-30m') assert.ok(candles.some((c) => c.open === 0.014), 'the first candle opens at 0.014');
          if (name === 'open-plus-24h') {
            const published = await A.store.published();
            const response = managedListingResponse(new Request(`${EDGE}/market/test-assets/QVTR-USDT`), published.listings, at, published.revision);
            const state = (await response.json()).state;
            assert.ok(Math.abs(state.lastPrice - 0.1092) < 1e-9, `24 h price ${state.lastPrice}`);
            report.dayOne = state;
          }
          await shot(page, `exchange-${name}-${width}.png`);
          await page.context().close();
        });
      }
    }

    await step('after the opening 1440, +24 h: «1m», «5m» and «1h» each load their own candles, spaced by the interval, within (0, 0.88858], the last close 0.1092', async () => {
      const at = AT + DAY, offset = at - Date.now();
      const page = await newPage(A.origin, 1440, 'user', { offset, now: () => Date.now() + offset });
      const served = {};
      page.on('response', async (r) => {
        const match = /QVTR-USDT\/candles\?interval=([0-9a-z]+)/i.exec(r.url());
        if (match) served[match[1]] = await r.json().catch(() => null);
      });
      await page.goto(`${A.origin}/trade?pair=QVTR%2FUSDT`);
      const chart = page.locator('.managed-demo-chart');
      await chart.locator('canvas').first().waitFor({ timeout: 30000 });
      report.intervals = {};
      for (const [tf, ms] of [['1m', 60_000], ['5m', 300_000], ['1h', 3_600_000]]) {
        delete served[tf];
        // Desktop Spot shows the workspace strip (quick timeframes) with the rest in its timeframe menu.
        const quick = chart.locator(`[data-cw-tf="${tf}"]`);
        if ((await quick.count()) && (await quick.first().isVisible())) await quick.first().click();
        else { await chart.locator('[data-cw-feature="timeframes"]').first().click(); await page.locator(`[data-cw-tf-option="${tf}"]`).click(); }
        for (let waited = 0; !served[tf] && waited < 15000; waited += 250) await page.waitForTimeout(250);
        const candles = served[tf] && served[tf].candles;
        assert.ok(candles && candles.length > 1, `no ${tf} candles were served`);
        const step = candles[1].time - candles[0].time;
        assert.ok(step === ms || step === ms / 1000, `${tf} spacing ${step}`);
        for (let i = 1; i < candles.length; i++) assert.equal(candles[i].time - candles[i - 1].time, step, `${tf} gap at ${i}`);
        assert.ok(candles.every((c) => c.low > 0 && c.high <= 0.88858), `${tf} out of (0, 0.88858]`);
        assert.ok(Math.abs(candles.at(-1).close - 0.1092) < 1e-9, `${tf} last close ${candles.at(-1).close}`);
        assert.equal(await chart.locator(`[data-cw-tf="${tf}"][aria-pressed="true"], [data-cw-tf-plan][aria-pressed="true"]`).count() > 0, true, `${tf} is not shown as selected`);
        report.intervals[tf] = { candles: candles.length, high: Math.max(...candles.map((c) => c.high)), low: Math.min(...candles.map((c) => c.low)) };
        await shot(page, `exchange-open-plus-24h-${tf}-1440.png`);
      }
      await page.context().close();
    });

    await step('after every step: no page error, the Worker never called out, only the local Worker A was published and started', async () => {
      for(const [index,instance] of [A,B].entries()) {
        const current=(await instance.api('/admin/listings')).body.listings.find(l=>l.symbol==='ECLV');
        assert.deepEqual(current,eclvSnapshots[index],'ECLAVO changed while operating QVTR');
        assert.equal(current.activeVersion,null);assert.equal(current.countdown??null,null);
      }
      assert.deepEqual(report.renderCalls.filter(c=>/ (POST|PUT|DELETE) \/(orders|withdrawals|transfers|deposits|futures)(?:\/|$)/.test(c)),[],'no financial request allowed');
      assert.deepEqual(report.pageErrors, []);
      assert.equal(report.outbound, 0);
      assert.deepEqual((await edgeJson(EDGE_B, '/market/listings')).body.assets, [], 'worker B stays a draft');
    });
  } finally {
    await browser?.close();
    A?.server.close(); B?.server.close();
    await mfA?.dispose(); await mfB?.dispose();
    fs.rmSync(persistA, { recursive: true, force: true });
    fs.rmSync(persistB, { recursive: true, force: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures.length, screenshots: report.screenshots.length }));
    if (report.failures.length) process.exitCode = 1;
  }
})().catch((error) => {
  report.failures.push(String(error?.stack || error));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.error(error);process.exitCode=1;
});
