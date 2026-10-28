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
// Chart workspace (2026-10-14): quick timeframe keys carry `data-cw-tf` and a localised label («5м»);
// a phone strip keeps five of them (then three) and the rest sit in the «▾» menu, as a trader reaches them.
async function pickTimeframe(page, tf) {
  const quick = page.locator(`.chart-area [data-cw-tf="${tf}"]`);
  if (await quick.count()) return quick.first().click();
  await page.locator('.chart-area [data-cw-feature="timeframes"]').first().click();
  await page.locator(`[data-cw-tf-option="${tf}"]`).first().click();
}
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
      // The edge's stale fixture must never resurrect this retired ticker.
      await page.goto(origin + '/markets', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('.test-market-row[data-pair="NRX/USDT"]').count(), 0,
        'Retired NRX must not appear as a tradable Markets row');
      await screenshot(page, `markets-retired-${width}.png`);

      await page.goto(origin + '/trade?pair=NRX%2FUSDT', { waitUntil: 'domcontentloaded' });
      await page.getByText('Этот рынок удалён. Новые ордера недоступны.', { exact: true })
        .waitFor({ state: 'visible', timeout: 30000 });
      assert.equal(await page.locator('.order-form-area form').count(), 0,
        'The retired pair must not render a trading form');
      assert.equal(await page.locator('.chart-area canvas').count(), 0,
        'The retired pair must not display a model chart');
      assert.equal(await page.locator('.nrx-tape-row').count(), 0,
        'The retired pair must not display its old tape');
      await screenshot(page, `trade-retired-${width}.png`);
      assert.equal(writes, 0, 'No order or account write in retired market');
      assert.equal(nrxRequests.length, 0, 'Retired direct link must not fetch model prices');
      assert.deepEqual(errors, []);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `overflow ${overflow}`);
      report.push({ width, retiredNRX: true, noOrderInputs: true, noChart: true, fixtureWrites: writes,
        productionWrites: 0, errors, overflow, nrxRequests });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('Retired NRX browser QA PASS: 1440/390, Markets absent, direct link closed, no order form/price chart, writes 0');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
