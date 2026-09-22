/** Measures the P&L card's click-to-visible path, stage by stage.
 *
 *  Not a pass/fail QA: it reports numbers. It drives the real /futures
 *  terminal against the real NativeDemoService on the disposable review
 *  server, opens a real position, then clicks the card button and times
 *  every step the owner asked about — the API round trip, the SVG build,
 *  the image decode, the canvas draw, the PNG encode, the base64 read, and
 *  the whole click-to-visible-preview span.
 *
 *  Backend work is counted rather than guessed: the server logs one line per
 *  repository read and per command, and the counts are parsed back out.
 *
 *  Disposable fixture server ONLY; never production. No production
 *  credentials, database, real account or exchange matching is involved.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..'), front = path.join(root, 'frontend');
const out = path.join(root, 'docs/qa/pnl-card-performance');
fs.mkdirSync(out, { recursive: true });
const label = process.env.BENCH_LABEL || 'run';
const port = process.env.BENCH_PORT || '4183';
const origin = `http://127.0.0.1:${port}`;
const RUNS = Number(process.env.BENCH_RUNS || 12);
/* A thin, sub-cent contract: the formatting case the owner reported lives
   here too, so one fixture serves both halves of the task. */
const PAIR = 'AKE/USDT', SYMBOL = 'AKEUSDT';

let browser, server, shim;
const delay = ms => new Promise(r => setTimeout(r, ms));
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};
const stat = xs => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), min: pct(xs, 0), max: pct(xs, 100) });

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-native-demo-review.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: port, NATIVE_PREVIEW_FIXTURE: '1', NATIVE_PREVIEW_THIN_SYMBOL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logPath = path.join(out, `server-${label}.log`);
  fs.writeFileSync(logPath, '');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Fixture server exited: ${server.exitCode}`);
    try { const r = await fetch(origin + '/health'); if (r.ok && (await r.json()).fixtureMarket === true) return logPath; } catch {}
    await delay(500);
  }
  throw Error('Fixture server did not become healthy');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { const t = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(t); resolve(); }); child.kill('SIGTERM'); });
}

async function main() {
  // Observation only: the shim re-exports the real renderer so each stage can
  // be timed individually; no component, price, layout or route is replaced.
  const chartModule = path.join(front, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
  shim = path.join(os.tmpdir(), `voltex-bench-observer-${process.pid}.mjs`);
  fs.writeFileSync(shim, `export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};import * as renderer from ${JSON.stringify(path.join(front, 'src/lib/privateResultCard.ts'))};window.__cardRenderer=renderer;export function createChart(...args){const c=original(...args);window.__benchChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__benchSeries=s;return s;};return c;}`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root: front, resolve: { alias: { 'lightweight-charts': shim } }, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') }, logLevel: 'error' });
  const logPath = await startServer();
  const { chromium } = require(process.env.BENCH_PLAYWRIGHT || process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true, args: process.env.BENCH_CHROMIUM_ARGS ? process.env.BENCH_CHROMIUM_ARGS.split(' ') : [] });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC' });
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
  if (!state.initialized) state = await api('initialize', { acceptedModel: state.model.version, idempotencyKey: 'bench-init' });

  /* A real OPEN position in the owner's reported shape: a HISTORICAL_DEMO
     entry on an AKE candle from before the fixture's rise, so the entry sits
     at ~0.0040 while the current mark is ~0.0538 — a sub-cent entry price, a
     large positive PnL and a large ROI, which is exactly the case where the
     card's fixed 2-decimal price formatting prints 0.00. */
  const candleTime = Math.floor((Date.now() - 7 * 3600000) / 3600000) * 3600000;
  const opened = await api('commands', {
    kind: 'OPEN', symbol: SYMBOL, side: 'LONG', type: 'MARKET',
    quantity: '1200000', leverage: '10', idempotencyKey: 'bench-open',
    executionMode: 'HISTORICAL_DEMO',
    candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: candleTime, pricePoint: 'CLOSE' },
  });
  const position = opened.positions.find(p => p.status === 'OPEN');
  assert(position, `No open position: ${JSON.stringify(opened.positions)}`);

  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', s => s.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  await page.goto(`${origin}/futures?pair=${encodeURIComponent(PAIR)}`);
  await page.locator('.chart-surface').waitFor();

  const cardId = `native:${opened.revision}:${position.id}`;
  const before = fs.readFileSync(logPath, 'utf8').length;

  // ---- Stage timings, taken in the page against the real renderer --------
  const stages = await page.evaluate(async ({ cardId, runs, originUrl, token }) => {
    const R = window.__cardRenderer;
    if (!R) throw new Error('Card renderer was not exposed by the bench shim');
    const [, revision, positionId] = /^native:(\d+):(native-[a-zA-Z0-9-]+)$/.exec(cardId);
    const rows = [];
    for (let i = 0; i < runs; i++) {
      /* TWO different backend paths, and only one of them is what a click
         costs. The UI calls POST /native/cards with a bare positionId, which
         takes the read -> REFRESH -> read branch. The GET with a pinned
         revision skips the REFRESH entirely, so timing that one would have
         understated the click by the whole cost of the refresh. Both are
         measured, and the POST is the one that matters. */
      const t0 = performance.now();
      const response = await fetch(`${originUrl}/api/v1/private-trading/native/cards`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId }),
      });
      const snapshot = await response.json();
      const tApi = performance.now();
      if (!response.ok) throw new Error(`card API ${response.status}: ${JSON.stringify(snapshot)}`);

      const tPinnedStart = performance.now();
      const pinned = await fetch(`${originUrl}/api/v1/private-trading/native/cards/${revision}/${positionId}`,
        { headers: { Authorization: 'Bearer ' + token } });
      await pinned.json();
      const tPinned = performance.now();

      const svg = R.privateResultCardSvg(snapshot);
      const tSvg = performance.now();

      // Decode: the SVG becomes a bitmap the canvas can draw.
      const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error('decode failed')); image.src = source; });
      const tDecode = performance.now();

      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1215;
      canvas.getContext('2d').drawImage(image, 0, 0, 1080, 1215);
      const tCanvas = performance.now();

      const png = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
      const tBlob = performance.now();

      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error('read failed')); fr.onload = () => res(fr.result); fr.readAsDataURL(png); });
      const tDataUrl = performance.now();

      // What the preview actually costs when the SVG is shown directly.
      const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const probe = new Image();
      const tSvgPreviewStart = performance.now();
      await new Promise((res, rej) => { probe.onload = res; probe.onerror = () => rej(new Error('svg preview failed')); probe.src = svgUrl; });
      const tSvgPreview = performance.now();
      URL.revokeObjectURL(svgUrl); URL.revokeObjectURL(source);

      rows.push({
        api: tApi - t0,
        apiPinnedRevision: tPinned - tPinnedStart,
        svgBuild: tSvg - tApi,
        decode: tDecode - tSvg,
        canvas: tCanvas - tDecode,
        toBlob: tBlob - tCanvas,
        dataUrl: tDataUrl - tBlob,
        pngPipelineTotal: tDataUrl - tApi,
        svgPreviewOnly: tSvgPreview - tSvgPreviewStart,
        clickToPngVisible: tDataUrl - t0,
        svgBytes: svg.length,
        pngBytes: png.size,
        dataUrlChars: dataUrl.length,
        entryPrice: snapshot.entryPrice,
        valuationPrice: snapshot.valuationPrice,
        pnl: snapshot.pnl,
        roiPercent: snapshot.roiPercent,
      });
    }
    return rows;
  }, { cardId, runs: RUNS, originUrl: origin, token });

  // ---- Click to visible, through the real UI ----------------------------
  const clickRuns = [];
  let clickPathNote = null;
  try {
  for (let i = 0; i < Math.min(RUNS, 6); i++) {
    await page.reload();
    await page.locator('.chart-surface').waitFor();
    const tab = page.locator('#mobile-futures-positions');
    if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    // The shipped terminal renders the archive row, whose card trigger is
    // `.archive-pnl-open`; the plain row uses `.futures-position-card`.
    // Both call the same execution.showPnlCard.
    const trigger = page.locator('.archive-pnl-open, .futures-position-card').first();
    await trigger.waitFor({ state: 'visible' });
    const started = await page.evaluate(() => performance.now());
    await trigger.click();
    // The dialog element appearing, and then a real preview inside it.
    await page.locator('.private-card-dialog').waitFor({ state: 'visible' });
    const dialogAt = await page.evaluate(() => performance.now());
    await page.locator('.private-card-dialog img').waitFor({ state: 'visible' });
    const visibleAt = await page.evaluate(async () => {
      const img = document.querySelector('.private-card-dialog img');
      if (img && !img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
      return performance.now();
    });
    clickRuns.push({ clickToDialog: dialogAt - started, clickToPreview: visibleAt - started });
    await page.keyboard.press('Escape').catch(() => {});
  }
  } catch (error) {
    // The stage timings above are the measurement; the UI click path is a
    // cross-check. Record why it could not be taken instead of losing the run.
    clickPathNote = String(error.message).split('\n')[0];
    const panel = await page.evaluate(() => {
      const p = document.querySelector('.futures-positions-panel');
      return { present: !!p, rows: document.querySelectorAll('.futures-positions-table tbody tr').length,
        cardButtons: document.querySelectorAll('.futures-position-card').length,
        text: (p?.innerText || '').slice(0, 400) };
    }).catch(() => null);
    clickPathNote += ` | panel=${JSON.stringify(panel)}`;
    await page.screenshot({ path: path.join(out, `click-path-${label}.png`), fullPage: true }).catch(() => {});
  }

  // ---- Backend work actually performed ----------------------------------
  const after = fs.readFileSync(logPath, 'utf8').slice(before);
  /* The server logs one structured line per stage, so a bare substring count
     would multiply-count a single command. Reads are counted at their start
     event only, and REFRESH commands by DISTINCT requestId. */
  const startedReads = (after.match(/"repository\.read","elapsedMs"/g) || []).length;
  const refreshIds = new Set();
  for (const line of after.split('\n')) {
    if (!line.includes('"kind":"REFRESH"') || !line.includes('"stage":"received"')) continue;
    const id = /"requestId":"([^"]+)"/.exec(line);
    if (id) refreshIds.add(id[1]);
  }
  const backend = {
    note: 'Counted from the review server log over the benchmarked card requests only. Reads counted at their start event; REFRESH counted by distinct requestId.',
    repositoryReads: startedReads,
    refreshCommands: refreshIds.size,
    cardRequests: RUNS + clickRuns.length,
    readsPerCard: Number((startedReads / (RUNS + clickRuns.length)).toFixed(2)),
    refreshesPerCard: Number((refreshIds.size / (RUNS + clickRuns.length)).toFixed(2)),
  };

  const column = key => stat(stages.map(r => r[key]));
  const report = {
    label, runs: RUNS, viewport: '1440x900',
    fixtureOnly: true, productionVerified: false,
    sample: {
      entryPrice: stages[0].entryPrice, valuationPrice: stages[0].valuationPrice,
      pnl: stages[0].pnl, roiPercent: stages[0].roiPercent,
      svgBytes: stages[0].svgBytes, pngBytes: stages[0].pngBytes, dataUrlChars: stages[0].dataUrlChars,
    },
    stagesMs: {
      apiRoundTripPostWithRefresh: column('api'),
      apiRoundTripPinnedRevisionNoRefresh: column('apiPinnedRevision'),
      svgBuild: column('svgBuild'),
      svgDecodeForCanvas: column('decode'),
      canvasDraw: column('canvas'),
      pngEncodeToBlob: column('toBlob'),
      blobToDataUrl: column('dataUrl'),
      pngPipelineTotal: column('pngPipelineTotal'),
      svgPreviewOnly: column('svgPreviewOnly'),
      apiToPngVisible: column('clickToPngVisible'),
    },
    clickPathNote,
    clickPathMs: {
      clickToDialogVisible: stat(clickRuns.map(r => r.clickToDialog)),
      clickToPreviewVisible: stat(clickRuns.map(r => r.clickToPreview)),
    },
    backend,
    pageErrors,
  };
  fs.writeFileSync(path.join(out, `bench-${label}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}

main().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); await stopServer(); if (shim) fs.rmSync(shim, { force: true }); });
