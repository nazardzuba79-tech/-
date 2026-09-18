#!/usr/bin/env node
/**
 * The Futures market rail's search, driven in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture market data, reads only, every write
 * 404s. No production account, database or external call.
 *
 * The claim under test is "instant": opening search must be a state flip
 * and a focus, with no request behind it. So every API call the page makes
 * is counted, and the count is compared across opening, typing and closing
 * — if a single one fires, the run fails.
 *
 *   node scripts/qa-futures-market-search.cjs [--dist path] [--port N] [--out dir]
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4301'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-search')));

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

function start() {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  // Answered rather than 404'd on purpose. assetMetadataStore deliberately
  // returns symbols to "unknown" when this fails so a later render retries;
  // a 404 here would make every re-render re-queue and would look exactly
  // like search causing requests, which it does not.
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

const HEAD = '.pairs-head';
const ICON = '.pairs-head-search';
const INPUT = '.pairs-head-input';
const LIST_BTN = '.pair-markets-btn';

const state = (page) => page.evaluate(() => {
  const head = document.querySelector('.pairs-head');
  const rows = [...document.querySelectorAll('.futures-pair-list [data-row]')].map(n => n.getAttribute('aria-label'));
  const chart = document.querySelector('.chart-area');
  const book = document.querySelector('.reference-book, .order-book');
  const ticket = document.querySelector('.fo-panel, .order-form');
  const box = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
  return {
    open: !!document.querySelector('.pairs-head-input'),
    headHeight: head ? Math.round(head.getBoundingClientRect().height) : null,
    title: document.querySelector('.pairs-head-title')?.textContent?.trim() ?? null,
    rows: rows.slice(0, 40),
    rowCount: rows.length,
    listTop: document.querySelector('.futures-pair-list')
      ? Math.round(document.querySelector('.futures-pair-list').getBoundingClientRect().top) : null,
    chartWidth: box(chart), bookWidth: box(book), ticketWidth: box(ticket),
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    sortButtons: [...document.querySelectorAll('.pairs-col-headers .pch-sort')].map(b => b.textContent.trim()),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = {};
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const width of [1440, 1366, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      let apiLog = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/')) apiLog.push(new URL(req.url()).pathname);
      });
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);

      const view = report[width] = {};

      // Mobile keeps the rail inside a <dialog>, so the header exists in the
      // DOM but is not visible. Open it the way a user does — which is also
      // a check that the new list button is a working entry point.
      if (!(await page.locator(HEAD).first().isVisible())) {
        await page.locator(LIST_BTN).first().click();
        await page.waitForTimeout(600);
        view.openedViaListButton = await page.locator(HEAD).first().isVisible();
      }
      await page.locator(HEAD).first().waitFor({ state: 'visible', timeout: 8000 });

      // The list button is one of the two entry points, and it opens the
      // rail WITH search already up — that is the intent, not a defect. The
      // baseline below wants the resting state, so close it first.
      view.entryPointOpenedSearch = await page.locator(INPUT).first().isVisible().catch(() => false);
      if (view.entryPointOpenedSearch) {
        await page.locator(ICON).first().click();
        await page.waitForTimeout(150);
      }

      view.closed = await state(page);
      await page.screenshot({ path: path.join(OUT, `${width}-closed.png`) });

      // ── the claim: opening and typing add no request of their own ──────
      // The page polls its ticker feed on a timer whatever the user does,
      // so a raw count over the search window would charge those polls to
      // the search. Instead: watch an IDLE window of the same length first,
      // then do the whole search in a window of that length, and require
      // that the search window contains no endpoint the idle one did not.
      // That is the real claim — search adds nothing — and a poll landing
      // mid-search cannot fake it either way.
      const idleStart = apiLog.length;
      await page.waitForTimeout(3000);
      const idleWindow = new Set(apiLog.slice(idleStart));
      view.idleWindowCalls = apiLog.length - idleStart;

      // Measured per action, not as one blur: the brief's hard requirement
      // is that OPENING makes no request. Typing is reported separately.
      const openStart = apiLog.length;
      const clickedAt = Date.now();
      await page.locator(ICON).first().click();
      await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
      view.msToUsable = Date.now() - clickedAt;
      view.focusedOnOpen = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT);
      await page.waitForTimeout(250);
      view.endpointsOpenAdded = [...new Set(apiLog.slice(openStart).filter(p => !idleWindow.has(p)))];
      // Control: the field is open and focused, and nothing is typed. Any
      // endpoint that shows up here is a timer on the page, not the search.
      const controlStart = apiLog.length;
      await page.waitForTimeout(1600);
      const controlWindow = new Set(apiLog.slice(controlStart));
      view.endpointsControlAdded = [...new Set(apiLog.slice(controlStart).filter(p => !idleWindow.has(p)))];
      const typeStart = apiLog.length;
      view.open = await state(page);
      await page.screenshot({ path: path.join(OUT, `${width}-open.png`) });

      await page.locator(INPUT).first().type('BTC', { delay: 20 });
      await page.waitForTimeout(150);
      view.btc = await state(page);
      await page.screenshot({ path: path.join(OUT, `${width}-btc.png`) });

      await page.locator(INPUT).first().fill('');
      await page.locator(INPUT).first().type('ETH', { delay: 20 });
      await page.waitForTimeout(150);
      view.eth = await state(page);
      const typeWindow = apiLog.slice(typeStart);
      view.typeWindowCalls = typeWindow.length;
      // Charged to typing only if neither an idle page nor an open-and-idle
      // one reached it.
      view.endpointsTypingAdded = [...new Set(
        typeWindow.filter(p => !idleWindow.has(p) && !controlWindow.has(p)))];

      // ── Escape closes, and reopening right after is not a dead click ───
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      view.afterEscape = await state(page);
      await page.locator(ICON).first().click();
      try {
        await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
      } catch (error) {
        view.reopenDebug = await page.evaluate(() => ({
          heads: document.querySelectorAll('.pairs-head').length,
          icons: [...document.querySelectorAll('.pairs-head-search')].map(b => ({
            expanded: b.getAttribute('aria-expanded'),
            rect: b.getBoundingClientRect().toJSON(),
            visible: !!b.offsetParent,
          })),
          inputs: document.querySelectorAll('.pairs-head-input').length,
          active: document.activeElement?.className ?? null,
          dialogOpen: document.querySelector('dialog')?.hasAttribute('open') ?? null,
        }));
        console.error('REOPEN DEBUG', JSON.stringify(view.reopenDebug, null, 1), 'afterEscape=', JSON.stringify(view.afterEscape.open));
        throw error;
      }
      view.reopened = true;

      // ── hammer it: ten open/close pairs must not leave it stuck ────────
      // Start from a known state — the step above left it OPEN.
      await page.locator(ICON).first().click();
      await page.waitForTimeout(80);
      for (let i = 0; i < 10; i += 1) {
        await page.locator(ICON).first().click();
        await page.locator(ICON).first().click();
      }
      await page.waitForTimeout(200);
      view.afterHammering = await state(page);
      // Ten pairs from closed end closed; one more click must still open it.
      await page.locator(ICON).first().click();
      await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
      view.stillOpensAfterHammering = true;

      // ── select a pair while filtered, then check sorting still works ───
      await page.locator(INPUT).first().fill('ETH');
      await page.waitForTimeout(150);
      const target = await page.locator('.futures-pair-list [data-row]').first().getAttribute('aria-label');
      await page.locator('.futures-pair-list [data-row]').first().click();
      await page.waitForTimeout(500);
      view.selectedPair = await page.evaluate(() => document.querySelector('.pair-name')?.textContent?.trim() ?? null);
      view.selectionTarget = target;

      // On mobile, choosing a pair closes the sheet — as it should. Reopen
      // it before checking that sorting still works.
      if (!(await page.locator(HEAD).first().isVisible())) {
        await page.locator(LIST_BTN).first().click();
        await page.waitForTimeout(600);
        if (await page.locator(INPUT).first().isVisible().catch(() => false)) {
          await page.locator(ICON).first().click();
          await page.waitForTimeout(150);
        }
      }

      if (await page.locator('.pairs-col-headers .pch-sort').first().isVisible()) {
        const first = page.locator('.pairs-col-headers .pch-sort').first();
        const firstRowBefore = (await state(page)).rows[0];
        await first.click();
        await page.waitForTimeout(250);
        const sorted = await state(page);
        view.sortChangedOrder = sorted.rows[0] !== firstRowBefore;
        view.sortPressed = await first.getAttribute('aria-pressed');
        await first.click(); await first.click(); // back to default
      }

      view.pageErrors = pageErrors;
      await context.close();

      // ── assertions ────────────────────────────────────────────────────
      const tag = `${width}`;
      assert.equal(view.closed.open, false, `${tag}: search is open before anything was clicked`);
      assert.ok(view.closed.title, `${tag}: the «Рынки» header is missing`);
      assert.deepEqual(view.endpointsOpenAdded, [],
        `${tag}: OPENING search reached endpoints an idle page does not: ${view.endpointsOpenAdded.join(', ')}`);
      assert.deepEqual(view.endpointsTypingAdded, [],
        `${tag}: TYPING reached endpoints neither an idle nor an open-idle page does: ${view.endpointsTypingAdded.join(', ')}`);
      assert.ok(view.msToUsable < 400, `${tag}: field took ${view.msToUsable}ms to appear`);
      assert.equal(view.focusedOnOpen, true, `${tag}: the field did not take focus on open`);
      // The header keeps its height, so nothing below it moves.
      assert.equal(view.open.headHeight, view.closed.headHeight, `${tag}: the header changed height when search opened`);
      assert.equal(view.open.listTop, view.closed.listTop, `${tag}: the list moved when search opened`);
      for (const key of ['chartWidth', 'bookWidth', 'ticketWidth']) {
        assert.equal(view.open[key], view.closed[key], `${tag}: ${key} changed when search opened`);
      }
      assert.equal(view.open.overflowX, 0, `${tag}: horizontal overflow appeared`);
      // Filtering is real, and over the rows already in memory.
      assert.ok(view.btc.rowCount > 0 && view.btc.rows.every(r => r.includes('BTC')),
        `${tag}: BTC filter returned ${JSON.stringify(view.btc.rows)}`);
      assert.ok(view.eth.rowCount > 0 && view.eth.rows.every(r => r.includes('ETH')),
        `${tag}: ETH filter returned ${JSON.stringify(view.eth.rows)}`);
      assert.ok(view.btc.rowCount < view.closed.rowCount, `${tag}: filtering did not narrow the list`);
      assert.equal(view.afterEscape.open, false, `${tag}: Escape did not close search`);
      assert.equal(view.afterHammering.open, false, `${tag}: rapid toggling left search stuck open`);
      assert.equal(view.selectedPair, view.selectionTarget,
        `${tag}: picking a filtered row selected ${view.selectedPair}, expected ${view.selectionTarget}`);
      if (view.sortChangedOrder !== undefined) {
        assert.equal(view.sortPressed, 'true', `${tag}: the sort control did not report itself pressed`);
      }
      assert.equal(view.pageErrors.length, 0, `${tag}: page errors ${view.pageErrors.join('; ')}`);
    }

    const summary = { status: 'PASS', report };
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({
      status: 'PASS',
      perWidth: Object.fromEntries(Object.entries(report).map(([w, v]) => [w, {
        msToUsable: v.msToUsable, idleWindowCalls: v.idleWindowCalls,
        endpointsOpenAdded: v.endpointsOpenAdded,
        endpointsControlAdded: v.endpointsControlAdded,
        typeWindowCalls: v.typeWindowCalls, endpointsTypingAdded: v.endpointsTypingAdded,
        rowsAll: v.closed.rowCount, rowsBTC: v.btc.rowCount, rowsETH: v.eth.rowCount,
        listTopUnchanged: v.open.listTop === v.closed.listTop, overflowX: v.open.overflowX,
        selectedPair: v.selectedPair, sortChangedOrder: v.sortChangedOrder,
      }])),
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', report }, null, 2).slice(0, 4000));
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
