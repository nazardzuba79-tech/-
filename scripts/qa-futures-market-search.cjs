#!/usr/bin/env node
/**
 * The Futures instrument row and its market chooser, driven in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture market data, reads only, every write
 * 404s. No production account, database or external call.
 *
 * Two claims are under test.
 *
 * GEOMETRY. The instrument row must start at the far-left edge of the
 * workspace and the market rail must begin underneath it, with no dead
 * rectangle between the two. That is measured, not eyeballed: the row's
 * left edge against the terminal's own content box, and the rail's top
 * against the row's bottom.
 *
 * INSTANT. Opening the chooser must be a state flip — no request, no
 * spinner, no timer, no frame. So every API call the page makes is counted
 * and compared across an idle window, an open-but-untouched window and a
 * typing window; a raw count would charge the page's own ticker polling to
 * the search, which is why the three windows exist.
 *
 *   node scripts/qa-futures-market-search.cjs [--dist path] [--port N] [--out dir]
 *
 * QA_GEOMETRY_ONLY=1 measures and screenshots without driving the chooser
 * or asserting anything — that is how the "before" half of the comparison
 * is taken against a build that does not have this work in it.
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
const LABEL = arg('--label', '');
const GEOMETRY_ONLY = process.env.QA_GEOMETRY_ONLY === '1';
const WIDTHS = (arg('--widths', '1920,1664,1440,1366,390')).split(',').map(Number);

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

/** The two entry points, and the field they both reach. */
const LIST_BTN = '.pair-markets-btn';
const CARET = '.pair-selector';
const INPUT = '.market-chooser-input';
const CHOOSER = '.futures-market-chooser';
/** The rail's own list, which must never carry a field of its own. */
const RAIL = '.reference-market-sidebar';

/**
 * Where the terminal's panels actually are.
 *
 * Read from the live layout rather than from the stylesheet, so a rule that
 * is written but overridden cannot pass this.
 */
const geometry = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const terminal = document.querySelector('.terminal');
  const style = terminal ? getComputedStyle(terminal) : null;
  const t = terminal ? terminal.getBoundingClientRect() : null;
  return {
    // The workspace's own content edges — the padding is the terminal's,
    // not a gap the instrument row is leaving.
    workspaceLeft: t ? Math.round(t.left + parseFloat(style.paddingLeft)) : null,
    workspaceTop: t ? Math.round(t.top + parseFloat(style.paddingTop)) : null,
    bar: box('.futures-ticker-bar'),
    pairName: box('.pair-name'),
    listButton: box('.pair-markets-btn'),
    rail: box('.reference-market-sidebar'),
    chart: box('.chart-area'),
    book: box('.orderbook-area'),
    ticket: box('.order-form-area'),
    chooser: box('.futures-market-chooser'),
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
});

/** What the chooser and the rail are showing. */
const state = (page) => page.evaluate(() => {
  const chooser = document.querySelector('.futures-market-chooser');
  const scope = chooser || document.querySelector('dialog[open]') || document;
  const rows = [...scope.querySelectorAll('.futures-pair-list [data-row]')].map(n => n.getAttribute('aria-label'));
  const railRows = [...document.querySelectorAll('.reference-market-sidebar .futures-pair-list [data-row]')]
    .map(n => n.getAttribute('aria-label'));
  // VISIBLE, not merely present. On mobile the list lives inside a
  // <dialog> that is rendered closed, so the field exists in the DOM from
  // first paint; `display:none` leaves it with no client rects, which is
  // what "the user cannot see it" actually means here.
  const input = document.querySelector('.market-chooser-input');
  return {
    open: !!input && input.getClientRects().length > 0,
    chooserPresent: !!chooser,
    // The rail must carry no field, ever — not hidden, not collapsed.
    railHasField: !!document.querySelector('.reference-market-sidebar .market-chooser-input'),
    railHasLegacyHead: !!document.querySelector('.reference-market-sidebar .pairs-head, .reference-market-sidebar .pairs-search'),
    railFirstChild: document.querySelector('.reference-market-sidebar')?.firstElementChild?.className ?? null,
    railRowCount: railRows.length,
    rows: rows.slice(0, 40),
    rowCount: rows.length,
    sortButtons: [...document.querySelectorAll('.pairs-col-headers .pch-sort')].map(b => b.textContent.trim()),
    pair: document.querySelector('.pair-name')?.textContent?.trim() ?? null,
  };
});

const shot = (page, name) => page.screenshot({
  path: path.join(OUT, `${LABEL ? `${LABEL}-` : ''}${name}.png`),
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = {};
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const width of WIDTHS) {
      const desktop = width >= 1025;
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 940 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const apiLog = [];
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
      view.rest = await state(page);
      view.geometry = await geometry(page);
      await shot(page, `${width}-rest`);

      if (GEOMETRY_ONLY) {
        view.pageErrors = pageErrors;
        await context.close();
        continue;
      }

      // ── the claim: opening and typing add no request of their own ──────
      // The page polls its ticker feed on a timer whatever the user does,
      // so a raw count over the search window would charge those polls to
      // the search. Instead: watch an IDLE window first, then do the search
      // in a window of the same length, and require that the search window
      // contains no endpoint the idle one did not.
      // THE BASELINE IS EVERYTHING THE UNTOUCHED PAGE DID, not a short
      // window of it.
      //
      // A fixed window has to be longer than the slowest thing the page
      // polls before anything can be attributed to an interaction, and this
      // page's slowest are minutes apart — at three seconds the chart's
      // candle refresh fell into the open window, at ten the market
      // snapshot and the access check fell into the typing window, and both
      // times the search was blamed for traffic that was never its own.
      //
      // So the claim is made structurally instead, and it is a stronger one:
      // search may not reach an endpoint THE PAGE HAS NEVER REACHED. Every
      // request from first paint through a ten-second idle sit is the
      // baseline; anything new after that is search's, and there must be
      // none. The per-second volume is measured alongside it, so an extra
      // call to an endpoint already in the baseline cannot hide either.
      const idleStart = apiLog.length;
      const idleFrom = Date.now();
      await page.waitForTimeout(10000);
      const tally = (list) => list.reduce((acc, p) => { acc[p] = (acc[p] || 0) + 1; return acc; }, {});
      view.idleTally = tally(apiLog.slice(idleStart));
      view.idleWindowCalls = apiLog.length - idleStart;
      view.idleCallsPerSecond = Number((view.idleWindowCalls / ((Date.now() - idleFrom) / 1000)).toFixed(2));
      const baseline = new Set(apiLog);
      view.baselineEndpoints = [...baseline];

      // ── entry point 1: the list glyph ──────────────────────────────────
      const openStart = apiLog.length;
      const openFrom = Date.now();
      const clickedAt = Date.now();
      await page.locator(LIST_BTN).first().click();
      await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
      view.msToUsableViaListButton = Date.now() - clickedAt;
      view.focusedViaListButton = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT);
      // A full second, not 250ms: over a quarter-second window a single
      // background poll reads as four requests per second and the rate
      // says nothing at all.
      await page.waitForTimeout(1000);
      view.openWindowCalls = apiLog.length - openStart;
      view.openWindowEndpointList = apiLog.slice(openStart);
      view.openCallsPerSecond = Number((view.openWindowCalls / ((Date.now() - openFrom) / 1000)).toFixed(2));
      view.endpointsOpenAdded = [...new Set(apiLog.slice(openStart).filter(p => !baseline.has(p)))];

      view.open = await state(page);
      view.openGeometry = await geometry(page);
      await shot(page, `${width}-open`);

      // CONTROL: the chooser open and focused, untouched, for exactly as
      // long as the idle sit above. Same page, same timers, same duration —
      // so the two counts are directly comparable and the only difference
      // between them is that the chooser is on screen. This is the volume
      // claim; the one-second slice above is too short for a rate to mean
      // anything, because a single background poll landing inside it reads
      // as four requests a second.
      const controlStart = apiLog.length;
      const controlFrom = Date.now();
      await page.waitForTimeout(10000);
      view.controlWindowCalls = apiLog.length - controlStart;
      view.controlTally = tally(apiLog.slice(controlStart));
      view.controlSeconds = Number(((Date.now() - controlFrom) / 1000).toFixed(1));
      view.endpointsControlAdded = [...new Set(apiLog.slice(controlStart).filter(p => !baseline.has(p)))];

      // ── local filtering, four spellings of the same instrument ─────────
      const typeStart = apiLog.length;
      const typeFrom = Date.now();
      view.queries = {};
      for (const query of ['btc', 'BTC', 'BTCUSDT', 'BTC/USDT', 'eth']) {
        await page.locator(INPUT).first().fill('');
        await page.locator(INPUT).first().type(query, { delay: 15 });
        await page.waitForTimeout(140);
        const snap = await state(page);
        view.queries[query] = { rowCount: snap.rowCount, rows: snap.rows.slice(0, 6) };
      }
      await page.locator(INPUT).first().fill('');
      await page.waitForTimeout(140);
      const typeWindow = apiLog.slice(typeStart);
      view.typeWindowCalls = typeWindow.length;
      view.typeSeconds = Number(((Date.now() - typeFrom) / 1000).toFixed(1));
      view.typeTally = tally(typeWindow);
      view.typeCallsPerSecond = Number((view.typeWindowCalls / view.typeSeconds).toFixed(2));
      view.endpointsTypingAdded = [...new Set(typeWindow.filter(p => !baseline.has(p)))];

      // ── Escape closes; the OTHER entry point reopens it ────────────────
      await page.keyboard.press('Escape');
      await page.waitForTimeout(140);
      view.afterEscape = await state(page);

      if (desktop) {
        const caretAt = Date.now();
        await page.locator(CARET).first().click();
        await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
        view.msToUsableViaCaret = Date.now() - caretAt;
        view.focusedViaCaret = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT);

        // ── a click outside closes it ───────────────────────────────────
        await page.mouse.click(Math.round(width * 0.6), 600);
        await page.waitForTimeout(140);
        view.afterOutsideClick = await state(page);

        // ── the control that opened it can also close it ─────────────────
        await page.locator(LIST_BTN).first().click();
        await page.waitForTimeout(120);
        view.toggledOpen = (await state(page)).open;
        await page.locator(LIST_BTN).first().click();
        await page.waitForTimeout(120);
        view.toggledClosed = (await state(page)).open;

        // ── hammer it: twenty open/close pairs must not leave it stuck ───
        for (let i = 0; i < 20; i += 1) {
          await page.locator(i % 2 === 0 ? LIST_BTN : CARET).first().click();
          await page.waitForTimeout(12);
          await page.locator(i % 2 === 0 ? CARET : LIST_BTN).first().click();
          await page.waitForTimeout(12);
        }
        await page.waitForTimeout(250);
        view.afterHammering = (await state(page)).open;
        await page.locator(LIST_BTN).first().click();
        await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
        view.stillOpensAfterHammering = true;
      } else {
        // Mobile: the existing dialog, with the field focused on open.
        await page.locator(LIST_BTN).first().click();
        await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 2000 });
        view.focusedViaCaret = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT);
        view.msToUsableViaCaret = view.msToUsableViaListButton;
      }

      // ── picking a contract selects it and dismisses the chooser ────────
      await page.locator(INPUT).first().fill('ETH');
      await page.waitForTimeout(160);
      const scope = desktop ? `${CHOOSER} .futures-pair-list [data-row]` : '.futures-pair-list [data-row]';
      view.selectionTarget = await page.locator(scope).first().getAttribute('aria-label');
      await page.locator(scope).first().click();
      await page.waitForTimeout(500);
      const picked = await state(page);
      view.selectedPair = picked.pair;
      view.closedOnSelect = !picked.open;

      // ── the rail's own sorting is untouched ────────────────────────────
      const railSort = page.locator(`${RAIL} .pairs-col-headers .pch-sort`).first();
      if (await railSort.isVisible().catch(() => false)) {
        const before = (await state(page)).railRowCount;
        await railSort.click();
        await page.waitForTimeout(250);
        view.sortPressed = await railSort.getAttribute('aria-pressed');
        view.railRowsAfterSort = (await state(page)).railRowCount;
        view.railRowsBeforeSort = before;
        await railSort.click(); await railSort.click();
      }

      view.settled = await state(page);
      view.settledGeometry = await geometry(page);
      view.pageErrors = pageErrors;
      await context.close();

      // ── assertions ────────────────────────────────────────────────────
      const tag = `${width}`;
      const g = view.geometry;

      // 1. The rail carries no field, and starts at its own first row.
      assert.equal(view.rest.railHasField, false, `${tag}: the rail still renders a search field`);
      assert.equal(view.rest.railHasLegacyHead, false, `${tag}: the rail still renders the old search/header row`);
      assert.equal(view.rest.open, false, `${tag}: the chooser was open before anything was clicked`);

      if (desktop) {
        // 2. The instrument row starts at the far-left workspace edge.
        assert.ok(Math.abs(g.bar.left - g.workspaceLeft) <= 2,
          `${tag}: the instrument row starts at ${g.bar.left}, workspace edge is ${g.workspaceLeft}`);
        assert.ok(g.bar.left <= g.rail.left + 1,
          `${tag}: the instrument row (${g.bar.left}) still starts right of the rail (${g.rail.left})`);
        assert.ok(g.bar.top <= g.workspaceTop + 2,
          `${tag}: the instrument row starts ${g.bar.top - g.workspaceTop}px below the workspace top`);
        // 3. The rail begins UNDER it, with no dead rectangle between them.
        assert.ok(g.rail.top >= g.bar.bottom - 1,
          `${tag}: the rail (top ${g.rail.top}) overlaps the instrument row (bottom ${g.bar.bottom})`);
        assert.ok(g.rail.top - g.bar.bottom <= 14,
          `${tag}: ${g.rail.top - g.bar.bottom}px of empty space between the instrument row and the rail`);
        // 4. Chart, book and ticket keep their geometry when it opens.
        for (const key of ['chart', 'book', 'ticket']) {
          assert.equal(view.openGeometry[key].width, g[key].width, `${tag}: ${key} width changed when the chooser opened`);
          assert.equal(view.openGeometry[key].left, g[key].left, `${tag}: ${key} moved when the chooser opened`);
          assert.equal(view.openGeometry[key].top, g[key].top, `${tag}: ${key} was pushed down when the chooser opened`);
        }
        assert.equal(view.openGeometry.rail.top, g.rail.top, `${tag}: the rail moved when the chooser opened`);
        // 5. The chooser hangs under the pair selector, at the left edge.
        assert.ok(view.openGeometry.chooser, `${tag}: the chooser did not render`);
        assert.ok(view.openGeometry.chooser.top >= g.bar.bottom - 1,
          `${tag}: the chooser overlaps the instrument row`);
        assert.ok(Math.abs(view.openGeometry.chooser.left - g.workspaceLeft) <= 2,
          `${tag}: the chooser is not anchored at the workspace's left edge`);
        // 6. Both entry points reach it, and both are instant.
        assert.equal(view.focusedViaCaret, true, `${tag}: the caret did not focus the field`);
        assert.ok(view.msToUsableViaCaret < 400, `${tag}: caret took ${view.msToUsableViaCaret}ms`);
        assert.equal(view.afterOutsideClick.open, false, `${tag}: a click outside did not close the chooser`);
        assert.equal(view.toggledOpen, true, `${tag}: the list button did not reopen the chooser`);
        assert.equal(view.toggledClosed, false, `${tag}: the list button could not close what it opened`);
        assert.equal(view.afterHammering, false, `${tag}: twenty open/close pairs left the chooser stuck`);
        assert.equal(view.stillOpensAfterHammering, true, `${tag}: it would not open again after hammering`);
      }

      assert.equal(g.overflowX, 0, `${tag}: horizontal overflow at rest`);
      assert.equal(view.openGeometry.overflowX, 0, `${tag}: horizontal overflow with the chooser open`);

      // 7. Instant, and free.
      assert.deepEqual(view.endpointsOpenAdded, [],
        `${tag}: OPENING reached endpoints the untouched page never did: ${view.endpointsOpenAdded.join(', ')}`);
      assert.deepEqual(view.endpointsTypingAdded, [],
        `${tag}: TYPING reached endpoints the untouched page never did: ${view.endpointsTypingAdded.join(', ')}`);
      assert.deepEqual(view.endpointsControlAdded, [],
        `${tag}: the chooser sitting open reached endpoints the untouched page never did: ${view.endpointsControlAdded.join(', ')}`);

      // ...and no extra VOLUME on the endpoints the market list can
      // actually reach. Named rather than aggregated, deliberately.
      //
      // The aggregate is not a usable signal in this sandbox: it is
      // dominated by `/market/futures/orderbook/:symbol`, the depth REST
      // fallback, which polls at 1Hz here because the venue WebSocket is
      // unreachable from this network and never will be. Its count drifts
      // by several per ten-second window whatever the page is doing, and
      // the order book is not what search touches.
      //
      // What search COULD touch is exactly two endpoints — the asset
      // artwork the rows draw and the reference ticker feed they read — and
      // if the chooser were fetching on open, on keystroke, or subscribing
      // a second time, it would show up here and nowhere else. Ten seconds
      // with it open against ten seconds without it, per endpoint.
      const LIST_ENDPOINTS = ['/api/v1/market/assets/icons', '/api/v1/market/live'];
      for (const endpoint of LIST_ENDPOINTS) {
        const idle = view.idleTally[endpoint] || 0;
        const open = view.controlTally[endpoint] || 0;
        assert.ok(open <= idle,
          `${tag}: ${endpoint} was called ${open} times in ${view.controlSeconds}s with the chooser open, ${idle} times idle`);
      }
      // Typing: a refetch per keystroke would put at least one request per
      // character on one of those two endpoints, and there are 25
      // characters across the five queries. The typing window is shorter
      // than the idle one, so the idle count is already a generous ceiling.
      for (const endpoint of LIST_ENDPOINTS) {
        const idle = view.idleTally[endpoint] || 0;
        const typed = view.typeTally[endpoint] || 0;
        assert.ok(typed <= idle,
          `${tag}: ${endpoint} was called ${typed} times across ${view.typeSeconds}s of typing, ${idle} times in ${view.controlSeconds}s idle`);
      }
      assert.ok(view.msToUsableViaListButton < 400, `${tag}: field took ${view.msToUsableViaListButton}ms to appear`);
      assert.equal(view.focusedViaListButton, true, `${tag}: the field did not take focus on open`);

      // 8. Filtering is local, and every spelling finds the instrument.
      for (const query of ['btc', 'BTC', 'BTCUSDT', 'BTC/USDT']) {
        const hit = view.queries[query];
        assert.ok(hit.rowCount > 0 && hit.rows.every(r => r.includes('BTC')),
          `${tag}: "${query}" returned ${JSON.stringify(hit.rows)}`);
      }
      assert.ok(view.queries.eth.rowCount > 0 && view.queries.eth.rows.every(r => r.includes('ETH')),
        `${tag}: "eth" returned ${JSON.stringify(view.queries.eth.rows)}`);
      // Against the UNFILTERED list in the same scope. The rail's own count
      // is not the comparison: below 1025px there is no rail, so it is zero
      // and the check would pass or fail for the wrong reason.
      assert.ok(view.queries.BTC.rowCount < view.open.rowCount,
        `${tag}: filtering did not narrow the list (${view.queries.BTC.rowCount} of ${view.open.rowCount})`);

      // 9. Escape, selection, and the rail's own controls.
      assert.equal(view.afterEscape.open, false, `${tag}: Escape did not close the chooser`);
      assert.equal(view.closedOnSelect, true, `${tag}: picking a contract left the chooser open`);
      assert.equal(view.selectedPair, view.selectionTarget,
        `${tag}: picking a filtered row selected ${view.selectedPair}, expected ${view.selectionTarget}`);
      if (view.sortPressed !== undefined) {
        assert.equal(view.sortPressed, 'true', `${tag}: the rail's sort control did not report itself pressed`);
      }
      assert.equal(view.pageErrors.length, 0, `${tag}: page errors ${view.pageErrors.join('; ')}`);
    }

    const summary = { status: GEOMETRY_ONLY ? 'MEASURED' : 'PASS', label: LABEL || null, report };
    fs.writeFileSync(path.join(OUT, `${LABEL ? `${LABEL}-` : ''}metrics.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({
      status: summary.status,
      perWidth: Object.fromEntries(Object.entries(report).map(([w, v]) => [w, {
        barLeft: v.geometry?.bar?.left ?? null,
        workspaceLeft: v.geometry?.workspaceLeft ?? null,
        railTop: v.geometry?.rail?.top ?? null,
        barBottom: v.geometry?.bar?.bottom ?? null,
        gapAboveRail: v.geometry?.rail && v.geometry?.bar ? v.geometry.rail.top - v.geometry.bar.bottom : null,
        railHasField: v.rest?.railHasField ?? null,
        msToUsableViaListButton: v.msToUsableViaListButton ?? null,
        msToUsableViaCaret: v.msToUsableViaCaret ?? null,
        endpointsOpenAdded: v.endpointsOpenAdded ?? null,
        endpointsTypingAdded: v.endpointsTypingAdded ?? null,
        idleWindowCalls: v.idleWindowCalls ?? null,
        controlWindowCalls: v.controlWindowCalls ?? null,
        typeWindowCalls: v.typeWindowCalls ?? null,
        typeSeconds: v.typeSeconds ?? null,
        listEndpointsIdle: v.idleTally ? {
          icons: v.idleTally['/api/v1/market/assets/icons'] || 0,
          live: v.idleTally['/api/v1/market/live'] || 0,
        } : null,
        listEndpointsChooserOpen: v.controlTally ? {
          icons: v.controlTally['/api/v1/market/assets/icons'] || 0,
          live: v.controlTally['/api/v1/market/live'] || 0,
        } : null,
        listEndpointsWhileTyping: v.typeTally ? {
          icons: v.typeTally['/api/v1/market/assets/icons'] || 0,
          live: v.typeTally['/api/v1/market/live'] || 0,
        } : null,
        afterHammering: v.afterHammering ?? null,
        pageErrors: v.pageErrors?.length ?? null,
      }])),
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(OUT, `${LABEL ? `${LABEL}-` : ''}metrics.json`),
      JSON.stringify({ status: 'FAIL', error: String(error && error.message || error), report }, null, 2));
    console.error('FAIL', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
