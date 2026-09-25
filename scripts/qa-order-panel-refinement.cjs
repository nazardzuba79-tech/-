/* Real built UI against the disposable native fixture; never production trades. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.QA_OUTPUT_DIR || path.join(root, 'docs/qa/order-panel-refinement');
const port = process.env.QA_PORT || '4393', origin = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.mkdirSync(out, { recursive: true });
const log = fs.openSync(path.join(out, 'server.log'), 'w');
const server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], {
  cwd: root, env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1' },
  stdio: ['ignore', log, log], windowsHide: true,
});
let browser;
const report = { fixtureOnly: true, errors: [], viewports: [] };
(async () => {
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Fixture exited: ${server.exitCode}`);
    try { const h = await (await fetch(origin + '/health')).json(); healthy = h.fixtureMarket && h.kind === 'isolated-native-demo-preview'; } catch {}
    if (healthy) break;
    await delay(500);
  }
  assert(healthy, 'Disposable fixture did not start');
  browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}) });
  for (const width of [1920, 1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width > 900 ? 1080 : 844 } });
    const html = await (await context.request.get(origin + '/futures')).text();
    const token = JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
    const headers = { Authorization: 'Bearer ' + token };
    const state = await (await context.request.get(origin + '/api/v1/private-trading/native/state', { headers })).json();
    if (!state.initialized) {
      const r = await context.request.post(origin + '/api/v1/private-trading/native/initialize', { headers, data: { acceptedModel: state.model.version, idempotencyKey: 'qa-order-panel-existing-fixture' } });
      assert(r.ok(), 'Fixture initialization failed');
    }
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(origin + '/futures');
    await page.locator('.chart-surface').waitFor();
    if (width <= 900) await page.locator('#mobile-futures-trade').click();
    const toggle = page.locator('.archive-protection-toggle');
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.futures-terminal-status').count(), 0);
    assert(!/Мейкер|Тейкер/.test(await page.locator('.order-form-area').innerText()), 'Fee strip still rendered');
    await page.locator('.fo-qtyInputRow input').fill('0.012');
    await toggle.click();
    const tp = page.locator('[data-entry-take-profit]'), sl = page.locator('[data-entry-stop-loss]');
    await tp.fill('95000'); await sl.fill('70000');
    await toggle.click();
    await tp.waitFor({ state: 'hidden' });
    assert(await tp.isDisabled(), 'Collapsed protection must be disabled');
    await toggle.click();
    assert.equal(await tp.inputValue(), '95000', 'TP value lost on collapse');
    assert.equal(await sl.inputValue(), '70000', 'SL value lost on collapse');
    assert.equal(await page.locator('.fo-qtyInputRow input').inputValue(), '0.012');
    const reduceOnly = page.locator('.fo-reduceOnlyRow input');
    await reduceOnly.check();
    assert.equal(await toggle.count(), 0, 'Entry protection must not appear on a reduce-only order');
    await reduceOnly.uncheck();
    const limits = page.locator('.fo-positionLimits');
    assert.equal(await limits.getAttribute('open'), null);
    await limits.locator('summary').click();
    assert(await limits.evaluate(e => e.open));
    assert(await limits.locator('.mono').isVisible());
    await limits.locator('summary').click();
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    const geometry = await page.evaluate(() => {
      const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { height: r.height, width: r.width, left: r.left, right: r.right }; };
      return { price: rect('.fo-priceField'), quantity: rect('.fo-qtyInputRow'), long: rect('.fo-submitPair .buy'), short: rect('.fo-submitPair .sell'), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.equal(geometry.overflow, 0, 'Horizontal page overflow');
    assert.equal(geometry.price.height, 48); assert.equal(geometry.quantity.height, 48);
    assert(Math.abs(geometry.price.width - geometry.quantity.width) < 1);
    assert.equal(geometry.long.height, geometry.short.height);
    assert(geometry.long.height >= 50);
    assert(Math.abs(geometry.long.width - geometry.short.width) < 1);
    await page.locator('.order-family-tabs').getByText('Рыночный', { exact: true }).click();
    const marketHeight = await page.locator('.fo-priceField').evaluate(e => e.getBoundingClientRect().height);
    assert.equal(marketHeight, 48, 'Market price field must match quantity height');
    await page.locator('.order-family-tabs').getByText('Лимитный', { exact: true }).click();
    for (const side of ['buy', 'sell']) {
      const button = page.locator('.fo-submitPair .' + side);
      await button.scrollIntoViewIfNeeded();
      assert(await button.isVisible());
      assert(await button.evaluate(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'CTA covered by another panel');
    }
    if (width > 900) await page.locator('.order-form-area').evaluate(e => { e.scrollTop = 0; });
    else await page.locator('.fo-priceField').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${width}.png`) });
    report.viewports.push({ width, passed: true, geometry, protectionRetained: true, limitsAccessible: true, feeStripRemoved: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log('PASS', JSON.stringify(report));
})().catch(e => { report.errors.push(e.stack); console.error(e); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  server.kill(); fs.closeSync(log);
});
