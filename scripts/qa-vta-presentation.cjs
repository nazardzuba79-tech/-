// Production bundle, synthetic read-only fixtures. No external network or orders.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.QA_OUT || path.join(root, 'output/vta-presentation');
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(path.join(__dirname, 'qa-spot-cfd-terminal.cjs'), 'utf8').split('const DESKTOP =')[0];
const sandbox = { require: createRequire(__filename), __dirname, process, console, module: { exports: {} } };
vm.runInNewContext(source + '\nmodule.exports=app;', sandbox);
const app = sandbox.module.exports;
const server = app.listen(0, '127.0.0.1');
const now = Math.floor(Date.now() / 3600000) * 3600;
const candles = Array.from({ length: 48 }, (_, i) => {
  const p = .01 + i * .043;
  return { time: now - (48 - i) * 3600, open: p, close: p + .01, high: p + .025, low: Math.max(.005, p - .01), volume: 15000 };
});
const asset = { pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false,
  status: 'live', listingArmed: true, listingAt: new Date((now - 49 * 3600) * 1000).toISOString(), initialPrice: .01,
  state: { phase: 'live', lastPrice: 2.0012, openPrice24h: .1161, change24hPercent: 1624.63, high24h: 2.1255,
    low24h: .1143, volume24h: 21602844, quoteVolume24h: 12550000, serverTime: Date.now() } };
(async () => {
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true });
  try {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      let failed = false; const writes = [], errors = [];
      await ctx.addInitScript(({ candles }) => {
        localStorage.setItem('exchange_token', 'local-qa'); localStorage.setItem('exchange_lang', 'ru');
        localStorage.setItem('voltex.drawings.spot.VTA/USDT', JSON.stringify({ version: 1, hidden: false, locked: false,
          drawings: [{ id: 'qa-ruler', kind: 'ruler', points: [{ time: candles[20].time, price: .01 }, { time: candles[34].time, price: 1.942766 }] }] }));
      }, { candles });
      await ctx.routeWebSocket(/.*/, ws => ws.close());
      await ctx.route('**/*', async route => {
        const q = route.request(), u = new URL(q.url());
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push(u.pathname); return route.abort(); }
        if (/\/market\/test-assets(?:\/|$)|\/market\/vta(?:\/|$)/.test(u.pathname)) {
          if (u.pathname.endsWith('/candles')) return route.fulfill({ json: { candles } });
          return failed ? route.fulfill({ status: 503, json: { error: 'fixture outage' } })
            : route.fulfill({ json: { serverTime: Date.now(), assets: [asset] } });
        }
        if (/\/market\/(nrx|listings)(?:\/|$)/.test(u.pathname)) return route.fulfill({ json: { serverTime: Date.now(), assets: [] } });
        if (u.pathname.includes('/api/v1/')) return route.fulfill({ response: await route.fetch({ url: origin + u.pathname + u.search }) });
        if (u.origin === origin || u.protocol === 'data:') return route.continue();
        return route.abort();
      });
      const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.goto(origin + '/trade?pair=VTA%2FUSDT');
      await page.waitForSelector('.spot-terminal');
      await page.waitForFunction(() => document.querySelector('.ticker-bar')?.textContent?.includes('2.0012'));
      const banner = page.getByRole('status').filter({ hasText: /Связь с рынком|Подключение к бирже/ });
      for (let i = 0; i < 9; i++) { await page.clock.runFor(5000); await page.waitForTimeout(30); }
      assert.equal(await banner.count(), 0, 'Kraken loss must not warn for healthy VTA');
      const label = page.locator('svg text').filter({ hasText: '+19\u00a0327,66%' }).first();
      await label.waitFor({ state: 'attached' });
      const metrics = await label.evaluate(el => {
        const group = el.parentElement, rect = group.querySelector('rect');
        const card = rect.getBoundingClientRect(), plot = el.closest('svg').getBoundingClientRect();
        return { text: el.textContent, font: Number(el.getAttribute('font-size')), width: Number(rect.getAttribute('width')), textWidth: el.getBBox().width,
          inside: card.top >= plot.top && card.bottom <= plot.bottom && card.left >= plot.left && card.right <= plot.right };
      });
      assert.equal(metrics.font, 14); assert.ok(metrics.width > metrics.textWidth + 10);
      assert.ok(metrics.inside, 'whole measurement card must stay inside the chart, including mobile');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, `vta-${width}.png`), fullPage: true });
      failed = true;
      for (let i = 0; i < 10; i++) { await page.clock.runFor(5000); await page.waitForTimeout(30); }
      assert.equal(await banner.count(), 1, 'VTA own sustained failure must remain visible');
      failed = false; await page.clock.runFor(5000); await page.waitForTimeout(100);
      assert.equal(await banner.count(), 0, 'healthy VTA clears its warning');
      if (width === 390) await page.locator('#mobile-trade-trade').click();
      for (const side of ['buy', 'sell']) {
        await page.locator(`.order-form-tab.${side}`).click();
        await page.waitForFunction(side => {
          const tab = document.querySelector(`.order-form-tab.${side}.active`);
          if (!tab) return false;
          const probe = document.createElement('span'); probe.style.color = `var(--color-${side})`; tab.append(probe);
          const standard = getComputedStyle(probe).color; probe.remove();
          const cta = document.querySelector(`.submit-btn.${side}`);
          return getComputedStyle(tab).backgroundColor === standard && cta && getComputedStyle(cta).backgroundColor === standard;
        }, side);
        const colours = await page.evaluate(side => {
          const tab = document.querySelector(`.order-form-tab.${side}.active`), cta = document.querySelector(`.submit-btn.${side}`);
          const probe = document.createElement('span'); probe.style.color = `var(--color-${side})`; tab.append(probe);
          const standard = getComputedStyle(probe).color; probe.remove();
          return { tab: getComputedStyle(tab).backgroundColor, cta: getComputedStyle(cta).backgroundColor, standard };
        }, side);
        assert.equal(colours.tab, colours.standard); assert.equal(colours.cta, colours.standard);
      }
      await page.screenshot({ path: path.join(out, `vta-sell-${width}.png`), fullPage: true });
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: healthy VTA + disconnected venue silent; own outage/recovery correct; grouped 14px label ${metrics.width.toFixed(1)}px; no writes/errors/overflow`);
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
