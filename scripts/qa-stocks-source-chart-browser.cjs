#!/usr/bin/env node
'use strict';
/**
 * Own-source (#615/#621) chart in the real hosted terminal, synthetic only.
 *
 * The production bundle built with VITE_STOCKS_CATALOGUE_VISIBLE=true is served
 * statically; the browser's Stocks reads are answered in-page with synthetic
 * versioned source pages. No gateway, database, provider, RPC or deployment.
 * Checked in Chromium at 1440 and 390, on the real GlobalChart (lightweight-charts):
 *   - an ACCEPTED 1m page with a gap draws the admitted candles, a visible raw-token
 *     marking and a readable gap warning (not painted over, not over the chart, its
 *     attribution or controls); a raw native bar riding the quote never appears;
 *   - valid UNKNOWN 1m/5m/1h envelopes draw no numbers, only the gap count;
 *   - the viewer's Buy stays silent: no POST of any kind reaches the Stocks API;
 *   - no data request leaves 127.0.0.1 (font stylesheet blocked) and the page raises no error.
 * The source pages are disposable fixtures; no real interval or market is claimed.
 *
 *   QA_STOCKS_DIST=<vite build with VITE_STOCKS_CATALOGUE_VISIBLE=true> node scripts/qa-stocks-source-chart-browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.QA_SOURCE_CHART_PORT || 4794);
const base = `http://127.0.0.1:${PORT}`;
const dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/stocks-source-chart-browser');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'hosted Stocks bundle, in-page synthetic source pages, no server authority', checks: [], failures: [],
  screenshots: [], stocksPosts: [], outbound: 0, outboundHosts: {}, apiAborted: 0, pageErrors: [] };

const MINT = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', POOL = '4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw';
const ID = `SOLANA:${MINT}:${POOL}`;
const STEP = { '1m': 60, '5m': 300, '1h': 3600 };
const T = Math.floor(Date.now() / 1000 / 3600) * 3600 - 7200; // aligned to every step, two hours back
const NATIVE_CLOSE = 7777.25; // a raw quote bar; it must never be drawn or printed
const SOURCE = { network: 'solana-mainnet-beta', program: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', mint: MINT, pool: POOL,
  quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
const GATES = { programIdentity: true, poolState: true, mintChronology: true, feeChronology: true, completeness: true, executionBinding: true };
const page1m = () => ({ schema: 'voltex.solana-ohlcv.v1', instrumentId: ID, interval: '1m', priceKind: 'raw-token', quoteCurrency: 'USDC',
  range: { from: T, to: T + 180 },
  candles: [{ time: T, open: 10, high: 12, low: 9, close: 11, volume: 4, tradeCount: 2, proofDigest: 'a'.repeat(64) },
    { time: T + 120, open: 11, high: 13.5, low: 10.5, close: 12.75, volume: 3, tradeCount: 1, proofDigest: 'c'.repeat(64) }],
  gaps: [{ time: T + 60, reason: 'UNKNOWN' }],
  provenance: { status: 'ACCEPTED', intervalComplete: true, finality: 'finalized', synthetic: false, acceptedTradeCount: 3,
    receiptsHash: 'b'.repeat(64), gates: GATES, source: SOURCE } });
const unknownPage = interval => ({ schema: 'voltex.solana-ohlcv.v1', instrumentId: ID, interval, priceKind: 'raw-token', quoteCurrency: 'USDC',
  range: { from: T, to: T + STEP[interval] }, candles: [], gaps: [{ time: T, reason: 'UNKNOWN' }],
  provenance: { status: 'UNKNOWN', intervalComplete: false, finality: 'finalized', synthetic: false, acceptedTradeCount: 0,
    receiptsHash: 'b'.repeat(64), gates: GATES, source: SOURCE } });
function viewerState() {
  const timestamp = Date.now();
  return {
    schema: 2, revision: 1, token: 'fixture-csrf', serverTime: timestamp,
    account: { id: 'fixture-viewer', mode: 'viewer', canTrade: false, fundingMode: 'existing-only' },
    catalogue: [{ id: ID, ticker: 'XSTOCK', asset: 'XSTOCK', name: 'Synthetic source token', provider: 'solana', sourceSymbol: 'XSTOCK',
      region: 'US', kind: 'token', currency: 'USDC', delaySeconds: 0, timeframes: ['1m', '5m', '1h'] }],
    wallets: { USDT: { cash: '0', reserved: '0', available: '0' }, USDC: { cash: '0', reserved: '0', available: '0' } },
    positions: {}, orders: [], fills: [], realized: { USDT: '0', USDC: '0' }, adjustments: [], errors: {},
    metrics: { rssBytes: 0, requests: 0, cacheHits: 0 }, readiness: {},
    quotes: { [ID]: { instrumentId: ID, provider: 'solana', nativeCurrency: 'USDC', timestamp, receivedAt: timestamp, bid: '10.4', ask: '10.6',
      last: '10.5', multiplier: null, change24h: 0, volume: '1', transport: 'websocket',
      nativeCandles: Object.fromEntries(Object.keys(STEP).map(i => [i, { time: T + 600, open: NATIVE_CLOSE, high: NATIVE_CLOSE, low: NATIVE_CLOSE, close: NATIVE_CLOSE, volume: 1 }])),
      // Raw USDC token data never becomes a USDT execution price or trading readiness.
      prices: {}, status: { USDT: 'SOURCE_UNAVAILABLE', USDC: 'SOURCE_UNAVAILABLE' }, fx: {} } },
  };
}

async function step(name, fn) {
  try { await fn(); report.checks.push(name); console.log('✓ ' + name); }
  catch (error) { report.failures.push({ name, error: String(error.stack || error).slice(0, 1500) }); console.log('✗ ' + name + ' — ' + String(error.message || error).slice(0, 400)); }
}
// The gap warning must be readable where it is drawn: rendered, inside the viewport, topmost at its
// corners and centre (nothing paints over it), text not clipped, and not overlapping the chart, the
// chart attribution or any chart control. The raw-token marking must be visibly rendered.
async function assertReadableSourceMarks(page, gaps) {
  const found = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const warning = document.querySelector('.vxg-chart-warning');
    const label = [...document.querySelectorAll('.vxg-chart-section span')].some(e => /Цена токена/.test(e.textContent) && e.checkVisibility());
    if (!warning) return { label };
    const b = box(warning), inset = 2;
    const points = [[b.left + inset, b.top + inset], [b.right - inset, b.top + inset], [b.left + inset, b.bottom - inset], [b.right - inset, b.bottom - inset], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]];
    const covered = points.filter(([x, y]) => !warning.contains(document.elementFromPoint(x, y))).length;
    const others = ['#tv-attr-logo', '.vxg-plot', '.vxg-timeframes button', '.vxg-chart-tools select', '.vxg-chart-tools button', '.vxg-pro-chart-rail button']
      .flatMap(selector => [...document.querySelectorAll(selector)].filter(e => e.checkVisibility()).map(e => ({ selector, r: box(e) })));
    const overlaps = others.filter(({ r }) => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom).map(o => o.selector);
    return { label, text: warning.textContent.trim(), visible: warning.checkVisibility(), covered, overlaps,
      inViewport: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && b.width > 0 && b.height > 0,
      clipped: warning.scrollWidth > warning.clientWidth || warning.scrollHeight > warning.clientHeight };
  });
  assert.equal(found.label, true, 'the raw-token marking «Цена токена» is not visibly rendered');
  assert.equal(found.text, `Пробелы в данных: ${gaps}`);
  assert.equal(found.visible, true, 'the gap warning is not rendered');
  assert.equal(found.inViewport, true, 'the gap warning is outside the viewport');
  assert.equal(found.covered, 0, `the gap warning is painted over at ${found.covered} of 5 points`);
  assert.deepEqual(found.overlaps, [], 'the gap warning overlaps the chart, its attribution or a chart control');
  assert.equal(found.clipped, false, 'the gap warning text is clipped');
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

(async () => {
  assert(fs.existsSync(path.join(dist, 'index.html')), `no bundle in ${dist}`);
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, base).pathname);
    let file = path.join(dist, path.normalize(clean).replace(/^([/\\])+/, ''));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const tag = viewport.width;
      const context = await browser.newContext({ viewport });
      await context.addInitScript(() => localStorage.setItem('exchange_token', 'synthetic-viewer-session'));
      let revoked = false; // a corrected range later revokes the ACCEPTED 1m page
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname !== '127.0.0.1') { report.outbound++; report.outboundHosts[url.hostname] = (report.outboundHosts[url.hostname] || 0) + 1; return route.abort(); }
        if (url.pathname.startsWith('/__stocks_global/')) {
          if (request.method() === 'POST') { report.stocksPosts.push(url.pathname); return route.abort(); }
          const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
          if (url.pathname.endsWith('/state')) return json(viewerState());
          if (url.pathname.endsWith('/history')) {
            const interval = url.searchParams.get('interval');
            if (url.searchParams.get('id') !== ID || !STEP[interval]) return json({ candles: [] });
            return json(interval === '1m' && !revoked ? page1m() : unknownPage(interval));
          }
          return route.fulfill({ status: 204, body: '' });
        }
        // The rest of VOLTEX (profile, notifications) is not part of this fixture.
        if (url.port !== String(PORT)) { report.apiAborted++; return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.pageErrors.push(`${tag}: ${String(error.message || error).slice(0, 300)}`));
      const text = () => page.evaluate(() => document.body.innerText);
      const shot = async name => { const file = path.join(out, `${name}-${tag}.png`); await page.screenshot({ path: file }); report.screenshots.push(path.basename(file)); };

      await page.goto(`${base}/stocks/${encodeURIComponent(ID)}`);
      await page.waitForSelector('.vxg-terminal', { timeout: 20000 });
      await step(`${tag}: ACCEPTED 1m page with a gap — admitted candles, raw-token label, gap count, no native bar`, async () => {
        await page.locator('.vxg-timeframes button', { hasText: /^1m$/ }).click();
        await page.waitForSelector('.vxg-chart-warning', { timeout: 15000 });
        await page.waitForFunction(() => !document.querySelector('.vxg-chart-overlay'), null, { timeout: 15000 });
        await assertReadableSourceMarks(page, 1);
        assert((await page.locator('.vxg-plot canvas').count()) > 0, 'the real chart canvas is missing');
        assert(!/7[\s ]?777/.test(await text()), 'a raw native quote bar value reached the page');
        await page.waitForTimeout(3500); // one more quote poll carrying the native bar
        assert(!/7[\s ]?777/.test(await text()), 'a raw native quote bar value reached the page after a poll');
        assert.equal(await page.locator('.vxg-chart-overlay').count(), 0);
        await shot('source-1m-accepted');
      });
      for (const interval of ['5m', '1h', '1m']) {
        await step(`${tag}: valid UNKNOWN ${interval} envelope — no numbers, gap count only`, async () => {
          if (interval === '1m') revoked = true;
          if (interval === '1m') {
            await page.locator('.vxg-timeframes button', { hasText: /^5m$/ }).click();
            await page.locator('.vxg-timeframes button', { hasText: /^1m$/ }).click();
          } else await page.locator('.vxg-timeframes button', { hasText: new RegExp(`^${interval}$`) }).click();
          await page.waitForSelector('.vxg-chart-overlay', { timeout: 15000 });
          await assertReadableSourceMarks(page, 1);
          await page.waitForTimeout(3500);
          assert.equal(await page.locator('.vxg-chart-overlay').count(), 1, 'numbers appeared for an UNKNOWN envelope');
          assert(!/7[\s ]?777/.test(await text()), 'a raw native quote bar value reached the page');
          await shot(`source-${interval}-unknown${interval === '1m' ? '-revoked' : ''}`);
        });
      }
      await step(`${tag}: the viewer's Buy stays silent`, async () => {
        if (tag === 390) await page.locator('.vxg-mobile-tabs button', { hasText: 'Торговля' }).click();
        const before = report.stocksPosts.length;
        await page.locator('.vxg-ticket input[aria-label="Количество"]').fill('1');
        await page.locator('.vxg-submit').click();
        await page.locator('.vxg-ticket input[aria-label="Количество"]').press('Enter');
        await page.waitForTimeout(1000);
        assert.equal(report.stocksPosts.length, before, 'a POST reached the Stocks API');
        assert.equal(await page.locator('.vxg-ticket .vxg-success').count(), 0);
      });
      await context.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  await step('no POST, no outbound data request, no page error', async () => {
    assert.deepEqual(report.stocksPosts, []);
    // As in qa-stocks-hosted-browser.cjs: the app's font stylesheet is blocked and recorded, never data.
    const hosts = Object.keys(report.outboundHosts).filter(host => !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
    assert.deepEqual(hosts, [], JSON.stringify(report.outboundHosts));
    assert.deepEqual(report.pageErrors, []);
  });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.checks.length} passed, ${report.failures.length} failed; report: ${path.join(out, 'report.json')}`);
  if (report.failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
