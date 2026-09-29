/** Deposit dialog reading the address catalogue straight from Cloudflare.
 *
 * Real: the deposit-catalogue Worker bundle in workerd (Miniflare, SQLite DO),
 * its public read-only path and CORS policy, and a production frontend bundle
 * built with VITE_DEPOSIT_CATALOGUE_URL. Synthetic: every Render read the
 * Wallet page makes (fixtures) and the catalogue addresses. External requests
 * are blocked. No production credentials, data or writes.
 *
 * Build first:
 *   VITE_MANUAL_DEPOSIT_CATALOGUE=true VITE_DEPOSIT_CATALOGUE_URL=http://127.0.0.1:8791 \
 *     npx vite build --outDir <dir>      (in frontend/)
 * then QA_FRONTEND_DIST=<dir> node scripts/qa-deposit-catalogue-edge.cjs
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const workerRequire = require('node:module').createRequire(path.join(root, 'workers/deposit-catalogue/package.json'));
const { build } = workerRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');

const EDGE_PORT = 8791, SITE_PORT = Number(process.env.QA_SITE_PORT || 4263);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`, SITE = `http://127.0.0.1:${SITE_PORT}`;
const TOKEN = 'synthetic-local-only-catalogue-secret-0001';
const out = path.resolve(process.env.QA_OUT || 'docs/qa/deposit-catalogue-edge');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'output/deposit-catalogue-edge-frontend');
const idleMs = Number(process.env.QA_IDLE_MS || 60100);
fs.mkdirSync(out, { recursive: true });
assert.ok(fs.readdirSync(path.join(dist, 'assets')).some(f => f.endsWith('.js') && fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes(EDGE)),
  `bundle must be built with VITE_DEPOSIT_CATALOGUE_URL=${EDGE}`);

const eth = '0x' + '1'.repeat(40), tronAddr = 'T' + 'A'.repeat(33), btc = 'bc1q' + 'a'.repeat(38), xrp = 'r' + 'A'.repeat(30);
const entry = (assetId, networkId, address, extra = {}) => ({ assetId, networkId, address, enabled: true, memo: '', memoLabel: '', ...extra });
const doc = { schemaVersion: 1, baseline: [entry('bitcoin', 'bitcoin', btc), entry('ethereum', 'ethereum', eth), entry('tether', 'ethereum', eth),
  entry('tether', 'tron', tronAddr), entry('ripple', 'xrp', xrp, { memo: '123456' }), entry('solana', 'solana', 'A'.repeat(44), { enabled: false })], overrides: [] };

let mf, options;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-deposit-edge-qa-'));
async function startEdge() {
  if (!options) {
    const bundle = await build({ entryPoints: [path.join(root, 'workers/deposit-catalogue/src/index.js')], bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
    options = { ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'catalogue', modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-09-01', bindings: { DEPOSIT_CATALOGUE_STORE_TOKEN: TOKEN, PUBLIC_CATALOGUE_ORIGINS: SITE },
      durableObjects: { RECEIVING_ADDRESS_CATALOGUE: { className: 'ReceivingAddressCatalogueDO', useSQLite: true } },
      outboundService: () => { throw new Error('QA: no egress'); } }] }),
      isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: EDGE_PORT };
  }
  mf = new Miniflare(options); await mf.ready;
}
// The admin write path (secret, no Origin) — what Render does when an admin saves.
const privateStore = async (method, body, revision) => {
  const r = await fetch(`${EDGE}/receiving-address-catalogue`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json',
    ...(revision ? { 'If-Match': revision } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(r.status, 200); return r.json();
};

const render = [];
const app = express();
app.use('/api/v1', (req, _res, next) => { render.push(`${req.method} ${req.path}`); next(); });
app.get('/api/v1/me', (_, res) => res.json({ id: 'qa-user', email: 'user@example.invalid', displayName: 'QA User', role: 'USER', isAdmin: false, kycStatus: 'APPROVED' }));
app.get('/api/v1/wallet/overview', (_, res) => res.json({ real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 80000 }));
app.get('/api/v1/wallet/performance', (_, res) => res.status(503).json({ error: 'Fixture performance unavailable' }));
app.get('/api/v1/private-trading/native/wallet', (_, res) => res.status(404).json({ error: 'Fixture has no native account' }));
app.post('/api/v1/wallet/portfolio-snapshot', (_, res) => res.json({ recorded: false }));
app.get('/api/v1/market/external/rankings', (_, res) => res.json({ source: 'synthetic', rankings: [] }));
app.get('/api/v1/support/conversations/mine', (_, res) => res.json({ conversation: null, messages: [] }));
app.get('/api/v1/deposit-catalogue', (_, res) => res.status(500).json({ error: 'QA: the Render catalogue must not be read' }));
app.get('/api/v1/*', (_, res) => res.json([]));
app.use('/api/v1', (_, res) => res.status(405).json({ error: 'No writes' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));

const report = { scope: 'Local only: real Worker in workerd + production bundle; Render reads are fixtures; synthetic addresses', checks: [], requests: {}, layouts: [], pageErrors: [] };
const check = name => { report.checks.push(name); console.log('✓', name); };

async function main() {
  await startEdge();
  const seeded = await privateStore('PUT', doc, (await privateStore('GET')).revision);
  const server = await new Promise(resolve => { const s = app.listen(SITE_PORT, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch();
  const edge = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], locale: 'ru-RU' });
    await context.route('**/*', route => { const u = route.request().url(); return u.startsWith(SITE) || u.startsWith(EDGE) ? route.continue() : route.abort(); });
    await context.routeWebSocket(/.*/, ws => ws.close());
    await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-qa-only'); localStorage.setItem('exchange_lang', 'ru'); });
    const page = await context.newPage();
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('request', r => { if (r.url().startsWith(EDGE)) edge.push({ method: r.method(), url: r.url().slice(EDGE.length), headers: r.headers() }); });
    const edgeCount = () => edge.length;
    const renderCatalogue = () => render.filter(r => r.includes('deposit-catalogue')).length;
    const shot = async name => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, name) });
      const l = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })); report.layouts.push({ name, ...l });
      assert.ok(l.documentWidth <= l.width, `${name} overflows`); };
    const pick = async (kind, label) => {
      await page.getByRole('button', { name: kind === 'asset' ? 'Изменить актив' : 'Изменить сеть', exact: true }).click();
      await (kind === 'asset' ? page.getByRole('option').filter({ has: page.locator('small', { hasText: new RegExp('^' + label + '$') }) })
        : page.getByRole('option', { name: new RegExp(label) })).click();
    };

    /* 1. One Deposit open = one Cloudflare read, zero Render catalogue reads. */
    await page.goto(`${SITE}/wallet`); await page.waitForTimeout(2000);
    assert.equal(edgeCount(), 0, 'nothing is prefetched before Deposit opens');
    await page.goto(`${SITE}/wallet?action=deposit`);
    await page.getByTestId('deposit-address').waitFor();
    await page.getByText(btc, { exact: true }).waitFor();
    report.requests.coldOpen = { edge: edgeCount(), renderCatalogue: renderCatalogue() };
    assert.deepEqual(report.requests.coldOpen, { edge: 1, renderCatalogue: 0 });
    const first = edge[0];
    assert.equal(first.method, 'GET'); assert.equal(first.url, '/public/deposit-catalogue');
    assert.ok(!('authorization' in first.headers) && !('cookie' in first.headers), 'anonymous, cookie-less read');
    check('Deposit open: exactly one anonymous GET to the Cloudflare public catalogue, zero Render catalogue requests, nothing prefetched');

    /* 2. Asset / network / copy / QR: no further requests. */
    const before = edgeCount(), renderBefore = render.length;
    await pick('asset', 'USDT'); await pick('network', 'TRON'); await page.getByText(tronAddr, { exact: true }).waitFor();
    await pick('network', 'Ethereum'); await page.getByText(eth, { exact: true }).waitFor();
    await pick('asset', 'XRP'); await page.getByText('123456', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Копировать адрес', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), xrp);
    await page.getByRole('button', { name: 'Копировать memo', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '123456');
    await page.locator('.dc-qr-button').click(); await page.locator('svg.dc-qr').waitFor();
    await page.getByRole('button', { name: 'Изменить актив', exact: true }).click();
    const offered = await page.getByRole('option').locator('small').allTextContents();
    assert.ok(!offered.includes('SOL'), 'a disabled destination is never offered'); await page.keyboard.press('Escape');
    report.requests.selectCopyQr = { edge: edgeCount() - before, render: render.slice(renderBefore) };
    assert.equal(report.requests.selectCopyQr.edge, 0);
    assert.ok(!report.requests.selectCopyQr.render.some(r => r.includes('deposit')), 'no Render deposit request on selection');
    await shot('customer-1440.png');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('customer-390.png');
    check('asset, network, address copy, memo copy and QR made zero requests; disabled SOL not offered; 1440 and 390 fit');

    /* 3. Idle: zero polling. */
    const idleStart = edgeCount(); await page.waitForTimeout(idleMs);
    report.requests.idle = { ms: idleMs, edge: edgeCount() - idleStart };
    assert.equal(report.requests.idle.edge, 0);
    check(`open dialog idle ${Math.round(idleMs / 1000)} s: zero catalogue requests`);

    /* 4. An admin change is visible on the next open (revalidation), not before. */
    await privateStore('PUT', { ...doc, overrides: [entry('ripple', 'xrp', xrp, { enabled: false, memo: '123456' })] }, seeded.revision);
    const reopenStart = edgeCount();
    await page.reload(); await page.getByTestId('deposit-address').waitFor();
    await page.getByRole('button', { name: 'Изменить актив', exact: true }).click();
    assert.ok(!(await page.getByRole('option').locator('small').allTextContents()).includes('XRP')); await page.keyboard.press('Escape');
    report.requests.reopen = edgeCount() - reopenStart;
    assert.equal(report.requests.reopen, 1);
    check('after the admin disables XRP, the next open reads once and XRP is gone');

    /* 5. Edge down: a visible error with retry, and no silent Render fallback. */
    await mf.dispose();
    const renderBeforeOutage = renderCatalogue();
    await page.reload();
    await page.getByRole('alert').filter({ hasText: /./ }).first().waitFor();
    await shot('edge-unavailable-390.png');
    assert.equal(renderCatalogue(), renderBeforeOutage, 'no Render fallback');
    await startEdge();
    await page.getByRole('button', { name: /Повторить/ }).click();
    await page.getByTestId('deposit-address').waitFor();
    check('Worker down: the dialog shows an error with retry and never falls back to Render; retry recovers after restart (SQLite persisted)');

    assert.equal(renderCatalogue(), 0, 'the Render catalogue route was never called');
    assert.deepEqual(report.pageErrors, []);
    check('zero Render catalogue calls in the whole run; no page errors');
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close(); server.close(); await mf?.dispose().catch(() => {});
    fs.rmSync(persist, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
