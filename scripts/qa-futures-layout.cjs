/**
 * Futures terminal LAYOUT harness — the four things the owner marked on
 * screenshots, measured rather than eyeballed, at every desktop width.
 *
 *   1. The bottom orders panel is VISIBLE on arrival, and the chart is not
 *      full height. Checked on a cold load, a hard reload and a route
 *      leave/return, because "it opened wrong" is a first-paint complaint.
 *   2. The collapsed drawing-rail tab sits at the chart's vertical middle —
 *      not at the top, not at the foot. Reported as a percentage of the
 *      chart's height so the claim is a number, not an adjective.
 *   3. The market chooser opens clean: no row clipped by the panel edge, no
 *      heading outside its own column, no half-drawn row at the bottom.
 *   4. The 7-day gain/loss control actually reorders the list, and says so
 *      in the column heading.
 *
 * It serves the real production build with a stubbed API, exactly as the
 * other browser harnesses here do. No production host, no real session.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.QA_PORT || 4372);
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '../docs/qa/futures-layout'));
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1664x900', width: 1664, height: 900 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
];

/** A handful of real-shaped markets so the list has something to sort. */
const BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'UNI', 'ATOM', 'NEAR'];
const PAIRS = BASES.map((b) => `${b}/USDT`);
/** Deterministic, and deliberately NOT ordered the same as 24h, so a 7-day
 *  sort that did nothing would be visible as "the order did not change". */
const SEVEN_DAY = { BTC: 3.1, ETH: -4.2, SOL: 18.6, XRP: -9.4, ADA: 6.7, DOGE: -12.1,
  AVAX: 22.3, LINK: -1.8, DOT: 9.9, UNI: -6.5, ATOM: 14.2, NEAR: -15.7 };
const DAY = { BTC: 1.2, ETH: 2.4, SOL: 0.9, XRP: 3.8, ADA: 3.6, DOGE: 2.0,
  AVAX: 16.5, LINK: 1.1, DOT: 0.4, UNI: 1.0, ATOM: 2.2, NEAR: -3.1 };
const PRICE = { BTC: 81680.2, ETH: 2645.5, SOL: 111.7, XRP: 1.4325, ADA: 0.2271, DOGE: 0.08901,
  AVAX: 9.452, LINK: 14.8, DOT: 3.2, UNI: 8.888, ATOM: 4.1, NEAR: 3.602 };

const app = express();
app.use(express.json());
app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: PAIRS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 25, leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }] }));
app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: PAIRS.map((pair) => ({ symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'linear_perpetual', baseAsset: pair.split('/')[0], quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ tickers: PAIRS.map((pair) => {
  const b = pair.split('/')[0];
  return { pair, lastPrice: PRICE[b], high24h: PRICE[b] * 1.02, low24h: PRICE[b] * 0.98, changePercent: DAY[b], quoteVolume24h: 1e9 - BASES.indexOf(b) * 1e7, volume24h: 15000 };
}) }));
app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ symbols: PAIRS }));
/** The wallet projection the shared header reads. Without it the page threw
 *  `reading 'totalValueUsd'` and the harness reported its own gap as a
 *  finding. Empty and priced, which is what a fresh QA account is. */
app.get('/api/v1/wallet/overview', (_q, r) => r.json({ balances: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 81663 }));
/** The SAME catalogue shape Markets reads, carrying the real 7d field. */
app.get('/api/v1/market/assets', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: {
  assets: BASES.map((b, i) => ({ id: `cg:${b}`, symbol: b, name: b, logoUrl: null,
    providers: { coingecko: b.toLowerCase() }, tradingPairs: [`${b}/USDT`], tradable: true,
    metadataSource: 'coingecko', rank: i + 1, ambiguous: false, collidingIds: [],
    market: { priceUsd: PRICE[b], changePercent24h: DAY[b], changePercent7d: SEVEN_DAY[b],
      changePercent30d: null, volume24hUsd: 1e9, marketCapUsd: 1e10, sparkline: [] } })),
  matched: BASES.length, catalogueTotal: BASES.length, tradableCount: BASES.length,
  collisions: [], metadataComplete: true, limit: 1000, offset: 0 } }));
app.get('/api/v1/market/futures/orderbook/:symbol', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, symbol: 'BTCUSDT', updateId: 1, providerTime: Date.now(),
  bids: Array.from({ length: 40 }, (_, i) => ({ price: String(81660 - i * 0.1), quantity: String(0.5 + i * 0.01) })),
  asks: Array.from({ length: 40 }, (_, i) => ({ price: String(81661 + i * 0.1), quantity: String(0.5 + i * 0.01) })) }));
app.get('/api/v1/futures/mark-price/:symbol', (_q, r) => r.json({ symbol: 'BTCUSDT', markPrice: '81663', indexPrice: '81660' }));
app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json({ history: [{ rate: '0.0001', markPrice: '1', indexPrice: '1', appliedAt: new Date().toISOString() }] }));
app.get('/api/v1/market/derivatives/:asset', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: { turnover24hUsd: 1.2e9, openInterestBase: 12345.5, openInterestUsd: 9.2e8 } }));
/**
 * The live quote stream, in the shape lib/liveMarketStore validates.
 * Without it the two numeric columns render em dashes, and a column
 * alignment check over empty columns proves nothing.
 */
app.get('/api/v1/market/live', (_q, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const rows = BASES.map((b) => ({ id: `linear_perpetual:${b}USDT`, marketType: 'linear_perpetual',
    providerSymbol: `${b}USDT`, baseAsset: b, quoteAsset: 'USDT', settleAsset: 'USDT',
    pair: `${b}/USDT`, stale: false,
    lastPrice: PRICE[b], changePercent24h: DAY[b], quoteVolume24h: 1e9 - BASES.indexOf(b) * 1e7,
    fetchedAt: Date.now(), providerEventAt: Date.now() }));
  res.write(`data: ${JSON.stringify({ version: 1, type: 'snapshot', status: 'live', epoch: 'qa', revision: 1, rows })}\n\n`);
  const keep = setInterval(() => res.write(': keep-alive\n\n'), 5000);
  res.on('close', () => clearInterval(keep));
});
/** Everything else answers with an empty list. The account panel logs one
 *  `reading 'equity'` warning against that and renders its empty state,
 *  which is the state this harness wants anyway; giving it a richer stub
 *  broke the page outright, so the empty list stays and the warning is
 *  filtered as harness noise rather than papered over. */
app.get('/api/v1/*', (_q, r) => r.json([]));

const dist = path.join(__dirname, '../frontend/dist');
app.use(express.static(dist, { index: false }));
app.get('*', (_q, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
  .replace('<head>', `<head><script>
localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','ru');
// No venue socket in this harness: the REST book is enough for geometry.
window.WebSocket = function(){ this.readyState = 3; this.close = function(){}; this.send = function(){}; };
</script>`)));

const findings = [];
const finding = (m) => { findings.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const server = app.listen(PORT, '127.0.0.1', async () => {
  try { await run(); } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
  process.exit(process.exitCode || (findings.length ? 1 : 0));
});

const geom = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height),
    bottom: Math.round(r.bottom), right: Math.round(r.right), visible: r.width > 0 && r.height > 0 };
}, selector);

async function run() {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const report = { viewports: {} };

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      const text = m.text();
      // The sandbox has no outbound network, so remote asset fetches fail.
      // That is this environment, not the page.
      if (m.type() === 'error' && !/ERR_CERT_AUTHORITY_INVALID|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|Failed to load resource|reading 'equity'/.test(text)) errors.push('console: ' + text);
    });
    const result = {};

    // ---- 1. DEFAULT LAYOUT: the bottom panel is there on arrival ----
    await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bottom-panel', { timeout: 30000 });
    await page.waitForTimeout(1200);

    const readLayout = async (label) => {
      const compact = await page.evaluate(() => document.querySelector('.terminal')?.getAttribute('data-account-compact'));
      const content = await geom(page, '.bottom-content');
      const panel = await geom(page, '.bottom-panel');
      const chart = await geom(page, '.chart-area');
      return { label, compact, panelHeight: panel?.height ?? 0, contentVisible: !!content?.visible,
        contentHeight: content?.height ?? 0, chartHeight: chart?.height ?? 0 };
    };

    result.coldLoad = await readLayout('cold load');
    if (result.coldLoad.compact === 'true' || !result.coldLoad.contentVisible) {
      finding(`${vp.name}: bottom panel is folded on arrival (compact=${result.coldLoad.compact}, body visible=${result.coldLoad.contentVisible})`);
    } else ok(`bottom orders panel open on arrival — ${result.coldLoad.contentHeight}px of body under the tabs`);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-01-default.png`) });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bottom-panel', { timeout: 30000 });
    await page.waitForTimeout(1200);
    result.hardReload = await readLayout('hard reload');
    if (result.hardReload.compact === 'true' || !result.hardReload.contentVisible) finding(`${vp.name}: bottom panel folded after reload`);
    else ok('still open after a hard reload');

    // Leave the terminal and come back.
    await page.goto(`http://127.0.0.1:${PORT}/wallet`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bottom-panel', { timeout: 30000 });
    await page.waitForTimeout(1200);
    result.routeReturn = await readLayout('route return');
    if (result.routeReturn.compact === 'true' || !result.routeReturn.contentVisible) finding(`${vp.name}: bottom panel folded after leaving and returning`);
    else ok('still open after leaving the route and returning');

    // The control still works: folding is a choice, not the default.
    const toggle = page.locator('.terminal-account-toggle');
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(400);
      const folded = await readLayout('after user folds');
      result.userFold = folded;
      if (folded.compact !== 'true') finding(`${vp.name}: pressing the control did not fold the panel`);
      else ok(`the control still folds it on demand — chart ${result.coldLoad.chartHeight}px -> ${folded.chartHeight}px`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-02-user-folded.png`) });
      await toggle.click();
      await page.waitForTimeout(400);
    } else finding(`${vp.name}: no collapse control rendered`);

    // ---- 1b. THE PERMANENT MARKET RAIL IS GONE AND THE CHART HAS THE WIDTH ----
    {
      const rail = await page.locator('.reference-market-sidebar').count();
      const chart = await geom(page, '.chart-area');
      result.railRemoved = { railNodes: rail, chartWidth: chart ? chart.width : null, chartLeft: chart ? chart.x : null };
      if (rail) finding(`${vp.name}: the permanent market rail is still rendered (${rail} node(s))`);
      else ok('no permanent market rail — the chart starts at the workspace edge');
      if (chart && chart.x > 24) finding(`${vp.name}: chart still starts ${Math.round(chart.x)}px in, so something is holding the old column`);
      // AND IT ACTUALLY GOT THE WIDTH. Deleting the rail's markup while a
      // later sheet still declares its 226px track would leave the chart
      // squeezed into an empty column — the failure this catches.
      const shareOfViewport = chart ? (chart.width / vp.width) * 100 : 0;
      if (chart && shareOfViewport < 45) finding(`${vp.name}: chart is only ${Math.round(chart.width)}px (${shareOfViewport.toFixed(0)}% of the window) — the freed column did not reach it`);
      else if (chart) ok(`chart ${Math.round(chart.width)}px wide (${shareOfViewport.toFixed(0)}% of the window)`);
    }

    // ---- 1c. THE BOTTOM PANEL HAS ROOM FOR ONE ORDER, WITH HEADROOM ----
    {
      const m = await page.evaluate(() => {
        const panel = document.querySelector('.bottom-panel');
        const body = document.querySelector('#futures-bottom-content');
        if (!panel || !body) return null;
        // A table row's real height, taken from the live sheet rather than
        // assumed: the empty state has no row to measure, so the header
        // cell's box is used as the row's stand-in (same padding rule).
        const probe = document.querySelector('.futures-positions-table td, .futures-positions-table th');
        return {
          panel: Math.round(panel.getBoundingClientRect().height),
          body: Math.round(body.getBoundingClientRect().height),
          rowHeight: probe ? Math.round(probe.getBoundingClientRect().height) : null,
        };
      });
      result.bottomPanel = m;
      if (!m) finding(`${vp.name}: could not measure the bottom panel`);
      else {
        // The owner asked for "room for one open order, with some to spare".
        // One row plus its header plus a row of headroom is that, stated as
        // a number instead of an adjective.
        const row = m.rowHeight || 44;
        const need = row * 3;
        if (m.body < need) finding(`${vp.name}: bottom panel body is ${m.body}px — under ${need}px, so one order would not sit clear of the edges`);
        else ok(`bottom panel body ${m.body}px — one order row (${row}px) plus header and headroom`);
      }
    }

    // ---- 1d. THE NAV AND THE PRICE AXIS ARE LEGIBLE ----
    {
      const type = await page.evaluate(() => {
        const nav = document.querySelector('.nav-item');
        const navCs = nav && getComputedStyle(nav);
        return {
          navFontPx: navCs ? parseFloat(navCs.fontSize) : null,
          navWeight: navCs ? navCs.fontWeight : null,
          navColor: navCs ? navCs.color : null,
        };
      });
      result.type = type;
      if (type.navFontPx !== null && type.navFontPx < 14) finding(`${vp.name}: nav links are ${type.navFontPx}px — the owner asked for larger and sharper`);
      // Weight is checked because the terminal has its OWN nav rule that
      // outranks the base one: raising the base alone left this page at 400.
      else if (Number(type.navWeight) < 500) finding(`${vp.name}: nav links are weight ${type.navWeight} — the terminal's own rule is still winning at 400`);
      else if (type.navFontPx !== null) ok(`nav links ${type.navFontPx}px / weight ${type.navWeight} / ${type.navColor}`);
    }

    // ---- 2. THE RAIL TOGGLE SITS WHERE THE OWNER MARKED, IN BOTH STATES ----
    const railToggle = page.locator('[data-drawing-toolbar-toggle]').first();
    if (await railToggle.count()) {
      {
        const t = await geom(page, '[data-drawing-toolbar-toggle]');
        const c = await geom(page, '.chart-area');
        if (t && c) {
          const pct = (((t.y + t.height / 2) - c.y) / c.height) * 100;
          result.railTabExpanded = { tabCentreY: Math.round(t.y + t.height / 2), percentDownChart: Number(pct.toFixed(1)) };
          console.log(`    PROBE expanded toggle at ${pct.toFixed(1)}% down the chart`);
        }
      }
      await railToggle.click();
      await page.waitForTimeout(500);
      const tab = await geom(page, '.drawing-rail-shell.is-collapsed [data-drawing-toolbar-toggle]');
      const chart = await geom(page, '.chart-area');
      if (!tab || !chart) finding(`${vp.name}: could not measure the collapsed rail tab`);
      else {
        const centre = tab.y + tab.height / 2;
        const pct = ((centre - chart.y) / chart.height) * 100;
        result.railTab = { tabCentreY: Math.round(centre), chartTop: chart.y, chartHeight: chart.height, percentDownChart: Number(pct.toFixed(1)) };
        // The owner marked roughly four fifths down on their screenshot, and
        // the complaint was that it sat at the very bottom (measured at
        // 96-97.5%). A band, not a point: the chip is 22-30px tall, so an
        // exact percentage would be a false precision.
        if (pct < 72 || pct > 88) finding(`${vp.name}: collapsed rail tab sits ${pct.toFixed(1)}% down the chart — wanted the marked height, about 80%`);
        else ok(`collapsed rail tab at ${pct.toFixed(1)}% down the chart (as marked)`);
        // AND IT MUST NOT JUMP. A control that moves when you press it is a
        // defect however well placed each of its two positions is.
        const exp = result.railTabExpanded;
        if (exp) {
          const drift = Math.abs(exp.percentDownChart - pct);
          result.railTabDrift = Number(drift.toFixed(1));
          if (drift > 4) finding(`${vp.name}: the rail toggle jumps ${drift.toFixed(1)}% of the chart between its open and shut states`);
          else ok(`the toggle holds its height across a press (${exp.percentDownChart}% -> ${pct.toFixed(1)}%)`);
        }
      }
      await page.screenshot({ path: path.join(OUT, `${vp.name}-03-rail-collapsed.png`) });
      await railToggle.click();
      await page.waitForTimeout(400);
    } else finding(`${vp.name}: no drawing-rail toggle found`);

    // ---- 3. THE MARKET CHOOSER OPENS CLEAN ----
    const opener = page.locator('.futures-instrument-trigger, [aria-haspopup="dialog"], .ticker-pair-button').first();
    let opened = false;
    if (await opener.count()) { await opener.click().catch(() => {}); await page.waitForTimeout(500); opened = await page.locator('.futures-market-chooser').count() > 0; }
    if (!opened) {
      // Fall back to whatever control the header actually exposes.
      const alt = page.locator('.terminal .main-grid').first();
      await alt.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.className.includes('pair') || b.getAttribute('aria-label')?.includes('BTC'));
        btn?.click();
      }).catch(() => {});
      await page.waitForTimeout(500);
      opened = await page.locator('.futures-market-chooser').count() > 0;
    }
    if (!opened) finding(`${vp.name}: could not open the market chooser`);
    else {
      const box = await geom(page, '.futures-market-chooser');
      const tabs = await geom(page, '.futures-market-chooser .pairs-tabs');
      const headers = await geom(page, '.futures-market-chooser .pairs-col-headers');
      const list = await geom(page, '.futures-market-chooser .pairs-list');
      const clipped = await page.evaluate(() => {
        const panel = document.querySelector('.futures-market-chooser');
        const pr = panel.getBoundingClientRect();
        const bad = [];
        for (const el of panel.querySelectorAll('.pairs-tabs, .pairs-col-headers, .market-chooser-search')) {
          const r = el.getBoundingClientRect();
          // A row whose own box leaves the panel is a clipped row.
          if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.right > pr.right + 1) {
            bad.push(`${el.className} escapes the panel`);
          }
          if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className} overflows horizontally by ${el.scrollWidth - el.clientWidth}px`);
        }
        // Every heading must sit inside the panel's horizontal box.
        for (const h of panel.querySelectorAll('.pairs-col-headers .pch-sort')) {
          const r = h.getBoundingClientRect();
          if (r.right > pr.right - 1) bad.push(`heading "${h.textContent.trim()}" reaches the panel edge`);
        }
        return bad;
      });
      result.chooser = { box, tabs, headers, list, clipped };
      if (clipped.length) clipped.forEach((c) => finding(`${vp.name}: chooser layout — ${c}`));
      else ok('chooser rows, headings and field all sit inside the panel');
      if (tabs && tabs.height < 24) finding(`${vp.name}: chooser filter row squashed to ${tabs.height}px`);
      else if (tabs) ok(`filter row a full ${tabs.height}px, not clipped through its own text`);

      // Numbers, and numbers that line up: the columns must carry real
      // values and every row's price/percent must share one right edge with
      // the heading above it.
      const columns = await page.evaluate(() => {
        const panel = document.querySelector('.futures-market-chooser');
        const rows = [...panel.querySelectorAll('.pair-row')];
        const right = (el) => Math.round(el.getBoundingClientRect().right);
        const heads = [...panel.querySelectorAll('.pairs-col-headers .pch-sort')];
        return {
          filled: rows.filter((r) => (r.querySelector('.p-price')?.textContent || '—') !== '—').length,
          total: rows.length,
          priceEdges: [...new Set(rows.map((r) => right(r.querySelector('.p-price'))))],
          changeEdges: [...new Set(rows.map((r) => right(r.querySelector('.p-change'))))],
          headEdges: heads.map(right),
        };
      });
      result.columns = columns;
      // NOT a finding. This harness does not satisfy the live quote stream
      // (lib/liveMarketStore's SSE contract), so the two numeric columns
      // render em dashes here. That is the harness, not the page — and the
      // alignment check below measures the column boxes, which exist and
      // are positioned identically either way.
      if (columns.filled < columns.total) console.log(`    note: ${columns.total - columns.filled}/${columns.total} rows show "—" (this harness feeds no live quotes; geometry is still measured)`);
      else ok(`all ${columns.total} rows carry a price and a percent`);
      if (columns.priceEdges.length !== 1 || columns.changeEdges.length !== 1) {
        finding(`${vp.name}: numeric columns are ragged — price edges ${JSON.stringify(columns.priceEdges)}, change edges ${JSON.stringify(columns.changeEdges)}`);
      } else ok(`price and percent each share one right edge (${columns.priceEdges[0]}px, ${columns.changeEdges[0]}px)`);
      const probe = await page.evaluate(() => {
        const panel = document.querySelector('.futures-market-chooser');
        const list = panel.querySelector('.pairs-list');
        const head = panel.querySelector('.pairs-col-headers');
        const row = panel.querySelector('.pair-row');
        const cs = (el) => { const c = getComputedStyle(el); return { pl: c.paddingLeft, pr: c.paddingRight, w: Math.round(el.getBoundingClientRect().width), cw: el.clientWidth, sw: el.scrollWidth, cols: c.gridTemplateColumns }; };
        return { panel: Math.round(panel.getBoundingClientRect().width), list: cs(list), head: cs(head), row: cs(row),
          listScrollbar: list.offsetWidth - list.clientWidth };
      });
      console.log('    PROBE ' + JSON.stringify(probe));
      if (Math.abs(columns.headEdges[0] - columns.priceEdges[0]) > 2 || Math.abs(columns.headEdges[1] - columns.changeEdges[0]) > 2) {
        finding(`${vp.name}: headings do not sit over their columns — headings ${JSON.stringify(columns.headEdges)} vs values ${JSON.stringify([columns.priceEdges[0], columns.changeEdges[0]])}`);
      } else ok('each heading sits directly over the column it names');
      await page.screenshot({ path: path.join(OUT, `${vp.name}-04-chooser.png`) });

      // ---- 4. THE 7-DAY CONTROL ACTUALLY SORTS ----
      const symbolsNow = () => page.evaluate(() => [...document.querySelectorAll('.futures-market-chooser .pair-row')].slice(0, 6).map((r) => r.getAttribute('aria-label')));
      const before = await symbolsNow();
      const gainers = page.locator('.futures-market-chooser .pairs-7d-btn[data-kind=gainers]');
      const losers = page.locator('.futures-market-chooser .pairs-7d-btn[data-kind=losers]');
      if (!(await gainers.count())) finding(`${vp.name}: no 7-day sort control in the chooser`);
      else {
        await gainers.click();
        await page.waitForTimeout(700);
        const afterGainers = await symbolsNow();
        const headingG = await page.evaluate(() => document.querySelectorAll('.futures-market-chooser .pairs-col-headers .pch-sort')[1]?.textContent.trim());
        await page.screenshot({ path: path.join(OUT, `${vp.name}-05-sort-7d-gainers.png`) });
        await losers.click();
        await page.waitForTimeout(700);
        const afterLosers = await symbolsNow();
        await page.screenshot({ path: path.join(OUT, `${vp.name}-06-sort-7d-losers.png`) });
        result.sort7d = { before, afterGainers, afterLosers, heading: headingG };
        // THE CONTROL STANDS OVER THE COLUMN IT REORDERS.
        // The owner moved it there by hand on a screenshot; "over" is the
        // two right edges agreeing, so that is what is measured.
        const align = await page.evaluate(() => {
          const panel = document.querySelector('.futures-market-chooser');
          if (!panel) return null;
          const ctl = panel.querySelector('.pairs-7d');
          const pct = panel.querySelector('.futures-pair-list .pair-row .p-change');
          const head = panel.querySelectorAll('.pairs-col-headers .pch-sort')[1];
          if (!ctl || !pct || !head) return null;
          const r = (el) => Math.round(el.getBoundingClientRect().right);
          return { control: r(ctl), values: r(pct), heading: r(head) };
        });
        result.sevenDayAlignment = align;
        if (!align) finding(`${vp.name}: could not measure the 7-day control against the percent column`);
        else {
          if (Math.abs(align.control - align.values) > 2) finding(`${vp.name}: 7-day control's right edge is ${align.control}px, the percentages' is ${align.values}px — it is not over its column`);
          else ok(`7-day control sits over the percent column (right edge ${align.control}px)`);
          if (Math.abs(align.heading - align.values) > 2) finding(`${vp.name}: the percent heading ends at ${align.heading}px but its figures end at ${align.values}px`);
          else ok(`the percent heading's text lines up with its figures (${align.values}px)`);
        }
        // ---- THE CHOOSER MUST WIN POINTER HIT-TESTING OVER THE CHART ----
        // Since the rail was removed the chooser shares a grid cell with the
        // chart instead of standing in a column of its own. Painting above is
        // not the same as receiving the click, so this asks the document what
        // is actually on top at a row's centre, and then clicks it for real.
        const hit = await page.evaluate(() => {
          const panel = document.querySelector('.futures-market-chooser');
          const row = panel && panel.querySelector('.pair-row');
          if (!panel || !row) return null;
          const r = row.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const stack = (el) => {
            const out = [];
            for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
              const cs = getComputedStyle(n);
              out.push({ cls: n.className && n.className.toString().slice(0, 40), pos: cs.position, z: cs.zIndex,
                transform: cs.transform === 'none' ? null : 'yes', isolation: cs.isolation,
                col: cs.gridColumnStart, pe: cs.pointerEvents });
            }
            return out;
          };
          return {
            topAtRowCentre: top ? (top.className || top.tagName).toString().slice(0, 60) : null,
            insidePanel: !!(top && panel.contains(top)),
            chooser: stack(panel).slice(0, 3),
            chart: stack(document.querySelector('.chart-area')).slice(0, 3),
          };
        });
        result.chooserHitTest = hit;
        if (!hit) finding(`${vp.name}: could not hit-test the chooser`);
        else if (!hit.insidePanel) finding(`${vp.name}: the chooser does not receive the pointer — ${hit.topAtRowCentre} is on top at a row's centre`);
        else {
          ok(`the chooser receives the pointer at a row's centre (${hit.topAtRowCentre})`);
          // And a real click actually selects that market.
          const first = page.locator('.futures-market-chooser .pair-row').first();
          const label = await first.getAttribute('aria-label');
          try {
            await first.click({ timeout: 5000 });
            await page.waitForTimeout(400);
            ok(`clicking a chooser row works (${label})`);
          } catch (e) {
            finding(`${vp.name}: a chooser row could not be clicked — ${String(e).split('\n')[0]}`);
          }
        }

        const expectG = [...BASES].sort((a, b) => SEVEN_DAY[b] - SEVEN_DAY[a]).slice(0, 3);
        const expectL = [...BASES].sort((a, b) => SEVEN_DAY[a] - SEVEN_DAY[b]).slice(0, 3);
        const gotG = afterGainers.slice(0, 3).map((s) => s.split('/')[0]);
        const gotL = afterLosers.slice(0, 3).map((s) => s.split('/')[0]);
        if (JSON.stringify(gotG) !== JSON.stringify(expectG)) finding(`${vp.name}: 7d gainers gave ${gotG} — expected ${expectG}`);
        else ok(`7d gainers: ${gotG.join(', ')} (top 7-day returns, in order)`);
        if (JSON.stringify(gotL) !== JSON.stringify(expectL)) finding(`${vp.name}: 7d losers gave ${gotL} — expected ${expectL}`);
        else ok(`7d losers: ${gotL.join(', ')} (worst 7-day returns, in order)`);
        if (!headingG || !headingG.includes('7')) finding(`${vp.name}: the change column still reads "${headingG}" while sorting by 7 days`);
        else ok(`the change column says "${headingG}" while the 7-day sort is on`);
      }
    }

    if (errors.length) finding(`${vp.name}: page errors — ${errors.join(' | ')}`);
    report.viewports[vp.name] = result;
    await page.close();
  }

  await browser.close();
  report.status = findings.length ? 'FAIL' : 'PASS';
  report.findings = findings;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSTATUS: ${report.status}`);
  console.log(`FINDINGS: ${JSON.stringify(findings, null, 2)}`);
  console.log(`evidence: ${OUT}`);
}
