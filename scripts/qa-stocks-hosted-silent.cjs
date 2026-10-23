/** Actual App/AuthPage/GlobalStocks in Chromium, loopback HTTP only.
 * Synthetic session/quote fixture, NOT acceptance of production auth, feeds or PG.
 * Financial routes use the real gateway with its constructor default OFF.
 * Two stale canTrade=true projections deliberately challenge the frontend gate.
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { randomBytes, createHash } = require('node:crypto');
const express = require('express');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/qa/stocks-hosted-silent');
const ID = 'BYBIT:AAPLXUSDT', route = '/stocks/' + encodeURIComponent(ID);
const report = { scope: 'isolated real browser + built App/normal Login UI + real execution-OFF HTTP gateway; synthetic sessions and quotes; not production/PG acceptance', checks: [], requests: [], blockedExternal: [], errors: [] };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let browser, appServer, gateway;
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const { createServer } = await import(pathToFileURL(path.join(root, 'services/stocks-global/server.mjs')));
  const { createLocalStocksProxy } = await import(pathToFileURL(path.join(root, 'services/stocks-global/local-proxy.mjs')));
  const { CATALOG } = await import(pathToFileURL(path.join(root, 'services/stocks-global/catalog.mjs')));
  const { SimError } = await import(pathToFileURL(path.join(root, 'services/stocks-global/engine.mjs')));
  const actors = ['viewer', 'alpha', 'beta'].map(name => ({ name, issuer: 'synthetic-browser', subject: 'synthetic-' + name }));
  const sessions = new Map(), finance = { balances: ['137.42', '731.25', '129.875'], orders: [], history: [], positions: [], receipts: [] };
  const before = hash(finance); let ledgerAccesses = 0;
  const authenticate = async req => {
    const actor = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!actor) throw new SimError('AUTH_REQUIRED'); return actor;
  };
  const authority = { authenticate, runWithRequest: (_req, work) => work(),
    forPrincipal: async () => { ledgerAccesses++; throw Error('OFF must not access financial authority'); }, close: async () => {}, metrics: () => ({}) };
  const hub = { metrics: {}, catalogue: async () => CATALOG.map(row => ({ ...row, exists: true, online: row.provider !== 'moex' })),
    quote: async id => { const now = Date.now(); return { instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', timestamp: now, receivedAt: now,
      bid: '100', ask: '101', last: '100', change24h: 1, volume: '1000', eventId: 'synthetic-browser-' + id + '-' + now, capacity: '1', verified: true, marketOpen: true, prices: { USDT: { buy: '101', sell: '100' } }, fx: {} }; },
    history: async id => ({ instrumentId: id, currency: 'USDT', interval: '15m', candles: Array.from({ length: 80 }, (_, i) => ({ time: Math.floor(Date.now() / 900000) * 900 - (80 - i) * 900, open: 100, high: 102, low: 99, close: 101, volume: 1000 })) }) };
  gateway = await createServer({ port: 0, accountAuthority: authority, tradePrincipals: actors.slice(1), hub });
  // Test-only stale legacy metadata, without replacing any financial handler.
  gateway.server.prependListener('request', (req, res) => {
    if (req.method !== 'GET' || !req.url.startsWith('/__stocks_global/state?')) return;
    const end = res.end.bind(res);
    res.end = function(chunk, ...args) {
      const actor = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
      if (chunk && res.statusCode === 200 && actor && actor.name !== 'viewer') {
        const body = JSON.parse(chunk.toString());
        body.account.canTrade = true; body.account.fundingMode = 'existing-only'; body.account.mode = 'isolated-paper';
        body.wallets.USDT = { cash: finance.balances[actors.indexOf(actor)], reserved: '0', available: finance.balances[actors.indexOf(actor)] };
        chunk = JSON.stringify(body);
      }
      return end(chunk, ...args);
    };
  });
  const app = express(); app.disable('x-powered-by'); app.use(express.json()); let origin;
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.once('finish', () => report.requests.push({ method: req.method, path: req.path, status: res.statusCode })); next(); });
  app.post('/api/v1/auth/login', (req, res) => {
    const actor = actors.find(a => req.body.email === a.name + '@example.invalid');
    if (!actor || req.body.password !== 'Synthetic-Only-611') return res.status(401).json({ error: 'Invalid credentials' });
    const token = randomBytes(32).toString('hex'); sessions.set(token, actor); res.json({ token });
  });
  app.post('/api/v1/auth/logout', (req, res) => { sessions.delete(req.headers.authorization?.replace(/^Bearer /, '')); res.json({ status: 'ok' }); });
  app.get('/api/v1/me', async (req, res) => { try { const actor = await authenticate(req); res.json({ id: actor.subject, email: actor.name + '@example.invalid', role: 'USER', isAdmin: false }); } catch { res.status(401).json({ error: 'Unauthorized' }); } });
  const proxy = createLocalStocksProxy({ origin: () => origin, stocksOrigin: () => 'http://127.0.0.1:' + gateway.port });
  app.use((req, res, next) => req.url.startsWith('/__stocks_global/') ? proxy(req, res) : next());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Synthetic fixture route not configured' }));
  app.use(express.static(path.join(root, 'frontend/dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));
  appServer = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = 'http://127.0.0.1:' + appServer.address().port;
  const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) for (const actor of actors) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, locale: 'ru-RU' });
    await context.addInitScript(() => localStorage.setItem('voltex.lang', 'ru'));
    await context.route('**/*', r => { if (r.request().url().startsWith(origin + '/')) return r.continue(); report.blockedExternal.push(new URL(r.request().url()).hostname); return r.abort(); });
    await context.routeWebSocket('**/*', s => s.close());
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(origin + route); await page.waitForURL('**/login?**');
    const login = async () => {
      await page.locator('input[type=email]').fill(actor.name + '@example.invalid');
      await page.locator('input[type=password]').fill('Synthetic-Only-611');
      await page.locator('form button[type=submit]').click();
      await page.waitForURL('**/stocks/**'); await page.locator('.vxg-active-asset strong').waitFor();
      await page.waitForFunction(() => document.querySelector('.vxg-active-asset strong')?.textContent.includes('AAPLX'));
    };
    await login();
    await page.goto(origin + '/stocks'); await page.locator('a[href*="AAPLXUSDT"]').first().waitFor();
    await page.goto(origin + route);
    await page.waitForFunction(() => document.querySelector('.vxg-active-asset strong')?.textContent.includes('AAPLX'));
    const permission = await page.evaluate(async id => (await (await fetch('/__stocks_global/state?id=' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + localStorage.getItem('exchange_token') } })).json()).account.canTrade, ID);
    assert.equal(permission, actor.name !== 'viewer');
    assert.deepEqual(await page.locator('.vxg-ticket > .vxg-error').allTextContents(), []);
    if (width === 390) await page.locator('.vxg-mobile-tabs button').nth(1).click();
    const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const startRequest = report.requests.length;
    for (const side of [0, 1]) for (const type of [0, 1]) {
      await page.locator('.vxg-sides button').nth(side).click();
      await page.locator('.vxg-order-types button').nth(type).click();
      const fields = page.locator('.vxg-ticket form input:not([disabled]):not([type=range])');
      await fields.last().fill('0.25'); if (type === 1) await fields.first().fill('99');
      const primary = page.locator('.vxg-submit'); assert.equal(await primary.isEnabled(), true);
      const beforeFields = await fields.evaluateAll(nodes => nodes.map(n => n.value));
      const notice = await page.locator('.vxg-ticket > .vxg-error, .vxg-ticket > .vxg-success').allTextContents();
      await primary.click(); await primary.press('Enter'); await fields.last().press('Enter');
      for (let n = 0; n < 4; n++) await primary.click();
      assert.deepEqual(await fields.evaluateAll(nodes => nodes.map(n => n.value)), beforeFields);
      assert.deepEqual(await page.locator('.vxg-ticket > .vxg-error, .vxg-ticket > .vxg-success').allTextContents(), notice);
      assert.equal(await primary.isEnabled(), true);
    }
    await page.waitForTimeout(150);
    const writes = report.requests.slice(startRequest).filter(r => r.method === 'POST' && r.path.startsWith('/__stocks_global/'));
    assert.deepEqual(writes, []); assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), stored);
    assert.equal(hash(finance), before); assert.equal(ledgerAccesses, 0);
    await page.screenshot({ path: path.join(out, `${actor.name}-${width}.png`), fullPage: true });
    await page.reload(); await page.locator('.vxg-active-asset strong').waitFor();
    await page.goto(origin + '/help');
    if (width === 390) await page.locator('.nav-burger').click();
    else await page.locator('.top-nav-profile-btn').click();
    await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click();
    await page.waitForFunction(() => !localStorage.getItem('exchange_token'));
    await page.goto(origin + route); await page.waitForURL('**/login?**'); await login();
    assert.equal(hash(finance), before); assert.equal(ledgerAccesses, 0);
    report.checks.push({ actor: actor.name, width, staleCanTrade: permission, marketLimitBuySell: 'PASS', mouseEnterRepeat: 'PASS', normalLoginUI: 'PASS', catalogueChart: 'PASS', logoutReloginReload: 'PASS', financialUIRequests: writes.length, ledgerAccesses, unchangedFinanceHash: before });
    await context.close();
  }
  // Independent authenticated forged HTTP, not included in the UI no-POST count.
  for (const actor of actors) {
    const token = randomBytes(32).toString('hex'); sessions.set(token, actor);
    for (const command of ['orders', 'cancel', 'balances', 'refresh']) {
      const response = await fetch(origin + '/__stocks_global/' + command, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'ACCOUNT_TRADING_DISABLED');
    }
  }
  assert.equal(ledgerAccesses, 0); assert.equal(hash(finance), before); assert.deepEqual(report.errors, []);
  report.directHTTP = '12/12 rejected 403; financial ledger never accessed'; report.passed = true;
}
main().catch(error => { report.errors.push(error.stack); report.passed = false; process.exitCode = 1; }).finally(async () => {
  await browser?.close(); if (appServer) { appServer.closeAllConnections(); await new Promise(resolve => appServer.close(resolve)); } await gateway?.close();
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors, requests: report.requests.length, directHTTP: report.directHTTP }));
});
