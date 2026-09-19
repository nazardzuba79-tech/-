'use strict';
/** The Futures top-left instrument cluster, measured in a real browser.
 *
 * The brief's acceptance list is geometric, so this measures rather than
 * looks: the mark's size, whether the three parts sit in one node with its
 * own gaps, whether the two text lines are optically centred on the mark,
 * and whether anything drifts off a shared vertical centre.
 *
 * It also opens /trade, because `.pair-selector`, `.pair-name` and
 * `.pair-markets-btn` are shared with the Spot terminal: the new styles are
 * scoped to `.futures-reference`, and that claim is worth nothing unmeasured.
 *
 *   node scripts/qa-futures-topbar-cluster.cjs [--label after]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4390'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-topbar-cluster')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1920,1664,1440,1366,390')).split(',').map(Number);

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  const ok = (body) => (_q, r) => r.json(body);
  app.get('/api/v1/me', ok({ id: 'qa', email: 'qa@example.invalid', displayName: 'QA',
    avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false,
    createdAt: '2026-01-01T00:00:00Z' }));
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history',
    '/api/v1/futures/orders/me', '/api/v1/balances', '/api/v1/futures/balances'], ok([]));
  app.get('/api/v1/private-trading/access', ok({ allowed: false, mode: 'ORDINARY', reason: null }));
  app.get('/api/v1/support/conversations/mine', ok({ conversation: null }));
  // The asset catalogue: real shape, real names for the symbols this page
  // shows. Nothing here invents a price or a statistic.
  app.get('/api/v1/market/assets/icons', (q, r) => {
    const names = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB' };
    // The real shape: a map keyed by symbol, not a list. See api.getAssetIcons.
    const asked = String(q.query.symbols || '').split(',').filter(Boolean);
    const assets = {};
    for (const raw of asked) {
      const symbol = raw.toUpperCase();
      if (names[symbol]) assets[symbol] = { id: `cg:${symbol.toLowerCase()}`, name: names[symbol], logoUrl: null };
    }
    r.json({ assets });
  });
  app.use('/api/v1', (_q, r) => r.status(404).json({ error: 'not part of this QA' }));
  app.use(express.static(DIST, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}
const waitForServer = () => new Promise((resolve, reject) => {
  const tick = (n) => http.get(`http://127.0.0.1:${PORT}/index.html`, res => { res.resume(); resolve(); })
    .on('error', () => n > 0 ? setTimeout(() => tick(n - 1), 120) : reject(new Error('server')));
  tick(50);
});

/** Everything the acceptance list asks about, read off the live DOM. */
const measure = (page, root) => page.evaluate((rootSel) => {
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height),
      cy: Math.round((r.top + r.bottom) / 2) }; };
  const bar = document.querySelector(rootSel);
  if (!bar) return null;
  const cluster = bar.querySelector('.pair-cluster');
  const btn = bar.querySelector('.pair-markets-btn');
  const selector = bar.querySelector('.pair-selector');
  // The mark is the selector's first child whatever tier the icon pipeline
  // resolved to — an <img> when a logo loaded, a coloured initial <div>
  // when it did not. Measuring only `img` reported "no icon" for the
  // perfectly valid fallback.
  const icon = selector && selector.firstElementChild;
  const name = bar.querySelector('.pair-name');
  const asset = bar.querySelector('.pair-asset');
  const arrow = bar.querySelector('.pair-arrow');
  // The first statistic after the cluster: the gap between the cluster and
  // it is what should be LARGE, while the gaps inside stay small.
  const firstStat = bar.querySelector('.futures-primary-price, .ticker-item');
  const cs = el => el ? getComputedStyle(el) : null;
  return {
    hasCluster: !!cluster,
    bar: box(bar),
    cluster: box(cluster), btn: box(btn), selector: box(selector),
    icon: box(icon), name: box(name), asset: box(asset), arrow: box(arrow),
    firstStat: box(firstStat),
    iconSize: icon ? (() => { const r = icon.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`; })() : null,
    nameFont: cs(name) && { size: cs(name).fontSize, weight: cs(name).fontWeight },
    assetFont: cs(asset) && { size: cs(asset).fontSize, color: cs(asset).color },
    assetText: asset ? asset.textContent.trim() : null,
    nameText: name ? name.textContent.trim() : null,
    clusterGap: cs(cluster) ? cs(cluster).gap : null,
    barGap: cs(bar) ? cs(bar).gap : null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}, root);

let server, browser;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  server = start();
  const report = {};
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 940 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const view = report[width] = {};
      view.futures = await measure(page, '.futures-ticker-bar');
      view.pageErrors = pageErrors;
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-futures.png`) });
      const cluster = await page.$('.futures-ticker-bar .pair-cluster')
        ?? await page.$('.futures-ticker-bar .pair-selector');
      if (cluster) await cluster.screenshot({ path: path.join(OUT, `${LABEL}-${width}-cluster.png`) }).catch(() => {});
      // The whole header strip, so the cluster can be judged in context.
      const bar = await page.$('.futures-ticker-bar');
      if (bar) await bar.screenshot({ path: path.join(OUT, `${LABEL}-${width}-bar.png`) }).catch(() => {});
      await context.close();
    }

    // Spot, at one width: the shared classes must be untouched.
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
      const page = await context.newPage();
      const spotErrors = [];
      page.on('pageerror', e => spotErrors.push(String(e)));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/trade`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const spot = report.spot = await measure(page, '.ticker-bar');
      if (spot) spot.pageErrors = spotErrors;
      spot.root = await page.evaluate(() => document.querySelector('.trade-terminal')?.className ?? null);
      await page.screenshot({ path: path.join(OUT, `${LABEL}-spot-1440.png`) });
      await context.close();
    }

    if (!MEASURE_ONLY) {
      for (const width of WIDTHS) {
        const v = report[width], f = v.futures, tag = `${width}px`;
        assert.deepEqual(v.pageErrors, [], `${tag}: page errors ${v.pageErrors.join(' | ')}`);
        assert.ok(f, `${tag}: no futures ticker bar`);
        assert.equal(f.hasCluster, true, `${tag}: the three parts are not inside one cluster`);
        // 1. The mark is noticeably bigger than the 20px it was.
        assert.ok(f.icon.width >= 26, `${tag}: the asset mark is ${f.iconSize}, not larger`);
        // 2. One node: the button, the mark and the text all inside it.
        assert.ok(f.btn.left >= f.cluster.left - 1 && f.arrow.right <= f.cluster.right + 1,
          `${tag}: a part sits outside the cluster`);
        // 3. The gaps INSIDE are tighter than the gap to the first statistic.
        const inner = f.selector.left - f.btn.right;
        const outer = f.firstStat.left - f.cluster.right;
        assert.ok(inner <= 14, `${tag}: the button-to-mark gap is ${inner}px, not tight`);
        assert.ok(outer > inner, `${tag}: the cluster does not read as a block (inner ${inner}, outer ${outer})`);
        // 4. Optical centres agree — no baseline drift.
        for (const [key, el] of [['btn', f.btn], ['icon', f.icon], ['arrow', f.arrow]]) {
          assert.ok(Math.abs(el.cy - f.cluster.cy) <= 2,
            `${tag}: ${key} centre is ${el.cy} against the cluster's ${f.cluster.cy}`);
        }
        // 5. The identity is two real lines, the second one the asset's name.
        assert.ok(f.asset, `${tag}: no asset caption`);
        assert.ok(f.name.bottom <= f.asset.top + 2, `${tag}: the two lines are not stacked`);
        assert.equal(f.assetText, 'Bitcoin', `${tag}: the caption reads ${JSON.stringify(f.assetText)}`);
        assert.ok(parseFloat(f.nameFont.size) >= 16, `${tag}: the pair is ${f.nameFont.size}`);
        // 6. Nothing overflows.
        assert.equal(f.overflowX, 0, `${tag}: ${f.overflowX}px of horizontal overflow`);
      }
      // SPOT IS UNTOUCHED.
      //
      // Worth stating precisely, because the obvious check is wrong: Spot's
      // `.pair-selector` has no asset mark at all — it is `.pair-name` plus
      // `.pair-arrow` and nothing else (see components/TickerBar.tsx). So
      // "the mark did not grow" is not a claim that can be made about Spot;
      // what CAN be measured is that none of the new structure reached it
      // and that its pair type is still the shared 15px.
      const spot = report.spot;
      assert.ok(!/futures-reference/.test(spot.root ?? ''), `spot: the Futures hook reached Spot`);
      assert.equal(spot.hasCluster, false, 'spot: the Futures cluster leaked into Spot');
      assert.equal(spot.asset, null, 'spot: the Futures asset caption leaked into Spot');
      assert.equal(spot.nameFont.size, '15px', `spot: its pair type changed to ${spot.nameFont.size}`);
      assert.equal(spot.overflowX, 0, `spot: ${spot.overflowX}px of horizontal overflow`);
      assert.deepEqual(spot.pageErrors, [], `spot: page errors ${spot.pageErrors.join(' | ')}`);
    }

    fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`),
      JSON.stringify({ status: MEASURE_ONLY ? 'MEASURED' : 'PASS', label: LABEL, report }, null, 2));
    console.log(JSON.stringify({
      status: MEASURE_ONLY ? 'MEASURED' : 'PASS',
      perWidth: Object.fromEntries(WIDTHS.map(w => {
        const f = report[w]?.futures ?? {};
        return [w, { cluster: f.hasCluster, icon: f.iconSize, pair: f.nameFont?.size,
          pairWeight: f.nameFont?.weight, caption: f.assetText, captionSize: f.assetFont?.size,
          innerGap: f.selector && f.btn ? f.selector.left - f.btn.right : null,
          outerGap: f.firstStat && f.cluster ? f.firstStat.left - f.cluster.right : null,
          clusterHeight: f.cluster?.height, overflowX: f.overflowX,
          errors: report[w]?.pageErrors?.length ?? 0 }];
      })),
      spot: { cluster: report.spot?.hasCluster, pair: report.spot?.nameFont?.size,
        caption: report.spot?.assetText, selector: report.spot?.selector },
    }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    server?.close();
  }
})().catch(e => { console.error(e.message || e); process.exitCode = 1; });
