'use strict';
/**
 * Futures chart: a left-button drag pans the chart (owner, 2026-10-21:
 * «коли затискаю ліву кнопку мишки на графіку та рухаю курсор ліворуч або
 * праворуч, графік не переміщується»).
 *
 * Every check measures the REAL Lightweight Charts instance behind the
 * terminal (`__voltexChart` on the chart host): the visible logical range
 * before and after the gesture, never the mouse event. Runs the isolated
 * native demo review server (scripts/serve-native-demo-review.cjs,
 * NATIVE_PREVIEW_FIXTURE=1): synthetic candles, a disposable owner fixture,
 * the actual NativeDemoService. Fixture server only; never production.
 *
 * Scenarios, as the owner listed them:
 *   1. normal mode: drag left shows newer bars, drag right older ones; the
 *      range holds through the candle poll; the wheel still zooms;
 *   2. historical entry selection (the picker armed): a drag pans, arms
 *      nothing and posts no command; a short click picks a completed bar;
 *      a jittery click (under the 5px threshold) still picks; a drag past
 *      the threshold does not;
 *   3. after a timeframe change; 4. after a reload;
 *   5. the bottom panel of PR #566: after its handle resized the panel, and
 *      from a press just above the panel (reported as skipped where the
 *      handle is not in the bundle);
 *   6. saved drawings: a locked rectangle, a ruler under «Заблокировать
 *      рисунки» — the chart pans (the defect fixed here); an unlocked
 *      rectangle moves with the drag instead, as on TradingView.
 *
 *   node scripts/qa-futures-chart-drag.cjs [--label ci] [--origin http://127.0.0.1:4179]
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || process.env.PRIVATE_CARD_QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const label = arg('--label', 'local');
const port = arg('--port', process.env.CHART_DRAG_QA_PORT || '4179');
const external = arg('--origin', null);
const origin = external || `http://127.0.0.1:${port}`;
const out = path.join(root, 'docs/qa/futures-chart-drag');
fs.mkdirSync(out, { recursive: true });
const DRAWINGS_KEY = 'voltex.drawings.futures.BTC/USDT';
const report = { label, fixtureOnly: true, productionVerified: false, origin, checks: [], errors: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server = null, browser = null, page = null;

async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) }); console.log(`[ok] ${name}`); return true; }
  catch (error) {
    const skipped = error && error.skipped;
    report.checks.push({ name, passed: !!skipped, skipped: !!skipped, error: String(error.stack || error) });
    console[skipped ? 'log' : 'error'](`[${skipped ? 'skip' : 'FAIL'}] ${name}: ${error.message}`);
    if (!skipped && page && !page.isClosed()) await page.screenshot({ path: path.join(out, `${label}-${name.replace(/[^a-z0-9-]/gi, '-')}-failed.png`) }).catch(() => {});
    return !!skipped;
  }
}
const skip = (why) => Object.assign(new Error(why), { skipped: true });

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], { cwd: root, env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, `${label}-server.log`), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); const h = await r.json(); if (r.ok && h.fixtureMarket === true && h.kind === 'isolated-native-demo-preview') return; } catch {}
    await delay(500);
  }
  throw new Error('Local isolated fixture server did not become healthy');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise((resolve) => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
}

// ── The chart, read from the real instance ───────────────────────────────
const readChart = () => page.evaluate(() => {
  const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart);
  if (!host) return null;
  const { chart, series } = host.__voltexChart;
  const r = chart.timeScale().getVisibleLogicalRange();
  const box = host.getBoundingClientRect();
  const firstVisible = series.dataByIndex(Math.ceil(r.from), 1);
  return { from: r.from, to: r.to, barSpacing: chart.timeScale().options().barSpacing, firstVisibleTime: firstVisible ? firstVisible.time : null,
    box: { x: box.x, y: box.y, w: box.width, h: box.height }, paneHeight: chart.paneSize(0).height,
    picking: !!document.querySelector('.chart-surface[data-chart-picking]'),
    entryReference: document.querySelector('[data-entry-reference]')?.getAttribute('data-entry-reference') ?? null };
});
const topElementAt = (x, y) => page.evaluate(([x, y]) => {
  const el = document.elementsFromPoint(x, y)[0];
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || (el.tagName === 'BUTTON' ? (el.textContent || '').trim().slice(0, 24) : '');
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.getAttribute('data-drawing-hit') ? '[hit=' + el.getAttribute('data-drawing-hit') + ']' : ''}${label ? '«' + label + '»' : ''}`;
}, [x, y]);
/**
 * Controls that take a press on the plot and are never a pan: the live
 * position's label and its buttons (PrivatePositionLines — a 198×22px card at
 * 43 % of the pane width, on the entry price; its pointerdown is stopped on
 * purpose), the chart tools menu, a drawing's toolbar or dialog. The seeded
 * position's entry is the fixture price at the second the run starts, and that
 * price follows a sine of the server clock: in the minutes when it maps onto
 * a fixed press point every press met the label and nothing panned (CI
 * 2026-10-21 17:48Z, 20/48; the same tree passed at 17:21Z, and clean main
 * 9dd84308 gives the same 20/48 with the fixture clock moved to that phase).
 * A press that would land on such a control slides to the nearest clear spot
 * along `dir` — vertically for a plain drag, along the line for a drawing —
 * and the slide is named with the check. A drawing is never avoided: several
 * checks press on one on purpose. A dedicated check below presses the label.
 */
const FOREIGN_UI = /private-position-line|private-line-|chart-tools-|drawing-object-toolbar|drawing-settings|chart-menu/;
const SLIDE_STEPS = [0, -30, 30, -60, 60, -90, 90, -120, 120, -150, 150];
/** Every element under a point, top first, named as topElementAt names one. */
const stackAt = (x, y) => page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 8).map((el) => {
  const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || (el.tagName === 'BUTTON' ? (el.textContent || '').trim().slice(0, 24) : '');
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.getAttribute('data-drawing-hit') ? '[hit=' + el.getAttribute('data-drawing-hit') + ']' : ''}${label ? '«' + label + '»' : ''}`;
}), [x, y]);
/** What a press meets, without its classes or label: `canvas`, `polyline`, `path[hit=body]`. */
const hitKind = (d) => (d ?? '').replace(/«.*$/, '').replace(/\.[^[]*/, '');
async function clearOfForeignUi(x, y, dir = [0, 1]) {
  // What the press would have met had the control not been there: the slid press must meet the same kind of thing
  // (the bare plot, a drawing's body, its line), so sliding never turns a press beside a drawing into one on it.
  const origin = await stackAt(Math.round(x), Math.round(y));
  if (!FOREIGN_UI.test(origin[0] ?? '')) return { x: Math.round(x), y: Math.round(y), top: origin[0] ?? null };
  const intended = hitKind(origin.find((d) => !FOREIGN_UI.test(d)));
  for (const step of SLIDE_STEPS.slice(1)) {
    const px = Math.round(x + dir[0] * step), py = Math.round(y + dir[1] * step);
    const top = (await stackAt(px, py))[0] ?? null;
    if (!FOREIGN_UI.test(top ?? '') && hitKind(top) === intended) return { x: px, y: py, top: `${top} (press slid ${step}px off ${origin[0]})` };
  }
  return { x: Math.round(x), y: Math.round(y), top: `${origin[0]} (no clear ${intended || 'spot'} within 150px)` };
}
/** Press, move by dx with the button held, release. Returns bars shifted (positive: older bars came into view). */
async function drag(dx, fx = 0.5, fy = 0.45, steps = 10) {
  const before = await readChart();
  assert(before, 'chart instance not found');
  const { x: cx, y: cy, top } = await clearOfForeignUi(before.box.x + Math.round(before.box.w * fx), before.box.y + Math.round(before.box.h * fy));
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx, cy, { steps }); await page.mouse.up();
  await delay(350);
  const after = await readChart();
  // Lightweight Charts starts scrolling from its first pressed move, so a
  // stepped gesture pans a little less than dx / barSpacing; a real hand
  // moves in many small steps and loses next to nothing.
  const nominal = dx / before.barSpacing;
  return { at: { x: cx, y: cy }, top, before: [before.from, before.to], after: [after.from, after.to], shifted: before.from - after.from, nominal };
}
function assertPanned(result, dx, what) {
  const nominal = dx / 1; // sign only
  assert(Math.sign(result.shifted) === Math.sign(nominal) && Math.abs(result.shifted) >= Math.abs(result.nominal) * 0.5 && Math.abs(result.shifted) <= Math.abs(result.nominal) * 1.2,
    `${what}: expected the visible range to move by about ${result.nominal.toFixed(1)} bars, it moved ${result.shifted.toFixed(2)} (range ${result.before.map((v) => v.toFixed(1))} → ${result.after.map((v) => v.toFixed(1))}; under the pointer: ${result.top})`);
  return { shifted: Math.round(result.shifted * 100) / 100, nominal: Math.round(result.nominal * 100) / 100, top: result.top };
}
/**
 * A completed bar to click, `offsetFromRight` bars before the right edge or
 * the nearest older one whose body sits in the upper three quarters of the
 * pane: the picker ignores the lowest fifth, where the volume bars live
 * (lib/chartTrading isCandleHit), so a bar that happens to sit there is not
 * a pick target.
 */
async function candlePoint(offsetFromRight) {
  return page.evaluate(([offset]) => {
    const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart);
    const { chart, series } = host.__voltexChart;
    const r = chart.timeScale().getVisibleLogicalRange();
    const box = host.getBoundingClientRect();
    const paneHeight = chart.paneSize(0).height;
    for (let index = Math.floor(r.to) - offset; index >= Math.ceil(r.from); index--) {
      const bar = series.dataByIndex(index);
      if (!bar || !('high' in bar)) continue;
      const y = series.priceToCoordinate((bar.high + bar.low) / 2);
      if (y === null || y < paneHeight * 0.05 || y > paneHeight * 0.72) continue;
      return { x: box.x + chart.timeScale().logicalToCoordinate(index), y: box.y + y, time: bar.time, index };
    }
    return null;
  }, [offsetFromRight]);
}
async function settle() {
  await page.locator('.chart-surface').waitFor({ timeout: 30000 });
  await page.waitForSelector('[data-chart-state="candles"]', { timeout: 30000 });
  await delay(1500);
}
async function disarm() {
  for (let i = 0; i < 3; i++) {
    const chart = await readChart();
    if (!chart.picking && chart.entryReference === null) return;
    await page.keyboard.press('Escape'); await delay(350);
  }
}
async function armPicker() {
  await disarm();
  const menu = page.locator('.chart-tools-menu');
  for (const [fx, fy] of [[0.55, 0.55], [0.72, 0.45], [0.62, 0.72]]) {
    const box = await page.locator('.chart-surface').boundingBox();
    await page.mouse.dblclick(box.x + box.width * fx, box.y + box.height * fy);
    try { await menu.waitFor({ timeout: 3000 }); break; } catch {}
  }
  await menu.waitFor();
  await page.locator('.chart-tools-menu .chart-tools-switch input').check();
  await page.locator('.chart-tools-action').click();
  await menu.waitFor({ state: 'detached' });
  await page.locator('.chart-surface[data-chart-picking]').waitFor();
  await delay(300);
}
/** Shapes anchored to the visible bars: from the 100th-newest to the 5th-newest bar, across the visible price span. */
const coveringShape = () => page.evaluate(() => {
  const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart);
  const { chart, series } = host.__voltexChart;
  const r = chart.timeScale().getVisibleLogicalRange();
  const bars = []; for (let i = Math.ceil(r.from); i <= Math.floor(r.to); i++) { const b = series.dataByIndex(i); if (b && 'high' in b) bars.push(b); }
  const a = bars[Math.max(0, bars.length - 100)], b = bars[bars.length - 5];
  return { a: { time: a.time, price: Math.max(...bars.map((x) => x.high)) }, b: { time: b.time, price: Math.min(...bars.map((x) => x.low)) } };
});
const storedPoints = () => page.evaluate((key) => { const raw = localStorage.getItem(key); return raw ? JSON.stringify(JSON.parse(raw).drawings.map((d) => d.points)) : null; }, DRAWINGS_KEY);

(async () => {
  if (!external) await startServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC' });
  const html = await (await context.request.get(origin + '/futures')).text();
  const match = /localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);
  assert(match, 'Isolated preview did not provide its fixture session');
  const token = JSON.parse(match[1]);
  const api = async (endpoint, body) => {
    const r = await context.request[body === undefined ? 'get' : 'post'](`${origin}/api/v1/private-trading/native/${endpoint}`, { headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }) });
    const data = await r.json(); assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(data).slice(0, 300)}`); return data;
  };
  let state = await api('state');
  if (!state.initialized) state = await api('initialize', { acceptedModel: state.model.version, idempotencyKey: 'chart-drag-qa-initialize' });
  // A live position on the chart, so its entry line and label sit over the plot as they do for the owner.
  if (!state.positions.some((p) => p.symbol === 'BTCUSDT' && p.status === 'OPEN')) await api('commands', { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: 'chart-drag-qa-seed' });
  await context.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const commands = [], tradingWrites = [];
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().endsWith('/native/commands') && request.method() === 'POST') commands.push(request.postDataJSON()?.kind ?? 'POST');
    const path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /^\/api\/v1\/(futures|orders|private-trading\/native\/(commands|initialize|close|reset))/.test(path)) tradingWrites.push(`${request.method()} ${path}`);
  });
  // A clean slate once: later navigations keep what a check seeded.
  await page.addInitScript((key) => { try { if (!sessionStorage.getItem('chart-drag-qa-clean')) { localStorage.removeItem(key); sessionStorage.setItem('chart-drag-qa-clean', '1'); } } catch {} }, DRAWINGS_KEY);

  await page.goto(origin + '/futures?pair=BTC%2FUSDT', { waitUntil: 'domcontentloaded' });
  await settle();

  // 1. Normal mode.
  // The live position's label is a control, not plot: a press-and-drag that starts on it never trades and never
  // loses its buttons (owner, 2026-10-21: no financial command on drag; do not remove trade controls).
  await check('position-label-press-and-drag-posts-nothing-and-keeps-its-controls', async () => {
    const label = page.locator('.private-position-line-label').first();
    await label.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    if (!(await label.count())) throw skip('the seeded position\'s entry is outside the visible price range at this moment');
    const box = await label.boundingBox();
    const qty = page.locator('.private-position-line-label .private-line-quantity').first(), qb = await qty.boundingBox();
    const before = await readChart(), commandsBefore = commands.length, writesBefore = tradingWrites.length;
    await page.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2); await page.mouse.down(); await page.mouse.move(qb.x + qb.width / 2 + 220, qb.y + qb.height / 2, { steps: 10 }); await page.mouse.up(); await delay(350);
    const after = await readChart();
    const buttons = await page.locator('.private-position-line-label').first().locator('button').evaluateAll((els) => els.map((b) => ({ label: b.getAttribute('aria-label'), disabled: b.disabled })));
    assert.equal(commands.length - commandsBefore, 0, 'a drag from the position label posted a command');
    assert.equal(tradingWrites.length - writesBefore, 0, 'a drag from the position label sent a trading write');
    assert.equal(buttons.length, 4, `the label lost a control: ${JSON.stringify(buttons)}`);
    assert(buttons.some((b) => /^Закрыть позицию/.test(b.label ?? '') && !b.disabled), 'the close control is gone or disabled');
    return { label: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }, panned: Math.round((before.from - after.from) * 100) / 100, buttons };
  });
  await check('normal-drag-right-shows-older-bars', async () => assertPanned(await drag(260), 260, 'drag right'));
  await check('normal-drag-left-shows-newer-bars', async () => assertPanned(await drag(-160), -160, 'drag left'));
  await check('normal-range-holds-through-candle-poll', async () => {
    const dragged = await drag(300); assertPanned(dragged, 300, 'drag right');
    const held = await readChart();
    await delay(7000); // the terminal polls candles every 5s
    const later = await readChart();
    assert(Math.abs(later.from - held.from) <= 1.5 && later.firstVisibleTime === held.firstVisibleTime,
      `the range moved on its own after release: ${held.from.toFixed(2)} → ${later.from.toFixed(2)}`);
    return { held: held.from, later: later.from };
  });
  await check('normal-wheel-still-zooms', async () => {
    const before = await readChart();
    await page.mouse.move(before.box.x + before.box.w / 2, before.box.y + before.box.h / 2); await page.mouse.wheel(0, -300); await delay(400);
    const after = await readChart();
    assert(after.barSpacing > before.barSpacing, `wheel up did not zoom in: barSpacing ${before.barSpacing} → ${after.barSpacing}`);
    await page.mouse.wheel(0, 300); await delay(400);
    return { before: before.barSpacing, after: after.barSpacing };
  });
  await page.screenshot({ path: path.join(out, `${label}-normal.png`) });

  // 2. Historical entry selection.
  await check('picking-drag-pans-and-posts-nothing', async () => {
    await armPicker();
    const before = commands.length;
    const right = assertPanned(await drag(240), 240, 'drag right while picking');
    const left = assertPanned(await drag(-120), -120, 'drag left while picking');
    const chart = await readChart();
    assert(chart.picking, 'the picker was disarmed by a drag');
    assert.equal(commands.length - before, 0, `a drag posted ${commands.length - before} command(s): ${commands.slice(before)}`);
    assert.equal(chart.entryReference, null, 'a drag picked a bar');
    return { right, left };
  });
  await check('picking-short-click-selects-a-completed-bar', async () => {
    const pt = await candlePoint(15); assert(pt, 'no completed bar to click');
    const before = commands.length;
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await page.locator('[data-entry-reference]').waitFor({ timeout: 5000 });
    const chart = await readChart();
    assert(!chart.picking, 'the picker stayed armed after a pick');
    assert.equal(commands.length - before, 0, 'a pick posted a command');
    return { entryReference: chart.entryReference, bar: pt.time };
  });
  await page.screenshot({ path: path.join(out, `${label}-picked.png`) });
  await check('picking-jittery-click-under-threshold-still-selects', async () => {
    await armPicker();
    const pt = await candlePoint(25); assert(pt, 'no completed bar to click');
    // A hand is never perfectly still: 2px of drift inside the 5px threshold is still a click.
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 2, pt.y + 2, { steps: 2 }); await page.mouse.up();
    await page.locator('[data-entry-reference]').waitFor({ timeout: 5000 });
    const chart = await readChart();
    assert(!chart.picking, 'the picker stayed armed after a jittery pick');
    return { bar: pt.time, entryReference: chart.entryReference };
  });
  await check('picking-drag-past-threshold-does-not-select', async () => {
    await armPicker();
    const pt = await candlePoint(30); assert(pt, 'no completed bar');
    const before = await readChart();
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 14, pt.y, { steps: 4 }); await page.mouse.up();
    await delay(600);
    const chart = await readChart();
    assert(chart.picking && chart.entryReference === null, `a 14px drag was taken for a click (picking=${chart.picking}, pick=${chart.entryReference})`);
    assert(before.from - chart.from > 0, 'a 14px drag did not pan at all');
    await disarm();
    return { shifted: Math.round((before.from - chart.from) * 100) / 100 };
  });

  await check('picking-older-bars-load-on-the-way-back-and-one-of-them-can-be-picked', async () => {
    // Dragging towards history past the loaded bars asks the source for
    // older ones; the picker stays armed, nothing is posted, an older bar
    // picks like any other, and Alt+N brings the latest bars back.
    await armPicker();
    const start = await readChart();
    const earliestBar = () => page.evaluate(() => { const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart); return host.__voltexChart.series.dataByIndex(0, 0)?.time ?? null; });
    const earliest = await earliestBar();
    const before = commands.length;
    let chart = start, steps = 0;
    while (steps++ < 14 && chart.from > 10) { await drag(600, 0.3, 0.45, 6); chart = await readChart(); }
    await delay(1500);
    const loaded = await earliestBar();
    assert(earliest !== null && loaded !== null && loaded < earliest, `no older bars arrived on the way back (first bar ${earliest} → ${loaded} after ${steps} drags)`);
    chart = await readChart();
    assert(chart.picking && chart.entryReference === null, 'the way back disarmed the picker or picked a bar');
    assert.equal(commands.length - before, 0, `the way back posted ${commands.length - before} command(s)`);
    const pt = await candlePoint(30); assert(pt, 'no older bar to pick');
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await page.locator('[data-entry-reference]').waitFor({ timeout: 5000 });
    const picked = await readChart();
    assert.equal(JSON.parse(picked.entryReference).openTime, pt.time * 1000, 'the picked bar is not the one under the pointer');
    assert(pt.time < earliest, 'the picked bar is not one of the older bars');
    await disarm();
    await page.keyboard.press('Alt+N'); await delay(800);
    const home = await readChart();
    assert(home.to >= start.to - 1, `Alt+N did not return to the latest bars (${home.to.toFixed(1)} vs ${start.to.toFixed(1)})`);
    return { drags: steps, firstBar: { before: earliest, after: loaded }, picked: pt.time, home: Math.round(home.to) };
  });

  // 3. Timeframe change; 4. reload.
  await check('after-timeframe-change-drag-pans', async () => {
    const tf = page.locator('[data-cw-tf="4h"]').first();
    assert(await tf.count(), 'no 4h timeframe button');
    await tf.click(); await delay(1800);
    return assertPanned(await drag(260), 260, 'drag right on 4h');
  });
  await check('after-reload-drag-pans', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
    return assertPanned(await drag(260), 260, 'drag right after reload');
  });

  // 5. PR #566 bottom panel.
  await check('after-bottom-panel-resize-drag-pans', async () => {
    const handle = page.locator('.bottom-panel .orders-resize-handle').first();
    if (!(await handle.count())) throw skip('the bottom panel handle (PR #566) is not in this bundle');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2, hb.y - 100, { steps: 8 }); await page.mouse.up();
    await delay(500);
    const height = await page.evaluate(() => getComputedStyle(document.querySelector('.terminal')).getPropertyValue('--futures-account-height').trim());
    const panned = assertPanned(await drag(220), 220, 'drag right after the panel grew');
    return { panelHeight: height, ...panned };
  });
  await check('press-at-the-bottom-of-the-price-pane-pans', async () => {
    // The lowest 12px of the price pane, right above the time axis — where
    // the PR #566 handle sits a few pixels further down. (A press on the
    // time axis itself scales the axis, as on TradingView; that is not a pan.)
    const chart = await readChart();
    const fy = (chart.paneHeight - 12) / chart.box.h;
    return assertPanned(await drag(220, 0.5, fy), 220, 'drag from 12px above the time axis');
  });
  await check('after-shrink-and-reload-the-panel-holds-and-the-chart-pans', async () => {
    const handle = page.locator('.bottom-panel .orders-resize-handle').first();
    if (!(await handle.count())) throw skip('the bottom panel handle (PR #566) is not in this bundle');
    const panel = () => page.evaluate(() => ({
      panel: Math.round(document.querySelector('.bottom-panel').getBoundingClientRect().height),
      chart: Math.round(document.querySelector('.chart-area').getBoundingClientRect().height),
      overflow: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      limited: document.querySelector('.terminal').getAttribute('data-account-height-limited'),
      stored: Number(localStorage.getItem('voltex.futures.accountPanelHeight')) || null,
      ariaNow: Number(document.querySelector('.bottom-panel [role="separator"]').getAttribute('aria-valuenow')),
    }));
    await handle.focus(); await page.keyboard.press('End'); await delay(400);
    const tall = await panel();
    await page.setViewportSize({ width: 1366, height: 768 }); await delay(700);
    const small = await panel();
    assert(small.panel < tall.panel && small.overflow === 0 && small.chart >= 300 && small.stored === tall.panel && small.limited === 'true' && small.ariaNow === small.panel,
      `the panel did not adapt to 1366×768: ${JSON.stringify({ tall, small })}`);
    const pannedSmall = assertPanned(await drag(220), 220, 'drag at 1366×768 under the limited panel');
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
    const reloaded = await panel();
    assert(reloaded.panel === small.panel && reloaded.overflow === 0 && reloaded.stored === tall.panel && reloaded.limited === 'true', `a reload at 1366×768 changed the panel: ${JSON.stringify({ small, reloaded })}`);
    const pannedReloaded = assertPanned(await drag(220), 220, 'drag after the reload at 1366×768');
    await page.setViewportSize({ width: 1440, height: 900 }); await delay(700);
    const back = await panel();
    assert(back.panel > small.panel && back.overflow === 0, `the panel did not grow back at 1440×900: ${JSON.stringify({ small, back })}`);
    await page.locator('.bottom-panel .orders-resize-handle').first().dblclick(); await delay(300);
    return { tall: tall.panel, small: small.panel, back: back.panel, pannedSmall, pannedReloaded };
  });
  await page.screenshot({ path: path.join(out, `${label}-panel.png`) });

  // 6. Saved drawings over the plot. The shapes are anchored to the bars a
  // fresh load opens on, so after each seeding reload the press lands inside.
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
  const shape = await coveringShape();
  const seed = async (state, fx = 0.5, fy = 0.45) => {
    await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false, ...value })), [DRAWINGS_KEY, state]);
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
    const chart = await readChart();
    const inside = await page.evaluate(([x, y, kind]) => { const r = document.querySelector(`[data-drawing-kind="${kind}"]`)?.getBoundingClientRect(); return !!r && x > r.left + 20 && x < r.right - 20 && y > r.top + 20 && y < r.bottom - 20; }, [chart.box.x + Math.round(chart.box.w * fx), chart.box.y + Math.round(chart.box.h * fy), state.drawings[0].kind]);
    assert(inside, `the seeded ${state.drawings[0].kind} does not cover the press point`);
  };
  await check('locked-rectangle-over-the-plot-does-not-block-panning', async () => {
    await seed({ locked: false, drawings: [{ kind: 'rectangle', points: [shape.a, shape.b], locked: true }] });
    const before = await storedPoints();
    const panned = assertPanned(await drag(220), 220, 'drag inside a locked rectangle');
    assert.equal(await storedPoints(), before, 'the locked rectangle moved');
    return panned;
  });
  await check('ruler-under-lock-all-does-not-block-panning', async () => {
    // Inside the box, off the ruler's own cross lines: those stay grabbable
    // (the outline of a locked drawing still selects it), the body does not.
    await seed({ locked: true, drawings: [{ kind: 'ruler', points: [shape.a, shape.b] }] }, 0.38, 0.3);
    const before = await storedPoints();
    const panned = assertPanned(await drag(220, 0.38, 0.3), 220, 'drag inside a ruler with every drawing locked');
    assert.equal(await storedPoints(), before, 'the locked ruler moved');
    return panned;
  });
  await page.screenshot({ path: path.join(out, `${label}-locked-ruler.png`) });
  await check('unlocked-rectangle-moves-with-the-drag-as-on-tradingview', async () => {
    await seed({ locked: false, drawings: [{ kind: 'rectangle', points: [shape.a, shape.b] }] });
    const before = await storedPoints();
    const result = await drag(220);
    assert.notEqual(await storedPoints(), before, 'the rectangle did not move');
    assert(Math.abs(result.shifted) < 0.01, `the chart panned under a moving rectangle: ${result.shifted}`);
    return { top: result.top };
  });
  await check('locked-drawing-is-still-selectable-on-its-outline', async () => {
    await seed({ locked: false, drawings: [{ kind: 'rectangle', points: [shape.a, shape.b], locked: true }] });
    const edge = await page.evaluate(() => { const r = document.querySelector('[data-drawing-kind="rectangle"] polyline')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y } : null; });
    assert(edge, 'no rectangle outline on screen');
    await page.mouse.click(edge.x, edge.y); await delay(300);
    assert(await page.locator('[data-drawing-selected]').count(), 'a click on the outline did not select the locked rectangle');
    return edge;
  });
  await page.evaluate((key) => localStorage.removeItem(key), DRAWINGS_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(); // a bare plot again: the seeded rectangle is gone

  // 7. Matrix (CTO, 2026-10-21): the owner's conditions are not known, so
  // every cursor tool, every common drawing kind free and locked, and the
  // saved chart settings are tried in turn. Each cell measures the same
  // thing as above: the chart's visible range before and after a press-
  // and-move on the plot, and whether a drawing under the press moved.
  report.matrix = { tools: [], drawings: [], settings: [] };
  const pickTool = async (id) => {
    await page.locator('[data-tool-group="cursors"] .tool-group-chevron').click();
    await page.locator(`.tool-flyout [data-drawing-tool="${id}"]`).click();
    await delay(250);
  };
  const activeTool = () => page.evaluate(() => document.querySelector('[data-tool-group="cursors"] > [data-drawing-tool]')?.getAttribute('data-drawing-tool') ?? null);
  for (const id of ['cursor', 'dot', 'arrowcursor', 'erase']) {
    await check(`matrix-tool-${id}-drag-pans`, async () => {
      await pickTool(id);
      const tool = await activeTool();
      const result = await drag(220);
      report.matrix.tools.push({ tool: id, shown: tool, shifted: Math.round(result.shifted * 100) / 100, top: result.top });
      assert.equal(tool, id, `the ${id} tool was not selected (shown: ${tool})`);
      return assertPanned(result, 220, `drag with the ${id} tool`);
    });
  }
  await check('matrix-tool-erase-removes-a-free-drawing-and-spares-a-locked-one', async () => {
    // Anchored to the bars a fresh load opens on, so the rectangle is on screen after the seeding reload.
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
    const shapeNow = await coveringShape();
    const outcomes = {};
    for (const locked of [false, true]) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false, locked: false, drawings: [value] })), [DRAWINGS_KEY, { kind: 'rectangle', points: [shapeNow.a, shapeNow.b], ...(locked ? { locked: true } : {}) }]);
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
      await pickTool('erase');
      const r = await page.evaluate(() => { const b = document.querySelector('[data-drawing-kind="rectangle"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await page.mouse.click(r.x, r.y); await delay(400);
      outcomes[locked ? 'locked' : 'free'] = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).drawings.length, DRAWINGS_KEY);
    }
    assert.equal(outcomes.free, 0, 'the eraser did not remove the free rectangle');
    assert.equal(outcomes.locked, 1, 'the eraser removed a locked rectangle');
    await pickTool('cursor');
    await page.evaluate((key) => localStorage.removeItem(key), DRAWINGS_KEY);
    return outcomes;
  });
  await pickTool('cursor');

  // Drawing kinds, free and locked. Area kinds are pressed on their body;
  // line kinds on the line itself and 24px beside it.
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
  const cover = await coveringShape();
  const mid = (cover.a.price + cover.b.price) / 2, midTime = Math.round((cover.a.time + cover.b.time) / 2);
  const KINDS = {
    rectangle: { points: [cover.a, cover.b], area: true }, ellipse: { points: [cover.a, cover.b], area: true },
    ruler: { points: [cover.a, cover.b], area: true, offset: [0.38, 0.3] }, // The position tool: entry at the middle, target at the top, stop at the bottom; pressed inside the profit zone, off the entry line and its cards.
    long: { points: [{ time: cover.a.time, price: mid }, { time: cover.b.time, price: cover.a.price }, { time: cover.b.time, price: cover.b.price }], area: true, zone: true },
    fib: { points: [cover.a, cover.b], area: false }, trendline: { points: [cover.a, cover.b], area: false },
    horizontal: { points: [{ time: cover.a.time, price: mid }], area: false }, vertical: { points: [{ time: midTime, price: cover.a.price }], area: false },
    text: { points: [{ time: midTime, price: mid }], text: 'QA', area: false },
  };
  const pressPoint = (kind, spec) => page.evaluate(([kind, area, offset, zone]) => {
    const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart);
    const box = host.getBoundingClientRect();
    const g = document.querySelector(`[data-drawing-kind="${kind}"]`);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    if (zone) { const z = g.querySelector('polygon')?.getBoundingClientRect(); if (!z) return null; return { x: z.x + z.width / 2, y: z.y + z.height / 2 }; }
    if (area) return offset ? { x: box.x + box.width * offset[0], y: box.y + box.height * offset[1] } : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    // A line: its midpoint (for a horizontal line the plot's middle x, for a vertical one the plot's middle y).
    const onLine = { x: r.width > 4 ? r.x + r.width / 2 : r.x + r.width / 2, y: r.height > 4 ? r.y + r.height / 2 : r.y + r.height / 2 };
    if (kind === 'horizontal') onLine.x = box.x + box.width * 0.45;
    if (kind === 'vertical') onLine.y = box.y + box.height * 0.4;
    return { ...onLine, beside: { x: onLine.x + (kind === 'vertical' ? 24 : 0), y: onLine.y + (kind === 'vertical' ? 0 : 24) } };
  }, [kind, spec.area, spec.offset ?? null, !!spec.zone]);
  const press = async (x, y, dx = 200) => {
    // Only one drawing is on the chart here: slide along its line (across a vertical one), never off it.
    const dir = await page.evaluate(() => { const g = document.querySelector('[data-drawing-kind]'); const r = g?.getBoundingClientRect(); const kind = g?.getAttribute('data-drawing-kind');
      return kind === 'vertical' ? [0, 1] : kind === 'trendline' && r && r.width > 4 ? [r.width / Math.hypot(r.width, r.height), r.height / Math.hypot(r.width, r.height)] : [1, 0]; });
    const spot = await clearOfForeignUi(x, y, dir); x = spot.x; y = spot.y;
    const before = await readChart(); const storedBefore = await storedPoints(); const top = spot.top;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 10 }); await page.mouse.up(); await delay(350);
    const after = await readChart();
    return { top, panned: before.from - after.from, drawingMoved: (await storedPoints()) !== storedBefore };
  };
  for (const [kind, spec] of Object.entries(KINDS)) for (const locked of [false, true]) {
    await check(`matrix-drawing-${kind}-${locked ? 'locked' : 'free'}`, async () => {
      const drawing = { kind, points: spec.points, ...(spec.text ? { text: spec.text } : {}), ...(locked ? { locked: true } : {}) };
      await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false, locked: false, drawings: [value] })), [DRAWINGS_KEY, drawing]);
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
      const at = await pressPoint(kind, spec);
      assert(at, `the ${kind} was not drawn`);
      const on = await press(at.x, at.y);
      const row = { kind, locked, on: { top: on.top, panned: Math.round(on.panned * 100) / 100, drawingMoved: on.drawingMoved } };
      if (at.beside) { const beside = await press(at.beside.x, at.beside.y); row.beside = { top: beside.top, panned: Math.round(beside.panned * 100) / 100, drawingMoved: beside.drawingMoved }; }
      report.matrix.drawings.push(row);
      if (spec.area) {
        if (locked) assert(on.panned > 5 && !on.drawingMoved, `a press on a locked ${kind} body did not pan the chart (${JSON.stringify(row.on)})`);
        else assert(on.drawingMoved && Math.abs(on.panned) < 0.01, `a press on a free ${kind} body neither moved it nor left the chart alone (${JSON.stringify(row.on)})`);
      } else {
        // On the line: a free line moves, a locked one only selects (its outline stays grabbable). Beside it: the chart pans either way.
        if (!locked) assert(on.drawingMoved || on.panned > 5, `a press on a free ${kind} did nothing (${JSON.stringify(row.on)})`);
        assert(row.beside.panned > 5 && !row.beside.drawingMoved, `a press beside a ${locked ? 'locked' : 'free'} ${kind} did not pan (${JSON.stringify(row.beside)})`);
      }
      return row;
    });
  }
  await page.evaluate((key) => localStorage.removeItem(key), DRAWINGS_KEY);

  // Saved chart settings, workspace and indicators from this browser.
  const SETTINGS = {
    logScale: { 'voltex.chartSettings.v1': { scaleMode: 'logarithmic' } },
    gridWatermarkNoVolumeNoTimeAxis: { 'voltex.chartSettings.v1': { grid: 'all', crosshairStyle: 'solid', watermark: true, volume: false, timeScaleVisible: false } },
    rsiLowerPane: { 'voltex.chartIndicators.futures.v1': [{ id: 'ma-200', type: 'ma', params: { period: 200 }, colors: ['#f7d51d'], lineWidth: 1, visible: true }, { id: 'rsi-qa', type: 'rsi', params: { period: 14 }, colors: ['#c084fc'], lineWidth: 1, visible: true }] },
    twoPaneLayout: { 'voltex.chartWorkspace.futures.v1': { version: 1, layout: 2 } },
    compareEth: { 'voltex.chartWorkspace.futures.v1': { version: 1, compare: [{ pair: 'ETH/USDT', color: '#2962ff', visible: true }], comparePeriod: 'all' } },
    railCollapsed: { 'voltex.drawingRail.collapsed': '1' },
  };
  const SETTING_KEYS = ['voltex.chartSettings.v1', 'voltex.chartIndicators.futures.v1', 'voltex.chartWorkspace.futures.v1', 'voltex.drawingRail.collapsed'];
  for (const [name, seedValues] of Object.entries(SETTINGS)) {
    await check(`matrix-settings-${name}-drag-pans`, async () => {
      await page.evaluate(([keys, values]) => { for (const k of keys) localStorage.removeItem(k); for (const [k, v] of Object.entries(values)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, [SETTING_KEYS, seedValues]);
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
      const applied = await page.evaluate(() => { const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart); const { chart } = host.__voltexChart; return { panes: chart.panes().length, priceScaleMode: chart.priceScale('right').options().mode, canvases: document.querySelectorAll('canvas').length, railCollapsed: localStorage.getItem('voltex.drawingRail.collapsed') }; });
      const result = await drag(220);
      const row = { setting: name, applied, shifted: Math.round(result.shifted * 100) / 100, top: result.top };
      if (name === 'rsiLowerPane') {
        // A press inside the indicator's own pane pans the whole chart too.
        const chart = await readChart();
        const lower = await drag(200, 0.5, (chart.paneHeight + 30) / chart.box.h);
        row.lowerPane = { shifted: Math.round(lower.shifted * 100) / 100, top: lower.top };
        assert(applied.panes >= 2, `the RSI pane did not open (panes: ${applied.panes})`);
        assertPanned(lower, 200, 'drag inside the RSI pane');
      }
      report.matrix.settings.push(row);
      return assertPanned(result, 220, `drag with saved ${name}`);
    });
  }
  await page.evaluate((keys) => { for (const k of keys) localStorage.removeItem(k); }, SETTING_KEYS);

  await check('no-trading-write-left-the-page-during-the-whole-run', async () => {
    assert.equal(tradingWrites.length, 0, `the page sent ${tradingWrites.length} trading write(s): ${tradingWrites.slice(0, 5).join(', ')}`);
    assert.equal(commands.length, 0, `the page posted ${commands.length} native command(s): ${commands.join(', ')}`);
    return { tradingWrites: tradingWrites.length, nativeCommands: commands.length };
  });
})().catch((error) => { report.errors.push(String(error.stack || error)); console.error(error); })
  .finally(async () => {
    const failed = report.checks.filter((c) => !c.passed);
    report.summary = { checks: report.checks.length, failed: failed.length, skipped: report.checks.filter((c) => c.skipped).length, commandsPosted: undefined };
    fs.writeFileSync(path.join(out, `${label}-report.json`), JSON.stringify(report, null, 2));
    if (browser) await browser.close().catch(() => {});
    await stopServer();
    console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed${report.summary.skipped ? ` (${report.summary.skipped} skipped)` : ''}; page errors: ${report.errors.length}`);
    if (failed.length || report.errors.length) process.exitCode = 1;
  });
