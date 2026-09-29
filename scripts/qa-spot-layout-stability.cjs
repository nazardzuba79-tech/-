'use strict';

// Local production bundle only. Hold background reads long enough to expose
// the former empty-state skeleton resize; block external I/O and every write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'output/spot-layout-stability'));
const app = express();
app.use(express.static(path.join(root, 'frontend/dist')));
app.get('*', (_, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
const now = Date.now();
const asset = {
  pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT',
  isTestAsset: true, isTradable: false, listingArmed: true, initialPrice: 0.01,
  listingAt: new Date(now - 100 * 3600000).toISOString(),
  state: { phase: 'live', lastPrice: 0.42, openPrice24h: 0.4, change24hPercent: 5,
    high24h: 0.43, low24h: 0.39, volume24h: 10000, quoteVolume24h: 4200, serverTime: now },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const report = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}) });
    for (const [width, pair] of [[1440, 'VTA/USDT'], [2552, 'VTA/USDT'], [390, 'VTA/USDT'], [1440, 'BTC/USDT']]) {
      const context = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 } });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.addInitScript(() => {
        localStorage.setItem('exchange_lang', 'ru');
        localStorage.setItem('exchange_token', 'fixture');
      });
      let orderReads = 0, candleReads = 0, writes = 0;
      await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url()), p = u.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.origin === origin && !p.startsWith('/api/')) return route.continue();
        if (req.method() !== 'GET') { writes++; return json({ error: 'fixture_write_denied' }, 403); }
        if (p.endsWith('/market/test-assets')) return json({ serverTime: now, assets: [asset] });
        if (p.includes('/candles')) {
          candleReads++;
          const step = ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 })[u.searchParams.get('interval')] || 3600;
          const end = Math.floor(now / 1000 / step) * step;
          const base = pair === 'VTA/USDT' ? 0.4 : 65000;
          return json({ candles: Array.from({ length: 100 }, (_, i) => ({
            time: end - (99 - i) * step, open: base, high: base * 1.05, low: base * .95,
            close: base * (1 + i / 10000), volume: 1000 + i,
          })) });
        }
        if (p === '/api/v1/me') return json({ id: 'fixture', role: 'ADMIN', isAdmin: true });
        if (p.endsWith('/demo/vta')) return json({ error: 'fixture_unavailable' }, 403);
        if (p.includes('/orders/me')) {
          orderReads++;
          if (orderReads > 1) await new Promise(resolve => setTimeout(resolve, 400));
          return json([]);
        }
        if (p.endsWith('/market/display/spot-snapshot')) return json({
          _display: { mode: 'snapshot', capturedAt: now, refreshMs: 60000 },
          tickers: { available: true, value: [{ pair: 'BTC/USDT', lastPrice: '65000', changePercent24h: '1' }] },
          overview: { available: false }, sentiment: { available: false },
        });
        if (p.endsWith('/market/external/tickers')) return json({ tickers: [] });
        if (p.endsWith('/market/assets/icons')) return json({ icons: {} });
        if (p.endsWith('/market/external/symbols')) return json({ symbols: ['BTC/USDT'] });
        if (p.endsWith('/market/pairs')) return json([{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }]);
        if (p.endsWith('/private-trading/access')) return json({ allowed: false });
        if (p.endsWith('/balances')) return json([{ asset: 'USDT', available: '1000', locked: '0' }]);
        if (p.endsWith('/market/nrx') || p.endsWith('/market/listings')) return json({ serverTime: now, assets: [] });
        if (p.startsWith('/api/')) return json([]);
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (/Maximum update depth|Minified React error #185/i.test(message.text())) errors.push(message.text()); });
      await page.goto(origin + '/trade?pair=' + encodeURIComponent(pair));
      await page.locator('.chart-area canvas').first().waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const empty = document.querySelector('.spot-orders-empty');
        return empty && !empty.hasAttribute('data-initial-loading') && empty.textContent.includes('Пока нет');
      });
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.chart-error').count(), 0, 'chart must load candles successfully');
      const initialReads = orderReads;
      await page.evaluate(() => {
        const elements = [...document.querySelectorAll('.chart-area, .chart-area canvas, .orders-panel, .order-form-area')];
        const snapshot = () => elements.map(el => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        window.__layoutQA = { initial: snapshot(), changes: [] };
        const observer = new ResizeObserver(() => {
          const next = snapshot();
          if (JSON.stringify(next) !== JSON.stringify(window.__layoutQA.initial)) window.__layoutQA.changes.push(next);
        });
        elements.forEach(el => observer.observe(el));
        window.__layoutQA.observer = observer;
      });
      // Two ordinary 4-second account polls; no accelerated production timers.
      await page.waitForTimeout(9000);
      const layout = await page.evaluate(() => {
        window.__layoutQA.observer.disconnect();
        return { initial: window.__layoutQA.initial, changes: window.__layoutQA.changes };
      });
      assert.ok(orderReads >= initialReads + 2, 'background polling must actually run');
      assert.ok(candleReads >= 2, 'chart data must keep refreshing');
      assert.equal(await page.locator('.chart-error').count(), 0, 'chart refresh must remain successful');
      assert.deepEqual(errors, [], 'no render loop or page errors');
      assert.equal(writes, 0, 'no financial requests');
      assert.deepEqual(layout.changes, [], 'background reads must not move or resize terminal panels/canvases');
      await page.screenshot({ path: path.join(out, pair.split('/')[0] + '-' + width + '.png') });
      report.push({ width, pair, orderReads, candleReads, writes, errors, layout });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.map(({ layout, ...result }) => ({ ...result, geometryChanges: layout.changes.length })), null, 2));
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
