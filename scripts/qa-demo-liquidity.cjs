'use strict';
// Internal demo liquidity in the real Spot terminal (production bundle, VITE_DEMO_SPOT_ENABLED=true):
// /api/v1/demo/* reaches the real router on the disposable PostgreSQL started by
// test-demo-liquidity-postgres.cjs; unrelated market reads are fixtures; every other host is
// refused. The terminal is unchanged — what changes is that a MARKET order has a counterparty.
const assert = require('node:assert/strict');
const path = require('path'), { createRequire } = require('module');
const BigNumber = require('bignumber.js');
const root = path.resolve(__dirname, '..');

const PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: Math.floor(Date.now() / 60000) * 60 - (120 - i) * 60, open: 99900, high: 100200, low: 99800, close: 100000, volume: 12 }));

async function run({ origin, out, token, prisma, demoBal, topUp, reference, conserved }) {
  const qa = createRequire(path.resolve(root, process.env.DEMO_QA_DEPS || 'output/demo-qa-deps/package.json'));
  const { chromium } = process.env.DEMO_PLAYWRIGHT_PATH ? require(process.env.DEMO_PLAYWRIGHT_PATH) : qa('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { build: 'production bundle, VITE_DEMO_SPOT_ENABLED=true', groups: [], screenshots: [], lines: {} };
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
      if (url.origin === origin && p.startsWith('/api/v1/demo/')) { calls.push(`${request.method()} ${p}`); return route.continue(); }
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
    // The demo ledger answered: its USDT balance is shown.
    await page.waitForFunction(() => {
      const text = document.querySelector('form.order-form-content .available-balance .amount')?.textContent ?? '';
      return /USDT/.test(text) && !/^0\.00/.test(text.trim());
    }, null, { timeout: 15000 });
    return { page, context, calls, errors, mobile };
  }
  const form = page => page.locator('form.order-form-content');
  const settle = page => page.waitForTimeout(1200);
  const pickType = async (page, label, value) => {
    const select = page.locator('.order-type-select select');
    if (await select.count()) await select.selectOption(value);
    else await page.locator('.order-type-tab', { hasText: label }).first().click();
  };
  async function order(page, side, type, quantity, price) {
    await page.locator(`.order-form-tab.${side === 'BUY' ? 'buy' : 'sell'}:visible`).first().click();
    await pickType(page, type === 'MARKET' ? 'Рынок' : 'Лимит', type);
    if (price !== undefined) await form(page).locator('input[aria-label="Цена"][type="number"]').fill(String(price));
    await form(page).locator('input[aria-label="Количество"]:not([type="range"])').fill(String(quantity));
    await form(page).locator('button[type="submit"]').click();
    await settle(page);
  }
  const alertLine = page => form(page).locator('[role="alert"]').first().innerText().catch(() => '');
  const posts = calls => calls.filter(c => c.startsWith('POST ') || c.startsWith('UNEXPECTED'));
  const latest = (who, where = {}) => prisma.demoOrder.findFirst({ where: { userId: who, ...where }, orderBy: { createdAt: 'desc' } });
  try {
    await topUp('qaTrader', 'USDT', '1000'); await topUp('qaTrader', 'BTC', '0.01');
    for (const width of [1440, 390]) {
      const { page, context, calls, errors, mobile } = await open('qaTrader', width);
      const before = { usdt: await demoBal('qaTrader', 'USDT'), btc: await demoBal('qaTrader', 'BTC') };
      // 1. MARKET BUY on an empty demo book: filled by the liquidity account at the reference ask + spread.
      await order(page, 'BUY', 'MARKET', '0.001');
      const buy = await latest('qaTrader', { side: 'BUY', type: 'MARKET' });
      assert.equal(buy.status, 'FILLED');
      const buyTrade = await prisma.demoTrade.findFirst({ where: { takerOrderId: buy.id } });
      assert.equal(buyTrade.price.toFixed(), '100100');
      assert.equal(await page.locator('.toast-item', { hasText: 'Ордер размещён' }).count() > 0, true, 'the ordinary success feedback');
      // 2. MARKET SELL: filled at the reference bid − spread.
      await order(page, 'SELL', 'MARKET', '0.001');
      const sell = await latest('qaTrader', { side: 'SELL', type: 'MARKET' });
      assert.equal(sell.status, 'FILLED');
      assert.equal((await prisma.demoTrade.findFirst({ where: { takerOrderId: sell.id } })).price.toFixed(), '99890.01');
      // 3. A crossing LIMIT BUY fills at the quote; a passive LIMIT rests, shows in open orders and cancels.
      await order(page, 'BUY', 'LIMIT', '0.001', 101000);
      assert.equal((await latest('qaTrader', { side: 'BUY', type: 'LIMIT' })).status, 'FILLED');
      await order(page, 'BUY', 'LIMIT', '0.001', 95000);
      const resting = await latest('qaTrader', { side: 'BUY', type: 'LIMIT' });
      assert.equal(resting.status, 'OPEN');
      if (mobile) await page.locator('#mobile-trade-account').click();
      await page.locator('#spot-tab-open').click();
      await page.locator(`[data-order-id="${resting.id}"]`).waitFor();
      await page.locator(`[data-order-id="${resting.id}"] button`).click();
      await page.locator(`[data-order-id="${resting.id}"]`).waitFor({ state: 'detached' });
      // History shows the filled MARKET order from the demo ledger.
      await page.locator('#spot-tab-orderHistory').click();
      await page.locator(`[data-order-id="${buy.id}"]`).waitFor();
      await page.screenshot({ path: path.join(out, `liquidity-filled-${width}.png`), fullPage: mobile }); report.screenshots.push(`liquidity-filled-${width}.png`);
      if (mobile) await page.locator('#mobile-trade-trade').click();
      // Balances: exactly the fills, nothing reserved afterwards.
      const paid = new BigNumber('100.1').plus('100.1').minus('99.89001'); // two buys at 100100, one sell at 99890.01
      assert.deepEqual(await demoBal('qaTrader', 'USDT'), { available: new BigNumber(before.usdt.available).minus(paid).toFixed(), locked: '0' });
      assert.deepEqual(await demoBal('qaTrader', 'BTC'), { available: new BigNumber(before.btc.available).plus('0.001').toFixed(), locked: '0' });
      // 4. More than the balance: the existing «not enough» line, nothing placed.
      const count = await prisma.demoOrder.count({ where: { userId: 'qaTrader' } });
      await order(page, 'BUY', 'MARKET', '1');
      const notEnough = await alertLine(page);
      assert.match(notEnough, /Недостаточно USDT/);
      assert.equal(await prisma.demoOrder.count({ where: { userId: 'qaTrader' } }), count);
      // 5. Reference stale: no quote — the BUY is refused, the SELL is cancelled without a fill; nothing moves.
      const saved = { ...reference['BTC/USDT'] };
      reference['BTC/USDT'].ageMs = 60_000;
      const frozen = [await demoBal('qaTrader', 'USDT'), await demoBal('qaTrader', 'BTC')];
      await order(page, 'BUY', 'MARKET', '0.001');
      const refusedBuy = await alertLine(page);
      assert.ok(refusedBuy.length > 0, 'the refusal is visible');
      await order(page, 'SELL', 'MARKET', '0.001');
      const cancelledSell = await latest('qaTrader', { side: 'SELL', type: 'MARKET' });
      assert.equal(cancelledSell.status, 'CANCELLED');
      assert.equal(await prisma.demoTrade.count({ where: { takerOrderId: cancelledSell.id } }), 0);
      assert.deepEqual([await demoBal('qaTrader', 'USDT'), await demoBal('qaTrader', 'BTC')], frozen);
      Object.assign(reference['BTC/USDT'], saved);
      report.lines[width] = { notEnough, staleBuy: refusedBuy, staleSell: await alertLine(page) };
      assert.deepEqual(posts(calls).filter(c => c !== 'POST /api/v1/demo/orders'), [], 'only the demo ledger; no ordinary or external order');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, `liquidity-stale-${width}.png`), fullPage: mobile }); report.screenshots.push(`liquidity-stale-${width}.png`);
      await context.close();
      await conserved();
    }
    report.groups.push(
      'demo tester on an empty demo book (1440, 390): MARKET BUY fills at reference ask + 10 bps, MARKET SELL at reference bid − 10 bps, with the ordinary «Ордер размещён»',
      'crossing LIMIT fills at the quote; a passive LIMIT rests, appears in open orders and cancels; history shows the filled MARKET order; balances move by exactly the fills',
      'over-balance shows the existing «Недостаточно USDT», nothing placed',
      'stale reference: MARKET BUY refused with a visible line, MARKET SELL cancelled without a fill, balances unchanged; conservation holds; only /demo/orders was ever posted',
    );
    return report;
  } finally {
    await browser.close();
  }
}

module.exports = { run };
