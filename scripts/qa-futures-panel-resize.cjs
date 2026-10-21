#!/usr/bin/env node
/**
 * The Futures bottom panel with OPEN POSITIONS — can every row be reached,
 * and can the trader take height from the chart the way Bybit lets them.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, reads only, every write 404s.
 * No production account, database or external call. The same express
 * fixture as qa-futures-bottom-panel.cjs, with N positions instead of one.
 *
 *   node scripts/qa-futures-panel-resize.cjs [--dist path] [--label before|after]
 *        [--positions 2,5] [--widths 1440x900,1280x720,390x844] [--out dir]
 *
 * QA_MEASURE_ONLY=1 measures and screenshots without asserting (the
 * "before" half, taken against a build that predates this work).
 * QA_PLAYWRIGHT_MODULE overrides the Playwright module path.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4331'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-panel-resize')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const COUNTS = arg('--positions', '2,5').split(',').map(Number);
const SIZES = arg('--widths', '1440x900,1280x720,390x844').split(',').map(s => s.split('x').map(Number));

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

/** The owner's two contracts first, then three more, so a 5-row table scrolls. */
const SEED = [
  ['DOOD/USDT', 'LONG', '120000', '0.003120', '0.003456', '0.002790'],
  ['IOST/USDT', 'SHORT', '45000', '0.004210', '0.004087', '0.004755'],
  ['BTC/USDT', 'LONG', '0.250', '77260.40', '77840.10', '70118.20'],
  ['ETH/USDT', 'SHORT', '3.000', '3912.55', '3890.20', '4310.00'],
  ['SOL/USDT', 'LONG', '40.0', '171.20', '173.05', '154.90'],
];
const positions = (n) => SEED.slice(0, n).map(([symbol, side, size, entry, mark, liq], i) => {
  const pnl = (Number(mark) - Number(entry)) * Number(size) * (side === 'LONG' ? 1 : -1);
  return {
    id: `qa-pos-${i + 1}`, symbol, side, size, entryPrice: entry, leverage: 10, marginType: 'CROSS',
    initialMargin: (Number(entry) * Number(size) / 10).toFixed(2), liquidationPrice: liq, markPrice: mark,
    unrealizedPnl: pnl.toFixed(2), realizedPnl: '0', roe: (pnl / (Number(entry) * Number(size) / 10) * 100).toFixed(2),
    openedAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
    protection: { takeProfit: null, stopLoss: null },
  };
});

function start(rows) {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/positions', (_q, r) => r.json(rows));
  app.get('/api/v1/futures/positions/history', (_q, r) => r.json([]));
  app.get('/api/v1/futures/orders/me', (_q, r) => r.json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}
const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

/** The geometry the complaint is about: the panel, its scroll region, the rows and the close buttons inside it. */
const measure = (page) => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
  const terminal = document.querySelector('.terminal');
  const panel = document.querySelector('.bottom-panel');
  const chart = document.querySelector('.chart-area');
  const region = document.querySelector('.futures-positions-scroll');
  const content = document.querySelector('.bottom-content');
  const handle = document.querySelector('.bottom-panel .orders-resize-handle');
  const rows = [...document.querySelectorAll('.futures-positions-table tbody tr.futures-position-row')];
  const regionBox = box(region);
  const visible = (b) => !!(b && regionBox && b.top >= regionBox.top - 1 && b.bottom <= regionBox.bottom + 1);
  const rowInfo = rows.map(tr => {
    const close = tr.querySelector('.futures-position-close, .futures-position-close-pair button, button');
    return { symbol: (tr.querySelector('.futures-position-ticker, .futures-position-symbol-link')?.textContent || '').trim().slice(0, 12), box: box(tr), closeBox: box(close), rowVisible: visible(box(tr)), closeVisible: visible(box(close)) };
  });
  const thead = document.querySelector('.futures-positions-table thead th');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    terminal: box(terminal), terminalRows: terminal ? getComputedStyle(terminal).gridTemplateRows : null,
    accountHeightVar: terminal ? getComputedStyle(terminal).getPropertyValue('--futures-account-height').trim() : null,
    chart: box(chart), chartCanvas: box(document.querySelector('.chart-area canvas')),
    panel: box(panel), content: box(content), region: regionBox,
    regionScroll: region ? { clientH: region.clientHeight, scrollH: region.scrollHeight, top: region.scrollTop, clientW: region.clientWidth, scrollW: region.scrollWidth, left: region.scrollLeft, overflowY: getComputedStyle(region).overflowY, overflowX: getComputedStyle(region).overflowX } : null,
    contentOverflow: content ? { clientH: content.clientHeight, scrollH: content.scrollHeight, overflowY: getComputedStyle(content).overflowY } : null,
    headSticky: thead ? getComputedStyle(thead).position : null, head: box(thead),
    handle: handle ? { box: box(handle), role: handle.getAttribute('role'), min: handle.getAttribute('aria-valuemin'), max: handle.getAttribute('aria-valuemax'), now: handle.getAttribute('aria-valuenow'), cursor: getComputedStyle(handle).cursor } : null,
    rows: rowInfo,
    pageOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    pageH: document.documentElement.scrollHeight,
    tabs: [...document.querySelectorAll('.bottom-tabs .bottom-tab')].map(t => ({ id: t.id, text: t.textContent.trim().slice(0, 30), selected: t.getAttribute('aria-selected') })),
  };
});

const report = { label: LABEL, dist: DIST, measureOnly: MEASURE_ONLY, runs: [], errors: [], checks: [] };
function check(name, ok, detail) {
  report.checks.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok && !MEASURE_ONLY) throw new Error(`[FAIL] ${name}: ${JSON.stringify(detail)}`);
  console.log(`${ok ? 'PASS' : 'MISS'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const count of COUNTS) {
      const server = start(positions(count));
      await waitForServer();
      try {
        for (const [w, h] of SIZES) {
          const mobile = w <= 900;
          const context = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU', timezoneId: 'UTC', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
          // The stored height is cleared once per tab (not on the reload that checks it survives).
          await context.addInitScript(() => { try { localStorage.setItem('exchange_token', 'qa-token'); if (!sessionStorage.getItem('qa-panel-cleared')) { localStorage.removeItem('voltex.futuresAccountPanel.v1'); sessionStorage.setItem('qa-panel-cleared', '1'); } } catch {} });
          const page = await context.newPage();
          page.on('pageerror', e => report.errors.push({ count, w, h, message: e.message }));
          const run = { count, viewport: `${w}x${h}`, steps: {} };
          report.runs.push(run);
          const shot = (name) => page.screenshot({ path: path.join(OUT, `${LABEL}-${count}pos-${w}x${h}-${name}.png`), fullPage: mobile });
          await page.goto(`http://127.0.0.1:${PORT}/futures?pair=DOOD%2FUSDT`, { waitUntil: 'networkidle' });
          if (mobile) { const tab = page.locator('#mobile-futures-positions'); if (await tab.count()) await tab.click(); }
          await page.waitForSelector('.futures-positions-table tbody tr.futures-position-row', { timeout: 20000 });
          await page.waitForTimeout(800);
          run.steps.initial = await measure(page);
          await shot('initial');
          const m0 = run.steps.initial;
          const tag = `${count}pos ${w}x${h}`;
          if (!mobile) {
            check(`${tag} rows rendered`, m0.rows.length === count, m0.rows.length);
            check(`${tag} vertical scroll container is the table region`, m0.regionScroll && m0.regionScroll.overflowY !== 'visible', m0.regionScroll);
            // 1. Every row and its close control can be reached by scrolling the region.
            const reached = [];
            for (let i = 0; i < count; i++) {
              await page.evaluate((i) => { const tr = document.querySelectorAll('.futures-positions-table tbody tr.futures-position-row')[i]; tr.scrollIntoView({ block: 'nearest' }); }, i);
              await page.waitForTimeout(120);
              const m = await measure(page);
              reached.push({ symbol: m.rows[i].symbol, rowVisible: m.rows[i].rowVisible, closeVisible: m.rows[i].closeVisible, scrollTop: m.regionScroll.top });
            }
            run.steps.reach = reached;
            check(`${tag} every row and its close button reachable by scrolling`, reached.every(r => r.rowVisible && r.closeVisible), reached);
            await shot('scrolled-to-last');
            // 2. The wheel over the table scrolls the rows (only meaningful when they overflow).
            await page.evaluate(() => { document.querySelector('.futures-positions-scroll').scrollTop = 0; });
            const needsScroll = m0.regionScroll.scrollH > m0.regionScroll.clientH + 1;
            if (needsScroll) {
              const rb = m0.region; await page.mouse.move(rb.left + rb.width / 2, rb.top + rb.height / 2); await page.mouse.wheel(0, 240); await page.waitForTimeout(250);
              const mw = await measure(page); run.steps.wheel = { before: 0, after: mw.regionScroll.top };
              check(`${tag} wheel over the table scrolls the rows`, mw.regionScroll.top > 0, run.steps.wheel);
              check(`${tag} column headings stay pinned while rows scroll`, mw.headSticky === 'sticky' && mw.head.top >= mw.region.top - 1, { sticky: mw.headSticky, head: mw.head, region: mw.region });
            } else run.steps.wheel = 'rows fit, no vertical scroll needed';
            // 3. Horizontal scroll of the columns is independent of the vertical one.
            if (m0.regionScroll.scrollW > m0.regionScroll.clientW + 1) {
              await page.evaluate(() => { const r = document.querySelector('.futures-positions-scroll'); r.scrollTop = 0; r.scrollLeft = 10000; });
              await page.waitForTimeout(150);
              const mh = await measure(page);
              run.steps.horizontal = { left: mh.regionScroll.left, lastCloseVisible: mh.rows[0].closeVisible };
              check(`${tag} horizontal scroll keeps the close column on screen`, mh.regionScroll.left > 0 && mh.rows[0].closeVisible, run.steps.horizontal);
              await page.evaluate(() => { document.querySelector('.futures-positions-scroll').scrollLeft = 0; });
            } else run.steps.horizontal = 'columns fit';
            // 4. The divider: drag it up, the panel grows and the chart gives the height back.
            check(`${tag} divider present`, !!m0.handle, m0.handle);
            if (m0.handle) {
              const hb = m0.handle.box; const y0 = hb.top + hb.height / 2, x0 = hb.left + Math.min(400, hb.width / 2);
              await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0, y0 - 80, { steps: 6 }); await page.mouse.move(x0, y0 - 160, { steps: 6 }); await page.mouse.up();
              await page.waitForTimeout(400);
              const mu = await measure(page);
              run.steps.dragUp = { panelBefore: m0.panel.height, panelAfter: mu.panel.height, chartBefore: m0.chart.height, chartAfter: mu.chart.height, canvas: mu.chartCanvas, now: mu.handle && mu.handle.now };
              // A 160px pull grows the panel by 160px, or up to the ceiling the chart floor leaves (284px at 1280x720); the chart shrinks by the same amount.
              const expected = Math.min(m0.panel.height + 160, Number(mu.handle.max)), grew = mu.panel.height - m0.panel.height;
              check(`${tag} drag up grows the panel and shrinks the chart`, Math.abs(mu.panel.height - expected) <= 2 && grew >= 80 && (m0.chart.height - mu.chart.height) >= grew - 10 && mu.chartCanvas && mu.chartCanvas.height > 100, { ...run.steps.dragUp, expected });
              check(`${tag} chart keeps its floor and the panel does not cover the ticket`, mu.chart.height >= 300 && mu.panel.top >= mu.chart.bottom - 1, { chart: mu.chart, panel: mu.panel });
              const allVisible = mu.rows.every(r => r.rowVisible && r.closeVisible);
              run.steps.dragUpRows = mu.rows.map(r => r.rowVisible);
              await shot('dragged-up');
              if (count <= 2) check(`${tag} two positions fully visible after enlarging`, allVisible, mu.rows.map(r => [r.symbol, r.rowVisible, r.closeVisible]));
              // Persisted across reload.
              await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.futures-positions-table tbody tr.futures-position-row'); await page.waitForTimeout(500);
              const mr = await measure(page); run.steps.reload = { panel: mr.panel.height, expected: mu.panel.height };
              check(`${tag} height survives a reload`, Math.abs(mr.panel.height - mu.panel.height) <= 2, run.steps.reload);
              // Keyboard on the separator.
              await page.focus('.bottom-panel .orders-resize-handle'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
              const mk = await measure(page); run.steps.keyboard = { before: mr.panel.height, after: mk.panel.height };
              check(`${tag} ArrowDown on the separator shrinks the panel`, mk.panel.height < mr.panel.height, run.steps.keyboard);
              // Drag down to the floor: the chart takes the space back, the panel keeps its minimum.
              const hb2 = mk.handle.box; const y2 = hb2.top + hb2.height / 2;
              await page.mouse.move(x0, y2); await page.mouse.down(); await page.mouse.move(x0, y2 + 600, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
              const md = await measure(page); run.steps.dragDown = { panel: md.panel.height, chart: md.chart.height, min: md.handle && md.handle.min };
              check(`${tag} drag down stops at the minimum and the chart grows back`, md.panel.height >= Number(md.handle.min) - 1 && md.panel.height <= Number(md.handle.min) + 1 && md.chart.height > mu.chart.height, run.steps.dragDown);
              await shot('dragged-down');
              // Drag beyond the ceiling: clamped, chart floor kept.
              const hb3 = md.handle.box; const y3 = hb3.top + hb3.height / 2;
              await page.mouse.move(x0, y3); await page.mouse.down(); await page.mouse.move(x0, 0, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
              const mm = await measure(page); run.steps.dragMax = { panel: mm.panel.height, chart: mm.chart.height, max: mm.handle && mm.handle.max };
              check(`${tag} drag beyond the ceiling clamps and keeps the chart floor`, mm.panel.height <= Number(mm.handle.max) + 1 && mm.chart.height >= 300, run.steps.dragMax);
              if (count >= 5) { const all5 = mm.rows.every(r => r.rowVisible); run.steps.maxRows = mm.rows.map(r => r.rowVisible); await shot('dragged-max'); check(`${tag} at the ceiling the five rows need no scroll or scroll freely`, all5 || mm.regionScroll.scrollH > mm.regionScroll.clientH, run.steps.maxRows); }
              await page.evaluate(() => { try { localStorage.removeItem('voltex.futuresAccountPanel.v1'); } catch {} });
            }
            // 5. Tabs keep working.
            const tabIds = ['orders', 'positions', 'orderHistory', 'positionHistory'];
            const seen = [];
            for (const id of tabIds) { const t = page.locator(`#futures-tab-${id}`); if (!(await t.count())) continue; await t.click(); await page.waitForTimeout(200); seen.push({ id, selected: await t.getAttribute('aria-selected'), panel: await page.locator('#futures-bottom-content').getAttribute('aria-labelledby') }); }
            run.steps.tabs = seen;
            check(`${tag} tabs switch`, seen.length >= 3 && seen.every(s => s.selected === 'true' && s.panel === `futures-tab-${s.id}`), seen);
            await page.locator('#futures-tab-positions').click(); await page.waitForTimeout(200);
          } else {
            check(`${tag} rows rendered`, m0.rows.length === count, m0.rows.length);
            check(`${tag} no desktop divider on a phone`, !m0.handle, m0.handle);
            check(`${tag} no horizontal page overflow`, m0.pageOverflowX === 0, m0.pageOverflowX);
            const reached = [];
            for (let i = 0; i < count; i++) {
              const r = await page.evaluate((i) => { const tr = document.querySelectorAll('.futures-positions-table tbody tr.futures-position-row')[i]; tr.scrollIntoView({ block: 'center' }); const b = tr.getBoundingClientRect(); const c = tr.querySelector('.futures-position-close, button'); const cb = c ? c.getBoundingClientRect() : null; return { top: Math.round(b.top), bottom: Math.round(b.bottom), inView: b.top >= 0 && b.bottom <= window.innerHeight, closeInView: !!cb && cb.top >= 0 && cb.bottom <= window.innerHeight && cb.width > 0 }; }, i);
              reached.push(r);
            }
            run.steps.reach = reached;
            check(`${tag} every card and its close button reachable by page scroll`, reached.every(r => r.inView && r.closeInView), reached);
            await shot('last-card');
          }
          await context.close();
        }
      } finally { await new Promise(r => server.close(r)); }
    }
  } catch (e) { report.errors.push({ fatal: e.message }); console.error(e); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
  const failed = report.checks.filter(c => !c.passed).length;
  console.log(JSON.stringify({ label: LABEL, checks: report.checks.length, failed, pageErrors: report.errors.length, out: OUT }));
  process.exit(!MEASURE_ONLY && (failed || report.errors.length) ? 1 : 0);
})();
