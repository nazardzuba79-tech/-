/**
 * The Futures header carries ONE secondary reference price.
 *
 * The strip showed the mark and the index side by side, and at a glance they
 * are the same number — they diverge by a few ticks — so the pair read as
 * noise in the row a trader scans most often. The mark is what a position is
 * marked against, so the mark is the figure that keeps the slot.
 *
 * This checks the presentation claim and the thing a removal most often
 * breaks: that taking content out did not leave a hole, move a neighbour, or
 * introduce an overflow on a phone. Measured at the four widths the owner
 * named, including 390x844.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.QA_PORT || 4391);
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '../docs/qa/futures-header'));
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
];
const PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
/** Mark and index DELIBERATELY DIFFER, so "the index is gone" cannot pass by
 *  accident on two equal numbers. */
const MARK = '84887.45';
const INDEX = '84123.99';

const app = express();
app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: PAIRS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 25, leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }] }));
app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: PAIRS.map((pair) => ({ symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'linear_perpetual', baseAsset: pair.split('/')[0], quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ tickers: PAIRS.map((pair) => ({ pair, lastPrice: 84890.1, high24h: 85954.6, low24h: 83535, changePercent: 1.25, quoteVolume24h: 3.19e9, volume24h: 15000 })) }));
app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ symbols: PAIRS }));
app.get('/api/v1/futures/mark-price/:symbol', (_q, r) => r.json({ symbol: 'BTCUSDT', markPrice: MARK, indexPrice: INDEX }));
app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json({ history: [{ rate: '0.0001', markPrice: MARK, indexPrice: INDEX, appliedAt: new Date().toISOString() }] }));
app.get('/api/v1/futures/open-interest/:symbol', (_q, r) => r.json({ available: true, value: { openInterestBase: 30894.9176 } }));
app.get('/api/v1/market/derivatives/:asset', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: { turnover24hUsd: 3.19e9, openInterestBase: 30894.9176, openInterestUsd: 9.2e8 } }));
app.get('/api/v1/wallet/overview', (_q, r) => r.json({ balances: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 84890 }));
app.get('/api/v1/futures/positions', (_q, r) => r.json([]));
app.get('/api/v1/futures/orders', (_q, r) => r.json([]));
app.get('/api/v1/market/live', (_q, r) => { r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); r.write(': open\n\n'); });
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (_q, r) => r.sendFile(path.join(__dirname, '../frontend/dist/index.html')));

const findings = [];
const finding = (m) => { findings.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
  const server = app.listen(PORT);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const report = { viewports: {} };
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n=== ${vp.name} ===`);
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      // The app's own key, not a guess: see qa-futures-layout.cjs.
      await context.addInitScript(() => { try { localStorage.setItem('exchange_token', 'local-qa'); localStorage.setItem('exchange_lang', 'ru'); } catch {} });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(1800);
      const m = await page.evaluate(({ mark, index }) => {
        const bar = document.querySelector('.futures-ticker-bar, .ticker-bar');
        if (!bar) return null;
        const doc = document.documentElement;
        return {
          markShown: bar.textContent.includes(mark.replace(/(\d)(?=(\d{3})+\.)/g, '$1,')) || bar.textContent.includes('84,887.45'),
          indexShown: bar.textContent.includes('84,123.99'),
          indexNode: !!bar.querySelector('[data-metric="index"]'),
          slash: /\d\s*\/\s*\d/.test(bar.textContent),
          cells: [...bar.querySelectorAll('.ticker-item')].length,
          labels: [...bar.querySelectorAll('.ticker-item .label')].map((n) => n.textContent.trim()),
          barWidth: Math.round(bar.getBoundingClientRect().width),
          barScrollWidth: Math.round(bar.scrollWidth),
          pageOverflow: Math.round(doc.scrollWidth - doc.clientWidth),
        };
      }, { mark: MARK, index: INDEX });
      report.viewports[vp.name] = m;
      if (!m) { finding(`${vp.name}: no ticker bar rendered`); await context.close(); continue; }

      if (!m.markShown) finding(`${vp.name}: the mark price is not on the strip`);
      else ok('mark price is on the strip');
      if (m.indexShown || m.indexNode) finding(`${vp.name}: the index price is still in the header (text=${m.indexShown}, node=${m.indexNode})`);
      else ok('no index price anywhere in the header');
      if (m.slash) finding(`${vp.name}: a "number / number" pair is still rendered in the header`);
      else ok('no paired "mark / index" figure left');

      // THE PAGE must never scroll sideways. This is the hard floor, and it
      // is the one that matters on a phone.
      if (m.pageOverflow > 0) finding(`${vp.name}: the page overflows horizontally by ${m.pageOverflow}px`);
      else ok('no horizontal page overflow');

      // THE STRIP ITSELF is a deliberate horizontal scroller — `.ticker-bar`
      // carries `overflow-x:auto` with a hidden scrollbar, so a scroll extent
      // wider than its box is its normal state at narrow widths, not a fault.
      // Demanding zero here would fail a design that has always been this
      // way. What a content REMOVAL must guarantee is that the extent does
      // not GROW, so it is measured against the figures recorded on
      // unmodified main with the very same harness and stubs:
      //
      //   1920  fits           1440  175px   1366  231px   390  875px
      //
      // Anything at or under those is the change doing what it claims.
      const BASELINE = { '1920x1080': 0, '1440x900': 175, '1366x768': 231, '390x844': 875 };
      const over = Math.max(0, m.barScrollWidth - m.barWidth);
      const was = BASELINE[vp.name];
      if (over > was) finding(`${vp.name}: the strip's scroll extent GREW, ${was}px -> ${over}px`);
      else if (over === 0) ok(`the strip fits its box (${m.barWidth}px), as it did before`);
      else ok(`strip scroll extent ${was}px -> ${over}px (${was - over}px narrower; it scrolls by design)`);
      ok(`${m.cells} cells: ${m.labels.filter(Boolean).join(' | ') || '(labels are visual-only here)'}`);

      await page.screenshot({ path: path.join(OUT, `${vp.name}-header.png`), clip: { x: 0, y: 0, width: vp.width, height: Math.min(260, vp.height) } });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  report.status = findings.length ? 'FAIL' : 'PASS';
  report.findings = findings;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSTATUS: ${report.status}`);
  console.log(`FINDINGS: ${JSON.stringify(findings, null, 2)}`);
  console.log(`evidence: ${OUT}`);
  process.exit(findings.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
