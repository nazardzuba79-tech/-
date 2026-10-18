/**
 * Browser QA: a History20 model contract in the EXISTING Futures terminal,
 * on the isolated native demo review server (NATIVE_PREVIEW_FIXTURE=1 and
 * NATIVE_PREVIEW_HISTORY20_QA=1: one synthetic window, fixture venue,
 * per-browser synthetic account; every other origin is aborted).
 *
 * At 1440 and 390 px:
 * - the model pair is offered in the same market chooser, tagged as a model;
 * - the chart reads the private candle route under the model's own label;
 * - the model note is shown;
 * - MARKET Long and Short from the ordinary order form fill at the model price;
 * - a position closes from the positions table.
 * No request about the model contract reaches a venue route (mark, book,
 * tape, venue candles), and no real-account endpoint is called.
 * Requires the backend `dist/` and `frontend/dist`.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.HISTORY20_QA_OUT || path.join(root, 'docs/qa/history20-native-20261018'));
const port = process.env.HISTORY20_QA_PORT || '4181', origin = `http://127.0.0.1:${port}`;
const PAIR = 'VHXTSIM/USDT', CONTRACT = 'VHXTSIMUSDT';
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], passed: false };
let server, browser;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root,
    env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_HISTORY20_QA: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'w' });
  server.stdout.pipe(log); server.stderr.pipe(log);
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); const h = await r.json(); if (r.ok && h.fixtureMarket === true && h.history20Fixture === true) return; } catch {}
    await delay(500);
  }
  throw Error('Isolated History20 fixture server did not become healthy');
}
async function api(context, token, endpoint, body) {
  const r = await context.request[body === undefined ? 'get' : 'post'](origin + '/api/v1/private-trading/native/' + endpoint, { headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }) });
  const data = await r.json(); assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(data)}`); return data;
}
let failedPage = null;
async function check(name, run) {
  try { const detail = await run(); report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error.stack || error) }); }
}
const workspace = async (page, name) => { const tab = page.locator(`#mobile-futures-${name}`); if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click(); };

async function flow(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'ru-RU', timezoneId: 'UTC' });
  try {
    const html = await (await context.request.get(origin + '/futures')).text();
    const token = JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
    let state = await api(context, token, 'state');
    if (!state.initialized) state = await api(context, token, 'initialize', { acceptedModel: state.model.version, idempotencyKey: `qa-h20-init-${width}` });
    const models = (await api(context, token, 'models')).models;
    assert.deepEqual(models.map(m => [m.symbol, m.pair, m.source, m.rights]), [[CONTRACT, PAIR, 'VOLTEX_HISTORY20_MODEL', 'HISTORICAL_RIGHTS_UNVERIFIED']]);
    const external = [], venueAboutModel = [], realAccount = [], modelCandles = [];
    await context.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin + '/')) return route.continue(); external.push(url); return route.abort(); });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    failedPage = page;
    page.on('pageerror', e => report.errors.push(`${width}: ${e.message}`));
    page.on('request', request => {
      const u = new URL(request.url());
      // Venue-backed routes. (`/market/derivatives/:base` is answered from explicit venue contract maps,
      // binanceContractFor / okxContractFor: an unmapped base makes no venue request, so it is not listed.)
      if (/VHXTSIM/.test(u.pathname + u.search) && /\/futures\/mark-price|\/market\/futures\/candles|\/display\/futures-(book|trades)/.test(u.pathname)) venueAboutModel.push(u.pathname);
      if (/^\/api\/v1\/(futures\/(orders|positions|balances)|orders|balances|withdrawals|wallet)/.test(u.pathname)) realAccount.push(request.method() + ' ' + u.pathname);
      if (u.pathname === '/api/v1/private-trading/candles' && u.searchParams.get('source') === 'VOLTEX_HISTORY20_MODEL') modelCandles.push(u.searchParams.get('interval'));
    });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${origin}/futures?pair=${encodeURIComponent(PAIR)}`);
    if (width <= 900) await page.locator('#mobile-futures-chart').click();
    await page.locator('.history20-model-badge').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.chart-surface canvas').length > 0);
    await page.waitForFunction(() => new URL(location.href).searchParams.get('pair') === 'VHXTSIM/USDT');
    await delay(1500);
    assert(modelCandles.length > 0, 'The chart did not read the model candle route');
    const badge = (await page.locator('.history20-model-badge').textContent()).trim();
    assert.equal(badge, 'History20 · модель');
    assert.equal(await page.locator('.chart-tools-trigger').count(), 0, 'The venue-candle trading trigger is shown for a model contract');
    await page.screenshot({ path: path.join(out, `terminal-chart-${width}.png`) });

    // The ordinary order form: MARKET Long, then MARKET Short.
    const mark = Number(models[0].mark.markPrice);
    for (const [side, quantity] of [['buy', '20'], ['sell', '10']]) {
      await workspace(page, 'trade');
      const select = page.locator('.fo-panel .order-family-select select');
      if (width <= 900) await select.selectOption(await select.locator('option').nth(1).getAttribute('value'));
      else await page.locator('.fo-panel .order-family-tabs [role=tab]').nth(1).click();
      await page.locator('.fo-markPrice').waitFor();
      await page.locator('.fo-qtyInputRow input').fill(quantity);
      await page.waitForFunction(cls => { const b = document.querySelector(`.fo-submitPair .${cls}`); return b && !b.disabled; }, side);
      // The ticket sizes and prices the typed quantity first; submit once it has.
      await delay(600);
      const response = page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST');
      await page.locator(`.fo-submitPair .${side}`).click();
      const r = await response.catch(async e => { await page.screenshot({ path: path.join(out, `failed-${side}-${width}.png`) }); throw e; });
      const body = await r.json(), draft = r.request().postDataJSON();
      assert(r.ok(), `${side}: ${r.status()} ${JSON.stringify(body)}`);
      assert.deepEqual([draft.kind, draft.symbol, draft.type, draft.quantity, draft.candle], ['OPEN', CONTRACT, 'MARKET', quantity, undefined]);
      state = body;
    }
    const positions = state.positions.filter(p => p.symbol === CONTRACT && p.status === 'OPEN');
    assert.deepEqual(positions.map(p => [p.side, p.quantity]).sort(), [['LONG', '20'], ['SHORT', '10']]);
    for (const p of positions) assert(Math.abs(Number(p.entryPrice) / mark - 1) < 0.02, `entry ${p.entryPrice} is not the model price ${mark}`);
    await workspace(page, 'positions');
    await page.locator('#futures-tab-positions').click();
    await page.locator('#futures-bottom-content').getByText('VHXTSIM').first().waitFor();
    await page.screenshot({ path: path.join(out, `terminal-positions-${width}.png`), fullPage: width <= 900 });

    // Sell (close) the Short from the positions table, at market.
    const close = page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === 'CLOSE');
    // The row's own «Рыночный» close (the second close action), as on any contract.
    await page.locator('.futures-positions-table tbody tr[data-side=SHORT]').locator('.futures-position-close').nth(1).click();
    const closed = await close; assert(closed.ok(), `close: ${closed.status()}`);
    state = await closed.json();
    assert.deepEqual(state.positions.filter(p => p.symbol === CONTRACT && p.status === 'OPEN').map(p => p.side), ['LONG']);

    // The same chooser, with the model tagged (desktop layer / phone dialog).
    await page.locator(width > 900 ? '.pair-markets-btn' : '.pair-selector').first().click();
    const tagged = page.locator('.pair-row', { hasText: 'VHXTSIM' }).locator('.p-model');
    await tagged.waitFor();
    assert.equal((await tagged.textContent()).trim(), 'модель');
    await page.screenshot({ path: path.join(out, `terminal-chooser-${width}.png`) });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `horizontal overflow ${overflow}px`);
    assert.deepEqual(venueAboutModel, [], 'A venue route was asked about the model contract');
    assert.deepEqual(realAccount, [], 'A real-account endpoint was called');
    assert(external.every(u => !/VHXTSIM/.test(u)), 'An external host was asked about the model contract');
    return { modelCandleIntervals: [...new Set(modelCandles)], entries: positions.map(p => [p.side, p.entryPrice]), externalAborted: external.length };
  } finally { await context.close(); }
}

async function main() {
  await startServer();
  const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });
  for (const width of [1440, 390]) await check(`history20-model-contract-${width}`, () => flow(width));
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(c => c.passed), `${report.checks.filter(c => !c.passed).length} checks failed`);
  report.passed = true;
}
main().catch(e => { report.failure = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    await browser?.close();
    if (server && server.exitCode === null) server.kill('SIGTERM');
  });
