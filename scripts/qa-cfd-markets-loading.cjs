'use strict';
/**
 * Markets page → CFD (CfdMarketsSection): a cold open must not announce
 * «Торговля CFD временно недоступна» while the first ticker snapshot is in
 * flight, and must still say so when quotes are really unavailable
 * (owner, 2026-10-22).
 *
 * Serves the built frontend on loopback; the CFD ticker route is answered by
 * Playwright with the production snapshot recorded at 13:40:29Z on
 * 2026-10-22 (docs/qa/cfd-markets-loading/production-snapshot-*.json) — a
 * real response, not invented prices — delayed, failed, emptied or marked
 * unconfigured per scenario. Every other host is aborted; GET only.
 *
 *   node scripts/qa-cfd-markets-loading.cjs [--label after] [--dist frontend/dist]
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const label = arg('--label', 'local');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, arg('--dist', 'frontend/dist'));
const out = path.join(root, 'docs/qa/cfd-markets-loading');
fs.mkdirSync(out, { recursive: true });
const snapshot = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find((f) => f.startsWith('production-snapshot-'))), 'utf8'));
assert.equal(snapshot.tickers.length, 13, 'the recorded snapshot holds the 13 instruments');
const UNAVAILABLE = 'Торговля CFD временно недоступна';
const report = { label, fixtureOnly: true, productionVerified: false, snapshotCapturedAt: snapshot._display.capturedAt, checks: [], errors: [] };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) }); console.log(`[ok] ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error.stack || error) }); console.error(`[FAIL] ${name}: ${error.message}`); }
}
const state = (page) => page.evaluate((needle) => ({
  messages: (document.body.innerText.match(new RegExp(needle, 'g')) || []).length,
  placeholders: document.querySelectorAll('[data-cfd-placeholder]').length,
  busy: document.querySelectorAll('[aria-busy="true"]').length,
  states: [...document.querySelectorAll('[data-cfd-state]')].map((el) => el.getAttribute('data-cfd-state')),
  rows: document.querySelectorAll('a[href^="/trade?market=cfd"]').length,
  status: [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent.trim()).filter(Boolean),
}), UNAVAILABLE);

(async () => {
  const app = express();
  app.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? next() : res.sendStatus(405)));
  // The markets page sits behind RequireAuth: a fixture session, read-only, like the other terminal QAs.
  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not in this fixture' }));
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const scenario = async (name, answer, body) => {
        const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'UTC' });
        await context.addInitScript(() => { try { localStorage.setItem('exchange_token', 'qa-fixture-token'); } catch {} });
        await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
        const served = [];
        await context.route('**/api/v1/cfd/display/tickers*', async (route) => { served.push(Date.now()); await answer(route); });
        const page = await context.newPage();
        page.on('pageerror', (e) => report.errors.push(`${width} ${name}: ${e.message}`));
        await page.goto(origin + '/markets', { waitUntil: 'domcontentloaded' });
        await page.locator('button', { hasText: /^CFD$/ }).first().click();
        try { return await body(page, served); } finally { await context.close(); }
      };
      const json = (value) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      const shot = (page, what) => page.screenshot({ path: path.join(out, `${label}-${what}-${width}.png`), fullPage: false });

      await check(`${width}: cold open shows loading rows, not «${UNAVAILABLE}», then the 13-instrument snapshot`, async () => {
        let release;
        const held = new Promise((r) => { release = r; });
        let loading;
        return scenario('cold', async (route) => { await held; await json(snapshot)(route); }, async (page, served) => {
          await page.waitForFunction(() => document.querySelector('[data-cfd-state]'), null, { timeout: 15000 }).catch(() => {});
          await delay(800);
          loading = await state(page);
          await page.locator('.market-dashboard__cfd-card').scrollIntoViewIfNeeded().catch(() => {});
          await shot(page, 'loading');
          assert.equal(served.length, 1, 'the ticker snapshot was not requested once');
          assert.equal(loading.messages, 0, `«${UNAVAILABLE}» shown while the snapshot was in flight (${JSON.stringify(loading)})`);
          assert.equal(loading.placeholders, 7, `expected 3 + 4 loading rows: ${JSON.stringify(loading)}`);
          release();
          await page.waitForFunction(() => document.querySelectorAll('a[href^="/trade?market=cfd"]').length >= 7, null, { timeout: 15000 });
          const loaded = await state(page);
          await shot(page, 'loaded');
          assert.equal(loaded.messages, 0); assert.equal(loaded.placeholders, 0); assert.deepEqual(loaded.states, ['rows', 'rows']);
          const first = await page.locator('.market-dashboard__cfd-card a').first().innerText();
          assert(first.includes('XAUUSD') && first.includes(snapshot.tickers[0].price), `first CFD row does not show the snapshot's XAUUSD ${snapshot.tickers[0].price}: ${first}`);
          return { loading, loaded, first: first.replace(/\s+/g, ' ') };
        });
      });

      for (const [name, answer] of [
        ['HTTP 503 from the ticker route', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"market_data_unavailable"}' })],
        ['a snapshot with no instruments', json({ ...snapshot, tickers: [] })],
        ['configured:false', json({ ...snapshot, configured: false, tickers: [] })],
      ]) {
        await check(`${width}: real unavailability still says «${UNAVAILABLE}»: ${name}`, async () => {
          let after;
          await scenario(name, answer, async (page) => {
            await page.waitForFunction((needle) => document.body.innerText.includes(needle), UNAVAILABLE, { timeout: 15000 });
            after = await state(page);
            if (name.startsWith('HTTP')) await shot(page, 'unavailable-503');
          });
          assert(after.messages >= 1, JSON.stringify(after)); assert.equal(after.placeholders, 0, JSON.stringify(after)); assert.equal(after.busy, 0, JSON.stringify(after));
          return after;
        });
      }
    }
  } finally {
    await browser.close(); server.close();
    report.passed = report.checks.every((c) => c.passed) && report.errors.length === 0;
    fs.writeFileSync(path.join(out, `${label}-report.json`), JSON.stringify(report, null, 2));
    console.log(`${report.checks.filter((c) => c.passed).length}/${report.checks.length} checks passed; page errors: ${report.errors.length}`);
    if (!report.passed) process.exitCode = 1;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
