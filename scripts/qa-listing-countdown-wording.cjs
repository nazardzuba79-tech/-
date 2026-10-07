'use strict';
// Mounted production bundle; every HTTP response and WebSocket is isolated.
// Only fixture Date.now and server phase change. No production calls or writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const root = path.resolve(__dirname, '../frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'test-results/listing-countdown');
const listingAt = '2026-10-11T15:00:00Z';
const start = Date.parse(listingAt);
const texts = {
  ru: ['Ожидаем подтверждения запуска рынка', 'Торговля пока недоступна', 'Рынок открыт'],
  en: ['Waiting for confirmation of the market launch', 'Trading is currently unavailable', 'Market open'],
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const [lang, width] of [['ru', 1440], ['ru', 390], ['en', 1440]]) {
      for (const [symbol, isTradable] of [['ZQNEW', true], ['ZQNEW', false], ['AITH', false]]) {
        let time = start - 2000, phase = 'pre-listing', writes = 0, catalogueReads = 0;
        const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
        await ctx.addInitScript(({ time, lang }) => {
          window.__countdownFixtureTime = time;
          Date.now = () => window.__countdownFixtureTime;
          localStorage.setItem('exchange_lang', lang);
          localStorage.setItem('exchange_token', 'isolated-countdown-fixture');
        }, { time, lang });
        await ctx.routeWebSocket('**/*', socket => socket.close());
        await ctx.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), p = url.pathname;
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes++; return route.abort(); }
          if (url.origin === 'http://127.0.0.1:4474' && !p.startsWith('/api/')) {
            const file = path.resolve(root, path.extname(p) ? '.' + p : 'index.html');
            if (file.startsWith(root + path.sep) && fs.existsSync(file)) return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
          }
          if (p.endsWith('/market/listings')) {
            catalogueReads++;
            return json({ serverTime: time, assets: [{
              symbol, pair: symbol + '/USDT', name: symbol, quote: 'USDT', managed: true,
              isTestAsset: true, isTradable, status: 'TEST · NOT TRADABLE', version: 2,
              listingArmed: true, listingAt, initialPrice: 2, displayTimeZone: 'UTC',
              readLease: { protocol: 'aith-prelisting-v1', generation: 2, issuedAt: time, expiresAt: time + 45000 },
              state: { phase, serverTime: time, lastPrice: phase === 'live' ? 2 : null },
            }] });
          }
          if (p.endsWith('/market/nrx') || p.endsWith('/market/test-assets')) return json({ serverTime: time, assets: [] });
          if (p.endsWith('/candles')) return json({ candles: [] });
          if (p === '/api/v1/me') return json({ id: 'countdown-fixture', email: 'fixture@example.test', role: 'USER' });
          if (/\/balances$|\/orders$|\/positions$/.test(p)) return json([]);
          return json({ error: 'Unavailable' }, 503);
        });
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) console.error(message.text()); });
        await page.goto('http://127.0.0.1:4474/trade?pair=' + symbol + '%2FUSDT');
        if (width < 600) await page.locator('#mobile-trade-chart').click();
        await page.locator('.vta-countdown').waitFor({ timeout: 10000 }).catch(async error => {
          console.error({ symbol, isTradable, lang, width, catalogueReads, errors, body: await page.locator('body').innerText() });
          throw error;
        });
        const facts = await page.locator('.vta-prelisting-facts').innerText();
        const check = async (waiting, live) => {
          const body = await page.locator('body').innerText();
          assert.equal(body.includes(texts[lang][0]), waiting);
          const status = await page.locator('.managed-demo-status').first().innerText();
          assert.equal(status.includes(texts[lang][1]), !isTradable);
          assert.equal(status.includes(texts[lang][2]), live && isTradable);
          assert(!body.includes('TEST · NOT TRADABLE'));
          if (!live) assert.equal(await page.locator('.vta-prelisting-facts').innerText(), facts);
        };
        await check(false, false);
        for (const delta of [0, 5000]) {
          time = start + delta;
          await page.evaluate(time => { window.__countdownFixtureTime = time; }, time);
          await page.waitForFunction(text => document.body.innerText.includes(text), texts[lang][0]);
          await page.waitForTimeout(1100);
          assert.equal(await page.locator('.vta-countdown').count(), 0);
          await check(true, false);
        }
        await page.screenshot({ path: path.join(out, `${symbol}-${isTradable}-${lang}-${width}-waiting.png`) });
        const before = catalogueReads;
        phase = 'live';
        // Use the existing resume event to re-read this fixture on the same mount.
        await page.evaluate(() => window.dispatchEvent(new Event('voltex:browser-activity')));
        await page.locator('.managed-demo-chart').waitFor();
        assert(catalogueReads > before);
        await check(false, true);
        assert.equal(writes, 0);
        assert.deepEqual(errors, []);
        report.push({ symbol, isTradable, lang, width, version: 2, listingAt, price: 2, catalogueReads, writes, errors });
        await ctx.close();
      }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.length, stagesPerCase: 4, unmockedRequests: 0, report }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
