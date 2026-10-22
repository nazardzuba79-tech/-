#!/usr/bin/env node
/**
 * Chart drawings stay on their prices when the chart rescales.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture candles, reads only, every write 404s.
 *
 * Drawings are stored as (time, price) and painted through the chart's own
 * projection. The owner saw the ruler drift off its candles: the price scale
 * had moved (autoscale after the 5-second refresh brought a higher high, or
 * the axis was dragged or reset), and the overlay was still painted with the old scale.
 *
 * The check is an invariant, not a pixel target: after the scale changes, the
 * ruler on screen must already be where a fresh paint of the overlay puts it.
 * A fresh paint is forced by a harmless UI state change (selecting
 * the ruler, deselecting it); a ruler that moves on that paint was stale.
 *
 *   node scripts/qa-chart-ruler-sync.cjs [--dist path] [--label after]
 *
 * QA_MEASURE_ONLY=1 records the drift without asserting (the "before" run).
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4371'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output', 'chart-ruler-sync')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1920,1440,1366')).split(',').map(Number);
const TOLERANCE = 1.5;
const SCENARIOS = ['pollSpike', 'axisDrag', 'axisReset', 'pollCalm'];

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const HOUR = 3600_000;
const state = { spike: false };

/** Three hundred hourly candles near 100; with `spike` the last three reach 260. */
function candles(symbol) {
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  const list = [];
  let price = 100;
  for (let i = 299; i >= 0; i--) {
    const t = end - i * HOUR;
    const open = price;
    price = 100 + 6 * Math.sin(i / 9) + 3 * Math.cos(i / 4);
    const close = price;
    let high = Math.max(open, close) + 0.8, low = Math.min(open, close) - 0.8;
    if (state.spike && i < 3) high = 260;
    list.push([String(t), open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), '1250.5']);
  }
  return { retCode: 0, result: { category: 'linear', symbol, list: list.reverse() } };
}

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/__qa/spike', (_q, r) => { state.spike = true; r.json({ spike: true }); });
  app.get('/__qa/calm', (_q, r) => { state.spike = false; r.json({ spike: false }); });
  app.get('/api/v1/market/futures/candles/:pair', (q, r) => r.json(candles(String(q.params.pair).replace('-', ''))));
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history',
    '/api/v1/futures/orders/me', '/api/v1/balances', '/api/v1/futures/balances',
    '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
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

/** The ruler's measured area on screen: its largest filled shape (the label card is a rect, not counted). */
const rulerBox = (page) => page.evaluate(() => {
  const group = document.querySelector('g[data-drawing-kind="ruler"]');
  if (!group) return null;
  let best = null;
  for (const rect of group.querySelectorAll('polygon, path')) {
    const fill = rect.getAttribute('fill');
    if (!fill || fill === 'none' || fill === 'transparent') continue;
    const r = rect.getBoundingClientRect();
    if (!best || r.width * r.height > best.width * best.height) best = r;
  }
  return best && { top: best.top, bottom: best.bottom, left: best.left, right: best.right, width: best.width, height: best.height };
});

const drift = (a, b) => (a && b ? Math.max(Math.abs(a.top - b.top), Math.abs(a.bottom - b.bottom), Math.abs(a.left - b.left), Math.abs(a.right - b.right)) : null);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = { label: LABEL, dist: DIST, widths: {} };
  let browser, failed = false;
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    for (const width of WIDTHS) {
      state.spike = false;
      const context = await browser.newContext({ viewport: { width, height: 940 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.locator('.terminal-chart-shell canvas').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(2500);

      const view = report.widths[width] = { pageErrors };
      const chart = page.locator('.chart-view').first();
      const box = await chart.boundingBox();

      // Draw a ruler by dragging, as a trader would.
      await page.locator('[data-drawing-tool="ruler"]').first().click();
      const from = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.62 };
      const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.38 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      view.drawn = await rulerBox(page);
      assert.ok(view.drawn && view.drawn.height > 20, `${width}: a ruler was drawn`);
      assert.equal(await page.locator('[data-drawing-selected]').count(), 1, `${width}: the new ruler is selected`);

      const axisX = box.x + box.width - 25;
      const axisY = box.y + box.height * 0.45;
      // A repaint of the overlay from the chart's current scales, forced by a
      // pure UI state change: deselect the ruler, or select it again.
      const repaint = async () => {
        const selected = await page.locator('[data-drawing-selected]').count();
        if (selected) await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.12);
        else {
          const shown = await rulerBox(page);
          await page.mouse.click(shown.left + shown.width / 2, shown.top + shown.height / 2);
        }
        await page.waitForTimeout(400);
        assert.notEqual(await page.locator('[data-drawing-selected]').count(), selected, `${width}: the repaint toggled the selection`);
        return rulerBox(page);
      };
      const scenario = async (name, act) => {
        const before = await rulerBox(page);
        await act();
        await page.waitForTimeout(500);
        const shown = await rulerBox(page);
        await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-${name}.png`) });
        const repainted = await repaint();
        view[name] = { scaleMoved: drift(before, repainted), drift: drift(shown, repainted), shown, repainted };
      };

      // A. The 5-second refresh brings a much higher high: autoscale widens
      // the range while nobody touches the chart.
      await scenario('pollSpike', async () => {
        await fetch(`http://127.0.0.1:${PORT}/__qa/spike`);
        await page.waitForTimeout(6500);
      });
      // B. The price axis is dragged: the chart rescales, React does not render.
      await scenario('axisDrag', async () => {
        await page.mouse.move(axisX, axisY);
        await page.mouse.down();
        await page.mouse.move(axisX, axisY + 150, { steps: 15 });
        await page.mouse.up();
      });
      // C. A double click on the axis restores autoscale.
      await scenario('axisReset', async () => {
        await page.mouse.dblclick(axisX, axisY);
      });
      // D. The high leaves the window on the next refresh: autoscale narrows.
      await scenario('pollCalm', async () => {
        await fetch(`http://127.0.0.1:${PORT}/__qa/calm`);
        await page.waitForTimeout(6500);
      });

      const fmt = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(1));
      console.log(`${LABEL} ${width}: ` + SCENARIOS
        .map((n) => `${n} drift ${fmt(view[n].drift)}px (scale moved ${fmt(view[n].scaleMoved)}px)`).join(', ') + `, errors ${pageErrors.length}`);
      if (!MEASURE_ONLY) {
        for (const n of SCENARIOS) {
          assert.ok(view[n].scaleMoved > 10, `${width}: ${n} really rescaled the chart (${view[n].scaleMoved}px)`);
          assert.ok(view[n].drift <= TOLERANCE, `${width}: the ruler follows ${n} (${view[n].drift}px stale)`);
        }
        assert.deepEqual(pageErrors, [], `${width}: no page errors`);
      }
      await context.close();
    }
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
    await browser?.close();
    server.close();
    if (failed) process.exitCode = 1;
  }
})();
