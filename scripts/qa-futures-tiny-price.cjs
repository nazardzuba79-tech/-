/**
 * Actual built /futures UI + actual local NativeDemoService at a tiny price.
 * The opt-in fixture supplies matching marks, candles, book and contract rules.
 * Only per-browser synthetic accounts exist; outbound requests are blocked.
 * Build backend and frontend first, then:
 *   QA_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/qa-futures-tiny-price.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const port = process.env.QA_TINY_PRICE_PORT || '4395';
const origin = `http://127.0.0.1:${port}`;
const output = path.resolve(process.env.QA_TINY_PRICE_OUTPUT || path.join(root, 'docs/qa/futures-tiny-price'));
const PRICE = '0.0000001', QUANTITY = '100000000'; // 10 USDT notional; above the fixture's 5 USDT minimum.
const report = { fixtureOnly: true, productionVerified: false, price: PRICE, quantity: QUANTITY,
  checks: [], pageErrors: [], realAccountRequests: [], viewports: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, condition = true, evidence) => {
  assert.ok(condition, name);
  report.checks.push({ name, ...(evidence === undefined ? {} : { evidence }) });
  console.log('PASS', name);
};
fs.mkdirSync(output, { recursive: true });
const log = fs.openSync(path.join(output, 'server.log'), 'w');
const server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], {
  cwd: root,
  env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_TINY_PRICE_QA: '1',
    NATIVE_PREVIEW_THIN_CONTRACT_QA: '0', NATIVE_PREVIEW_AKE_DRIFT: '0' },
  stdio: ['ignore', log, log], windowsHide: true,
});
let browser, activePage;

async function api(context, token, endpoint, body) {
  const options = { headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { data: body }) };
  const response = await context.request[body === undefined ? 'get' : 'post'](`${origin}/api/v1/private-trading/native/${endpoint}`, options);
  const result = await response.json();
  assert.ok(response.ok(), `${endpoint}: ${response.status()} ${JSON.stringify(result)}`);
  return result;
}

async function invalid(page, input, raw, reason, label) {
  await input.fill(raw);
  await input.press('Tab');
  assert.equal(await input.inputValue(), raw, `${label}: raw draft changed`);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  const description = await input.getAttribute('aria-describedby');
  assert.ok(description, `${label}: missing accessible refusal`);
  const note = page.locator('.fo-inputRefusal').filter({ hasText: /./ });
  assert.ok(await note.count() > 0, `${label}: no visible explanation`);
  assert.equal(await input.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby'))?.getAttribute('data-input-refusal')), reason);
  assert.ok(await page.locator('.fo-submitPair .buy').isDisabled());
  assert.ok(await page.locator('.fo-submitPair .sell').isDisabled());
  check(label);
}

async function viewport(width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 },
    locale: 'ru-RU', timezoneId: 'UTC', hasTouch: width < 500 });
  try {
    const html = await (await context.request.get(`${origin}/futures`)).text();
    const match = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
    assert.ok(match, 'Fixture did not issue its disposable session');
    const token = JSON.parse(match[1]);
    let initial = await api(context, token, 'state');
    if (!initial.initialized) initial = await api(context, token, 'initialize', {
      acceptedModel: initial.model.version, idempotencyKey: 'qa-tiny-price-local-initialize',
    });
    assert.ok(initial.initialized && initial.account);
    const contract = await api(context, token, 'contracts/AKEUSDT');
    assert.equal(contract.tickSize, '0.00000001');
    assert.equal(contract.qtyStep, '1');
    check(`${width}: real engine contract accepts the tiny fixture tick`, true, contract);

    await context.route('**/*', (route) => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(20000);
    const commands = [];
    page.on('pageerror', (error) => report.pageErrors.push(`${width}: ${error.message}`));
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/native/commands') && request.method() === 'POST') commands.push(request.postDataJSON());
      if (pathname.startsWith('/api/v1/futures/') && (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        || /^\/api\/v1\/futures\/(balances|positions|orders|trades|fills|account|funding-history|transfers)(?:\/|$)/.test(pathname))) {
        report.realAccountRequests.push({ method: request.method(), path: pathname });
      }
    });
    await page.goto(`${origin}/futures?pair=AKE%2FUSDT`);
    await page.locator('.chart-surface').waitFor();
    if (width < 500) await page.locator('#mobile-futures-trade').click();
    const price = page.locator('.fo-priceInputRow input');
    const quantity = page.locator('.fo-qtyInputRow input');
    const buy = page.locator('.fo-submitPair .buy');
    await page.waitForFunction((expected) => document.querySelector('.fo-priceInputRow input')?.value === expected, PRICE);
    check(`${width}: automatic price is full decimal 0.0000001`, await price.inputValue() === PRICE);
    const header = page.locator('.futures-ticker-bar .futures-primary-price > .price');
    await header.waitFor({ state: 'visible' });
    await page.waitForFunction((expected) => {
      const header = document.querySelector('.futures-ticker-bar .futures-primary-price > .price');
      return Array.from(header?.childNodes ?? []).filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim() === expected;
    }, PRICE);
    const headerPrice = await header.evaluate(element => Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
    check(`${width}: positive header price is exactly 0.0000001`, headerPrice === PRICE && Number(headerPrice) > 0, { headerPrice });
    await quantity.fill(QUANTITY);
    await page.waitForFunction(() => !document.querySelector('.fo-submitPair .buy')?.disabled);

    await invalid(page, price, '1e-7', 'exponent', `${width}: typed scientific notation stays raw and blocks both sides`);
    await price.fill('0.0000001x');
    await invalid(page, price, '0.0000001x', 'character', `${width}: typed letters stay raw and block both sides`);
    await price.fill('.');
    check(`${width}: unfinished dot is unflagged and non-executable`, await price.getAttribute('aria-invalid') === null && await buy.isDisabled());
    await price.fill('0.0000002');
    await page.locator('.fo-lastPriceBtn').click();
    check(`${width}: last-price button restores full decimal and removes refusal`, await price.inputValue() === PRICE && await price.getAttribute('aria-invalid') === null);
    await invalid(page, quantity, '1e8', 'exponent', `${width}: typed exponent quantity cannot send an order`);
    await quantity.fill(QUANTITY);

    const protection = page.locator('.fo-tpslToggle input');
    await protection.check();
    const takeProfit = page.locator('[data-entry-take-profit]');
    const stopLoss = page.locator('[data-entry-stop-loss]');
    await invalid(page, takeProfit, '2e-7', 'exponent', `${width}: armed TP exponent blocks both sides with explanation`);
    await takeProfit.fill('0.0000002');
    await stopLoss.fill('0.00000005');
    check(`${width}: corrected TP/SL remove invalid state`, await takeProfit.getAttribute('aria-invalid') === null && await stopLoss.getAttribute('aria-invalid') === null);
    await protection.uncheck();
    check(`${width}: invalid drafts sent zero commands`, commands.length === 0);
    await page.waitForFunction(() => !document.querySelector('.fo-submitPair .buy')?.disabled);

    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/native/commands')
      && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'OPEN');
    await buy.click();
    const response = await responsePromise;
    const body = await response.json();
    const draft = response.request().postDataJSON();
    check(`${width}: actual local native engine accepts the tiny-price order`, response.ok(), { status: response.status(), draft });
    assert.equal(draft.type, 'LIMIT'); assert.equal(draft.symbol, 'AKEUSDT');
    assert.equal(draft.price, PRICE); assert.equal(draft.quantity, QUANTITY);
    assert.ok(body.initialized && body.account);
    const order = body.orders.find((row) => row.symbol === 'AKEUSDT' && row.price === PRICE && row.quantity === QUANTITY);
    assert.ok(order, `Accepted order missing from authoritative state: ${JSON.stringify(body.orders)}`);
    check(`${width}: authoritative order keeps the exact price and quantity`, true, { id: order.id, status: order.status, price: order.price, quantity: order.quantity });
    assert.equal(commands.length, 1, 'One click must produce one native command');
    await page.waitForFunction(() => document.querySelector('.fo-qtyInputRow input')?.value === '');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`${width}: no horizontal overflow after tiny-price submission`, overflow <= 0);
    await price.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `tiny-price-${width}.png`) });
    report.viewports.push({ width, accepted: true, headerPrice, exactPrice: draft.price, exactQuantity: draft.quantity, commandCount: commands.length, overflow });
  } catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { activePage = null; await context.close(); }
}

(async () => {
  let healthy = false;
  let readinessError = 'No health response';
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(`Local fixture exited ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      const health = await response.json();
      healthy = response.ok && health.kind === 'isolated-native-demo-preview' && health.fixtureMarket && health.tinyPriceFixture;
      if (!healthy) readinessError = `HTTP ${response.status}: ${JSON.stringify(health)}`;
    } catch (error) { readinessError = String(error); }
    if (healthy) break;
    await pause(500);
  }
  assert.ok(healthy, `Opt-in tiny fixture did not become healthy: ${readinessError}`);
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) await viewport(width);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.realAccountRequests, []);
  report.result = 'PASS';
})().catch(async (error) => {
  report.result = 'FAIL'; report.failure = String(error.stack || error);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (browser) await browser.close();
  server.kill(); fs.closeSync(log);
  console.log(JSON.stringify({ result: report.result, checks: report.checks.length, viewports: report.viewports }));
});
