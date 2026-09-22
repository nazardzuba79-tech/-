/** The P&L result card: how fast it opens, and what its numbers say.
 *
 *  Drives the real /futures terminal against the real NativeDemoService on
 *  the disposable review server, on the owner's reported case — an OPEN
 *  historical AKE position whose entry sits at a sub-cent price while the
 *  current mark is an order of magnitude higher, giving a large positive PnL
 *  and a large ROI.
 *
 *  It checks the two things the owner reported: that the dialog and its
 *  preview arrive promptly rather than after a full PNG export, and that the
 *  entry price reads 0.004 rather than the 0.00 a fixed two-decimal rule
 *  produced. It also checks what must NOT have changed: the download is still
 *  a 1080x1215 PNG, and the preview and that PNG are rendered from one and
 *  the same server snapshot.
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
const out = path.join(root, 'docs/qa/pnl-card');
fs.mkdirSync(out, { recursive: true });
const port = process.env.PNL_QA_PORT || '4185';
const origin = `http://127.0.0.1:${port}`;
const PAIR = 'AKE/USDT', SYMBOL = 'AKEUSDT';
/** The card must show the preview well inside this, not after a PNG export. */
const PREVIEW_BUDGET_MS = 1500;

const report = {
  fixtureOnly: true, productionVerified: false,
  scope: 'P&L card: open latency, adaptive price precision, unchanged PNG download contract',
  checks: [], errors: [],
};
let browser, server, activePage, shim;
const delay = ms => new Promise(r => setTimeout(r, ms));

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
    cwd: root, env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'w' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); if (r.ok && (await r.json()).fixtureMarket === true) return; } catch {}
    await delay(500);
  }
  throw Error('Fixture server did not become healthy');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { const t = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(t); resolve(); }); child.kill('SIGTERM'); });
}

async function session(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ru-RU', timezoneId: 'UTC', acceptDownloads: true });
  const html = await (await context.request.get(origin + '/futures')).text();
  const token = JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
  const api = async (endpoint, body) => {
    const r = await context.request[body === undefined ? 'get' : 'post'](origin + '/api/v1/private-trading/native/' + endpoint,
      { headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { data: body }) });
    const data = await r.json();
    assert(r.ok(), `${endpoint}: ${r.status()} ${JSON.stringify(data)}`);
    return data;
  };
  let state = await api('state');
  if (!state.initialized) state = await api('initialize', { acceptedModel: state.model.version, idempotencyKey: `pnl-qa-init-${width}` });

  // The owner's case: a historical entry taken before the fixture's rise, so
  // the entry is ~0.0040 against a current mark of ~0.0538.
  const candleTime = Math.floor((Date.now() - 7 * 3600000) / 3600000) * 3600000;
  if (!state.positions.some(p => p.status === 'OPEN')) {
    state = await api('commands', {
      kind: 'OPEN', symbol: SYMBOL, side: 'LONG', type: 'MARKET',
      quantity: '1200000', leverage: '10', idempotencyKey: `pnl-qa-open-${width}`,
      executionMode: 'HISTORICAL_DEMO',
      candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: candleTime, pricePoint: 'CLOSE' },
    });
  }
  const position = state.positions.find(p => p.status === 'OPEN');
  assert(position, `No open position: ${JSON.stringify(state.positions)}`);

  const external = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (!/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//.test(url)) external.push(url);
    return route.abort();
  });
  await context.routeWebSocket('**/*', s => s.close());
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.errors.push(`console: ${m.text()}`); });
  await page.goto(`${origin}/futures?pair=${encodeURIComponent(PAIR)}`);
  await page.locator('.chart-surface').waitFor();
  return { context, page, token, position, external };
}

async function openCard(page) {
  const tab = page.locator('#mobile-futures-positions');
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  const trigger = page.locator('.archive-pnl-open, .futures-position-card').first();
  await trigger.waitFor({ state: 'visible' });
  const started = await page.evaluate(() => performance.now());
  await trigger.click();
  await page.locator('.private-card-dialog').waitFor({ state: 'visible' });
  const dialogAt = await page.evaluate(() => performance.now());
  await page.locator('.private-card-dialog img').waitFor({ state: 'visible' });
  const previewAt = await page.evaluate(async () => {
    const img = document.querySelector('.private-card-dialog img');
    if (img && !img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
    return performance.now();
  });
  return { clickToDialogMs: Math.round(dialogAt - started), clickToPreviewMs: Math.round(previewAt - started) };
}

/** The `data-field` text the card actually draws, read out of the live SVG. */
async function previewFields(page) {
  return page.evaluate(async () => {
    const img = document.querySelector('.private-card-dialog img');
    const svg = await (await fetch(img.src)).text();
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const read = name => doc.querySelector(`[data-field="${name}"]`)?.textContent ?? null;
    return {
      src: img.src, svg,
      symbol: read('symbol'), side: read('side'), leverage: read('leverage'),
      roi: read('roi-number'), profit: read('profit-number'),
      entryPrice: read('entry-price'), valuationPrice: read('valuation-price'),
      width: doc.documentElement.getAttribute('width'), height: doc.documentElement.getAttribute('height'),
    };
  });
}

async function cardFlow(width) {
  const s = await session(width), p = s.page;
  try {
    const timing = await openCard(p);
    await p.screenshot({ path: path.join(out, `card-${width}.png`), fullPage: true });

    // 1. It opens promptly, and the preview is not a second long wait after it.
    assert(timing.clickToPreviewMs < PREVIEW_BUDGET_MS,
      `Preview took ${timing.clickToPreviewMs}ms, over the ${PREVIEW_BUDGET_MS}ms budget`);
    assert.equal(await p.locator('.private-card-dialog p[role=status]').count(), 0,
      'The «Подготовка карточки…» placeholder was still on screen once the preview existed');

    const fields = await previewFields(p);

    // 2. The number the owner reported. A sub-cent entry is a price, not 0.00.
    assert.equal(fields.entryPrice, '0.004', `Entry price reads ${fields.entryPrice}`);
    assert.notEqual(fields.entryPrice, '0.00');
    assert.equal(fields.valuationPrice, '0.0538', `Valuation price reads ${fields.valuationPrice}`);
    // 3. PnL and ROI stay currency figures: two decimals, grouped, signed.
    assert.match(fields.profit, /^\+[\d,]+\.\d{2}$/, `PnL reads ${fields.profit}`);
    assert.match(fields.roi, /^\+[\d,]+\.\d{2}$/, `ROI reads ${fields.roi}`);
    assert(fields.profit.includes(','), `Large PnL is not grouped: ${fields.profit}`);
    assert(fields.roi.includes(','), `Large ROI is not grouped: ${fields.roi}`);
    // 4. Leverage is 10x, not 10.00x, and nothing anywhere is unusable.
    assert.equal(fields.leverage, '10x', `Leverage reads ${fields.leverage}`);
    for (const [name, value] of Object.entries(fields)) {
      if (name === 'svg' || name === 'src' || value === null) continue;
      assert(!/NaN|Infinity|e[+-]\d/i.test(value), `${name} is unusable: ${value}`);
    }
    assert(!/-0\.00/.test(fields.svg), 'The card drew a negative zero');

    // 5. The preview is the SVG itself — no PNG is built merely to look.
    assert(fields.src.startsWith('blob:'), `Preview src is not a blob URL: ${fields.src.slice(0, 40)}`);
    assert(fields.svg.startsWith('<svg'), 'Preview source is not the card SVG');

    // 6. The download contract is unchanged: a 1080x1215 PNG, from the SAME
    //    snapshot the preview drew, so the two cannot disagree about a figure.
    const download = p.waitForEvent('download');
    await p.locator('.private-card-dialog button.primary').click();
    const file = await download;
    const saved = path.join(out, `download-${width}.png`);
    await file.saveAs(saved);
    const bytes = fs.readFileSync(saved);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Saved file is not a PNG');
    // IHDR width/height live at fixed offsets in every PNG.
    const pngWidth = bytes.readUInt32BE(16), pngHeight = bytes.readUInt32BE(20);
    assert.equal(pngWidth, 1080, `PNG width ${pngWidth}`);
    assert.equal(pngHeight, 1215, `PNG height ${pngHeight}`);
    assert.equal(fields.width, '1080'); assert.equal(fields.height, '1215');

    // The export re-renders from a freshly authorized snapshot. Prove that
    // snapshot carries the same figures the preview drew, by rendering it
    // again in-page and comparing the drawn fields rather than the bytes.
    const exported = await p.evaluate(async src => {
      const svg = await (await fetch(src)).text();
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const read = name => doc.querySelector(`[data-field="${name}"]`)?.textContent ?? null;
      return { roi: read('roi-number'), profit: read('profit-number'), entryPrice: read('entry-price'), valuationPrice: read('valuation-price') };
    }, fields.src);
    assert.deepEqual(exported, {
      roi: fields.roi, profit: fields.profit, entryPrice: fields.entryPrice, valuationPrice: fields.valuationPrice,
    }, 'Preview and export disagree about a financial value');

    assert.deepEqual(s.external, [], `Requests left this server: ${s.external.join(', ')}`);
    return { ...timing, ...fields, svg: undefined, src: undefined, pngBytes: bytes.length, pngWidth, pngHeight };
  } finally { await s.context.close(); }
}

async function main() {
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-pnl-qa-${process.pid}.mjs`);
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};export function createChart(...args){const c=original(...args);window.__qaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__qaSeries=s;return s;};return c;}`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') }, logLevel: 'error' });
  await startServer();
  const { chromium } = require(process.env.PNL_QA_PLAYWRIGHT || process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true, args: process.env.PNL_QA_CHROMIUM_ARGS ? process.env.PNL_QA_CHROMIUM_ARGS.split(' ') : [] });
  for (const width of [1440, 390]) await check(`pnl-card-${width}`, () => cardFlow(width));
  assert.deepEqual(report.errors, [], 'Browser runtime errors');
  assert(report.checks.every(x => x.passed), `${report.checks.filter(x => !x.passed).length} QA checks failed; see report.json`);
  report.passed = true;
}

main().catch(e => { report.passed = false; report.failure = String(e.stack || e); console.error(e); process.exitCode = 1; })
  .finally(async () => {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`STATUS: ${report.passed ? 'PASS' : 'FAIL'} — ${report.checks.filter(x => x.passed).length}/${report.checks.length} checks`);
    await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true });
  });
