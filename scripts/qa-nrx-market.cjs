// Production frontend + actual NRX public handler. Account transport is an
// isolated fixture; real demo settlement is proven separately on PostgreSQL.
// No production account/DB or external request is contacted.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const BigNumber = require('bignumber.js');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { nrxPublicResponse } = require('../dist/services/testMarkets/nrxPublic');
const { NEURIX } = require('../dist/services/testMarkets/neurix');
const { VOLTORA } = require('../dist/services/testMarkets/testAssetConfig');
const { publicTestAsset } = require('../dist/services/testMarkets/testMarketService');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/qa/nrx-market');
const app = express(); app.use(express.static(path.join(root, 'frontend/dist'), { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
async function screenshot(page, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, name), animations: 'disabled' }); return;
    } catch (error) { if (attempt === 2) throw error; }
  }
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const report = []; let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'ru-RU' });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-qa-only'); localStorage.setItem('exchange_lang', 'ru'); });
      const page = await context.newPage(), errors = [], nrxRequests = [];
      page.on('pageerror', error => errors.push(String(error)));
      let anchor = NEURIX.listingAt - 86400000, started = Date.now(), writes = 0, recoveryReads = 0, ordinaryWrites = 0;
      let demoNrx = new BigNumber(10), demoUsdt = new BigNumber(25), loseReply = false;
      const receipts = new Map();
      const clock = () => anchor + Date.now() - started;
      const setClock = value => { anchor = value; started = Date.now(); };
      const snapshot = () => ({
        account: { id: 'owner-fixture', scope: 'SIMULATION_SPOT', cashPolicy: 'SHARED_DEMO_BALANCE', active: true },
        valuationSource: 'NEURIX_SIMULATION', asOf: clock(), totalValueUsd: null,
        balances: [{ asset: 'NRX', available: demoNrx.toFixed(), locked: '0', priceUsd: null, valueUsd: null },
          { asset: 'USDT', available: demoUsdt.toFixed(), locked: '0', priceUsd: '1', valueUsd: demoUsdt.toFixed() }],
        sales: [...receipts.values()].reverse(),
      });
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();
        // Private account reads are not public market-edge requests.
        if (p === '/api/v1/demo/nrx' && req.method() === 'GET') return json(snapshot());
        if (p.startsWith('/api/v1/demo/nrx/sales/') && req.method() === 'GET') {
          recoveryReads++; return json({ receipt: receipts.get(decodeURIComponent(p.split('/').pop())) ?? null });
        }
        if (p === '/api/v1/demo/nrx/sell' && req.method() === 'POST') {
          writes++;
          const body = req.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ['quantity', 'requestId']);
          assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
          const quantity = new BigNumber(body.quantity);
          let receipt = receipts.get(body.requestId);
          if (!receipt) {
            assert.ok(quantity.gt(0) && quantity.lte(demoNrx));
            const price = new BigNumber(publicTestAsset(NEURIX, clock()).state.lastPrice).decimalPlaces(10, BigNumber.ROUND_DOWN);
            receipt = { id: randomUUID(), price: price.toFixed(), quantity: quantity.toFixed(), proceeds: price.times(quantity).toFixed(), createdAt: new Date(clock()).toISOString() };
            receipts.set(body.requestId, receipt);
            demoNrx = demoNrx.minus(quantity); demoUsdt = demoUsdt.plus(receipt.proceeds);
          } else assert.equal(receipt.quantity, quantity.toFixed());
          if (loseReply) { loseReply = false; return route.abort('failed'); }
          return json(receipt);
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          ordinaryWrites++; assert.fail(`Unexpected non-simulation write: ${p}`);
        }
        if (p.toUpperCase().includes('NRX')) {
          nrxRequests.push({ host: url.hostname, path: p });
          assert.equal(url.origin, 'https://market.voltextech.net', 'NRX public data must stay on its existing market edge');
          const response = nrxPublicResponse(new Request(req.url(), { method: req.method() }), clock);
          assert.ok(response);
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        }
        if (p === '/api/v1/market/test-assets') return json({ serverTime: Date.now(), assets: [publicTestAsset(VOLTORA, VOLTORA.listingAt - 86400000)] });
        if (p === '/api/v1/market/display/spot-snapshot') return json({
          _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 },
          tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false,
            value: [{ pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' }] },
          overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' },
        });
        if (p === '/api/v1/me') return json({ id: 'owner-fixture', email: 'owner@example.invalid', role: 'ADMIN', isAdmin: true, kycStatus: 'APPROVED' });
        // Deliberately different real balances: NRX form must never show/use these.
        if (p === '/api/v1/balances') return json([{ asset: 'NRX', available: '31250', locked: '1' }, { asset: 'USDT', available: '123', locked: '7' }]);
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
      await row.scrollIntoViewIfNeeded(); await screenshot(page, `markets-${width}.png`);

      setClock(NEURIX.listingAt - 8000);
      await page.goto(origin + '/trade?pair=NRX%2FUSDT', { waitUntil: 'domcontentloaded' });
      await page.locator('.vta-countdown').waitFor({ state: 'visible' });
      assert.match(await page.locator('.vta-prelisting-facts').innerText(), /13:00 UTC \/ 16:00 МСК/);
      assert.equal(await page.locator('.order-form-area form.order-form-content').count(), 1);
      await screenshot(page, `before-${width}.png`);
      await page.locator('.vta-prelisting').waitFor({ state: 'detached', timeout: 20000 });
      await page.locator('.chart-area canvas').first().waitFor({ state: 'attached' });
      if (width === 1440) await page.locator('.ob-row').first().waitFor({ state: 'visible' });
      await screenshot(page, `boundary-${width}.png`);

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
      } else await page.locator('#mobile-trade-trade').click();
      const form = page.locator('.order-form-area');
      const amount = () => form.locator('.order-summary .amount').innerText();
      const chooseSell = async () => {
        await form.locator('.order-form-tab.sell').click();
        await form.locator('.order-type-tab', { hasText: /^Рынок$/ }).click();
      };
      assert.match(await form.innerText(), /NRX · DEMO/);
      await form.locator('button[type="submit"]').click();
      assert.equal(writes, 0, 'Unsupported BUY must not fall back to real /orders');
      await chooseSell();
      await page.waitForFunction(() => document.querySelector('.order-summary .amount')?.textContent?.includes('10.00000000'));
      assert.doesNotMatch(await amount(), /31250/);
      await form.getByLabel('Количество', { exact: true }).first().fill('2.5');
      await form.locator('button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('.order-summary .amount')?.textContent?.includes('7.50000000'));
      assert.equal(writes, 1); assert.equal(receipts.size, 1);
      assert.equal(await form.locator('details .info-row').count(), 1);

      // Commit with a lost reply, then reload: recovery must use GET only.
      loseReply = true;
      await form.getByLabel('Количество', { exact: true }).first().fill('1');
      await form.locator('button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('form.order-form-content [role="alert"]'));
      assert.equal(writes, 2); assert.equal(receipts.size, 2);
      const key = 'voltex:vta-sale:v1:owner-fixture:NRX';
      assert.ok(await page.evaluate(k => localStorage.getItem(k), key));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(k => localStorage.getItem(k) === null, key);
      assert.ok(recoveryReads > 0); assert.equal(writes, 2, 'Recovery must not POST');
      if (width === 390) await page.locator('#mobile-trade-trade').click();
      await chooseSell();
      await page.waitForFunction(() => document.querySelector('.order-summary .amount')?.textContent?.includes('6.50000000'));
      await form.locator('button[aria-label="100%"] ').click();
      await form.locator('button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('.order-summary .amount')?.textContent?.includes('0.00000000'));
      assert.equal(writes, 3); assert.equal(receipts.size, 3); assert.equal(demoNrx.toFixed(), '0');
      assert.equal(demoUsdt.toFixed(), [...receipts.values()].reduce((sum, r) => sum.plus(r.proceeds), new BigNumber(25)).toFixed());
      assert.equal(ordinaryWrites, 0); assert.deepEqual(errors, []);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `overflow ${overflow}`);
      await screenshot(page, `sold-demo-${width}.png`);
      report.push({ width, listingTransitionWithoutReload: true, partialAndFullSale: true, lostReplyRecoveredByGet: true,
        localFixtureSubmissions: writes, ordinaryWrites, productionWrites: 0, errors, overflow, nrxRequests });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('NRX browser QA PASS: 1440/390, unchanged public chart, separate DEMO form, partial/full sale, lost-reply GET recovery, no real writes');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
