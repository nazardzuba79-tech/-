#!/usr/bin/env node
/**
 * The Futures account panel's draggable top edge (Bybit), in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY: fixture positions, reads only, every write
 * 404s; no production account, database or external call.
 *
 * What the owner asked for (2026-10-21) and what is measured here, with
 * three open positions at 1920×1000, 1440×900 and 1366×768:
 *   - two whole position rows are on screen on arrival, the page never scrolls;
 *   - the wheel over the panel scrolls the positions list, not the page;
 *   - dragging the panel's top edge up shows more rows and shrinks the chart,
 *     the chart never drops under its 300px track, the page never overflows;
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
  const chart = document.querySelector('.chart-area');
  const scroll = document.querySelector('.futures-positions-scroll');
  const rows = [...document.querySelectorAll('.futures-positions-table tbody tr')];
  const pb = box(panel);
  const visibleRows = pb ? rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= pb.top - 1 && b.bottom <= Math.min(pb.bottom, innerHeight) + 1; }).length : 0;
  const handle = document.querySelector('.bottom-panel [role="separator"]');
  const hb = handle ? box(handle) : null;
  return {
    terminal: box(terminal), panel: pb, chart: box(chart), rows: rows.length, visibleRows,
    scrollTop: scroll ? scroll.scrollTop : null, pageY: scrollY,
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
      check(`${key}: arrival — two whole rows of three on screen, page does not scroll, handle present with a sane range`,
        initial.visibleRows >= 2 && initial.pageOverflow === 0 && initial.handle && initial.handle.min < initial.handle.now && initial.handle.now < initial.handle.max && initial.userHeight === null, initial);

      // Wheel over the panel: the list scrolls, the page does not.
      await page.mouse.move(600, initial.panel.top + 120);
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(250);
      const wheeled = await measure(page);
      check(`${key}: wheel over the panel scrolls the positions list, never the page`, wheeled.scrollTop > 0 && wheeled.pageY === 0, wheeled);

      // Drag the edge up by 200px: taller panel, shorter chart, all three rows visible, remembered after a reload.
      const y = initial.handle.box.top + Math.round(initial.handle.box.height / 2);
      await page.mouse.move(700, y); await page.mouse.down();
      await page.mouse.move(700, y - 100, { steps: 5 }); await page.mouse.move(700, y - 200, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const dragged = await measure(page);
      await shot(page, `${key}-dragged.png`);
      // A short window (768px) reaches the ceiling before +200: the panel stops where the chart keeps its 300px.
      const grown = Math.min(initial.panel.height + 200, initial.handle.max) - initial.panel.height;
      check(`${key}: drag up 200px — panel +${grown}, chart −${grown}, three rows visible, page still fixed`,
        Math.abs(dragged.panel.height - (initial.panel.height + grown)) <= 2 && Math.abs(initial.chart.height - dragged.chart.height - grown) <= 2
          && dragged.visibleRows === 3 && dragged.pageOverflow === 0 && dragged.userHeight === 'user' && dragged.handle.now === dragged.panel.height, { initial: initial.panel, dragged });
      await open(page);
      const reloaded = await measure(page);
      check(`${key}: the height survives a reload`, reloaded.panel.height === dragged.panel.height && reloaded.userHeight === 'user', { dragged: dragged.panel, reloaded });

      // Keyboard: ArrowDown twice shrinks by 48, ArrowUp once grows by 24; Escape / double-click reset to the stylesheet.
      const handle = page.locator('.bottom-panel [role="separator"]');
      await handle.focus();
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      const keyed = await measure(page);
      check(`${key}: arrow keys move the edge by 24px steps`, keyed.panel.height === reloaded.panel.height - 24, { reloaded: reloaded.panel, keyed });
      await handle.dblclick();
      await page.waitForTimeout(200);
      const reset = await measure(page);
      check(`${key}: double-click returns the stylesheet's height`, reset.panel.height === initial.panel.height && reset.userHeight === null, { initial: initial.panel, reset });

      // Drag far past the ceiling: the chart keeps its 300px track, nothing overflows.
      const y2 = reset.handle.box.top + Math.round(reset.handle.box.height / 2);
      await page.mouse.move(700, y2); await page.mouse.down(); await page.mouse.move(700, 40, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const maxed = await measure(page);
      await shot(page, `${key}-maxed.png`);
      check(`${key}: the ceiling keeps the chart ≥ 300px and the page fixed`, maxed.chart.height >= 300 && maxed.pageOverflow === 0 && maxed.terminalOverflow <= 0 && maxed.panel.height === maxed.handle.max, maxed);
      // Drag far below the floor: one row stays.
      const y3 = maxed.handle.box.top + Math.round(maxed.handle.box.height / 2);
      await page.mouse.move(700, y3); await page.mouse.down(); await page.mouse.move(700, height - 10, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const floored = await measure(page);
      check(`${key}: the floor keeps the tabs, the heads and one row`, floored.panel.height === floored.handle.min && floored.visibleRows >= 1, floored);
      await handle.dblclick(); await page.waitForTimeout(150);
      report.measurements[key] = { initial, wheeled: { scrollTop: wheeled.scrollTop, pageY: wheeled.pageY }, dragged: dragged.panel, reloaded: reloaded.panel, keyed: keyed.panel, reset: reset.panel, maxed: { panel: maxed.panel, chart: maxed.chart }, floored: floored.panel, errors };
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
        tall.panel.height === tall.handle.max && tall.chart.height >= 300 && tall.pageOverflow === 0 && tall.stored === tall.panel.height && tall.limited === null, tall);
      await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(500);
      const small = await measure(page);
      await shot(page, 'resize-1366-limited.png');
      check('resize: at 1366×768 the shown height is the new ceiling, the chart keeps 300px, the page and the terminal do not overflow, ARIA follows the shown height',
        small.handle.max < tall.handle.max && small.panel.height === small.handle.max && small.chart.height >= 300 && small.pageOverflow === 0 && small.terminalOverflow <= 0
          && small.handle.now === small.panel.height && small.limited === 'true', { tall: { panel: tall.panel, max: tall.handle.max }, small });
      check('resize: the large-screen preference is kept while the small window limits it', small.stored === tall.panel.height, { stored: small.stored, tall: tall.panel });
      await open(page);
      const reloaded = await measure(page);
      check('resize: a reload at 1366×768 keeps the limit, the fixed page and the preference',
        reloaded.panel.height === small.panel.height && reloaded.pageOverflow === 0 && reloaded.terminalOverflow <= 0 && reloaded.stored === tall.panel.height && reloaded.limited === 'true', { small: small.panel, reloaded });
      await page.setViewportSize({ width: 1920, height: 1000 }); await page.waitForTimeout(500);
      const back = await measure(page);
      await shot(page, 'resize-1920-restored.png');
      check('resize: back at 1920×1000 the panel returns to its preference, nothing overflows',
        back.panel.height === tall.panel.height && back.pageOverflow === 0 && back.handle.now === back.panel.height && back.limited === null, { tall: tall.panel, back });
      // A drag on the small window is a new choice: it replaces the preference.
      await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(500);
      const limitedAgain = await measure(page);
      const y = limitedAgain.handle.box.top + Math.round(limitedAgain.handle.box.height / 2);
      await page.mouse.move(700, y); await page.mouse.down(); await page.mouse.move(700, y + 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
      const chosen = await measure(page);
      check('resize: a drag on the small window becomes the new preference', chosen.panel.height === limitedAgain.panel.height - 60 && chosen.stored === chosen.panel.height && chosen.limited === null, { limitedAgain: limitedAgain.panel, chosen });
      report.measurements.resize = { tall: { panel: tall.panel, chart: tall.chart, max: tall.handle.max }, small: { panel: small.panel, chart: small.chart, max: small.handle.max, stored: small.stored }, reloaded: reloaded.panel, back: back.panel, chosen: chosen.panel, errors };
      check('resize: no page errors', errors.length === 0, errors);
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
      const toggle = page.locator('.bottom-panel .terminal-account-header button[aria-expanded]').first();
      if (await toggle.count()) {
        await toggle.click(); await page.waitForTimeout(300);
        const folded = await page.evaluate(() => ({ compact: document.querySelector('.bottom-panel')?.getAttribute('data-account-compact'), handle: getComputedStyle(document.querySelector('.bottom-panel [role="separator"]')).display, panel: Math.round(document.querySelector('.bottom-panel').getBoundingClientRect().height) }));
        check('1440 folded empty panel: the handle hides with the fold', folded.compact === 'true' && folded.handle === 'none' && folded.panel <= 48, folded);
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
