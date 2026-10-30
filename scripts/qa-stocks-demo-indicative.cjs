#!/usr/bin/env node
'use strict';
/**
 * #613 demo/indicative prices in the real terminal (owner decision 30.10), on LIVE public data: the Solana pools of
 * the listed xStocks (one getMultipleAccounts per snapshot, api.mainnet-beta.solana.com) and MOEX ISS (15-minute
 * delayed). Disposable PostgreSQL and the ordinary VOLTEX login as in the other Stocks browser checks; the gateway
 * runs as the release does with STOCKS_DEMO_INDICATIVE_ENABLED=true and market data OFF (no CEX row).
 * Checked in Chromium at 1440 and 390 for a logged-in viewer: the catalogue lists the xStocks and the MOEX rows and no
 * CEX row; an xStock shows its USDC price with the indicative label and the 15-minute delay; a MOEX share shows its
 * rouble price; the chart has candles; the order ticket cannot submit on either (and the gateway refuses it).
 * Screenshots in QA_OUT. This needs outbound HTTPS to the two public sources, so it is a local/manual check.
 *
 *   QA_STOCKS_DIST=<vite build with VITE_STOCKS_CATALOGUE_VISIBLE=true and VITE_API_URL=http://127.0.0.1:4791/api/v1>
 *   STOCKS_DISPOSABLE_PG_URL=… STOCKS_PG_DISPOSABLE_CONFIRM=… node scripts/qa-stocks-demo-indicative.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, disposableUrl } = require('../services/stocks-global/testing/disposable-postgres.cjs');

const API_PORT = 4791, GATEWAY_PORT = 4792, base = `http://127.0.0.1:${GATEWAY_PORT}`;
const dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/stocks-demo-indicative');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'disposable PostgreSQL + hosted Stocks bundle, gateway with the demo profile on live public sources', checks: [], failures: [], screenshots: [], measured: {}, outboundHosts: {}, pageErrors: [] };
const cleanups = [], t = { after: fn => cleanups.push(fn) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function step(name, fn) {
  try { await fn(); report.checks.push(name); console.log('✓ ' + name); }
  catch (error) { report.failures.push({ name, error: String(error.stack || error).slice(0, 1500) }); console.log('✗ ' + name + ' — ' + String(error.message || error).slice(0, 400)); }
}

(async () => {
  assert(disposableUrl(), 'STOCKS_DISPOSABLE_PG_URL and STOCKS_PG_DISPOSABLE_CONFIRM are required');
  assert(fs.existsSync(path.join(dist, 'index.html')), `no bundle in ${dist}`);
  const f = await fixture(t, { normalLogin: true, releaseRouter: true, wallClock: true, apiPort: API_PORT, gatewayPort: GATEWAY_PORT, dist });
  await f.gateway.close();
  const { createServer } = await import('../services/stocks-global/server.mjs');
  const { createAuthorityAdapter } = await import('../services/stocks-global/authority-adapter.mjs');
  const { createReleaseMarket } = await import('../services/stocks-global/release-market.mjs');
  const { DEMO_CATALOG } = await import('../services/stocks-global/catalog.mjs');
  const endpoint = `${f.apiOrigin}/api/v1/stocks-test-cash`;
  // The release market exactly as the entrypoint builds it: market data OFF, the demo profile ON.
  const hub = createReleaseMarket({ STOCKS_MARKET_DATA_ENABLED: 'false', STOCKS_DEMO_INDICATIVE_ENABLED: 'true' });
  const gateway = await createServer({ financialEnabled: false, port: GATEWAY_PORT, dist, accountAuthority: createAuthorityAdapter({ endpoint, issuer: f.issuer, gatewayKey: f.gatewayKey }), tradePrincipals: f.principals, hub, now: Date.now });
  t.after(() => gateway.close());
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const SPY = DEMO_CATALOG.find(r => r.asset === 'SPYx').id, NVDA = DEMO_CATALOG.find(r => r.asset === 'NVDAx').id, SBER = 'MOEX:TQBR:SBER';
  const terminal = id => '/stocks/' + encodeURIComponent(id);
  // The first live snapshot (a few seconds) before any page asks.
  for (let i = 0; i < 40 && !hub.quote; i++) await pause(250);
  for (let i = 0; i < 60; i++) { try { await hub.quote(SPY); break; } catch { await pause(500); } }
  try {
    for (const width of [1440, 390]) {
      const tag = 'viewer ' + width; report.measured[tag] = {};
      const email = `synthetic-stocks-viewer-${crypto.randomUUID()}@example.invalid`;
      await f.db.user.create({ data: { id: 'synthetic-stocks-viewer-' + crypto.randomUUID(), email, passwordHash: await require('bcrypt').hash(f.loginPassword, 4), referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if ([base, f.apiOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
        report.outboundHosts[url.host] = (report.outboundHosts[url.host] || 0) + 1; return route.abort();
      });
      await context.addInitScript(() => { try { localStorage.setItem('exchange_lang', 'ru'); } catch {} });
      const page = await context.newPage();
      page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
      const orders = [];
      page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/orders') && r.method() === 'POST') orders.push(r.url()); });
      const shot = async name => { await page.screenshot({ path: path.join(out, name) }); report.screenshots.push(name); };
      await step(`${tag}: logs in; an xStock shows its USDC price with the indicative label, the 15-minute delay and candles`, async () => {
        await page.goto(base + terminal(SPY));
        await page.locator('#login-email').fill(email); await page.locator('#login-password').fill(f.loginPassword);
        await Promise.all([page.waitForURL(/\/stocks/, { timeout: 20000 }), page.locator('.vx-auth-submit').click()]);
        await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 30000 });
        await page.waitForFunction(() => /\d/.test(document.querySelector('.vxg-last strong')?.textContent || ''), null, { timeout: 30000 });
        assert.match(await page.locator('.vxg-last').first().innerText(), /USDC/);
        await page.waitForFunction(() => /задержка 15 мин/.test(document.body.innerText), null, { timeout: 15000 });
        const value = Number((await page.locator('.vxg-last strong').first().innerText()).replace(/\s/g, '').replace(',', '.'));
        assert.ok(value > 300 && value < 2000, 'SPYx price ' + value);
        report.measured[tag].spyx = value;
        if (width >= 600) {
          const source = await page.locator('.vxg-source').first().innerText();
          assert.match(source, /Индикативная цена из пула DEX Solana/); assert.doesNotMatch(source, /Демо|демо/);
        }
        await pause(1500); await shot(`${width}-xstock-spyx.png`);
      });
      await step(`${tag}: the order ticket cannot submit on an indicative row and the gateway refuses an order`, async () => {
        if (width >= 600) {
          // The ticket shows the indicative-price label instead of the order form (no demo/practice wording, owner 22.10).
          const ticket = await page.locator('.vxg-ticket').first().innerText();
          assert.match(ticket, /Индикативная цена из пула DEX Solana/); assert.doesNotMatch(ticket, /Демо|демо/);
          assert.equal(await page.locator('.vxg-ticket form').count(), 0);
        }
        assert.equal(orders.length, 0, 'no order request left the page');
        const token = await page.evaluate(() => localStorage.getItem('exchange_token'));
        const state = await (await fetch(`${base}/__stocks_global/state`, { headers: { authorization: 'Bearer ' + token } })).json();
        const r = await fetch(`${base}/__stocks_global/orders`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-stocks-token': state.token ?? '' }, body: JSON.stringify({ id: 'qa-' + crypto.randomUUID(), instrumentId: SPY, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '1' }) });
        assert.ok([401, 403, 422].includes(r.status), 'order refused, got ' + r.status);
      });
      await step(`${tag}: another xStock (NVDAx) and a MOEX share (SBER, roubles) render with prices`, async () => {
        await page.goto(base + terminal(NVDA));
        await page.waitForFunction(() => /\d/.test(document.querySelector('.vxg-last strong')?.textContent || ''), null, { timeout: 30000 });
        await pause(1500); await shot(`${width}-xstock-nvdax.png`);
        await page.goto(base + terminal(SBER));
        await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 30000 });
        await pause(4000);
        const head = await page.locator('.vxg-last').first().innerText();
        assert.match(head, /RUB/);
        report.measured[tag].sber = head.split('\n')[0];
        await shot(`${width}-moex-sber.png`);
      });
      await step(`${tag}: the catalogue lists the xStocks and MOEX and no CEX row`, async () => {
        const token = await page.evaluate(() => localStorage.getItem('exchange_token'));
        const list = (await (await fetch(`${base}/__stocks_global/catalogue`, { headers: { authorization: 'Bearer ' + token } })).json()).catalogue;
        const xs = list.filter(r => r.id.startsWith('XSTOCK:')), moex = list.filter(r => r.provider === 'moex');
        report.measured.catalogue = { xstocks: xs.length, xstocksOnline: xs.filter(r => r.online).length, moex: moex.length, moexOnline: moex.filter(r => r.online).length, cex: list.filter(r => ['bybit', 'binance'].includes(r.provider)).length };
        assert.equal(xs.length, 55); assert.ok(xs.filter(r => r.online).length >= 50); assert.equal(moex.length, 20);
        assert.equal(report.measured.catalogue.cex, 0);
        await page.goto(base + '/stocks'); await pause(3000); await shot(`${width}-catalogue.png`);
      });
      await context.close();
    }
    // Company logos (favicon of the listed domain) and web fonts are external: blocked here and recorded.
    await step('no page error; every other request stayed on the two local origins', async () => {
      assert.deepEqual(report.pageErrors, []);
      report.measured.blockedExternalHosts = Object.keys(report.outboundHosts).length;
    });
  } finally {
    await browser.close().catch(() => {});
    for (const fn of cleanups.reverse()) await fn().catch(() => {});
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures.length, screenshots: report.screenshots.length, measured: report.measured }));
    process.exitCode = report.failures.length ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 500).unref();
  }
})().catch(error => { console.error(error); process.exit(1); });
