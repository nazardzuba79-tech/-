#!/usr/bin/env node
'use strict';
/**
 * Same-app hosted Stocks acceptance (Issue #558, PR #593 policy), synthetic only.
 *
 * The real PostgreSQL authority on a disposable local database
 * (services/stocks-global/testing/disposable-postgres.cjs), the ordinary VOLTEX
 * password/session login, and the production bundle built with
 * VITE_STOCKS_CATALOGUE_VISIBLE=true served by the Stocks gateway. Checked in
 * Chromium at 1440 and 390:
 *   - a guest is sent to /login?next=… and the Stocks API answers 401;
 *   - the ordinary header «Торговля» menu reaches «Акции» (desktop), the
 *     catalogue opens the professional terminal with candles;
 *   - a viewer's BUY/SELL × Market/Limit, clicked and with Enter, stays
 *     clickable and silent: no financial request, no message, draft kept;
 *   - owner policy (Issue #558, 23 Oct): with the server's order execution
 *     gate OFF (the default), the two bound traders are silent too, and a
 *     forged order to the gateway or the API is refused with nothing written;
 *   - isolated acceptance only, both server gates explicitly ON (never in
 *     production): each of the two bound traders places a MARKET BUY and SELL
 *     and a LIMIT that is cancelled, through the terminal; the existing
 *     DemoBalance moves by exactly the fills and returns after the SELL;
 *   - logout closes the terminal again.
 * No production account, secret, provider request or deployment.
 *
 *   QA_STOCKS_DIST=<vite build with VITE_STOCKS_CATALOGUE_VISIBLE=true and
 *     VITE_API_URL=http://127.0.0.1:4791/api/v1> STOCKS_DISPOSABLE_PG_URL=…
 *   STOCKS_PG_DISPOSABLE_CONFIRM=… node scripts/qa-stocks-hosted-browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, disposableUrl } = require('../services/stocks-global/testing/disposable-postgres.cjs');

const API_PORT = 4791, GATEWAY_PORT = 4792;
const base = `http://127.0.0.1:${GATEWAY_PORT}`;
const dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/stocks-hosted-browser');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'disposable PostgreSQL + same-app hosted Stocks bundle, synthetic only', checks: [], failures: [], screenshots: [], outbound: 0, outboundHosts: {}, pageErrors: [] };
const cleanups = [];
const t = { after: fn => cleanups.push(fn) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function step(name, fn) {
  try { await fn(); report.checks.push(name); console.log('✓ ' + name); }
  catch (error) { report.failures.push({ name, error: String(error.stack || error).slice(0, 1500) }); console.log('✗ ' + name + ' — ' + String(error.message || error).slice(0, 400)); }
}

(async () => {
  assert(disposableUrl(), 'STOCKS_DISPOSABLE_PG_URL and STOCKS_PG_DISPOSABLE_CONFIRM are required');
  assert(fs.existsSync(path.join(dist, 'index.html')), `no bundle in ${dist}`);
  // The bundle's API origin is fixed at build time, so the two server configurations run one after the
  // other on the same ports: first the production default (order execution OFF), then the gated acceptance.
  const hosted = { normalLogin: true, releaseRouter: true, wallClock: true, apiPort: API_PORT, gatewayPort: GATEWAY_PORT, dist };
  const policyCleanups = [];
  let f = await fixture({ after: fn => policyCleanups.push(fn) }, { ...hosted, orderExecutionEnabled: false });
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const terminal = '/stocks/' + encodeURIComponent(f.ID);
  const cash = async index => (await f.db.demoBalance.findUnique({ where: { userId_asset: { userId: f.users[index], asset: 'USDT' } } }));

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
    const financial = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === base && request.method() === 'POST' && /\/__stocks_global\/(orders|cancel|refresh)$/.test(url.pathname)) financial.push(url.pathname);
    });
    return { context, page, financial };
  };
  const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name), fullPage: false }); report.screenshots.push(name); };
  const login = async (page, email) => {
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(f.loginPassword);
    await Promise.all([page.waitForURL(/\/stocks/, { timeout: 20000 }), page.locator('.vx-auth-submit').click()]);
  };
  // The phone shows one panel at a time (chart / «Торговля» / account); the desktop shows the ticket beside the chart.
  const terminalReady = async page => {
    await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 30000 });
    if (page.viewportSize().width >= 600) await page.locator('.vxg-ticket').first().waitFor({ timeout: 30000 });
    else await page.locator('.vxg-mobile-tabs').first().waitFor({ timeout: 30000 });
  };
  const ticket = async (page, side, type) => {
    if (await page.locator('.vxg-mobile-tabs').count() && await page.locator('.vxg-mobile-tabs').isVisible()) await page.locator('.vxg-mobile-tabs button').filter({ hasText: 'Торговля' }).click();
    await page.locator('.vxg-sides button').filter({ hasText: side }).click();
    await page.locator('.vxg-order-types button').filter({ hasText: type }).click();
  };
  const submit = async page => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/__stocks_global/orders') && r.request().method() === 'POST'),
      page.locator('.vxg-submit').click(),
    ]);
    return response.json();
  };
  const state = async (page) => {
    const token = await page.evaluate(() => localStorage.getItem('exchange_token'));
    const response = await page.context().request.get(`${base}/__stocks_global/state?id=${encodeURIComponent(f.ID)}`, { headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status(), body: await response.json() };
  };

  // Every BUY/SELL × Market/Limit, by click and by Enter, leaves no request, no message and the draft as typed.
  const silentTicket = async (page, financial) => {
    const before = await f.rows();
    for (const side of ['Купить', 'Продать']) for (const type of ['Market', 'Limit']) {
      await ticket(page, side, type);
      if (type === 'Limit') await page.getByLabel('Цена', { exact: true }).fill('99');
      await page.getByLabel('Количество', { exact: true }).fill('0.1');
      const draft = await page.locator('.vxg-ticket form input').evaluateAll(inputs => inputs.map(i => i.value));
      assert(await page.locator('.vxg-submit').isEnabled(), `${side} ${type} is not clickable`);
      await page.locator('.vxg-submit').click();
      await page.getByLabel('Количество', { exact: true }).press('Enter');
      await pause(150);
      assert.deepEqual(await page.locator('.vxg-ticket form input').evaluateAll(inputs => inputs.map(i => i.value)), draft, 'the draft changed');
      assert.equal(await page.locator('.vxg-ticket .vxg-error, .vxg-ticket .vxg-success, [role="alert"], .toast').count(), 0, 'a message appeared');
    }
    assert.deepEqual(financial, [], 'a financial request left the page');
    assert.deepEqual(await f.rows(), before, 'a row changed');
    const viewed = await state(page);
    assert.equal(viewed.status, 200); assert.equal(viewed.body.account.canTrade, false);
  };

  try {
    for (const [index, width] of [[0, 1440], [1, 390]]) {
      await step(`policy ${width}: order execution OFF — bound trader ${index + 1} sees the terminal, BUY/SELL × Market/Limit click and Enter are silent, DemoBalance unchanged`, async () => {
        const { context, page, financial } = await open(width);
        await page.goto(base + terminal);
        await login(page, `${f.users[index]}@example.invalid`);
        await terminalReady(page);
        const start = (await cash(index)).available.toString();
        await silentTicket(page, financial);
        assert.equal((await cash(index)).available.toString(), start);
        await shot(page, `policy-trader-${index + 1}-silent-${width}.png`);
        await context.close();
      });
    }
    await step('policy: a forged order to the gateway and to the API itself is refused; nothing is reserved, written or received', async () => {
      const before = await f.rows();
      for (const index of [0, 1]) {
        // With the session's own page token, so a refusal is about permission, not a missing header.
        const read = await (await fetch(`${base}/__stocks_global/state?id=${encodeURIComponent(f.ID)}`, { headers: { authorization: 'Bearer ' + f.tokens[index] } })).json();
        assert.equal(read.account.canTrade, false);
        const gateway = await fetch(`${base}/__stocks_global/orders`, { method: 'POST', headers: { authorization: 'Bearer ' + f.tokens[index], 'content-type': 'application/json', 'x-stocks-token': read.token ?? '' },
          body: JSON.stringify({ id: `forged-${index}-0001`, instrumentId: f.ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.10000000' }) });
        assert.notEqual(gateway.status, 200, 'the gateway accepted a forged order');
        // Even with the gateway's own key — what a compromised gateway could send — the API's second gate refuses.
        const api = await fetch(`${f.apiOrigin}/api/v1/stocks-test-cash/command`, { method: 'POST',
          headers: { authorization: 'Bearer ' + f.tokens[index], 'x-stocks-authority-key': f.gatewayKey, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'submitObserved', input: { id: `forged-api-${index}-0001` } }) });
        assert.equal(api.status, 403); assert.equal((await api.json()).error, 'ACCOUNT_TRADING_DISABLED');
      }
      assert.deepEqual(await f.rows(), before);
    });
    for (const fn of policyCleanups.splice(0).reverse()) await fn();
    f = await fixture(t, hosted);
    // A third ordinary account with a password: logged in, not bound, never a trader.
    const viewer = { email: `synthetic-stocks-viewer-${crypto.randomUUID()}@example.invalid` };
    await f.db.user.create({ data: { id: 'synthetic-stocks-viewer-' + crypto.randomUUID(), email: viewer.email,
      passwordHash: await require('bcrypt').hash(f.loginPassword, 4), referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });

    await step('guest: /stocks goes to the ordinary login with the return path; the Stocks API answers 401', async () => {
      const { context, page } = await open(1440);
      await page.goto(base + terminal);
      await page.locator('#login-email').waitFor({ timeout: 20000 });
      assert.equal(new URL(page.url()).pathname, '/login');
      assert.equal(new URL(page.url()).searchParams.get('next'), terminal);
      assert.equal(await page.locator('.vxg-ticket').count(), 0);
      for (const route of ['catalogue', 'state?id=' + encodeURIComponent(f.ID), 'portfolio'])
        assert.equal((await context.request.get(`${base}/__stocks_global/${route}`)).status(), 401, route);
      await shot(page, 'guest-login-1440.png');
      await context.close();
    });

    for (const width of [1440, 390]) {
      await step(`viewer ${width}: ordinary login, «Акции» from the menu, catalogue → terminal; BUY/SELL × Market/Limit click and Enter are silent`, async () => {
        const { context, page, financial } = await open(width);
        await page.goto(base + '/stocks');
        await login(page, viewer.email);
        // The ordinary VOLTEX header: «Торговля» → «Акции и индексы» (the desktop dropdown, or the menu drawer
        // where the header folds its links).
        await page.goto(base + '/wallet');
        const desktop = page.locator('.nav-desktop-links .top-nav-link').filter({ hasText: 'Торговля' }).first();
        if (await desktop.isVisible().catch(() => false)) await desktop.hover();
        else {
          await page.locator('.nav-burger').click();
          await page.locator('.header-disclosure-mobile .header-disclosure-toggle[aria-label="Торговля"]').click();
        }
        const link = page.locator('a[href="/stocks"]').filter({ hasText: 'Акции' }).filter({ visible: true }).first();
        await link.waitFor({ timeout: 10000 });
        await link.click();
        await page.waitForURL(/\/stocks$/);
        await page.locator('.vxo-original-row').first().waitFor({ timeout: 30000 });
        await page.locator(`a[href="${terminal}"]`).first().click();
        await terminalReady(page);
        await shot(page, `viewer-terminal-${width}.png`);
        await silentTicket(page, financial);
        await shot(page, `viewer-silent-${width}.png`);
        await context.close();
      });
    }

    for (const [index, width] of [[0, 1440], [1, 1440], [0, 390]]) {
      await step(`gated acceptance, both server gates ON — trader ${index + 1} ${width}: MARKET BUY and SELL fill against the existing DemoBalance; a LIMIT rests and is cancelled`, async () => {
        const { context, page, financial } = await open(width);
        await page.goto(base + terminal);
        await login(page, `${f.users[index]}@example.invalid`);
        await terminalReady(page);
        const start = new (require('bignumber.js'))((await cash(index)).available.toString());
        // The quote must be observed twice before a MARKET order (freshness), as for any trader.
        await page.waitForFunction(() => !document.querySelector('.vxg-submit')?.disabled || true);
        await ticket(page, 'Купить', 'Market');
        await page.getByLabel('Количество', { exact: true }).fill('0.1');
        await page.waitForFunction(() => !document.querySelector('.vxg-submit')?.disabled, null, { timeout: 30000 });
        const buy = await submit(page);
        assert.equal(buy.result?.status, 'FILLED', JSON.stringify(buy).slice(0, 400));
        const afterBuy = new (require('bignumber.js'))((await cash(index)).available.toString());
        assert(afterBuy.lt(start), `DemoBalance did not fall: ${start} → ${afterBuy}`);
        assert.equal(buy.positions[`${f.ID}|USDT`].quantity, '0.10000000');
        await shot(page, `trader-${index + 1}-bought-${width}.png`);
        await ticket(page, 'Продать', 'Market');
        await page.getByLabel('Количество', { exact: true }).fill('0.1');
        await page.waitForFunction(() => !document.querySelector('.vxg-submit')?.disabled, null, { timeout: 30000 });
        const sell = await submit(page);
        assert.equal(sell.result?.status, 'FILLED', JSON.stringify(sell).slice(0, 400));
        assert.equal(sell.positions[`${f.ID}|USDT`].quantity, '0.00000000');
        assert.equal((await cash(index)).available.toString(), start.toString(), 'BUY then SELL at one price did not return the cash');
        await ticket(page, 'Купить', 'Limit');
        await page.getByLabel('Цена', { exact: true }).fill('90');
        await page.getByLabel('Количество', { exact: true }).fill('0.1');
        await page.waitForFunction(() => !document.querySelector('.vxg-submit')?.disabled, null, { timeout: 30000 });
        const limit = await submit(page);
        assert(['OPEN', 'PARTIAL'].includes(limit.result?.status), JSON.stringify(limit).slice(0, 400));
        const reserved = await cash(index);
        assert.equal(reserved.locked.toString(), '9', `the LIMIT did not reserve 9 USDT: ${reserved.locked}`);
        // The open order sits under «Заявки»; the phone shows the account panel on its own tab («Позиции / заявки»).
        if (width < 600) await page.locator('.vxg-mobile-tabs button').filter({ hasText: 'Позиции / заявки' }).click();
        await page.locator('button').filter({ hasText: /^Заявки/ }).filter({ visible: true }).first().click();
        const cancel = page.locator('button').filter({ hasText: 'Отменить' }).filter({ visible: true }).first();
        await cancel.waitFor({ timeout: 15000 });
        const [cancelled] = await Promise.all([
          page.waitForResponse(r => r.url().endsWith('/__stocks_global/cancel') && r.request().method() === 'POST'),
          cancel.click(),
        ]);
        assert.equal(cancelled.status(), 200);
        const released = await cash(index);
        assert.equal(released.locked.toString(), '0'); assert.equal(released.available.toString(), start.toString());
        assert.deepEqual(financial.filter(p => p.endsWith('/refresh')), [], 'an unexpected refresh was sent');
        await shot(page, `trader-${index + 1}-limit-cancelled-${width}.png`);
        await context.close();
      });
    }

    await step('logout closes the terminal: the next visit asks for the login again', async () => {
      const { context, page } = await open(1440);
      await page.goto(base + terminal);
      await login(page, `${f.users[1]}@example.invalid`);
      await terminalReady(page);
      const token = await page.evaluate(() => localStorage.getItem('exchange_token'));
      assert.equal((await fetch(f.apiOrigin + '/api/v1/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 200);
      assert.equal((await state(page)).status, 401);
      await page.goto(base + terminal);
      await page.waitForURL(/\/login/, { timeout: 20000 });
      await context.close();
    });

    await step('no page error; nothing left the two local origins except the bundle\'s web-font stylesheet (blocked)', async () => {
      assert.deepEqual(report.pageErrors, []);
      const hosts = Object.keys(report.outboundHosts).filter(host => !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
      assert.deepEqual(hosts, [], 'a request left for ' + hosts.join(', '));
    });
  } finally {
    await browser.close().catch(() => {});
    for (const fn of [...policyCleanups.splice(0), ...cleanups].reverse()) await fn().catch(() => {});
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures.length, screenshots: report.screenshots.length }));
    process.exitCode = report.failures.length ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 500).unref();
  }
})().catch(error => { console.error(error); process.exit(1); });
