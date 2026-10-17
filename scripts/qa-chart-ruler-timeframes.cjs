#!/usr/bin/env node
/**
 * A ruler stays on its candles on every timeframe.
 *
 * LOCAL PRESENTATION QA ONLY. Synthetic fixture candles, reads only, every
 * write 404s.
 *
 * The owner (2026-10-17, AITH/USDT 4h) saw a ruler drawn on a shorter
 * timeframe painted on the plot's left edge, its label clamped there, while
 * the measurement (13 bars, 2d 4h, volume) was right. Its anchor times fall
 * between two 4h bars, and Lightweight Charts' logicalToCoordinate answers 0
 * for any fractional index.
 *
 * Three rulers are stored, all read on 4h:
 *   onBars    — both anchors on 4h bars (the reference);
 *   between   — the same span an hour later, both anchors between 4h bars;
 *   future    — from a 4h bar to a time 2h past a projected future bar.
 * `between` must be `onBars` moved right by a quarter bar, the same width;
 * `future` must end 3.5 bars past its last whole projected bar.
 *
 *   node scripts/qa-chart-ruler-timeframes.cjs [--dist path] [--label after]
 *
 * QA_MEASURE_ONLY=1 records the geometry without asserting (the "before" run).
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4372'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output', 'chart-ruler-timeframes')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const VIEWPORTS = (arg('--viewports', '1920x1080,1440x900,1366x768,390x844')).split(',').map(v => v.split('x').map(Number));
const TOLERANCE = 1.5;

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const STEP = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400 };
const H4 = STEP['4h'];
// Every series ends on the same 4h boundary, so the drawings' times are fixed for the whole run.
const END = Math.floor(Date.now() / 1000 / H4) * H4 - H4;

/** 120 bars of the asked interval ending at END, a calm wave near 100. */
function candles(symbol, interval, endTime) {
  const step = STEP[interval] ?? 3600;
  const list = [];
  // Backfill finds nothing older: the view stays on the 120 bars served first.
  if (!endTime) {
    for (let i = 119; i >= 0; i--) {
      const t = END - i * step;
      const open = 100 + 6 * Math.sin((t / step + 1) / 9);
      const close = 100 + 6 * Math.sin(t / step / 9);
      const high = Math.max(open, close) + 0.8, low = Math.min(open, close) - 0.8;
      list.push([String(t * 1000), open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), '1250.5']);
    }
  }
  return { retCode: 0, result: { category: 'linear', symbol, list: list.reverse() } };
}

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/api/v1/market/futures/candles/:pair', (q, r) =>
    r.json(candles(String(q.params.pair).replace('-', ''), String(q.query.interval), q.query.endTime)));
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

// Bars counted back from the newest 4h bar, so all three stay in the default view.
const bar = (n) => END - n * H4;
const RULERS = {
  onBars: [{ time: bar(30), price: 96 }, { time: bar(14), price: 104 }],
  between: [{ time: bar(30) + 3600, price: 96 }, { time: bar(14) + 3600, price: 104 }],
  future: [{ time: bar(8), price: 97 }, { time: END + 3 * H4 + 7200, price: 103 }],
};
const NAMES = Object.keys(RULERS);

/** Each ruler's measured area on screen, in stored order: its largest filled shape (the label card is a rect, not counted). */
const rulerBoxes = (page) => page.evaluate(() => [...document.querySelectorAll('g[data-drawing-kind="ruler"]')].map((group) => {
  let best = null;
  for (const shape of group.querySelectorAll('polygon, path')) {
    const fill = shape.getAttribute('fill');
    if (!fill || fill === 'none' || fill === 'transparent') continue;
    const r = shape.getBoundingClientRect();
    if (!best || r.width * r.height > best.width * best.height) best = r;
  }
  const label = group.querySelector('[data-ruler-label]')?.getBoundingClientRect();
  return { left: best?.left ?? null, right: best?.right ?? null, width: best?.width ?? null,
    label: label ? { left: label.left, right: label.right } : null,
    text: [...group.querySelectorAll('text')].map(t => t.textContent).join(' | ') };
}));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = { label: LABEL, dist: DIST, end: END, viewports: {} };
  let browser, failed = false;
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    for (const [width, height] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript((drawings) => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
        localStorage.setItem('voltex.drawings.futures.BTC/USDT', JSON.stringify({ version: 1, hidden: false, locked: false, drawings }));
      }, NAMES.map((name) => ({ kind: 'ruler', points: RULERS[name] })));
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      // A phone opens Futures on another tab; the chart has its own.
      if (width < 600) await page.locator('[aria-controls="mobile-futures-panel-chart"]').click();
      await page.locator('.terminal-chart-shell canvas').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
      const tf = page.locator('[data-cw-tf="4h"]:visible').first();
      if (await tf.count()) await tf.click();
      else {
        await page.locator('[data-cw-tf-strip] [aria-haspopup]:visible').first().click();
        await page.locator('[data-cw-tf-option="4h"]:visible').first().click();
      }
      await page.waitForTimeout(1500);
      // On 1h every anchor is on a bar and the check would pass vacuously.
      assert.match(await page.locator('.voltex-plot-title').first().textContent(), /· 4h/, `${width}: the chart is on 4h`);

      const plot = await page.locator('.chart-view').first().boundingBox();
      const boxes = await rulerBoxes(page);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}x${height}-4h.png`) });
      const shown = Object.fromEntries(NAMES.map((name, i) => [name, boxes[i] ?? null]));
      const view = report.viewports[`${width}x${height}`] = { plot, shown, pageErrors };
      const ref = shown.onBars, between = shown.between, future = shown.future;
      const spacing = ref?.width ? ref.width / 16 : null;
      view.spacing = spacing;
      view.betweenShift = between?.left != null && ref?.left != null ? between.left - ref.left : null;
      view.futureWidth = future?.width ?? null;
      const fmt = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(1));
      console.log(`${LABEL} ${width}x${height}: bar ${fmt(spacing)}px; between shift ${fmt(view.betweenShift)}px (want ${fmt(spacing && spacing / 4)}),`
        + ` width ${fmt(between?.width)} vs ${fmt(ref?.width)}; future width ${fmt(future?.width)} (want ${fmt(spacing && spacing * 11.5)}); errors ${pageErrors.length}`);
      if (!MEASURE_ONLY) {
        assert.equal(boxes.length, 3, `${width}: three rulers painted`);
        assert.ok(ref.width > 16, `${width}: the reference ruler spans its bars (${ref.width}px)`);
        assert.ok(ref.left > plot.x + 2, `${width}: the reference ruler is inside the plot`);
        assert.ok(Math.abs(between.width - ref.width) <= TOLERANCE, `${width}: a ruler between bars keeps its width (${between.width} vs ${ref.width})`);
        assert.ok(Math.abs(view.betweenShift - spacing / 4) <= TOLERANCE, `${width}: an hour later is a quarter 4h bar to the right (${view.betweenShift}px, want ${spacing / 4})`);
        assert.ok(Math.abs(future.width - spacing * 11.5) <= TOLERANCE, `${width}: a ruler into the future ends between projected bars (${future.width}px, want ${spacing * 11.5})`);
        assert.ok(between.label && between.label.right > between.left && between.label.left < between.right,
          `${width}: the label stays over its ruler`);
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
