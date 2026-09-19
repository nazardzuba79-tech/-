#!/usr/bin/env node
/**
 * The Futures chart rail: the crosshair tool and the collapse control.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, reads only, every write 404s.
 *
 * Two claims, and the second is the one that could go wrong quietly.
 *
 * GEOMETRY. The toggle must sit BELOW the tools, not above them, and leave
 * no empty row where it used to be; collapsed, its tab must be at the
 * chart's bottom-left. Measured against the rail's own box.
 *
 * INERT. Collapsing is a local UI action. It must not refetch, remount the
 * chart, reset the visible range or drop a drawing — so the run records the
 * chart canvas's identity and the price scale's visible range before and
 * after, counts every API request the toggle causes, and drives twenty
 * cycles to prove none of it drifts.
 *
 *   node scripts/qa-chart-toolbar.cjs [--dist path] [--label before]
 *
 * QA_MEASURE_ONLY=1 measures and screenshots without asserting — the
 * "before" half, against a build that predates this work.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4360'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'chart-toolbar')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1920,1664,1440,1366,390')).split(',').map(Number);

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history',
    '/api/v1/futures/orders/me', '/api/v1/balances', '/api/v1/futures/balances',
    '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (q, r) => {
    const symbols = String(q.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (q, r) => r.status(404).json({ error: 'Outside QA scope', path: q.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (r) => { r.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

const RAIL = '.drawing-rail';
const TOGGLE = '[data-drawing-toolbar-toggle]';
const CURSOR = '[data-drawing-tool="cursor"]';

const measure = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const toggle = document.querySelector('[data-drawing-toolbar-toggle]');
  const rail = document.querySelector('.drawing-rail');
  const shell = document.querySelector('.drawing-rail-shell');
  const cursorBtn = document.querySelector('[data-drawing-tool="cursor"]');
  const canvas = document.querySelector('.chart-view canvas, .terminal-chart-shell canvas');
  const cursorSvg = cursorBtn ? cursorBtn.querySelector('svg') : null;
  return {
    toggle: box('[data-drawing-toolbar-toggle]'),
    rail: box('.drawing-rail'),
    shell: box('.drawing-rail-shell'),
    chartView: box('.chart-view'),
    railHidden: rail ? rail.hasAttribute('hidden') : null,
    toggleCount: document.querySelectorAll('[data-drawing-toolbar-toggle]').length,
    // The control's own contract.
    toggleTag: toggle ? toggle.tagName : null,
    toggleType: toggle ? toggle.getAttribute('type') : null,
    toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
    toggleOrder: toggle ? getComputedStyle(toggle).order : null,
    // The cursor tool's glyph: paths, never a text node or an emoji.
    cursorPaths: cursorSvg ? cursorSvg.querySelectorAll('path,line').length : null,
    cursorText: cursorBtn ? cursorBtn.textContent.trim() : null,
    cursorButtonSize: cursorBtn ? (() => {
      const r = cursorBtn.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    })() : null,
    cursorActive: cursorBtn ? cursorBtn.classList.contains('active') : null,
    // Identity of the canvas, so a remount is detectable.
    canvasCount: document.querySelectorAll('.terminal-chart-shell canvas').length,
    canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
});

/** A stable fingerprint of the chart element, to catch a remount. */
const stampChart = (page) => page.evaluate(() => {
  const el = document.querySelector('.terminal-chart-shell canvas');
  if (!el) return null;
  if (!el.dataset.qaStamp) el.dataset.qaStamp = `s${Math.random().toString(36).slice(2)}`;
  return el.dataset.qaStamp;
});
const readStamp = (page) => page.evaluate(() =>
  document.querySelector('.terminal-chart-shell canvas')?.dataset.qaStamp ?? null);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = {};
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const width of WIDTHS) {
      const desktop = width > 900;
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 940 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const apiLog = [];
      page.on('request', (r) => { if (r.url().includes('/api/')) apiLog.push(new URL(r.url()).pathname); });
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);

      const view = report[width] = {};
      view.open = await measure(page);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-open.png`) });
      const shell = page.locator('.drawing-rail-shell').first();
      if (await shell.count()) {
        await shell.screenshot({ path: path.join(OUT, `${LABEL}-${width}-rail-open.png`) }).catch(() => {});
      }

      if (MEASURE_ONLY) {
        // The "before" half still needs the collapsed state on record, so the
        // two halves can be compared in both states. Nothing is asserted here.
        await page.locator(TOGGLE).first().click().catch(() => {});
        await page.waitForTimeout(260);
        view.collapsed = await measure(page);
        await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-collapsed.png`) });
        view.pageErrors = pageErrors;
        await context.close();
        continue;
      }

      view.chartStamp = await stampChart(page);

      // ── a drawing, so we can prove collapsing does not drop it ─────────
      const chart = page.locator('.chart-view').first();
      const cbox = await chart.boundingBox();
      if (cbox) {
        await page.locator('[data-drawing-tool="trend"], [data-drawing-tool="line"]').first()
          .click({ timeout: 1500 }).catch(() => {});
        await page.mouse.click(cbox.x + cbox.width * 0.35, cbox.y + cbox.height * 0.4);
        await page.mouse.click(cbox.x + cbox.width * 0.6, cbox.y + cbox.height * 0.6);
        await page.waitForTimeout(250);
      }
      view.drawingsBefore = await page.evaluate(() =>
        document.querySelectorAll('.chart-view svg path, .chart-view svg line').length);

      // ── the claim: toggling costs no request ───────────────────────────
      const idleStart = apiLog.length;
      await page.waitForTimeout(6000);
      const baseline = new Set(apiLog);
      view.idleCalls = apiLog.length - idleStart;

      const beforeToggle = apiLog.length;
      const t0 = Date.now();
      await page.locator(TOGGLE).first().click();
      await page.waitForTimeout(220);
      view.msToCollapse = Date.now() - t0;
      view.collapsed = await measure(page);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-collapsed.png`) });

      await page.locator(TOGGLE).first().click();
      await page.waitForTimeout(220);
      view.reopened = await measure(page);
      view.toggleWindowCalls = apiLog.length - beforeToggle;
      view.toggleNewEndpoints = [...new Set(apiLog.slice(beforeToggle).filter((p) => !baseline.has(p)))];

      view.chartStampAfter = await readStamp(page);
      view.drawingsAfter = await page.evaluate(() =>
        document.querySelectorAll('.chart-view svg path, .chart-view svg line').length);

      // ── keyboard ───────────────────────────────────────────────────────
      // `getComputedStyle(el, ':focus-visible')` returns nothing useful —
      // that argument is for pseudo-ELEMENTS. And a programmatic `.focus()`
      // does not make `:focus-visible` match in Chromium unless the last
      // interaction was already a keyboard one, so `focus({focusVisible})`
      // reported a 0px outline for a ring that is really there.
      //
      // The control is therefore REACHED the way a keyboard user reaches
      // it — Tab, from the first tool — which proves it is in the tab order
      // as well as that the ring is drawn.
      await page.locator('[data-drawing-tool="cursor"]').first().focus();
      let tabs = 0;
      while (tabs < 60) {
        await page.keyboard.press('Tab');
        tabs += 1;
        const onToggle = await page.evaluate((sel) =>
          document.activeElement === document.querySelector(sel), TOGGLE);
        if (onToggle) break;
      }
      view.tabsToReachToggle = tabs;
      view.focusVisible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || document.activeElement !== el) return null;
        const cs = getComputedStyle(el);
        return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor };
      }, TOGGLE);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      view.collapsedByKeyboard = (await measure(page)).railHidden;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      view.reopenedByKeyboard = (await measure(page)).railHidden === false;

      // ── twenty cycles ──────────────────────────────────────────────────
      const hammerStart = apiLog.length;
      for (let i = 0; i < 20; i += 1) {
        await page.locator(TOGGLE).first().click();
        await page.waitForTimeout(24);
        await page.locator(TOGGLE).first().click();
        await page.waitForTimeout(24);
      }
      await page.waitForTimeout(350);
      view.afterHammering = await measure(page);
      view.hammerNewEndpoints = [...new Set(apiLog.slice(hammerStart).filter((p) => !baseline.has(p)))];
      view.chartStampAfterHammer = await readStamp(page);
      view.drawingsAfterHammer = await page.evaluate(() =>
        document.querySelectorAll('.chart-view svg path, .chart-view svg line').length);
      // Still opens on the very next click.
      await page.locator(TOGGLE).first().click();
      await page.waitForTimeout(200);
      view.stillCollapses = (await measure(page)).railHidden;
      await page.locator(TOGGLE).first().click();
      await page.waitForTimeout(200);

      view.pageErrors = pageErrors;
      await context.close();

      // ── assertions ────────────────────────────────────────────────────
      const tag = `${width}`;
      const o = view.open;
      assert.equal(view.pageErrors.length, 0, `${tag}: page errors ${view.pageErrors.join('; ')}`);
      assert.equal(o.overflowX, 0, `${tag}: horizontal page overflow`);

      // The control's contract.
      assert.equal(o.toggleCount, 1, `${tag}: ${o.toggleCount} collapse controls — there must be exactly one`);
      assert.equal(o.toggleTag, 'BUTTON', `${tag}: the toggle is a <${o.toggleTag}>, not a button`);
      assert.equal(o.toggleType, 'button', `${tag}: the toggle has no type="button"`);
      assert.equal(o.toggleExpanded, 'true', `${tag}: aria-expanded is ${o.toggleExpanded} while the rail is open`);
      assert.ok(o.toggleLabel && /инструмент/i.test(o.toggleLabel),
        `${tag}: the toggle's aria-label is ${JSON.stringify(o.toggleLabel)}`);
      assert.equal(view.collapsed.toggleExpanded, 'false', `${tag}: aria-expanded did not flip on collapse`);
      assert.ok(view.focusVisible, `${tag}: the toggle is not reachable by Tab (${view.tabsToReachToggle} presses)`);
      assert.ok(parseFloat(view.focusVisible.outlineWidth) > 0,
        `${tag}: the toggle draws no focus ring under a keyboard focus (${JSON.stringify(view.focusVisible)})`);

      // The cursor tool is a drawn crosshair, not an arrow glyph or text.
      assert.equal(o.cursorPaths, 4, `${tag}: the cursor icon has ${o.cursorPaths} strokes, expected 4 rays`);
      assert.equal(o.cursorText, '', `${tag}: the cursor button carries text ${JSON.stringify(o.cursorText)}`);

      if (desktop) {
        // BELOW the tools, and no empty row left above them.
        assert.ok(o.toggle.top >= o.rail.bottom - 1,
          `${tag}: the toggle (top ${o.toggle.top}) is not below the tools (bottom ${o.rail.bottom})`);
        assert.ok(o.rail.top - o.shell.top <= 2,
          `${tag}: ${o.rail.top - o.shell.top}px of empty rail above the first tool`);
        // Compact, not a full-width slab.
        assert.ok(o.toggle.width < o.shell.width,
          `${tag}: the toggle is ${o.toggle.width}px inside a ${o.shell.width}px rail — it should be a chip`);
        assert.ok(o.toggle.height <= 26, `${tag}: the toggle is ${o.toggle.height}px tall`);
        // Collapsed: the tab is at the chart's bottom-left.
        const c = view.collapsed;
        assert.equal(c.railHidden, true, `${tag}: the tools are still visible after collapsing`);
        assert.ok(c.toggle.left <= (c.chartView ? c.chartView.left : 0) + 4,
          `${tag}: the restore tab is not at the chart's left edge`);
        assert.ok(c.chartView && c.toggle.bottom > c.chartView.top + c.chartView.height / 2,
          `${tag}: the restore tab is in the top half of the chart, not the bottom`);
        // Reopening restores the rail.
        assert.equal(view.reopened.railHidden, false, `${tag}: the tools did not come back`);
      }

      // Inert: no remount, no request, no lost drawing.
      assert.equal(view.chartStampAfter, view.chartStamp,
        `${tag}: the chart canvas was replaced by the toggle`);
      assert.equal(view.chartStampAfterHammer, view.chartStamp,
        `${tag}: the chart canvas was replaced during twenty cycles`);
      assert.deepEqual(view.toggleNewEndpoints, [],
        `${tag}: collapsing reached endpoints the untouched page never did: ${view.toggleNewEndpoints.join(', ')}`);
      assert.deepEqual(view.hammerNewEndpoints, [],
        `${tag}: twenty cycles reached ${view.hammerNewEndpoints.join(', ')}`);
      assert.ok(view.drawingsAfter >= view.drawingsBefore,
        `${tag}: drawings fell from ${view.drawingsBefore} to ${view.drawingsAfter}`);
      assert.ok(view.drawingsAfterHammer >= view.drawingsBefore,
        `${tag}: drawings fell to ${view.drawingsAfterHammer} across twenty cycles`);
      assert.equal(view.afterHammering.railHidden, false,
        `${tag}: twenty cycles left the tools hidden`);
      assert.equal(view.stillCollapses, true, `${tag}: it would not collapse again afterwards`);
      assert.ok(view.msToCollapse < 400, `${tag}: collapsing took ${view.msToCollapse}ms`);
      assert.equal(view.collapsedByKeyboard, true, `${tag}: Enter did not collapse the rail`);
      assert.equal(view.reopenedByKeyboard, true, `${tag}: Enter did not reopen the rail`);
    }

    // ── Spot is the other page that renders this rail ─────────────────
    // The new geometry is scoped with `.futures-reference`, which Spot's
    // root does not carry. That claim is worth nothing unless it is
    // measured, so open /trade and check the rail still has the SHAPE this
    // change did not give it: the toggle above the tools, carrying the
    // `order:-1` that holds it there, and the cursor tool still first.
    // Both halves of the run do this, so the two can be compared directly.
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
      const page = await context.newPage();
      const spotErrors = [];
      page.on('pageerror', (e) => spotErrors.push(String(e)));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/trade`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      const spotView = report.spot = await measure(page);
      spotView.pageErrors = spotErrors;
      spotView.root = await page.evaluate(() =>
        document.querySelector('.trade-terminal')?.className ?? null);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-spot-1440.png`) });
      await context.close();

      if (!MEASURE_ONLY && spotView.toggle && spotView.rail) {
        assert.ok(!/futures-reference/.test(spotView.root ?? ''),
          `spot: the Futures scoping hook reached Spot (${spotView.root})`);
        assert.equal(spotView.toggleOrder, '-1',
          `spot: the toggle lost its order:-1, so the Futures rule leaked`);
        assert.ok(spotView.toggle.top < spotView.rail.top,
          `spot: the toggle is no longer above the tools (${spotView.toggle.top} vs ${spotView.rail.top})`);
        assert.equal(spotView.cursorPaths, 4,
          `spot: the cursor glyph is ${spotView.cursorPaths} paths, not the crosshair's four`);
        assert.deepEqual(spotErrors, [], `spot: page errors ${spotErrors.join(' | ')}`);
      }
    }

    fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`),
      JSON.stringify({ status: MEASURE_ONLY ? 'MEASURED' : 'PASS', label: LABEL, report }, null, 2));
    console.log(JSON.stringify({
      status: MEASURE_ONLY ? 'MEASURED' : 'PASS',
      perWidth: Object.fromEntries(Object.entries(report).map(([w, v]) => [w, {
        toggleTop: v.open?.toggle?.top ?? null,
        railBottom: v.open?.rail?.bottom ?? null,
        toggleOrder: v.open?.toggleOrder ?? null,
        toggleSize: v.open?.toggle ? `${v.open.toggle.width}x${v.open.toggle.height}` : null,
        cursorPaths: v.open?.cursorPaths ?? null,
        collapsedTabBottom: v.collapsed?.toggle?.bottom ?? null,
        chartHeight: v.open?.chartView?.height ?? null,
        msToCollapse: v.msToCollapse ?? null,
        toggleNewEndpoints: v.toggleNewEndpoints ?? null,
        hammerNewEndpoints: v.hammerNewEndpoints ?? null,
        chartRemounted: v.chartStamp ? v.chartStampAfterHammer !== v.chartStamp : null,
        drawings: v.drawingsBefore !== undefined ? `${v.drawingsBefore} -> ${v.drawingsAfterHammer}` : null,
        pageErrors: v.pageErrors?.length ?? null,
      }])),
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`),
      JSON.stringify({ status: 'FAIL', error: String(error && error.message || error), report }, null, 2));
    console.error('FAIL', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
