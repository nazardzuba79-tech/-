/** Original /futures owner flow. Disposable fixture server ONLY; never production QA.
 * Trade actions use the normal form/tables and the actual NativeDemoService.
 * Layout fixtures are explicitly synthetic and only intercept this local server.
 * A failed product invariant stays red; no legacy UI is restored or mocked in.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), front = path.join(root, 'frontend');
const largeOnly = process.env.NATIVE_QA_LARGE_ONLY === '1';
/** `NATIVE_QA_ONLY=<regex>` runs the matching checks alone (local iteration on one scenario); unset = every check. */
const only = process.env.NATIVE_QA_ONLY ? new RegExp(process.env.NATIVE_QA_ONLY) : null;
const out = path.join(root, 'docs/qa/native-demo', largeOnly ? 'large-numbers' : '');
fs.mkdirSync(out, { recursive: true });
const origin = 'http://127.0.0.1:4178';
const report = { fixtureOnly: true, productionVerified: false, scope: largeOnly ? 'original terminal / synthetic layout values' : 'original terminal / isolated native engine', checks: [], errors: [] };
let browser, server, activePage, shim;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = page => page.locator('.futures-positions-table tbody tr');
const qty = page => page.locator('.fo-qtyInputRow input');
const price = page => page.locator('.fo-priceInputRow input');
const button = (page, side) => page.locator(`.fo-submitPair .${side === 'LONG' ? 'buy' : 'sell'}`);
const positionRow = (page, side) => rows(page).filter({ has: page.locator(`.futures-position-contract .text-${side === 'LONG' ? 'buy' : 'sell'}`) });
function realAccountRequest(request) {
  const p = new URL(request.url()).pathname;
  return p.startsWith('/api/v1/futures/') &&
    (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /^\/api\/v1\/futures\/(balances|positions|orders|trades|fills|account|funding-history|transfers)(?:\/|$)/.test(p));
}
async function check(name, fn) {
  if (only && !only.test(name)) return true;
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) }); return true; }
  catch (error) {
    report.checks.push({ name, passed: false, error: String(error.stack || error) });
    console.error(`[FAIL] ${name}: ${error.message}`);
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(out, `${name.replace(/[^a-z0-9-]/gi, '-')}-failed.png`), fullPage: true }).catch(() => {});
    return false;
  }
}
async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root, env: { ...process.env, PORT: '4178', NATIVE_PREVIEW_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 60; i++) {
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
async function session(width, configure) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, acceptDownloads: true, locale: 'ru-RU', timezoneId: 'UTC' });
  // Provision a disposable, pre-existing owner fixture, not a second product account.
  // This deliberately does NOT claim to test production login or first-run initialization.
  const html = await (await context.request.get(origin + '/futures')).text();
  const match = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
  assert(match, 'Isolated preview did not provide its fixture session');
  const token = JSON.parse(match[1]);
  let initial = await api(context, token, 'state');
  if (!initial.initialized) initial = await api(context, token, 'initialize', { acceptedModel: initial.model.version, idempotencyKey: 'qa-initialize-existing-fixture' });
  assert(initial.initialized && initial.account, 'Fixture initialization was not confirmed');
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const realRequests = [], drafts = [];
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => {
    if (realAccountRequest(request)) realRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
    if (request.url().endsWith('/native/commands') && request.method() === 'POST') drafts.push(request.postDataJSON());
  });
  const s = { context, page, token, initial, realRequests, drafts };
  if (configure) await configure(s);
  await page.goto(origin + '/futures'); await page.locator('.fo-form').waitFor();
  return s;
}
async function ready(s) {
  // The permanent "Торговля с графика" strip is gone; the chart surface is
  // what tells us the terminal has composed. A blank order is deliberately
  // NOT actionable now, so readiness is the authoritative account plus the
  // auto-seeded LIMIT price — not an enabled submit button with no size.
  await s.page.locator('.chart-surface').waitFor();
  await s.page.waitForFunction(() => {
    const balance = document.querySelector('.futures-account-balance .mono')?.textContent?.trim();
    const limit = document.querySelector('.fo-priceInputRow input');
    return Boolean(balance && !balance.includes('—') && limit && Number(limit.value) > 0);
  });
}

/** Open the chart tool menu the way a trader does: a double click ON the chart. */
async function openChartMenu(p) {
  // Scroll first: at 390px the chart sits below the fold, and a viewport
  // coordinate taken from an off-screen box lands somewhere else entirely.
  await p.locator('.chart-surface').scrollIntoViewIfNeeded();
  const menu = p.locator('.chart-tools-menu');
  // A few points across the chart body. The menu deliberately does not open
  // from a control inside the chart (the drawing rail, the interval tabs),
  // and at 390px those occupy a much larger share of the width — so try
  // more than one spot rather than assume where the bare canvas is.
  for (const [fx, fy] of [[0.55, 0.55], [0.72, 0.45], [0.62, 0.72], [0.8, 0.6]]) {
    const box = await p.locator('.chart-surface').boundingBox();
    await p.mouse.dblclick(box.x + box.width * fx, box.y + box.height * fy);
    try { await menu.waitFor({ timeout: 3000 }); return; } catch {}
  }
  await menu.waitFor();
}
/** The switch alone. Closing is Esc in BOTH directions: the menu's primary
 *  action is "pick an entry on the chart", which also ARMS the picker, so
 *  using it to dismiss the menu armed a tool this caller never asked for —
 *  and left the next gesture racing that tool's own first click. */
async function setChartTools(p, on) {
  await openChartMenu(p);
  const input = p.locator('.chart-tools-menu .chart-tools-switch input');
  if (on) await input.check(); else await input.uncheck();
  await p.keyboard.press('Escape');
  await p.locator('.chart-tools-menu').waitFor({ state: 'detached' });
}
/** Turn the tools on AND arm the entry picker, the way the menu's primary
 *  action does — which is what a trader presses to choose a bar. */
async function armChartPicker(p) {
  await openChartMenu(p);
  await p.locator('.chart-tools-menu .chart-tools-switch input').check();
  await p.locator('.chart-tools-action').click();
  await p.locator('.chart-tools-menu').waitFor({ state: 'detached' });
  await p.locator('.chart-surface[data-chart-picking]').waitFor();
}
async function family(page, type) {
  await page.locator('.fo-panel .order-family-tabs [role=tab]').nth(type === 'MARKET' ? 1 : 0).click();
  await page.locator(type === 'MARKET' ? '.fo-markPrice' : '.fo-priceInputRow input').waitFor();
}
async function command(s, kind, action) {
  const waiting = s.page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === kind);
  await action(); const response = await waiting; const state = await response.json();
  assert(response.ok(), `${kind}: ${response.status()} ${JSON.stringify(state)}`);
  assert(state.initialized && state.account, `${kind} did not return an authoritative account`);
  // A successful order intentionally clears Quantity, which disables the
  // next submit until the trader sizes it. Yield one UI turn instead of
  // treating an empty-but-enabled button as the definition of readiness.
  await s.page.waitForTimeout(80);
  return { state, draft: response.request().postDataJSON() };
}
async function open(s, side, quantity) {
  await family(s.page, 'MARKET'); await qty(s.page).fill(quantity);
  await button(s.page, side).waitFor({ state: 'visible' });
  await s.page.waitForFunction(side => {
    const b = document.querySelector(`.fo-submitPair .${side === 'LONG' ? 'buy' : 'sell'}`);
    return b && !b.disabled;
  }, side);
  const result = await command(s, 'OPEN', () => button(s.page, side).click());
  assert.equal(result.draft.side, side); assert.equal(result.draft.quantity, quantity); assert.equal(result.draft.type, 'MARKET'); return result.state;
}
async function geometry(page) {
  const g = await page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const p = document.querySelector('.fo-priceField'), q = document.querySelector('.fo-qtyInputRow').closest('.fo-field');
    return { price: rect(p), quantity: rect(q), long: rect(document.querySelector('.fo-submitPair .buy')), short: rect(document.querySelector('.fo-submitPair .sell')), trailing: [p, q].map(e => ({ outer: rect(e), inner: rect(e.querySelector('.fo-fieldTrailing')) })) };
  });
  for (const k of ['width', 'height', 'left', 'right']) assert(Math.abs(g.price[k] - g.quantity[k]) <= 0.1, `Price/Quantity ${k} differs: ${g.price[k]} vs ${g.quantity[k]}`);
  assert(Math.abs(g.long.width - g.short.width) <= 0.1, 'Long/Short widths differ');
  for (const { outer, inner } of g.trailing) assert(inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom, 'Trailing unit/button is outside field');
  return g;
}
async function tableLayout(page, width) {
  const g = await page.evaluate(() => {
    const panel = document.querySelector('.futures-positions-panel'), scroller = document.querySelector('.futures-positions-scroll') || panel?.querySelector('table')?.parentElement;
    const cells = [...(panel?.querySelectorAll('tbody td') || [])];
    const clipped = cells.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText);
    const overlap = [...(panel?.querySelectorAll('tbody tr') || [])].flatMap(tr => [...tr.children].slice(1).flatMap((e, i) => { const a = tr.children[i].getBoundingClientRect(), b = e.getBoundingClientRect(); return a.right > b.left + 1 ? [i] : []; }));
    const old = document.querySelectorAll('.native-demo-controls,.native-demo-panel,.native-mode-switch').length;
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, clipped, overlap, old, headers: [...(panel?.querySelectorAll('th') || [])].map(e => e.innerText), text: panel?.innerText || '', scroll: scroller ? { client: scroller.clientWidth, full: scroller.scrollWidth, overflow: getComputedStyle(scroller).overflowX } : null };
  });
  assert(g.pageWidth <= g.viewport + 1, `Page horizontal overflow: ${g.pageWidth} > ${g.viewport}`);
  assert.equal(g.old, 0, 'Legacy terminal UI was rendered'); assert.deepEqual(g.clipped, [], 'Table cell clipping'); assert.deepEqual(g.overlap, [], 'Table cell overlap');
  assert(!/NaN|Infinity|\d[eE][+-]?\d/.test(g.text), 'Invalid/scientific financial value');
  assert(g.scroll, 'No internal table scroller');
  if (g.scroll.full > g.scroll.client + 1) assert(['auto', 'scroll'].includes(g.scroll.overflow), 'Wide table is not internally scrollable');
  if (width === 390) assert(g.scroll.full > g.scroll.client, 'Phone table unexpectedly lost its columns');
  return g;
}
async function card(page, filename, width) {
  const dialog = page.locator('.private-card-dialog'); await dialog.locator('img').waitFor();
  const g = await dialog.evaluate(d => { const i = d.querySelector('img'), r = i.getBoundingClientRect(), b = d.getBoundingClientRect(); return { width: r.width, height: r.height, top: b.top, bottom: b.bottom, dialogHeight: b.height, vh: innerHeight, clipped: d.scrollHeight > d.clientHeight + 1, text: d.innerText, alt: i.alt, href: d.querySelector('a')?.getAttribute('href') || '' }; });
  assert(!g.clipped && g.top >= 0 && g.bottom <= g.vh && g.dialogHeight <= g.vh * .9, 'P&L modal is clipped/outside viewport');
  if (width >= 1024) assert(g.width >= 318 && g.width <= 342, `P&L width ${g.width}`);
  assert(Math.abs(g.height / g.width - 1215 / 1080) < .02, 'P&L portrait aspect ratio changed');
  assert(!/Симуляция|Simulation|Demo|Historical Test|Preview|fixture/i.test(g.text + g.alt), 'P&L leaks fixture/mode wording');
  assert(!g.href.includes('privateTrading=1'), 'P&L uses legacy URL');
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Сохранить PNG', exact: true }).click();
  const saved = await download; const file = path.join(out, filename); await saved.saveAs(file);
  const png = fs.readFileSync(file); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 1080); assert.equal(png.readUInt32BE(20), 1215);
  assert(!/simulation|preview|demo/i.test(saved.suggestedFilename()), 'PNG filename leaks mode wording');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); return { ...g, exported: '1080x1215' };
}
/**
 * Every amount is rendered with group separators and a non-breaking space
 * before its unit. Those are display, not arithmetic, so the comparisons
 * below run on the digits: `56 405 024.03\u00a0USDT` -> `56405024.03 USDT`.
 * The separators themselves are asserted separately, right after.
 */
const plainAmount = (text) => (text || '').replace(/\u00a0/g, ' ').replace(/(?<=\d) (?=\d)/g, '').trim();

/**
 * What the card should print for a margin ratio.
 *
 * Two decimals, except that a KNOWN non-zero usage too small for them reads
 * `<0.01%` — a position that exists is a different fact from no position at
 * all. A real zero is still `0.00%`.
 */
function expectedUsagePercent(part, equity) {
  const value = (Number(part) / Number(equity)) * 100;
  if (value > 0 && value < 0.005) return '<0.01%';
  return value.toFixed(2) + '%';
}

async function accountSummary(page, state) {
  const g = await page.locator('.futures-account-summary').evaluate(e => ({
    balance: e.querySelector('.futures-account-balance .fa-value')?.textContent,
    available: e.querySelector('.futures-account-available .fa-value')?.textContent,
    im: e.querySelector('.futures-account-im .fa-value')?.textContent,
    mm: e.querySelector('.futures-account-mm .fa-value')?.textContent,
    // The bottom card no longer repeats the margin mode — the owner asked
    // for that duplicate row to go. The mode lives on the working switcher
    // at the top of the same panel, so that is where it is read from now.
    modeRowInCard: e.querySelector('.futures-account-mode') !== null,
    units: [...e.querySelectorAll('.futures-account-stat .fa-unit')].map(x => x.textContent),
  }));
  g.mode = await page.locator('.fo-mlTriggerText').innerText();
  assert(/(?:Cross|Кросс)/i.test(g.mode || ''), 'Owner margin mode is not Cross: ' + JSON.stringify(g));
  assert.equal(g.modeRowInCard, false, 'The duplicate margin-mode row is back in the account card');
  assert.equal(plainAmount(g.balance), Number(state.account.equity).toFixed(2) + ' USDT', 'Margin Balance differs from native equity');
  assert.equal(plainAmount(g.available), Number(state.account.available).toFixed(2) + ' USDT', 'Available Balance differs from native state');
  assert.deepEqual(
    [g.im.trim(), g.mm.trim()],
    [expectedUsagePercent(state.account.initialMargin, state.account.equity), expectedUsagePercent(state.account.maintenanceMargin, state.account.equity)],
    'IM/MM summary differs from authoritative native account',
  );
  // The unit is its own element AND separated from the digits by a real
  // character, so a copied balance never reads `10250.00USDT`.
  assert(g.units.length >= 2 && g.units.every(u => /^\u00a0/.test(u || '')), 'Currency is not separated from the amount: ' + JSON.stringify(g.units));
  // Group separators are present on any amount long enough to need them.
  const grouped = (g.balance || '').replace(/\u00a0USDT$/, '');
  if (grouped.replace(/[^\d]/g, '').length > 5) assert(/\d \d/.test(grouped), 'Large balance is not grouped: ' + grouped);
  assert(!/[KMB]\b|\u2026/.test(grouped), 'Balance was abbreviated or truncated: ' + grouped);
  return g;
}
async function normalFlow(width) {
  const s = await session(width), p = s.page;
  try {
    await ready(s); await family(p, 'LIMIT'); await check(`fields-limit-${width}`, () => geometry(p));
    await check(`quantity-to-usdt-calculator-${width}`, async () => {
      const seeded = Number(await price(p).inputValue());
      assert(Number.isFinite(seeded) && seeded > 0, `LIMIT price was not seeded from the live last price: ${seeded}`);
      await qty(p).fill('5');
      await p.waitForFunction(() => { const row = document.querySelector('.fo-infoRow'); return row && !row.textContent.includes('—'); });
      const expected = (seeded * 5).toFixed(2);
      const valueText = await p.locator('.fo-infoRow').first().innerText();
      assert(valueText.includes(expected), `Position value did not follow quantity × price: ${valueText}, expected ${expected}`);
      assert(!(await button(p, 'LONG').isDisabled()), 'Valid priced quantity still left Long disabled');
      assert(!(await button(p, 'SHORT').isDisabled()), 'Valid priced quantity still left Short disabled');
      await qty(p).fill('');
      return { price: seeded, quantity: 5, positionValue: expected };
    });
    await check(`market-calculator-instant-${width}`, async () => {
      // Hold the mark-price poll: the calculator must still answer from the last price the page already has.
      let held = 0;
      await s.context.route('**/api/v1/futures/mark-price/**', async route => { held += 1; await delay(3000); await route.continue(); });
      await p.reload(); await ready(s);
      await family(p, 'MARKET');
      const t0 = Date.now();
      await qty(p).fill('5');
      await p.waitForFunction(() => { const row = document.querySelector('.fo-infoRow'); return row && !row.textContent.includes('—'); }, null, { timeout: 1500 });
      const elapsed = Date.now() - t0;
      const valueText = await p.locator('.fo-infoRow').first().innerText();
      const value = Number(valueText.replace(/[^0-9.]/g, ''));
      assert(Number.isFinite(value) && value > 0, `Market order value did not appear: ${valueText}`);
      assert(elapsed < 1500, `Market order value took ${elapsed} ms`);
      const costText = await p.locator('.fo-infoRow').nth(1).innerText();
      assert(!costText.includes('—'), `Cost did not appear with the value: ${costText}`);
      await s.context.unroute('**/api/v1/futures/mark-price/**');
      await qty(p).fill('');
      return { elapsedMs: elapsed, valueText, costText, markPollsHeld: held };
    });
    await p.locator('#futures-tab-positions').click();
    let state = await open(s, 'LONG', '5'); const longId = state.positions.find(x => x.side === 'LONG')?.id; assert(longId);
    state = await open(s, 'SHORT', '3'); assert.equal(state.positions.length, 2);
    state = await open(s, 'LONG', '2'); assert.equal(state.positions.find(x => x.id === longId).quantity, '7');
    await rows(p).first().waitFor();
    await check(`positions-remain-visible-${width}`, async () => { assert(await p.locator('#futures-bottom-content').isVisible(), 'Opening a position hid the lower panel'); assert.equal(await rows(p).count(), 2); });
    await check(`fields-market-${width}`, () => geometry(p));
    await check(`account-summary-${width}`, () => accountSummary(p, state));
    await check(`position-table-${width}`, () => tableLayout(p, width));
    const limit = (Number(state.positions[0].markPrice) * 2).toFixed(1);
    await family(p, 'LIMIT'); await price(p).fill(limit); await qty(p).fill('1');
    state = (await command(s, 'OPEN', () => button(p, 'SHORT').click())).state; assert(state.orders.some(x => x.status === 'OPEN'));
    await p.locator('#futures-tab-orders').click();
    state = (await command(s, 'CANCEL', () => p.locator('#futures-bottom-content').getByRole('button', { name: 'Отменить', exact: true }).click())).state;
    assert(!state.orders.some(x => ['OPEN', 'PARTIALLY_FILLED'].includes(x.status)));
    await p.locator('#futures-tab-positions').click();
    const row = positionRow(p, 'LONG'); await row.locator('.fut-tpslTrigger').click();
    await p.locator('.fut-tpslInput').nth(0).fill(limit);
    state = (await command(s, 'PROTECTION', () => p.locator('.fut-tpslSave').click())).state;
    // Compare the PRICE, not its spelling. The engine stores the trigger
    // exactly as submitted, so '99278.0' comes back '99278.0'; stripping a
    // trailing '.0' from the expected side assumed a normalization that does
    // not exist, and only failed when mark x 2 happened to land on a whole
    // tenth. A wrong trigger price still fails this.
    assert.equal(
      Number(state.positions.find(x => x.id === longId).protection.takeProfit),
      Number(limit),
      'Take-profit trigger differs from the price that was set',
    );
    await check(`limit-close-prefill-no-submit-${width}`, async () => {
      const before = s.drafts.filter(x => x.kind !== 'REFRESH').length;
      await row.locator('.futures-position-close').nth(0).click();
      await p.waitForFunction(() => document.querySelector('.fo-reduceOnlyRow input')?.checked === true);
      assert(await p.locator('.fo-reduceOnlyRow input').isChecked()); assert.equal(await qty(p).inputValue(), '7'); assert(await price(p).isVisible());
      await delay(200); assert.equal(s.drafts.filter(x => x.kind !== 'REFRESH').length, before, 'Limit-close button automatically sent a trade');
    });
    // Partial close through the ORIGINAL reduce-only market form.
    await family(p, 'MARKET'); await p.locator('.fo-reduceOnlyRow input').check(); await qty(p).fill('2');
    state = (await command(s, 'CLOSE', () => button(p, 'SHORT').click())).state;
    assert.equal(state.positions.find(x => x.id === longId).quantity, '5');
    await row.locator('.futures-position-card').click(); await check(`pnl-card-${width}`, () => card(p, `card-${width}.png`, width));
    const before = await api(s.context, s.token, 'state'), identity = before.positions.map(x => [x.id, x.quantity]);
    await p.reload(); await ready(s); await p.locator('#futures-tab-positions').click(); await rows(p).first().waitFor();
    const after = await api(s.context, s.token, 'state'); assert(after.revision >= before.revision); assert.deepEqual(after.positions.map(x => [x.id, x.quantity]), identity);
    // File-backed isolated repository persistence, NOT a PostgreSQL/re-login claim.
    if (width === 1440) { await stopServer(); await startServer(); await p.reload(); await ready(s); assert.deepEqual((await api(s.context, s.token, 'state')).positions.map(x => [x.id, x.quantity]), identity); }
    await p.locator('#futures-tab-positions').click();
    state = (await command(s, 'CLOSE', () => positionRow(p, 'SHORT').locator('.futures-position-close').nth(1).click())).state;
    assert(!state.positions.some(x => x.side === 'SHORT')); assert(state.history.some(x => x.side === 'SHORT'));
    await check(`owner-no-real-account-requests-${width}`, () => { assert.deepEqual(s.realRequests, [], 'Owner requested real Futures account endpoints'); });
    await p.screenshot({ path: path.join(out, `terminal-${width}.png`), fullPage: true });
    return { openLongShort: true, add: true, cancel: true, protection: true, partialClose: true, fullClose: true, reload: true, fixtureRestart: width === 1440 };
  } finally { await s.context.close(); }
}
async function outage(width, endpoint) {
  const s = await session(width, async ({ context }) => {
    await context.route(`**/private-trading/${endpoint}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'QA injected native outage' }) }));
  });
  try {
    await family(s.page, 'MARKET'); await qty(s.page).fill('1'); await s.page.locator('.fo-markPrice').waitFor(); await delay(1000);
    assert(await button(s.page, 'LONG').isDisabled() && await button(s.page, 'SHORT').isDisabled(), 'Native unavailable but normal order form can submit');
    assert.deepEqual(s.realRequests, [], 'Native failure fell back to real Futures account endpoints');
    assert.equal(s.drafts.filter(x => x.kind === 'OPEN').length, 0);
    assert((await s.page.locator('.futures-account-balance').innerText()).includes('—'), 'Unknown native balance was rendered as a number');
  } finally { await s.context.close(); }
}
async function limitCloseContract(width) {
  const s = await session(width);
  try {
    await ready(s); const state = await open(s, 'LONG', '1'); await s.page.locator('#futures-tab-positions').click();
    await positionRow(s.page, 'LONG').locator('.futures-position-close').nth(0).click();
    const limit = (Number(state.positions[0].markPrice) * 2).toFixed(1); await price(s.page).fill(limit);
    const response = s.page.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind !== 'REFRESH');
    await button(s.page, 'SHORT').click(); const r = await response; const draft = r.request().postDataJSON(); const next = await r.json();
    assert(r.ok(), JSON.stringify(next)); assert.equal(draft.type, 'LIMIT', `Reduce-only LIMIT silently changed execution: ${JSON.stringify(draft)}`);
    assert.equal(Number(draft.price), Number(limit)); assert(next.positions.some(x => x.id === state.positions[0].id), 'Nonmarketable limit close filled immediately');
  } finally { await s.context.close(); }
}
/** Pick the margin bucket the way a trader does: the popover under the mode trigger. */
async function marginMode(page, mode) {
  await page.locator('.fo-mlTrigger').first().click();
  await page.locator('.fo-mlPopover .fo-mlMode').nth(mode === 'ISOLATED' ? 0 : 1).click();
  await page.locator('.fo-mlPopover').waitFor({ state: 'detached' });
}
const bucketRow = (page, side, bucket) => positionRow(page, side)
  .filter({ has: page.locator('.futures-position-contract small', { hasText: bucket === 'ISOLATED' ? /Изол|Isol/i : /Кросс|Cross/i }) });
/**
 * TWO LOOK-ALIKE POSITIONS, ONE NAMED CLOSE.
 *
 * Same contract, same side, same size — one Cross, one Isolated. A limit
 * close started from a row must reduce THAT row's position: the draft the
 * form sends carries the row's position ID and the position's own bucket,
 * at the price the trader typed, and the resting order names the same
 * position. Neither position is touched by a non-marketable limit.
 */
async function limitCloseTargeting(width) {
  const s = await session(width), p = s.page;
  const keys = [];
  try {
    await ready(s);
    let state = await open(s, 'LONG', '2');
    const cross = state.positions.find(x => x.marginMode === 'CROSS' && x.side === 'LONG'); assert(cross, 'Cross long was not opened');
    await marginMode(p, 'ISOLATED');
    state = await open(s, 'LONG', '2');
    const isolated = state.positions.find(x => x.marginMode === 'ISOLATED' && x.side === 'LONG'); assert(isolated && isolated.id !== cross.id, 'Isolated long was not opened as its own position');
    assert.equal(cross.quantity, isolated.quantity, 'Fixture positions must be the same size for this check to mean anything');
    await p.locator('#futures-tab-positions').click(); await rows(p).nth(1).waitFor();
    const evidence = { crossId: cross.id, isolatedId: isolated.id, closes: [] };
    for (const target of [{ position: isolated, bucket: 'ISOLATED' }, { position: cross, bucket: 'CROSS' }]) {
      await p.locator('#futures-tab-positions').click();
      const row = bucketRow(p, 'LONG', target.bucket); await row.waitFor();
      await row.locator('.futures-position-close').nth(0).click();
      await p.waitForFunction(() => document.querySelector('.fo-reduceOnlyRow input')?.checked === true);
      // The trader's OWN price, far from the market so nothing fills.
      const limit = (Number(target.position.markPrice) * 2).toFixed(1);
      await price(p).fill(limit);
      const r = await command(s, 'OPEN', () => button(p, 'SHORT').click());
      assert.equal(r.draft.reduceOnly, true, 'Ticket did not send a reduce-only order');
      assert.equal(r.draft.positionId, target.position.id, `Ticket named ${r.draft.positionId}, expected the ${target.bucket} row ${target.position.id}`);
      assert.equal(r.draft.marginType, target.bucket, 'The bucket sent is not the position\'s own');
      assert.equal(r.draft.type, 'LIMIT'); assert.equal(Number(r.draft.price), Number(limit), 'The price sent is not the one the trader typed');
      const order = r.state.orders.find(o => o.reduceOnly && o.status === 'OPEN' && o.positionId === target.position.id);
      assert(order, 'The resting close does not name the row\'s position');
      assert.equal(order.marginType, target.bucket);
      assert.deepEqual(r.state.positions.filter(x => x.side === 'LONG').map(x => [x.id, x.quantity]).sort(), [[cross.id, '2'], [isolated.id, '2']].sort(), 'A non-marketable limit changed a position');
      evidence.closes.push({ bucket: target.bucket, positionId: r.draft.positionId, price: r.draft.price, orderId: order.id });
      keys.push(order.id);
    }
    // Leave the account as it was found: cancel both resting closes, close both positions.
    for (const orderId of keys) await api(s.context, s.token, 'commands', { kind: 'CANCEL', orderId, idempotencyKey: `qa-cancel-${orderId}` });
    for (const id of [cross.id, isolated.id]) await api(s.context, s.token, 'commands', { kind: 'CLOSE', positionId: id, idempotencyKey: `qa-close-${id}` });
    return evidence;
  } finally { await s.context.close(); }
}
/**
 * A CLOSE CLICKED WHILE A REFRESH IS IN FLIGHT IS SENT, NOT DROPPED.
 *
 * The terminal refreshes on load and every 30 s on the same command path.
 * The refresh is held at the network edge for a few seconds; the trader
 * clicks Market close in the meantime. The click must reach the server as
 * a CLOSE after the refresh and close the position — the old boolean gate
 * returned false and showed "Операция не подтверждена" instead.
 */
async function closeDuringRefresh(width) {
  const s = await session(width), p = s.page;
  try {
    await ready(s);
    const state = await open(s, 'LONG', '1');
    const id = state.positions.find(x => x.side === 'LONG' && x.quantity === '1')?.id ?? state.positions.find(x => x.side === 'LONG').id;
    let held = 0, releasedAt = 0;
    await s.context.route('**/native/commands', async route => {
      const body = route.request().postDataJSON();
      if (body?.kind === 'REFRESH') { held += 1; await delay(4000); releasedAt = Date.now(); }
      await route.continue();
    });
    await p.reload(); await ready(s);
    await p.locator('#futures-tab-positions').click(); await rows(p).first().waitFor();
    const clickedAt = Date.now();
    const waiting = p.waitForResponse(r => r.url().endsWith('/native/commands') && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === 'CLOSE');
    await positionRow(p, 'LONG').first().locator('.futures-position-close').nth(1).click();
    const response = await waiting; const next = await response.json();
    assert(response.ok(), `CLOSE during refresh: ${response.status()} ${JSON.stringify(next)}`);
    assert(held >= 1, 'No REFRESH was in flight when the close was clicked');
    assert(!next.positions.some(x => x.id === id), 'The close that was clicked during the refresh did not close the position');
    assert(releasedAt >= clickedAt, 'The refresh had already finished before the click; the race was not exercised');
    const panel = await p.locator('.futures-positions-panel').innerText();
    assert(!/не подтверждена|не закрыта/i.test(panel), 'The terminal reported a refusal for a close it sent');
    return { refreshesHeld: held, closedDuringRefresh: true };
  } finally { await s.context.close(); }
}
/**
 * AN ORDINARY TRADE, IN THE BROWSER, TIMED FROM THE CLICK.
 *
 * MARKET open 2 → reduce-only MARKET 0.5 at a higher price → add 1 at a
 * lower price → an exact reduce-only LIMIT close of 1 from the row, which
 * rests until the fixture market trades through it and the next refresh
 * observes a book with depth at its price → full MARKET close from the row.
 * Cross and Isolated. Every step records two times: the click to the
 * server's authoritative answer (`serverMs`) and the click to the DOM
 * showing that answer (`confirmedMs`). The fixture market is moved through
 * the review server's fixture-only override, so every fill price is known
 * in advance and asserted against the journal. Engine compute is NOT what
 * is measured here; this is the terminal.
 */
async function tradeCycle(width, bucket) {
  const s = await session(width, async s => {
    // A clean slate in THIS bucket: an earlier scenario may have left a position or a resting order on the
    // shared fixture account (the other bucket is left alone — the merge rule keeps the buckets apart).
    let state = s.initial;
    for (const o of state.orders.filter(o => ['OPEN', 'PARTIALLY_FILLED'].includes(o.status) && o.symbol === 'BTCUSDT' && o.marginType === bucket))
      state = await api(s.context, s.token, 'commands', { kind: 'CANCEL', orderId: o.id, idempotencyKey: `qa-cycle-clean-${bucket}-${width}-cancel-${o.id}` });
    for (const x of state.positions.filter(x => x.status === 'OPEN' && x.symbol === 'BTCUSDT' && x.marginMode === bucket))
      state = await api(s.context, s.token, 'commands', { kind: 'CLOSE', positionId: x.id, quantity: x.quantity, idempotencyKey: `qa-cycle-clean-${bucket}-${width}-close-${x.id}` });
    s.initial = state;
  }), p = s.page;
  const timings = [];
  const fixture = async body => { const r = await s.context.request.post(origin + '/__fixture/market', { data: body }); assert(r.ok(), 'Fixture market override refused'); };
  // The row of this bucket's LONG whose size cell reads `size` — parsed as a number, whatever the locale prints.
  const sized = size => ({ waitFor: (options = {}) => p.waitForFunction(([wantBucket, wantSize]) => {
    const rows = [...document.querySelectorAll('.futures-positions-table tbody tr')];
    return rows.some(tr => {
      const contract = tr.querySelector('.futures-position-contract');
      if (!contract || !contract.querySelector('.text-buy')) return false;
      const small = contract.querySelector('small')?.textContent || '';
      if (!(wantBucket === 'ISOLATED' ? /Изол|Isol/i : /Кросс|Cross/i).test(small)) return false;
      const cell = [...tr.querySelectorAll('td.mono')].find(td => /BTC/.test(td.textContent || ''));
      return !!cell && Number((cell.textContent || '').replace(/[^\d.]/g, '')) === Number(wantSize);
    });
  }, [bucket, size], { timeout: options.timeout ?? 25000 }) });
  let currentStep = 'setup';
  const timed = async (step, kind, click, confirmed) => {
    currentStep = step;
    const t0 = Date.now();
    const r = await command(s, kind, click);
    const serverMs = Date.now() - t0;
    await confirmed(r.state);
    const confirmedMs = Date.now() - t0;
    timings.push({ step, command: kind, serverMs, confirmedMs, revision: r.state.revision });
    console.log(`[trade-cycle ${bucket} ${width}] ${step}: ${kind} confirmed by the server in ${serverMs} ms, on screen in ${confirmedMs} ms`);
    return r.state;
  };
  const lastFill = (state, kind) => [...state.events].reverse().find(e => e.kind === kind && e.pricing === 'OBSERVED_BOOK');
  try {
    await fixture({ price: 50000, bids: null, asks: null });
    await ready(s); if (bucket === 'ISOLATED') await marginMode(p, 'ISOLATED');
    await p.locator('#futures-tab-positions').click();
    // 1. MARKET open 2 at the ask 50 000.1.
    const submit = async side => { await button(p, side).waitFor({ state: 'visible' }); await p.waitForFunction(x => { const b = document.querySelector(`.fo-submitPair .${x === 'LONG' ? 'buy' : 'sell'}`); return b && !b.disabled; }, side); await button(p, side).click(); };
    let state = await timed('open-market-2', 'OPEN', async () => { await family(p, 'MARKET'); await qty(p).fill('2'); await submit('LONG'); }, () => sized('2').waitFor());
    const position = state.positions.find(x => x.side === 'LONG' && x.marginMode === bucket); assert(position, `${bucket} long was not opened`);
    assert.equal(position.quantity, '2'); assert.equal(lastFill(state, 'OPEN').price, '50000.1');
    // 2. Reduce-only MARKET 0.5 at 52 000 (bid 51 999.9): the position is 1.5, the entry is unchanged. A reduce-only
    //    MARKET from the form resolves the bucket's one position and is sent as a CLOSE naming it (#111's resolver).
    await fixture({ price: 52000 });
    state = await timed('partial-close-0.5', 'CLOSE', async () => { await family(p, 'MARKET'); await p.locator('.fo-reduceOnlyRow input').check(); await qty(p).fill('0.5'); await submit('SHORT'); }, () => sized('1.5').waitFor());
    assert.equal(state.positions.find(x => x.id === position.id).quantity, '1.5'); assert.equal(lastFill(state, 'CLOSE').price, '51999.9');
    assert.equal(state.positions.find(x => x.id === position.id).entryPrice, '50000.1');
    // 3. Add 1 at 48 000 (ask 48 000.1): one position of 2.5 at the averaged entry 49 200.1.
    await fixture({ price: 48000 });
    state = await timed('add-market-1', 'OPEN', async () => { await family(p, 'MARKET'); await p.locator('.fo-reduceOnlyRow input').uncheck(); await qty(p).fill('1'); await submit('LONG'); }, () => sized('2.5').waitFor());
    assert.equal(state.positions.filter(x => x.side === 'LONG' && x.marginMode === bucket).length, 1);
    assert.equal(state.positions.find(x => x.id === position.id).entryPrice, '49200.1'); assert.equal(lastFill(state, 'OPEN').price, '48000.1');
    // 4. An exact reduce-only LIMIT close of 1 at 55 000 from the row: rests, names the position, reserves nothing.
    await p.locator('#futures-tab-positions').click();
    state = await timed('limit-close-1-rests', 'OPEN', async () => {
      const row = bucketRow(p, 'LONG', bucket); await row.waitFor();
      await row.locator('.futures-position-close').nth(0).click();
      await p.waitForFunction(() => document.querySelector('.fo-reduceOnlyRow input')?.checked === true);
      await price(p).fill('55000'); await qty(p).fill('1'); await submit('SHORT');
    }, async () => { await p.locator('#futures-tab-orders').click(); await p.locator('#futures-bottom-content').getByRole('button', { name: 'Отменить', exact: true }).first().waitFor(); await p.locator('#futures-tab-positions').click(); });
    const resting = state.orders.find(o => o.reduceOnly && o.status === 'OPEN' && o.positionId === position.id);
    assert(resting, 'The limit close did not rest on the named position'); assert.equal(resting.reserved, '0'); assert.equal(resting.price, '55000');
    assert.equal(state.positions.find(x => x.id === position.id).quantity, '2.5');
    // 5. The market trades through 55 000 and the next refresh observes 10 on the bid at 55 999.9: the order fills at
    //    its OWN price, as maker, for 1. Server-confirmed on the refresh; the row shows 1.5 on the terminal's next refresh.
    await fixture({ price: 56000 });
    const movedAt = Date.now();
    // The service reuses a quote younger than NATIVE_QUOTE_REUSE_MS, so the book a resting order fills from is at
    // most that old: the refresh that observes the new market is the first one after that window, as for a trader.
    const { NATIVE_QUOTE_REUSE_MS } = require(path.join(root, 'dist/private-trading/native/service'));
    await delay(NATIVE_QUOTE_REUSE_MS + 100);
    const refreshAt = Date.now();
    const filled = await api(s.context, s.token, 'commands', { kind: 'REFRESH', idempotencyKey: `qa-cycle-refresh-${bucket}-${width}-${movedAt}` });
    const refreshMs = Date.now() - refreshAt;
    const done = filled.orders.find(o => o.id === resting.id);
    assert.equal(done.status, 'FILLED', 'The resting limit did not fill from the observed book'); assert.equal(done.averagePrice, '55000');
    assert.equal(filled.positions.find(x => x.id === position.id).quantity, '1.5');
    const limitFill = filled.events.find(e => e.orderId === resting.id && e.kind === 'CLOSE'); assert.equal(limitFill.price, '55000'); assert.equal(limitFill.pricing, 'OBSERVED_BOOK');
    // The row repaints on the terminal's own refresh cadence (every 30 s) or on its next command: measured from the market move.
    await sized('1.5').waitFor({ timeout: 45000 });
    timings.push({ step: 'limit-close-fills-on-observed-book', command: 'REFRESH', serverMs: refreshMs, confirmedMs: Date.now() - movedAt, revision: filled.revision, note: 'not a click: server-confirmed by the first refresh after the quote-reuse window (serverMs is that refresh\'s round trip); confirmedMs is the market move to the row showing 1.5, which waits for the terminal\'s own 30-second refresh' });
    console.log(`[trade-cycle ${bucket} ${width}] limit-close-fills-on-observed-book: REFRESH round trip ${refreshMs} ms; row repainted ${Date.now() - movedAt} ms after the market move (terminal refresh cadence)`);
    // 6. Full MARKET close from the row at 56 000 (bid 55 999.9): the row disappears.
    state = await timed('close-market-rest', 'CLOSE', async () => { const row = bucketRow(p, 'LONG', bucket); await row.waitFor(); await row.locator('.futures-position-close').nth(1).click(); }, () => bucketRow(p, 'LONG', bucket).waitFor({ state: 'detached' }));
    assert(!state.positions.some(x => x.id === position.id), 'The position is still open after the market close');
    assert.equal(lastFill(state, 'CLOSE').price, '55999.9'); assert.equal(lastFill(state, 'CLOSE').quantity, '1.5');
    assert(!state.orders.some(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED'), 'An order is still resting after the cycle');
    const closed = state.history.find(x => x.id === position.id);
    assert.equal(closed.status, 'CLOSED'); assert.equal(closed.realizedGross, '16999.5');
    assert(state.ledger.reconciled, 'Ledger did not reconcile after the cycle');
    const panel = await p.locator('.futures-positions-panel').innerText();
    assert(!/не подтверждена|не закрыта|не отменён/i.test(panel), 'The terminal reported a refusal during the cycle');
    return { bucket, positionId: position.id, timings, realizedGross: closed.realizedGross, fees: Number(closed.openingFees) + Number(closed.closingFees), account: { equity: state.account.equity, available: state.account.available } };
  } catch (error) {
    // The context closes below, before check() could look: keep the screen and what the form had sent.
    await p.screenshot({ path: path.join(out, `trade-cycle-${bucket.toLowerCase()}-${width}-failed.png`), fullPage: true }).catch(() => {});
    const form = await p.evaluate(() => ({ submit: document.querySelector('.fo-submitPair')?.outerHTML ?? null, panel: document.querySelector('.fo-panel')?.innerText ?? null })).catch(() => null);
    throw new Error(`${currentStep}: ${error.message}\ndrafts sent: ${JSON.stringify(s.drafts.map(d => d && { kind: d.kind, side: d.side, type: d.type, quantity: d.quantity, reduceOnly: d.reduceOnly, positionId: d.positionId }))}\nform: ${JSON.stringify(form)}`, { cause: error });
  } finally { try { await fixture({ price: null, bids: null, asks: null }); } catch {} await s.context.close(); }
}
async function chartFlow(width) {
  const s = await session(width), p = s.page;
  try {
    await ready(s); await family(p, 'MARKET'); await qty(p).fill('1');
    await armChartPicker(p);
    await p.waitForFunction(() => window.__nativeQaSeries?.data().length > 10); await p.locator('.chart-area').scrollIntoViewIfNeeded();
    const points = await p.evaluate(() => { const c = window.__nativeQaChart, series = window.__nativeQaSeries, r = c.chartElement().getBoundingClientRect(); return series.data().slice(0, -3).filter(x => typeof x.time === 'number' && x.open !== undefined).map(x => ({ ...x, x: c.timeScale().timeToCoordinate(x.time) })).filter(x => x.x > 35 && x.x < r.width - 90).filter((_, i) => i % 7 === 0).map(x => ({ x: r.left + x.x, y: r.top + series.priceToCoordinate((x.high + x.low) / 2) })); });
    let picked = false;
    for (const point of points) {
      await p.mouse.click(point.x, point.y); await delay(120);
      // The picker disarms itself once a bar is accepted; the menu is
      // closed by now, so ask the page rather than a visible control.
      if (await p.evaluate(() => !document.querySelector('[data-chart-picking]'))) { picked = true; break; }
    }
    assert(picked, 'Original chart did not accept a closed-candle pick');
    const { state, draft } = await command(s, 'OPEN', () => button(p, 'LONG').click());
    assert(draft.candle && Number.isFinite(draft.candle.openTime), 'Selected candle did not reach native execution');
    assert.equal(state.positions.length, 1); assert(state.positions[0].historical); assert(state.entries.some(x => x.positionId === state.positions[0].id && x.candle.openTime === draft.candle.openTime));
    const before = state.positions.map(x => [x.id, x.quantity]);
    await setChartTools(p, false);
    assert.deepEqual((await api(s.context, s.token, 'state')).positions.map(x => [x.id, x.quantity]), before, 'Tool Off reset account positions');
    await setChartTools(p, true); await p.locator('[data-position-line]').first().waitFor();
    await setChartTools(p, false); await qty(p).fill('1');
    const live = await command(s, 'OPEN', () => button(p, 'SHORT').click()); assert.equal(live.draft.candle, undefined, 'Tool Off retained the unsent historical selection');
  } finally { await s.context.close(); }
}
const CASES = [
  { id: 'profit-1_2m', pnl: '1200000', roi: '2400' }, { id: 'profit-10m', pnl: '10000000', roi: '20000' },
  { id: 'loss-1_2m', pnl: '-1200000', roi: '-2400' }, { id: 'roi-20000', pnl: '250000', roi: '20000' },
  { id: 'roi-128450', pnl: '4820000.5', roi: '128450.75' }, { id: 'roi-negative-99999', pnl: '-8750000.25', roi: '-99999.99' },
  { id: 'real-zero', pnl: '0', roi: '0' },
];
function intersects(a, b) { return a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1; }
async function cardGlyphs(page, model) {
  const g = await page.evaluate(model => {
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px'; document.body.append(host);
    try {
      host.innerHTML = window.__nativeQaCardRenderer.privateResultCardSvg(model);
      const svg = host.querySelector('svg');
      const rect = e => { const b = e.getBBox(), m = e.getCTM(); const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m)); return { left: Math.min(...points.map(x => x.x)), right: Math.max(...points.map(x => x.x)), top: Math.min(...points.map(x => x.y)), bottom: Math.max(...points.map(x => x.y)) }; };
      return { fields: [...svg.querySelectorAll('[data-field]')].map(e => ({ name: e.dataset.field, text: e.textContent, ...rect(e) })), bags: [...svg.querySelectorAll('[data-artwork="money-bags"] > g')].map(rect), text: svg.textContent };
    } finally { host.remove(); }
  }, model);
  assert(g.fields.length, 'Card renderer did not expose measurable fields'); assert(!/NaN|Infinity|\d[eE][+-]?\d/.test(g.text));
  for (const b of [...g.fields, ...g.bags]) assert(b.left >= 0 && b.right <= 1080 && b.top >= 0 && b.bottom <= 1215, `Card field/artwork outside canvas: ${JSON.stringify(b)}`);
  for (const f of g.fields) for (const b of g.bags) assert(!intersects(f, b), `Card field ${f.name} overlaps artwork`);
  for (let i = 0; i < g.fields.length; i++) for (let j = i + 1; j < g.fields.length; j++) {
    const a = g.fields[i], b = g.fields[j];
    if ([a.name, b.name].some(x => ['roi-line', 'profit-line', 'side', 'leverage'].includes(x))) continue;
    if (['roi-', 'profit-'].some(prefix => a.name.startsWith(prefix) && b.name.startsWith(prefix))) continue;
    assert(!intersects(a, b), `Card text overlap: ${a.name}/${b.name}`);
  }
  return g;
}
async function largeValues(width) {
  let current, cardModel;
  const s = await session(width, async s => {
    const base = await api(s.context, s.token, 'commands', { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: 'qa-layout-seed-position' });
    const baseCard = await api(s.context, s.token, 'cards', { positionId: base.positions[0].id });
    s.base = base; s.baseCard = baseCard; current = structuredClone(base); cardModel = structuredClone(baseCard);
    await s.context.route('**/native/state', route => route.fulfill({ json: current }));
    await s.context.route('**/native/commands', route => route.request().postDataJSON()?.kind === 'REFRESH' ? route.fulfill({ json: current }) : route.fulfill({ status: 405, json: { error: 'Layout fixture cannot execute trades' } }));
    await s.context.route('**/native/cards', route => route.fulfill({ json: cardModel }));
  });
  try {
    for (const example of CASES) {
      current = structuredClone(s.base);
      Object.assign(current.positions[0], { quantity: '1250.5', entryPrice: '1875000.5', markPrice: '1999999.99', unrealizedPnl: example.pnl, realizedPnl: example.pnl, roiPercent: example.roi });
      current.account.unrealizedPnl = example.pnl;
      cardModel = { ...s.baseCard, unrealizedPnl: example.pnl, roiPercent: example.roi, entryPrice: '1875000.5', valuationPrice: '1999999.99' };
      await s.page.reload(); await ready(s); await s.page.locator('#futures-tab-positions').click(); await rows(s.page).first().waitFor();
      await check(`large-table-${example.id}-${width}`, async () => {
        assert.equal((await s.page.locator('.futures-position-pnl > span').innerText()).trim(), Number(example.pnl).toFixed(2));
        assert.equal((await s.page.locator('.futures-position-pnl > small').innerText()).trim(), Number(example.roi).toFixed(2) + '%');
        return tableLayout(s.page, width);
      });
      await check(`large-card-glyphs-${example.id}-${width}`, () => cardGlyphs(s.page, cardModel));
      await check(`large-card-png-${example.id}-${width}`, async () => { await s.page.locator('.futures-position-card').click(); return card(s.page, `card-${example.id}-${width}.png`, width); });
      const completed = { ...current.positions[0], status: 'CLOSED', closedAt: current.asOf, netPnl: example.pnl, liquidationPrice: null };
      current = { ...current, positions: [], history: [completed] };
      await s.page.reload(); await ready(s); await s.page.locator('#futures-tab-positionHistory').click();
      await s.page.locator('.futures-positions-panel tbody tr').waitFor();
      await check(`large-history-${example.id}-${width}`, async () => {
        assert((await s.page.locator('.futures-positions-panel').innerText()).includes(Number(example.pnl).toFixed(2)), 'Closed P&L not rendered in full');
        return tableLayout(s.page, width);
      });
    }
    await s.page.screenshot({ path: path.join(out, `terminal-${width}.png`), fullPage: true });
  } finally { await s.context.close(); }
}
async function main() {
  // Observation only: no components, layout, prices or routing are replaced by the build shim.
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-native-observer-${process.pid}.mjs`);
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};import * as renderer from ${JSON.stringify(path.join(front, 'src/lib/privateResultCard.ts'))};window.__nativeQaCardRenderer=renderer;export function createChart(...args){const c=original(...args);window.__nativeQaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__nativeQaSeries=s;return s;};return c;}`);
  const { build } = await import(path.join(front, 'node_modules/vite/dist/node/index.js'));
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') } });
  await startServer(); const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright'); browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    if (largeOnly) { await check(`large-values-${width}`, () => largeValues(width)); continue; }
    await check(`normal-owner-flow-${width}`, () => normalFlow(width));
    await check(`access-outage-no-real-fallback-${width}`, () => outage(width, 'access'));
    await check(`state-outage-no-real-fallback-${width}`, () => outage(width, 'native/state'));
    await check(`reduce-only-limit-contract-${width}`, () => limitCloseContract(width));
    await check(`limit-close-targets-the-named-position-${width}`, () => limitCloseTargeting(width));
    await check(`close-during-refresh-is-sent-${width}`, () => closeDuringRefresh(width));
    await check(`trade-cycle-cross-${width}`, () => tradeCycle(width, 'CROSS'));
    await check(`trade-cycle-isolated-${width}`, () => tradeCycle(width, 'ISOLATED'));
    await check(`chart-tool-selection-${width}`, () => chartFlow(width));
  }
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}
main().catch(error => { report.passed = false; report.failure = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true }); });
