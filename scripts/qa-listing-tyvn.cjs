'use strict';
/**
 * TERYVANE (TYVN/USDT), the listing of 2026-10-27 13:00 UTC = 16:00 Moscow —
 * the DRAFT only, in the real managed-listings system, local and disposable.
 *
 * Real pieces: the market-edge Worker bundle in workerd (Miniflare, SQLite
 * Durable Object on disk), the Render admin router with its real auth
 * middleware and CloudflareListingStore client, the production frontend bundle
 * in Chromium. Synthetic: the admin account, every other /api/v1 read, the
 * venue (BTC/USDT only). Nothing is published, nothing is started, nothing is
 * credited: the public catalogue stays empty throughout.
 *
 * The exchange's pre-listing page cannot show a draft, so its preview is the
 * public record the edge WOULD serve for this exact configuration once
 * published with a running timer (listingPublic.publicListingAsset on the
 * saved draft), rendered by the same bundle. It is labelled a preview.
 *
 *   QA_FRONTEND_DIST=<vite build dir> node scripts/qa-listing-tyvn.cjs
 * Output: docs/qa/listing-tyvn/ (PNG + report.json).
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
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || (fs.existsSync('/opt/node22/lib/node_modules/playwright') ? '/opt/node22/lib/node_modules/playwright' : 'playwright'));
const edgeRequire = require('node:module').createRequire(path.join(root, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore } = require('../src/services/listings/store');
const { ManagedListingRegistry } = require('../src/services/listings/registry');
const { publicListingAsset } = require('../src/services/listings/listingPublic');
const { isTestAssetPairOrSymbol } = require('../src/services/testMarkets/testAssetConfig');

const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const output = path.resolve(process.env.QA_OUT || 'docs/qa/listing-tyvn');
const EDGE_PORT = Number(process.env.QA_EDGE_PORT || 8791);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0001';
const draft = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/tyvn.draft.json'), 'utf8'));
const LISTING_AT = draft.listingAt, START = Date.parse(LISTING_AT);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const TIMER_LINE = '27.10.2026 — 13:00 UTC / 16:00 МСК';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
fs.mkdirSync(output, { recursive: true });

const report = { scope: 'Local only: real Worker (workerd) + real Render admin router + production bundle. Draft only — nothing published, started or credited.',
  asset: { name: draft.name, symbol: draft.symbol, pair: `${draft.symbol}/USDT`, initialPrice: draft.initialPrice, listingAt: LISTING_AT, displayTimeZone: draft.displayTimeZone, emission: '100000000 (no supply field in the listing system; recorded in docs)' },
  checks: [], screenshots: [], preview: {}, renderCalls: [], pageErrors: [], outbound: 0 };
const check = (name) => { report.checks.push(name); console.log('✓', name); };

/* ---- The Worker, as deployed: bundle + SQLite DO persisted on disk. ---- */
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-tyvn-qa-'));
async function startEdge() {
  const bundle = await build({ entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_PUBLIC_CACHE_MS: '1000' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: EDGE_PORT });
  await mf.ready;
  return mf;
}
const edgeJson = async (p) => { const r = await fetch(`${EDGE}${p}`, { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null) }; };

/* ---- Render: the real admin router against the Worker. One fixture admin. ---- */
const accounts = { 'qa-admin': { role: 'ADMIN', email: 'listing.admin@example.invalid' } };
const prisma = { user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id].role } : null) }, session: { findUnique: async () => null, update: async () => null } };
const adminToken = jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET);
const store = new CloudflareListingStore(EDGE, STORE_TOKEN);
const registry = new ManagedListingRegistry(store);
const app = express();
app.use(express.json({ limit: '300kb' }));
app.use('/api/v1', (req, _res, next) => { report.renderCalls.push(`${req.method} ${req.path}`); next(); });
app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-admin', email: accounts['qa-admin'].email, displayName: 'qa-admin', role: 'ADMIN', isAdmin: true, kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' }));
app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry));
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
app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA disallows writes' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
let origin;
const render = async (p, { method = 'GET', body, ifMatch } = {}) => {
  const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), `build the frontend first: QA_FRONTEND_DIST=${dist}`);
  const mf = await startEdge();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    /* 1. The draft, created through the real admin route (validation, reserved tickers, venue collision, store uniqueness). */
    const { schemaVersion: _schema, ...form } = draft;
    const created = await render('/admin/listings', { method: 'POST', body: { config: form } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const saved = created.body.draft, id = created.body.id;
    assert.deepEqual([saved.symbol, saved.name, saved.initialPrice, saved.listingAt, saved.displayTimeZone, saved.seed, saved.tradable, saved.ownerAllocation],
      ['TYVN', 'TERYVANE', '0.0250', LISTING_AT, 'Europe/Moscow', 'teryvane-20261026-v1', false, '100000000']);
    assert.equal(saved.simulationProgram.kind, 'scenario-controls-v2');
    assert.notEqual(saved.simulationProgram.scenario, 'AUTO', 'the store resolves AUTO by the seed');
    assert.ok(saved.simulationProfile && saved.wickModel === 'NATURAL_V1', 'profile and wick model assigned by the store');
    report.draft = { id, draftRevision: created.body.draftRevision, scenario: saved.simulationProgram.scenario, simulationProfile: saved.simulationProfile, wickModel: saved.wickModel,
      first24hGainPercent: saved.simulationProgram.first24hGainPercent, maxPrice: saved.simulationProgram.maxPrice, stages: saved.simulationProgram.stages, afterGrowth: saved.simulationProgram.afterGrowth };
    check(`draft created through the real admin route: ${id} — TERYVANE TYVN/USDT, 0.0250 USDT, ${LISTING_AT} (Europe/Moscow), scenario ${saved.simulationProgram.scenario}, profile ${saved.simulationProfile}`);

    // The name and ticker are free here, and the system refuses what is taken: a second TYVN, a reserved ticker, a venue pair.
    assert.equal((await render('/admin/listings', { method: 'POST', body: { config: { ...form, seed: 'teryvane-20261026-v2' } } })).status, 409);
    const reserved = await render('/admin/listings', { method: 'POST', body: { config: { ...form, symbol: 'BTC', seed: 'teryvane-20261026-v3' } } });
    assert.deepEqual([reserved.status, reserved.body.error], [422, 'RESERVED_TICKER']);
    const onVenue = await render('/admin/listings', { method: 'POST', body: { config: { ...form, symbol: 'BTC', seedMode: 'auto', seed: undefined } } });
    assert.equal(onVenue.status, 422);
    check('uniqueness: a second TYVN is 409 DUPLICATE_TICKER; a reserved ticker is 422 RESERVED_TICKER; TYVN itself is not reserved and not on the venue fixture');

    /* 2. Nothing is public: the catalogue is empty, no pair path answers, Render does not know the ticker, no timer exists. */
    assert.deepEqual((await edgeJson('/market/listings')).body.assets, []);
    for (const p of ['/market/test-assets/TYVN-USDT', '/market/test-assets/TYVN-USDT/candles', '/market/ticker/TYVN-USDT']) {
      const r = await fetch(`${EDGE}${p}`); const text = await r.text();
      assert.notEqual(r.status, 200, p); assert.ok(!text.includes('TERYVANE') && !text.includes('teryvane-20261026'), p);
    }
    await registry.ensureFresh();
    assert.equal(isTestAssetPairOrSymbol('TYVN'), false, 'unknown to Render until published');
    const listed = (await render('/admin/listings')).body.listings.find((l) => l.id === id);
    assert.equal(listed.activeVersion, null);
    assert.equal(listed.countdown ?? null, null);
    assert.equal(report.outbound, 0);
    check('draft only: public catalogue empty, pair paths refuse, Render does not list TYVN, no version, no timer, the Worker called out to nothing');

    /* 3. The private Preview — the same simulation the public edge will compute for this configuration. */
    const first24h = await render(`/admin/listings/${id}/preview?horizon=first24h&interval=5m`);
    assert.equal(first24h.status, 200, JSON.stringify(first24h.body));
    const summary = first24h.body.scenarioSummary;
    assert.equal(Number(summary.initialPrice), 0.025);
    assert.equal(first24h.body.candles.length, summary.candleLimit > 0 ? first24h.body.candles.length : 0);
    assert.ok(first24h.body.candles.every((c) => c.high <= Number(summary.maxPrice) && c.low > 0));
    const growth = await render(`/admin/listings/${id}/preview?horizon=growth&interval=1h`);
    assert.equal(growth.status, 200);
    const before = await render(`/admin/listings/${id}/preview?at=2026-10-27T12:59:00Z&interval=5m`);
    assert.deepEqual([before.body.asset.state.phase, before.body.candles], ['pre-listing', []]);
    const atInstant = await render(`/admin/listings/${id}/preview?at=${LISTING_AT}&interval=5m`);
    assert.equal(atInstant.body.asset.state.phase, 'live');
    assert.equal(atInstant.body.asset.listingAt, new Date(START).toISOString());
    report.preview = { first24h: { ...summary, candles: first24h.body.candles.length, firstCandle: first24h.body.candles[0], lastCandle: first24h.body.candles.at(-1) },
      growth: { ...growth.body.scenarioSummary, candles: growth.body.candles.length }, oneMinuteBefore: before.body.asset.state.phase, atTheInstant: atInstant.body.asset.state.phase };
    check(`private preview: first 24 h ${summary.initialPrice} → ${summary.first24hPrice} USDT (cap ${summary.maxPrice}), ${first24h.body.candles.length} candles of 5m; 12:59 UTC pre-listing with no candles, 13:00 UTC live`);

    /* ---- Browser. ---- */
    const newPage = async (width, who = 'admin', fixtureServerTime = null, fixtureAsset = null) => {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU', serviceWorkers: 'block' });
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      await context.route('**/*', (route) => {
        const u = route.request().url(), p = new URL(u).pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        // The exchange preview: the public record of the saved draft, as the edge would serve it once published with a running timer.
        if (fixtureAsset && p.endsWith('/market/listings')) return json({ serverTime: fixtureServerTime, revision: '1', assets: [fixtureAsset] });
        if (fixtureAsset && /\/market\/test-assets\/TYVN-USDT$/.test(p)) return json(fixtureAsset);
        if (fixtureAsset && (p.endsWith('/candles') || /spot-book|orderbook|spot-trades|\/trades\//.test(p))) return json(p.endsWith('/candles') ? { candles: [] } : /trades/.test(p) ? { trades: [] } : { available: false, bids: [], asks: [] });
        if (u.startsWith(origin) || u.startsWith(EDGE) || u.startsWith('data:')) return route.continue();
        return route.abort();
      });
      await context.addInitScript(([token, time]) => {
        try { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); } catch {}
        if (time) { const base = performance.now(); Date.now = () => time + (performance.now() - base); }
      }, [adminToken, fixtureServerTime]);
      const page = await context.newPage();
      page.on('pageerror', (error) => report.pageErrors.push(`${who}@${width}: ${error.message}`));
      return page;
    };
    const shot = async (page, name) => { await page.screenshot({ path: path.join(output, name), animations: 'disabled' }); report.screenshots.push(name); };

    for (const width of [1440, 390]) {
      /* 4. Admin → Listings: the draft row with UTC / Kyiv / Moscow, the form with 16:00 Moscow = 13:00 UTC, the private preview; no publish. */
      const page = await newPage(width);
      await page.goto(`${origin}/admin/listings`);
      const row = page.locator('[data-listing-row="TYVN"]');
      await row.waitFor({ timeout: 20000 });
      const rowText = await row.innerText();
      for (const text of ['TYVN/USDT', 'TERYVANE', 'Черновик', '27.10.2026 13:00 Всемирное время (UTC)', '27.10.2026 16:00 Москва (UTC+3)']) assert.ok(rowText.includes(text), `${width}: ${text}`);
      assert.equal(await page.locator('[data-listing-timer]').count(), 0, 'a draft has no timer yet');
      await shot(page, `admin-draft-row-${width}.png`);
      await page.locator('[data-edit-listing="TYVN"]').click();
      await page.locator('[data-listing-form]').waitFor();
      assert.equal(await page.inputValue('[data-field="symbol"]'), 'TYVN');
      assert.equal(await page.inputValue('[data-field="name"]'), 'TERYVANE');
      assert.equal(await page.inputValue('[data-field="initialPrice"]'), '0.0250');
      assert.equal(await page.inputValue('[data-field="wallTime"]'), '2026-10-27T16:00');
      assert.equal(await page.inputValue('[data-field="timeZone"]'), 'Europe/Moscow');
      const utcLine = await page.locator('[data-listing-utc]').innerText();
      assert.ok(utcLine.includes('27.10.2026 13:00 Всемирное время (UTC)') && utcLine.includes('27.10.2026 16:00 Москва (UTC+3)'), utcLine);
      await page.locator('[data-preview]').click();
      await page.locator('[data-listing-preview]').waitFor({ timeout: 30000 });
      assert.equal(await page.locator('[data-publish-dialog]').count(), 0);
      await page.locator('[data-preview-summary]').scrollIntoViewIfNeeded();
      await shot(page, `admin-draft-preview-${width}.png`);
      await page.context().close();
      check(`admin ${width}: draft row and form show TYVN/USDT TERYVANE, 0.0250 USDT, 27.10.2026 16:00 Москва = 13:00 UTC; private preview rendered; publish never opened`);

      /* 5. The exchange, as it WOULD look once published with a running timer: 5 d 03 h 30 min before the instant. */
      const serverTime = START - 5 * DAY - 3 * HOUR - 30 * 60_000;
      const asset = publicListingAsset({ id, version: 1, publishedAt: new Date(serverTime).toISOString(), config: saved, countdown: { state: 'running', updatedAt: serverTime, updatedBy: 'qa-admin', startedAt: serverTime } }, serverTime);
      assert.deepEqual([asset.pair, asset.listingArmed, asset.countdown, asset.state.phase, asset.initialPrice, asset.displayTimeZone], ['TYVN/USDT', true, 'running', 'pre-listing', 0.025, 'Europe/Moscow']);
      const trade = await newPage(width, 'user', serverTime, asset);
      await trade.goto(`${origin}/trade?pair=TYVN%2FUSDT`);
      if (width < 600) await trade.locator('#mobile-trade-chart').click();
      await trade.locator('.vta-prelisting[data-countdown="running"] .vta-countdown').waitFor({ timeout: 20000 });
      const cells = await trade.locator('.vta-countdown-cell strong').allInnerTexts();
      assert.deepEqual(cells.slice(0, 2), ['05', '03']);
      const card = await trade.locator('.vta-prelisting').innerText();
      for (const text of ['TERYVANE', 'TYVN/USDT', TIMER_LINE, '0.025000 USDT', 'Торговля пока недоступна']) assert.ok(card.includes(text), `${width}: ${text}`);
      await shot(trade, `trade-preview-running-${width}.png`);
      await trade.goto(`${origin}/markets`);
      await trade.locator('.test-market-row[data-pair="TYVN/USDT"]').waitFor({ timeout: 20000 });
      assert.ok((await trade.locator('.test-market-row[data-pair="TYVN/USDT"]').innerText()).includes(TIMER_LINE));
      await shot(trade, `markets-preview-${width}.png`);
      await trade.context().close();
      check(`exchange preview ${width}: TERYVANE TYVN/USDT counts 5 d 03 h to ${TIMER_LINE}, start price 0.025000 USDT, trading unavailable; Markets row carries the date`);
    }

    /* 6. Still nothing published or started after everything above. */
    assert.deepEqual((await edgeJson('/market/listings')).body.assets, []);
    assert.ok(!report.renderCalls.some((call) => /publish|countdown|replace-prelisting/.test(call)), report.renderCalls.join(', '));
    assert.equal(report.outbound, 0);
    assert.deepEqual(report.pageErrors, []);
    check('after every step: catalogue still empty, no publish / timer / replacement request reached Render, no outbound call, no page error');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, preview: report.preview.first24h && { first24hPrice: report.preview.first24h.first24hPrice, maxPrice: report.preview.first24h.maxPrice } }));
  } finally {
    await browser.close();
    server.close();
    await mf.dispose();
    fs.rmSync(persist, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
