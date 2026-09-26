'use strict';

// VOLTORA (VTA/USDT) upcoming listing, in the production frontend bundle
// against an isolated read-only fixture API: the ordinary Spot terminal,
// a running countdown, Buy/Sell answering that the asset is not trading
// yet, no technical wording, no request that writes anything.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/voltora-listing'));
const REFUSAL = 'Этот актив пока не торгуется';
const TECHNICAL = /TEST · NOT TRADABLE|NOT TRADABLE|Simulated|Preview|preview|simulation|тестов|Тестов|симуляц/;

const app = express();
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

function testAssets(now) {
  const listingAt = new Date(now + 48 * 3_600_000).toISOString();
  return {
    serverTime: now,
    assets: [{
      pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT',
      isTestAsset: true, isTradable: false, status: 'TEST · NOT TRADABLE',
      listingArmed: true, listingAt, initialPrice: 0.01,
      state: {
        phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null,
        high24h: null, low24h: null, volume24h: null, quoteVolume24h: null, serverTime: now,
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
  const report = { environment: 'production frontend bundle + isolated read-only fixture API', widths: [] };

  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const width of [1440, 430, 390, 360, 320]) {
      const mobile = width <= 900;
      const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, locale: 'en-US' });
      await context.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      const page = await context.newPage();
      const pageErrors = [];
      let writes = 0;
      page.on('pageerror', error => pageErrors.push(String(error)));

      await page.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const p = url.pathname;
        if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();

        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          writes++;
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'QA blocks writes' }) });
        }
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

        if (p === '/api/v1/market/test-assets') return json(testAssets(Date.now()));
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
        if (p === '/api/v1/futures/config') return json({ symbols: [] });
        if (p.startsWith('/api/v1/')) return json([]);
        return route.abort();
      });

      await page.goto(origin + '/trade?pair=VTA%2FUSDT', { waitUntil: 'domcontentloaded' });
      await page.locator('.vta-countdown[role="timer"]').waitFor({ state: 'visible', timeout: 15000 });

      // The ordinary terminal: its ticker bar, book and order form.
      assert.equal(await page.locator('.ticker-bar .pair-name').first().textContent(), 'VTA/USDT', `ticker bar @${width}`);
      assert.equal(await page.locator('.orderbook-col-headers').count(), 1, `standard order book @${width}`);
      assert.equal(await page.locator('.order-form-area form.order-form-content').count(), 1, `standard order form @${width}`);

      // The countdown is ~48h and moves.
      const digits = async () => page.locator('.vta-countdown-cell strong').allTextContents();
      const first = await digits();
      assert.equal(first.length, 4, `four countdown cells @${width}`);
      assert.ok(['01', '02'].includes(first[0]), `about two days to go @${width}: ${first.join(':')}`);
      await page.waitForTimeout(2200);
      const later = await digits();
      assert.notDeepEqual(later, first, `countdown did not move @${width}`);

      assert.doesNotMatch(await page.locator('body').innerText(), TECHNICAL, `technical wording on the page @${width}`);
      await page.screenshot({ path: path.join(out, `voltora-${width}-chart.png`) });

      // Buy, then Sell: an amount and a click answer with the refusal.
      if (mobile) await page.locator('#mobile-trade-trade').click();
      const form = page.locator('.order-form-area');
      for (const side of ['Купить', 'Продать']) {
        await form.locator('.order-form-tab', { hasText: side }).click();
        await form.getByLabel('Количество', { exact: true }).first().fill('100');
        await form.locator('button[type="submit"]').scrollIntoViewIfNeeded();
        await form.locator('button[type="submit"]').click();
        await form.getByRole('alert').filter({ hasText: REFUSAL }).waitFor({ state: 'visible', timeout: 5000 });
      }
      assert.equal(writes, 0, `unexpected write requests @${width}`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px @${width}`);
      assert.deepEqual(pageErrors, [], `page errors @${width}`);

      await page.screenshot({ path: path.join(out, `voltora-${width}.png`), fullPage: !mobile });

      // Markets: the listing row names its start, with no badge.
      await page.goto(origin + '/markets', { waitUntil: 'domcontentloaded' });
      const row = page.locator('.test-market-row[data-pair="VTA/USDT"]');
      await row.waitFor({ state: 'visible', timeout: 15000 });
      assert.match(await row.innerText(), /Начало торгов: \d+ сентября в \d\d:\d\d UTC/, `markets row start time @${width}`);
      assert.doesNotMatch(await row.innerText(), TECHNICAL, `technical wording on the markets row @${width}`);
      // The row itself stays inside the viewport (the rest of the Markets
      // page is not what this script checks).
      const marketsOverflow = await row.evaluate(el => Math.max(0, Math.ceil(el.getBoundingClientRect().right - document.documentElement.clientWidth),
        ...[...el.querySelectorAll('*')].map(child => Math.ceil(child.getBoundingClientRect().right - document.documentElement.clientWidth))));
      assert.ok(marketsOverflow <= 1, `markets row overflows by ${marketsOverflow}px @${width}`);
      await row.screenshot({ path: path.join(out, `voltora-${width}-markets-row.png`) });
      assert.equal(writes, 0, `unexpected write requests on markets @${width}`);
      assert.deepEqual(pageErrors, [], `page errors on markets @${width}`);
      report.widths.push({ width, countdown: [first.join(':'), later.join(':')], writes, pageErrors, overflow, marketsOverflow });
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
