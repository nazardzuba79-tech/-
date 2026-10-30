#!/usr/bin/env node
'use strict';
/**
 * #613 viewer push in the real terminal, synthetic only: the disposable PostgreSQL authority, the ordinary VOLTEX
 * login, the hosted bundle served by the Stocks gateway, and the gateway in the isolated push profile
 * (createServer({ viewerStream: true }) through the test fixture; the release entrypoint never enables it).
 * Checked in Chromium at 1440 and 390 for a logged-in viewer:
 *   - the stream is read with fetch, the bearer in the Authorization header and in no URL;
 *   - push quotes reach the price; a stale source quote is shown as stale with the source's own price;
 *   - no state read while the stream delivers; a busy stream (503 + Retry-After) hands over to the bounded 3 s
 *     read and reopens no earlier than Retry-After; offline and back, the next price arrives by itself; every
 *     connection dropped by the gateway, the stream reopens by itself;
 *   - a hidden tab and another instrument close the stream at once (counted at the gateway);
 *   - out-of-order, older and foreign events (a crafted stream) never reach the price;
 *   - the wire carries the public quote only; a trader cannot open a stream; a SOLANA own-source identity gets no
 *     stream and no price;
 *   - signing out closes the stream within a period and the terminal asks to log in again;
 * and the two bound traders keep their own 3 s state reads with no stream and no financial request.
 *
 *   QA_STOCKS_DIST=<vite build with VITE_STOCKS_CATALOGUE_VISIBLE=true and VITE_API_URL=http://127.0.0.1:4791/api/v1>
 *   STOCKS_DISPOSABLE_PG_URL=… STOCKS_PG_DISPOSABLE_CONFIRM=… node scripts/qa-stocks-viewer-push.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, disposableUrl } = require('../services/stocks-global/testing/disposable-postgres.cjs');

const API_PORT = 4791, GATEWAY_PORT = 4792;
const base = `http://127.0.0.1:${GATEWAY_PORT}`;
const dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/stocks-viewer-push');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'disposable PostgreSQL + hosted Stocks bundle, gateway in the isolated push profile, synthetic only', checks: [], failures: [], screenshots: [], measured: {}, outboundHosts: {}, pageErrors: [] };
const cleanups = [];
const t = { after: fn => cleanups.push(fn) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SOLANA_ID = 'SOLANA:SyntheticMint11111111111111111111111111111:SyntheticPool1111111111111111111111111111';

async function step(name, fn) {
  try { await fn(); report.checks.push(name); console.log('✓ ' + name); }
  catch (error) { report.failures.push({ name, error: String(error.stack || error).slice(0, 1500) }); console.log('✗ ' + name + ' — ' + String(error.message || error).slice(0, 400)); }
}
const until = async (condition, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await pause(100); } assert.fail('timed out: ' + what); };

(async () => {
  assert(disposableUrl(), 'STOCKS_DISPOSABLE_PG_URL and STOCKS_PG_DISPOSABLE_CONFIRM are required');
  assert(fs.existsSync(path.join(dist, 'index.html')), `no bundle in ${dist}`);
  // Both server gates ON (isolated only): the two bound traders are real traders; every other account is a viewer.
  const f = await fixture(t, { normalLogin: true, releaseRouter: true, wallClock: true, apiPort: API_PORT, gatewayPort: GATEWAY_PORT, dist, viewerStream: true });
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const terminal = id => '/stocks/' + encodeURIComponent(id);
  const streams = () => f.gateway.streamMetrics().streams;
  const newViewer = async () => {
    const email = `synthetic-stocks-viewer-${crypto.randomUUID()}@example.invalid`;
    await f.db.user.create({ data: { id: 'synthetic-stocks-viewer-' + crypto.randomUUID(), email,
      passwordHash: await require('bcrypt').hash(f.loginPassword, 4), referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });
    return email;
  };

  const open = async width => {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([base, f.apiOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      report.outboundHosts[url.host] = (report.outboundHosts[url.host] || 0) + 1; return route.abort();
    });
    // Every value the shown price takes, in order: a dropped event must never appear even for one frame.
    await context.addInitScript(() => {
      try { localStorage.setItem('exchange_lang', 'ru'); } catch {}
      window.__prices = [];
      const record = () => { const value = document.querySelector('.vxg-last strong')?.textContent ?? null; if (value !== window.__prices[window.__prices.length - 1]) window.__prices.push(value); };
      new MutationObserver(record).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
    const requests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === base && url.pathname.startsWith('/__stocks_global/'))
        requests.push({ at: Date.now(), method: request.method(), path: url.pathname.slice('/__stocks_global/'.length), id: url.searchParams.get('id'), url: request.url(), authorization: request.headers().authorization });
    });
    return { context, page, requests };
  };
  const login = async (page, email) => {
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(f.loginPassword);
    await Promise.all([page.waitForURL(/\/stocks/, { timeout: 20000 }), page.locator('.vx-auth-submit').click()]);
  };
  const terminalReady = async page => {
    await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 30000 });
    if (page.viewportSize().width >= 600) await page.locator('.vxg-ticket').first().waitFor({ timeout: 30000 });
    else await page.locator('.vxg-mobile-tabs').first().waitFor({ timeout: 30000 });
  };
  const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name), fullPage: false }); report.screenshots.push(name); };
  // The source's price as the ticket shows it (Market BUY: the quote's buy price; the synthetic quote has no last trade).
  const price = page => page.getByLabel('Цена', { exact: true }).inputValue();
  const count = (requests, name, from, to = Date.now()) => requests.filter(r => r.path === name && r.at >= from && r.at <= to).length;
  const tokenOf = page => page.evaluate(() => localStorage.getItem('exchange_token'));
  // A hidden tab and back (the page's own visibility events): the stream closes and the next visible read reopens it.
  const setHidden = (page, hidden) => page.evaluate(value => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => value }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  // The first events of a stream read directly with a bearer (for the wire checks), then closed.
  const readStream = async (token, id, events = 3) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/__stocks_global/stream?id=${encodeURIComponent(id)}`, { headers: { authorization: 'Bearer ' + token }, signal: controller.signal });
    if (response.status !== 200) { const body = await response.text(); return { status: response.status, body }; }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let raw = '';
    while ((raw.match(/\n\n/g) ?? []).length < events + 1) { const { value, done } = await reader.read(); if (done) break; raw += decoder.decode(value, { stream: true }); }
    controller.abort();
    return { status: 200, contentType: response.headers.get('content-type'), raw };
  };

  try {
    for (const width of [1440, 390]) {
      const tag = `viewer ${width}`;
      report.measured[tag] = {};
      f.advance(0, '100');
      const email = await newViewer();
      const { context, page, requests } = await open(width);
      f.setSourceOffset(-120000);
      await step(`${tag}: logs in; the stream is read with fetch, the bearer only in the Authorization header and in no URL`, async () => {
        await page.goto(base + terminal(f.ID));
        await login(page, email);
        await terminalReady(page);
        await until(() => requests.some(r => r.path === 'stream'), 10000, 'a stream request');
        const token = await tokenOf(page);
        const stream = requests.find(r => r.path === 'stream');
        assert.equal(stream.authorization, 'Bearer ' + token);
        assert.equal(stream.id, f.ID);
        for (const r of requests) { assert.equal(r.url.includes(token), false, 'a token in ' + r.url); assert.equal(/eyJ[\w-]+\.[\w-]+/.test(r.url), false, 'a JWT in ' + r.url); }
        await until(() => streams() === 1, 5000, 'the gateway holds one stream');
      });
      await step(`${tag}: a stale source quote is shown as stale with the source's own price, then fresh once the source is`, async () => {
        await until(async () => (await page.locator('.vxg-last .vxg-quote-age').getAttribute('class'))?.includes('stale'), 8000, 'stale shown');
        assert.equal(await price(page), '100');
        assert.match(await page.locator('.vxg-last').textContent(), /нет свежей цены/);
        await shot(page, `push-stale-${width}.png`);
        f.setSourceOffset(0);
        await until(async () => !(await page.locator('.vxg-last .vxg-quote-age').getAttribute('class'))?.includes('stale'), 8000, 'fresh again');
      });
      await step(`${tag}: push quotes reach the price; no state read while the stream delivers`, async () => {
        f.advance(0, '123.45');
        await until(async () => await price(page) === '123.45', 8000, 'pushed price');
        const from = Date.now(); await pause(9000);
        const reads = count(requests, 'state', from), opened = count(requests, 'stream', from);
        Object.assign(report.measured[tag], { stateReadsWhileLive9s: reads, streamOpensWhileLive9s: opened });
        assert.equal(reads, 0, 'state reads while the stream delivered: ' + reads);
        assert.equal(opened, 0, 'the stream reopened while delivering');
        f.advance(0, '124.5');
        await until(async () => await price(page) === '124.5', 8000, 'second pushed price');
        await shot(page, `push-live-${width}.png`);
      });
      await step(`${tag}: the wire carries the public quote only; a trader and a SOLANA own-source identity get no stream`, async () => {
        const token = await tokenOf(page);
        const read = await readStream(token, f.ID);
        assert.equal(read.status, 200); assert.equal(read.contentType, 'text/event-stream');
        for (const word of ['wallets', 'positions', 'orders', 'fills', 'account', 'canTrade', 'nativeCandles', 'eventId', 'capacity', '"token"', token]) assert.equal(read.raw.includes(word), false, word);
        const quotes = read.raw.split('\n\n').filter(block => block.startsWith('event: quote')).map(block => JSON.parse(block.split('\ndata: ')[1]));
        assert.ok(quotes.length >= 1);
        for (const q of quotes) assert.deepEqual(Object.keys(q).sort(), ['instrumentId', 'quote', 'seq', 'serverTime']);
        const trader = await readStream(f.tokens[0], f.ID);
        assert.equal(trader.status, 422); assert.equal(JSON.parse(trader.body).error, 'VIEWER_STREAM_ONLY');
        const own = await readStream(token, SOLANA_ID);
        assert.equal(own.status, 422); assert.equal(JSON.parse(own.body).error, 'INVALID_PAIR');
        await until(() => streams() === 1, 5000, 'only the page\'s stream is left');
      });
      await step(`${tag}: a hidden tab closes the stream at once; visible again, it reopens`, async () => {
        const before = count(requests, 'stream', 0);
        await setHidden(page, true);
        const hiddenAt = Date.now();
        await until(() => streams() === 0, 3000, 'the gateway sees the stream closed');
        report.measured[tag].hiddenCloseMs = Date.now() - hiddenAt;
        await pause(4000);
        assert.equal(count(requests, 'stream', 0), before, 'a stream opened in a hidden tab');
        assert.equal(count(requests, 'state', hiddenAt + 200), 0, 'a state read in a hidden tab');
        await setHidden(page, false);
        await until(() => count(requests, 'stream', 0) > before && streams() === 1, 8000, 'reopened');
      });
      await step(`${tag}: out-of-order, older and foreign events never reach the price (crafted stream)`, async () => {
        const at = await page.evaluate(() => Date.now());
        const event = (seq, last, timestamp, id = f.ID) => `event: quote\ndata: ${JSON.stringify({ instrumentId: id, seq, serverTime: timestamp, quote: { instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: last, ask: last, last, timestamp, receivedAt: timestamp, multiplier: null, change24h: 0, volume: '1', prices: { USDT: { buy: last, sell: last } }, status: { USDT: 'READY', USDC: 'FX_UNAVAILABLE' }, fx: {} } })}\n\n`;
        const body = ': open\n\n' + event(900001, '51.17', at + 1000) + event(900000, '41.17', at + 1500) + event(900002, '61.17', at - 60000) + event(900003, '71.17', at + 2000, 'BYBIT:TSLAXUSDT') + `event: quote\ndata: {"instrumentId":"${f.ID}","seq":900004}\n\n`;
        await page.route('**/__stocks_global/stream?**', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body }), { times: 1 });
        await page.evaluate(() => { window.__prices = []; });
        await setHidden(page, true); await setHidden(page, false);
        await until(async () => (await page.evaluate(() => window.__prices)).includes('51.17'), 8000, 'the in-order event shown');
        await pause(1500);
        const seen = await page.evaluate(() => window.__prices);
        for (const dropped of ['41.17', '61.17', '71.17']) assert.equal(seen.includes(dropped), false, dropped + ' shown: ' + seen.join(','));
        await until(() => streams() === 1, 10000, 'the real stream again');
      });
      await step(`${tag}: busy stream (503 + Retry-After 6): the 3 s reads carry the price, the stream reopens no earlier`, async () => {
        let refused = 0;
        await page.route('**/__stocks_global/stream?**', route => { refused++; return route.fulfill({ status: 503, headers: { 'content-type': 'application/json', 'retry-after': '6' }, body: '{"error":"SOURCE_BUSY","retryAfterMs":6000}' }); }, { times: 1 });
        const before = count(requests, 'stream', 0);
        await setHidden(page, true); await setHidden(page, false);
        await until(() => refused === 1 && count(requests, 'stream', 0) > before, 5000, 'the refused open');
        const refusedAt = requests.filter(r => r.path === 'stream')[before].at;
        f.advance(0, '125.25');
        await until(async () => await price(page) === '125.25', 8000, 'price by the fallback read');
        await until(() => requests.some(r => r.path === 'stream' && r.at > refusedAt), 12000, 'reopened');
        const reopenedAt = requests.filter(r => r.path === 'stream' && r.at > refusedAt)[0].at;
        const reads = count(requests, 'state', refusedAt, reopenedAt);
        report.measured[tag].busy = { reopenAfterMs: reopenedAt - refusedAt, fallbackStateReads: reads };
        assert.ok(reopenedAt - refusedAt >= 6000, 'reopened after ' + (reopenedAt - refusedAt) + ' ms');
        assert.ok(reads >= 2 && reads <= 5, 'fallback state reads ' + reads);
        await until(() => streams() === 1, 5000, 'live again');
        const from = Date.now(); await pause(4000);
        assert.equal(count(requests, 'state', from), 0, 'state read after the stream was back');
      });
      await step(`${tag}: offline for 7 s and back: the next price arrives on its own`, async () => {
        await context.setOffline(true); await pause(7000);
        await context.setOffline(false);
        const onlineAt = Date.now();
        f.advance(0, '126.5');
        await until(async () => await price(page) === '126.5', 8000, 'price after offline');
        // Chromium's offline emulation fails new requests and leaves an open response running, so the stream may
        // carry on through it; either way the price must arrive by itself.
        report.measured[tag].offline = { streamReopened: requests.some(r => r.path === 'stream' && r.at >= onlineAt), priceAfterMs: Date.now() - onlineAt };
      });
      await step(`${tag}: every connection dropped by the gateway: the stream reopens by itself within seconds`, async () => {
        const droppedAt = Date.now();
        f.gateway.server.closeAllConnections();
        await until(() => requests.some(r => r.path === 'stream' && r.at >= droppedAt) && streams() === 1, 8000, 'reopened after the drop');
        report.measured[tag].dropReopenMs = requests.find(r => r.path === 'stream' && r.at >= droppedAt).at - droppedAt;
        f.advance(0, '127.5');
        await until(async () => await price(page) === '127.5', 8000, 'pushed after the drop');
      });
      await step(`${tag}: another instrument closes its stream at once and opens the new one`, async () => {
        await page.locator('.vxg-active-asset').click();
        const row = page.locator('.vxg-roster.vxg-open .vxg-assets > div:not(.selected) .vxg-asset').first();
        await row.waitFor({ timeout: 10000 });
        const before = page.url();
        await row.click();
        await page.waitForURL(url => url.href !== before && url.pathname.startsWith('/stocks/'));
        const next = decodeURIComponent(new URL(page.url()).pathname.slice('/stocks/'.length));
        await until(() => requests.some(r => r.path === 'stream' && r.id === next) && streams() === 1, 10000, 'the new instrument\'s stream');
        await terminalReady(page);
        await shot(page, `push-switched-${width}.png`);
        await page.goBack(); await page.waitForURL(url => url.href === before); await terminalReady(page);
        await until(() => requests.filter(r => r.path === 'stream' && r.id === f.ID).length >= 2 && streams() === 1, 10000, 'back on the first instrument');
      });
      await step(`${tag}: signing out closes the stream within a period; the terminal asks to log in, no stream reopens`, async () => {
        const token = await tokenOf(page);
        assert.equal((await fetch(f.apiOrigin + '/api/v1/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 200);
        const at = Date.now();
        await until(() => streams() === 0, 5000, 'stream closed after sign-out');
        report.measured[tag].signOutCloseMs = Date.now() - at;
        // The 401 that follows clears the credential: the terminal shows its sign-in prompt or the route guard has
        // already moved to /login, as for an expired session in the 3 s reads.
        await until(async () => /\/login/.test(page.url()) || await page.getByRole('alert').filter({ hasText: 'Войти' }).count() > 0, 10000, 'asked to log in');
        report.measured[tag].signedOutTo = /\/login/.test(page.url()) ? 'login page' : 'terminal prompt';
        const opened = count(requests, 'stream', 0);
        await pause(6000);
        assert.equal(count(requests, 'stream', 0), opened, 'a stream reopened for a signed-out session');
        await shot(page, `push-signed-out-${width}.png`);
      });
      await context.close();
    }

    await step('a SOLANA own-source identity in the terminal: no stream is opened and no price is shown', async () => {
      const email = await newViewer();
      const { context, page, requests } = await open(1440);
      await page.goto(base + terminal(SOLANA_ID));
      await login(page, email);
      await pause(6000);
      assert.equal(requests.filter(r => r.path === 'stream').length, 0);
      assert.equal(await page.locator('.vxg-last strong').textContent(), '—'); assert.equal(await price(page), '');
      await context.close();
    });

    for (const [index, width] of [[0, 1440], [1, 390]]) {
      await step(`trader ${index + 1} ${width}: keeps its own 3 s state reads, never opens a stream, and sends no order`, async () => {
        const { context, page, requests } = await open(width);
        const financial = [];
        page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'POST' && /\/__stocks_global\/(orders|cancel|refresh|balances)$/.test(url.pathname)) financial.push(url.pathname); });
        await page.goto(base + terminal(f.ID));
        await login(page, `${f.users[index]}@example.invalid`);
        await terminalReady(page);
        const from = Date.now(); await pause(9500);
        const reads = count(requests, 'state', from);
        report.measured[`trader ${index + 1} ${width}`] = { stateReads9_5s: reads, streams: requests.filter(r => r.path === 'stream').length };
        assert.ok(reads >= 3 && reads <= 4, 'trader state reads ' + reads);
        assert.equal(requests.filter(r => r.path === 'stream').length, 0, 'a trader opened a stream');
        const token = await tokenOf(page);
        const view = await (await fetch(`${base}/__stocks_global/state?id=${encodeURIComponent(f.ID)}`, { headers: { authorization: 'Bearer ' + token } })).json();
        assert.equal(view.account.canTrade, true); assert.equal('viewerStream' in view, false);
        if (await page.locator('.vxg-mobile-tabs').isVisible()) await page.locator('.vxg-mobile-tabs button').filter({ hasText: 'Торговля' }).click();
        await page.getByLabel('Количество', { exact: true }).fill('0.1');
        await page.locator('.vxg-submit').click(); await pause(500);
        assert.deepEqual(financial, [], 'the shipped bundle (execution gate OFF) sent a financial request');
        await shot(page, `trader-${index + 1}-${width}.png`);
        await context.close();
      });
    }

    await step('no page error; nothing left the two local origins except the bundle\'s web-font stylesheet (blocked)', async () => {
      assert.deepEqual(report.pageErrors, []);
      const hosts = Object.keys(report.outboundHosts).filter(host => !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
      assert.deepEqual(hosts, [], 'a request left for ' + hosts.join(', '));
      report.measured.gatewayStreams = f.gateway.streamMetrics();
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
