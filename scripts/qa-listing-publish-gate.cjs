'use strict';
/**
 * The first publication of a listing in a real browser, through this
 * checkout's admin router (src/api/routes/adminListings + CloudflareListingStore
 * + registry + Spot gate) against the market-edge Worker in workerd.
 *
 * QA_API_TIMER=present (default; CI): the API runs the pre-listing timer.
 *   «Опубликовать» with «Запустить таймер» unticked keeps the market off the
 *   exchange; «Запустить таймер» shows it; «Остановить и скрыть» hides it.
 * QA_API_TIMER=absent: run from a checkout whose src is the API deployed before
 *   the timer (2e7acf1), which drops «staged» and would publish at once. The
 *   page must not send a first publication at all — rapid clicks, Enter and a
 *   direct call of the button's handler included — while Save and Preview work
 *   (owner, PR #585, 2026-10-22). Asserted: zero POST …/publish at the router
 *   and in the browser, zero public listings, nothing published for Render.
 *
 * Fixture accounts, no DB, no network; the synthetic ticker QTX exists nowhere
 * in the code. The draft is TYVN-shaped (config/test-markets/tyvn.draft.json).
 *
 *   VITE_MARKET_EDGE_URL=http://127.0.0.1:8787 npx vite build --outDir <dir>   (in frontend/)
 *   QA_FRONTEND_DIST=<dir> [QA_EDGE_ROOT=<checkout of the Worker>] node scripts/qa-listing-publish-gate.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'local-qa-only-publish-gate-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
delete process.env.LISTINGS_STORE_URL;
delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
// The Worker may come from another checkout (QA_EDGE_ROOT), e.g. the exact commit deployed on Cloudflare,
// while the API under test is this checkout's src.
const edgeRoot = path.resolve(process.env.QA_EDGE_ROOT || root);
const edgeRequire = require('node:module').createRequire(path.join(edgeRoot, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore } = require('../src/services/listings/store');
const { ManagedListingRegistry } = require('../src/services/listings/registry');
const { assertSpotListing } = require('../src/services/testMarkets/nrxSpot');

const mode = process.env.QA_API_TIMER === 'absent' ? 'absent' : 'present';
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/listing-publish-gate'));
const EDGE_PORT = Number(process.env.QA_EDGE_PORT || 8787);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0003';
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'Local only: this checkout\'s admin router + store client + registry, the Worker in workerd, a production frontend bundle in Chromium; fixture accounts; no DB, no network.',
  mode, api: root, worker: edgeRoot, checks: [], failures: [], renderCalls: [], browserPublishRequests: [], screenshots: [], pageErrors: [], outbound: 0 };
const check = (name) => { report.checks.push(name); console.log('✓', name); };

async function main() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-publish-gate-qa-'));
  const bundle = await build({ entryPoints: [path.join(edgeRoot, 'workers/market-edge/src/worker.ts')], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_MIN_LEAD_MS: '5000', LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: EDGE_PORT });
  await mf.ready;

  const accounts = { 'qa-admin': 'ADMIN', 'qa-user': 'USER' };
  const prisma = {
    user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id] } : null) },
    session: { findUnique: async () => null, update: async () => null },
    ...Object.fromEntries(['order', 'trade', 'futuresOrder', 'futuresPosition', 'balance'].map((name) => [name, { count: async () => 0 }])),
  };
  const token = jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET);
  const store = new CloudflareListingStore(EDGE, STORE_TOKEN);
  const registry = new ManagedListingRegistry(store);
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.use('/api/v1', (req, _res, next) => { report.renderCalls.push(`${req.method} ${req.path}`); next(); });
  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-admin', email: 'listing.admin@example.invalid', displayName: 'qa-admin', role: 'ADMIN', isAdmin: true, kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' }));
  app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry));
  app.get('/api/v1/*', (_req, res) => res.json([]));
  app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA disallows writes' }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const publicPairs = async () => ((await (await fetch(`${EDGE}/market/listings`, { cache: 'no-store' })).json()).assets || []).map((a) => a.pair);
  const spotRefused = async () => { await registry.ensureFresh(3000); try { assertSpotListing('QTX/USDT'); return false; } catch { return true; } };
  const routerPublishes = () => report.renderCalls.filter((call) => /^POST .*\/publish$/.test(call));
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const step = async (name, fn) => { try { await fn(); check(name); } catch (error) { const msg = String(error.message).replace(/\s+/g, ' ').slice(0, 400); report.failures.push(`${name}: ${msg}`); console.log('✗', name, '—', msg); } };

  try {
    const tyvn = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/tyvn.draft.json'), 'utf8'));
    const listingAt = new Date(Math.ceil((Date.now() + 2 * 86400000) / 10000) * 10000).toISOString().replace('.000Z', 'Z');
    const created = await api('/admin/listings', { method: 'POST', body: { config: { ...tyvn, symbol: 'QTX', name: 'QA Publish Gate', seed: 'qtx-qa-publish-gate-v1', ownerAllocation: '0', listingAt } } });
    assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
    const listed = (await api('/admin/listings')).body.listings.find((l) => l.id === created.body.id);
    check(`a TYVN-shaped draft QTX is created; the API ${Object.prototype.hasOwnProperty.call(listed, 'countdown') ? 'returns' : 'does not return'} the countdown key`);
    assert.equal(Object.prototype.hasOwnProperty.call(listed, 'countdown'), mode === 'present', `QA_API_TIMER=${mode} does not match this API`);

    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU' });
      await context.route('**/*', (route) => { const u = route.request().url(); return u.startsWith(origin) || u.startsWith(EDGE) || u.startsWith('data:') ? route.continue() : route.abort(); });
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      await context.addInitScript(([t]) => { try { localStorage.setItem('exchange_token', t); localStorage.setItem('exchange_lang', 'ru'); } catch {} }, [token]);
      const page = await context.newPage();
      page.on('pageerror', (error) => report.pageErrors.push(`${width}: ${error.message}`));
      page.on('request', (request) => { if (request.method() === 'POST' && /\/publish$/.test(request.url())) report.browserPublishRequests.push(`${width}: ${request.url()}`); });
      const shot = async (name) => { await page.screenshot({ path: path.join(out, name), fullPage: false, animations: 'disabled' }); report.screenshots.push(name); };
      await page.goto(`${origin}/admin/listings`);
      await page.locator('[data-edit-listing="QTX"]').click({ timeout: 20000 });
      const publish = page.locator('[data-publish]');
      await publish.waitFor();

      if (mode === 'absent') {
        await step(`${width}: «Опубликовать» is disabled with the reason; no confirmation opens`, async () => {
          assert.equal(await publish.isDisabled(), true);
          assert.match(await page.locator('[data-publish-needs-timer]').innerText(), /Первая публикация закрыта/);
          await page.locator('[data-publish-needs-timer]').scrollIntoViewIfNeeded();
          await shot(`admin-first-publication-closed-${width}.png`);
        });
        await step(`${width}: rapid clicks, Enter and a direct call of the button's handler send no publication`, async () => {
          await publish.evaluate((button) => { for (let i = 0; i < 5; i += 1) button.click(); });
          await publish.evaluate((button) => { const key = Object.keys(button).find((k) => k.startsWith('__reactProps$')); button[key].onClick(); button[key].onClick(); });
          // Enter in a field submits the form: that saves the draft, never publishes.
          const saved = page.waitForResponse((r) => r.url().endsWith('/draft') && r.request().method() === 'PUT', { timeout: 15000 });
          await page.locator('[data-field="name"]').focus();
          await page.keyboard.press('Enter');
          assert.equal((await saved).status(), 200);
          await page.waitForTimeout(500);
          assert.equal(await page.locator('[data-publish-dialog]').count(), 0);
        });
        await step(`${width}: Save and Preview still work on that API`, async () => {
          const saved = page.waitForResponse((r) => r.url().endsWith('/draft') && r.request().method() === 'PUT', { timeout: 15000 });
          await page.locator('[data-save-draft]').click();
          assert.equal((await saved).status(), 200);
          await page.locator('[data-preview]').click();
          await page.locator('[data-listing-preview]').waitFor({ timeout: 30000 });
        });
        await step(`${width}: zero POST …/publish (router ${routerPublishes().length}, browser ${report.browserPublishRequests.length}), zero public listings, QTX still an unpublished draft`, async () => {
          assert.deepEqual(routerPublishes(), []);
          assert.deepEqual(report.browserPublishRequests, []);
          assert.deepEqual(await publicPairs(), []);
          // Render's published view (what its Spot gate and price source read) has no QTX: nothing exists to trade.
          assert.equal((await registry.authoritative()).some((item) => item.config.symbol === 'QTX'), false);
          assert.equal((await api('/admin/listings')).body.listings.find((l) => l.id === created.body.id).activeVersion, null);
        });
      } else if (width === 1440) {
        await step('1440: publication with «Запустить таймер» unticked sends «staged»; the market stays off the exchange; Spot refuses', async () => {
          assert.equal(await publish.isDisabled(), false);
          assert.equal(await page.locator('[data-publish-needs-timer]').count(), 0);
          await publish.click();
          await page.locator('[data-field="publishStartTimer"]').uncheck();
          await shot('admin-publish-hidden-1440.png');
          const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/publish$/.test(r.url()));
          await page.locator('[data-confirm-publish]').click();
          assert.equal((await sent).postDataJSON().countdown, 'staged');
          await page.locator('[data-listing-timer="staged"]').waitFor({ timeout: 15000 });
          assert.deepEqual(await publicPairs(), []);
          assert.equal(await spotRefused(), true);
        });
        for (const [action, state, shown] of [['start', 'running', true], ['stop', 'staged', false]]) {
          await step(`1440: «${action}» → ${state}: QTX ${shown ? 'on' : 'off'} the exchange; Spot still refuses (tradable:false, before the instant)`, async () => {
            await page.locator(`[data-timer-action="${action}"]`).click();
            await page.locator(`[data-listing-timer="${state}"]`).waitFor({ timeout: 15000 });
            assert.equal((await publicPairs()).includes('QTX/USDT'), shown);
            assert.equal(await spotRefused(), true);
          });
        }
        await shot('admin-timer-stopped-1440.png');
      } else {
        await step('390: the published listing shows its timer on the phone; no first-publication note', async () => {
          await page.locator('[data-listing-timer="staged"]').waitFor({ timeout: 15000 });
          assert.equal(await page.locator('[data-publish-needs-timer]').count(), 0);
          await shot('admin-timer-staged-390.png');
        });
      }
      await context.close();
    }
    await step('the Worker made zero outbound calls; no page errors', async () => {
      assert.equal(report.outbound, 0);
      assert.deepEqual(report.pageErrors, []);
    });
  } finally {
    await browser.close();
    server.close();
    await mf.dispose();
    fs.rmSync(persist, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ mode, checks: report.checks.length, failures: report.failures }, null, 1));
  if (report.failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
