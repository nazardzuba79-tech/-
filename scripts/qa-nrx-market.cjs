// Production frontend + actual NRX edge handler; all account responses are fixtures.
// Blocks every non-local network request and WebSocket. No production API/DB access.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { nrxPublicResponse } = require('../dist/services/testMarkets/nrxPublic');
const { NEURIX } = require('../dist/services/testMarkets/neurix');
const { VOLTORA } = require('../dist/services/testMarkets/testAssetConfig');
const { publicTestAsset } = require('../dist/services/testMarkets/testMarketService');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/qa/nrx-market');
const app = express(); app.use(express.static(path.join(root, 'frontend/dist'), { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
const prohibited = /\b(?:demo|simulation|simulated|synthetic|preview|sandbox|not tradable)\b|тестов|симуляц|демонстрацион/i;
async function screenshot(page, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, name), animations: 'disabled' });
      return;
    } catch (error) { if (attempt === 2) throw error; }
  }
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const report = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'ru-RU' });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-qa-only'); localStorage.setItem('exchange_lang', 'ru'); });
      const page = await context.newPage(), errors = [], nrxRequests = [];
      page.on('pageerror', error => errors.push(String(error)));
      let anchor = NEURIX.listingAt - 86400000, started = Date.now(), writes = 0;
      const clock = () => anchor + Date.now() - started;
      const setClock = value => { anchor = value; started = Date.now(); };
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();
        if (p.toUpperCase().includes('NRX')) {
          nrxRequests.push({ host: url.hostname, path: p });
          assert.equal(url.origin, 'https://market.voltextech.net', 'NRX public data must bypass Render and venues');
          const response = nrxPublicResponse(new Request(req.url(), { method: req.method() }), clock);
          assert.ok(response);
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          writes++;
          assert.equal(p, '/api/v1/orders', 'Only ordinary Spot submission may be exercised against fixtures');
          assert.equal(req.postDataJSON().pair, 'NRX/USDT');
          return json({ error: 'Insufficient USDT balance' }, 400);
        }
        if (p === '/api/v1/market/test-assets') return json({ serverTime: Date.now(), assets: [publicTestAsset(VOLTORA, VOLTORA.listingAt - 86400000)] });
        if (p === '/api/v1/market/display/spot-snapshot') return json({
          _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 },
          tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false,
            value: [{ pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' }] },
          overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' },
        });
        if (p === '/api/v1/me') return json({ id: 'owner-fixture', email: 'owner@example.invalid', role: 'ADMIN', isAdmin: true, kycStatus: 'APPROVED' });
        if (p === '/api/v1/balances') return json([{ asset: 'NRX', available: '6250', locked: '0' }, { asset: 'USDT', available: '1000', locked: '0' }]);
        if (p === '/api/v1/market/external/tickers') return json({ tickers: [{ pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' }] });
        if (p === '/api/v1/market/external/symbols') return json({ symbols: ['BTC/USDT'] });
        if (p === '/api/v1/market/pairs') return json([{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }]);
        if (p === '/api/v1/market/assets/icons') return json({ icons: {} });
        if (p === '/api/v1/market/external/rankings') return json({ rankings: [] });
        if (p === '/api/v1/private-trading/access') return json({ allowed: false });
        if (p === '/api/v1/support/conversations/mine') return json({ conversation: null });
        if (p === '/api/v1/market/live') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/v1/market/snapshot') return json({ pairs: [], fetchedAt: Date.now() });
        if (p === '/api/v1/futures/config') return json({ symbols: [] });
        if (p.startsWith('/api/v1/')) return json([]);
        return route.abort();
      });
      await page.goto(origin + '/markets', { waitUntil: 'domcontentloaded' });
      const row = page.locator('.test-market-row[data-pair="NRX/USDT"]');
      await row.waitFor({ state: 'visible' });
      assert.match(await row.innerText(), /13:00 UTC \/ 16:00 МСК/);
      assert.doesNotMatch(await row.innerText(), prohibited);
      await row.scrollIntoViewIfNeeded();
      await screenshot(page, `markets-${width}.png`);

      setClock(NEURIX.listingAt - 8000);
      await page.goto(origin + '/trade?pair=NRX%2FUSDT', { waitUntil: 'domcontentloaded' });
      await page.locator('.vta-countdown').waitFor({ state: 'visible' });
      assert.match(await page.locator('.vta-prelisting-facts').innerText(), /13:00 UTC \/ 16:00 МСК/);
      assert.equal(await page.locator('.order-form-area form.order-form-content').count(), 1);
      assert.doesNotMatch(await page.locator('body').innerText(), prohibited);
      await screenshot(page, `before-${width}.png`);
      // No reload / client clock override: the edge response crosses the boundary.
      await page.locator('.vta-prelisting').waitFor({ state: 'detached', timeout: 20000 });
      await page.locator('.chart-area canvas').first().waitFor({ state: 'attached' });
      if (width === 1440) await page.locator('.ob-row').first().waitFor({ state: 'visible' });
      assert.doesNotMatch(await page.locator('body').innerText(), prohibited);
      await screenshot(page, `boundary-${width}.png`);

      // A later canonical session gives the review screenshot visible history.
      // The automatic boundary above was already verified on the original page.
      setClock(NEURIX.listingAt + 6 * 3600000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.chart-area canvas').first().waitFor({ state: 'attached' });
      await page.waitForFunction(() => Number(document.querySelector('.ticker-bar .value.price')?.textContent?.replace(/,/g, '')) > .8, undefined, { timeout: 15000 });
      await Promise.all([
        page.waitForResponse(response => response.url().includes('NRX-USDT/candles?interval=5m')),
        page.locator('.chart-area').getByRole('button', { name: '5m', exact: true }).click(),
      ]);
      await screenshot(page, `after-${width}.png`);

      if (width === 1440) {
        await page.locator('.nrx-book-tabs-bar').getByRole('tab', { name: 'Сделки', exact: true }).click();
        await page.locator('.nrx-tape-row time').first().waitFor();
        assert.ok(await page.locator('.nrx-tape-row time').count() > 0);
        await screenshot(page, 'trades-1440.png');
      } else await page.locator('#mobile-trade-trade').click();
      const form = page.locator('.order-form-area');
      await form.getByLabel('Цена', { exact: true }).first().fill('0.8');
      await form.getByLabel('Количество', { exact: true }).first().fill('1');
      assert.equal(await form.locator('.order-form-tab.buy').isEnabled(), true);
      assert.equal(await form.locator('.order-form-tab.sell').isEnabled(), true);
      await form.locator('button[type="submit"]').click();
      await page.getByText('Недостаточно USDT на балансе.', { exact: true }).first().waitFor();
      assert.equal(writes, 1, 'Submission must use the ordinary API, not a private NRX form or asset refusal');
      assert.deepEqual(errors, []);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `overflow ${overflow}`);
      report.push({ width, normalSpotForm: true, listingTransitionWithoutReload: true, localFixtureSubmissions: writes, productionWrites: 0, errors, overflow, nrxRequests });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('NRX browser QA PASS: 1440/390, before/after without reload, markets, tape, standard form, CF-only public data; production writes 0');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
