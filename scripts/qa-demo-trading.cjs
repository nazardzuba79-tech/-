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
const REAL = [/^\/api\/v1\/demo\//, /^\/api\/v1\/orders(\/|$)/, /^\/api\/v1\/withdrawals/];

async function run({ origin, out, token, setEnabled, topUp, demoBal, prisma }) {
  const qa = createRequire(path.resolve(root, process.env.DEMO_QA_DEPS || 'output/demo-qa-deps/package.json'));
  const { chromium } = process.env.DEMO_PLAYWRIGHT_PATH ? require(process.env.DEMO_PLAYWRIGHT_PATH) : qa('playwright');
  const expectOff = process.env.DEMO_QA_EXPECT_OFF === '1';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { build: expectOff ? 'production bundle, VITE_DEMO_SPOT_ENABLED unset' : 'production bundle, VITE_DEMO_SPOT_ENABLED=true', groups: [], screenshots: [] };
  async function open(who, width) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    const bearer = await token(who);
    await context.addInitScript(([value]) => { localStorage.setItem('exchange_token', value); localStorage.setItem('exchange_lang', 'ru'); }, [bearer]);
    const page = await context.newPage();
    const calls = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();
      if (url.origin === origin && REAL.some(rx => rx.test(p))) { calls.push(`${request.method()} ${p}`); return route.continue(); }
      const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.origin !== origin) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"external network disabled in QA"}' });
      if (request.method() !== 'GET') { calls.push(`UNEXPECTED ${request.method()} ${p}`); return route.fulfill({ status: 403, body: '{}' }); }
      if (p === '/api/v1/me') return reply({ id: who, email: `${who}@example.invalid`, displayName: 'QA', kycStatus: 'APPROVED', role: 'USER', isAdmin: false });
      if (p === '/api/v1/balances') return reply([]);
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
    return { page, context, calls, errors, mobile };
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
      report.groups.push('default-OFF build: no demo request at all; Buy goes to the ordinary /orders as before; five order families');
      await context.close();
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
    // 5. Frontend flag alone activates nothing: server flag off → the ordinary ledger, no demo order.
    {
      setEnabled(false);
      const { page, context, calls, errors, mobile } = await open('tester', 1440);
      assert.equal(await settledFamilies(page, mobile, 5), 5);
      assert.ok(calls.includes('GET /api/v1/demo/spot/access'));
      await limitOrder(page, 90000, 0.0001); await settle(page);
      assert.deepEqual(posts(calls), ['POST /api/v1/orders'], 'server flag off: ordinary /orders (refused: no Balance)');
      assert.deepEqual(errors, []);
      setEnabled(true);
      await context.close();
    }
    report.groups.push(
      'no admin credit (1440, 390): Buy clickable; no order request, toast or error line; balance 0.00; no demo ledger read',
      'admitted tester (1440, 390): LIMIT + MARKET only; LIMIT reserves exactly on the demo ledger; cancel from the open-orders row restores it; never the real ledger',
      'MARKET fills resting demo depth; history shows the FILLED order; assets from the demo ledger; over-balance shows «Недостаточно USDT», nothing placed',
      'server flag off with the build flag on: five ordinary families, Buy goes to /orders (the frontend flag alone activates nothing)');
    return report;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, expectOff ? 'browser-off-results.json' : 'browser-results.json'), JSON.stringify(report, null, 2));
  }
}
module.exports = { run };
