/** PR #111: real built Futures UI -> native router/service -> isolated fixture ledger.
 * NO production credentials, DB, orders, or external market traffic.
 * Fixtures are synthetic; the account/close code under test is the actual engine.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/qa/native-demo/limit-close-targeting');
const origin = 'http://127.0.0.1:4189';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { fixtureOnly: true, productionVerified: false, checks: [], errors: [] };
fs.mkdirSync(out, { recursive: true });
let server, browser, activePage;
function record(name, evidence) { report.checks.push({ name, passed: true, evidence }); }
async function start() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], {
    cwd: root, env: { ...process.env, PORT: '4189', NATIVE_PREVIEW_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(out, 'server.log'));
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Isolated server exited: ' + server.exitCode);
    try {
      const r = await fetch(origin + '/health'), h = await r.json();
      if (r.ok && h.fixtureMarket === true && h.kind === 'isolated-native-demo-preview') return;
    } catch {}
    await delay(500);
  }
  throw Error('Isolated fixture server not healthy');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => { clearTimeout(timer); resolve(); }); server.kill('SIGTERM');
  });
}
async function api(context, token, endpoint, body) {
  const r = await context.request[body === undefined ? 'get' : 'post'](origin + '/api/v1/private-trading/native/' + endpoint, {
    headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }),
  });
  const value = await r.json();
  assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(value)}`);
  return value;
}
const isCommand = request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/native/commands');
async function uiCommand(page, kind, action) {
  const response = page.waitForResponse(r => isCommand(r.request()) && r.request().postDataJSON()?.kind === kind);
  await action();
  const r = await response, value = await r.json();
  assert(r.ok() && value.initialized && value.account, `${kind}: ${r.status()} ${JSON.stringify(value)}`);
  return { value, draft: r.request().postDataJSON() };
}
async function armPicker(page) {
  const menu = page.locator('.chart-tools-menu');
  await page.locator('.chart-surface').scrollIntoViewIfNeeded();
  // Same actual chart gesture as qa-native-demo-browser.cjs, including its
  // narrow-viewport runs. The corner-trigger menu's placement is a separate
  // issue: this case verifies that a genuinely armed picker cannot leak
  // into a table close, not that all chart menu entry points are equivalent.
  for (const [fx, fy] of [[0.55, 0.55], [0.72, 0.45], [0.62, 0.72], [0.8, 0.6]]) {
    const box = await page.locator('.chart-surface').boundingBox();
    await page.mouse.dblclick(box.x + fx * box.width, box.y + fy * box.height);
    try { await menu.waitFor({ timeout: 3000 }); break; } catch {}
  }
  await menu.waitFor();
  await menu.locator('.chart-tools-action.primary').click();
  await page.locator('.chart-surface[data-chart-picking="entry"]').waitFor();
}
async function run(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'ru-RU', timezoneId: 'UTC' });
  const html = await (await context.request.get(origin + '/futures')).text();
  const tokenMatch = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
  assert(tokenMatch, 'No isolated fixture session');
  const token = JSON.parse(tokenMatch[1]);
  let state = await api(context, token, 'state');
  state = await api(context, token, 'initialize', { acceptedModel: state.model.version, idempotencyKey: randomUUID() });
  for (const marginType of ['CROSS', 'ISOLATED']) {
    state = await api(context, token, 'commands', { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET',
      quantity: '0.02', leverage: '10', marginType, idempotencyKey: randomUUID() });
  }
  const cross = state.positions.find(p => p.marginMode === 'CROSS');
  const isolated = state.positions.find(p => p.marginMode === 'ISOLATED');
  assert(cross && isolated && cross.quantity === isolated.quantity, 'Need two equal-size same-side positions in different buckets');
  // Derive a marketable SELL limit from this fixture's observed mark. A
  // literal price of 1 would fail the existing minimum-notional rule and
  // test order admission instead of target identity. Do not relax that rule.
  const closePrice = String(Math.floor(Number(isolated.markPrice) * 0.9));
  assert(Number(closePrice) > 0 && Number(closePrice) * 0.005 >= 5);
  const realRequests = [], drafts = [], pending = new Set();
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const real = url.pathname.startsWith('/api/v1/futures/') && (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      || /^\/api\/v1\/futures\/(balances|positions|orders|trades|fills|account|funding-history|transfers)(?:\/|$)/.test(url.pathname));
    if (real) realRequests.push({ method: request.method(), path: url.pathname });
    return request.url().startsWith(origin + '/') && !real ? route.continue() : route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(`${width}: ${error.message}`));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (isCommand(request)) { drafts.push(request.postDataJSON()); pending.add(request); } });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => pending.delete(request));
  const initialRefresh = page.waitForResponse(r => isCommand(r.request()) && r.request().postDataJSON()?.kind === 'REFRESH');
  await page.goto(origin + '/futures'); await initialRefresh;
  await page.waitForFunction(() => document.querySelectorAll('.futures-position-row').length === 2);
  const form = page.locator('.fo-form'), quantity = page.locator('.fo-qtyInputRow input'), price = page.locator('.fo-priceInputRow input');
  const rows = page.locator('.futures-position-row');
  async function target(index, expectedId) {
    await rows.nth(index).locator('.futures-position-close').first().click();
    await page.waitForFunction(id => document.querySelector('.fo-form')?.getAttribute('data-close-position-id') === id, expectedId);
    assert(await page.locator('.fo-reduceOnlyRow input').isChecked());
  }
  await armPicker(page);
  await target(state.positions.findIndex(p => p.id === isolated.id), isolated.id);
  assert.equal(await page.locator('.chart-surface').getAttribute('data-chart-picking'), null, 'Table close must cancel the unsent chart picker');
  assert(await page.locator('.fo-submitPair .buy').isDisabled(), 'LONG close must not offer BUY');
  record(`${width}: exact isolated table id, picker cancelled, wrong side disabled`, { id: isolated.id });

  await price.fill(closePrice); await quantity.fill('0.010');
  assert.equal(await page.locator('.fo-submitPair .sell').isDisabled(), false,
    'Targeted LONG close is filled but SELL is not submit-ready');
  const partial = await uiCommand(page, 'OPEN', () => quantity.press('Enter'));
  assert.equal(partial.draft.positionId, isolated.id);
  assert.equal(partial.draft.marginType, 'ISOLATED');
  assert.equal(partial.draft.side, 'SHORT'); assert.equal(partial.draft.type, 'LIMIT');
  assert.equal(partial.draft.price, closePrice); assert.equal(partial.draft.quantity, '0.010');
  assert.equal(partial.draft.reduceOnly, true); assert(!('candle' in partial.draft));
  assert.equal(partial.value.positions.find(p => p.id === isolated.id)?.quantity, '0.01');
  assert.equal(partial.value.positions.find(p => p.id === cross.id)?.quantity, '0.02');
  await page.waitForFunction(() => !document.querySelector('.fo-form')?.hasAttribute('data-close-position-id'));
  record(`${width}: Enter partial LIMIT closes only the selected isolated position`, partial.draft);

  // Explicit cancellation must not leave a hidden id behind.
  await target(partial.value.positions.findIndex(p => p.id === isolated.id), isolated.id);
  await page.locator('.fo-reduceOnlyRow input').uncheck();
  assert.equal(await form.getAttribute('data-close-position-id'), null);
  record(`${width}: unchecking reduce-only clears the target`);

  // Another tab closes the target after this table ticket was prepared.
  // Refresh account state without remounting the form; its stale id must
  // cause a refusal, NEVER pick the remaining cross position instead.
  await target(partial.value.positions.findIndex(p => p.id === isolated.id), isolated.id);
  for (let i = 0; pending.size && i < 100; i++) await delay(50);
  assert.equal(pending.size, 0, 'Fixture preparation still pending');
  const closed = await api(context, token, 'commands', { kind: 'CLOSE', positionId: isolated.id, idempotencyKey: randomUUID() });
  assert(!closed.positions.some(p => p.id === isolated.id));
  await uiCommand(page, 'REFRESH', () => page.locator('#futures-tab-positionHistory').click());
  await page.locator('#futures-tab-positions').click();
  await page.waitForFunction(() => document.querySelectorAll('.futures-position-row').length === 1);
  await price.fill(closePrice); await quantity.fill('0.005');
  const writesBefore = drafts.filter(d => d.kind !== 'REFRESH').length;
  await page.locator('.fo-submitPair .sell').click();
  await page.locator('.fo-error').filter({ hasText: 'Невозможно однозначно' }).waitFor();
  assert.equal(drafts.filter(d => d.kind !== 'REFRESH').length, writesBefore, 'Stale id emitted a mutation');
  assert.equal((await api(context, token, 'state')).positions.find(p => p.id === cross.id)?.quantity, '0.02');
  record(`${width}: closed target refused without a write or neighbour fallback`);

  await target(0, cross.id);
  await price.fill(closePrice); await quantity.fill('0.005');
  const next = await uiCommand(page, 'OPEN', () => page.locator('.fo-submitPair .sell').click());
  assert.equal(next.draft.positionId, cross.id); assert.equal(next.draft.marginType, 'CROSS');
  assert.equal(next.value.positions.find(p => p.id === cross.id)?.quantity, '0.015');
  assert(!next.value.positions.some(p => p.id === isolated.id));
  record(`${width}: selecting a new row replaces the stale id and uses its bucket`, next.draft);
  assert.deepEqual(realRequests, []); assert.deepEqual(report.errors, []);
  await page.screenshot({ path: path.join(out, `targeted-close-${width}.png`), fullPage: true });
  record(`${width}: no real-engine access or browser exception`);
  await context.close(); activePage = null;
}
(async () => {
  try {
    await start();
    const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
    browser = await chromium.launch({ headless: true });
    await run(1440); await run(390);
  } catch (error) {
    report.checks.push({ name: 'limit-close-targeting', passed: false, error: String(error.stack || error) });
    console.error(error);
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(out, 'failed.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await stop();
  }
})();
