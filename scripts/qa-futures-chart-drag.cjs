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
const topElementAt = (x, y) => page.evaluate(([x, y]) => { const el = document.elementsFromPoint(x, y)[0]; return el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-drawing-hit') ? '[hit=' + el.getAttribute('data-drawing-hit') + ']' : ''}` : null; }, [x, y]);
/** Press, move by dx with the button held, release. Returns bars shifted (positive: older bars came into view). */
async function drag(dx, fx = 0.5, fy = 0.45, steps = 10) {
  const before = await readChart();
  assert(before, 'chart instance not found');
  const cx = before.box.x + Math.round(before.box.w * fx), cy = before.box.y + Math.round(before.box.h * fy);
  const top = await topElementAt(cx, cy);
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
async function candlePoint(offsetFromRight) {
  return page.evaluate(([offset]) => {
    const host = [...document.querySelectorAll('.chart-surface *')].find((el) => el.__voltexChart);
    const { chart, series } = host.__voltexChart;
    const r = chart.timeScale().getVisibleLogicalRange();
    const index = Math.floor(r.to) - offset;
    const bar = series.dataByIndex(index);
    if (!bar) return null;
    const box = host.getBoundingClientRect();
    return { x: box.x + chart.timeScale().logicalToCoordinate(index), y: box.y + series.priceToCoordinate((bar.high + bar.low) / 2), time: bar.time };
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
  const commands = [];
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => { if (request.url().endsWith('/native/commands') && request.method() === 'POST') commands.push(request.postDataJSON()?.kind ?? 'POST'); });
  // A clean slate once: later navigations keep what a check seeded.
  await page.addInitScript((key) => { try { if (!sessionStorage.getItem('chart-drag-qa-clean')) { localStorage.removeItem(key); sessionStorage.setItem('chart-drag-qa-clean', '1'); } } catch {} }, DRAWINGS_KEY);

  await page.goto(origin + '/futures?pair=BTC%2FUSDT', { waitUntil: 'domcontentloaded' });
  await settle();

  // 1. Normal mode.
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
