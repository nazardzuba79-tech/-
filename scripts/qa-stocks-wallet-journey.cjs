// Isolated owner Wallet ↔ Stocks browser journey. NEVER connects to production.
// Requires a USDT-only Stocks build. The gateway is loopback-only and fixture-only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { pathToFileURL } = require('node:url');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'frontend/dist');
const ID = 'BYBIT:AAPLXUSDT', TOKENS = { alice: 'qa-alice', bob: 'qa-bob' };
const audit = { fixtureOnly: true, noProductionAccess: true, checks: [], externalRequestsBlocked: [], walletWrites: [], stocksMutations: [] };
function ok(condition, label) { assert.ok(condition, label); audit.checks.push(label); }
function fixtureWallet() {
  return {
    initialized: true, clientTier: 'SUPREME_VIP',
    account: {
      settleBalance: '4000', walletCollateral: '201000', collateral: '205000',
      unrealizedPnl: '0', equity: '205000', initialMargin: '0',
      orderReserve: '0', maintenanceMargin: '0', available: '205000',
      initialMarginRatio: '0', maintenanceRatio: '0', liquidatable: false,
      collateralComplete: true, unpricedAssets: [], collateralAsOf: Date.now(),
    },
    ledger: { entries: [], openingBalance: '0', closingBalance: '4000',
      totals: { realizedPnl: '0', fees: '0', funding: '0', net: '0' }, walletBalance: '4000', reconciled: true },
    collateral: { settleAsset: 'USDT',
      lines: [{ asset: 'BTC', collateralEnabled: true, available: '2', locked: '0',
        quantity: '2', price: '100000', value: '200000', status: 'PRICED', source: 'fixture', asOf: Date.now() }],
      priced: '201000', collateralPriced: '201000', unpriced: [], collateralUnpriced: [], complete: true, asOf: Date.now(),
    },
    rows: [
      { asset: 'USDT', walletQuantity: '1000', tradingBalance: '4000', total: '5000',
        inUse: '0', available: '5000', price: '1', value: '5000', status: 'SETTLE',
        asOf: Date.now(), collateralEnabled: true, collateralToggleable: false },
      { asset: 'BTC', walletQuantity: '2', tradingBalance: '0', total: '2',
        inUse: '0', available: '2', price: '100000', value: '200000',
        status: 'PRICED', asOf: Date.now(), collateralEnabled: true, collateralToggleable: false },
    ],
    assetsValue: '205000', assetsEquityValue: '205000', assetsComplete: true, unpricedAssets: [],
  };
}
const performance = { periods: {}, ageDays: 0, startedOn: null };
for (const k of ['7d', '30d', '90d', '1y', 'all']) performance.periods[k] = { period: k,
  available: false, startDate: null, endDate: null, startEquity: null, endEquity: null,
  absolutePnl: null, percent: null, points: [] };
const spot = [{ asset: 'BTC', available: '2', locked: '0', priceUsd: 100000, valueUsd: 200000 },
  { asset: 'USDT', available: '5000', locked: '0', priceUsd: 1, valueUsd: 5000 }];
const overview = { real: { spot, futures: [], spotValueUsd: 205000, futuresValueUsd: 0, totalValueUsd: 205000 },
  valuationComplete: true, unpricedAssets: [], btcPriceUsd: 100000 };

async function run() {
  ok(fs.existsSync(path.join(dist, 'index.html')), 'review frontend build exists');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-stocks-wallet-'));
  let stocks, gateway, browser;
  try {
    const { createServer } = await import(pathToFileURL(path.join(root, 'services/stocks-global/server.mjs')).href);
    const { CATALOG } = await import(pathToFileURL(path.join(root, 'services/stocks-global/catalog.mjs')).href);
    const { SimError } = await import(pathToFileURL(path.join(root, 'services/stocks-global/engine.mjs')).href);
    const aapl = CATALOG.find(x => x.id === ID);
    ok(!!aapl, 'AAPLX instrument exists in source catalogue');
    let sequence = 0;
    const hub = {
      metrics: {},
      catalogue: async () => [{ ...aapl, online: true, exists: true, domain: null }],
      quote: async symbol => {
        assert.equal(symbol, ID);
        const at = Date.now();
        return { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT',
          bid: '100', ask: '100.1', last: '100.05',
          verified: true, marketOpen: true, eventId: 'fixture-observation-' + (++sequence),
          timestamp: at, receivedAt: at, capacity: '1.00000000',
          prices: { USDT: { buy: '100.10000000', sell: '100.00000000' } }, fx: {},
          change24h: 0, volume: '100.00000000', multiplier: null };
      },
      history: async (symbol, interval) => {
        assert.equal(symbol, ID);
        const step = 900, anchor = Math.floor(Date.now() / 1000 / step) * step;
        return { instrumentId: ID, interval, provider: 'bybit', currency: 'USDT',
          receivedAt: Date.now(), delaySeconds: 0,
          candles: Array.from({ length: 40 }, (_, i) => ({
            time: anchor - (40 - i) * step, open: 100, high: 101,
            low: 99, close: 100.5, volume: 25,
          })) };
      },
    };
    stocks = await createServer({
      port: 0, accountsPath: path.join(dir, 'disposable.sqlite'),
      autoPoll: false, ownerOnlyMode: true, tradeOwnerSubject: 'alice', hub,
      authenticate: async req => {
        const token = req.headers.authorization;
        if (token !== 'Bearer ' + TOKENS.alice && token !== 'Bearer ' + TOKENS.bob) throw new SimError('AUTH_REQUIRED');
        return { issuer: 'voltex-wallet-journey-qa-only', subject: token === 'Bearer ' + TOKENS.alice ? 'alice' : 'bob' };
      },
    });
    const stockOrigin = 'http://127.0.0.1:' + stocks.port;
    const app = express();
    app.disable('x-powered-by');
    let origin = '';
    app.use((req, res, next) => {
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || req.headers.host !== new URL(origin).host
        || (req.headers.origin && req.headers.origin !== origin)
        || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'LOCAL_FIXTURE_ONLY' });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'self'; frame-ancestors 'none'");
      next();
    });
    const permitted = {
      GET: new Set(['state', 'history', 'catalogue', 'health']),
      POST: new Set(['orders', 'cancel', 'refresh', 'balances']),
    };
    app.use('/__stocks_global/', (req, res) => {
      const route = req.path.slice(1);
      if (!permitted[req.method]?.has(route)) return res.status(404).json({ error: 'FIXTURE_ROUTE_BLOCKED' });
      if (req.method === 'POST') audit.stocksMutations.push(route);
      // The independent Stocks server remains bound to loopback with its own
      // strict Host/Origin checks. Never forward untrusted cookies or proxy URLs.
      const upstream = http.request({
        hostname: '127.0.0.1', port: stocks.port, method: req.method,
        path: '/__stocks_global/' + route + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
        headers: {
          Host: '127.0.0.1:' + stocks.port,
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
          ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
          ...(req.headers['x-stocks-token'] ? { 'X-Stocks-Token': req.headers['x-stocks-token'] } : {}),
          ...(req.headers.origin ? { Origin: stockOrigin } : {}),
          'Sec-Fetch-Site': 'same-origin',
        },
      }, response => { res.status(response.statusCode); for(const k of ['content-type', 'retry-after', 'cache-control']) if (response.headers[k]) res.setHeader(k, response.headers[k]); response.pipe(res); });
      upstream.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'FIXTURE_UPSTREAM_FAILED' }); });
      req.pipe(upstream);
    });
    app.use('/api/', (req, res) => {
      const user = req.headers.authorization === 'Bearer ' + TOKENS.alice ? 'alice'
        : req.headers.authorization === 'Bearer ' + TOKENS.bob ? 'bob' : null;
      if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
      const route = req.path.slice(1);
      if (req.method === 'POST') {
        audit.walletWrites.push(route);
        if (route === 'v1/wallet/portfolio-snapshot') return res.json({ recorded: false });
        return res.status(403).json({ error: 'FINANCIAL_WRITES_BLOCKED' });
      }
      if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      if (route === 'v1/me') return res.json({ id: user, email: user + '@fixture.invalid', isAdmin: user === 'alice', role: user === 'alice' ? 'ADMIN' : 'USER', kycStatus: 'NONE' });
      if (route === 'v1/private-trading/native/wallet') return user === 'alice' ? res.json(fixtureWallet()) : res.status(403).json({ error: 'OWNER_ONLY' });
      if (route === 'v1/private-trading/access') return res.json({ allowed: user === 'alice', nativeAvailable: user === 'alice' });
      if (route === 'v1/wallet/overview') return res.json(user === 'alice'
        ? { ...overview, real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 } }
        : overview);
      if (route === 'v1/wallet/performance') return res.json(performance);
      if (route === 'v1/market/external/rankings') return res.json({ rankings: [
        { symbol: 'BTC', name: 'Bitcoin', price: 100000, changePercent24h: 0 },
        { symbol: 'USDT', name: 'Tether', price: 1, changePercent24h: 0 },
      ] });
      if (route === 'v1/balances') return res.json(spot);
      if (route === 'v1/futures/balances' || route === 'v1/deposits/me' || route === 'v1/withdrawals/me' || route === 'v1/trades/me') return res.json([]);
      return res.status(404).json({ error: 'OUTSIDE_FIXTURE_SCOPE' });
    });
    app.use(express.static(dist, { index: false, redirect: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    gateway = app.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    origin = 'http://127.0.0.1:' + gateway.address().port;

    const read = async (user, route, body, csrf) => {
      const r = await fetch(origin + '/__stocks_global/' + route, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + TOKENS[user], ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': csrf } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    };
    const initial = await read('alice', 'state?id=' + encodeURIComponent(ID));
    ok(initial.status === 200 && initial.body.account.canTrade === true, 'owner authenticated at isolated Stocks gateway');
    const observed = await read('alice', 'refresh', { id: ID }, initial.body.token);
    ok(observed.status === 200, 'owner quote is loaded without external market calls');
    const blocked = await read('bob', 'state');
    ok(blocked.status === 200 && blocked.body.account.canTrade === false, 'other account has isolated read-only Stocks ledger');
    ok((await read('bob', 'refresh', { id: ID }, blocked.body.token)).status === 401, 'other account cannot induce a paper fill through quote refresh');

    browser = await chromium.launch({ headless: true });
    for (const size of [[1440, 900], [390, 844]]) {
      const [width, height] = size;
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'ru-RU' });
      await context.addInitScript(t => { if (!localStorage.getItem('exchange_token')) localStorage.setItem('exchange_token', t); localStorage.setItem('exchange_lang', 'ru'); }, TOKENS.alice);
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin === origin) return route.continue();
        audit.externalRequestsBlocked.push({ host: u.host, method: route.request().method() });
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      const stockPage = origin + '/stocks/' + encodeURIComponent(ID);
      await page.goto(stockPage);
      if (width === 390) await page.locator('.vxg-mobile-tabs button').filter({ hasText: 'Торговля' }).click();
      await page.locator('.vxg-ticket form input[aria-label="Количество"]').waitFor({ timeout: 15000 });
      ok(await page.locator('.vxg-ticket .vxg-currency button').count() === 1, width + ': USDT-only trade form');
      ok((await page.locator('.vxg-ticket').innerText()).includes('USDT'), width + ': form displays USDT');
      if (width === 1440) {
        await page.goto(origin + '/wallet');
        await page.locator('.wallet-overview').waitFor({ timeout: 15000 });
        await page.waitForFunction(() => !!document.querySelector('.wallet-overview-total')?.textContent?.match(/205/));
        const balanceBefore = await page.locator('.wallet-overview-total').innerText();
        await page.goto(stockPage);
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').waitFor();
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').fill('0.4');
        const buy = page.locator('.vxg-ticket form button.vxg-submit');
        await buy.waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const b = document.querySelector('.vxg-ticket form button.vxg-submit');
          return b && !b.disabled;
        });
        await buy.click();
        await page.waitForFunction(() => document.querySelector('.vxg-success')?.textContent?.includes('0.4'));
        const afterBuy = await read('alice', 'state');
        ok(afterBuy.status === 200 && afterBuy.body.fills.length === 1, 'buy is committed to real disposable SQLite account');
        ok(Number(afterBuy.body.positions[ID + '|USDT']?.quantity) === 0.4, 'owner paper shares credited exactly once');

        await page.goto(origin + '/wallet');
        await page.locator('.wallet-overview').waitFor({ timeout: 15000 });
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        const stockRow = page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]');
        await stockRow.waitFor({ timeout: 15000 });
        ok((await stockRow.innerText()).includes('0,4') || (await stockRow.innerText()).includes('0.4'), 'purchased AAPLX appears in same Wallet asset list');
        ok(await page.locator('.wallet-asset-tab-row[data-symbol="BTC"]').count() > 0, 'BTC remains alongside Stocks holdings');
        const heading = await page.locator('.wallet-overview-total').innerText();
        ok(heading === balanceBefore, 'real crypto wallet headline unchanged after Stocks buy');

        await page.reload();
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok(true, 'stock holding survives browser reload and new authenticated read');

        await page.goto(stockPage);
        await page.locator('.vxg-source button').filter({ hasText: 'Обновить котировку' }).click();
        await page.locator('.vxg-sides button').filter({ hasText: /^Продать$/ }).click();
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').fill('0.2');
        await page.waitForFunction(() => {
          const b = document.querySelector('.vxg-ticket form button.vxg-submit');
          return b && !b.disabled;
        });
        await page.locator('.vxg-ticket form button.vxg-submit').click();
        await page.waitForFunction(() => document.querySelector('.vxg-success')?.textContent?.includes('0.2'));
        const afterSell = await read('alice', 'state');
        ok(Number(afterSell.body.positions[ID + '|USDT']?.quantity) === 0.2 && afterSell.body.fills.length === 2, 'partial sell persists; remaining quantity is correct');
        await page.goto(origin + '/wallet');
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok((await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').innerText()).match(/0[,\\.]2/), 'remaining shares display in Wallet');
        await page.evaluate(t => { localStorage.setItem('exchange_token', t); }, TOKENS.bob);
        await page.reload();
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        ok(await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').count() === 0, 'other account cannot see owner holdings');
        const bobOrder = await read('bob', 'orders', { id: 'qa-bob-denied-order-00001', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1' }, blocked.body.token);
        ok(bobOrder.status === 401, 'backend rejects forged non-owner order');
        const finalOwner = await read('alice', 'state'), finalBob = await read('bob', 'state');
        ok(finalOwner.body.fills.length === 2 && finalBob.body.fills.length === 0, 'separate SQLite ledgers remain isolated after account switch');
      } else {
        await page.goto(origin + '/wallet');
        await page.locator('.wallet-overview').waitFor({ timeout: 15000 });
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok((await page.locator('.wallet-asset-tab-row[data-symbol="BTC"]').count()) > 0, 'mobile wallet shows BTC and held AAPLX');
        ok(await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').count() > 0, 'mobile stock holding persists');
      }
      ok(pageErrors.length === 0, width + ': no browser page exceptions: ' + pageErrors.join(', '));
      await context.close();
    }
    ok(audit.walletWrites.every(route => route === 'v1/wallet/portfolio-snapshot'), 'never wrote a real wallet or transferred crypto funds');
    ok(fs.existsSync(path.join(dir, 'disposable.sqlite')), 'all paper mutations belong to an isolated local SQLite file');
    console.log(JSON.stringify({ result: 'PASS', checks: audit.checks.length, audit }, null, 2));
  } finally {
    await browser?.close();
    if (gateway) { gateway.closeAllConnections?.(); await new Promise(resolve => gateway.close(resolve)); }
    await stocks?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
