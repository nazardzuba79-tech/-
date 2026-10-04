#!/usr/bin/env node
/**
 * The ruler's exact prices, its live end and its drag handles, in a browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture candles, reads only, every write 404s.
 *
 * Owner, 2026-10-04: type the buy price (0.81) into the ruler's settings and
 * have it reach the current price by itself; and when dragging by hand,
 * have something to grab and see the current price line while lining up.
 *
 *   node scripts/qa-chart-ruler-measure.cjs [--dist path] [--label after] [--widths 1440,1366] [--port 4374]
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4374'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output', 'chart-ruler-measure')));
const LABEL = arg('--label', 'after');
const WIDTHS = arg('--widths', '1440,1366').split(',').map(Number);

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const HOUR = 3600_000;
const state = { shift: 0 };

/** Three hundred hourly candles near 100; the last close is 103 + shift. */
function candles(symbol) {
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  const list = [];
  let price = 100;
  for (let i = 299; i >= 0; i--) {
    const open = price;
    price = 100 + 6 * Math.sin(i / 9) + 3 * Math.cos(i / 4) + (i === 0 ? state.shift : 0);
    const close = price;
    list.push([String(end - i * HOUR), open.toFixed(2), (Math.max(open, close) + 0.8).toFixed(2), (Math.min(open, close) - 0.8).toFixed(2), close.toFixed(2), '1250.5']);
  }
  return { retCode: 0, result: { category: 'linear', symbol, list: list.reverse() } };
}

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/__qa/shift/:by', (q, r) => { state.shift = Number(q.params.by); r.json(state); });
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
    req.on('error', () => (Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150)));
  };
  attempt();
});

// The label's first line, as TradingView prints it: price move, then percent.
const pct = (from, to) => {
  const diff = to - from;
  const move = `${diff > 0 ? '+' : diff < 0 ? '-' : ''}${Math.abs(diff).toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(diff) >= 100 ? 2 : 4 })}`;
  return `${move} (${to >= from ? '+' : ''}${((diff / from) * 100).toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`;
};
/** The ruler's label lines as painted, or [] when hidden. */
const rulerLabel = (page) => page.evaluate(() => [...document.querySelectorAll('g[data-drawing-kind="ruler"] text')].map((t) => t.textContent));
/** Centre of a ruler handle on the page. */
const handle = async (page, id) => {
  const circle = page.locator(`[data-drawing-anchor="${id}"] circle`).last();
  const b = await circle.boundingBox();
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = { label: LABEL, widths: {} };
  let browser, failed = false;
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    for (const width of WIDTHS) {
      state.shift = 0;
      const context = await browser.newContext({ viewport: { width, height: 940 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.locator('.terminal-chart-shell canvas').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(2500);
      const view = report.widths[width] = { pageErrors };
      const box = await page.locator('.chart-view').first().boundingBox();

      // Draw a ruler, then click away so it is not selected.
      await page.locator('[data-drawing-tool="ruler"]').first().click();
      const a = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.62 }, b = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.45 };
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(300);
      await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.15);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-drawing-selected]').count(), 0, `${width}: the ruler is not selected`);

      // 1. Hovering the ruler shows handles, edges included, before any click.
      const ruler = page.locator('g[data-drawing-kind="ruler"] polygon[fill="transparent"]').first();
      const rb = await ruler.boundingBox();
      await page.mouse.move(rb.x + rb.width * 0.3, rb.y + rb.height * 0.5);
      await page.waitForTimeout(250);
      view.hoverHandles = await page.locator('[data-drawing-anchor]').evaluateAll((els) => els.map((e) => e.getAttribute('data-drawing-anchor')));
      assert.deepEqual(view.hoverHandles, ['0', '1', 'edge0', 'edge1'], `${width}: hover shows four handles`);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-hover.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });

      // 2. Settings: start 95, end at the current price.
      await page.mouse.click(rb.x + rb.width * 0.3, rb.y + rb.height * 0.5);
      await page.locator('[data-object-action="measure"]').click();
      const form = page.locator('form[data-object-menu="measure"]');
      await form.waitFor();
      await form.locator('input[name="from"]').fill('95');
      await form.locator('input[name="followLast"]').check();
      view.toWhileLive = await form.locator('input[name="to"]').inputValue();
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-settings.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      await form.locator('button[type="submit"]').click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('g[data-drawing-live]').count(), 1, `${width}: the ruler follows the latest price`);
      view.liveLabel = (await rulerLabel(page))[0];
      assert.equal(view.toWhileLive, '103', `${width}: the end field shows the current price`);
      assert.equal(view.liveLabel, pct(95, 103), `${width}: measured from 95 to the current price`);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-live.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });

      // 3. The next 5-second refresh brings a higher close: the ruler follows by itself.
      await fetch(`http://127.0.0.1:${PORT}/__qa/shift/4`);
      await page.waitForTimeout(6500);
      view.liveLabelAfterTick = (await rulerLabel(page))[0];
      assert.equal(view.liveLabelAfterTick, pct(95, 107), `${width}: followed the new current price`);
      const liveEnd = await handle(page, 1);

      // 4. A fixed end price instead.
      await page.locator('[data-object-action="measure"]').click();
      await form.locator('input[name="followLast"]').uncheck();
      await form.locator('input[name="to"]').fill('101,5');
      await form.locator('button[type="submit"]').click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('g[data-drawing-live]').count(), 0, `${width}: no longer live`);
      view.fixedLabel = (await rulerLabel(page))[0];
      assert.equal(view.fixedLabel, pct(95, 101.5), `${width}: measured from 95 to 101.5`);
      // A bad price is refused inside the form.
      await page.locator('[data-object-action="measure"]').click();
      await form.locator('input[name="from"]').fill('0');
      await form.locator('button[type="submit"]').click();
      view.badPriceRefused = await form.locator('[role="alert"]').innerText();
      assert.equal(view.badPriceRefused, 'Введите цену больше 0', `${width}: zero is refused`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      if (await form.count()) await page.locator('[data-object-action="measure"]').click();
      assert.equal((await rulerLabel(page))[0], pct(95, 101.5), `${width}: a refused edit changed nothing`);

      // 5. Drag the end edge towards the current price: guide, no label, snap.
      const edge = await handle(page, 'edge1');
      await page.mouse.move(edge.x, edge.y);
      await page.mouse.down();
      await page.mouse.move(edge.x, (edge.y + liveEnd.y) / 2 + 20, { steps: 6 });
      view.duringDrag = {
        guide: await page.locator('[data-drawing-guide]').count(),
        labelLines: (await rulerLabel(page)).length,
        snapped: await page.locator('[data-guide-snapped]').count(),
      };
      await page.mouse.move(edge.x, liveEnd.y + 3, { steps: 4 });
      view.nearLive = {
        snapped: await page.locator('[data-guide-snapped]').count(),
        tag: await page.locator('[data-drawing-guide] text').textContent(),
      };
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-drag-snap.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      await page.mouse.up();
      await page.waitForTimeout(300);
      view.afterDrop = { guide: await page.locator('[data-drawing-guide]').count(), label: (await rulerLabel(page))[0] };
      assert.equal(view.duringDrag.guide, 1, `${width}: a guide while dragging`);
      assert.equal(view.duringDrag.labelLines, 0, `${width}: the label is out of the way while dragging`);
      assert.equal(view.nearLive.snapped, 1, `${width}: within a few pixels it lands on the current price`);
      assert.match(view.nearLive.tag, /^Текущая цена 107/, `${width}: the tag says so`);
      assert.equal(view.afterDrop.guide, 0, `${width}: the guide goes on release`);
      assert.equal(view.afterDrop.label, pct(95, 107), `${width}: ends exactly at the current price`);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-dropped.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });

      assert.deepEqual(pageErrors, [], `${width}: no page errors`);
      console.log(`${LABEL} ${width}: ${JSON.stringify({ hover: view.hoverHandles.length, live: view.liveLabel, tick: view.liveLabelAfterTick, fixed: view.fixedLabel, drag: view.duringDrag, near: view.nearLive, drop: view.afterDrop })}`);
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
