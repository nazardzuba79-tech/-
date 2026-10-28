#!/usr/bin/env node
'use strict';
/**
 * #613: the whole user route through the real VOLTEX app, synthetic only, with the production default
 * (order execution OFF). Same disposable stack as qa-stocks-hosted-browser.cjs: the real PostgreSQL
 * authority on a disposable local database, the ordinary password/session login and the hosted bundle
 * (VITE_STOCKS_CATALOGUE_VISIBLE=true) served by the Stocks gateway with its synthetic market.
 * For a viewer and a bound trader, in Chromium at 1440 and 390:
 *   login → header «Торговля» → «Акции» → catalogue → asset → chart → every timeframe the asset offers →
 *   «История» → back to the catalogue → another asset → reload → network lost and back,
 * then the requests one open terminal makes in 30 s. BUY stays silent. Nothing leaves the two local origins.
 *
 *   QA_STOCKS_DIST=<vite build with VITE_STOCKS_CATALOGUE_VISIBLE=true and
 *     VITE_API_URL=http://127.0.0.1:4791/api/v1>
 *   STOCKS_DISPOSABLE_PG_URL=… STOCKS_PG_DISPOSABLE_CONFIRM=… node scripts/qa-stocks-route-browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, disposableUrl } = require('../services/stocks-global/testing/disposable-postgres.cjs');

const API_PORT = 4791, GATEWAY_PORT = 4792;
const base = `http://127.0.0.1:${GATEWAY_PORT}`;
const dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/stocks-route-browser');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'disposable PostgreSQL + same-app hosted Stocks bundle, synthetic only, order execution OFF', checks: [], failures: [], screenshots: [], timeframes: {}, requests: {}, outbound: 0, outboundHosts: {}, pageErrors: [] };
const cleanups = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function step(name, fn) {
  try { await fn(); report.checks.push(name); console.log('✓ ' + name); }
  catch (error) { report.failures.push({ name, error: String(error.stack || error).slice(0, 1500) }); console.log('✗ ' + name + ' — ' + String(error.message || error).slice(0, 400)); }
}

(async () => {
  assert(disposableUrl(), 'STOCKS_DISPOSABLE_PG_URL and STOCKS_PG_DISPOSABLE_CONFIRM are required');
  assert(fs.existsSync(path.join(dist, 'index.html')), `no bundle in ${dist}`);
  const f = await fixture({ after: fn => cleanups.push(fn) }, { normalLogin: true, releaseRouter: true, wallClock: true, apiPort: API_PORT, gatewayPort: GATEWAY_PORT, dist, orderExecutionEnabled: false });
  // An ordinary account with a password: logged in, not bound, never a trader.
  const viewer = { email: `synthetic-stocks-route-viewer-${crypto.randomUUID()}@example.invalid` };
  await f.db.user.create({ data: { id: 'synthetic-stocks-route-viewer-' + crypto.randomUUID(), email: viewer.email,
    passwordHash: await require('bcrypt').hash(f.loginPassword, 4), referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  cleanups.push(() => browser.close());
  const terminalOf = id => '/stocks/' + encodeURIComponent(id);

  const open = async width => {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([base, f.apiOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      report.outbound++; report.outboundHosts[url.host] = (report.outboundHosts[url.host] || 0) + 1; return route.abort();
    });
    await context.addInitScript(() => { try { localStorage.setItem('exchange_lang', 'ru'); } catch {} });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
    const requests = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && url.pathname.startsWith('/__stocks_global/')) requests.push({ at: Date.now(), method: request.method(), path: url.pathname.slice('/__stocks_global/'.length), query: url.searchParams }); });
    return { context, page, requests };
  };
  const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name), fullPage: false }); report.screenshots.push(name); };
  const login = async (page, email) => {
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(f.loginPassword);
    await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20000 }), page.locator('.vx-auth-submit').click()]);
  };
  const phone = page => page.viewportSize().width < 600;
  const terminalReady = async page => {
    await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 30000 });
    if (!phone(page)) await page.locator('.vxg-ticket').first().waitFor({ timeout: 30000 });
    else await page.locator('.vxg-mobile-tabs').first().waitFor({ timeout: 30000 });
  };
  const mobileView = async (page, label) => { if (phone(page)) await page.locator('.vxg-mobile-tabs button').filter({ hasText: label }).click(); };
  // A history page from the gateway for exactly this asset and timeframe, with candles in it.
  const history = (page, id, interval) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === base && url.pathname === '/__stocks_global/history' && url.searchParams.get('id') === id && (!interval || url.searchParams.get('interval') === interval) && response.status() === 200;
  }, { timeout: 30000 }).then(async response => { const body = await response.json(); assert(Array.isArray(body.candles) && body.candles.length > 0, `no candles for ${id} ${interval}`); return body; });

  try {
    const accounts = [['viewer', viewer.email], ['trader', `${f.users[0]}@example.invalid`]];
    for (const [who, email] of accounts) for (const width of [1440, 390]) {
      const tag = `${who} ${width}`;
      const { context, page, requests } = await open(width);
      let second;
      await step(`${tag}: login → «Торговля» → «Акции» → catalogue → asset → chart with candles`, async () => {
        await page.goto(base + '/login');
        await login(page, email);
        await page.goto(base + '/wallet');
        const desktop = page.locator('.nav-desktop-links .top-nav-link').filter({ hasText: 'Торговля' }).first();
        if (await desktop.isVisible().catch(() => false)) await desktop.hover();
        else {
          await page.locator('.nav-burger').click();
          await page.locator('.header-disclosure-mobile .header-disclosure-toggle[aria-label="Торговля"]').click();
        }
        const link = page.locator('a[href="/stocks"]').filter({ hasText: 'Акции' }).filter({ visible: true }).first();
        await link.waitFor({ timeout: 10000 }); await link.click();
        await page.waitForURL(/\/stocks$/);
        await page.locator('.vxo-original-row').first().waitFor({ timeout: 30000 });
        const ids = await page.locator('a[href^="/stocks/"]').evaluateAll(links => [...new Set(links.map(a => decodeURIComponent(a.getAttribute('href').slice('/stocks/'.length))))]);
        second = ids.find(id => id !== f.ID && !id.startsWith('MOEX:'));
        assert(ids.includes(f.ID) && second, 'the catalogue lists the assets');
        await shot(page, `route-${who}-catalogue-${width}.png`);
        const loaded = history(page, f.ID);
        await page.locator(`a[href="${terminalOf(f.ID)}"]`).first().click();
        await terminalReady(page); await loaded;
        await shot(page, `route-${who}-terminal-${width}.png`);
      });
      await step(`${tag}: every timeframe the asset offers loads its own candles`, async () => {
        await mobileView(page, 'График');
        const frames = await page.locator('.vxg-timeframes button').allInnerTexts();
        assert(frames.length >= 3, 'timeframes offered: ' + frames.join(','));
        const counts = {};
        for (const frame of [...frames.slice(1), frames[0]]) {
          const loaded = history(page, f.ID, frame);
          await page.locator('.vxg-timeframes button').filter({ hasText: new RegExp(`^${frame}$`) }).click();
          counts[frame] = (await loaded).candles.length;
          assert.match(await page.locator('.vxg-timeframes button.selected').innerText(), new RegExp(`^${frame}$`));
          assert.equal(await page.locator('.vxg-plot canvas').first().isVisible(), true);
        }
        report.timeframes[tag] = counts;
        await shot(page, `route-${who}-timeframes-${width}.png`);
      });
      await step(`${tag}: «История» opens and lists nothing invented`, async () => {
        await mobileView(page, 'Позиции / заявки');
        const tab = page.locator('.vxg-account-tabs button').filter({ hasText: 'История' }).first();
        await tab.click();
        await page.waitForFunction(() => document.querySelector('.vxg-account-tabs button.selected')?.textContent?.includes('История'));
        assert.equal(await page.locator('.vxg-account-rows article').count(), 0, 'execution is OFF: no order can exist');
        await shot(page, `route-${who}-history-${width}.png`);
      });
      await step(`${tag}: back to the catalogue, then another asset opens with its own chart`, async () => {
        await page.locator('.vxo-original-back').click();
        await page.waitForURL(/\/stocks$/);
        await page.locator('.vxo-original-row').first().waitFor({ timeout: 30000 });
        const loaded = history(page, second);
        await page.locator(`a[href="${terminalOf(second)}"]`).first().click();
        await page.waitForURL(url => url.pathname === terminalOf(second));
        await terminalReady(page); await loaded;
        await shot(page, `route-${who}-second-asset-${width}.png`);
      });
      await step(`${tag}: a reload keeps the asset and draws the candles again`, async () => {
        const loaded = history(page, second);
        await page.reload(); await terminalReady(page); await loaded;
        assert.equal(new URL(page.url()).pathname, terminalOf(second));
      });
      await step(`${tag}: network lost for 7 s and back — the terminal reads again on its own`, async () => {
        await context.setOffline(true); await pause(7000);
        const resumed = page.waitForResponse(r => new URL(r.url()).pathname === '/__stocks_global/state' && r.status() === 200, { timeout: 15000 });
        await context.setOffline(false); await resumed;
        await terminalReady(page);
        await shot(page, `route-${who}-after-reconnect-${width}.png`);
      });
      await step(`${tag}: one open terminal in 30 s — bounded reads, no write`, async () => {
        await pause(2000);
        const from = Date.now(); await pause(30000);
        const seen = requests.filter(r => r.at >= from), count = name => seen.filter(r => r.path === name).length;
        report.requests[tag] = { state: count('state'), history: count('history'), other: seen.filter(r => !['state', 'history'].includes(r.path)).map(r => r.method + ' ' + r.path) };
        // The terminal's own cadence (GlobalStocks.tsx): state every 3 s, history every 15 s.
        assert(count('state') >= 8 && count('state') <= 12, 'state reads ' + count('state'));
        assert(count('history') >= 1 && count('history') <= 3, 'history reads ' + count('history'));
        assert.deepEqual(seen.filter(r => r.method !== 'GET'), []);
      });
      await step(`${tag}: BUY at Market stays silent`, async () => {
        const before = await f.rows(), posts = requests.length;
        await mobileView(page, 'Торговля');
        await page.locator('.vxg-sides button').filter({ hasText: 'Купить' }).click();
        await page.locator('.vxg-order-types button').filter({ hasText: 'Market' }).click();
        await page.getByLabel('Количество', { exact: true }).fill('0.1');
        await page.locator('.vxg-submit').click(); await pause(300);
        assert.deepEqual(requests.slice(posts).filter(r => r.method !== 'GET'), []);
        assert.equal(await page.locator('.vxg-ticket .vxg-error, .vxg-ticket .vxg-success, [role="alert"]').count(), 0);
        assert.deepEqual(await f.rows(), before);
      });
      await context.close();
    }
    await step('no page error; nothing left the two local origins except the bundle\'s web-font stylesheet (blocked)', async () => {
      assert.deepEqual(report.pageErrors, []);
      const hosts = Object.keys(report.outboundHosts).filter(host => !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
      assert.deepEqual(hosts, [], 'a request left for ' + hosts.join(', '));
    });
  } finally {
    for (const fn of cleanups.reverse()) await fn().catch(() => {});
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures.length, screenshots: report.screenshots.length, timeframes: report.timeframes, requests: report.requests }));
    process.exitCode = report.failures.length ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 500).unref();
  }
})().catch(error => { console.error(error); process.exit(1); });
