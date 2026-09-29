/** Synthetic-only browser QA. Real catalogue router/service, mock storage and
 * mock auth DB. External requests blocked. No production credentials/data. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express'), jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
process.env.JWT_SECRET = 'catalogue-local-browser-fixture-secret';
const { DepositCatalogue } = require('../dist/services/depositCatalogue/service');
const { depositCatalogueRouter } = require('../dist/api/routes/depositCatalogue');
const { CatalogueError } = require('../dist/services/depositCatalogue/store');
const { DEPOSIT_RAILS } = require('../dist/services/depositCatalogue/registry');
const out = path.resolve(process.env.QA_OUT || 'docs/qa/manual-deposit-catalogue');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'output/deposit-catalogue-frontend');
const idleMs = Number(process.env.QA_IDLE_MS || 60100);
fs.mkdirSync(out, { recursive: true });
const eth = '0x' + '1'.repeat(40), sol = 'A'.repeat(44), xrp = 'r' + 'A'.repeat(30);
const entry = (assetId, networkId, address) => ({ assetId, networkId, address, enabled: true, memo: '', memoLabel: '' });
const baseline = [entry('bitcoin', 'bitcoin', 'bc1q' + 'a'.repeat(38)), entry('ethereum', 'ethereum', eth), entry('tether', 'ethereum', eth), entry('tether', 'tron', 'T' + 'A'.repeat(33))];
const storage = {
  reads: 0, writes: 0, revision: 1, document: { schemaVersion: 1, baseline, overrides: [] },
  async read() { this.reads++; return structuredClone({ revision: String(this.revision), document: this.document }); },
  async replace(document, revision) { if (revision !== String(this.revision)) throw new CatalogueError(409, 'Conflict');
    this.document = structuredClone(document); this.revision++; this.writes++; return structuredClone({ revision: String(this.revision), document }); },
};
const ids = [...new Set(DEPOSIT_RAILS.map(e => e.assetId))].slice(0, 20);
const ranking = ids.map((id, i) => ({ id, symbol: DEPOSIT_RAILS.find(e => e.assetId === id).asset, name: id, rank: i + 1 }));
const authReads = [], forbidden = [];
const prisma = { user: { findUnique: async ({ where }) => { authReads.push(where.id); return { id: where.id, role: 'ADMIN' }; } } };
const catalogue = new DepositCatalogue(storage, async () => ranking);
const app = express(); app.use(express.json());
const apiRequests = [];
app.use('/api/v1', (req, _res, next) => { apiRequests.push({ method: req.method, path: req.path }); next(); });
app.use('/api/v1', depositCatalogueRouter(prisma, catalogue));
app.get('/api/v1/me', (_, res) => res.json({ id: 'qa-admin', email: 'admin@example.invalid', displayName: 'QA Admin', role: 'ADMIN', isAdmin: true }));
app.get('/api/v1/wallet/overview', (_, res) => res.json({ real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 80000 }));
app.get('/api/v1/wallet/performance', (_, res) => res.status(503).json({ error: 'Fixture performance unavailable' }));
app.get('/api/v1/private-trading/native/wallet', (_, res) => res.status(404).json({ error: 'Fixture has no native account' }));
// Existing Wallet page effect, unrelated to Deposit. Preserve and report it;
// this fixture acknowledges without persisting anything.
app.post('/api/v1/wallet/portfolio-snapshot', (_, res) => res.json({ recorded: false }));
app.get('/api/v1/market/external/rankings', (_, res) => res.json({ source: 'synthetic', rankings: [] }));
app.get('/api/v1/support/conversations/mine', (_, res) => res.json({ conversation: null, messages: [] }));
app.get('/api/v1/admin/alerts/summary', (_, res) => res.json({ depositId: null, withdrawalId: null, kycId: null }));
app.get('/api/v1/*', (_, res) => res.json([]));
app.use('/api/v1', (req, res) => { forbidden.push({ path: req.path, method: req.method }); res.status(405).json({ error: 'No financial writes permitted' }); });
app.use(express.static(dist, { index: false }));
app.get('*', (_, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
const report = { scope: 'Synthetic fixture data only; real catalogue endpoints and standard UI; no production data', widths: [1440, 390], checks: [], layouts: [], requests: {}, pageErrors: [], forbidden };
const featureRequests = () => apiRequests.filter(r => r.path.includes('deposit-catalogue'));
const snap = () => ({ requests: apiRequests.length, featureRequests: featureRequests().length, storeReads: storage.reads, storeWrites: storage.writes, authReads: authReads.length });
const delta = before => Object.fromEntries(Object.entries(snap()).map(([k, v]) => [k, v - before[k]]));
async function main() {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser, page;
  try {
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(token => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); }, jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET));
    page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) { report.pageErrors.push(msg.text()); console.error('BROWSER:', msg.text()); } });
    const screenshot = async name => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, name), fullPage: true });
      const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })); report.layouts.push({ name, ...layout }); assert.ok(layout.documentWidth <= layout.width, name + ' overflows'); };
    let before = snap(); await page.goto(origin + '/admin/wallets'); await page.locator('.catalogue-network').first().waitFor();
    report.requests.adminColdOpen = delta(before); assert.equal(report.requests.adminColdOpen.featureRequests, 1); assert.equal(report.requests.adminColdOpen.storeReads, 1);
    await page.getByRole('button', { name: /^USDT / }).click(); await screenshot('admin-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('admin-mobile.png');
    await page.getByRole('button', { name: /^SOL / }).click(); await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByLabel('Адрес пополнения', { exact: true }).fill(sol); await page.getByLabel('Показывать клиентам').check();
    await screenshot('admin-editor-mobile.png'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload(); await page.getByRole('button', { name: /^SOL / }).click(); await page.getByText(sol, { exact: true }).waitFor(); report.checks.push('add + persisted across full reload');
    await page.getByRole('button', { name: 'Изменить', exact: true }).click(); await page.getByLabel('Адрес пополнения', { exact: true }).fill('B'.repeat(44));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByText('B'.repeat(44), { exact: true }).waitFor(); report.checks.push('edit');
    await page.getByRole('button', { name: 'Изменить', exact: true }).click(); await page.getByLabel('Показывать клиентам').uncheck();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); report.checks.push('disable');
    await page.getByRole('button', { name: /^XRP / }).click(); await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByLabel('Адрес пополнения', { exact: true }).fill(xrp); await page.getByLabel('Memo / Tag', { exact: true }).fill('123456'); await page.getByLabel('Показывать клиентам').check();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); report.checks.push('memo');
    // Real one-minute idle measurement, separate from unrelated existing shell.
    before = snap(); await page.waitForTimeout(idleMs); report.requests.adminIdle60s = delta(before);
    assert.equal(report.requests.adminIdle60s.featureRequests, 0); assert.equal(report.requests.adminIdle60s.storeReads, 0);
    // Server TTL has expired; this open proves a single cold public read.
    before = snap(); await page.goto(origin + '/wallet?action=deposit'); await page.getByTestId('deposit-address').waitFor();
    // The window opens on USDT · TRC-20 (owner, 2026-09-29).
    await page.getByText(baseline[3].address, { exact: true }).waitFor(); report.requests.customerColdOpen = delta(before);
    assert.equal(report.requests.customerColdOpen.featureRequests, 1); assert.equal(report.requests.customerColdOpen.storeReads, idleMs > 30000 ? 1 : 0);
    // Asset: the «Актив» field opens the list; network: every network is an on-screen radio.
    const pick = async (id, label) => { if (id === 'deposit-asset') { await page.getByRole('button', { name: /^Актив / }).click(); await page.getByRole('option').filter({ has: page.locator('strong', { hasText: new RegExp('^' + label + '$') }) }).click(); } else await page.getByRole('radio', { name: new RegExp(label.split(' · ')[0]) }).click(); };
    before = snap(); await pick('deposit-asset', 'USDT'); await pick('deposit-network', 'TRON · TRC-20'); await page.getByText(baseline[3].address, { exact: true }).waitFor();
    await pick('deposit-network', 'Ethereum · ERC-20'); await page.getByText(eth, { exact: true }).waitFor(); report.checks.push('existing USDT networks');
    await pick('deposit-asset', 'ETH'); await page.getByText(eth, { exact: true }).waitFor(); report.checks.push('existing ETH native');
    await pick('deposit-asset', 'XRP'); await page.getByText('123456', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Копировать адрес', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), xrp);
    await page.getByRole('button', { name: 'Копировать memo', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '123456');
    report.requests.selectAndCopy = delta(before); assert.equal(report.requests.selectAndCopy.featureRequests, 0); assert.equal(report.requests.selectAndCopy.storeWrites, 0);
    await page.getByRole('button', { name: /^Актив / }).click(); const offered = await page.getByRole('option').locator('strong').allTextContents();
    assert.ok(!offered.includes('SOL')); assert.ok(!offered.includes('USDC')); await page.keyboard.press('Escape'); report.checks.push('disabled/unconfigured excluded; address + memo copy');
    await screenshot('customer-mobile.png'); await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot('customer-desktop.png');
    before = snap(); await page.waitForTimeout(idleMs); report.requests.customerIdle60s = delta(before);
    assert.equal(report.requests.customerIdle60s.featureRequests, 0); assert.equal(report.requests.customerIdle60s.storeReads, 0); assert.equal(report.requests.customerIdle60s.storeWrites, 0);
    // An address disabled by Admin must vanish on the next open/reload.
    const current = await catalogue.adminCatalogue();
    await catalogue.save({ ...entry('ripple', 'xrp', xrp), enabled: false }, current.revision);
    await page.reload(); await page.getByRole('button', { name: /^Актив / }).click();
    assert.ok(!(await page.getByRole('option').locator('strong').allTextContents()).includes('XRP'));
    await page.keyboard.press('Escape'); report.checks.push('reopen revalidates changed catalogue');
    await page.goto(origin + '/admin/wallets'); await page.getByRole('button', { name: /^USDT / }).click();
    await page.locator('.catalogue-network').filter({ hasText: 'Ethereum' }).getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByRole('button', { name: 'Очистить адрес', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.ok(!(await catalogue.publicCatalogue()).entries.some(e => e.asset === 'USDT' && e.networkId === 'ethereum'));
    report.checks.push('clear address overrides legacy baseline');
    report.featureRequests = featureRequests(); report.totalApiRequests = apiRequests;
    assert.equal(forbidden.length, 0); assert.equal(report.pageErrors.length, 0); report.result = 'PASS';
    console.log(JSON.stringify({ result: report.result, checks: report.checks, requests: report.requests, layouts: report.layouts }));
  } catch (error) { if (page) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); report.failure = { message: error.message, url: page.url(), body: (await page.locator('body').innerText()).slice(-3500) }; } throw error;
  } finally { report.idleMs = idleMs; fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2)); await browser?.close(); server.closeAllConnections(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
