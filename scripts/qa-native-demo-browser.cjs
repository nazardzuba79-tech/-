/** Original /futures owner flow. Disposable fixture server ONLY; never production QA.
 * Trade actions use the normal form/tables and the actual NativeDemoService.
 * Layout fixtures are explicitly synthetic and only intercept this local server.
 * A failed product invariant stays red; no legacy UI is restored or mocked in.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { reviewHistoryPage } = require('./native-demo-review-repository.cjs');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), front = path.join(root, 'frontend');
const largeOnly = process.env.NATIVE_QA_LARGE_ONLY === '1';
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
    await s.context.route('**/native/live', route => route.fulfill({ json: {...current,history:[],events:[],entries:[],historyDeferred:true} }));
    await s.context.route('**/native/history?*', route => route.fulfill({json:reviewHistoryPage({revision:current.revision,commands:[],snapshot:{positions:[...current.positions,...current.history],orders:current.orders,events:current.events}},Object.fromEntries(new URL(route.request().url()).searchParams),{positionViews:true})}));
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
        // The reference prints the figure grouped and to four decimals, with
        // the settle-currency approximation under it; the brackets and the
        // unit are drawn by the stylesheet, so innerText carries neither.
        const grouped = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
        assert.equal((await s.page.locator('.futures-position-money').first().innerText()).trim(), grouped(example.pnl, 4));
        assert.equal((await s.page.locator('.futures-position-roi').innerText()).trim(), Number(example.roi).toFixed(2) + '%');
        assert.equal((await s.page.locator('.futures-position-approx').first().innerText()).trim(), `≈${grouped(example.pnl, 2)} USD`);
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
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') } });
  await startServer(); const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright'); browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    if (largeOnly) { await check(`large-values-${width}`, () => largeValues(width)); continue; }
    await check(`normal-owner-flow-${width}`, () => normalFlow(width));
    await check(`access-outage-no-real-fallback-${width}`, () => outage(width, 'access'));
    await check(`state-outage-no-real-fallback-${width}`, () => outage(width, 'native/live'));
    await check(`reduce-only-limit-contract-${width}`, () => limitCloseContract(width));
    await check(`chart-tool-selection-${width}`, () => chartFlow(width));
  }
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}
main().catch(error => { report.passed = false; report.failure = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true }); });
