/** HISTORICAL_DEMO is not rationed by live liquidity — driven through the real
 *  /futures terminal, the real order form and the real NativeDemoService.
 *
 *  The owner's case: AKE/USDT, a chosen historical candle, quantity 1 200 000,
 *  leverage 10x. The contract is deliberately THIN — maxMarketOrderQty 500 000
 *  and a risk ladder whose second tier caps leverage at 5x past 100 000 of
 *  notional — so all three limits under test actually bite on this order.
 *
 *  A historical fill takes no depth and creates no real exposure, so none of
 *  the three may decide it. A LIVE order of the SAME size and leverage on the
 *  SAME contract must still be refused, and this run proves that too — on the
 *  same server, in the same session, so "it opened" cannot be explained by a
 *  fixture that simply has no limits.
 *
 *  Disposable fixture server ONLY; never production QA. No production
 *  credentials, database, real account or exchange matching is involved.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..'), front = path.join(root, 'frontend');
const out = path.join(root, 'docs/qa/historical-demo-no-live-tiers');
fs.mkdirSync(out, { recursive: true });
const port = process.env.HISTORICAL_QA_PORT || '4181';
const origin = `http://127.0.0.1:${port}`;
const PAIR = 'AKE/USDT', SYMBOL = 'AKEUSDT';
const QUANTITY = '1200000', LEVERAGE = '10';
/** The thin contract's own limits, mirrored from the fixture instrument so a
 *  drift on either side fails the run rather than passing silently. */
const MAX_MARKET_QTY = 500000, TIER_MAX_LEVERAGE = 5;

const report = {
  fixtureOnly: true, productionVerified: false,
  scope: 'HISTORICAL_DEMO entry on a thin contract: no depth, no size ceiling, no tier leverage cap',
  contract: { pair: PAIR, quantity: QUANTITY, leverage: LEVERAGE, maxMarketOrderQty: String(MAX_MARKET_QTY), tierMaxLeverage: String(TIER_MAX_LEVERAGE) },
  checks: [], errors: [],
};
let browser, server, activePage, shim;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const qty = page => page.locator('.fo-qtyInputRow input');
const button = (page, side) => page.locator(`.fo-submitPair .${side === 'LONG' ? 'buy' : 'sell'}`);
const rows = page => page.locator('.futures-positions-table tbody tr');

async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) }); console.log(`[PASS] ${name}`); return true; }
  catch (error) {
    report.checks.push({ name, passed: false, error: String(error.stack || error) });
    console.error(`[FAIL] ${name}: ${error.message}`);
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(out, `${name.replace(/[^a-z0-9-]/gi, '-')}-failed.png`), fullPage: true }).catch(() => {});
    return false;
  }
}
async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_THIN_SYMBOL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); const h = await r.json(); if (r.ok && h.fixtureMarket === true) return; } catch {}
    await delay(500);
  }
  throw Error('Local isolated fixture server did not become healthy');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
}
async function api(context, token, endpoint, body) {
  const options = { headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }) };
  const r = await context.request[body === undefined ? 'get' : 'post'](origin + '/api/v1/private-trading/native/' + endpoint, options);
  return { ok: r.ok(), status: r.status(), body: await r.json() };
}
async function ok(context, token, endpoint, body) {
  const r = await api(context, token, endpoint, body);
  assert(r.ok, `${endpoint}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function session(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ru-RU', timezoneId: 'UTC' });
  const html = await (await context.request.get(origin + '/futures')).text();
  const match = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
  assert(match, 'Isolated preview did not provide its fixture session');
  const token = JSON.parse(match[1]);
  let initial = await ok(context, token, 'state');
  if (!initial.initialized) initial = await ok(context, token, 'initialize', { acceptedModel: initial.model.version, idempotencyKey: 'qa-historical-initialize' });
  assert(initial.initialized && initial.account, 'Fixture initialization was not confirmed');
  /* Every off-origin request is blocked. Two hosts are cosmetic — the web
     font sheets and the coin-icon CDN — and are recorded separately: they
     carry no market data, and a blocked icon cannot make a position open.
     Anything else leaving this server (a venue, a book, a second price
     source) would invalidate the whole claim, so it is collected and the
     run fails on it. */
  const COSMETIC = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//;
  const external = [], cosmetic = [], blockedNoise = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    (COSMETIC.test(url) ? cosmetic : external).push(url);
    return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const drafts = [];
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(String(error.message)));
  // A console error is fatal only when it is the page's own. This run blocks
  // every off-origin request on purpose, and Chromium logs each block as a
  // resource-load failure — counting those would fail the run for the
  // harness's own isolation rather than for anything the product did.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource/.test(text)) { blockedNoise.push(text); return; }
    report.errors.push(`console: ${text}`);
  });
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => {
    if (request.url().endsWith('/native/commands') && request.method() === 'POST') drafts.push(request.postDataJSON());
  });
  await page.goto(`${origin}/futures?pair=${encodeURIComponent(PAIR)}`);
  await page.locator('.chart-surface').waitFor();
  await page.waitForFunction(() => {
    const balance = document.querySelector('.futures-account-balance .mono')?.textContent?.trim();
    return Boolean(balance && !balance.includes('—'));
  });
  return { context, page, token, external, cosmetic, drafts, blockedNoise };
}
async function workspace(page, name) {
  const tab = page.locator(`#mobile-futures-${name}`);
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}
async function family(page, type) {
  await workspace(page, 'trade');
  await page.locator('.fo-panel .order-family-tabs [role=tab]').nth(type === 'MARKET' ? 1 : 0).click();
  await page.locator(type === 'MARKET' ? '.fo-markPrice' : '.fo-priceInputRow input').waitFor();
}
/** Set leverage the way a trader does: the trigger, then the numeric stepper. */
async function setLeverage(page, value) {
  await workspace(page, 'trade');
  await page.locator('.fo-mlTriggerLevBtn').click();
  const popover = page.locator('.fo-mlPopover[role=dialog]');
  await popover.waitFor();
  const chip = popover.locator('.fo-mlChip', { hasText: new RegExp(`^${value}x$`) });
  if (await chip.count()) await chip.first().click();
  else {
    await popover.locator('.fo-mlCustom summary').click();
    await popover.locator('.fo-mlValue').fill(String(value));
    await page.keyboard.press('Escape');
  }
  await popover.waitFor({ state: 'detached' });
}
/** Read the leverage the form will actually submit, not the one requested. */
const shownLeverage = page => page.locator('.fo-mlTriggerLev').innerText();

/** Arm the chart entry picker and take a closed candle, exactly as the
 *  terminal's own tool menu does. */
async function pickHistoricalCandle(page) {
  await workspace(page, 'chart');
  await page.locator('.chart-surface').scrollIntoViewIfNeeded();
  const menu = page.locator('.chart-tools-menu');
  for (const [fx, fy] of [[0.55, 0.55], [0.72, 0.45], [0.62, 0.72], [0.8, 0.6]]) {
    const box = await page.locator('.chart-surface').boundingBox();
    await page.mouse.dblclick(box.x + box.width * fx, box.y + box.height * fy);
    try { await menu.waitFor({ timeout: 3000 }); break; } catch {}
  }
  await menu.waitFor();
  await menu.locator('.chart-tools-switch input').check();
  await menu.locator('.chart-tools-action').click();
  await menu.waitFor({ state: 'detached' });
  await page.locator('.chart-surface[data-chart-picking]').waitFor();
  await page.waitForFunction(() => window.__nativeQaSeries?.data().length > 10);
  const points = await page.evaluate(() => {
    const c = window.__nativeQaChart, series = window.__nativeQaSeries;
    const r = c.chartElement().getBoundingClientRect();
    return series.data().slice(0, -3)
      .filter(x => typeof x.time === 'number' && x.open !== undefined)
      .map(x => ({ ...x, x: c.timeScale().timeToCoordinate(x.time) }))
      .filter(x => x.x > 35 && x.x < r.width - 90)
      .filter((_, i) => i % 7 === 0)
      .map(x => ({ x: r.left + x.x, y: r.top + series.priceToCoordinate((x.high + x.low) / 2) }));
  });
  for (const point of points) {
    await page.mouse.click(point.x, point.y); await delay(120);
    if (await page.evaluate(() => !document.querySelector('[data-chart-picking]'))) {
      const reference = JSON.parse(await page.locator('[data-entry-reference]').getAttribute('data-entry-reference'));
      // The recorded entry names the candle but not its prices, so the bar
      // the TRADER saw is read off the chart series itself — that is the
      // number the historical entry price has to equal.
      const bar = await page.evaluate(openTime => {
        const match = window.__nativeQaSeries.data().find(x => x.time * 1000 === openTime);
        return match ? { open: match.open, high: match.high, low: match.low, close: match.close } : null;
      }, reference.openTime);
      assert(bar, `The picked candle ${reference.openTime} is not on the chart`);
      return { reference, bar };
    }
  }
  throw Error('The chart did not accept a closed-candle pick');
}

/** The owner's flow end to end, at one viewport. */
async function historicalEntry(width) {
  const s = await session(width), p = s.page;
  try {
    // The contract really does carry the limits this run is about.
    const contract = await ok(s.context, s.token, `contracts/${SYMBOL}`);
    assert.equal(contract.maxMarketOrderQty, String(MAX_MARKET_QTY), `Fixture contract drifted: ${JSON.stringify(contract)}`);
    assert(Number(QUANTITY) > Number(contract.maxMarketOrderQty), 'The test size no longer exceeds the market ceiling');
    const config = await (await s.context.request.get(`${origin}/api/v1/futures/config`, { headers: { Authorization: 'Bearer ' + s.token } })).json();
    const tier = config.leverageTiers.find(t => t.notionalCap === null || Number(QUANTITY) * 0.5 <= t.notionalCap);
    assert.equal(tier.maxLeverage, TIER_MAX_LEVERAGE, `Fixture ladder drifted: ${JSON.stringify(config.leverageTiers)}`);

    await family(p, 'MARKET');
    await setLeverage(p, LEVERAGE);
    const { reference: candle, bar } = await pickHistoricalCandle(p);
    await workspace(p, 'trade');
    await qty(p).fill(QUANTITY);

    // The form must not silently downgrade the leverage to the tier cap,
    // and must not refuse or shrink the size on the market ceiling.
    assert.equal((await shownLeverage(p)).trim(), `${Number(LEVERAGE).toFixed(2)}x`, 'The form downgraded a historical entry to the tier cap');
    assert.equal(await qty(p).inputValue(), QUANTITY, 'The form clamped a historical size to the market ceiling');
    assert.equal(await p.locator('.fo-contractBreach, .fo-error').count(), 0, 'The form reported a contract breach on a historical entry');
    await p.waitForFunction(() => document.querySelector('.fo-submitPair .buy')?.disabled === false);
    await p.screenshot({ path: path.join(out, `entry-armed-${width}.png`), fullPage: true });

    const waiting = p.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === 'OPEN');
    await button(p, 'LONG').click();
    const response = await waiting, draft = response.request().postDataJSON(), state = await response.json();
    assert(response.ok(), `OPEN refused: ${response.status()} ${JSON.stringify(state)}`);

    // What actually left the browser.
    assert.equal(draft.quantity, QUANTITY, `Submitted quantity was not the typed one: ${JSON.stringify(draft)}`);
    assert.equal(draft.leverage, LEVERAGE, `Submitted leverage was not the chosen one: ${JSON.stringify(draft)}`);
    assert.deepEqual(draft.candle, candle, 'Displayed candle differs from the submitted one');
    // What the engine actually recorded.
    assert.equal(state.executionMode, 'HISTORICAL_DEMO');
    assert.equal(state.positions.length, 1, `Expected exactly one position: ${JSON.stringify(state.positions)}`);
    const position = state.positions[0];
    assert.equal(position.quantity, QUANTITY);
    assert.equal(position.leverage, LEVERAGE);
    assert.equal(position.historical, true);
    assert(Number(position.entryPrice) > 0, 'Historical entry price is not a real price');
    // The entry is the price off the chosen candle, NOT the near-live mark.
    const entry = state.entries.find(x => x.positionId === position.id);
    assert(entry && entry.candle.openTime === candle.openTime, 'The recorded entry is not the selected candle');
    const point = candle.pricePoint === 'OPEN' ? bar.open : bar.close;
    assert.equal(Number(position.entryPrice), Number(point),
      `Entry price is not the selected candle's ${candle.pricePoint}: ${JSON.stringify({ entryPrice: position.entryPrice, bar, candle })}`);
    // ...and it is NOT the current near-live mark: a historical entry is the
    // chosen past price, valued against the live one.
    assert.notEqual(Number(position.entryPrice), Number(position.markPrice),
      'The historical entry filled at the near-live mark rather than the chosen candle');

    // And the trader can see it: the position is on the page, at 10x.
    await workspace(p, 'positions');
    await rows(p).first().waitFor();
    const text = await p.locator('.futures-positions-panel').innerText();
    assert(/10/.test(text), `The positions panel does not show the opened position: ${text}`);
    await p.screenshot({ path: path.join(out, `position-open-${width}.png`), fullPage: true });

    assert.deepEqual(s.external, [], `Non-cosmetic requests left this server: ${s.external.join(', ')}`);
    return { candle, bar, blockedCosmeticHosts: [...new Set(s.cosmetic.map(u => new URL(u).host))], entryPrice: position.entryPrice, quantity: position.quantity, leverage: position.leverage, markPrice: position.markPrice };
  } finally { await s.context.close(); }
}

/** The same size and leverage, on the same contract, WITHOUT a candle: the
 *  live path must still refuse it. Taken over the API so the refusal is the
 *  engine's own verdict rather than a form that declined to submit. */
async function liveStillRefused(width) {
  const s = await session(width);
  try {
    const big = await api(s.context, s.token, 'commands', {
      kind: 'OPEN', symbol: SYMBOL, side: 'LONG', type: 'MARKET',
      quantity: QUANTITY, leverage: LEVERAGE, idempotencyKey: 'qa-live-oversized',
    });
    assert(!big.ok, `LIVE_EXECUTION admitted ${QUANTITY} on a ${MAX_MARKET_QTY} ceiling: ${JSON.stringify(big.body)}`);
    // Under the ceiling, but past the tier's 5x: the OTHER rule must bite.
    const levered = await api(s.context, s.token, 'commands', {
      kind: 'OPEN', symbol: SYMBOL, side: 'LONG', type: 'MARKET',
      quantity: '400000', leverage: LEVERAGE, idempotencyKey: 'qa-live-overlevered',
    });
    assert(!levered.ok, `LIVE_EXECUTION admitted ${LEVERAGE}x past a ${TIER_MAX_LEVERAGE}x tier: ${JSON.stringify(levered.body)}`);
    const state = await ok(s.context, s.token, 'state');
    assert.equal(state.positions.filter(x => x.status === 'OPEN').length, 0, 'A refused live order still changed exposure');
    return { oversized: big.body, overLevered: levered.body };
  } finally { await s.context.close(); }
}

async function main() {
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-historical-observer-${process.pid}.mjs`);
  // Observation only: no component, layout, price or route is replaced.
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};export function createChart(...args){const c=original(...args);window.__nativeQaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__nativeQaSeries=s;return s;};return c;}`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') } });
  await startServer();
  const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true, args: process.env.HISTORICAL_QA_CHROMIUM_ARGS ? process.env.HISTORICAL_QA_CHROMIUM_ARGS.split(' ') : [] });
  for (const width of [1440, 390]) {
    await check(`historical-entry-opens-${width}`, () => historicalEntry(width));
    await check(`live-execution-still-refused-${width}`, () => liveStillRefused(width));
  }
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}
main().catch(error => { report.passed = false; report.failure = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`STATUS: ${report.passed ? 'PASS' : 'FAIL'} — ${report.checks.filter(x => x.passed).length}/${report.checks.length} checks`);
    await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true });
  });
