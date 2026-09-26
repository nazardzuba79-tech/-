'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/voltora-frozen-preview'));
const listingAt = '2026-09-27T16:00:00.000Z';

const app = express();
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

function testAsset() {
  return {
    serverTime: Date.parse('2026-09-26T12:00:00Z'),
    assets: [{
      pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT',
      isTestAsset: true, isTradable: false, status: 'TEST · NOT TRADABLE',
      listingArmed: false, listingAt, initialPrice: 0.01,
      state: {
        phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null,
        high24h: null, low24h: null, volume24h: null, quoteVolume24h: null,
        serverTime: Date.parse('2026-09-26T12:00:00Z'),
      },
    }],
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const report = { environment: 'production frontend bundle + isolated read-only fixture API', widths: [], findings: [] };

  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'en-US' });
      await context.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      const page = await context.newPage();
      const pageErrors = [];
      let testMarketReads = 0;
      let writes = 0;
      page.on('pageerror', error => pageErrors.push(String(error)));

      await page.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const p = url.pathname;
        if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();

        const method = req.method();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          writes++;
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'QA blocks writes' }) });
        }
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

        if (p === '/api/v1/market/test-assets') { testMarketReads++; return json(testAsset()); }
        if (p === '/api/v1/me') return json({ id: 'qa', email: 'qa@example.invalid', displayName: 'QA', kycStatus: 'NOT_STARTED', role: 'USER', isAdmin: false });
        if (p === '/api/v1/market/external/tickers') return json({ tickers: [{ pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' }] });
        if (p === '/api/v1/market/external/symbols') return json({ symbols: ['BTC/USDT'] });
        if (p === '/api/v1/market/pairs') return json([{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }]);
        if (p === '/api/v1/market/assets/icons') return json({ icons: {} });
        if (p === '/api/v1/market/external/rankings') return json({ rankings: [] });
        if (p === '/api/v1/orders/me') return json([]);
        if (p === '/api/v1/balances') return json([]);
        if (p === '/api/v1/private-trading/access') return json({ allowed: false });
        if (p === '/api/v1/support/conversations/mine') return json({ conversation: null });
        if (p === '/api/v1/market/live') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/v1/market/snapshot') return json({ pairs: [], fetchedAt: Date.now() });
        if (p.startsWith('/api/v1/')) return json([]);
        return route.abort();
      });

      await page.goto(origin + '/trade?pair=VTA%2FUSDT', { waitUntil: 'domcontentloaded' });
      await page.locator('.vta-stage-switch').waitFor({ state: 'visible', timeout: 15000 });

      const digits = async () => page.locator('.vta-countdown-cell strong').allTextContents();
      const first = await digits();
      assert.deepEqual(first, ['01', '06', '12', '00'], `default frozen stage @${width}`);
      const readsBeforeWait = testMarketReads;
      await page.waitForTimeout(2500);
      assert.deepEqual(await digits(), first, `countdown changed while unarmed @${width}`);
      assert.equal(testMarketReads, readsBeforeWait, `unarmed test-market store polled again @${width}`);

      await page.getByRole('button', { name: 'Listing in 20 s' }).click();
      assert.deepEqual(await digits(), ['00', '00', '00', '20'], `20-second preview stage @${width}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.vta-stage-switch').waitFor({ state: 'visible', timeout: 15000 });
      assert.deepEqual(await digits(), ['00', '00', '00', '20'], `preview stage did not survive reload @${width}`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px @${width}`);
      assert.equal(writes, 0, `unexpected write requests @${width}`);
      assert.deepEqual(pageErrors, [], `page errors @${width}`);

      await page.screenshot({ path: path.join(out, `voltora-${width}.png`), fullPage: true });
      report.widths.push({ width, initial: first, final: await digits(), testMarketReads, writes, pageErrors, overflow });
      await context.close();
    }

    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
