/** Isolated P&L dialog/PNG browser QA. Synthetic fixtures; no production requests.
 * This is not an end-to-end chart/replay or production-account certification.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const req = createRequire(path.join(frontend, 'package.json'));
const esbuild = req('esbuild');
const out = path.join(root, 'docs/qa/private-trading/card-browser');
fs.mkdirSync(out, { recursive: true });
const fixture = Object.freeze({
  id: 'qa-fixture-not-an-account-result', symbol: 'BTCUSDT', side: 'LONG', leverage: '10',
  mode: 'HISTORICAL_REPLAY', status: 'CLOSED', label: 'Historical Test',
  roiPercent: '211.38', pnl: '24580.00', netPnl: '24580.00', unrealizedPnl: '0',
  entryPrice: '77736.200000', valuationPrice: '78526.700000', usdPnl: null,
  asOf: '2026-09-14T00:00:00Z',
});
// Deliberately independent frozen display fields: the frontend must not recompute them.
const bundle = esbuild.buildSync({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {PrivateResultCardDialog} from './src/pages/private-trading/PrivateResultCardDialog';
import * as renderer from './src/lib/privateResultCard';
import './src/pages/private-trading/privateTrading.css';
window.__cardRenderer=renderer;window.__qaErrors=[];
createRoot(document.getElementById('root')).render(<PrivateResultCardDialog snapshot={Object.freeze(window.__fixture)} onClose={()=>{}} onError={e=>window.__qaErrors.push({message:e.message,status:e.status})}/>);`,
    resolveDir: frontend, sourcefile: 'private-card-qa.tsx', loader: 'tsx',
  },
  bundle: true, jsx: 'automatic', write: false, outdir: path.join(out, 'bundle'), format: 'iife',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1'), 'import.meta.env': '{}' },
});
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const stylesheet = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const token = 'isolated-private-card-browser-fixture';
let server, browser, reads = 0, denyAt = Infinity;
const report = { fixtureOnly: true, scope: 'isolated actual React P&L dialog and PNG; not chart E2E or production', checks: [] };
async function main() {
  server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') { response.writeHead(403); response.end(); return; }
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated card QA — synthetic fixture</title><link rel="stylesheet" href="/bundle.css"></head><body><p>QA fixture — not real account results</p><div id="root"></div><script>localStorage.setItem('exchange_token',${JSON.stringify(token)});window.__fixture=${JSON.stringify(fixture)};</script><script src="/bundle.js"></script></body></html>`);
    } else if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end(javascript);
    } else if (request.url === '/bundle.css') {
      response.setHeader('Content-Type', 'text/css'); response.end(stylesheet);
    } else if (request.url === `/api/v1/private-trading/cards/${fixture.id}`) {
      reads++;
      const allowed = request.headers.authorization === `Bearer ${token}` && reads < denyAt;
      response.writeHead(allowed ? 200 : 403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(allowed ? fixture : { error: 'private_access_denied' }));
    } else { response.writeHead(403); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    reads = 0; denyAt = Infinity;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, acceptDownloads: true });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const image = page.locator('dialog.private-card-dialog img');
    await image.waitFor(); await page.waitForFunction(() => document.querySelector('dialog img')?.complete);
    // ONE PLACE PINS THE SIZE. The renderer's own constants are the contract;
    // the preview and the downloaded file are then both checked against them,
    // so a future change to the card cannot leave a stale number behind here.
    const exportSize = await page.evaluate(() => [window.__cardRenderer.PRIVATE_RESULT_CARD_WIDTH, window.__cardRenderer.PRIVATE_RESULT_CARD_HEIGHT]);
    assert.deepEqual(exportSize, [1080, 1215], 'P&L card export contract is 1080x1215');
    assert.deepEqual(await image.evaluate(img => [img.naturalWidth, img.naturalHeight]), exportSize);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('dialog'), image = dialog.querySelector('img'), footer = dialog.querySelector('footer');
      return { modal: dialog.matches(':modal'), dialog: dialog.getBoundingClientRect().toJSON(), image: image.getBoundingClientRect().toJSON(), footer: footer.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    assert(geometry.modal);
    assert(geometry.dialog.left >= 0 && geometry.dialog.right <= width);
    assert(geometry.image.left >= geometry.dialog.left && geometry.image.right <= geometry.dialog.right);
    assert(geometry.footer.bottom <= geometry.height, 'PNG controls must remain inside the viewport');
    assert(geometry.scrollWidth <= width);
    await page.screenshot({ path: path.join(out, `dialog-${width}.png`), fullPage: true });
    // Measure actual SVG text layout; checking the attribute alone misses baseline/overflow regressions.
    const typography = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px;pointer-events:none';
      document.body.append(host);
      const field = name => host.querySelector(`[data-field="${name}"]`);
      try {
        host.innerHTML = window.__cardRenderer.privateResultCardSvg(window.__fixture);
        const digits = field('roi-number'), unit = field('roi-unit');
        const result = {
          numberSize: getComputedStyle(digits).fontSize, unitSize: getComputedStyle(unit).fontSize,
          numberY: digits.getBBox().y, unitY: unit.getBBox().y,
          numberHeight: digits.getBBox().height, unitHeight: unit.getBBox().height,
          entry: field('entry-price').textContent, valuation: field('valuation-price').textContent,
          entryLabel: field('entry-label').textContent, closedLabel: field('valuation-label').textContent,
          profitGap: field('profit-unit').getBBox().x - (field('profit-number').getBBox().x + field('profit-number').getBBox().width),
        };
        host.innerHTML = window.__cardRenderer.privateResultCardSvg({...window.__fixture,mode:'DEMO_LIVE',status:'OPEN',label:'Симуляция'});
        result.openLabel = field('valuation-label').textContent;
        host.innerHTML = window.__cardRenderer.privateResultCardSvg({...window.__fixture,roiPercent:'-123456789123456789.99'});
        const long = field('roi-line').getBBox();
        result.longRoiRight = 80 + long.x + long.width;
        result.longNumberSize = getComputedStyle(field('roi-number')).fontSize;
        result.longUnitSize = getComputedStyle(field('roi-unit')).fontSize;
        return result;
      } finally { host.remove(); }
    });
    assert.equal(typography.numberSize, typography.unitSize);
    assert(Math.abs(typography.numberY - typography.unitY) < .1);
    assert(Math.abs(typography.numberHeight - typography.unitHeight) < .1);
    assert.equal(typography.entry, '77,736.20'); assert.equal(typography.valuation, '78,526.70');
    assert.equal(typography.entryLabel, 'Цена Входа'); assert.equal(typography.openLabel, 'Рыночная цена');
    assert.equal(typography.closedLabel, 'Цена выхода');
    assert(typography.profitGap >= 20);
    assert(typography.longRoiRight <= 1000, 'Long ROI and its equal-size percent must fit together');
    assert.equal(typography.longNumberSize, typography.longUnitSize);
    report.checks.push({ name: `equal-percent-two-decimal-prices-${width}`, passed: true, typography });
    /* The preview is the card's own SVG now, not a rasterised PNG, so it can
       no longer be read as base64 bytes. The GUARANTEE is unchanged — preview
       and export must be one and the same frozen snapshot — and is checked
       where it now lives, in two halves that together say what the single
       byte comparison used to say:
         1. the preview really is this snapshot as the renderer draws it, and
         2. the downloaded PNG is that same snapshot rasterised.
       Both still come from the one privateResultCardSvg. */
    const previewSvg = await page.evaluate(async () => {
      const img = document.querySelector('dialog.private-card-dialog img');
      if (!img.src.startsWith('blob:')) throw new Error(`preview is not a blob SVG: ${img.src.slice(0, 40)}`);
      return (await fetch(img.src)).text();
    });
    assert.equal(previewSvg, await page.evaluate(() => window.__cardRenderer.privateResultCardSvg(window.__fixture)),
      'Preview must be the frozen snapshot exactly as the card renderer draws it');
    const preview = Buffer.from(await page.evaluate(async () => (await window.__cardRenderer.privateResultCardDataUrl(
      await window.__cardRenderer.privateResultCardPng(window.__fixture))).split(',')[1]), 'base64');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Сохранить PNG' }).click();
    const download = await downloadPromise;
    const target = path.join(out, `export-${width}.png`); await download.saveAs(target);
    const bytes = fs.readFileSync(target);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], exportSize,
      `downloaded PNG is ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
    assert.equal(bytes.compare(preview), 0, 'The downloaded PNG must be the previewed snapshot, rasterised');
    assert.equal(reads, 2, 'Actual export must authorize both rendering and delivery');
    assert.equal(download.suggestedFilename(), 'VOLTEX-BTCUSDT-historical.png');
    assert.deepEqual(errors, []);
    report.checks.push({ name: `actual-dialog-export-${width}`, passed: true, geometry, sha256: createHash('sha256').update(bytes).digest('hex') });
    // An additional clearly synthetic open-state example uses the real PNG renderer.
    const openImage = await page.evaluate(async () => window.__cardRenderer.privateResultCardDataUrl(
      await window.__cardRenderer.privateResultCardPng(Object.freeze({...window.__fixture,mode:'DEMO_LIVE',status:'OPEN',label:'Симуляция'})),
    ));
    fs.writeFileSync(path.join(out, `open-example-${width}.png`), Buffer.from(openImage.split(',')[1], 'base64'));
    // Revoke permission on the delivery check, after the authorized PNG has rendered.
    reads = 0; denyAt = 2;
    let leaked = false; const onDownload = () => { leaked = true; }; page.on('download', onDownload);
    await page.getByRole('button', { name: 'Сохранить PNG' }).click();
    await page.getByRole('alert').waitFor();
    await page.waitForFunction(() => window.__qaErrors.some(error => error.status === 403));
    assert.equal(reads, 2); assert.equal(leaked, false);
    report.checks.push({ name: `delivery-revocation-${width}`, passed: true });
    await context.close();
  }
  report.rendererSha256 = createHash('sha256').update(fs.readFileSync(path.join(frontend, 'src/lib/privateResultCard.ts'))).digest('hex');
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
});
