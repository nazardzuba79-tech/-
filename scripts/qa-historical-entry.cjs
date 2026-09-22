/** Browser QA — a selected historical candle opens a POSITION, never a resting order.
 *
 * Owner rule (2026-09-22): with a candle selected on the chart, Open Long /
 * Open Short is a HISTORICAL_DEMO simulation entry at the candle's price —
 * not a LIMIT waiting to be touched, not a MARKET against a book. This
 * drives the REAL /futures terminal (the real order form, chart picker,
 * bottom panel and NativeDemoService) on the isolated fixture server, on
 * AKE/USDT: an old bar at 0.004 against a 0.0538 current price, 1 500 000
 * contracts at 3x — above the contract's 1 000 000 venue ceiling and its
 * 2x top tier, on a quote with one token contract of depth per side.
 *
 * Disposable fixture server ONLY; never production QA. Output under
 * docs/qa/historical-entry/.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), front = path.join(root, 'frontend');
/** Evidence lands under docs/qa/historical-entry/; a control run names its own folder (HISTORICAL_QA_OUT) so it never overwrites the owner flow's. */
const out = process.env.HISTORICAL_QA_OUT || path.join(root, 'docs/qa/historical-entry', process.env.HISTORICAL_QA_MODE === 'server' ? 'server-control' : '');
fs.mkdirSync(out, { recursive: true });
const port = process.env.NATIVE_QA_PORT || '4181';
const origin = `http://127.0.0.1:${port}`;
const PAIR = 'AKE/USDT', SYMBOL = 'AKEUSDT', ENTRY = 0.004, CURRENT = 0.0538;
/** The owner's numbers by default. `HISTORICAL_QA_MODE=server` is the negative control: it skips the panel's
 *  own assertions (the shown price, the read-only field), types the limit price it is given, and asserts the
 *  server outcome alone — so the same script can show what an unfixed engine does with the same clicks. */
const SERVER_ONLY = process.env.HISTORICAL_QA_MODE === 'server';
const QUANTITY = process.env.HISTORICAL_QA_QUANTITY || '1500000', LEVERAGE = Number(process.env.HISTORICAL_QA_LEVERAGE || 3), LIMIT_PRICE = process.env.HISTORICAL_QA_PRICE || null;
const report = { fixtureOnly: true, productionVerified: false, scope: 'real /futures terminal, isolated native engine, AKE/USDT fixture', checks: [], errors: [] };
report.mode = SERVER_ONLY ? 'server-only control' : 'owner flow'; report.inputs = { quantity: QUANTITY, leverage: LEVERAGE, limitPrice: LIMIT_PRICE };
let browser, server, activePage, shim;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const qty = page => page.locator('.fo-qtyInputRow input');
const priceField = page => page.locator('.fo-priceInputRow input');
const button = (page, side) => page.locator(`.fo-submitPair .${side === 'LONG' ? 'buy' : 'sell'}`);
const tabCount = async (page, tab) => (await page.locator(`#futures-tab-${tab} .reference-tab-count`).innerText()).trim();

async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) }); return true; }
  catch (error) {
    report.checks.push({ name, passed: false, error: String(error.stack || error) });
    console.error(`[FAIL] ${name}: ${error.message}`);
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(out, `${name.replace(/[^a-z0-9-]/gi, '-')}-failed.png`), fullPage: true }).catch(() => {});
    return false;
  }
}
async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root, env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  // Two minutes: the review server also builds nothing, but on a loaded machine (a full test run beside it) 30s was not enough.
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); const h = await r.json(); if (r.ok && h.fixtureMarket === true && h.kind === 'isolated-native-demo-preview') return; } catch {}
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
  const data = await r.json(); assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(data)}`); return data;
}
async function session(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ru-RU', timezoneId: 'UTC' });
  const html = await (await context.request.get(origin + '/futures')).text();
  const match = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
  assert(match, 'Isolated preview did not provide its fixture session');
  const token = JSON.parse(match[1]);
  let initial = await api(context, token, 'state');
  if (!initial.initialized) initial = await api(context, token, 'initialize', { acceptedModel: initial.model.version, idempotencyKey: 'qa-initialize-historical-entry' });
  assert(initial.initialized && initial.account, 'Fixture initialization was not confirmed');
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const drafts = [];
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (request.url().endsWith('/native/commands') && request.method() === 'POST') drafts.push(request.postDataJSON()); });
  await page.goto(origin + '/futures?pair=' + encodeURIComponent(PAIR)); await page.locator('.chart-surface').waitFor();
  return { context, page, token, initial, drafts };
}
async function workspace(page, name) {
  const tab = page.locator(`#mobile-futures-${name}`);
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}
async function ready(s) {
  await s.page.locator('.chart-surface').waitFor();
  await s.page.waitForFunction(() => {
    const balance = document.querySelector('.futures-account-balance .mono')?.textContent?.trim();
    const limit = document.querySelector('.fo-priceInputRow input');
    return Boolean(balance && !balance.includes('—') && limit && Number(limit.value) > 0);
  });
  await workspace(s.page, 'trade');
}
async function openChartMenu(p) {
  await workspace(p, 'chart');
  await p.locator('.chart-surface').scrollIntoViewIfNeeded();
  const menu = p.locator('.chart-tools-menu');
  for (const [fx, fy] of [[0.55, 0.55], [0.72, 0.45], [0.62, 0.72], [0.8, 0.6]]) {
    const box = await p.locator('.chart-surface').boundingBox();
    await p.mouse.dblclick(box.x + box.width * fx, box.y + box.height * fy);
    try { await menu.waitFor({ timeout: 3000 }); return; } catch {}
  }
  await menu.waitFor();
}
/** The menu's primary action: tools on AND the entry picker armed — what a trader presses to choose a bar. */
async function armChartPicker(p) {
  await openChartMenu(p);
  await p.locator('.chart-tools-menu .chart-tools-switch input').check();
  await p.locator('.chart-tools-action').click();
  await p.locator('.chart-tools-menu').waitFor({ state: 'detached' });
  await p.locator('.chart-surface[data-chart-picking]').waitFor();
}
/** Click an OLD bar — one whose close is the flat 0.004 — the way a trader does, on the chart body. */
async function pickOldCandle(p) {
  await p.waitForFunction(() => window.__nativeQaSeries?.data().length > 10);
  await p.locator('.chart-area').scrollIntoViewIfNeeded();
  // Scroll back to the old bars, as a trader does: with the recent rise in
  // view the 0.004 bars sit in the bottom fifth of the pane, which the chart
  // reserves for its scales and never treats as a bar click.
  await p.evaluate(entry => {
    const c = window.__nativeQaChart, data = window.__nativeQaSeries.data();
    const old = data.map((x, i) => [x, i]).filter(([x]) => Math.abs(x.close - entry) < 1e-9).map(([, i]) => i);
    const to = old[old.length - 1] - 2, from = Math.max(0, to - 60);
    c.timeScale().setVisibleLogicalRange({ from, to });
  }, ENTRY);
  await delay(300);
  const points = await p.evaluate(entry => {
    const c = window.__nativeQaChart, series = window.__nativeQaSeries, r = c.chartElement().getBoundingClientRect();
    return series.data().slice(0, -3).filter(x => typeof x.time === 'number' && x.open !== undefined && Math.abs(x.close - entry) < 1e-9)
      .map(x => ({ time: x.time, close: x.close, x: c.timeScale().timeToCoordinate(x.time) })).filter(x => x.x !== null && x.x > 35 && x.x < r.width - 90)
      .filter((_, i) => i % 5 === 0).map(x => ({ ...x, x: r.left + x.x, y: r.top + series.priceToCoordinate(entry) }));
  }, ENTRY);
  assert(points.length, 'No 0.004 bar is visible on the chart');
  for (const point of points) {
    await p.mouse.click(point.x, point.y); await delay(120);
    if (await p.evaluate(() => !document.querySelector('[data-chart-picking]'))) return point;
  }
  throw Error('The chart did not accept a pick on any 0.004 bar');
}
async function setLeverage(p, value) {
  await workspace(p, 'trade');
  await p.locator('.fo-mlTriggerLevBtn').click();
  const chip = p.locator('.fo-mlPopoverRight .fo-mlChip', { hasText: new RegExp(`^${value}x$`) });
  if (await chip.count()) { await chip.first().click(); }
  else {
    await p.locator('.fo-mlCustom summary').click();
    const input = p.locator('.fo-mlStepper input');
    await input.fill(String(value)); await input.press('Enter');
    await p.keyboard.press('Escape');
  }
  // The trigger prints the leverage with two decimals: "3.00x".
  await p.waitForFunction(v => (document.querySelector('.fo-mlTriggerLev')?.textContent || '').replace(/\s/g, '') === `${Number(v).toFixed(2)}x`, value);
}
async function command(s, kind, action) {
  const waiting = s.page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === kind);
  await action(); const response = await waiting; const state = await response.json();
  assert(response.ok(), `${kind}: ${response.status()} ${JSON.stringify(state)}`);
  await s.page.waitForTimeout(80);
  return { state, draft: response.request().postDataJSON() };
}
const activeOrders = state => state.orders.filter(o => ['OPEN', 'PARTIALLY_FILLED'].includes(o.status));

/** One side, start to finish: pick a bar, open, verify the POSITION (not the toast), close at the near-live price, verify the ledger. */
async function tradeSide(s, width, side, counts) {
  const p = s.page, sign = side === 'LONG' ? 1 : -1;
  // 1. A bar. The selection survives a completed trade, so only the first side arms the picker.
  await workspace(p, 'trade');
  if (!(await p.locator('[data-entry-reference]').count())) { await armChartPicker(p); await pickOldCandle(p); await workspace(p, 'trade'); }
  const reference = JSON.parse(await p.locator('[data-entry-reference]').getAttribute('data-entry-reference'));
  const entryRow = await p.locator('[data-entry-reference]').innerText();
  if (!SERVER_ONLY) {
    assert(entryRow.includes(String(ENTRY)), `Entry row does not show the selected price: ${entryRow}`);
    assert.equal(Number(await priceField(p).inputValue()), ENTRY, 'Price field does not show the selected historical price');
    assert.equal(await priceField(p).getAttribute('readonly'), '', 'Price field is editable while a bar is selected');
  }
  let typedLimit = false;
  if (SERVER_ONLY && LIMIT_PRICE && (await priceField(p).getAttribute('readonly')) === null) { await priceField(p).fill(LIMIT_PRICE); typedLimit = true; }
  const limitTab = p.locator('.fo-panel .order-family-tabs [role=tab]').first();
  assert.equal(await limitTab.getAttribute('aria-selected'), 'true', 'LIMIT tab is not the selected tab');
  // 2. Same quantity / leverage controls, same Open Long / Open Short button.
  await qty(p).fill(QUANTITY);
  await setLeverage(p, LEVERAGE);
  try { await p.waitForFunction(side => !document.querySelector(`.fo-submitPair .${side === 'LONG' ? 'buy' : 'sell'}`)?.disabled, side, { timeout: 8000 }); }
  catch { throw Error(`Open ${side} stayed disabled before any request: ` + (await p.locator('.fo-form').innerText()).replace(/\s+/g, ' ').slice(0, 400)); }
  await p.screenshot({ path: path.join(out, `armed-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
  const { state, draft } = await command(s, 'OPEN', () => button(p, side).click());
  // 3. The HTTP payload is the ordinary form's: a LIMIT with the bar attached. The server treated it as the entry.
  assert.equal(draft.type, 'LIMIT'); assert.deepEqual(draft.candle, reference); assert.equal(draft.quantity, QUANTITY); assert.equal(draft.leverage, String(LEVERAGE)); assert.equal(draft.side, side);
  assert.equal(draft.executionMode, 'HISTORICAL_DEMO');
  if (typedLimit) assert.equal(Number(draft.price), Number(LIMIT_PRICE));
  // 4. A position, immediately; nothing resting. The toast is not the evidence — the position is.
  assert.equal(state.positions.length, counts.positions + 1, 'Positions count did not increase by one');
  assert.equal(activeOrders(state).length, counts.orders, 'Open orders count changed');
  const position = state.positions.find(x => x.symbol === SYMBOL && x.side === side);
  assert(position, `No ${side} AKE position`);
  assert.equal(Number(position.entryPrice), ENTRY, `Entry is ${position.entryPrice}, not the selected ${ENTRY}`);
  assert.equal(position.quantity, QUANTITY); assert.equal(Number(position.leverage), LEVERAGE);
  assert.equal(position.executionMode, 'HISTORICAL_DEMO');
  const mark = Number(position.markPrice);
  assert(Math.abs(mark - CURRENT) < 1e-9, `Mark ${position.markPrice} is not the near-live ${CURRENT}`);
  const expectedPnl = sign * (CURRENT - ENTRY) * Number(QUANTITY), pnl = Number(position.unrealizedPnl);
  assert(pnl !== 0 && Math.abs(pnl - expectedPnl) < 1e-6, `Unrealized P&L ${position.unrealizedPnl} is not ${side} entry→near-live (${expectedPnl})`);
  const order = state.orders.find(o => o.positionId === position.id || o.id === position.id);
  assert(order && order.status === 'FILLED' && Number(order.remaining ?? order.remainingQuantity) === 0 && order.filled === QUANTITY, `Order for the position is not filled in full: ${JSON.stringify(order)}`);
  assert.equal(order.type, 'MARKET', 'A selected bar was journaled as a resting-capable order type'); assert.equal(order.price, null); assert.equal(Number(order.historicalPrice), ENTRY);
  // 5. The bar stays selected after the submit, and the panel still shows ITS price — not today's.
  await workspace(p, 'trade');
  if (!SERVER_ONLY) await p.waitForFunction(entry => Number(document.querySelector('.fo-priceInputRow input')?.value) === entry, ENTRY);
  // 6. The bottom panel shows the POSITION on this viewport: counts, then the row itself.
  await workspace(p, 'positions');
  await p.waitForFunction(([o, n]) => document.querySelector('#futures-tab-orders .reference-tab-count')?.textContent?.trim() === `(${o})` && document.querySelector('#futures-tab-positions .reference-tab-count')?.textContent?.trim() === `(${n})`, [counts.orders, counts.positions + 1]);
  await p.locator('#futures-tab-positions').click();
  const row = p.locator(`.futures-position-row[data-side="${side}"]`).filter({ hasText: 'AKE' }).first();
  await row.waitFor();
  const rowText = (await row.innerText()).replace(/\s+/g, ' ');
  assert(/0[.,]0040?\b/.test(rowText), `Position row does not show the 0.004 entry: ${rowText}`);
  assert(rowText.includes('1500000') || rowText.includes('1 500 000') || rowText.includes('1,500,000'), `Position row does not show the quantity: ${rowText}`);
  assert(/3\.00x|3x/.test(rowText), `Position row does not show 3x: ${rowText}`);
  // The sign is styled (a class), not always in the text: a LONG shows 74,700 without a leading minus, a SHORT with one.
  assert((side === 'LONG' ? /(^|[^-−])74[,\u00a0 ]?700/ : /[-−]74[,\u00a0 ]?700/).test(rowText), `Position row does not show the ${side} P&L: ${rowText}`);
  await p.screenshot({ path: path.join(out, `position-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
  // 7. Close at the current near-live price from the table (the "Рыночный" close), no book involved.
  const closed = await command(s, 'CLOSE', () => row.locator('.futures-position-close').nth(1).click());
  assert.equal(closed.draft.positionId, position.id); assert.equal(closed.draft.candle, undefined, 'A close reused the historical selection');
  assert.equal(closed.state.positions.filter(x => x.symbol === SYMBOL).length, 0, 'Position still open after close');
  assert.equal(activeOrders(closed.state).length, counts.orders);
  const done = closed.state.history.find(x => x.id === position.id);
  assert(done && done.status === 'CLOSED', `Closed position missing from history: ${JSON.stringify(done)}`);
  const gross = sign * (CURRENT - ENTRY) * Number(QUANTITY);
  assert(Math.abs(Number(done.realizedGross) - gross) < 1e-6, `Realized gross ${done.realizedGross} is not ${gross}`);
  const fees = Number(QUANTITY) * ENTRY * 0.00055 + Number(QUANTITY) * CURRENT * 0.00055;
  assert(Math.abs(Number(done.realizedPnl) - (gross - fees)) < 1e-4, `Realized net ${done.realizedPnl} is not gross ${gross} minus fees ${fees}`);
  await p.waitForFunction(n => document.querySelector('#futures-tab-positions .reference-tab-count')?.textContent?.trim() === `(${n})`, counts.positions);
  await p.screenshot({ path: path.join(out, `closed-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
  return { side, submittedType: draft.type, orderStatus: order.status, entry: position.entryPrice, quantity: position.quantity, leverage: position.leverage, mark: position.markPrice,
    unrealizedPnl: position.unrealizedPnl, ordersBefore: counts.orders, ordersAfterOpen: activeOrders(state).length, positionsAfterOpen: state.positions.length,
    closedAt: CURRENT, realizedGross: done.realizedGross, realizedNet: done.realizedPnl, positionsAfterClose: closed.state.positions.length };
}

async function historicalEntry(width) {
  const s = await session(width), p = s.page;
  try {
    await ready(s);
    const before = await api(s.context, s.token, 'state');
    const counts = { orders: activeOrders(before).length, positions: before.positions.length };
    await workspace(p, 'positions');
    assert.equal(await tabCount(p, 'orders'), `(${counts.orders})`); assert.equal(await tabCount(p, 'positions'), `(${counts.positions})`);
    const sides = SERVER_ONLY ? ['LONG'] : ['LONG', 'SHORT'];
    const results = {};
    for (const side of sides) results[side] = await tradeSide(s, width, side, counts);
    // No liquidity dependency: the fixture quote holds ONE contract per side, every fill above was 1 500 000.
    const quote = await (await s.context.request.get(origin + '/api/v1/futures/mark-price/' + PAIR.replace('/', '-'))).json();
    assert(Math.abs(Number(quote.markPrice) - CURRENT) < 1e-9);
    assert.deepEqual(report.errors, [], 'Browser runtime errors');
    return { width, ...results };
  } finally { await s.context.close(); }
}

async function main() {
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-historical-entry-observer-${process.pid}.mjs`);
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};export function createChart(...args){const c=original(...args);window.__nativeQaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__nativeQaSeries=s;return s;};return c;}`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') }, logLevel: 'error' });
  await startServer(); const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright'); browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) await check(`historical-entry-${width}`, () => historicalEntry(width));
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}
main().catch(error => { report.passed = false; report.failure = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true }); });
