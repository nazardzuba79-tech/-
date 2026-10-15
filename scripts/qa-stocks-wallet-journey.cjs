const { launchStocksBrowser } = require('./qa-stocks-browser-launch.cjs');
// Isolated owner Wallet ↔ Stocks browser journey. NEVER connects to production.
// Requires a USDT-only Stocks build. The gateway is loopback-only and fixture-only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { pathToFileURL } = require('node:url');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'frontend/dist');
const ID = 'BYBIT:AAPLXUSDT', TOKENS = { alice: 'qa-alice-session-0001', bob: 'qa-bob-session-000001' };
const audit = { fixtureOnly: true, noProductionAccess: true, checks: [], externalRequestsBlocked: [], walletWrites: [], sessionWrites: [], stocksMutations: [] };
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
  let stocks, gateway, browser, authority;
  const revoked = new Set();
  const screenshots = process.env.QA_OUTPUT_DIR;
  if (screenshots) fs.mkdirSync(screenshots, {recursive:true});
  try {
    const { identityResolver } = await import(pathToFileURL(path.join(root, 'services/stocks-global/identity.mjs')).href);
    const { createLocalStocksProxy } = await import(pathToFileURL(path.join(root, 'services/stocks-global/local-proxy.mjs')).href);
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
    const identify = authorization => {
      if (revoked.has(authorization)) return null;
      return authorization === 'Bearer ' + TOKENS.alice ? 'alice' : authorization === 'Bearer ' + TOKENS.bob ? 'bob' : null;
    };
    // Actual identityResolver performs an HTTP /api/v1/me request for every read
    // and mutation. Only its authority is a disposable fixture, never production.
    authority = http.createServer((req,res)=>{
      const user=identify(req.headers.authorization);
      const valid=req.method==='GET'&&req.url==='/api/v1/me';
      audit.identityChecks=(audit.identityChecks||0)+1;
      res.writeHead(valid&&user?200:401,{'Content-Type':'application/json'});
      res.end(JSON.stringify(valid&&user?{id:user}: {error:'AUTH_REQUIRED'}));
    });
    authority.listen(0,'127.0.0.1');await once(authority,'listening');
    const authenticate=identityResolver({endpoint:'http://127.0.0.1:'+authority.address().port+'/api/v1/me',issuer:'voltex-wallet-journey-qa-only'});
    const startStocks=()=>createServer({
      port:0,accountsPath:path.join(dir,'disposable.sqlite'),autoPoll:true,
      ownerOnlyMode:true,tradeOwnerSubject:'alice',hub,authenticate
    });
    stocks=await startStocks();
    const stockOrigin=()=> 'http://127.0.0.1:'+stocks.port;
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
    const proxy=createLocalStocksProxy({origin:()=>origin,stocksOrigin:stockOrigin});
    app.use((req,res,next)=>{
      if(!req.url.startsWith('/__stocks_global/'))return next();
      if(req.method==='POST')audit.stocksMutations.push(req.url.split('?')[0].slice('/__stocks_global/'.length));
      proxy(req,res);
    });
    app.use('/api/', (req, res) => {
      const user = identify(req.headers.authorization);
      if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
      const route = req.path.slice(1);
      if (req.method === 'POST') {
        if (route === 'v1/auth/logout') {
          audit.sessionWrites.push(route);
          revoked.add(req.headers.authorization);
          return res.json({ status: 'ok' });
        }
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

    browser = await launchStocksBrowser(chromium,{ headless: true });
    for (const size of [[1440, 900], [390, 844]]) {
      const [width, height] = size;
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'ru-RU' });
      await context.addInitScript(t => { if (!localStorage.getItem('qa-session-initialized')) { localStorage.setItem('exchange_token', t);localStorage.setItem('qa-session-initialized','1'); } localStorage.setItem('exchange_lang', 'ru'); }, TOKENS.alice);
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
      ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),width+': Stocks has no page-wide horizontal overflow');
      if(width===390&&screenshots)await page.screenshot({path:path.join(screenshots,'stocks-mobile.png'),fullPage:true});
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
        const replay=await read('alice','orders',{id:afterBuy.body.orders[0].id,instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.40000000'},afterBuy.body.token);
        ok(replay.status===200&&replay.body.fills.length===1,'retry of the same order ID does not debit or fill twice');

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
        // Same-origin trusted-session revocation is enforced even with old bearer/CSRF.
        revoked.add('Bearer '+TOKENS.alice);
        ok((await read('alice','state')).status===401,'revoked owner token rejected by real identity adapter');
        await page.evaluate(()=>{localStorage.removeItem('exchange_token');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token'}));}).catch(error=>{if(!error.message.includes('Execution context was destroyed'))throw error;});
        // A cross-tab storage notification clears account data; it is not the
        // Nav logout action and does not promise navigation. A pending API 401
        // can independently redirect, so do not rely on that timing side effect.
        await page.waitForFunction(()=>!document.querySelector('.wallet-asset-tab-row[data-symbol="AAPLX"]'));
        ok(await page.evaluate(()=>localStorage.getItem('exchange_token')===null),'cross-tab logout clears token and owner holdings without reload');
        TOKENS.alice='qa-alice-session-0002';
        await page.evaluate(t=>{localStorage.setItem('exchange_token',t);window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token'}));},TOKENS.alice);
        await page.goto(origin+'/wallet');
        await page.locator('.wallet-overview').waitFor();
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok(true,'login restores only authenticated holdings from durable account');
        // Separately exercise the real user logout contract, including routing.
        await page.locator('.top-nav-profile-btn').click();
        await Promise.all([
          page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/logout'&&r.request().method()==='POST'&&r.status()===200),
          page.locator('.top-nav-profile-menu button').click(),
        ]);
        await page.waitForURL(url=>url.pathname==='/');
        await page.waitForFunction(()=>!document.querySelector('.wallet-asset-tab-row[data-symbol="AAPLX"]'));
        ok(await page.evaluate(()=>localStorage.getItem('exchange_token')===null),'Nav logout navigates home and clears token and owner holdings');
        ok((await read('alice','state')).status===401,'Nav logout revokes the disposable authority session');
        TOKENS.alice='qa-alice-session-0003';
        await page.evaluate(t=>{localStorage.setItem('exchange_token',t);window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token'}));},TOKENS.alice);
        await page.goto(origin+'/wallet');
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        await stocks.close();stocks=await startStocks();
        await page.reload();await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok(true,'held shares survive Stocks worker/server restart');
        if(screenshots)await page.screenshot({path:path.join(screenshots,'wallet-desktop.png'),fullPage:true});


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
        await page.locator('.vxg-sides button').filter({hasText:/^Купить$/}).click();
        await page.locator('.vxg-order-types button').filter({hasText:'Limit'}).click();
        await page.locator('.vxg-ticket input[aria-label="Цена"]').fill('90');
        await page.locator('.vxg-ticket input[aria-label="Количество"]').fill('0.1');
        await page.locator('.vxg-ticket form button.vxg-submit').click();
        const cancel=page.locator('.vxg-account button').filter({hasText:/^Отменить$/});
        await cancel.waitFor();
        const limit=await read('alice','state');
        ok(limit.body.orders.some(o=>o.type==='LIMIT'&&o.status==='OPEN')&&Number(limit.body.wallets.USDT.reserved)===9,'Limit reserves exact paper funds without premature execution');
        await cancel.click();await page.waitForFunction(()=>document.querySelector('.vxg-success')?.textContent?.includes('отменён'));
        const cancelled=await read('alice','state');
        ok(Number(cancelled.body.wallets.USDT.reserved)===0&&cancelled.body.orders.some(o=>o.type==='LIMIT'&&o.status==='CANCELLED'),'Limit cancellation releases reserve and preserves history');
        if(screenshots)await page.screenshot({path:path.join(screenshots,'stocks-desktop.png'),fullPage:true});

        await page.goto(origin + '/wallet');
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').waitFor();
        ok((await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').innerText()).match(/0[,\\.]2/), 'remaining shares display in Wallet');
        await page.evaluate(t => { localStorage.setItem('exchange_token', t); }, TOKENS.bob);
        await page.reload();
        await page.locator('.wallet-tabs [role="tab"]').nth(1).click();
        ok(await page.locator('.wallet-asset-tab-row[data-symbol="AAPLX"]').count() === 0, 'other account cannot see owner holdings');
        const bobOrderRequests = [];
        page.on('request', request => {
          if (request.method() === 'POST' && new URL(request.url()).pathname === '/__stocks_global/orders') {
            bobOrderRequests.push(request.url());
          }
        });
        await page.goto(stockPage);
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').waitFor();
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').fill('0.25');
        await page.waitForFunction(()=>Number(document.querySelector('.vxg-ticket input[aria-label="Цена"]')?.value)>0);
        ok(true,'non-owner chart receives a verified read-only quote');
        const bobSubmit = page.locator('.vxg-ticket form button.vxg-submit');
        await page.waitForFunction(() => {
          const button = document.querySelector('.vxg-ticket form button.vxg-submit');
          return button && !button.disabled;
        });
        const beforeSilentClick = await read('bob', 'state');
        const bobStatusBefore = await page.locator('.vxg-ticket > .vxg-success, .vxg-ticket > .vxg-error').allTextContents();
        await bobSubmit.click();
        await page.waitForTimeout(100);
        const afterSilentClick = await read('bob', 'state');
        const bobStatusAfter = await page.locator('.vxg-ticket > .vxg-success, .vxg-ticket > .vxg-error').allTextContents();
        ok(bobOrderRequests.length === 0, 'non-owner buy button is clickable but never sends an order request');
        ok(JSON.stringify(afterSilentClick.body.orders) === JSON.stringify(beforeSilentClick.body.orders)
          && JSON.stringify(afterSilentClick.body.wallets) === JSON.stringify(beforeSilentClick.body.wallets),
          'non-owner order click does not mutate paper positions or balances');
        ok(JSON.stringify(bobStatusAfter) === JSON.stringify(bobStatusBefore), 'non-owner order click does not add any message or error');
        await page.locator('.vxg-sides button').filter({ hasText: /^Продать$/ }).click();
        await page.locator('.vxg-ticket form input[aria-label="Количество"]').fill('0.1');
        await page.waitForFunction(() => {
          const button = document.querySelector('.vxg-ticket form button.vxg-submit');
          return button && !button.disabled;
        });
        await bobSubmit.click();
        ok(bobOrderRequests.length === 0, 'non-owner sell button also remains clickable and issues no request');
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
      ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),width+': Wallet has no page-wide horizontal overflow');
      if(screenshots)await page.screenshot({path:path.join(screenshots,'wallet-'+width+'.png'),fullPage:true});
      ok(pageErrors.length === 0, width + ': no browser page exceptions: ' + pageErrors.join(', '));
      await context.close();
    }
    ok(audit.sessionWrites.length===1&&audit.sessionWrites[0]==='v1/auth/logout','only the expected disposable session logout was submitted');
    ok(audit.walletWrites.every(route => route === 'v1/wallet/portfolio-snapshot'), 'never wrote a real wallet or transferred crypto funds');
    ok(fs.existsSync(path.join(dir, 'disposable.sqlite')), 'all paper mutations belong to an isolated local SQLite file');
    if(screenshots)fs.writeFileSync(path.join(screenshots,'journey.json'),JSON.stringify({result:'PASS',audit},null,2));
    console.log(JSON.stringify({ result: 'PASS', checks: audit.checks.length, audit }, null, 2));
  } catch (error) {
    audit.failure = { message: error.message, stack: error.stack,
      pages: browser?.contexts().flatMap(c=>c.pages().map(page=>({url:page.url()}))) ?? [] };
    throw error;
  } finally {
    if(screenshots){fs.writeFileSync(path.join(screenshots,'audit-progress.json'),JSON.stringify(audit,null,2));for(const c of browser?.contexts()??[])for(const page of c.pages())await page.screenshot({path:path.join(screenshots,'last-view.png'),fullPage:true}).catch(()=>{});}
    await browser?.close();
    if (gateway) { gateway.closeAllConnections?.(); await new Promise(resolve => gateway.close(resolve)); }
    await stocks?.close();
    if(authority){authority.closeAllConnections();await new Promise(resolve=>authority.close(resolve));}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
