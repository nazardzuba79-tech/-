#!/usr/bin/env node
/**
 * The Futures account panel's draggable top edge (Bybit), in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY: fixture positions, reads only, every write
 * 404s; no production account, database or external call.
 *
 * What the owner asked for (2026-10-21) and what is measured here, with
 * three open positions at 1920×1000, 1440×900 and 1366×768:
 *   - two whole position rows are on screen on arrival;
 *   - (owner, 2026-10-22, a Bybit screen recording: «Вот як я мав на увазі»)
 *     the panel continues below the screen's edge by the stylesheet's
 *     `--futures-account-extension`, the page scrolls by exactly that much:
 *     the wheel over the panel brings every row on screen, the chart moves up
 *     whole (its height unchanged), wheeling back restores the arrival view;
 *     with more trades than fit, the list scrolls first and then the page;
 *   - dragging the panel's top edge up shows more rows and shrinks the chart,
 *     the chart never drops under its 300px track, the page's scroll range
 *     stays the continuation (the drag never makes the page longer);
 *   - the height survives a reload; ArrowDown/ArrowUp move it; a double-click
 *     returns the stylesheet's height;
 *   - the folded (empty) panel and a phone show no handle;
 *   - (CTO, 2026-10-21) a tall panel chosen on a large screen is only limited
 *     while the window is small: the shown height follows the live ceiling,
 *     the chart keeps 300px, nothing overflows, ARIA follows, the preference
 *     survives a reload there and comes back with the large screen.
 *
 *   node scripts/qa-futures-panel-resize.cjs [--dist path] [--out dir]
 */
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-panel-resize')));
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || (fs.existsSync('/opt/node22/lib/node_modules/playwright') ? '/opt/node22/lib/node_modules/playwright' : 'playwright'));
fs.mkdirSync(OUT, { recursive: true });

const position = (i, symbol, size, entry, mark) => ({
  id: `qa-pos-${i}`, symbol, side: 'LONG', size, entryPrice: entry, leverage: 10, marginType: 'CROSS',
  initialMargin: '7348.33', liquidationPrice: null, markPrice: mark, unrealizedPnl: '93906.72', realizedPnl: '-40.42', roe: '1277.93',
  openedAt: new Date(Date.now() - i * 3_600_000).toISOString(), protection: { takeProfit: null, stopLoss: null },
});
const POSITIONS = [position(1, 'DOOD/USDT', '51315150', '0.001432', '0.003262'), position(2, 'IOST/USDT', '1483972851', '0.0007824', '0.001448'), position(3, 'BTC/USDT', '0.25', '77260.40', '77840.10')];
/** More trades than the panel and its continuation hold together. */
const MANY = [...POSITIONS, position(4, 'ETH/USDT', '20', '2670.52', '2433.20'), position(5, 'SOL/USDT', '101.3', '106.807', '104.480'), position(6, 'XRP/USDT', '500', '1.3635', '1.3405'), position(7, 'DOGE/USDT', '1000', '0.1', '0.11')];

function start(positions) {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/positions', (_q, r) => r.json(positions));
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
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}

const measure = (page) => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
  const terminal = document.querySelector('.terminal');
  const panel = document.querySelector('.bottom-panel');
  // The part of the panel that continues below the screen's edge (Bybit page scroll); 0 when folded or empty.
  const extension = terminal ? (parseFloat(getComputedStyle(terminal).getPropertyValue('--futures-account-extension')) || 0) : 0;
  const chart = document.querySelector('.chart-area');
  const scroll = document.querySelector('.futures-positions-scroll');
  const rows = [...document.querySelectorAll('.futures-positions-table tbody tr')];
  const pb = box(panel);
  const visibleRows = pb ? rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= pb.top - 1 && b.bottom <= Math.min(pb.bottom, innerHeight) + 1; }).length : 0;
  const handle = document.querySelector('.bottom-panel [role="separator"]');
  const hb = handle ? box(handle) : null;
  return {
    pageScrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
    terminal: box(terminal), panel: pb, chart: box(chart), rows: rows.length, visibleRows, extension,
    // The panel's part above the edge: what the handle sets and ARIA reports.
    shown: pb ? pb.height - extension : null,
    scrollTop: scroll ? scroll.scrollTop : null, listMax: scroll ? scroll.scrollHeight - scroll.clientHeight : null, pageY: scrollY,
    pageOverflow: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
    terminalOverflow: terminal ? terminal.scrollHeight - terminal.clientHeight : null,
    userHeight: terminal?.getAttribute('data-account-height'),
    limited: terminal?.getAttribute('data-account-height-limited'),
    stored: Number(localStorage.getItem('voltex.futures.accountPanelHeight')) || null,
    handle: handle && hb && hb.height > 0 && getComputedStyle(handle).display !== 'none' ? { box: hb, now: Number(handle.getAttribute('aria-valuenow')), min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')) } : null,
  };
});

const report = { scope: 'Local only: fixture positions on the production bundle; nothing written.', checks: [], screenshots: [], measurements: {} };
const check = (name, ok, detail) => { if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`); report.checks.push(name); console.log('✓', name); };

(async () => {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), `no bundle at ${DIST}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let server = await start(POSITIONS);
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); report.screenshots.push(name); };
  const open = async (page, wait = true) => {
    await page.goto(`${origin()}/futures?pair=IOST%2FUSDT`, { waitUntil: 'domcontentloaded' });
    if (wait) await page.locator('.futures-positions-table tbody tr').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
  };
  try {
    for (const [width, height] of [[1920, 1000], [1440, 900], [1366, 768]]) {
      const key = `${width}x${height}`;
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await open(page);
      const initial = await measure(page);
      await shot(page, `${key}-initial.png`);
      check(`${key}: arrival — two whole rows of three on screen, the panel continues ${initial.extension}px below the edge and the page scrolls by exactly that with no scrollbar drawn (Bybit), handle present with a sane range`,
        initial.visibleRows >= 2 && initial.visibleRows < initial.rows && initial.extension === 140 && initial.pageOverflow === initial.extension && initial.pageY === 0 && initial.pageScrollbar === 'none'
          && initial.handle && initial.handle.min < initial.handle.now && initial.handle.now < initial.handle.max && initial.handle.now === initial.shown && initial.userHeight === null, initial);

      // Wheel over the panel (Bybit): the page scrolls by the continuation, every row comes on screen, the chart moves up whole.
      await page.mouse.move(600, initial.panel.top + 120);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(200); }
      const wheeled = await measure(page);
      await shot(page, `${key}-wheeled.png`);
      check(`${key}: wheel over the panel scrolls the page by ${initial.extension}px — all ${wheeled.rows} rows on screen, the chart's height unchanged`,
        wheeled.pageY === initial.extension && wheeled.visibleRows === wheeled.rows && wheeled.chart.height === initial.chart.height
          && wheeled.chart.top === initial.chart.top - initial.extension && wheeled.panel.height === initial.panel.height, { initial: { chart: initial.chart, panel: initial.panel }, wheeled });
      for (let i = 0; i < 4; i++) { await page.mouse.move(600, Math.min(height - 20, wheeled.panel.top + 120)); await page.mouse.wheel(0, -120); await page.waitForTimeout(200); }
      const unwheeled = await measure(page);
      check(`${key}: wheeling back up restores the arrival view`,
        unwheeled.pageY === 0 && unwheeled.chart.top === initial.chart.top && unwheeled.chart.height === initial.chart.height && unwheeled.panel.top === initial.panel.top && unwheeled.visibleRows === initial.visibleRows, { initial: { chart: initial.chart, panel: initial.panel }, unwheeled });

      // Drag the edge up by 200px: taller panel, shorter chart, all three rows visible, remembered after a reload.
      const y = initial.handle.box.top + Math.round(initial.handle.box.height / 2);
      await page.mouse.move(700, y); await page.mouse.down();
      await page.mouse.move(700, y - 100, { steps: 5 }); await page.mouse.move(700, y - 200, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const dragged = await measure(page);
      await shot(page, `${key}-dragged.png`);
      // A short window (768px) reaches the ceiling before +200: the panel stops where the chart keeps its 300px.
      const grown = Math.min(initial.shown + 200, initial.handle.max) - initial.shown;
      check(`${key}: drag up 200px — panel +${grown}, chart −${grown}, three rows visible, the page's scroll range unchanged`,
        Math.abs(dragged.shown - (initial.shown + grown)) <= 2 && Math.abs(initial.chart.height - dragged.chart.height - grown) <= 2
          && dragged.visibleRows === 3 && dragged.pageOverflow === dragged.extension && dragged.userHeight === 'user' && dragged.handle.now === dragged.shown, { initial: initial.panel, dragged });
      await open(page);
      const reloaded = await measure(page);
      check(`${key}: the height survives a reload`, reloaded.shown === dragged.shown && reloaded.userHeight === 'user', { dragged: dragged.panel, reloaded });

      // Keyboard: ArrowDown twice shrinks by 48, ArrowUp once grows by 24; Escape / double-click reset to the stylesheet.
      const handle = page.locator('.bottom-panel [role="separator"]');
      await handle.focus();
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      const keyed = await measure(page);
      check(`${key}: arrow keys move the edge by 24px steps`, keyed.shown === reloaded.shown - 24, { reloaded: reloaded.panel, keyed });
      await handle.dblclick();
      await page.waitForTimeout(200);
      const reset = await measure(page);
      check(`${key}: double-click returns the stylesheet's height`, reset.shown === initial.shown && reset.userHeight === null, { initial: initial.panel, reset });

      // Drag far past the ceiling: the chart keeps its 300px track, the terminal does not overflow, the page is no longer than the continuation.
      const y2 = reset.handle.box.top + Math.round(reset.handle.box.height / 2);
      await page.mouse.move(700, y2); await page.mouse.down(); await page.mouse.move(700, 40, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const maxed = await measure(page);
      await shot(page, `${key}-maxed.png`);
      check(`${key}: the ceiling keeps the chart ≥ 300px and the page's scroll range at the continuation`, maxed.chart.height >= 300 && maxed.pageOverflow === maxed.extension && maxed.terminalOverflow <= 0 && maxed.shown === maxed.handle.max, maxed);
      // Drag far below the floor: one row stays.
      const y3 = maxed.handle.box.top + Math.round(maxed.handle.box.height / 2);
      await page.mouse.move(700, y3); await page.mouse.down(); await page.mouse.move(700, height - 10, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const floored = await measure(page);
      check(`${key}: the floor keeps the tabs, the heads and one row`, floored.shown === floored.handle.min && floored.visibleRows >= 1, floored);
      await handle.dblclick(); await page.waitForTimeout(150);
      report.measurements[key] = { initial, wheeled: { pageY: wheeled.pageY, visibleRows: wheeled.visibleRows, chart: wheeled.chart }, unwheeled: { pageY: unwheeled.pageY, chart: unwheeled.chart }, dragged: dragged.panel, reloaded: reloaded.panel, keyed: keyed.panel, reset: reset.panel, maxed: { panel: maxed.panel, chart: maxed.chart }, floored: floored.panel, errors };
      check(`${key}: no page errors`, errors.length === 0, errors);
      await context.close();
    }

    // Resize regression (CTO, 2026-10-21): large screen → tall panel → small
    // window → reload → large screen again.
    {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await open(page);
      const handle = page.locator('.bottom-panel [role="separator"]');
      await handle.focus(); await page.keyboard.press('End'); await page.waitForTimeout(300);
      const tall = await measure(page);
      await shot(page, 'resize-1920-tall.png');
      check('resize: End at 1920×1000 takes the panel to the ceiling, the chart keeps 300px, the preference is the shown height',
        tall.shown === tall.handle.max && tall.chart.height >= 300 && tall.pageOverflow === tall.extension && tall.stored === tall.shown && tall.limited === null, tall);
      await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(500);
      const small = await measure(page);
      await shot(page, 'resize-1366-limited.png');
      check('resize: at 1366×768 the shown height is the new ceiling, the chart keeps 300px, the terminal does not overflow, the page scrolls only by the continuation, ARIA follows the shown height',
        small.handle.max < tall.handle.max && small.shown === small.handle.max && small.chart.height >= 300 && small.pageOverflow === small.extension && small.terminalOverflow <= 0
          && small.handle.now === small.shown && small.limited === 'true', { tall: { panel: tall.panel, max: tall.handle.max }, small });
      check('resize: the large-screen preference is kept while the small window limits it', small.stored === tall.shown, { stored: small.stored, tall: tall.panel });
      await open(page);
      const reloaded = await measure(page);
      check('resize: a reload at 1366×768 keeps the limit, the page\'s scroll range and the preference',
        reloaded.shown === small.shown && reloaded.pageOverflow === reloaded.extension && reloaded.terminalOverflow <= 0 && reloaded.stored === tall.shown && reloaded.limited === 'true', { small: small.panel, reloaded });
      await page.setViewportSize({ width: 1920, height: 1000 }); await page.waitForTimeout(500);
      const back = await measure(page);
      await shot(page, 'resize-1920-restored.png');
      check('resize: back at 1920×1000 the panel returns to its preference, the page scrolls only by the continuation',
        back.shown === tall.shown && back.pageOverflow === back.extension && back.handle.now === back.shown && back.limited === null, { tall: tall.panel, back });
      // A drag on the small window is a new choice: it replaces the preference.
      await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(500);
      const limitedAgain = await measure(page);
      const y = limitedAgain.handle.box.top + Math.round(limitedAgain.handle.box.height / 2);
      await page.mouse.move(700, y); await page.mouse.down(); await page.mouse.move(700, y + 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
      const chosen = await measure(page);
      check('resize: a drag on the small window becomes the new preference', chosen.shown === limitedAgain.shown - 60 && chosen.stored === chosen.shown && chosen.limited === null, { limitedAgain: limitedAgain.panel, chosen });
      report.measurements.resize = { tall: { panel: tall.panel, chart: tall.chart, max: tall.handle.max }, small: { panel: small.panel, chart: small.chart, max: small.handle.max, stored: small.stored }, reloaded: reloaded.panel, back: back.panel, chosen: chosen.panel, errors };
      check('resize: no page errors', errors.length === 0, errors);
      await context.close();
    }

    // More trades than fit (seven), Bybit's order from the recording: the
    // wheel scrolls the list to its end first, only then the page; back up,
    // the list and the page both return.
    server.close(); server = await start(MANY);
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await open(page);
      const many = await measure(page);
      check('seven trades at 1440×900: the list holds more than its window, the page scrolls only by the continuation',
        many.rows === 7 && many.listMax > 0 && many.pageOverflow === many.extension && many.extension === 140, many);
      const steps = [];
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(600, many.panel.top + 120); await page.mouse.wheel(0, 120); await page.waitForTimeout(250);
        const m = await measure(page); steps.push({ list: m.scrollTop, listMax: m.listMax, pageY: m.pageY, rows: m.visibleRows });
      }
      await shot(page, 'many-1440-wheeled.png');
      const firstPage = steps.findIndex(x => x.pageY > 0);
      check('seven trades: the wheel scrolls the list to its end first, then the page by the continuation',
        firstPage > 0 && steps.slice(0, firstPage).every(x => x.pageY === 0) && steps[firstPage - 1].list === many.listMax && steps.at(-1).pageY === many.extension && steps.at(-1).list === many.listMax
          && steps.at(-1).rows > many.visibleRows, steps);
      for (let i = 0; i < 8; i++) { await page.mouse.move(600, Math.min(880, many.panel.top + 120 - steps.at(-1).pageY)); await page.mouse.wheel(0, -120); await page.waitForTimeout(250); }
      const back = await measure(page);
      check('seven trades: wheeling back up returns the list and the page to the top', back.pageY === 0 && back.scrollTop === 0 && back.chart.height === many.chart.height, back);
      report.measurements.many = { arrival: { rows: many.rows, visibleRows: many.visibleRows, listMax: many.listMax, extension: many.extension }, steps, back: { pageY: back.pageY, list: back.scrollTop }, errors };
      check('seven trades: no page errors', errors.length === 0, errors);
      await context.close();
    }

    // A phone: no handle, the panel stacks under the chart as before.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await open(page, false);
      const phone = await page.evaluate(() => { const h = document.querySelector('.bottom-panel [role="separator"]'); return { handles: h ? getComputedStyle(h).display : 'absent' }; });
      check('390 phone: no handle', phone.handles === 'none' || phone.handles === 'absent', phone);
      await shot(page, '390-phone.png');
      await context.close();
    }

    // An empty, folded account: the handle is hidden with the fold (the existing rule).
    server.close(); server = await start([]);
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await open(page, false);
      await page.waitForTimeout(1500);
      const empty = await measure(page);
      check('1440 empty account: nothing continues below the edge, the page fits the screen', empty.extension === 0 && empty.pageOverflow === 0, empty);
      const toggle = page.locator('.bottom-panel .terminal-account-header button[aria-expanded]').first();
      if (await toggle.count()) {
        await toggle.click(); await page.waitForTimeout(300);
        const folded = await page.evaluate(() => ({ compact: document.querySelector('.bottom-panel')?.getAttribute('data-account-compact'), handle: getComputedStyle(document.querySelector('.bottom-panel [role="separator"]')).display, panel: Math.round(document.querySelector('.bottom-panel').getBoundingClientRect().height) }));
        const foldedPage = await measure(page);
        check('1440 folded empty panel: the handle hides with the fold, nothing continues below the edge', folded.compact === 'true' && folded.handle === 'none' && folded.panel <= 48 && foldedPage.extension === 0 && foldedPage.pageOverflow === 0, { folded, extension: foldedPage.extension, pageOverflow: foldedPage.pageOverflow });
        await shot(page, '1440-folded.png');
      } else {
        report.checks.push('1440 folded: no fold control offered (not verified here)');
      }
      await context.close();
    }
  } finally {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length }));
})().catch((e) => { console.error(e); process.exitCode = 1; });
