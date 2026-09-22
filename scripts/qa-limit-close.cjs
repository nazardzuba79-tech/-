/** Browser QA — «Лимитный» on a position row is «Закрытие по лимиту», and a
 * partial limit close really is partial.
 *
 * Owner's production report (2026-09-22): the old «Лимитный» only handed the
 * order form a reduce-only ticket, the trader had to retype the quantity and
 * both Long/Short buttons looked live. This run proves the reference's
 * dialog end to end, on the real `/futures` terminal against the isolated
 * fixture engine, for a LONG and a SHORT of 15 000 000 AKE at 10x opened as a
 * historical entry (the owner's case):
 *
 *   dialog opens for THAT row (entry, market price, quantity prefilled with
 *   the whole position, slider 25 / 50 / typed amount, expected result) →
 *   Post-Only at a crossing price is refused with the reason and nothing is
 *   sent → a far limit rests in «Открытые ордера (1)» while the position
 *   stays 15 000 000, and cancelling it leaves the position untouched → a
 *   near limit rests, then FILLS when the fixture's drifting price reaches
 *   it: the position becomes 10 000 000 (not closed, no opposite side),
 *   realized P&L moves by the closed 5 000 000 only, the order leaves
 *   «Открытые ордера» → a 25% close through the slider at a marketable
 *   price takes 2 500 000 more → in the order form, «Только уменьшение»
 *   disables the side that has nothing to reduce, with the reason.
 *
 * Every HTTP command is read off the wire (kind, type, reduceOnly,
 * positionId, side, quantity, price) and every outcome off the server state.
 * Fixture only: the AKE drift is a QA lever (`NATIVE_PREVIEW_AKE_DRIFT`).
 *
 *   node scripts/qa-limit-close.cjs            # 1440, 1600, 390 × LONG, SHORT
 *   LIMIT_QA_WIDTHS=1440 LIMIT_QA_SIDES=LONG node scripts/qa-limit-close.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = process.env.LIMIT_QA_OUT || path.join(root, 'docs/qa/limit-close');
const port = process.env.NATIVE_QA_PORT || '4187';
const origin = `http://127.0.0.1:${port}`;
const WIDTHS = (process.env.LIMIT_QA_WIDTHS || '1440,1600,390').split(',').map(Number);
const SIDES = (process.env.LIMIT_QA_SIDES || 'LONG,SHORT').split(',');
const QUANTITY = '15000000', LEVERAGE = '10', PART = '5000000';
/** Per minute after the fixture starts: up for a long's close above the market, down for a short's below. */
const DRIFT = 0.002;
const report = { scope: 'real /futures terminal, isolated native fixture (AKE drift lever)', checks: [], errors: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
let server = null, browser = null;

async function startServer(drift) {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root, env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_AKE_DRIFT: String(drift) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); const h = await r.json(); if (r.ok && h.fixtureMarket === true) return; } catch {}
    await delay(500);
  }
  throw Error('fixture server did not become healthy');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
  server = null;
}
async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, passed: true, evidence }); console.log('PASS', name); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error.stack || error) }); console.log('FAIL', name, String(error.message || error).slice(0, 400)); }
}
async function api(context, token, endpoint, body) {
  const r = await context.request[body === undefined ? 'get' : 'post'](origin + '/api/v1/private-trading/native/' + endpoint, { headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }) });
  const data = await r.json(); assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(data).slice(0, 300)}`); return data;
}
const activeOrders = state => state.orders.filter(o => ['OPEN', 'PARTIALLY_FILLED'].includes(o.status));
const position = (state, id) => state.positions.find(p => p.id === id);

async function session(width, side) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, locale: 'ru-RU', timezoneId: 'UTC' });
  // Same sandbox as the native QA: the page reaches only the fixture. Without this the tape subscribes to
  // Bybit's real public stream on a runner with internet, and the dialog's «Рыночная цена» is the real
  // AKE trade while the engine's mark is the fixture's drifting price (CI on #180: 0.052896 vs ~0.0558).
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const html = await (await context.request.get(origin + '/futures')).text();
  const token = JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
  let state = await api(context, token, 'state');
  if (!state.initialized) state = await api(context, token, 'initialize', { acceptedModel: state.model.version, idempotencyKey: 'limit-qa-init' });
  // The owner's case: 15 000 000 AKE at 10x from an old bar (entry 0.004), both sides.
  const openTime = Math.floor((Date.now() - 20 * 3600000) / 3600000) * 3600000;
  state = await api(context, token, 'commands', { kind: 'OPEN', symbol: 'AKEUSDT', side, type: 'MARKET', quantity: QUANTITY, leverage: LEVERAGE, idempotencyKey: `limit-qa-${side}-${width}`, executionMode: 'HISTORICAL_DEMO', candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime, pricePoint: 'CLOSE' } });
  const target = state.positions.find(p => p.symbol === 'AKEUSDT' && p.side === side);
  assert(target && target.quantity === QUANTITY, `seed position missing: ${JSON.stringify(state.positions)}`);
  const drafts = [];
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('request', r => { if (r.url().endsWith('/native/commands') && r.method() === 'POST') { const d = r.postDataJSON(); if (d && d.kind !== 'REFRESH') drafts.push(d); } });
  // The AKE terminal, so the order form's reduce-only gating and the dialog's contract rules are AKE's.
  await page.goto(origin + '/futures?pair=' + encodeURIComponent('AKE/USDT')); await page.locator('.chart-surface').waitFor();
  return { context, page, token, drafts, target };
}
async function workspace(page, name) { const tab = page.locator(`#mobile-futures-${name}`); if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click(); }
async function positionsTab(page) { await workspace(page, 'positions'); await page.locator('#futures-tab-positions').click(); await page.locator('.futures-position-row').first().waitFor(); }
async function ordersTab(page) { await workspace(page, 'positions'); await page.locator('#futures-tab-orders').click(); }
/** Press a button and read the very next command off the wire together with the server's answer. */
async function command(s, kind, action) {
  const before = s.drafts.length;
  const response = s.page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === kind, { timeout: 30000 });
  await action(); const r = await response; const draft = r.request().postDataJSON(); const body = await r.json();
  assert(s.drafts.length > before, 'no command was sent');
  return { draft, ok: r.ok(), state: body, status: r.status() };
}
const dialog = page => page.locator('[data-limit-close-dialog]');
const cell = async (row, n) => (await row.locator(`td:nth-child(${n})`).innerText()).replace(/\s+/g, ' ').trim();
const num = text => Number(String(text).replace(/[^\d.\-]/g, ''));
/** The engine's own near-live mark for the position, read right before an order is priced off it. The dialog's
 *  «Рыночная цена» is the same figure a few seconds older (ticker stream, positions poll); on a slow runner those
 *  seconds are ticks of drift, so a limit meant to rest or to be marketable is priced off the engine's number. */
const engineMark = async (s, id) => Number(position(await api(s.context, s.token, 'state'), id).markPrice);

async function scenario(side, width) {
  const s = await session(width, side), { page: p, target } = s;
  const sign = side === 'LONG' ? 1 : -1, closeSide = side === 'LONG' ? 'SHORT' : 'LONG';
  const evidence = { side, width, positionId: target.id, before: target.quantity, realizedBefore: target.realizedPnl };
  try {
    await positionsTab(p);
    const row = p.locator(`.futures-position-row[data-side=${side}]`).first();
    assert.equal(await cell(row, 2), '15,000,000 AKE', 'seed position row');
    // 1. The dialog, for this row.
    await row.locator(`[data-limit-close-open="${target.id}"]`).click();
    await dialog(p).waitFor();
    const d = dialog(p);
    assert.equal(await d.getAttribute('data-limit-close-side'), side);
    const entry = Number(await d.locator('[data-limit-close-entry]').getAttribute('data-limit-close-entry'));
    const market = Number(await d.locator('[data-limit-close-market]').getAttribute('data-limit-close-market'));
    // The fixture drifts up for the long's run and down for the short's, from 0.0538 at its start.
    assert.equal(entry, 0.004, 'entry price in the dialog'); assert(sign * (market - 0.0538) >= -1e-9 && Math.abs(market - 0.0538) < 0.01, `market price in the dialog: ${market}`);
    assert.equal(await d.locator('[data-limit-close-qty]').inputValue(), QUANTITY, 'quantity is prefilled with the whole position');
    assert.equal(await d.locator('[data-limit-close-percent]').inputValue(), '100');
    assert.equal(Number(await d.locator('[data-limit-close-price]').inputValue()), market, 'close price is seeded with the market price');
    await d.locator('[data-limit-close-stop="25"]').click(); assert.equal(await d.locator('[data-limit-close-qty]').inputValue(), '3750000', '25% of the position');
    await d.locator('[data-limit-close-stop="50"]').click(); assert.equal(await d.locator('[data-limit-close-qty]').inputValue(), '7500000', '50% of the position');
    await d.locator('[data-limit-close-qty]').fill(PART);
    assert.equal(await d.locator('[data-limit-close-percent]').inputValue(), '33', 'typed quantity moves the slider');
    const summary = await d.locator('[data-limit-close-summary]').innerText();
    assert(summary.includes('5,000,000') && summary.includes('AKE') === false, `summary names the closed quantity: ${summary}`);
    await p.screenshot({ path: path.join(out, `dialog-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
    evidence.dialog = { entry, market, summary };
    // 2. Post-Only at a crossing price is refused here, nothing is sent.
    const crossing = ((await engineMark(s, target.id)) - sign * 0.001).toFixed(4);
    await d.locator('[data-limit-close-post-only]').check();
    await d.locator('[data-limit-close-price]').fill(crossing);
    const sent = s.drafts.length;
    await d.locator('[data-limit-close-submit]').click();
    await d.locator('.flc-error').waitFor();
    await delay(300); assert.equal(s.drafts.length, sent, 'a refused Post-Only order was sent anyway');
    evidence.postOnlyRefusal = await d.locator('.flc-error').innerText();
    await d.locator('[data-limit-close-post-only]').uncheck();
    // 3. A far limit rests; the position does not move; cancel leaves it untouched.
    const far = ((await engineMark(s, target.id)) + sign * 0.01).toFixed(4);
    await d.locator('[data-limit-close-price]').fill(far);
    const resting = await command(s, 'OPEN', () => d.locator('[data-limit-close-submit]').click());
    assert(resting.ok, `far limit refused: ${JSON.stringify(resting.state).slice(0, 200)}`);
    assert.deepEqual({ kind: resting.draft.kind, type: resting.draft.type, reduceOnly: resting.draft.reduceOnly, positionId: resting.draft.positionId, side: resting.draft.side, quantity: resting.draft.quantity, price: Number(resting.draft.price) },
      { kind: 'OPEN', type: 'LIMIT', reduceOnly: true, positionId: target.id, side: closeSide, quantity: PART, price: Number(far) }, 'the wire payload of the limit close');
    assert.equal(resting.draft.candle, undefined, 'a close carried a historical bar');
    assert.equal(activeOrders(resting.state).length, 1, 'the far limit did not rest');
    assert.equal(position(resting.state, target.id).quantity, QUANTITY, 'a resting close changed the position');
    await p.waitForFunction(() => !document.querySelector('[data-limit-close-dialog]'), null, { timeout: 10000 });
    await ordersTab(p);
    await p.waitForFunction(() => document.querySelector('#futures-tab-orders .reference-tab-count')?.textContent?.trim() === '(1)');
    const ordersText = (await p.locator('#futures-bottom-content').innerText()).replace(/\s+/g, ' ');
    assert(ordersText.includes('5,000,000') || ordersText.includes('5000000'), `open orders row shows the quantity: ${ordersText.slice(0, 200)}`);
    await p.screenshot({ path: path.join(out, `resting-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
    const cancelled = await command(s, 'CANCEL', () => p.locator('.futures-orders-table .cancel-btn').first().click());
    assert.equal(activeOrders(cancelled.state).length, 0, 'cancel did not remove the resting close');
    assert.equal(position(cancelled.state, target.id).quantity, QUANTITY, 'cancel changed the position');
    assert.equal(position(cancelled.state, target.id).realizedPnl, target.realizedPnl, 'cancel changed realized P&L');
    evidence.cancel = { restedAt: far, ordersAfterCancel: activeOrders(cancelled.state).length, quantityAfterCancel: position(cancelled.state, target.id).quantity };
    // 4. A near limit rests, then fills when the price reaches it: 15 000 000 → 10 000 000.
    await positionsTab(p);
    await row.locator(`[data-limit-close-open="${target.id}"]`).click(); await dialog(p).waitFor();
    const market2 = Number(await dialog(p).locator('[data-limit-close-market]').getAttribute('data-limit-close-market'));
    assert(Math.abs(market2 - (await engineMark(s, target.id))) < 0.002, `the dialog's market price ${market2} is not the engine's mark`);
    await dialog(p).locator('[data-limit-close-qty]').fill(PART);
    // Eight ticks beyond the engine's mark, read a second before OK: at 0.002 per minute the mark needs ~24s
    // to reach it, so it rests, and fills within the wait below.
    const near = ((await engineMark(s, target.id)) + sign * 0.0008).toFixed(4);
    await dialog(p).locator('[data-limit-close-price]').fill(near);
    const placed = await command(s, 'OPEN', () => dialog(p).locator('[data-limit-close-submit]').click());
    assert(placed.ok, `near limit refused: ${JSON.stringify(placed.state).slice(0, 200)}`);
    assert.equal(activeOrders(placed.state).length, 1, `the near limit did not rest (limit ${near}, dialog market ${market2}, orders ${JSON.stringify(placed.state.orders.slice(-1).map(o => [o.status, o.price, o.averagePrice]))})`);
    assert.equal(position(placed.state, target.id).quantity, QUANTITY, 'the near limit changed the position before the price reached it');
    const orderId = activeOrders(placed.state)[0].id;
    let filled = null;
    for (let i = 0; i < 60 && !filled; i++) {
      await delay(3000);
      const now = await api(s.context, s.token, 'state');
      if (position(now, target.id) && position(now, target.id).quantity !== QUANTITY) filled = now;
    }
    assert(filled, 'the price reached the limit but the close did not fill within three minutes');
    const after = position(filled, target.id);
    assert.equal(after.quantity, '10000000', `the partial close left ${after.quantity}, not 10 000 000 (orders: ${JSON.stringify(filled.orders.map(o => [o.id, o.status, o.filled, o.remaining]))})`);
    assert.equal(after.side, side, 'the close flipped the position side');
    assert.equal(filled.positions.filter(x => x.symbol === 'AKEUSDT').length, 1, 'a second AKE position appeared');
    assert.equal(activeOrders(filled).length, 0, 'the filled order still shows as open');
    const order = filled.orders.find(o => o.id === orderId);
    assert(order && order.status === 'FILLED' && order.filled === PART, `order after fill: ${JSON.stringify(order)}`);
    const fillPrice = Number(order.averagePrice);
    assert(sign * (fillPrice - Number(near)) >= -1e-9, `filled at ${fillPrice}, worse than the limit ${near}`);
    const realizedDelta = Number(after.realizedPnl) - Number(target.realizedPnl);
    const gross = sign * (fillPrice - entry) * Number(PART);
    assert(Math.abs(realizedDelta - gross) <= Number(PART) * fillPrice * 0.0011 + 1e-6, `realized moved by ${realizedDelta}, expected ${gross} less fees`);
    await p.waitForFunction(() => /10,000,000/.test(document.querySelector('.futures-position-row')?.innerText || ''));
    await p.screenshot({ path: path.join(out, `filled-${side.toLowerCase()}-${width}.png`), fullPage: width === 390 });
    evidence.fill = { limit: near, fillPrice, quantityAfter: after.quantity, realizedBefore: target.realizedPnl, realizedAfter: after.realizedPnl, realizedDelta, gross };
    // 5. 25% through the slider, at a marketable price: 2 500 000 of the remaining 10 000 000.
    await row.locator(`[data-limit-close-open="${target.id}"]`).click(); await dialog(p).waitFor();
    await dialog(p).locator('[data-limit-close-stop="25"]').click();
    assert.equal(await dialog(p).locator('[data-limit-close-qty]').inputValue(), '2500000', '25% of the remaining position');
    // Ten ticks inside the engine's mark: marketable. A historical account fills it at the near-live replay,
    // which the OPEN itself or the terminal's next poll carries — so the check waits for the fill, briefly.
    await dialog(p).locator('[data-limit-close-price]').fill(((await engineMark(s, target.id)) - sign * 0.001).toFixed(4));
    const quarter = await command(s, 'OPEN', () => dialog(p).locator('[data-limit-close-submit]').click());
    assert(quarter.ok); assert.equal(quarter.draft.quantity, '2500000');
    let settled = quarter.state;
    for (let i = 0; i < 10 && position(settled, target.id).quantity !== '7500000'; i++) { await delay(3000); settled = await api(s.context, s.token, 'state'); }
    assert.equal(position(settled, target.id).quantity, '7500000', `the marketable 25% close left ${position(settled, target.id).quantity}, not 7 500 000 (draft ${JSON.stringify(quarter.draft)}; orders: ${JSON.stringify(activeOrders(settled).map(o => [o.status, o.price, o.remaining]))})`);
    assert.equal(activeOrders(settled).length, 0);
    evidence.quarter = { quantityAfter: position(settled, target.id).quantity, filledInOpen: position(quarter.state, target.id).quantity === '7500000' };
    // 6. The order form under «Только уменьшение»: only the side with something to reduce is live.
    if (width !== 390) {
      await workspace(p, 'trade');
      await p.locator('.fo-reduceOnlyRow input').check();
      await p.waitForFunction(side => document.querySelector(side === 'LONG' ? '.fo-submitPair .buy' : '.fo-submitPair .sell')?.getAttribute('data-reduce-blocked') === 'true', side);
      const buyBlocked = await p.locator('.fo-submitPair .buy').getAttribute('data-reduce-blocked');
      const sellBlocked = await p.locator('.fo-submitPair .sell').getAttribute('data-reduce-blocked');
      assert.equal(buyBlocked, side === 'LONG' ? 'true' : null, 'BUY (closes a short) gating');
      assert.equal(sellBlocked, side === 'SHORT' ? 'true' : null, 'SELL (closes a long) gating');
      const blockedTitle = await p.locator(side === 'LONG' ? '.fo-submitPair .buy' : '.fo-submitPair .sell').getAttribute('title');
      assert(blockedTitle && /AKE/.test(blockedTitle), `the blocked side names the reason: ${blockedTitle}`);
      evidence.formGating = { buyBlocked, sellBlocked, blockedTitle };
      await p.locator('.fo-reduceOnlyRow input').uncheck();
    }
    return evidence;
  } finally { await s.context.close(); }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const side of SIDES) {
      await stopServer(); await startServer(side === 'LONG' ? DRIFT : -DRIFT);
      for (const width of WIDTHS) await check(`limit-close-${side}-${width}`, () => scenario(side, width));
    }
    assert.deepEqual(report.errors, [], 'browser runtime errors');
    assert(report.checks.every(c => c.passed), `${report.checks.filter(c => !c.passed).length} checks failed`);
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = String(error.stack || error); process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.map(c => ({ name: c.name, passed: c.passed, error: c.error && c.error.split('\n')[0] })) }, null, 2));
    await browser?.close(); await stopServer();
  }
})();
