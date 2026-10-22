/**
 * Admin → Listings end-to-end QA, local only.
 *
 * Real pieces: the market-edge Worker bundle in workerd (Miniflare, SQLite
 * Durable Object persisted on disk), the Render admin router with the real
 * requireAuth/requireAdmin middleware and CloudflareListingStore client, the
 * Render trading registry and Spot gate, and a production frontend bundle in
 * Chromium. Synthetic: the two accounts (a fixture user table instead of Neon),
 * every other /api/v1 read (empty fixtures), and the venue (any outbound call
 * from the Worker is refused and counted).
 *
 * Acceptance: a pair that exists nowhere in the code is created, previewed and
 * published from the admin, then opened from Markets on the same bundle and
 * the same Worker process — no rebuild, no redeploy — and switches from
 * pre-listing to live at the configured instant with deterministic history.
 *
 * Build the bundle first with the Worker origin baked in:
 *   VITE_MARKET_EDGE_URL=http://127.0.0.1:8787 npx vite build --outDir <dir>
 * then QA_FRONTEND_DIST=<dir> node scripts/qa-admin-listings.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'local-qa-only-listings-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
delete process.env.LISTINGS_STORE_URL;
delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const edgeRequire = require('node:module').createRequire(path.join(root, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore, listingStoreFromEnvironment } = require('../src/services/listings/store');
const { ManagedListingRegistry } = require('../src/services/listings/registry');
const { isTestAssetPairOrSymbol } = require('../src/services/testMarkets/testAssetConfig');
const { assertSpotListing } = require('../src/services/testMarkets/nrxSpot');

const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const output = path.resolve(process.env.QA_OUTPUT || 'docs/qa/admin-listings');
const EDGE_PORT = Number(process.env.QA_EDGE_PORT || 8787);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0001';
fs.mkdirSync(output, { recursive: true });
assert.ok(fs.readdirSync(path.join(dist, 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes(EDGE)),
  `the bundle in ${dist} must be built with VITE_MARKET_EDGE_URL=${EDGE}`);

const report = { scope: 'Local only. Real Worker (workerd), real Render admin router + auth middleware, production frontend bundle. Fixture accounts and empty fixture reads; no production, no Neon, no balances.',
  checks: [], requests: {}, layouts: [], screenshots: [], pageErrors: [], consoleErrors: [], outbound: 0 };
const check = (name) => { report.checks.push(name); console.log('✓', name); };

/* ---- The Worker, as deployed: bundle + SQLite DO persisted on disk. ---- */
let mf, workerOptions;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-listings-qa-'));
async function startEdge() {
  if (!workerOptions) {
    const bundle = await build({ entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')], bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
    workerOptions = { ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true,
      script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
      // Minimum lead lowered to the 5 s floor so the QA can watch the opening; production keeps 60 s.
      bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_MIN_LEAD_MS: '5000', LISTINGS_PUBLIC_CACHE_MS: '1000' },
      durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
      outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
    }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: EDGE_PORT };
  }
  mf = new Miniflare(workerOptions);
  await mf.ready;
}
const edgeJson = async (p) => { const r = await fetch(`${EDGE}${p}`, { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };

/* ---- Render: the real admin router against the Worker. Fixture accounts only. ---- */
const accounts = { 'qa-admin': { role: 'ADMIN', email: 'listing.admin@example.invalid' }, 'qa-user': { role: 'USER', email: 'listing.user@example.invalid' } };
const prisma = {
  user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id].role } : null) },
  session: { findUnique: async () => null, update: async () => null },
  ...Object.fromEntries(['order', 'trade', 'futuresOrder', 'futuresPosition', 'balance'].map(name => [name, { count: async () => 0 }])),
};
const tokens = { admin: jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET), user: jwt.sign({ sub: 'qa-user' }, process.env.JWT_SECRET) };
const connected = new CloudflareListingStore(EDGE, STORE_TOKEN);
// The rollout states Render can be in: settings missing, a token the Worker refuses, or connected.
const stores = {
  unset: listingStoreFromEnvironment({}, () => {}),
  mismatch: new CloudflareListingStore(EDGE, 'another-synthetic-secret-of-32-chars-00'),
  connected,
};
let storeState = 'connected';
const store = new Proxy({}, { get: (_target, key) => { const s = stores[storeState]; const v = s[key]; return typeof v === 'function' ? v.bind(s) : v; } });
const registry = new ManagedListingRegistry(connected);
const renderCalls = [];
const app = express();
app.use(express.json({ limit: '300kb' }));
app.use('/api/v1', (req, _res, next) => { renderCalls.push(`${req.method} ${req.path}`); next(); });
app.get('/api/v1/me', (req, res) => {
  try {
    const { sub } = jwt.verify(String(req.headers.authorization).slice(7), process.env.JWT_SECRET);
    const account = accounts[sub];
    res.json({ id: sub, email: account.email, displayName: sub, role: account.role, isAdmin: account.role === 'ADMIN', kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' });
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
});
app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry));
// Exchange-page reads: the same synthetic shapes scripts/qa-nrx-market.cjs uses. No managed data comes from Render.
const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/market/test-assets': () => ({ serverTime: Date.now(), assets: [] }),
  '/market/display/spot-snapshot': () => ({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 },
    tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] },
    overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }],
  '/market/external/tickers': () => ({ tickers: [btc] }),
  '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }],
  '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }),
  '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }),
  '/market/snapshot': () => ({ pairs: [], fetchedAt: Date.now() }),
  '/futures/config': () => ({ symbols: [] }),
  '/market/display': () => ({ type: 'snapshot', rows: [] }),
  '/market/universe': () => ({ available: false, instruments: [] }),
};
app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA disallows writes' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
const render = async (p, { token = tokens.admin, method = 'GET', body, ifMatch } = {}) => {
  const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let origin;

/* ---- Time helpers: the admin types Kyiv wall-clock time; the store keeps UTC. ---- */
const kyivWall = (ms) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
// A small real PNG (solid colour) for the logo upload.
function png(size, [r, g, b]) {
  const zlib = require('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: size }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, (_, x) => {
    const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 2.3) ** 2; return Buffer.from(inside ? [r, g, b] : [255, 255, 255]);
  }))])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function run() {
  await startEdge();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const edgeRequests = [];
  const newPage = async (who, width, label = who) => {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU' });
    // Local only: the page may reach this server and the local Worker, nothing else (no venue WebSockets either).
    await context.route('**/*', (route) => { const u = route.request().url(); return u.startsWith(origin) || u.startsWith(EDGE) || u.startsWith('data:') ? route.continue() : route.abort(); });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    await context.addInitScript(([token]) => { try { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); } catch {} }, [tokens[who]]);
    who = label;
    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(`${who}@${width}: ${error.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) report.consoleErrors.push(`${who}@${width}: ${msg.text().slice(0, 400)}`); });
    page.on('request', (request) => { if (request.url().startsWith(EDGE)) edgeRequests.push({ at: Date.now(), who, url: request.url().slice(EDGE.length) }); });
    return page;
  };
  const shot = async (page, name) => { await page.screenshot({ path: path.join(output, name), fullPage: false, animations: 'disabled' }); report.screenshots.push(name); };
  const noOverflow = async (page, name) => {
    const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    report.layouts.push({ name, ...layout });
    if (layout.documentWidth > layout.width) console.error('overflow elements', await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1 && el.width > 0).slice(0, 20)));
    assert.ok(layout.documentWidth <= layout.width, `${name} overflows horizontally`);
  };

  try {
    if (process.env.QA_AITH_REPLACEMENT === '1') {
      await require('./qa-aith-replacement.cjs')({ root, render, connected, registry, prisma, newPage, origin, shot, noOverflow, report, check });
      return;
    }
    /* 0. Before the rollout is finished the page says "not connected" — never a success — and Create is disabled. */
    for (const [state, text] of [['unset', /хранилище Cloudflare не настроено/], ['mismatch', /ключ хранилища на сервере и в Cloudflare не совпадает/]]) {
      storeState = state;
      const page = await newPage('admin', 1440, `rollout-${state}`);
      await page.goto(`${origin}/admin/listings`);
      const alert = page.locator('[data-listings-state="not-connected"]');
      await alert.waitFor({ timeout: 15000 });
      assert.match(await alert.innerText(), text);
      assert.equal(await page.locator('[data-create-listing]').isDisabled(), true);
      assert.equal(await page.locator('[data-listing-notice]').count(), 0);
      await shot(page, `not-connected-${state}-1440.png`);
      await page.context().close();
      const api = await render('/admin/listings');
      assert.equal(api.status, 503);
      assert.equal(api.body.error, state === 'unset' ? 'STORE_NOT_CONFIGURED' : 'STORE_AUTH_FAILED');
    }
    storeState = 'connected';
    check('rollout states: without settings → "not connected" (STORE_NOT_CONFIGURED); token mismatch → "not connected" (STORE_AUTH_FAILED); Create disabled, no success shown');

    /* 1. Nothing listed; a regular user cannot reach the admin store in any way. */
    assert.deepEqual((await edgeJson('/market/listings')).body.assets, []);
    assert.equal((await render('/admin/listings', { token: tokens.user })).status, 403);
    assert.equal((await render('/admin/listings', { token: 'nonsense' })).status, 401);
    assert.equal((await fetch(`${EDGE}/internal/listings`)).status, 401);
    const cors = await fetch(`${EDGE}/internal/listings`, { headers: { Authorization: `Bearer ${STORE_TOKEN}`, Origin: origin } });
    assert.equal(cors.status, 403); assert.equal(cors.headers.get('access-control-allow-origin'), null);
    check('before: empty public catalogue; Render admin API 403 for a USER and 401 without a session; the Worker store refuses no-secret and browser-Origin calls');
    // The redirect target (the user's terminal) is not under test here; its fixture errors are reported, not asserted.
    const userPage = await newPage('user', 1440, 'probe');
    await userPage.goto(`${origin}/admin/listings`);
    await userPage.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 15000 });
    assert.equal(await userPage.locator('[data-create-listing]').count(), 0);
    await userPage.context().close();
    check('a USER opening /admin/listings is sent away; the Listings page never renders');

    /* 2. Admin creates a pair that exists nowhere in the code. */
    const symbol = 'QRB';
    assert.equal(fs.readFileSync(path.join(root, 'src/services/testMarkets/testAssetConfig.ts'), 'utf8').includes(symbol), false);
    // Leave one complete discovery interval for the already-open, future-only
    // Markets tab below before this first listing switches to live.
    const listingAt = Math.ceil((Date.now() + 150_000) / 60_000) * 60_000;
    // Existing executable listings retain their original controls/history.
    // New UI drafts use the non-executable bounded program and are exercised
    // end-to-end separately by qa-listing-controls.cjs. Seed this legacy
    // fixture via the real API; do not weaken its Spot gate assertions below.
    const legacyCreated = await render('/admin/listings', { method: 'POST', body: { config: {
      symbol, name: 'QA Orbit', logo: null, initialPrice: '0.42', listingAt: new Date(listingAt).toISOString(),
      displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'auto', tradable: true,
    } } });
    assert.equal(legacyCreated.status, 201);
    const admin = await newPage('admin', 1440);
    await admin.goto(`${origin}/admin/listings`);
    await admin.locator(`[data-edit-listing="${symbol}"]`).click();
    await admin.fill('[data-field="name"]', 'QA Orbit');
    await admin.fill('[data-field="symbol"]', symbol);
    await admin.fill('[data-field="initialPrice"]', '0.42');
    await admin.fill('[data-field="ownerAllocation"]', '5000');
    await admin.selectOption('[data-field="timeZone"]', 'Europe/Kyiv');
    await admin.fill('[data-field="wallTime"]', kyivWall(listingAt));
    await admin.check('[data-field="tradable"]');
    await admin.setInputFiles('[data-field="logo"]', { name: 'qrb.png', mimeType: 'image/png', buffer: png(48, [124, 58, 237]) });
    await admin.locator('[data-listing-utc]').filter({ hasText: 'UTC' }).waitFor();
    await shot(admin, 'create-form-1440.png');
    await admin.locator('[data-save-draft]').click();
    await admin.locator(`[data-edit-listing="${symbol}"]`).waitFor();
    let list = (await render('/admin/listings')).body.listings;
    let listing = list.find((l) => l.symbol === symbol);
    assert.equal(listing.draft.listingAt, new Date(listingAt).toISOString().replace('.000Z', 'Z'));
    assert.equal(listing.draft.displayTimeZone, 'Europe/Kyiv');
    assert.ok(listing.draft.logo.startsWith('data:image/png;base64,'));
    assert.equal(listing.activeVersion, null);
    assert.equal(listing.draft.tradable, true);
    const seed = listing.draft.seed;
    assert.match(seed, /^[a-z0-9-]{8,}$/);
    check(`legacy ${symbol}/USDT preserved by the form: Kyiv wall time stored as the UTC instant, logo kept, automatic seed ${seed}, not published; creation used the real API`);

    /* 3. The draft is invisible to everyone else, including by URL tricks. */
    assert.equal((await edgeJson('/market/listings')).body.assets.length, 0);
    for (const p of [`/market/test-assets/${symbol}-USDT`, `/market/test-assets/${symbol}-USDT?draft=1&preview=1`, `/market/listings?draft=1&include=drafts`, `/published`]) {
      const r = await edgeJson(p);
      assert.ok(!JSON.stringify(r.body ?? '').includes('QA Orbit'), `${p} leaked the draft`);
    }
    check('draft invisible publicly: catalogue, pair path, ?draft/?preview/?include parameters, and the DO route all omit it');

    /* 4. Seed is stable across a draft save; Preview is private and deterministic. */
    await admin.locator(`[data-edit-listing="${symbol}"]`).click();
    await admin.fill('[data-field="name"]', 'QA Orbit Coin');
    await admin.locator('[data-save-draft]').click();
    await admin.waitForFunction(() => !document.querySelector('[data-save-draft]')?.hasAttribute('disabled'));
    await admin.waitForTimeout(300);
    listing = (await render('/admin/listings')).body.listings.find((l) => l.symbol === symbol);
    assert.equal(listing.draft.name, 'QA Orbit Coin'); assert.equal(listing.draft.seed, seed);
    check('saving the draft again keeps the automatic seed');
    const previewResponse = admin.waitForResponse((r) => r.url().includes('/preview'));
    await admin.locator('[data-preview]').click();
    const preview = await (await previewResponse).json();
    await admin.locator('[data-listing-preview]').waitFor();
    assert.ok(preview.candles.length > 10 && preview.book.bids.length > 0 && preview.trades.length > 0);
    await shot(admin, 'preview-1440.png');
    const previewAgain = (await render(`/admin/listings/${listing.id}/preview?at=${encodeURIComponent(new Date(preview.previewAt).toISOString())}&interval=5m`)).body;
    assert.deepEqual(previewAgain.candles, preview.candles);
    assert.equal((await render(`/admin/listings/${listing.id}/preview`, { token: tokens.user })).status, 403);
    check(`Preview (admin only): ${preview.candles.length} candles, book and tape; the same instant gives identical candles; USER → 403`);

    /* 4b. Unsaved form values must never preview or publish an older draft. */
    const previewPublishCalls = () => renderCalls.filter((call) => /\/admin\/listings\/[^/]+\/(preview|publish)$/.test(call)).length;
    const beforeDirty = previewPublishCalls();
    await admin.fill('[data-field="initialPrice"]', '0.43');
    await admin.locator('[data-unsaved-draft]').waitFor();
    assert.equal(await admin.locator('[data-listing-preview]').count(), 0);
    assert.equal(await admin.locator('[data-preview]').isDisabled(), true);
    assert.equal(await admin.locator('[data-publish]').isDisabled(), true);
    assert.equal(previewPublishCalls(), beforeDirty);
    await admin.locator('[data-unsaved-draft]').scrollIntoViewIfNeeded();
    await shot(admin, 'dirty-draft-1440.png');
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.waitForFunction(() => document.querySelector('.admin-mobile-sidebar')?.getBoundingClientRect().right <= 1);
    await admin.locator('[data-unsaved-draft]').scrollIntoViewIfNeeded();
    await noOverflow(admin, 'dirty-draft-390');
    await shot(admin, 'dirty-draft-390.png');
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.fill('[data-field="initialPrice"]', '0.42');
    await admin.waitForFunction(() => !document.querySelector('[data-preview]')?.disabled);
    assert.equal(await admin.locator('[data-publish]').isDisabled(), false);
    assert.equal(await admin.locator('[data-listing-preview]').count(), 0, 'Reverting a field must not restore a stale preview');
    check('unsaved change hides preview, disables Preview/Publish without a request; reverting restores actions but not the old preview (1440/390)');

    /* 4c. A real private Preview response delayed until AFTER an edit stays hidden. */
    const previewPath = /\/api\/v1\/admin\/listings\/[^/]+\/preview(?:\?|$)/;
    let releasePreview;
    const previewGate = new Promise((resolve) => { releasePreview = resolve; });
    await admin.route(previewPath, async (route) => {
      const response = await route.fetch();
      await previewGate;
      await route.fulfill({ response });
    });
    try {
      const requested = admin.waitForRequest(previewPath);
      await admin.locator('[data-preview]').click();
      await requested;
      await admin.fill('[data-field="initialPrice"]', '0.43');
      const delivered = admin.waitForResponse(previewPath);
      releasePreview();
      await delivered;
      await admin.waitForFunction(() => !document.querySelector('[data-save-draft]')?.disabled);
      assert.equal(await admin.locator('[data-listing-preview]').count(), 0);
      assert.equal(await admin.locator('[data-preview]').isDisabled(), true);
      assert.equal(await admin.locator('[data-publish]').isDisabled(), true);
    } finally {
      releasePreview();
      await admin.unroute(previewPath);
    }
    const nextSave = admin.waitForResponse((r) => r.url().endsWith(`/admin/listings/${listing.id}/draft`) && r.request().method() === 'PUT');
    await admin.locator('[data-save-draft]').click();
    const savedResponse = await nextSave;
    assert.equal(savedResponse.status(), 200);
    const savedDraft = await savedResponse.json();
    assert.equal(savedDraft.draft.initialPrice, '0.43');
    assert.equal(savedDraft.draft.seed, seed);
    assert.ok(savedDraft.draftRevision > listing.draftRevision);
    await admin.waitForFunction(() => !document.querySelector('[data-preview]')?.disabled);
    listing = (await render('/admin/listings')).body.listings.find((l) => l.symbol === symbol);
    const freshPreviewRequest = admin.waitForResponse((r) => previewPath.test(r.url()));
    await admin.locator('[data-preview]').click();
    const freshPreview = await (await freshPreviewRequest).json();
    await admin.locator('[data-listing-preview]').waitFor();
    assert.equal(freshPreview.draftRevision, listing.draftRevision);
    check('late preview after an edit is discarded; saving the new revision re-enables a fresh preview of exactly that revision');

    /* 5. Publish through the confirmation dialog. */
    const publishPosts = () => renderCalls.filter((call) => /^POST \/admin\/listings\/[^/]+\/publish$/.test(call)).length;
    const postsBeforeDialog = publishPosts();
    await admin.locator('[data-publish]').click();
    await admin.locator('[data-publish-dialog]').waitFor();
    await admin.locator('[data-publish-dialog]').getByRole('button', { name: 'Отмена', exact: true }).click();
    await admin.locator('[data-publish-dialog]').waitFor({ state: 'hidden' });
    assert.equal(publishPosts(), postsBeforeDialog, 'Cancel must not publish');
    await admin.locator('[data-publish]').click();
    await admin.locator('[data-publish-dialog]').waitFor();
    await shot(admin, 'publish-dialog-1440.png');
    const publishResponse = admin.waitForResponse((r) => r.url().includes('/publish'));
    await admin.locator('[data-confirm-publish]').click();
    const published = await (await publishResponse).json();
    assert.deepEqual([published.version, published.replayed], [1, false]);
    await admin.locator('[data-publish-dialog]').waitFor({ state: 'hidden' });
    assert.equal(publishPosts(), postsBeforeDialog + 1, 'One confirmation must send one publish POST');
    await shot(admin, 'published-list-1440.png');
    const replay = await render(`/admin/listings/${listing.id}/publish`, { method: 'POST', body: { draftRevision: listing.draftRevision, publishKey: 'qa-second-tab-publish-key-0001' } });
    assert.deepEqual([replay.status, replay.body.version, replay.body.replayed], [200, 1, true]);
    check('cancel publishes nothing; one confirmation publishes v1 once; a second publish of the unchanged draft (another key) replays v1, no new version');

    /* 6. Public catalogue, Render trading registry — no redeploy anywhere. */
    await new Promise((r) => setTimeout(r, 1200));
    const catalogue = (await edgeJson('/market/listings')).body;
    const row = catalogue.assets.find((a) => a.symbol === symbol);
    assert.equal(row.pair, `${symbol}/USDT`); assert.equal(row.state.phase, 'pre-listing'); assert.equal(row.version, 1);
    assert.equal(JSON.stringify(catalogue).includes(seed), false, 'seed leaked publicly');
    assert.equal('ownerAllocation' in row, false);
    assert.equal(isTestAssetPairOrSymbol(`${symbol}/USDT`), false);
    await registry.ensureFresh();
    assert.equal(isTestAssetPairOrSymbol(`${symbol}/USDT`), true);
    assert.throws(() => assertSpotListing(`${symbol}/USDT`, Date.now()), /not started/);
    check('public catalogue lists QRB/USDT pre-listing with no seed/owner allocation; Render learned the pair from the store and refuses Spot orders before the opening');

    // Keep this tab open on a catalogue containing only future listings. The
    // later second publication must appear through discovery, without reload.
    const discovery = await newPage('user', 1440, 'discovery');
    await discovery.goto(`${origin}/markets`);
    await discovery.locator(`.test-market-row[data-pair="${symbol}/USDT"][data-phase="pre-listing"]`).waitFor();
    let discoveryNavigations = 0;
    discovery.on('framenavigated', (frame) => { if (frame === discovery.mainFrame()) discoveryNavigations++; });

    /* 7. A regular user finds it on Markets (same bundle) and opens it. */
    const markets = await newPage('user', 1440);
    await markets.goto(`${origin}/markets`);
    const stripRow = markets.locator(`.test-market-row[data-pair="${symbol}/USDT"]`);
    await stripRow.waitFor({ timeout: 20000 });
    assert.equal(await stripRow.getAttribute('data-phase'), 'pre-listing');
    assert.match(await stripRow.innerText(), /Europe\/Kyiv/);
    await stripRow.scrollIntoViewIfNeeded();
    await shot(markets, 'markets-prelisting-1440.png');
    await stripRow.locator('.test-market-open').click();
    await markets.waitForURL(/\/trade\?pair=QRB/);
    await markets.locator('.vta-prelisting[data-state="pre-listing"]').waitFor({ timeout: 20000 });
    await shot(markets, 'trade-prelisting-1440.png');
    await noOverflow(markets, 'trade-prelisting-1440');
    const mobile = await newPage('user', 390);
    await mobile.goto(`${origin}/trade?pair=${symbol}%2FUSDT`);
    await mobile.locator('.vta-prelisting[data-state="pre-listing"]').waitFor({ timeout: 20000 });
    await shot(mobile, 'trade-prelisting-390.png');
    await noOverflow(mobile, 'trade-prelisting-390');
    check('Markets shows the new row with its Kyiv time; clicking opens /trade?pair=QRB/USDT with the countdown (1440 and 390, no horizontal overflow)');

    /* 8. Second listing with a later date, side by side. */
    const later = new Date(Math.ceil((Date.now() + 3 * 86_400_000) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
    const second = await render('/admin/listings', { method: 'POST', body: { config: { symbol: 'QDL', name: 'QA Delta', logo: null, initialPrice: '1.5', listingAt: later,
      displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'qdl-qa-synthetic-0001', tradable: false } } });
    assert.equal(second.status, 201);
    assert.equal((await render(`/admin/listings/${second.body.id}/publish`, { method: 'POST', body: { draftRevision: second.body.draftRevision, publishKey: 'qa-second-listing-key-0001' } })).status, 200);
    const discoveryStart = Date.now();
    await discovery.locator('.test-market-row[data-pair="QDL/USDT"]').waitFor({ timeout: 65_000 });
    assert.equal(discoveryNavigations, 0, 'New publication must appear without a navigation/reload');
    assert.equal((await edgeJson('/market/listings')).body.assets.find((a) => a.symbol === symbol).state.phase, 'pre-listing',
      'Discovery fixture must still contain only future markets during this check');
    report.requests.futureCatalogueDiscovery = { elapsedMs: Date.now() - discoveryStart, reloads: discoveryNavigations };
    await discovery.locator('.test-market-row[data-pair="QDL/USDT"]').scrollIntoViewIfNeeded();
    await shot(discovery, 'markets-discovery-without-reload-1440.png');
    await discovery.context().close();
    check('an already-open Markets tab with only future listings discovers the second publication within one 60-second cadence, without reload');
    const onVenue = await render('/admin/listings', { method: 'POST', body: { config: { ...second.body.draft, symbol: 'BTC', seed: 'btc-clash-0001' } } });
    assert.equal(onVenue.status, 422);
    check('a second listing (QDL, +3 days, not tradable) publishes alongside; a ticker already on the venue (BTC) is refused');

    /* 9. The opening: pre-listing → live at the configured instant, from the same config. */
    let launchReloads = 0;
    markets.on('framenavigated', frame => { if (frame === markets.mainFrame()) launchReloads++; });
    const wait = listingAt - Date.now() + 2500;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await markets.locator('[data-test-market] canvas, [data-test-market] svg').first().waitFor({ timeout: 20000 });
    await markets.locator('.nrx-book-tabs, .orderbook').first().waitFor({ timeout: 20000 });
    const live = (await edgeJson('/market/listings')).body.assets.find((a) => a.symbol === symbol);
    assert.equal(live.state.phase, 'live'); assert.ok(live.state.lastPrice > 0);
    await shot(markets, 'trade-live-1440.png');
    await mobile.waitForTimeout(2500);
    await shot(mobile, 'trade-live-390.png');
    await noOverflow(mobile, 'trade-live-390');
    await registry.ensureFresh();
    assert.doesNotThrow(() => assertSpotListing(`${symbol}/USDT`, Date.now()));
    assert.equal(launchReloads, 0, 'The open terminal must discover launch without a reload');
    for (const width of [1920, 1440, 1366, 390]) {
      await admin.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await noOverflow(admin, `listings-audit-${width}`);
      await shot(admin, `listings-audit-${width}.png`);
      await markets.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await noOverflow(markets, `trade-audit-${width}`);
      await shot(markets, `trade-audit-${width}.png`);
    }
    assert.throws(() => assertSpotListing('QDL/USDT', Date.now() + 4 * 86_400_000), /not available/);
    check(`opening passed without reload: catalogue phase live at ${live.state.lastPrice}; chart/book visible; Render Spot gate open for QRB, closed for non-tradable QDL; admin/trade fit 1920/1440/1366/390`);

    /* 10. One canonical history: the public edge, the admin Preview at the same instant, and a restarted Worker agree. */
    const edgeCandles = async () => (await edgeJson(`/market/test-assets/${symbol}-USDT/candles?interval=5m`)).body;
    const previewCandles = async (at) => (await render(`/admin/listings/${listing.id}/preview?at=${encodeURIComponent(new Date(at).toISOString())}&interval=5m`)).body.candles;
    const sameAt = async () => {
      const pub = await edgeCandles();
      const priv = new Map((await previewCandles(pub.serverTime)).map((c) => [c.time, c]));
      const overlap = pub.candles.filter((c) => priv.has(c.time));
      assert.ok(overlap.length >= 1);
      for (const c of overlap) assert.deepEqual(c, priv.get(c.time));
      return { serverTime: pub.serverTime, candles: pub.candles, overlap: overlap.length };
    };
    const firstRead = await sameAt();
    const fixedAt = listingAt + 6 * 3_600_000;
    const futureBefore = await previewCandles(fixedAt);
    const reread = await edgeCandles();
    const settled = firstRead.candles.filter((c) => c.time + 5 * 60_000 <= Math.min(firstRead.serverTime, reread.serverTime));
    assert.deepEqual(reread.candles.slice(0, settled.length), settled);
    await mf.dispose();
    await startEdge();
    const afterRestart = await sameAt();
    assert.deepEqual(await previewCandles(fixedAt), futureBefore);
    assert.deepEqual(afterRestart.candles.slice(0, settled.length), settled);
    const restartedCatalogue = (await edgeJson('/market/listings')).body.assets.map((x) => `${x.symbol}@v${x.version}`).sort();
    assert.deepEqual(restartedCatalogue, ['QDL@v1', 'QRB@v1']);
    check(`one history from one config: public 5m candles equal the admin Preview at the same server instant (${firstRead.overlap} and ${afterRestart.overlap} candles), repeat reads agree, and after a full Worker restart the catalogue, candles and a fixed-instant Preview (${futureBefore.length} candles) are identical`);

    /* 11. A published history cannot be silently rewritten. */
    list = (await render('/admin/listings')).body.listings;
    listing = list.find((l) => l.symbol === symbol);
    for (const change of [{ initialPrice: '0.5' }, { seed: 'another-seed-0001', seedMode: 'manual' }]) {
      const r = await render(`/admin/listings/${listing.id}/draft`, { method: 'PUT', ifMatch: listing.draftRevision, body: { config: { ...listing.draft, ...change } } });
      assert.equal(r.status, 422); assert.equal(r.body.error, 'HISTORY_LOCKED');
    }
    const moved = await render(`/admin/listings/${listing.id}/draft`, { method: 'PUT', ifMatch: listing.draftRevision, body: { config: { ...listing.draft, listingAt: later } } });
    assert.equal(moved.status, 200);
    const movedPublish = await render(`/admin/listings/${listing.id}/publish`, { method: 'POST', body: { draftRevision: moved.body.draftRevision, publishKey: 'qa-move-open-market-0001' } });
    assert.equal(movedPublish.status, 422);
    check(`after publish: price and seed edits refused (HISTORY_LOCKED); moving the date of an opened market is refused at publish (${movedPublish.body.error})`);

    /* 12. Request budget of an open terminal on the new pair. */
    const t0 = Date.now();
    await markets.waitForTimeout(30_000);
    const window30 = edgeRequests.filter((r) => r.who === 'user' && r.at >= t0);
    report.requests.openTerminal30s = window30.length;
    report.requests.byPath30s = window30.reduce((acc, r) => { const k = r.url.replace(/\?.*$/, ''); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    report.requests.renderCallsTotal = renderCalls.length;
    report.requests.renderCallsNonAdmin = renderCalls.filter((c) => !c.includes('/admin/listings')).length;
    // Exchange pages read managed-listing market data from the edge only; Render sees the pair only on admin routes.
    assert.deepEqual(renderCalls.filter((c) => !c.includes('/admin/listings') && /QRB|QDL/i.test(c)), []);
    check(`open terminal (two tabs) made ${window30.length} Cloudflare edge requests in 30 s and no Render request about QRB/QDL; admin work used ${renderCalls.filter((c) => c.includes('/admin/listings')).length} Render calls`);

    assert.equal(report.outbound, 0, 'the Worker called out for a managed listing');
    check('the Worker made zero outbound (venue) calls during the whole run');
    assert.deepEqual(report.pageErrors.filter((e) => !e.startsWith('probe@')), []);
    assert.deepEqual(report.consoleErrors.filter((e) => !e.startsWith('probe@')), []);
    check('no page or console errors in the admin and exchange tabs');
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
    server.close();
    await mf?.dispose();
    fs.rmSync(persist, { recursive: true, force: true });
  }
  console.log(`\n${report.checks.length} checks passed; report in ${path.relative(root, output)}/report.json`);
}

run().catch((error) => { console.error(error); process.exit(1); });
