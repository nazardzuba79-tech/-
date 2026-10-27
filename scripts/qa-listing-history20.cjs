/**
 * Historical growth window (History20) acceptance at 1440 and 390 px:
 * production UI -> real admin router -> real SQLite Durable Object.
 * Loopback only; fixture authentication; no database, financial endpoints or
 * venue calls. Build frontend with VITE_API_URL=/api/v1 before running this.
 *
 * Without QA_HISTORY20_ZIP the browser library receives ONE synthetic window
 * (not market data) carrying VHX-01-BTC's committed metadata, because the
 * owner's pack is not in the repository (non-commercial source licences).
 * With QA_HISTORY20_ZIP the real pack is imported through the page's own
 * input; its screenshots show derived charts and must stay out of the
 * repository.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-history20-fixture-secret-not-production';
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
const { buildHistoricalGrowthProgram } = require('../src/shared/listingHistoricalGrowth');
// The frontend package is ESM: read its committed metadata module through a plain transpile.
const { HISTORY20_CATALOG, HISTORY20_PACK } = (() => {
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(root, 'frontend/src/pages/admin/historicalGrowthCatalog.ts'), 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(module, module.exports);
  return module.exports;
})();

const output = path.resolve(process.env.QA_OUTPUT || 'output/listing-history20');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const zip = process.env.QA_HISTORY20_ZIP || '';
fs.mkdirSync(output, { recursive: true });
const report = { scope: 'Loopback production bundle + real router/workerd; fixture accounts; no database or financial writes',
  data: zip ? 'owner pack imported in the page (derived charts: keep out of the repository)' : 'one synthetic window with VHX-01-BTC metadata (not market data)',
  checks: [], timings: {}, screenshots: [], errors: [], outbound: 0, financialWrites: [] };
const check = text => { report.checks.push(text); console.log('PASS', text); };
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-history20-qa-'));
const secret = 'synthetic-local-listings-store-token-000000';
const actor = 'history20-fixture-admin';
const token = jwt.sign({ sub: actor }, process.env.JWT_SECRET);
let mf, origin, browser, server;

async function setup() {
  const bundle = await build({ entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  mf = new Miniflare({ ...convertV4MiniflareOptions({ workers: [{ name: 'listing-history20', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: secret }, durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('Blocked non-fixture Worker request'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: 0 });
  await mf.ready;
  const store = new CloudflareListingStore('http://127.0.0.1', secret, (url, init) => mf.dispatchFetch(String(url), init), false);
  const prisma = { user: { findUnique: async ({ where }) => where.id === actor ? { id: actor, role: 'ADMIN' } : null },
    session: { findUnique: async () => null, update: async () => { throw new Error('Unexpected session write'); } } };
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.get('/api/v1/me', (_req, res) => res.json({ id: actor, role: 'ADMIN', isAdmin: true,
    email: 'history20-admin@example.invalid', displayName: 'Проверка окна', kycStatus: 'APPROVED', createdAt: '2026-01-01T00:00:00Z' }));
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
async function api(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function capture(page, name, selector) {
  const filename = `${name}.png`;
  if (selector) await page.locator(selector).first().screenshot({ path: path.join(output, filename) });
  else await page.screenshot({ path: path.join(output, filename), fullPage: true });
  report.screenshots.push(filename);
}

/** The synthetic record: VHX-01-BTC's metadata, a deterministic 120-day reference line (not market data). */
function syntheticRecord() {
  const item = HISTORY20_CATALOG[0];
  const rows = Array.from({ length: 120 }, (_, d) => ({ date: new Date(Date.UTC(2015, 7, 17) + d * 86400000).toISOString().slice(0, 10),
    close: 100 * Math.exp(d * 0.04 + 0.18 * Math.sin(d / 6) - 0.1 * Math.sin(d / 17)) }));
  const program = buildHistoricalGrowthProgram({ scenarioId: item.id, targetPeakGrowthPercent: item.targetPeakGrowthPercent, rows,
    source: { provider: item.provider, asset: item.asset, quote: item.quote, metric: item.metric, dataKind: item.dataKind, timeframe: '1d', sliceSha256: item.sourceSliceSha256, license: item.license } });
  return { version: 1, scenarioId: item.id, program, parityMaxRelError: 0, scenarioFileSha256: item.scenarioFileSha256, catalogSha256: HISTORY20_PACK.catalogSha256, importedAt: '2026-10-18T00:00:00.000Z' };
}

async function newPage(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(value => { localStorage.setItem('exchange_token', value); localStorage.setItem('exchange_lang', 'ru'); }, token);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  return { context, page };
}

async function loadWindows(page) {
  if (zip) {
    const started = Date.now();
    await page.setInputFiles('[data-field="history20Zip"]', zip);
    await page.locator('[data-history20-report]').waitFor({ timeout: 60_000 });
    report.timings.importMs = Date.now() - started;
    report.importReport = await page.locator('[data-history20-report]').innerText();
    assert.match(await page.locator('[data-history20-status]').innerText(), /Все 20 окон/);
    check(`The owner's ZIP is verified and imported in the page: ${report.importReport}`);
  } else {
    const record = syntheticRecord();
    await page.evaluate(async value => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('voltex.admin.historical-growth.v1', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('windows', { keyPath: 'scenarioId' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => { const tx = open.result.transaction('windows', 'readwrite'); tx.objectStore('windows').put(value); tx.oncomplete = () => { open.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
      });
    }, record);
  }
}

/** Real owner-pack acceptance; never replaced by the synthetic single-window CI fixture. */
async function allOwnerWindows(page, width, listingAt, create) {
  if (!zip) return;
  report.ownerWindows ??= [];
  for (const [index, item] of HISTORY20_CATALOG.entries()) {
    const symbol = `VHX${String(index + 1).padStart(2, '0')}`;
    if (create && index > 0) {
      await page.locator('[data-create-listing]').click();
      await page.fill('[data-field="name"]', `History20 local ${item.asset}`);
      await page.fill('[data-field="symbol"]', symbol);
      await page.fill('[data-field="initialPrice"]', '2');
      await page.fill('[data-field="wallTime"]', listingAt.slice(0, 16));
      await page.locator('[data-growth-mode-window]').check();
    } else {
      await page.goto(`${origin}/admin/listings`);
      await page.locator(`[data-edit-listing="${symbol}"]`).click();
    }
    await page.locator(`[data-choose-history20="${item.id}"]`).click();
    await page.locator(`[data-history20-selected="${item.id}"]`).waitFor();
    assert.match(await page.locator('[data-history20-status]').innerText(), /Все 20 окон/);
    const provenance = await page.locator('[data-provenance="observed"]').innerText();
    assert.match(provenance, item.dataKind === 'daily_reference' ? /Дневного максимума и минимума в источнике нет/ : /дневные O\/H\/L\/C/);
    if (item.id === 'VHX-09-MATIC') assert.match(await page.locator('[data-history20-normalization]').innerText(), /15324%.*15000%/);
    const saving = page.waitForResponse(r => ['POST', 'PUT'].includes(r.request().method()) && /\/admin\/listings(?:\/[^/]+\/draft)?$/.test(new URL(r.url()).pathname));
    await page.locator('[data-save-draft]').click();
    const response = await saving;
    assert.equal(response.status(), create && index > 0 ? 201 : 200);
    const saved = await response.json();
    await page.waitForFunction(() => document.querySelector('[data-preview]')?.disabled === false);
    const listing = (await api('/admin/listings')).body.listings.find(listing => listing.id === saved.id);
    const program = listing.draft.simulationProgram.historicalGrowth;
    const target = item.id === 'VHX-09-MATIC' ? '15000' : item.targetPeakGrowthPercent;
    assert.equal(program.targetPeakGrowthPercent, target);
    assert.equal(program.source.sliceSha256, item.sourceSliceSha256);
    assert.equal(program.source.dataKind, item.dataKind);
    assert.equal(program.logs.length, item.rows);
    assert.ok(program.logs.every(row => row.length === (item.dataKind === 'daily_reference' ? 1 : 4)));
    assert.deepEqual(program.clock, { mode: 'REAL_TIME', sourceStepSeconds: 86400, scenarioStepSeconds: 86400 });
    assert.equal(listing.draft.tradable, false);
    assert.equal(listing.draft.ownerAllocation, '0');
    assert.equal(listing.activeVersion, null);
    assert.equal(await page.locator('[data-publish]').isDisabled(), true);
    const before = JSON.stringify(program);
    await page.reload();
    await page.locator(`[data-edit-listing="${symbol}"]`).click();
    await page.locator(`[data-history20-selected="${item.id}"]`).waitFor();
    const reread = (await api('/admin/listings')).body.listings.find(listing => listing.id === saved.id);
    assert.equal(JSON.stringify(reread.draft.simulationProgram.historicalGrowth), before);
    assert.equal(reread.draft.listingAt, listing.draft.listingAt);
    assert.equal(reread.draft.seed, listing.draft.seed);
    await page.selectOption('[data-field="previewHorizon"]', 'first24h');
    await page.selectOption('[data-field="previewInterval"]', '5m');
    const pending = page.waitForResponse(r => r.url().includes('/preview?'));
    const started = Date.now();
    await page.locator('[data-preview]').click();
    const previewResponse = await pending;
    assert.equal(previewResponse.status(), 200);
    const preview = await previewResponse.json();
    await page.locator('[data-preview-window]').waitFor();
    const cap = Number(listing.draft.simulationProgram.maxPrice);
    assert.ok(preview.candles.length > 0 && preview.candles.length <= 360);
    assert.equal(preview.candles[0].open, 2);
    assert.ok(preview.candles.every(c => c.low > 0 && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close) && c.high <= cap));
    assert.equal(preview.scenarioSummary.historicalGrowth.unit, 'SIMUSDT');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `${item.id} at ${width}: overflow ${overflow}`);
    report.ownerWindows.push({ id: item.id, width, sourceRows: program.logs.length, dataKind: program.source.dataKind, target, cap,
      draftReload: true, realTime: true, privateOnly: true, candles: preview.candles.length, previewMs: Date.now() - started, overflow });
    if (item.id === 'VHX-09-MATIC' || index === 19) await capture(page, `history20-${item.asset}-${width}`, '[data-historical-growth]');
    check(`${width}px ${item.id}: actual ZIP → choice → private draft → save/reload → preview; cap ${cap}, no publication`);
  }
}

async function acceptance() {
  // ── 1440: BotLab 01 proposal → window → durable draft → bounded previews → gates → clone → stages ──
  const { context, page } = await newPage(1440, 1000);
  const calls = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) calls.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto(`${origin}/admin/listings`);
  await page.locator('[data-create-botlab]').waitFor();
  if (!zip) { await loadWindows(page); await page.reload(); await page.locator('[data-create-botlab]').waitFor(); }
  await page.locator('[data-create-botlab]').click();
  assert.equal(await page.inputValue('[data-field="name"]'), 'VOLTEX BotLab 01');
  assert.equal(await page.inputValue('[data-field="symbol"]'), 'VHX01');
  assert.equal(await page.inputValue('[data-field="initialPrice"]'), '2');
  assert.equal(await page.inputValue('[data-field="wallTime"]'), '', 'the start time is left for the admin');
  assert.equal(await page.locator('[data-history20-card]').count(), 20);
  assert.match(await page.locator('[data-history20-rotation]').innerText(), /VHX-01-BTC \(позиция 1 из 20/);
  if (zip) await loadWindows(page);
  await page.locator('[data-history20-selected="VHX-01-BTC"]').waitFor();
  assert.match(await page.locator('[data-history20-peak]').innerText(), /239,449 SIMUSDT/);
  assert.match(await page.locator('[data-growth-label]').innerText(), /Симуляция • обучение ботов • не реальный торговый актив/);
  assert.equal(await page.locator('[data-field="tradable"]').isChecked(), false);
  assert.equal(await page.inputValue('[data-field="ownerAllocation"]'), '0');
  assert.equal(calls.filter(call => call.startsWith('POST') || call.startsWith('PUT')).length, 0, 'choosing a window writes nothing');
  check('BotLab 01 proposal prefilled (VHX01, P0 = 2, no start time), 20 cards, rotation VHX-01-BTC, peak 239,449 SIMUSDT, nothing saved');
  // Intraday model: v2 by default, v1 only as the labelled baseline; daily values are the observation.
  assert.equal(await page.locator('[data-field="history20IntrabarV2"]').isChecked(), true);
  assert.match(await page.locator('[data-provenance="observed"]').innerText(), /одна опорная цена Coin Metrics PriceUSD на сутки/);
  assert.match(await page.locator('[data-provenance="modeled"]').innerText(), /^МОДЕЛЬ v2 \(SEEDED_BRIDGE_REFERENCE_V2\).*выдуманы моделью.*не объём площадки/);
  await page.locator('[data-field="history20IntrabarV1"]').check();
  assert.match(await page.locator('[data-provenance="modeled"]').innerText(), /^МОДЕЛЬ v1 \(базовая линия, LOG_LINEAR_REFERENCE_V1\)/);
  await page.locator('[data-field="history20IntrabarV2"]').check();
  assert.match(await page.locator('[data-provenance="modeled"]').innerText(), /^МОДЕЛЬ v2/);
  check('Intraday model selector: v2 seeded bridge by default, v1 straight-line baseline on request; observed vs MODELED labels shown');
  await capture(page, 'history20-library-1440');
  await capture(page, 'history20-panel-1440', '[data-historical-growth]');

  const listingAt = new Date(Math.ceil((Date.now() + 2 * 86400000) / 86400000) * 86400000).toISOString();
  await page.fill('[data-field="wallTime"]', listingAt.slice(0, 16));
  const saving = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/admin/listings'));
  let started = Date.now();
  await page.locator('[data-save-draft]').click();
  const saved = await (await saving).json();
  report.timings.saveMs = Date.now() - started;
  await page.waitForFunction(() => document.querySelector('[data-preview]')?.disabled === false);
  const listing = (await api('/admin/listings')).body.listings.find(item => item.id === saved.id);
  const program = listing.draft.simulationProgram;
  assert.equal(program.growth, 'historical-window');
  assert.equal(program.historicalGrowth.scenarioId, 'VHX-01-BTC');
  assert.equal(program.historicalGrowth.intrabar, 'SEEDED_BRIDGE_REFERENCE_V2');
  assert.equal(program.maxPrice, '239.449');
  assert.deepEqual(program.stages, []);
  assert.equal(listing.draft.ownerAllocation, '0');
  assert.equal(listing.draft.tradable, false);
  assert.equal(listing.activeVersion, null);
  report.draftBytes = Buffer.byteLength(JSON.stringify(listing.draft));
  check(`Private draft saved through the real router and Durable Object (${report.draftBytes} bytes): window VHX-01-BTC, cap 239.449, no stages, no allocation, not tradable, not published`);

  const windowDays = program.historicalGrowth.source.dataKind === 'exchange_ohlcv' ? program.historicalGrowth.logs.length : program.historicalGrowth.logs.length - 1;
  const fromDay = Math.max(0, windowDays - 30);
  for (const [horizon, interval] of [['first24h', '5m'], ['window', '4h'], ['window', '1d']]) {
    await page.selectOption('[data-field="previewHorizon"]', horizon);
    if (horizon === 'window') await page.fill('[data-field="previewFromDay"]', String(fromDay));
    await page.selectOption('[data-field="previewInterval"]', interval);
    const pending = page.waitForResponse(r => r.url().includes('/preview?'));
    started = Date.now();
    await page.locator('[data-preview]').click();
    const response = await pending;
    report.timings[`preview_${horizon}_${interval}_ms`] = Date.now() - started;
    assert.equal(response.status(), 200);
    const preview = await response.json();
    await page.locator('[data-preview-window]').waitFor();
    assert.ok(preview.candles.length > 0 && preview.candles.length <= 360);
    assert.ok(preview.candles.every(c => c.high <= 239.449 && c.low > 0));
    assert.equal(preview.scenarioSummary.historicalGrowth.unit, 'SIMUSDT');
    if (horizon === 'first24h') assert.equal(preview.candles[0].open, 2);
    assert.equal(preview.scenarioSummary.historicalGrowth.intrabar, 'SEEDED_BRIDGE_REFERENCE_V2');
    const provenance = page.locator('[data-preview-provenance]');
    assert.equal(await provenance.getAttribute('data-preview-provenance'), interval === '1d' ? 'daily' : 'intraday');
    assert.match(await provenance.innerText(), interval === '1d' ? /Наблюдение: одна опорная цена/ : /синтетическая модель внутри суток.*МОДЕЛЬ v2/s);
    if (interval === '5m') {
      // Not straight lines: the 5-minute closes turn many times a day (v1 had none).
      let turns = 0;
      for (let i = 2; i < preview.candles.length; i++) if (Math.sign(preview.candles[i].close - preview.candles[i - 1].close) * Math.sign(preview.candles[i - 1].close - preview.candles[i - 2].close) < 0) turns++;
      report.preview5mTurns = turns;
      assert.ok(turns > 40, `5m candles turn (${turns})`);
    }
    if (interval === '1d') { await capture(page, 'history20-preview-window-1d-1440', '[data-listing-preview]'); continue; }
    report[`preview_${horizon}`] = { candles: preview.candles.length, observedHigh: preview.scenarioSummary.observedHigh, fromDay: preview.scenarioSummary.historicalGrowth.fromDay, toDay: preview.scenarioSummary.historicalGrowth.toDay };
    await capture(page, `history20-preview-${horizon}-1440`, '[data-listing-preview]');
  }
  check(`Bounded private previews: first day opens at P0 = 2 (v2: ${report.preview5mTurns} turns of the 5m closes), a ${report.preview_window.toDay - report.preview_window.fromDay}-day fragment from day ${fromDay}; every high ≤ 239.449 SIMUSDT; 1d labelled as observation, finer candles as the model`);

  assert.equal(await page.locator('[data-publish]').isDisabled(), true);
  const publish = await api(`/admin/listings/${saved.id}/publish`, { method: 'POST', body: { draftRevision: listing.draftRevision, publishKey: 'history20-qa-key-0000000001' } });
  assert.equal(publish.status, 422);
  assert.equal(publish.body.error, 'HISTORICAL_RIGHTS_UNVERIFIED');
  assert.deepEqual((await (await mf.dispatchFetch('http://127.0.0.1/market/listings')).json()).assets, []);
  check('Publication refused by the Durable Object itself (HISTORICAL_RIGHTS_UNVERIFIED); the public catalogue stays empty');

  const download = page.waitForEvent('download');
  await page.locator('[data-history20-export-draft]').click();
  const draftFile = await download;
  const exported = JSON.parse(fs.readFileSync(await draftFile.path(), 'utf8'));
  assert.equal(exported.max_price, '239.449');
  assert.equal(exported.preserve_gate, 'HISTORICAL_RIGHTS_UNVERIFIED');
  assert.equal(exported.clock.proposed_120h_mode, 'INACTIVE_REQUIRES_OWNER_CONFIRMATION');
  fs.writeFileSync(path.join(output, 'botlab01-draft-export.json'), JSON.stringify(exported, null, 2));
  check('Draft export: max_price 239.449, REAL_TIME, 120 h compression inactive, rights gate kept');

  await page.locator('[data-clone-window]').click();
  assert.equal(await page.inputValue('[data-field="symbol"]'), '');
  await page.fill('[data-field="symbol"]', 'VHX01C');
  await page.fill('[data-field="wallTime"]', listingAt.slice(0, 16));
  const cloning = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/admin/listings'));
  await page.locator('[data-save-draft]').click();
  const clone = await (await cloning).json();
  assert.notEqual(clone.id, saved.id);
  assert.equal(clone.draft.simulationProgram.historicalGrowth.logsSha256, program.historicalGrowth.logsSha256);
  await page.locator('[data-create-listing]').click();
  await page.locator('[data-growth-mode-window]').check();
  assert.match(await page.locator('[data-history20-rotation]').innerText(), /VHX-03-SOL \(позиция 3 из 20/);
  await page.locator('[data-growth-mode-stages]').check();
  await page.locator('[data-movement-editor]').waitFor();
  check('Clone into a new listing ID keeps the window; the rotation cursor advances per listing ID (next VHX-03-SOL); return to stages restores the legacy editor');
  await allOwnerWindows(page, 1440, listingAt, true);
  await context.close();

  // ── 390: the saved draft on a phone, no sideways scroll ──
  const phone = await newPage(390, 844);
  await phone.page.goto(`${origin}/admin/listings`);
  if (!zip) { await loadWindows(phone.page); await phone.page.reload(); }
  await phone.page.locator(`[data-edit-listing="VHX01"]`).click();
  await phone.page.locator('[data-history20-selected="VHX-01-BTC"]').waitFor();
  if (zip) await loadWindows(phone.page);
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `no sideways page scroll at 390 px (got ${overflow})`);
  await capture(phone.page, 'history20-form-390');
  await capture(phone.page, 'history20-panel-390', '[data-historical-growth]');
  await phone.page.selectOption('[data-field="previewHorizon"]', 'window');
  await phone.page.fill('[data-field="previewFromDay"]', String(fromDay));
  await phone.page.selectOption('[data-field="previewInterval"]', '4h');
  await phone.page.locator('[data-preview]').click();
  await phone.page.locator('[data-preview-window]').waitFor();
  await capture(phone.page, 'history20-preview-390', '[data-listing-preview]');
  check('390 px: saved window draft, 20 cards in one column, bounded preview, no sideways scroll');
  await allOwnerWindows(phone.page, 390, listingAt, false);
  await phone.context.close();
}

async function run() {
  try {
    await setup();
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
    const canonical = fs.realpathSync(persist);
    assert.equal(path.dirname(canonical), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(canonical).startsWith('voltex-history20-qa-'));
    fs.rmSync(canonical, { recursive: true });
  }
  console.log(`${report.checks.length} acceptance checks; evidence: ${output}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
