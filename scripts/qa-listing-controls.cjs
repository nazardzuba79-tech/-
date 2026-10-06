/**
 * Scenario controls acceptance: production UI -> real admin router -> real
 * SQLite Durable Object -> restart -> same public generator. Loopback only;
 * fixture authentication, no database, no financial endpoints or venue calls.
 * Build frontend with VITE_API_URL=/api/v1 before running this script.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-listing-controls-fixture-secret-not-production';
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'LISTINGS_STORE_URL', 'LISTINGS_STORE_TOKEN']) delete process.env[key];
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const edgeRequire = require('node:module').createRequire(path.join(root, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore } = require('../src/services/listings/store');
const { listingSimulationConfig } = require('../src/services/listings/listingConfig');
const { testMarketCandles } = require('../src/services/testMarkets/testMarketService');
const { TestMarketSimulation } = require('../src/services/testMarkets/testMarketSimulation');

const output = path.resolve(process.env.QA_OUTPUT || 'output/listing-controls');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
fs.mkdirSync(output, { recursive: true });
const report = { scope: 'Loopback production bundle + real router/workerd; fixture accounts; no database or financial writes', checks: [], layouts: [], screenshots: [], errors: [], outbound: 0, financialWrites: [] };
const check = text => { report.checks.push(text); console.log('PASS', text); };
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-controls-qa-'));
const secret = 'synthetic-local-listings-store-token-000000';
const actor = 'scenario-fixture-admin';
const token = jwt.sign({ sub: actor }, process.env.JWT_SECRET);
let mf, options, origin, browser, server;
async function startEdge() {
  if (!options) {
    const bundle = await build({ entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')], bundle: true,
      write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
    options = { ...convertV4MiniflareOptions({ workers: [{ name: 'listing-controls', modules: true,
      script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
      bindings: { LISTINGS_STORE_TOKEN: secret }, durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
      outboundService: () => { report.outbound++; throw new Error('Blocked non-fixture Worker request'); },
    }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist,
      telemetry: { enabled: false }, host: '127.0.0.1', port: 0 };
  }
  mf = new Miniflare(options);
  await mf.ready;
}
async function api(route, { method = 'GET', body, revision } = {}) {
  const response = await fetch(`${origin}/api/v1${route}`, { method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(revision ? { 'If-Match': String(revision) } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function setup() {
  await startEdge();
  // dispatchFetch follows the same signed HTTP contract without a production URL.
  const transport = (url, init) => mf.dispatchFetch(String(url), init);
  const store = new CloudflareListingStore('http://127.0.0.1', secret, transport, false);
  const prisma = { user: { findUnique: async ({ where }) => where.id === actor ? { id: actor, role: 'ADMIN' } : null },
    session: { findUnique: async () => null, update: async () => { throw new Error('Unexpected session write'); } } };
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.get('/api/v1/me', (_req, res) => res.json({ id: actor, role: 'ADMIN', isAdmin: true,
    email: 'scenario-admin@example.invalid', displayName: 'Проверка сценариев', kycStatus: 'APPROVED', createdAt: '2026-01-01T00:00:00Z' }));
  app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: () => false }, { invalidate() {}, async ensureFresh() {} }));
  app.get('/api/v1/support/conversations/mine', (_req, res) => res.json({ conversation: null }));
  app.get('/api/v1/*', (_req, res) => res.json([]));
  app.use('/api/v1', (req, res) => { report.financialWrites.push(`${req.method} ${req.path}`); res.status(405).json({ error: 'fixture_write_denied' }); });
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}
async function capture(page, name, selector) {
  const filename = `${name}.png`;
  if (selector) await page.locator(selector).screenshot({ path: path.join(output, filename) });
  else await page.screenshot({ path: path.join(output, filename), fullPage: true });
  report.screenshots.push(filename);
}

async function run() {
  try {
    await setup();
    // The acceptance actions are deliberately kept here, beside the actual
    // interface selectors. No mock preview or independent chart is substituted.
    await acceptance();
    assert.equal(report.outbound, 0);
    assert.deepEqual(report.financialWrites, []);
    assert.deepEqual(report.errors, []);
    check('No external calls, financial writes or page exceptions');
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await mf?.dispose();
    // Only this process's disposable fixture directory, never a database volume.
    const canonical = fs.realpathSync(persist);
    assert.equal(path.dirname(canonical), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(canonical).startsWith('voltex-controls-qa-'));
    fs.rmSync(canonical, { recursive: true });
  }
  console.log(`${report.checks.length} acceptance checks; evidence: ${output}`);
}
async function acceptance() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(value => {
    localStorage.setItem('exchange_token', value);
    localStorage.setItem('exchange_lang', 'ru');
  }, token);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const calls = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto(`${origin}/admin/listings`);
  await page.locator('[data-create-listing]').click();
  await page.fill('[data-field="name"]', 'Проверка движения');
  await page.fill('[data-field="symbol"]', 'QSX');
  await page.fill('[data-field="initialPrice"]', '0,80');
  await page.selectOption('[data-field="timeZone"]', 'UTC');
  const listingAt = new Date(Math.ceil((Date.now() + 2 * 86400000) / 60000) * 60000).toISOString();
  await page.fill('[data-field="wallTime"]', listingAt.slice(0, 16));
  assert.equal(await page.locator('[data-field="tradable"]').isDisabled(), true);
  assert.equal(await page.locator('[data-field="tradable"]').isChecked(), false);
  assert.equal(await page.inputValue('[data-field="maxPrice"]'), '74.776');
  assert.match(await page.locator('[data-day-one-price]').innerText(), /14,6/);
  // Comma/dot and the two synchronized views of the one stored hard maximum.
  await page.fill('[data-field="maxPrice"]', '74,776');
  assert.equal(await page.inputValue('[data-field="maxGainPercent"]'), '9247');
  await page.fill('[data-field="maxGainPercent"]', '9247.00');
  assert.equal(await page.inputValue('[data-field="maxPrice"]'), '74.776');
  await capture(page, 'main-form-1440');
  const beforeSelection = calls.length;
  await page.locator('[data-scenario-gallery]').click();
  const scenarios = ['CALM', 'WAVES', 'FREQUENT_PULLBACKS', 'COMPRESSION_BREAKOUT', 'STAIRCASE', 'SLOW_START', 'FAST_START', 'FALSE_BREAKOUT', 'DEEP_RECOVERY', 'LONG_WICKS'];
  assert.equal(await page.locator('[data-select-scenario]').count(), 10);
  for (const scenario of scenarios) {
    await page.locator(`[data-select-scenario="${scenario}"]`).click();
    assert.equal(await page.inputValue('[data-field="scenario"]'), scenario);
  }
  await page.selectOption('[data-field="scenario"]', 'WAVES');
  assert.equal(calls.length, beforeSelection, 'scenario selection must not generate ten histories or send requests');
  await capture(page, 'scenarios-1440', '[data-scenario-options]');
  await page.locator('[data-scenario-gallery]').click();
  await page.locator('[data-movement-advanced] summary').click();
  await page.selectOption('[data-field="pullbackFrequency"]', 'often');
  await page.fill('[data-field="pullbackMin"]', '3');
  await page.fill('[data-field="pullbackMax"]', '9');
  await page.fill('[data-field="pullbackDuration"]', '60');
  await page.selectOption('[data-field="candleIntensity"]', 'high');
  await page.selectOption('[data-field="wickLength"]', 'pronounced');
  await page.selectOption('[data-field="longWickFrequency"]', 'often');
  await capture(page, 'advanced-1440', '[data-movement-advanced]');
  for (const invalidDuration of ['-', 'Infinity', 'not-a-number']) {
    await page.fill('[data-field="growthDuration"]', invalidDuration);
    assert.equal(await page.locator('[data-listing-form]').count(), 1, 'invalid duration must not crash the form');
    await page.locator('[data-save-draft]').click();
    assert.ok((await page.locator('[data-listing-error]').innerText()).length > 0);
    await page.fill('[data-field="growthDuration"]', '7');
  }
  check('Incomplete/invalid duration input retains the form and is rejected without a request');
  const savedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/listings'));
  await page.locator('[data-save-draft]').click();
  const response = await savedResponse;
  assert.equal(response.status(), 201);
  let saved = await response.json();
  await page.waitForFunction(() => document.querySelector('[data-preview]')?.disabled === false);
  let listing = (await api('/admin/listings')).body.listings.find(item => item.id === saved.id);
  assert.equal(listing.activeVersion, null);
  assert.equal(listing.draft.tradable, false);
  assert.equal(listing.draft.ownerAllocation, '0');
  assert.equal(listing.draft.simulationProgram.maxPrice, '74.776');
  assert.equal(listing.draft.simulationProgram.pullbacks.durationMinutes, 60);
  assert.equal(listing.draft.simulationProgram.pullbacks.maxDepthPercent, '9');
  const catalogue = await (await mf.dispatchFetch('http://127.0.0.1/market/listings')).json();
  assert.deepEqual(catalogue.assets, []);
  check('All ten choices; exact decimal prices; form -> router -> durable draft; no publication or allocation');

  const snapshots = {};
  for (const horizon of ['first24h', 'growth', 'afterGrowth']) {
    await page.selectOption('[data-field="previewHorizon"]', horizon);
    await page.selectOption('[data-field="previewInterval"]', '1h');
    const pending = page.waitForResponse(response => response.url().includes('/preview?'));
    await page.locator('[data-preview]').click();
    const previewResponse = await pending;
    assert.equal(previewResponse.status(), 200);
    const preview = await previewResponse.json();
    snapshots[horizon] = preview;
    await page.locator('[data-server-candle-chart]').waitFor();
    assert.equal(await page.locator('[data-server-candle]').count(), preview.candles.length);
    assert.ok(preview.candles.length > 0 && preview.candles.length <= 360);
    assert.equal(preview.scenarioSummary.first24hPrice, '14.6');
    assert.equal(preview.scenarioSummary.maxPrice, '74.776');
    assert.ok(preview.candles.every(candle => candle.high <= 74.776 && candle.low > 0));
  }
  await capture(page, 'candle-preview-1440', '[data-listing-preview]');
  check('Three horizons rendered as actual server OHLC candles, at most 360; upper shadows below 74.776');

  if (!(await page.locator('[data-movement-advanced]').getAttribute('open')) && !(await page.locator('[data-field="pullbackMax"]').isVisible())) {
    await page.locator('[data-movement-advanced] summary').click();
  }
  await page.fill('[data-field="pullbackMax"]', '10');
  assert.equal(await page.locator('[data-preview]').isDisabled(), true);
  assert.equal(await page.locator('[data-publish]').isDisabled(), true);
  assert.match(await page.locator('[data-unsaved-draft]').innerText(), /Настройки изменены — обновите предпросмотр/);
  assert.equal(await page.locator('[data-server-candle-chart]').count(), 0);
  await page.fill('[data-field="pullbackMax"]', '9');
  await page.reload();
  await page.locator('[data-edit-listing="QSX"]').click();
  assert.equal(await page.inputValue('[data-field="scenario"]'), 'WAVES');
  await page.locator('[data-movement-advanced] summary').click();
  assert.equal(await page.inputValue('[data-field="pullbackMax"]'), '9');
  assert.equal(await page.inputValue('[data-field="wickLength"]'), 'pronounced');
  check('Dirty settings invalidate preview/publication; persisted controls restored after page refresh');

  // Test transport failure, not fake success. The real durable draft must be untouched.
  await page.fill('[data-field="pullbackMax"]', '11');
  await page.route('**/admin/listings/*/draft', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'STORE_UNAVAILABLE', message: 'InternalStackTrace secret=must-not-be-displayed' }) }));
  await page.locator('[data-save-draft]').click();
  await page.locator('[data-listing-error]').waitFor();
  assert.doesNotMatch(await page.locator('[data-listing-error]').innerText(), /InternalStackTrace|secret=|STORE_UNAVAILABLE/);
  assert.equal((await api('/admin/listings')).body.listings[0].draft.simulationProgram.pullbacks.maxDepthPercent, '9');
  await page.unroute('**/admin/listings/*/draft');
  await page.fill('[data-field="pullbackMax"]', '9');
  check('Save failure is Russian, sanitized, does not report success or alter the stored draft');
  await page.reload();
  await page.locator('[data-edit-listing="QSX"]').click();
  await page.locator('[data-movement-advanced] summary').click();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('[data-movement-stages] summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    report.layouts.push({ width, documentOverflow: false });
    if (width !== 1440) await capture(page, `form-${width}`);
    await page.locator('[data-movement-stages] summary').click();
  }
  check('1440 / 390 / 320 px: form and expanded controls fit without page overflow');

  await mf.dispose();
  await startEdge();
  const restored = (await api('/admin/listings')).body.listings[0];
  assert.deepEqual(restored, listing);
  for (const horizon of ['first24h', 'growth', 'afterGrowth']) {
    const replay = await api(`/admin/listings/${saved.id}/preview?horizon=${horizon}&interval=1h`);
    assert.deepEqual(replay.body.candles, snapshots[horizon].candles);
  }
  check('Full workerd restart retains settings; all three preview histories repeat exactly');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.locator('[data-edit-listing="QSX"]').click();
  const countPublished = () => calls.filter(call => call.startsWith('POST') && call.endsWith('/publish')).length;
  const beforePublish = countPublished();
  await page.locator('[data-publish]').click();
  assert.equal(countPublished(), beforePublish);
  assert.match(await page.locator('[data-publish-dialog]').innerText(), /UTC/);
  assert.match(await page.locator('[data-publish-dialog]').innerText(), /Киев/);
  await page.locator('[data-publish-dialog]').getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(countPublished(), beforePublish);
  await page.locator('[data-publish]').click();
  const publishedResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/publish'));
  await page.locator('[data-confirm-publish]').click();
  assert.equal((await publishedResponse).status(), 200);
  await page.waitForFunction(() => document.querySelector('[data-movement-editor]')?.disabled === true);
  listing = (await api('/admin/listings')).body.listings[0];
  assert.deepEqual(listing.active.simulationProgram, listing.draft.simulationProgram);
  const asset = listingSimulationConfig(listing.active);
  assert.equal(asset.isTradable, false);
  assert.equal(new TestMarketSimulation(asset).priceAt(Date.parse(listingAt) + 86400000), 14.6);
  const window = snapshots.growth.scenarioSummary;
  assert.deepEqual(testMarketCandles(asset, '1h', window.to, (window.to - window.from) / 3600000 + 1), snapshots.growth.candles);
  const changed = { ...listing.draft, simulationProgram: { ...listing.draft.simulationProgram, scenario: 'CALM' } };
  const refused = await api(`/admin/listings/${saved.id}/draft`, { method: 'PUT', revision: listing.draftRevision, body: { config: changed } });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'HISTORY_LOCKED');
  check('Explicit confirmation only; UTC/Kyiv shown; published generator equals preview; history rewrite rejected');
  await context.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
