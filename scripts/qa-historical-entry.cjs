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
/** The order family control: tabs on a desktop, one select on a phone (OrderFamilyTabs compact). */
async function selectedFamily(page) {
  const select = page.locator('.fo-panel .order-family-select select');
  if (await select.count()) return select.inputValue();
  const active = page.locator('.fo-panel .order-family-tabs [role=tab][aria-selected=true]');
  return (await active.count()) ? (await active.first().innerText()).trim() : null;
}
async function chooseFamily(page, index, family) {
  const select = page.locator('.fo-panel .order-family-select select');
  if (await select.count()) { await select.selectOption(family); return (await select.locator(`option[value=${family}]`).innerText()).trim(); }
  const tab = page.locator('.fo-panel .order-family-tabs [role=tab]').nth(index);
  await tab.click(); return (await tab.innerText()).trim();
}

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
  const drafts = [], evidence = {};
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (request.url().endsWith('/native/commands') && request.method() === 'POST') drafts.push(request.postDataJSON()); });
  // owner, 2026-10-04: the phone opens on Trade, with the chart in its own workspace tab.
  await page.goto(origin + '/futures?pair=' + encodeURIComponent(PAIR)); await page.locator('.chart-surface:visible, #mobile-futures-panel-trade:visible').first().waitFor();
  return { context, page, token, initial, drafts, evidence };
}
async function workspace(page, name) {
  const tab = page.locator(`#mobile-futures-${name}`);
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}
async function ready(s) {
  await s.page.locator('.chart-surface:visible, #mobile-futures-panel-trade:visible').first().waitFor();
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
/** Frame the chart the way the owner sees it: the recent rise in view, so the old 0.004 bars are drawn
 *  LOW on the price pane — in its bottom tenth with the chart's 6 % bottom margin. Done once, before any
 *  click; nothing scrolls or zooms between a refused and an accepted click. */
async function frameOldBars(p) {
  await p.waitForFunction(() => window.__nativeQaSeries?.data().length > 10);
  await p.locator('.chart-area').scrollIntoViewIfNeeded();
  await p.evaluate(entry => {
    const c = window.__nativeQaChart, data = window.__nativeQaSeries.data();
    const old = data.map((x, i) => [x, i]).filter(([x]) => Math.abs(x.close - entry) < 1e-9).map(([, i]) => i);
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, old[old.length - 1] - 40), to: data.length - 1 });
  }, ENTRY);
  await delay(300);
}
/** Where the chart draws things right now: the price pane, the 0.004 level inside it, the visible old bars,
 *  the forming bar, and the volume pane below. Screen coordinates. */
async function chartGeometry(p) {
  return p.evaluate(entry => {
    const c = window.__nativeQaChart, series = window.__nativeQaSeries, r = c.chartElement().getBoundingClientRect();
    const pane = c.paneSize(0), panes = c.panes().length, volume = panes > 1 ? c.paneSize(1) : null;
    const y = series.priceToCoordinate(entry), data = series.data();
    const bars = data.slice(0, -3).filter(x => typeof x.time === 'number' && x.open !== undefined && Math.abs(x.close - entry) < 1e-9)
      .map(x => ({ time: x.time, x: c.timeScale().timeToCoordinate(x.time) })).filter(x => x.x !== null && x.x > 35 && x.x < r.width - 90);
    const last = data[data.length - 1];
    const forming = last && typeof last.time === 'number' ? { time: last.time, x: c.timeScale().timeToCoordinate(last.time), y: series.priceToCoordinate(last.close) } : null;
    return { left: r.left, top: r.top, width: r.width, paneWidth: pane.width, paneHeight: pane.height, panes, volumePaneHeight: volume ? volume.height : 0,
      entryY: y, entryFraction: y === null ? null : y / pane.height, bars, forming, barSpacing: c.timeScale().options().barSpacing };
  }, ENTRY);
}
const stillPicking = p => p.evaluate(() => ({ picking: !!document.querySelector('[data-chart-picking]'), reference: document.querySelector('[data-entry-reference]')?.getAttribute('data-entry-reference') ?? null }));
/** Clicks that must NEVER select a bar, with the picker armed and the old bars framed: empty space in the
 *  price pane, the volume pane, the forming (incomplete) bar, and a drag that starts on a completed bar.
 *  Each leaves the picker armed and the panel without an entry reference. */
async function negativeControls(p) {
  const g = await chartGeometry(p);
  assert(g.bars.length, 'No 0.004 bar is visible on the chart');
  const bar = g.bars[Math.floor(g.bars.length / 2)];
  const results = [];
  async function control(name, point, act) {
    await act(); await delay(150);
    const after = await stillPicking(p);
    results.push({ name, point, picking: after.picking, reference: after.reference });
    assert(after.picking && after.reference === null, `${name}: the chart created a selection (picking ${after.picking}, reference ${after.reference})`);
  }
  // 1. Empty price-pane space above the flat old bars: the same column, a quarter of the pane up.
  const empty = { x: g.left + bar.x, y: g.top + g.paneHeight * 0.3 };
  await control('empty price-pane space', empty, () => p.mouse.click(empty.x, empty.y));
  // 2. The volume pane: the same column, inside the pane under the candles.
  assert(g.panes >= 2 && g.volumePaneHeight > 10, `No separate volume pane to click (panes ${g.panes}, height ${g.volumePaneHeight})`);
  const volume = { x: g.left + bar.x, y: g.top + g.paneHeight + g.volumePaneHeight / 2 };
  await control('volume pane', volume, () => p.mouse.click(volume.x, volume.y));
  // 3. The forming bar: the newest one, still open, drawn at the current price near the top.
  assert(g.forming && g.forming.x !== null && g.forming.y !== null, 'No forming bar on the chart');
  const forming = { x: g.left + g.forming.x, y: g.top + g.forming.y };
  await control('forming (incomplete) bar', forming, () => p.mouse.click(forming.x, forming.y));
  // 4. A drag that starts exactly on a completed old bar: a pan, never a pick.
  const drag = { x: g.left + bar.x, y: g.top + g.entryY };
  await control('drag from a completed bar', drag, async () => {
    await p.mouse.move(drag.x, drag.y); await p.mouse.down(); await p.mouse.move(drag.x + 30, drag.y, { steps: 6 }); await p.mouse.up();
  });
  return { paneHeight: g.paneHeight, entryFraction: g.entryFraction, controls: results };
}
/** Click an OLD bar — one whose close is the flat 0.004 — the way a trader does, on the chart body, WHERE THE
 *  CHART DRAWS IT: in the bottom tenth of the price pane with the rise in view. That is the regression
 *  (owner, 2026-10-21, IOST/USDT 1h on production): the chart refused every bar in the pane's bottom fifth,
 *  a band it reserved for scales after the volume had already moved to its own pane. One click, no scroll. */
async function pickOldCandle(p) {
  await frameOldBars(p);
  const g = await chartGeometry(p);
  assert(g.bars.length, 'No 0.004 bar is visible on the chart');
  assert(g.entryFraction !== null && g.entryFraction >= 0.8, `The 0.004 bars are not drawn in the bottom fifth of the price pane (y ${g.entryY} of ${g.paneHeight})`);
  const bar = g.bars[Math.floor(g.bars.length / 2)];
  const point = { x: g.left + bar.x, y: g.top + g.entryY, time: bar.time, paneHeight: g.paneHeight, fraction: g.entryFraction };
  await p.mouse.click(point.x, point.y); await delay(150);
  const after = await stillPicking(p);
  assert(!after.picking, `The chart refused the completed 0.004 bar drawn at ${(g.entryFraction * 100).toFixed(1)} % of the price pane's height (y ${g.entryY.toFixed(1)} of ${g.paneHeight})`);
  return point;
}
/** A lower-pane indicator (RSI) on the Futures terminal lives in a pane of its own. A click there, with the
 *  picker armed and a bar already selected, must neither pick nor replace the selection. */
async function indicatorPaneControl(p) {
  await workspace(p, 'chart');
  const toggleRsi = async () => {
    await p.locator('.chart-indicators-trigger').click();
    const item = p.locator('.chart-menu button').filter({ hasText: /RSI/ }).first();
    await item.waitFor(); await item.click();
    await p.keyboard.press('Escape'); await delay(300);
  };
  await toggleRsi();
  await p.waitForFunction(() => window.__nativeQaChart.panes().length >= 3);
  await armChartPicker(p);
  await frameOldBars(p);
  const g = await p.evaluate(() => { const c = window.__nativeQaChart, r = c.chartElement().getBoundingClientRect(); return { left: r.left, top: r.top, p0: c.paneSize(0).height, p1: c.paneSize(1).height, p2: c.paneSize(2).height, panes: c.panes().length }; });
  const before = await stillPicking(p);
  assert(before.picking, 'Picker not armed');
  const bars = (await chartGeometry(p)).bars; assert(bars.length, 'No 0.004 bar is visible on the chart');
  const point = { x: g.left + bars[Math.floor(bars.length / 2)].x, y: g.top + g.p0 + g.p1 + g.p2 / 2 };
  await p.mouse.click(point.x, point.y); await delay(150);
  const after = await stillPicking(p);
  assert(after.picking && after.reference === before.reference, `A click in the indicator pane picked or changed the selection (picking ${after.picking}, reference ${before.reference} → ${after.reference})`);
  await p.keyboard.press('Escape'); await delay(150);
  assert(!(await stillPicking(p)).picking, 'Escape did not cancel the picker');
  await toggleRsi();
  await p.waitForFunction(() => window.__nativeQaChart.panes().length <= 2);
  return { panes: g.panes, point, paneHeights: [g.p0, g.p1, g.p2], picking: after.picking, referenceBefore: before.reference, referenceAfter: after.reference };
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
  if (!(await p.locator('[data-entry-reference]').count())) {
    await armChartPicker(p); await frameOldBars(p);
    s.evidence.controls = await negativeControls(p);
    await p.screenshot({ path: path.join(out, `pick-refusals-${width}.png`) });
    s.evidence.pick = await pickOldCandle(p);
    await p.screenshot({ path: path.join(out, `pick-accepted-${width}.png`) });
    await workspace(p, 'trade');
  }
  try { await p.locator('[data-entry-reference]').waitFor({ timeout: 10000 }); }
  catch {
    const dump = await p.evaluate(() => ({ formAttrs: [...(document.querySelector('.fo-form')?.attributes ?? [])].map(a => `${a.name}=${a.value.slice(0, 40)}`), reduceOnly: document.querySelector('.fo-form input[type=checkbox]')?.checked, picking: !!document.querySelector('[data-chart-picking]'), toolsOn: !!document.querySelector('.chart-surface[data-drawing-tools]'), buttons: [...document.querySelectorAll('.fo-submitPair button')].map(b => `${b.textContent?.trim()}:${b.disabled ? 'off' : 'on'}`), price: document.querySelector('.fo-priceInputRow input')?.value, form: document.querySelector('.fo-form')?.innerText.slice(0, 160).replace(/\s+/g, ' ') }));
    await p.screenshot({ path: path.join(out, `no-entry-reference-${side.toLowerCase()}-${width}.png`) });
    throw Error(`${side}: no entry reference after the pick: ${JSON.stringify(dump)}`);
  }
  const reference = JSON.parse(await p.locator('[data-entry-reference]').getAttribute('data-entry-reference'));
  if (!SERVER_ONLY) {
    // The bar is not announced in the panel any more (owner): the chart marks it, the price field carries it.
    assert(!(await p.locator('.fo-form').innerText()).includes('Вход'), 'The removed «Вход» row is still rendered');
    assert.equal(Number(await priceField(p).inputValue()), ENTRY, 'Price field does not show the selected historical price');
    assert.equal(await priceField(p).getAttribute('readonly'), '', 'Price field is editable while a bar is selected');
  }
  let typedLimit = false;
  if (SERVER_ONLY && LIMIT_PRICE && (await priceField(p).getAttribute('readonly')) === null) { await priceField(p).fill(LIMIT_PRICE); typedLimit = true; }
  const family = await selectedFamily(p);
  assert(family === 'LIMIT' || family === (await p.locator('.fo-panel .order-family-tabs [role=tab]').first().innerText().catch(() => 'LIMIT')).trim(), `LIMIT is not the selected order family: ${family}`);
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
  // One number format across the row — comma between thousands, dot before decimals — and the trader's own money in the trade.
  const cell = async n => (await row.locator(`td:nth-child(${n})`).innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(await cell(2), '1,500,000 AKE', 'Quantity is not grouped');
  // The archive design has no «Стоим.» column (owner, 2026-09-24): the
  // initial margin is the third cell and the unrealized P&L the seventh.
  assert.equal(await cell(3), '2,000.00 USDT', 'Initial margin column does not show size × entry ÷ leverage');
  assert((await cell(7)).includes('74,700.00') && (await cell(7)).includes('3,735.00%'), `Unrealized/ROI not grouped: ${await cell(7)}`);
  await p.screenshot({ path: path.join(out, `position-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
  // 6b. «Лимитный» on the row: a partial close as a resting LIMIT, then one that fills at the near-live price.
  let remaining = Number(QUANTITY);
  if (!SERVER_ONLY && side === 'LONG') {
    // «Лимитный» opens «Закрытие по лимиту» for this row (the reference's
    // dialog, 2026-09-22): the whole position prefilled, quantity and price
    // typed there, OK places the reduce-only LIMIT for THIS position.
    await row.locator('.futures-position-close').nth(0).click();
    const dialog = p.locator('[data-limit-close-dialog]'); await dialog.waitFor();
    assert.equal(await dialog.locator('[data-limit-close-qty]').inputValue(), QUANTITY, 'Limit close did not prefill the position size');
    assert.equal(await dialog.getAttribute('data-limit-close-side'), side);
    await dialog.locator('[data-limit-close-price]').fill('0.06'); await dialog.locator('[data-limit-close-qty]').fill('500000');
    const resting = await command(s, 'OPEN', () => dialog.locator('[data-limit-close-submit]').click());
    assert.equal(resting.draft.positionId, position.id, 'The limit close did not name the position');
    assert.equal(resting.draft.reduceOnly, true); assert.equal(resting.draft.type, 'LIMIT'); assert.equal(resting.draft.candle, undefined, 'A close carried the historical bar');
    const open = activeOrders(resting.state);
    assert.equal(open.length, counts.orders + 1, 'Reduce-only LIMIT above the mark did not rest');
    assert.equal(resting.state.positions.find(x => x.id === position.id).quantity, QUANTITY, 'A resting close changed the position');
    await workspace(p, 'positions');
    await p.waitForFunction(o => document.querySelector('#futures-tab-orders .reference-tab-count')?.textContent?.trim() === `(${o})`, counts.orders + 1);
    await p.locator('#futures-tab-orders').click();
    const cancelled = await command(s, 'CANCEL', () => p.locator('.futures-orders-table .cancel-btn').first().click());
    assert.equal(activeOrders(cancelled.state).length, counts.orders, 'Cancel did not remove the resting close');
    await p.locator('#futures-tab-positions').click();
    await row.locator('.futures-position-close').nth(0).click();
    await dialog.waitFor();
    await dialog.locator('[data-limit-close-price]').fill(String(CURRENT)); await dialog.locator('[data-limit-close-qty]').fill('500000');
    const partial = await command(s, 'OPEN', () => dialog.locator('[data-limit-close-submit]').click());
    remaining = Number(QUANTITY) - 500000;
    assert.equal(activeOrders(partial.state).length, counts.orders, 'A reduce-only LIMIT at the near-live price did not fill');
    assert.equal(Number(partial.state.positions.find(x => x.id === position.id).quantity), remaining, 'Partial limit close did not reduce the position');
    await workspace(p, 'positions');
    await p.waitForFunction(() => /1,000,000/.test(document.querySelector('.futures-position-row')?.innerText || ''));
    await p.screenshot({ path: path.join(out, `partial-limit-close-${width}.png`), fullPage: width === 390 });
  }
  // 6c. Issue #565: TP/SL arm on the historical position against the near-live price, the entry does not move, and the
  // row shows the engine's liquidation price (on the right side of the mark), or a dash when none exists.
  if (!SERVER_ONLY) {
    await workspace(p, 'positions');
    await p.locator('#futures-tab-positions').click();
    await row.locator('.fut-tpslTrigger').click();
    const [tp, sl] = side === 'LONG' ? ['0.06', '0.05'] : ['0.05', '0.06'];
    await p.locator('.fut-tpslInput').nth(0).fill(tp);
    await p.locator('.fut-tpslInput').nth(1).fill(sl);
    const armed = await command(s, 'PROTECTION', () => p.locator('.fut-tpslSave').click());
    const held = armed.state.positions.find(x => x.id === position.id);
    assert.deepEqual([Number(held.protection.takeProfit), Number(held.protection.stopLoss)], [Number(tp), Number(sl)], `TP/SL did not arm on the historical ${side}`);
    assert.equal(Number(held.entryPrice), ENTRY, 'Arming TP/SL moved the historical entry');
    assert.equal(held.executionMode, 'HISTORICAL_DEMO');
    await p.waitForFunction(() => !document.querySelector('.fut-tpslSave'));
    const shown = (await cell(6)).replace(/,/g, '');
    if (held.liquidationPrice === null) {
      // The engine's estimate: no price above zero empties this cross account, so there is no liquidation price.
      assert.equal(shown, '—', `No liquidation price exists, yet the row shows «${shown}»`);
    } else {
      const liquidation = Number(held.liquidationPrice), mark = Number(held.markPrice);
      assert(liquidation > 0 && (side === 'LONG' ? liquidation <= mark : liquidation >= mark), `Liquidation ${held.liquidationPrice} is not on the ${side} side of the ${mark} mark`);
      assert(Math.abs(Number(shown) - liquidation) / liquidation < 0.005, `Liquidation shown «${shown}» is not the engine's ${held.liquidationPrice}`);
    }
    report.protection = { ...(report.protection || {}), [`${side}-${width}`]: { takeProfit: held.protection.takeProfit, stopLoss: held.protection.stopLoss, liquidationPrice: held.liquidationPrice, shown } };
    await p.screenshot({ path: path.join(out, `tpsl-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
  }
  // 7. Close at the current near-live price from the table (the "Рыночный" close), no book involved.
  const closed = await command(s, 'CLOSE', () => row.locator('.futures-position-close').nth(1).click());
  assert.equal(closed.draft.positionId, position.id); assert.equal(closed.draft.candle, undefined, 'A close reused the historical selection');
  assert.equal(closed.state.positions.filter(x => x.symbol === SYMBOL).length, 0, 'Position still open after close');
  assert.equal(activeOrders(closed.state).length, counts.orders);
  const done = closed.state.history.find(x => x.id === position.id);
  assert(done && done.status === 'CLOSED', `Closed position missing from history: ${JSON.stringify(done)}`);
  // The partial LIMIT close and the market close of the rest both settled at the near-live price, on the same position.
  void remaining;
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

/** The same selected bar through the «Рыночный» tab: the form sends type MARKET with the bar attached and no
 *  price; the engine opens at the bar's price, exactly as from the LIMIT tab. Closed again at the near-live price. */
async function marketTabEntry(s, width, counts) {
  const p = s.page;
  await workspace(p, 'trade');
  const reference = JSON.parse(await p.locator('[data-entry-reference]').getAttribute('data-entry-reference'));
  const tabName = await chooseFamily(p, 1, 'MARKET');
  await p.waitForFunction(() => !document.querySelector('.fo-priceInputRow input'));
  await qty(p).fill(QUANTITY);
  await p.waitForFunction(() => !document.querySelector('.fo-submitPair .buy')?.disabled);
  await p.screenshot({ path: path.join(out, `market-tab-armed-${width}.png`), fullPage: width === 390 });
  const { state, draft } = await command(s, 'OPEN', () => button(p, 'LONG').click());
  assert.equal(draft.type, 'MARKET'); assert.equal(draft.price, undefined, 'The Market tab sent a price'); assert.deepEqual(draft.candle, reference); assert.equal(draft.executionMode, 'HISTORICAL_DEMO');
  assert.equal(state.positions.length, counts.positions + 1); assert.equal(activeOrders(state).length, counts.orders);
  const position = state.positions.find(x => x.symbol === SYMBOL && x.side === 'LONG');
  assert(position, 'No LONG AKE position from the Market tab');
  assert.equal(Number(position.entryPrice), ENTRY, `Market-tab entry is ${position.entryPrice}, not the selected ${ENTRY}`);
  assert(Math.abs(Number(position.markPrice) - CURRENT) < 1e-9);
  assert.equal(position.executionMode, 'HISTORICAL_DEMO');
  const order = state.orders.find(o => o.positionId === position.id || o.id === position.id);
  assert(order && order.status === 'FILLED' && order.type === 'MARKET' && Number(order.historicalPrice) === ENTRY, `Market-tab order: ${JSON.stringify(order)}`);
  await workspace(p, 'positions');
  await p.locator('#futures-tab-positions').click();
  const row = p.locator('.futures-position-row[data-side="LONG"]').filter({ hasText: 'AKE' }).first(); await row.waitFor();
  const closed = await command(s, 'CLOSE', () => row.locator('.futures-position-close').nth(1).click());
  assert.equal(closed.state.positions.filter(x => x.symbol === SYMBOL).length, 0, 'Market-tab position still open after close');
  await workspace(p, 'trade'); await chooseFamily(p, 0, 'LIMIT');
  await p.waitForFunction(() => !!document.querySelector('.fo-priceInputRow input'));
  return { tab: tabName, submittedType: draft.type, price: draft.price ?? null, entry: position.entryPrice, mark: position.markPrice, orderType: order.type, historicalPrice: order.historicalPrice, positionsAfterClose: closed.state.positions.length };
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
    if (!SERVER_ONLY) {
      results.MARKET_TAB = await marketTabEntry(s, width, counts);
      // The phone keeps the indicator menus in the chart workspace's sheet; the separate-pane rule is one code
      // path (paneIndex ≠ 0), exercised here on the desktop layout and in chartTrading.test.ts.
      await workspace(p, 'chart');
      if (await p.locator('.chart-indicators-trigger').isVisible()) {
        results.indicatorPane = await indicatorPaneControl(p);
        await p.screenshot({ path: path.join(out, `indicator-pane-control-${width}.png`) });
      } else results.indicatorPane = { skipped: 'no visible indicator trigger in this layout; covered at 1440 and by the unit test' };
    }
    // No liquidity dependency: the fixture quote holds ONE contract per side, every fill above was 1 500 000.
    const quote = await (await s.context.request.get(origin + '/api/v1/futures/mark-price/' + PAIR.replace('/', '-'))).json();
    assert(Math.abs(Number(quote.markPrice) - CURRENT) < 1e-9);
    assert.deepEqual(report.errors, [], 'Browser runtime errors');
    return { width, pick: s.evidence.pick, controls: s.evidence.controls, ...results };
  } finally { await s.context.close(); }
}

async function main() {
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-historical-entry-observer-${process.pid}.mjs`);
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};export function createChart(...args){const c=original(...args);window.__nativeQaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);/* first candlestick series = the data series; the chart workspace (2026-10-14) adds hidden display-only candlestick series for Hollow and Heikin-Ashi after it */if(type===CandlestickSeries&&!window.__nativeQaSeries)window.__nativeQaSeries=s;return s;};return c;}`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') }, logLevel: 'error' });
  await startServer(); const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright'); browser = await chromium.launch({ headless: true });
  for (const width of (process.env.HISTORICAL_QA_WIDTHS || '1440,390').split(',').map(Number)) await check(`historical-entry-${width}`, () => historicalEntry(width));
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}
main().catch(error => { report.passed = false; report.failure = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true }); });
