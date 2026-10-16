/** Browser QA — the native demo's P&L taken apart: Trading P&L, Funding,
 * Fees and Net P&L, on the real /futures terminal against the isolated
 * fixture engine (synthetic prices, synthetic capital, no network beyond
 * 127.0.0.1, nothing production).
 *
 * Three synthetic market trades: a LONG and a SHORT opened, the fixture's
 * server clock moved 25h forward (QA lever `NATIVE_PREVIEW_CLOCK_QA`, fixture
 * only, forward only), a third LONG opened, the clock moved 9h more, and the
 * third closed — so the engine crosses real 00/08/16 UTC boundaries while
 * two positions stay open and one is closed after a settlement. With
 * `NATIVE_PREVIEW_FIXED_FUNDING_RATE` the review server pins a SYNTHETIC
 * fixed-rate version (QA lever, never the shipped rate) three days back, so
 * every settlement here is priced by it.
 *
 * Every figure is read twice — off the engine's state and off the rendered
 * cells — and both must agree; the engine's own equations are asserted:
 *   tradingPnl - feesPaid + fundingNet === netPnl            (every position)
 *   FUNDING events: one per boundary held, quantity x boundary mark x rate,
 *   LONG pays / SHORT receives at a positive rate, the version recorded
 *   ledger reconciled; a closed trade's history total is its netPnl
 *
 *   node scripts/qa-native-funding-pnl.cjs
 *   QA_LABEL=before QA_MEASURE_ONLY=1 QA_ROOT=<old checkout> node scripts/qa-native-funding-pnl.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const BigNumber = require('bignumber.js');
const here = path.resolve(__dirname, '..');
const root = path.resolve(process.env.QA_ROOT || here);
const label = process.env.QA_LABEL || 'after';
const measureOnly = process.env.QA_MEASURE_ONLY === '1';
const RATE = process.env.QA_FIXED_RATE ?? (measureOnly ? '' : '0.0001');
const out = path.join(here, 'docs/qa/native-funding-pnl', label);
const port = process.env.NATIVE_QA_PORT || '4191';
const origin = `http://127.0.0.1:${port}`;
const WIDTHS = (process.env.QA_WIDTHS || '1920,1440,390').split(',').map(Number);
const H = 3_600_000, F = 8 * H;
const report = { scope: 'real /futures terminal, isolated native fixture, synthetic fixed funding rate (QA lever)', label, rate: RATE || null, checks: [], errors: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
const n = v => new BigNumber(v);
let server = null, browser = null;

async function startServer() {
  const env = { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_CLOCK_QA: '1', ...(RATE ? { NATIVE_PREVIEW_FIXED_FUNDING_RATE: RATE } : {}) };
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
async function workspace(page, name) {
  const tab = page.locator(`#mobile-futures-${name}`);
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}
async function accountTab(page, name) { await workspace(page, 'positions'); await page.locator(`#futures-tab-${name}`).click(); }
/** The figure a cell shows, as a number: grouping commas and the unit stripped. */
const shown = text => Number(String(text).replace(/≈.*$/s, '').replace(/[^0-9.+\-−]/g, '').replace('−', '-'));
/** Boundaries a position settles at: strictly after it opened, not after `until`. */
const boundaries = (openedAt, until) => { const all = []; for (let t = Math.floor(openedAt / F) * F + F; t <= until; t += F) if (t > openedAt) all.push(t); return all; };

async function session(width) {
  const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 960 }, locale: 'ru-RU', timezoneId: 'UTC' });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const html = await (await context.request.get(origin + '/futures')).text();
  const token = JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
  let state = await api(context, token, 'state');
  if (!state.initialized) state = await api(context, token, 'initialize', { acceptedModel: state.model.version, idempotencyKey: `funding-qa-init-${width}` });
  const command = (body, key) => api(context, token, 'commands', { ...body, idempotencyKey: `funding-qa-${key}-${width}` });
  // A build without the clock lever (the "before" run) simply stays at now.
  const advance = async ms => { const r = await context.request.post(origin + '/qa/clock', { data: { advanceMs: ms } }); assert(r.ok() || measureOnly, 'clock lever unavailable'); };
  const open = (symbol, side, quantity, key) => command({ kind: 'OPEN', symbol, side, type: 'MARKET', quantity, leverage: '10' }, key);
  await open('BTCUSDT', 'LONG', '1', 'long');
  await open('ETHUSDT', 'SHORT', '2', 'short');
  // A day and an hour later: three or four 00/08/16 UTC boundaries passed.
  await advance(25 * H);
  await command({ kind: 'REFRESH' }, 'refresh-1');
  state = await open('SOLUSDT', 'LONG', '1', 'closed');
  await advance(9 * H);
  await command({ kind: 'REFRESH' }, 'refresh-2');
  const closing = state.positions.find(p => p.symbol === 'SOLUSDT');
  await command({ kind: 'CLOSE', positionId: closing.id }, 'close');
  state = await command({ kind: 'REFRESH' }, 'refresh-3');
  return { context, token, state };
}

async function verifyEngine(width, state, history, ledger) {
  const prefix = `${width}px`;
  const all = [...state.positions.filter(p => p.status === 'OPEN'), ...history];
  await check(`${prefix}: engine reports every position apart (trading - fees + funding = net)`, async () => {
    const rows = all.map(p => ({ id: p.id, symbol: p.symbol, status: p.status, tradingPnl: p.tradingPnl, feesPaid: p.feesPaid, fundingNet: p.fundingNet, netPnl: p.netPnl }));
    for (const p of all) {
      assert(p.tradingPnl !== undefined && p.feesPaid !== undefined, `${p.symbol}: no breakdown on the wire`);
      assert.equal(n(p.tradingPnl).minus(p.feesPaid).plus(p.fundingNet).toFixed(), n(p.netPnl).toFixed(), `${p.symbol}: split does not sum`);
    }
    return rows;
  });
  await check(`${prefix}: one fixed-rate settlement per boundary held, quantity x mark x rate, sign by side`, async () => {
    const funding = ledger.entries.filter(e => e.source === 'FUNDING');
    assert(funding.length > 0, 'no settlement at all: the scenario did not cross a boundary');
    const evidence = [];
    for (const p of all) {
      const lines = funding.filter(e => e.positionId === p.id);
      const expected = boundaries(p.openedAt, p.closedAt ?? state.asOf);
      assert.equal(lines.length, expected.length, `${p.symbol}: ${lines.length} settlements for ${expected.length} boundaries`);
      for (const line of lines) {
        assert(expected.includes(line.time), `${p.symbol}: settlement off a boundary at ${line.time}`);
        assert.equal(line.fundingRate, RATE, `${p.symbol}: rate not recorded`);
        assert.equal(line.fundingModel, 'QA_SYNTHETIC_FIXED');
        const owed = n(line.quantity).times(line.price).times(RATE);
        assert.equal(n(line.amount).toFixed(), (p.side === 'LONG' ? owed.negated() : owed).toFixed(), `${p.symbol}: ${line.amount} at ${line.time}`);
      }
      assert.equal(lines.reduce((a, l) => a.plus(l.amount), n(0)).toFixed(), n(p.fundingNet).toFixed(), `${p.symbol}: fundingNet is not its settlements`);
      evidence.push({ symbol: p.symbol, side: p.side, settlements: lines.map(l => ({ at: new Date(l.time).toISOString(), quantity: l.quantity, mark: l.price, amount: l.amount })) });
    }
    return evidence;
  });
  await check(`${prefix}: the ledger reconciles to the wallet`, async () => {
    assert.equal(ledger.reconciled, true);
    assert.equal(ledger.closingBalance, ledger.walletBalance);
    return { closingBalance: ledger.closingBalance, walletBalance: ledger.walletBalance, totals: ledger.totals };
  });
}

async function verifyScreen(width, s) {
  const page = await s.context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/futures?symbol=BTCUSDT');
  await page.locator('#futures-tab-positions').waitFor({ state: 'attached', timeout: 60000 });
  await accountTab(page, 'positions');
  const panel = page.locator('.futures-positions-panel').first();
  await page.locator('.futures-positions-table tbody tr').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  const openShot = path.join(out, `open-${width}.png`);
  await panel.screenshot({ path: openShot });
  // The table scrolls sideways inside its own region (sticky first and last
  // columns); the far end is photographed too, and the geometry recorded.
  const geometry = await page.locator('.futures-positions-scroll').first().evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, rowHeight: el.querySelector('tbody tr')?.getBoundingClientRect().height ?? null }));
  report.geometry = { ...(report.geometry ?? {}), [width]: geometry };
  if (geometry.scrollWidth > geometry.clientWidth) {
    await page.locator('.futures-positions-scroll').first().evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(300);
    await panel.screenshot({ path: path.join(out, `open-${width}-scrolled.png`) });
  }
  if (!measureOnly) await check(`${width}px: open rows show the engine's Trading P&L, Funding, Fees and Net P&L`, async () => {
    const rows = await page.locator('.futures-positions-table tbody tr').evaluateAll(trs => trs.map(tr => Object.fromEntries([...tr.querySelectorAll('td[data-mobile-label]')].map(td => [td.getAttribute('data-mobile-label'), td.innerText]))));
    assert.equal(rows.length, 2);
    for (const p of s.state.positions.filter(p => p.status === 'OPEN')) {
      const row = rows.find(r => (r['Контракты'] ?? Object.values(r)[0]).includes(p.symbol.replace('USDT', '')));
      assert(row, `${p.symbol}: no row`);
      assert.equal(row['Реализованный P&L'], undefined, 'the realized column is replaced on a native row');
      const close = (cell, value, what) => assert(Math.abs(shown(row[cell]) - Number(value)) < 0.006, `${p.symbol} ${what}: shows ${row[cell]}, engine ${value}`);
      close('Торговый P&L', p.tradingPnl, 'trading');
      close('Фандинг', p.fundingNet, 'funding');
      close('Комиссии', n(p.feesPaid).negated().toFixed(), 'fees');
      close('Чистый P&L', p.netPnl, 'net');
    }
    return rows;
  });
  await accountTab(page, 'positionHistory');
  await page.locator('.futures-history-table tbody tr').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  const historyShot = path.join(out, `history-${width}.png`);
  await page.locator('.futures-positions-panel').first().screenshot({ path: historyShot });
  if (!measureOnly) await check(`${width}px: the closed trade's total is its Net P&L, with its parts beside it`, async () => {
    const closed = s.history.find(p => p.symbol === 'SOLUSDT');
    const row = await page.locator('.futures-history-table tbody tr').first().evaluate(tr => Object.fromEntries([...tr.querySelectorAll('td[data-mobile-label]')].map(td => [td.getAttribute('data-mobile-label'), td.innerText])));
    const close = (cell, value) => assert(Math.abs(shown(row[cell]) - Number(value)) < 0.006, `${cell}: shows ${row[cell]}, engine ${value}`);
    close('Торговый P&L', closed.tradingPnl); close('Фандинг', closed.fundingNet);
    close('Комиссии', n(closed.feesPaid).negated().toFixed()); close('Чистый P&L', closed.netPnl);
    return { row, engine: { tradingPnl: closed.tradingPnl, fundingNet: closed.fundingNet, feesPaid: closed.feesPaid, netPnl: closed.netPnl } };
  });
  await check(`${width}px: no page errors`, async () => { assert.deepEqual(errors, []); return { screenshots: [path.relative(here, openShot), path.relative(here, historyShot)] }; });
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  try {
    await startServer();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const width of WIDTHS) {
      const s = await session(width);
      // The state a command answers with defers history and ledger lines;
      // the terminal reads them from these two endpoints, and so does this run.
      s.history = (await api(s.context, s.token, `history?revision=${s.state.revision}&kind=positions&limit=50`)).items;
      const { ledger } = await api(s.context, s.token, 'account');
      if (!measureOnly) await verifyEngine(width, s.state, s.history, ledger);
      await verifyScreen(width, s);
      await s.context.close();
    }
  } catch (error) { report.errors.push(String(error.stack || error)); console.log('ERROR', error); }
  finally {
    if (browser) await browser.close();
    await stopServer();
    report.passed = report.errors.length === 0 && report.checks.every(c => c.passed);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(report.passed ? 'ALL PASSED' : 'FAILED', path.relative(here, path.join(out, 'report.json')));
    process.exitCode = report.passed ? 0 : 1;
  }
})();
