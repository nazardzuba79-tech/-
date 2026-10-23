'use strict';
// Issue #592 browser QA: the real production bundle and the real Spot terminal.
// /api/v1/demo/*, /orders and /withdrawals reach the real routers on the disposable
// PostgreSQL started by test-demo-trading-postgres.cjs; unrelated market reads are
// fixtures; every other host is refused. Synthetic accounts only.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { createRequire } = require('module');
const root = path.resolve(__dirname, '..');

const PAIRS = ['BTC/USDT', 'ETH/USDT'];
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: Math.floor(Date.now() / 60000) * 60 - (120 - i) * 60, open: 99900, high: 100200, low: 99800, close: 100000, volume: 12 }));
const REAL = [/^\/api\/v1\/demo\//, /^\/api\/v1\/orders(\/|$)/, /^\/api\/v1\/withdrawals/, /^\/api\/v1\/balances$/];

async function run({ origin, out, token, setEnabled, topUp, credit, demoBal, prisma }) {
  const qa = createRequire(path.resolve(root, process.env.DEMO_QA_DEPS || 'output/demo-qa-deps/package.json'));
  const { chromium } = process.env.DEMO_PLAYWRIGHT_PATH ? require(process.env.DEMO_PLAYWRIGHT_PATH) : qa('playwright');
  const expectOff = process.env.DEMO_QA_EXPECT_OFF === '1';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { build: expectOff ? 'production bundle, VITE_DEMO_SPOT_ENABLED unset' : 'production bundle, VITE_DEMO_SPOT_ENABLED=true', groups: [], screenshots: [] };
  async function open(who, width, { dropFirstDemoOrder = false, dropFirstOrder = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    const bearer = await token(who);
    await context.addInitScript(([value]) => { localStorage.setItem('exchange_token', value); localStorage.setItem('exchange_lang', 'ru'); }, [bearer]);
    const page = await context.newPage();
    const calls = [], errors = [], accessAnswers = [], demoOrderBodies = [], orderBodies = [], balanceAnswers = [];
    let dropped = false;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', async response => {
      const answered = new URL(response.url()).pathname;
      if (answered === '/api/v1/demo/spot/access') accessAnswers.push(await response.json().catch(() => null));
      if (answered === '/api/v1/balances' || answered === '/api/v1/demo/balances') balanceAnswers.push(answered);
    });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();
      if (url.origin === origin && REAL.some(rx => rx.test(p))) {
        calls.push(`${request.method()} ${p}`);
        if (request.method() === 'POST' && p === '/api/v1/demo/orders') demoOrderBodies.push(request.postDataJSON());
        if (request.method() === 'POST' && p === '/api/v1/orders') orderBodies.push(request.postDataJSON());
        // A lost response: the server commits the order, the browser never hears back.
        if (!dropped && request.method() === 'POST' && ((dropFirstDemoOrder && p === '/api/v1/demo/orders') || (dropFirstOrder && p === '/api/v1/orders'))) {
          dropped = true; await route.fetch(); return route.abort('failed');
        }
        return route.continue();
      }
      const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.origin !== origin) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"external network disabled in QA"}' });
      if (request.method() !== 'GET') { calls.push(`UNEXPECTED ${request.method()} ${p}`); return route.fulfill({ status: 403, body: '{}' }); }
      if (p === '/api/v1/me') return reply({ id: who, email: `${who}@example.invalid`, displayName: 'QA', kycStatus: 'APPROVED', role: 'USER', isAdmin: false });
      if (p.includes('private-trading/access')) return reply({ allowed: false });
      if (p.includes('support/conversations/mine')) return reply({ conversation: null });
      if (p.includes('assets/icons')) return reply({ assets: {} });
      if (p.includes('external/rankings')) return reply({ source: 'isolated-qa', rankings: [] });
      if (p.includes('candles')) return reply({ pair: 'BTC/USDT', interval: url.searchParams.get('interval') || '1h', candles: CANDLES });
      if (p.includes('external/symbols')) return reply({ symbols: PAIRS });
      if (p.includes('/market/pairs')) return reply(PAIRS.map(pair => ({ pair, base: pair.split('/')[0], quote: 'USDT' })));
      if (p.includes('orderbook') || p.includes('/market/display/spot-book/')) return reply({ pair: 'BTC/USDT', bids: [{ price: '99990', quantity: '1' }], asks: [{ price: '100000', quantity: '1' }], timestamp: Date.now() });
      if (p === '/api/v1/market/display/spot-snapshot') return reply({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 }, tickers: { available: true, source: 'isolated-qa', fetchedAt: Date.now(), stale: false, value: PAIRS.map(pair => ({ pair, lastPrice: '100000', high24h: '100200', low24h: '99000', changePercent24h: '1', quoteVolume24h: '1000000', volume24h: '100' })) }, overview: { available: false }, sentiment: { available: false } });
      if (['/api/v1/market/test-assets', '/api/v1/market/nrx', '/api/v1/market/listings'].includes(p)) return reply({ serverTime: Date.now(), assets: [] });
      if (p.includes('tickers')) return reply({ tickers: PAIRS.map(pair => ({ pair, lastPrice: 100000, high24h: 100200, low24h: 99000, changePercent: 1, quoteVolume24h: 1e6, volume24h: 100 })) });
      return reply([]);
    });
    await page.goto(origin + '/trade?pair=BTC/USDT', { waitUntil: 'domcontentloaded' });
    await page.locator('.spot-terminal').waitFor();
    const mobile = width < 900;
    if (mobile) await page.locator('#mobile-trade-trade').click();
    await page.locator('form.order-form-content').waitFor();
    return { page, context, calls, errors, mobile, accessAnswers, demoOrderBodies, orderBodies, balanceAnswers };
  }
  const form = page => page.locator('form.order-form-content');
  async function limitOrder(page, price, quantity) {
    const select = page.locator('.order-type-select select');
    if (await select.count()) await select.selectOption('LIMIT');
    else await page.locator('.order-type-tab', { hasText: 'Лимит' }).first().click();
    await form(page).locator('input[aria-label="Цена"][type="number"]').fill(String(price));
    await form(page).locator('input[aria-label="Количество"]:not([type="range"])').fill(String(quantity));
    await form(page).locator('button[type="submit"]').click();
  }
  const settle = page => page.waitForTimeout(1200);
  const posts = calls => calls.filter(c => c.startsWith('POST '));
  const familyCount = async (page, mobile) => mobile
    ? page.locator('.order-type-select select option').count()
    : page.locator('.order-type-tabs').first().locator('.order-type-tab').count();
  // Until the server's access answer arrives the terminal stays fail-closed
  // (LIMIT/MARKET, nothing sent): wait for the settled state before acting.
  const settledFamilies = async (page, mobile, expected) => {
    for (let i = 0; i < 150 && await familyCount(page, mobile) !== expected; i++) await page.waitForTimeout(100);
    return familyCount(page, mobile);
  };
  const bal = async (who, asset) => { const b = await prisma.balance.findUnique({ where: { userId_asset: { userId: who, asset } } }); return { available: b ? b.available.toFixed() : '0', locked: b ? b.locked.toFixed() : '0' }; };
  const bearer = async (method, route, who, body) => fetch(origin + '/api/v1' + route, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token(who) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const quiet = async (page, calls) => {
    assert.deepEqual(posts(calls), [], 'no order request of any kind');
    assert.equal(await form(page).locator('button[type="submit"]').isDisabled(), false, 'Buy/Sell stays clickable');
    assert.equal(await page.locator('.toast-item').count(), 0, 'no toast');
    assert.equal(await form(page).locator('[role="alert"]').count(), 0, 'no error line');
  };
  const traderReady = page => page.waitForFunction(() => {
    const text = document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '';
    return /USDT/.test(text) && !/^0\.00/.test(text.trim());
  }, null, { timeout: 15000 });
  try {
    if (expectOff) {
      // Default build: the terminal never asks, and an order goes to the ordinary ledger as before.
      setEnabled(true);
      const { page, context, calls, errors, mobile } = await open('tester', 1440);
      await limitOrder(page, 90000, 0.0001); await settle(page);
      assert.deepEqual(calls.filter(c => c.includes('/demo/')), [], 'a default build never reaches the demo ledger');
      assert.deepEqual(posts(calls), ['POST /api/v1/orders']);
      assert.equal(await familyCount(page, mobile), 5, 'all five ordinary order families');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, 'demo-off-1440.png') }); report.screenshots.push('demo-off-1440.png');
      await context.close();
      // A Balance-credited tester in the default build: the ordinary order exactly as before — no request ID.
      {
        const { page, context, calls, errors, orderBodies } = await open('legacy', 1440);
        await traderReady(page);
        await limitOrder(page, 90000, 0.0001); await settle(page);
        assert.deepEqual(posts(calls), ['POST /api/v1/orders']);
        assert.equal('requestId' in orderBodies[0], false, 'the default build sends the ordinary body unchanged');
        const row = await prisma.order.findFirst({ where: { userId: 'legacy', status: 'OPEN', price: '90000' } });
        assert.ok(row, 'placed on the ordinary ledger');
        assert.equal((await bearer('DELETE', '/orders/' + row.id, 'legacy')).status, 204);
        assert.deepEqual(calls.filter(c => c.includes('/demo/')), []);
        assert.deepEqual(errors, []);
        await context.close();
      }
      report.groups.push('default-OFF build: no demo request at all; Buy goes to the ordinary /orders as before (no request ID); five order families; a Balance-credited tester places and cancels as before');
      return report;
    }
    await topUp('tester', 'USDT', '1000');
    // Resting demo liquidity from another admitted tester (no invented fill).
    const maker = await fetch(origin + '/api/v1/demo/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token('maker') },
      body: JSON.stringify({ pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '100000', quantity: '0.002' }) });
    assert.equal(maker.status, 201);

    for (const width of [1440, 390]) {
      // 1. No admin credit: Buy is clickable, nothing is sent, nothing is shown.
      {
        const { page, context, calls, errors, mobile } = await open('unfunded', width);
        assert.equal(await familyCount(page, mobile), 2, 'LIMIT and MARKET only on the demo ledger');
        await limitOrder(page, 100000, 0.0001); await settle(page);
        assert.deepEqual(posts(calls), [], 'a silent account sends no order of any kind');
        assert.equal(await form(page).locator('button[type="submit"]').isDisabled(), false, 'Buy stays clickable');
        assert.equal(await page.locator('.toast-item').count(), 0, 'no toast');
        assert.equal(await form(page).locator('[role="alert"]').count(), 0, 'no error line');
        assert.match(await form(page).locator('.available-balance .amount').innerText(), /^0\.00\s+USDT$/);
        assert.deepEqual(calls.filter(c => c.startsWith('GET /api/v1/demo/') && c !== 'GET /api/v1/demo/spot/access'), [], 'no demo ledger read for a silent account');
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(out, `demo-silent-${width}.png`) }); report.screenshots.push(`demo-silent-${width}.png`);
        await context.close();
      }
      // 2. Admitted tester: LIMIT reserve and cancel through the ordinary panels.
      {
        const { page, context, calls, errors, mobile } = await open('tester', width);
        assert.equal(await familyCount(page, mobile), 2);
        await traderReady(page);
        const before = await demoBal('tester', 'USDT');
        await limitOrder(page, 90000, 0.0001); await settle(page);
        assert.deepEqual(posts(calls), ['POST /api/v1/demo/orders']);
        const locked = await demoBal('tester', 'USDT');
        assert.equal(Number(locked.locked) - Number(before.locked), 9);
        const row = await prisma.demoOrder.findFirst({ where: { userId: 'tester', status: 'OPEN', price: '90000' } });
        // A reload keeps the order: it is read back from the demo ledger.
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.spot-terminal').waitFor();
        if (mobile) await page.locator('#mobile-trade-account').click();
        await page.locator('#spot-tab-open').click();
        await page.locator(`[data-order-id="${row.id}"]`).waitFor();
        await page.locator(`[data-order-id="${row.id}"] button`).click();
        await page.locator(`[data-order-id="${row.id}"]`).waitFor({ state: 'detached' });
        assert.deepEqual(await demoBal('tester', 'USDT'), before);
        assert.ok(calls.includes(`DELETE /api/v1/demo/orders/${row.id}`));
        assert.deepEqual(calls.filter(c => /^(POST|DELETE) \/api\/v1\/orders/.test(c)), [], 'never the real ledger');
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(out, `demo-trader-${width}.png`) }); report.screenshots.push(`demo-trader-${width}.png`);
        await context.close();
      }
    }
    // 2b. Uncertain outcome: the first response is lost after the commit; pressing Buy again
    //     with the same terms reuses the request ID and gets the SAME order — never a second one.
    {
      const { page, context, calls, errors, demoOrderBodies } = await open('tester', 1440, { dropFirstDemoOrder: true });
      await traderReady(page);
      const before = await demoBal('tester', 'USDT');
      await limitOrder(page, 85000, 0.0001); await settle(page);
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester', price: '85000' } }), 1, 'the first attempt committed');
      await form(page).locator('button[type="submit"]').click(); await settle(page);
      assert.equal(demoOrderBodies.length, 2);
      assert.equal(demoOrderBodies[0].requestId, demoOrderBodies[1].requestId, 'the retry reuses the request ID');
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester', price: '85000' } }), 1, 'still one order');
      assert.equal(Number((await demoBal('tester', 'USDT')).locked) - Number(before.locked), 8.5, 'reserved once');
      assert.equal(await page.locator('.toast-item', { hasText: 'Ордер размещён' }).count() > 0, true);
      const row = await prisma.demoOrder.findFirst({ where: { userId: 'tester', price: '85000', status: 'OPEN' } });
      assert.equal((await fetch(origin + '/api/v1/demo/orders/' + row.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + await token('tester') } })).status, 204);
      assert.deepEqual(calls.filter(c => /^(POST|DELETE) \/api\/v1\/orders/.test(c)), []);
      assert.deepEqual(errors, []);
      await context.close();
    }
    // 3. MARKET against resting demo depth; history and assets from the demo ledger (desktop).
    {
      const { page, context, calls, errors } = await open('tester', 1440);
      await traderReady(page);
      const btc = await demoBal('tester', 'BTC');
      await page.locator('.order-type-tab', { hasText: 'Рынок' }).first().click();
      await form(page).locator('input[aria-label="Количество"]:not([type="range"])').fill('0.0005');
      await form(page).locator('button[type="submit"]').click(); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/demo/orders']);
      assert.equal((Number((await demoBal('tester', 'BTC')).available) - Number(btc.available)).toFixed(4), '0.0005');
      await page.locator('#spot-tab-orderHistory').click();
      const filled = await prisma.demoOrder.findFirst({ where: { userId: 'tester', type: 'MARKET', originalQuantity: '0.0005', status: 'FILLED' } });
      await page.locator(`[data-order-id="${filled.id}"]`).waitFor();
      await page.locator('#spot-tab-assets').click();
      // The table header renders before the demo balances arrive: wait for the BTC row itself.
      await page.locator('#spot-bottom-content td.spot-order-pair', { hasText: /^BTC$/ }).first().waitFor({ timeout: 15000 });
      assert.doesNotMatch(await page.locator('#spot-bottom-content').innerText(), /Загрузка/);
      // 4. More than the demo balance: «not enough» from the server, nothing placed.
      const count = await prisma.demoOrder.count({ where: { userId: 'tester' } });
      await limitOrder(page, 100000, 1); await settle(page);
      assert.match(await form(page).locator('[role="alert"]').first().innerText(), /Недостаточно USDT/);
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'tester' } }), count);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, 'demo-market-history-1440.png') }); report.screenshots.push('demo-market-history-1440.png');
      await context.close();
    }
    // 4b. An account funded earlier through an ordinary Balance adjustment keeps the ordinary
    //     terminal with both flags on: five families, real /orders, its own open orders; reload keeps them.
    {
      const { page, context, calls, errors, mobile, accessAnswers } = await open('funded', 1440);
      assert.equal(await settledFamilies(page, mobile, 5), 5);
      assert.deepEqual(accessAnswers, [{ enabled: true, admitted: false, ledger: 'spot' }]);
      await page.waitForFunction(() => /USDT/.test(document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '')
        && !/^0\.00/.test((document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '').trim()), null, { timeout: 15000 });
      await limitOrder(page, 90000, 0.0001); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/orders']);
      const real = await prisma.order.findFirst({ where: { userId: 'funded', status: 'OPEN', price: '90000' } });
      assert.ok(real, 'placed on the ordinary Spot ledger');
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.spot-terminal').waitFor();
      await page.locator('#spot-tab-open').click();
      await page.locator(`[data-order-id="${real.id}"]`).waitFor();
      await page.locator(`[data-order-id="${real.id}"] button`).click();
      await page.locator(`[data-order-id="${real.id}"]`).waitFor({ state: 'detached' });
      assert.ok(calls.includes(`DELETE /api/v1/orders/${real.id}`));
      assert.deepEqual(calls.filter(c => /^(POST|DELETE) \/api\/v1\/demo\//.test(c)), [], 'never the demo ledger');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, 'spot-ledger-funded-1440.png') }); report.screenshots.push('spot-ledger-funded-1440.png');
      await context.close();
    }
    // 6. A tester an admin credited on the ordinary ledger (Balance) before Demo Spot: with Demo Spot on it
    //    keeps the ordinary terminal and ledger — five families, real balance, LIMIT reserve, reload, cancel.
    await credit('legacyMaker', 'BTC', '0.002');
    for (const width of [1440, 390]) {
      const { page, context, calls, errors, mobile, accessAnswers, orderBodies } = await open('legacy', width);
      assert.equal(await settledFamilies(page, mobile, 5), 5, 'all five ordinary order families');
      assert.deepEqual(accessAnswers, [{ enabled: true, admitted: false, ledger: 'spot' }]);
      await traderReady(page);
      const before = await bal('legacy', 'USDT');
      await limitOrder(page, 90000, 0.0001); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/orders'], 'the ordinary ledger, never the demo one');
      assert.match(orderBodies[0].requestId, /^[0-9a-f-]{36}$/, 'with a request ID while Demo Spot is on');
      assert.equal(Number((await bal('legacy', 'USDT')).locked) - Number(before.locked), 9);
      const row = await prisma.order.findFirst({ where: { userId: 'legacy', status: 'OPEN', price: '90000' } });
      // Reload: the open order is read back from the server.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.spot-terminal').waitFor();
      if (mobile) await page.locator('#mobile-trade-account').click();
      await page.locator('#spot-tab-open').click();
      await page.locator(`[data-order-id="${row.id}"]`).waitFor({ timeout: 15000 });
      await page.locator(`[data-order-id="${row.id}"] button`).click();
      await page.locator(`[data-order-id="${row.id}"]`).waitFor({ state: 'detached' });
      assert.deepEqual(await bal('legacy', 'USDT'), before);
      assert.ok(calls.includes(`DELETE /api/v1/orders/${row.id}`));
      assert.deepEqual(calls.filter(c => /^(POST|DELETE) \/api\/v1\/demo\//.test(c)), [], 'never the demo ledger');
      assert.equal(await prisma.demoBalance.count({ where: { userId: 'legacy' } }), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, `legacy-balance-${width}.png`) }); report.screenshots.push(`legacy-balance-${width}.png`);
      await context.close();
    }
    // 7. Same tester: MARKET fill against resting ordinary depth, history, «not enough» above the balance (desktop).
    {
      assert.equal((await bearer('POST', '/orders', 'legacyMaker', { pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '100000', quantity: '0.0002' })).status, 201);
      const { page, context, calls, errors } = await open('legacy', 1440);
      await traderReady(page);
      const btc = await bal('legacy', 'BTC');
      await page.locator('.order-type-tab', { hasText: 'Рынок' }).first().click();
      await form(page).locator('input[aria-label="Количество"]:not([type="range"])').fill('0.0001');
      await form(page).locator('button[type="submit"]').click(); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/orders']);
      assert.equal((Number((await bal('legacy', 'BTC')).available) - Number(btc.available)).toFixed(4), '0.0001');
      const filled = await prisma.order.findFirst({ where: { userId: 'legacy', type: 'MARKET', status: 'FILLED' }, orderBy: { createdAt: 'desc' } });
      await page.locator('#spot-tab-orderHistory').click();
      await page.locator(`[data-order-id="${filled.id}"]`).waitFor({ timeout: 15000 });
      const count = await prisma.order.count({ where: { userId: 'legacy' } });
      await limitOrder(page, 100000, 1); await settle(page);
      assert.match(await form(page).locator('[role="alert"]').first().innerText(), /Недостаточно USDT/);
      assert.equal(await prisma.order.count({ where: { userId: 'legacy' } }), count);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, 'legacy-market-1440.png') }); report.screenshots.push('legacy-market-1440.png');
      await context.close();
      const rest = await prisma.order.findFirst({ where: { userId: 'legacyMaker', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
      if (rest) assert.equal((await bearer('DELETE', '/orders/' + rest.id, 'legacyMaker')).status, 204);
    }
    // 8. Lost response on the ordinary ledger: committed, the browser never hears back; Buy again → one order.
    {
      const { page, context, calls, errors, orderBodies } = await open('legacy', 1440, { dropFirstOrder: true });
      await traderReady(page);
      const before = await bal('legacy', 'USDT');
      await limitOrder(page, 85000, 0.0001); await settle(page);
      assert.equal(await prisma.order.count({ where: { userId: 'legacy', price: '85000' } }), 1, 'the first attempt committed');
      await form(page).locator('button[type="submit"]').click(); await settle(page);
      assert.equal(orderBodies.length, 2); assert.equal(orderBodies[0].requestId, orderBodies[1].requestId, 'the retry reuses the request ID');
      assert.equal(await prisma.order.count({ where: { userId: 'legacy', price: '85000' } }), 1, 'still one order');
      assert.equal(Number((await bal('legacy', 'USDT')).locked) - Number(before.locked), 8.5, 'reserved once');
      const row = await prisma.order.findFirst({ where: { userId: 'legacy', price: '85000', status: 'OPEN' } });
      assert.equal((await bearer('DELETE', '/orders/' + row.id, 'legacy')).status, 204);
      assert.deepEqual(calls.filter(c => c.includes('/demo/orders')), []);
      assert.deepEqual(errors, []);
      await context.close();
    }
    // 9. Nothing on the balance a side spends (either ledger): Buy is clickable, nothing is sent or shown; Sell works.
    await credit('legacySeller', 'BTC', '0.001');
    await topUp('demoSeller', 'BTC', '0.001');
    for (const width of [1440, 390]) {
      for (const [who, route] of [['legacySeller', '/api/v1/orders'], ['demoSeller', '/api/v1/demo/orders']]) {
        const { page, context, calls, errors, balanceAnswers } = await open(who, width);
        // The account's own balance has answered (0 USDT on the side Buy spends).
        for (let i = 0; i < 150 && !balanceAnswers.includes(route.replace('/orders', '/balances')); i++) await page.waitForTimeout(100);
        await page.waitForTimeout(500);
        assert.match(await form(page).locator('.available-balance .amount').innerText(), /^0\.00\s+USDT$/);
        await limitOrder(page, 100000, 0.0001); await settle(page);
        await quiet(page, calls);
        // Sell spends BTC, which is there: the order goes out on this account's ledger.
        await page.locator('.order-form-tab.sell:visible').first().click();
        await page.waitForFunction(() => /BTC/.test(document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '') && !/^0\.0+\s/.test((document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '').trim()), null, { timeout: 15000 });
        await limitOrder(page, 300000, 0.0001); await settle(page);
        assert.deepEqual(posts(calls), ['POST ' + route]);
        assert.deepEqual(errors, []);
        if (width === 1440) { await page.screenshot({ path: path.join(out, `zero-${who}-${width}.png`) }); report.screenshots.push(`zero-${who}-${width}.png`); }
        await context.close();
        const open_ = who === 'legacySeller'
          ? await prisma.order.findFirst({ where: { userId: who, status: 'OPEN' } }) : await prisma.demoOrder.findFirst({ where: { userId: who, status: 'OPEN' } });
        assert.equal((await bearer('DELETE', (who === 'legacySeller' ? '/orders/' : '/demo/orders/') + open_.id, who)).status, 204);
      }
    }
    // 5. Frontend flag alone activates nothing: server flag off → the ordinary ledger, no demo order.
    {
      setEnabled(false);
      const { page, context, calls, errors, mobile, accessAnswers } = await open('tester', 1440);
      assert.equal(await settledFamilies(page, mobile, 5), 5);
      assert.deepEqual(accessAnswers, [{ enabled: false, admitted: false, ledger: 'spot' }], 'the server answered: off');
      await limitOrder(page, 90000, 0.0001); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/orders'], 'server flag off: ordinary /orders (refused: no Balance)');
      assert.deepEqual(errors, []);
      setEnabled(true);
      await context.close();
    }
    report.groups.push(
      'no admin credit (1440, 390): Buy clickable; no order request, toast or error line; balance 0.00; no demo ledger read',
      'admitted tester (1440, 390): LIMIT + MARKET only; LIMIT reserves exactly on the demo ledger; the order survives a reload; cancel from the open-orders row restores it; never the real ledger',
      'lost response after commit (1440): pressing Buy again reuses the request ID and returns the same order — one order, one reserve',
      'Balance-funded account (earlier admin Balance credit), both flags on: ordinary terminal, real /orders, open order survives a reload and cancels — never the demo ledger',
      'MARKET fills resting demo depth; history shows the FILLED order; assets from the demo ledger; over-balance shows «Недостаточно USDT», nothing placed',
      'server flag off with the build flag on: five ordinary families, Buy goes to /orders (the frontend flag alone activates nothing)',
      'Balance-credited tester, Demo Spot on (1440, 390): access ledger "spot"; five families; real balance; LIMIT on /orders with a request ID reserves exactly; reload keeps the open order; cancel restores; never the demo ledger',
      'Balance-credited tester (1440): MARKET fills resting ordinary depth; history shows it; above the balance «Недостаточно USDT», nothing placed',
      'lost /orders response after commit (1440): Buy again reuses the request ID — one order, one reserve',
      'nothing on the spent side (1440, 390), both ledgers: Buy clickable, no request, toast or error line; Sell goes out on the account\'s own ledger');
    return report;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, expectOff ? 'browser-off-results.json' : 'browser-results.json'), JSON.stringify(report, null, 2));
  }
}
module.exports = { run };
