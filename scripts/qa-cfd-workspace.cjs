'use strict';
/**
 * CFD Chart Workspace QA (2026-10-15). LOCAL QA ONLY.
 *
 * Loopback Express host: the production frontend bundle (--dist) and the real
 * `/cfd/*` router from the compiled backend (dist/api/routes/cfd) with no
 * database (any DB access throws). Quotes and OHLC are the real public
 * display sources the router already uses (biquote.io first, then its
 * fallbacks); nothing is fabricated. Every non-GET request is refused and
 * counted; the practice ticket writes only the browser's own localStorage.
 *
 *   node scripts/qa-cfd-workspace.cjs --dist <frontend dist> --out <dir> --phase before|after [--widths 1920,1440] [--only shots,chart,...]
 *   node scripts/qa-cfd-workspace.cjs --dist <dist> --serve           (leave the host up)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const flag = name => args.includes(`--${name}`);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs/qa/cfd-workspace/run')));
const PHASE = arg('phase', 'after');
const PORT = Number(arg('port', '0'));
const WIDTHS = arg('widths', '1920,1440,1366,1024,768,430,390,360,320').split(',').map(Number).filter(Boolean);
const ONLY = new Set((arg('only', '') || '').split(',').filter(Boolean));
const want = id => !ONLY.size || ONLY.has(id);

process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.API_KEY_ENCRYPTION_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'production';
const { CfdMarketDataService } = require(path.join(ROOT, 'dist/services/CfdMarketDataService'));
const { cfdRouter, stopCfdDisplayFeeds } = require(path.join(ROOT, 'dist/api/routes/cfd'));

const report = { phase: PHASE, dist: DIST, startedAt: new Date().toISOString(), environment: 'LOCAL QA ONLY — loopback host, real public CFD display sources, no database, no production writes',
  checks: [], perf: {}, screenshots: [], requests: [], blockedWrites: 0, blockedHosts: [], pageErrors: [] };
const check = (id, pass, detail = {}) => { report.checks.push({ id, pass: !!pass, ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${pass ? '' : ' ' + JSON.stringify(detail).slice(0, 400)}`); };
const note = (id, detail) => { report.checks.push({ id, info: true, ...detail }); console.log(`INFO ${id} ${JSON.stringify(detail).slice(0, 400)}`); };

function host() {
  const noDb = new Proxy({}, { get() { throw new Error('Database access forbidden in CFD QA'); } });
  const cfd = cfdRouter(noDb, new CfdMarketDataService(undefined), noDb);
  const app = express();
  app.use((q, r, next) => {
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(q.socket.remoteAddress)) return r.sendStatus(403);
    r.setHeader('Cache-Control', 'no-store');
    if (q.path.startsWith('/api/')) report.requests.push({ at: Date.now(), method: q.method, path: q.path, query: q.url.split('?')[1] || '' });
    if (!['GET', 'HEAD'].includes(q.method)) { report.blockedWrites++; return r.status(405).json({ error: 'LOCAL QA: writes refused' }); }
    next();
  });
  app.use('/api/v1', (q, r, next) => {
    if (q.path === '/me') return r.json({ id: 'local-cfd-qa', email: 'qa@example.invalid', displayName: 'LOCAL QA', phone: null, country: null, avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: '2026-01-01T00:00:00.000Z' });
    if (q.path.startsWith('/cfd/')) return cfd(q, r, next);
    if (q.path === '/market/external/tickers') return r.json({ source: 'qa', tickers: [] });
    if (q.path === '/support/conversations/mine') return r.json({ conversation: null, messages: [] });
    return r.status(503).json({ error: 'Outside the CFD QA scope', path: q.path });
  });
  app.use(express.static(DIST, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app;
}


// ── Workspace helpers: the same semantics as scripts/qa-chart-workspace.cjs (Spot/Futures) ──
const menuBox = () => {
  const el = document.querySelector('[data-cw-menu], [data-cw-menu-layer] .cw-menu, [data-cw-menu-layer] .cw-sheet');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-cw-menu'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    inside: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 };
};
/** The toolbar row is quiet: measured, no menu open, the same keys at the same place over two reads. */
async function settleToolbar(page, { timeout = 4000 } = {}) {
  const read = () => page.evaluate(() => {
    const row = document.querySelector('[data-cw-toolbar]');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { measured: row.classList.contains('is-measured'), menu: !!document.querySelector('[data-cw-menu]'), box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      keys: [...row.querySelectorAll('[data-cw-feature], [data-cw-tf]')].map(el => { const b = el.getBoundingClientRect(); return `${el.getAttribute('data-cw-feature') || el.getAttribute('data-cw-tf')}@${Math.round(b.left)},${Math.round(b.top)}`; }).join('|') };
  });
  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    const now = await read();
    if (!now) return false;
    if (now.measured && !now.menu && previous && previous.keys === now.keys && previous.box === now.box) return true;
    previous = now;
    await page.waitForTimeout(120);
  }
  return false;
}
/** Open a toolbar feature as a trader does (on the row, or inside «Ещё» / the phone sheet); throws when it never opens. */
async function openFeatureOn(page, feature, { deadline = 12000 } = {}) {
  const until = Date.now() + deadline;
  let last = null;
  while (Date.now() < until) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-cw-menu]'), null, { timeout: 1500 }).catch(() => {});
    await settleToolbar(page, { timeout: Math.max(600, Math.min(4000, until - Date.now())) });
    try {
      const rowKey = page.locator(`[data-cw-toolbar] [data-cw-feature="${feature}"]`).first();
      if ((await rowKey.count()) && (await rowKey.isVisible())) {
        const menuKey = !!(await rowKey.getAttribute('aria-haspopup'));
        await rowKey.click({ timeout: 3000 });
        if (!menuKey) return null;
        await page.locator(`[data-cw-menu="${feature}"]`).waitFor({ state: 'visible', timeout: 3000 });
        return { ...(await page.evaluate(menuBox)), via: 'row' };
      }
      for (const [trigger, list] of [['more', 'more'], ['phone-more', 'phone-sheet']]) {
        const key = page.locator(`[data-cw-toolbar] [data-cw-feature="${trigger}"]`);
        if (!(await key.count()) || !(await key.isVisible())) continue;
        await key.click({ timeout: 3000 });
        const menu = page.locator(`[data-cw-menu="${list}"]`);
        await menu.waitFor({ state: 'visible', timeout: 3000 });
        const part = menu.locator(`[data-cw-section="${feature}"]`).first();
        await part.waitFor({ state: 'visible', timeout: 2000 });
        const listKey = part.locator(`[data-cw-feature="${feature}"]`);
        if (await listKey.count()) { await listKey.first().click({ timeout: 3000 }); return null; }
        return { ...(await page.evaluate(menuBox)), via: list };
      }
      last = 'neither the key nor «Ещё» is on screen';
    } catch (error) { last = String((error && error.message) || error).split('\n')[0].slice(0, 180); }
    await page.waitForTimeout(250);
  }
  throw new Error(`openFeatureOn(${feature}): not open after ${deadline} ms — ${last}`);
}
/** The layout is complete: every extra pane mounted and answered (ok, empty, error or stale — not loading). */
async function waitLayout(page, value, { timeout = 20000 } = {}) {
  await page.waitForFunction(n => {
    const grid = document.querySelector('[data-cw-layout]');
    if (!grid || grid.getAttribute('data-cw-layout') !== String(n)) return false;
    const panes = [...document.querySelectorAll('[data-cw-pane]')];
    if (!grid.classList.contains('is-compact') && panes.length !== n - 1) return false;
    return panes.every(p => ['ok', 'empty', 'error', 'stale'].includes(p.getAttribute('data-cw-pane-state')));
  }, value, { timeout });
  await page.keyboard.press('Escape');
  await settleToolbar(page);
}
async function selectLayout(page, value) {
  if (!(await openFeatureOn(page, 'layout'))) throw new Error('the layout menu did not open');
  await page.locator(`[data-cw-menu] [data-cw-layout-option="${value}"]`).first().click({ timeout: 3000 });
  await waitLayout(page, value);
}
const CHART_STATE = '.cfd-chart-area [data-chart-state]';
const chartState = page => page.getAttribute(CHART_STATE, 'data-chart-state').catch(() => null);
const waitCandles = (page, timeout = 20000) => page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('data-chart-state') === 'candles', CHART_STATE, { timeout }).then(() => true, () => false);
const store = (page, key) => page.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return 'unreadable'; } }, key);
const WS_KEY = 'voltex.chartWorkspace.cfd.v1', IND_KEY = 'voltex.chartIndicators.cfd.v1';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise(resolve => { const s = host().listen(PORT, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('HOST', origin);
  if (flag('serve')) { console.log(`${origin}/trade?market=cfd&symbol=XAUUSD`); return; }
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const denied = new Set();
  const open = async (width, height = width <= 430 ? 860 : width <= 1024 ? 900 : width >= 1920 ? 1080 : 900, opts = {}) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'UTC', serviceWorkers: 'block', hasTouch: width <= 430, isMobile: false });
    await context.addInitScript(({ practice }) => {
      try { localStorage.setItem('exchange_lang', 'ru'); localStorage.setItem('exchange_token', 'local-cfd-qa'); if (practice !== undefined) localStorage.setItem('voltex_cfd_practice_v1', practice); else localStorage.removeItem('voltex_cfd_practice_v1'); } catch {}
    }, { practice: opts.practice });
    await context.route('**/*', route => {
      const q = route.request(), u = new URL(q.url());
      if (u.origin === origin) return route.continue();
      // TradingView's widget and the market edge are outside this host: refused, counted.
      denied.add(u.hostname); return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const requests = [], sockets = [];
    page.on('request', q => { const u = new URL(q.url()); if (u.origin === origin && u.pathname.startsWith('/api/')) requests.push({ t: Date.now(), method: q.method(), path: u.pathname, interval: u.searchParams.get('interval'), limit: u.searchParams.get('limit') }); });
    page.on('websocket', ws => sockets.push(ws.url()));
    page.on('pageerror', e => report.pageErrors.push({ width, error: String(e.message).slice(0, 300) }));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(m.text())) report.pageErrors.push({ width, console: m.text().slice(0, 300) }); });
    return { context, page, requests, sockets };
  };
  const goto = async (page, symbol = 'XAUUSD') => {
    await page.goto(`${origin}/trade?market=cfd&symbol=${symbol}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.cfd-option').length >= 13, null, { timeout: 45000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.cfd-option .cfd-price')].some(n => /\d/.test(n.textContent || '')), null, { timeout: 45000 });
    await page.waitForFunction(() => !!document.querySelector('.cfd-chart-area canvas'), null, { timeout: 30000 });
    await waitCandles(page, 30000);
    await page.waitForTimeout(1200);
  };
  const shot = async (page, name, opts = {}) => { const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, ...opts }); report.screenshots.push(path.relative(OUT, file)); };
  const cfdCandleRequests = (requests, from = 0) => requests.slice(from).filter(r => r.path.startsWith('/api/v1/cfd/display/candles/'));

  if (want('shots')) {
    for (const width of WIDTHS) {
      const { context, page } = await open(width);
      try {
        await goto(page);
        const m = await page.evaluate(() => {
          const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
          const bar = document.querySelector('.cfd-ticker-bar');
          const metrics = bar ? [...bar.children].map(c => box(c)) : [];
          const used = metrics.reduce((s, b) => s + (b ? b.w : 0), 0);
          const names = [...document.querySelectorAll('.cfd-option')].map(row => {
            const n = row.querySelector('.cfd-optionName');
            return { symbol: row.querySelector('.cfd-optionSymbol')?.textContent?.trim(), clipped: n ? n.scrollWidth > n.clientWidth + 1 : null };
          });
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            tickerBar: box(bar), tickerUsedPx: used,
            chart: box(document.querySelector('.cfd-chart-area')), list: box(document.querySelector('.cfd-instruments-area')),
            form: box(document.querySelector('.cfd-form-area')), bottom: box(document.querySelector('.cfd-bottom-panel')),
            namesClipped: names.filter(n => n.clipped).map(n => n.symbol),
            toolbarButtons: [...document.querySelectorAll('.cfd-chart-area button')].filter(b => b.offsetParent).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim()).slice(0, 40),
            intervals: [...document.querySelectorAll('.cfd-chart-area [data-cw-tf], .cfd-chart-intervals button')].map(b => b.getAttribute('data-cw-tf') || b.textContent?.trim()),
          };
        });
        report.perf[`layout.${width}`] = m;
        note(`layout.${width}`, m);
        const file = path.join(OUT, `cfd-${PHASE}-${width}.png`);
        await page.screenshot({ path: file, fullPage: width <= 1024 });
        report.screenshots.push(path.relative(OUT, file));
      } catch (error) {
        check(`shots.${width}`, false, { error: String(error.message).slice(0, 300) });
        await page.screenshot({ path: path.join(OUT, `cfd-${PHASE}-${width}-failure.png`) }).catch(() => {});
      } finally { await context.close(); }
    }
  }

  // ── The workspace on the CFD chart, 1440 ─────────────────────────────
  if (want('chart')) {
    const { context, page, requests, sockets } = await open(1440, 900);
    const P = 'cfd.1440';
    try {
      const t0 = Date.now();
      await goto(page, 'XAUUSD');
      report.perf[`${P}.openToCandlesMs`] = Date.now() - t0;
      const base = await page.evaluate(() => ({
        toolbar: !!document.querySelector('.cfd-chart-area [data-cw-toolbar]'), views: [...document.querySelectorAll('.cfd-chart-area button[data-cw-view]')].map(b => b.getAttribute('data-cw-view')),
        rail: !!document.querySelector('.cfd-chart-area [data-drawing-tool]'), quick: [...document.querySelectorAll('.cfd-chart-area [data-cw-tf]')].map(b => b.getAttribute('data-cw-tf')),
        settings: !!document.querySelector('.cfd-chart-area .chart-settings-trigger'), old: document.querySelectorAll('.cfd-owned-chart, .cfd-chart-toolbar').length,
      }));
      const notes = await page.evaluate(() => ({ insufficient: document.querySelectorAll('.cfd-chart-area [data-indicator-insufficient]').length, orderNote: document.querySelectorAll('.cfd-order-type-note').length, legend: [...document.querySelectorAll('.cfd-chart-area .voltex-indicator-legend > *')].map(e => e.textContent.trim()) }));
      check(`${P}.no-notes`, notes.insufficient === 0 && notes.orderNote === 0, notes);
      check(`${P}.workspace.present`, base.toolbar && base.views.join(',') === 'chart,data,analytics' && base.rail && base.settings && base.old === 0 && base.quick.length >= 5, base);

      // Stats bar: verified figures only.
      const stats = await page.evaluate(() => { const bar = document.querySelector('[data-cfd-stats]'); return { stats: [...(bar?.querySelectorAll('[data-cfd-stat]') || [])].map(e => e.getAttribute('data-cfd-stat')), text: bar?.textContent || '', status: bar?.querySelector('[data-cfd-status]')?.getAttribute('data-cfd-status') }; });
      check(`${P}.stats.verified-only`, ['price', 'change', 'high', 'low', 'updated', 'status'].every(k => stats.stats.includes(k)) && !/фандинг|funding|открытый интерес|open interest|объ[её]м|volume|оборот|turnover/i.test(stats.text), stats);
      note(`${P}.stats.bidask`, { bidask: stats.stats.includes('bidask'), spread: stats.stats.includes('spread'), source: 'local backend /cfd/tickers (the market edge needs its own deploy)' });

      // Timeframes: the native seven by name, the derived six built from their base bars (never asked of the route).
      const tfResults = {};
      const pickTf = async tf => {
        const onStrip = page.locator(`.cfd-chart-area [data-cw-toolbar] [data-cw-tf="${tf}"]`);
        if ((await onStrip.count()) && (await onStrip.first().isVisible())) await onStrip.first().click();
        else { await openFeatureOn(page, 'timeframes'); await page.locator(`[data-cw-tf-option="${tf}"]`).click(); }
      };
      for (const tf of ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M']) {
        const from = requests.length, t = Date.now();
        await pickTf(tf);
        await page.waitForTimeout(250);
        const ok = await waitCandles(page, 15000);
        await page.waitForTimeout(250);
        const asked = cfdCandleRequests(requests, from).map(r => r.interval);
        const ws = await store(page, WS_KEY);
        tfResults[tf] = { state: await chartState(page), ms: Date.now() - t, asked, stored: ws?.timeframe };
        check(`${P}.timeframe.${tf}`, ok && ws?.timeframe === tf && asked.every(i => ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(i)), tfResults[tf]);
      }
      const menuOptions = await (async () => { await openFeatureOn(page, 'timeframes'); const o = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf-option]')].map(e => ({ tf: e.getAttribute('data-cw-tf-option'), disabled: e.disabled }))); await page.keyboard.press('Escape'); return o; })();
      check(`${P}.timeframe.menu-all-13`, menuOptions.length === 13 && menuOptions.every(o => !o.disabled), { menuOptions });
      await shot(page, `cfd-${PHASE}-1440-1M`);
      await pickTf('1h'); await waitCandles(page);

      // Chart types: drawn bars change, the execution price does not.
      const priceOf = () => page.evaluate(() => ({ ticker: document.querySelector('.cfd-ticker-price')?.textContent?.trim(), ticket: document.querySelector('.cfd-referencePrice')?.textContent?.trim() }));
      const priceBefore = await priceOf();
      for (const kind of ['bars', 'hollow', 'heikin', 'line', 'area', 'candles']) {
        await page.keyboard.press('Escape');
        await page.locator('.cfd-chart-area .chart-type-trigger').click(); await page.waitForTimeout(150);
        const item = page.locator(`[data-chart-type="${kind}"]`); const present = await item.count();
        if (present) await item.first().click();
        await page.waitForTimeout(300);
        const ws = await store(page, WS_KEY), price = await priceOf();
        check(`${P}.type.${kind}`, present && ws?.barType === kind && price.ticker === priceBefore.ticker && price.ticket === priceBefore.ticket, { present, barType: ws?.barType, priceBefore, price });
        if (kind === 'heikin') await shot(page, `cfd-${PHASE}-1440-heikin`);
      }

      // Indicators: the catalogue without the two that need traded volume; CFD keeps its own list.
      const spotIndicatorsBefore = await store(page, 'voltex.chartIndicators.spot.v1');
      await page.keyboard.press('Escape');
      await page.locator('.cfd-chart-area .chart-indicators-trigger').click(); await page.waitForTimeout(200);
      const catalogue = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-chart-indicator]')].map(e => e.getAttribute('data-chart-indicator')))]);
      for (const key of ['rsi', 'ema']) { const row = page.locator(`[data-chart-indicator="${key}"]`).first(); if (await row.count()) await row.click(); await page.waitForTimeout(250); }
      await page.keyboard.press('Escape');
      const ind = await store(page, IND_KEY);
      const types = Array.isArray(ind) ? ind.map(i => i.type) : ind?.indicators?.map?.(i => i.type) ?? [];
      check(`${P}.indicators.no-volume-indicators`, catalogue.length >= 12 && !catalogue.includes('vwap') && !catalogue.includes('obv'), { catalogue });
      check(`${P}.indicators.own-store`, types.includes('rsi') && JSON.stringify(await store(page, 'voltex.chartIndicators.spot.v1')) === JSON.stringify(spotIndicatorsBefore), { types });
      await shot(page, `cfd-${PHASE}-1440-indicators`);

      // Data window and analytics: no volume row, no request while hovering.
      await page.locator('.cfd-chart-area [data-cw-view="data"]').click(); await page.waitForTimeout(300);
      const canvas = await page.locator('.cfd-chart-area canvas').first().boundingBox();
      const hoverFrom = requests.length;
      for (let i = 0; i < 20; i += 1) await page.mouse.move(canvas.x + canvas.width * (0.3 + i * 0.02), canvas.y + canvas.height * 0.4);
      await page.waitForTimeout(300);
      const dw = await page.evaluate(() => { const el = document.querySelector('[data-cw-data-window]'); return el ? { rows: el.querySelectorAll('dt').length, labels: [...el.querySelectorAll('dt')].map(d => d.textContent.trim()) } : null; });
      check(`${P}.data.window`, dw && dw.rows >= 5 && !dw.labels.some(l => /объ[её]м|volume/i.test(l)) && requests.length === hoverFrom, { ...dw, hoverRequests: requests.length - hoverFrom });
      await shot(page, `cfd-${PHASE}-1440-data`);
      await page.locator('.cfd-chart-area [data-cw-view="analytics"]').click(); await page.waitForTimeout(400);
      const an = await page.evaluate(() => ({ blocks: document.querySelectorAll('[data-cw-analytics-block]').length, text: document.querySelector('[data-cw-analytics]')?.textContent?.slice(0, 200) }));
      check(`${P}.analytics.panel`, an.blocks >= 2 && !/объ[её]м|volume/i.test(an.text || ''), an);
      await shot(page, `cfd-${PHASE}-1440-analytics`);
      await page.locator('.cfd-chart-area [data-cw-view="chart"]').click(); await page.waitForTimeout(200);

      // Compare: the other twelve CFD instruments, in percent.
      await openFeatureOn(page, 'compare');
      const options = await page.evaluate(() => [...document.querySelectorAll('[data-cw-compare-option]')].map(e => e.getAttribute('data-cw-compare-option')));
      // The panel lists eight at a time (as on Spot); the rest are a search away.
      await page.locator('[data-cw-compare-search]').fill('NZD'); await page.waitForTimeout(150);
      const searched = await page.evaluate(() => [...document.querySelectorAll('[data-cw-compare-option]')].map(e => e.getAttribute('data-cw-compare-option')));
      for (const sym of ['EURUSD', 'XAGUSD']) {
        if (!(await page.locator('[data-cw-compare-search]').count())) await openFeatureOn(page, 'compare');
        await page.locator('[data-cw-compare-search]').fill(sym.slice(0, 3)); await page.waitForTimeout(150);
        await page.locator(`[data-cw-compare-option="${sym}"]`).first().click(); await page.waitForTimeout(900);
      }
      await page.waitForFunction(() => [...document.querySelectorAll('[data-cw-compare-value]')].length >= 2 && [...document.querySelectorAll('[data-cw-compare-value]')].every(el => /%|—/.test(el.textContent || '')), null, { timeout: 10000 }).catch(() => {});
      const cmp = await page.evaluate(() => ({ entries: document.querySelectorAll('[data-cw-compare-entry]').length, values: [...document.querySelectorAll('[data-cw-compare-value]')].map(e => `${e.getAttribute('data-cw-compare-value')} ${e.textContent}`) }));
      check(`${P}.compare.cfd-instruments`, options.length === 8 && !options.includes('XAUUSD') && options.every(o => /^[A-Z]{6}$/.test(o)) && searched.join() === 'NZDUSD' && cmp.entries === 2 && cmp.values.some(v => /EURUSD .*%/.test(v)), { options, searched, ...cmp });
      await shot(page, `cfd-${PHASE}-1440-compare`);
      await openFeatureOn(page, 'compare'); await page.locator('[data-cw-compare-exit]').click(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
      check(`${P}.compare.exit`, (await chartState(page)) === 'candles' && (await store(page, WS_KEY))?.compare?.length === 0, {});

      // Two charts: another instrument and interval in the second, sync, switch the terminal, back to one.
      const l2From = requests.length, tl = Date.now();
      await selectLayout(page, 2);
      report.perf[`${P}.layout2Ms`] = Date.now() - tl;
      const paneOptions = await page.evaluate(() => [...document.querySelectorAll('[data-cw-pane="1"] [data-cw-pane-symbol] option')].map(o => o.value).filter(Boolean));
      await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'EURUSD');
      await page.selectOption('[data-cw-pane="1"] [data-cw-pane-timeframe]', '4h');
      await page.waitForFunction(() => document.querySelector('[data-cw-pane="1"]')?.getAttribute('data-cw-pane-state') === 'ok', null, { timeout: 15000 }).catch(() => {});
      const pane = await page.evaluate(() => ({ state: document.querySelector('[data-cw-pane="1"]')?.getAttribute('data-cw-pane-state'), tickets: document.querySelectorAll('.cfd-form-area').length, layout: document.querySelector('[data-cw-layout]')?.getAttribute('data-cw-layout') }));
      const paneAsked = cfdCandleRequests(requests, l2From).filter(r => /EURUSD/.test(r.path)).map(r => r.interval);
      check(`${P}.layout2.own-instrument-and-interval`, pane.state === 'ok' && pane.layout === '2' && pane.tickets === 1 && paneOptions.length >= 12 && paneOptions.every(o => /^[A-Z]{6}$/.test(o)) && paneAsked.includes('4h'), { ...pane, paneOptions, paneAsked });
      await shot(page, `cfd-${PHASE}-1440-layout2`);
      await openFeatureOn(page, 'layout');
      await page.locator('[data-cw-sync="cursor"]').check(); await page.locator('[data-cw-sync="timeframe"]').check(); await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const synced = await store(page, WS_KEY);
      check(`${P}.layout2.sync`, synced?.syncCursor === true && synced?.syncTimeframe === true, { syncCursor: synced?.syncCursor, syncTimeframe: synced?.syncTimeframe });
      await openFeatureOn(page, 'layout'); await page.locator('[data-cw-sync="timeframe"]').uncheck(); await page.keyboard.press('Escape');
      const tradeWrites = report.blockedWrites;
      await page.locator('[data-cw-pane="1"] [data-cw-pane-trade]').click(); await page.waitForTimeout(900);
      await waitCandles(page);
      const switched = await page.evaluate(() => ({ url: location.search, active: document.querySelector('.cfd-option.active')?.getAttribute('data-cfd-symbol'), bar: document.querySelector('[data-cfd-stats] .cfd-symbol')?.textContent?.trim() }));
      check(`${P}.layout2.pane-switches-terminal`, /symbol=EURUSD/.test(switched.url) && switched.active === 'EURUSD' && switched.bar === 'EURUSD' && report.blockedWrites === tradeWrites, switched);
      const tfBeforeOne = (await store(page, WS_KEY))?.timeframe;
      await selectLayout(page, 1);
      const one = { panes: await page.locator('[data-cw-pane]').count(), state: await chartState(page), tf: (await store(page, WS_KEY))?.timeframe };
      check(`${P}.layout.back-to-one-keeps-state`, one.panes === 0 && one.state === 'candles' && one.tf === tfBeforeOne, one);
      // and back to gold for the rest
      await page.locator('.cfd-option[data-cfd-symbol="XAUUSD"]').click(); await waitCandles(page);

      // Drawing tools and the ruler, in CFD's own drawing store.
      const drawKey = 'voltex.drawings.cfd.XAUUSD';
      const spotDrawBefore = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('voltex.drawings.spot')).length);
      const box = await page.locator('.cfd-chart-area canvas').first().boundingBox();
      // Alt+H: the horizontal-line tool (its rail key sits inside the lines flyout).
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
      await page.keyboard.press('Alt+KeyH'); await page.waitForTimeout(150);
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45); await page.waitForTimeout(500);
      const drawn = await store(page, drawKey);
      check(`${P}.drawing.horizontal`, Array.isArray(drawn?.drawings) && drawn.drawings.some(d => d.kind === 'horizontal'), { drawings: drawn?.drawings?.map(d => d.kind) });
      await page.locator('.cfd-chart-area [data-drawing-tool="ruler"]').first().click().catch(() => {});
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
      const ruler = await page.evaluate(() => { const g = document.querySelector('.cfd-chart-area g[data-drawing-kind="ruler"]'); return g ? { text: [...g.querySelectorAll('text')].map(t => t.textContent).join(' | ').slice(0, 200) } : null; });
      check(`${P}.drawing.ruler`, !!ruler && /\d/.test(ruler.text), ruler || {});
      await shot(page, `cfd-${PHASE}-1440-drawings`);
      const spotDrawAfter = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('voltex.drawings.spot')).length);
      check(`${P}.drawing.isolated-from-spot`, spotDrawAfter === spotDrawBefore, { spotDrawBefore, spotDrawAfter });
      await page.keyboard.press('Escape');

      // Templates: a built-in preset brings no volume indicator to CFD.
      await openFeatureOn(page, 'presets');
      const presets = await page.evaluate(() => [...document.querySelectorAll('[data-cw-preset]')].map(e => e.getAttribute('data-cw-preset')));
      await page.locator('[data-cw-preset="builtin-scalping"]').first().click(); await page.waitForTimeout(700);
      const afterPreset = { ws: await store(page, WS_KEY), ind: await store(page, IND_KEY) };
      const presetTypes = (Array.isArray(afterPreset.ind) ? afterPreset.ind : []).map(i => i.type);
      check(`${P}.presets.builtin`, presets.length >= 2 && afterPreset.ws?.timeframe === '5m' && !presetTypes.includes('vwap') && !presetTypes.includes('obv'), { presets, timeframe: afterPreset.ws?.timeframe, presetTypes });
      await openFeatureOn(page, 'presets'); await page.locator('[data-cw-preset-reset]').click(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
      check(`${P}.presets.reset`, (await store(page, WS_KEY))?.timeframe === '1h', { timeframe: (await store(page, WS_KEY))?.timeframe });

      // Go to a date inside the loaded window; a future date is refused.
      await waitCandles(page);
      await openFeatureOn(page, 'goto');
      const twoDays = new Date(Date.now() - 2 * 86400000); twoDays.setUTCMinutes(0, 0, 0);
      await page.locator('[data-cw-goto-input]').fill(twoDays.toISOString().slice(0, 16));
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(700);
      const gotoClosed = !(await page.locator('[data-cw-goto]').count());
      await openFeatureOn(page, 'goto');
      await page.locator('[data-cw-goto-input]').fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16));
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(300);
      const futureWarn = await page.evaluate(() => document.querySelector('[data-cw-goto] [role="status"]')?.textContent || '');
      await page.keyboard.press('Escape');
      check(`${P}.goto`, gotoClosed && futureWarn.length > 0, { gotoClosed, futureWarn });

      // Chart settings dialog.
      await page.locator('.cfd-chart-area .chart-settings-trigger').click(); await page.waitForTimeout(300);
      const dialog = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? { text: d.textContent.slice(0, 120) } : null; });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check(`${P}.settings.dialog`, !!dialog && !(await page.locator('[role="dialog"]').count()), dialog || {});

      // Snapshot PNG.
      await openFeatureOn(page, 'snapshot');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('[data-cw-snapshot-download]').click()]);
      let size = 0;
      if (download) { const file = path.join(OUT, `snapshot-cfd-${PHASE}.png`); await download.saveAs(file); size = fs.statSync(file).size; report.screenshots.push(path.basename(file)); }
      check(`${P}.snapshot.png`, !!download && size > 10000 && /\.png$/.test(download.suggestedFilename()), { file: download?.suggestedFilename(), size });
      await page.keyboard.press('Escape');

      // Full screen and Escape.
      await openFeatureOn(page, 'fullscreen'); await page.waitForTimeout(500);
      const fsOn = await page.evaluate(() => ({ attr: !!document.querySelector('[data-cw-fullscreen]'), w: document.querySelector('.cfd-chart-area .terminal-chart-shell')?.getBoundingClientRect().width }));
      await shot(page, `cfd-${PHASE}-1440-fullscreen`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      const fsOff = await page.evaluate(() => !!document.querySelector('[data-cw-fullscreen]'));
      check(`${P}.fullscreen`, fsOn.attr && fsOn.w >= 1400 && !fsOff, { ...fsOn, afterEscape: fsOff });

      // Keyboard: a digit picks the quick interval; typing in a field does not.
      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('3'); await page.waitForTimeout(500);
      const digit = (await store(page, WS_KEY))?.timeframe;
      await page.locator('.cfd-instruments-area input[type="search"]').fill('');
      await page.locator('.cfd-instruments-area input[type="search"]').type('5'); await page.waitForTimeout(300);
      const typed = (await store(page, WS_KEY))?.timeframe;
      await page.locator('.cfd-instruments-area input[type="search"]').fill('');
      check(`${P}.keyboard.digits`, digit === '15m' && typed === '15m', { digit, typed });

      const candleCalls = cfdCandleRequests(requests);
      report.perf[`${P}.requests`] = { total: requests.length, candles: candleCalls.length, tickers: requests.filter(r => r.path === '/api/v1/cfd/display/tickers').length, byInterval: candleCalls.reduce((m, r) => (m[r.interval] = (m[r.interval] || 0) + 1, m), {}) };
      check(`${P}.network.no-sockets-no-writes`, sockets.length === 0 && requests.every(r => ['GET', 'HEAD'].includes(r.method)), { sockets, writes: requests.filter(r => !['GET', 'HEAD'].includes(r.method)).length, ...report.perf[`${P}.requests`] });
      report.perf[`${P}.heapMB`] = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    } catch (error) {
      check(`${P}.fatal`, false, { error: String(error.message).slice(0, 400) });
      await page.screenshot({ path: path.join(OUT, `cfd-${PHASE}-1440-chart-failure.png`) }).catch(() => {});
    } finally { await context.close(); }
  }

  // ── Four charts, 1920 ─────────────────────────────────────────────────
  if (want('layout4')) {
    const { context, page } = await open(1920, 1080);
    try {
      await goto(page, 'XAUUSD');
      const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null), t = Date.now();
      await selectLayout(page, 4);
      report.perf['cfd.1920.layout4Ms'] = Date.now() - t;
      const l4 = await page.evaluate(() => ({ panes: [...document.querySelectorAll('[data-cw-pane]')].map(p => `${p.querySelector('[data-cw-pane-symbol]')?.value}:${p.getAttribute('data-cw-pane-state')}`), overflow: document.documentElement.scrollWidth > innerWidth + 1, tickets: document.querySelectorAll('.cfd-form-area').length }));
      const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
      check('cfd.1920.layout4', l4.panes.length === 3 && l4.panes.every(p => /:ok$/.test(p)) && new Set(l4.panes.map(p => p.split(':')[0])).size === 3 && !l4.overflow && l4.tickets === 1, { ...l4, ms: report.perf['cfd.1920.layout4Ms'], heapBefore, heapAfter });
      await shot(page, `cfd-${PHASE}-1920-layout4`);
      await selectLayout(page, 1);
      check('cfd.1920.layout4.back-to-one', (await page.locator('[data-cw-pane]').count()) === 0 && (await chartState(page)) === 'candles', {});
    } catch (error) { check('cfd.1920.layout4.fatal', false, { error: String(error.message).slice(0, 400) }); }
    finally { await context.close(); }
  }

  // ── Market list: names, groups, search, fast switching, one shared feed ──
  if (want('list')) {
    const { context, page, requests } = await open(1440, 900);
    try {
      await goto(page, 'XAUUSD');
      await page.waitForTimeout(1500);
      const l = await page.evaluate(() => ({
        groups: [...document.querySelectorAll('[data-cfd-group]')].map(g => `${g.getAttribute('data-cfd-group')}:${g.querySelectorAll('.cfd-option').length}`),
        rows: [...document.querySelectorAll('.cfd-option')].map(r => ({ s: r.getAttribute('data-cfd-symbol'), name: r.querySelector('.cfd-optionName')?.textContent?.trim(), clipped: (n => n ? n.scrollWidth > n.clientWidth + 1 : null)(r.querySelector('.cfd-optionName')), change: r.querySelector('.cfd-change')?.textContent?.trim(), icon: r.querySelector('[data-cfd-mark]')?.getAttribute('data-cfd-mark') })),
        active: document.querySelector('.cfd-option.active')?.getAttribute('data-cfd-symbol'), barChange: document.querySelector('.cfd-ticker-change')?.textContent?.trim(),
        flags: [...document.querySelectorAll('.cfd-option img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
      }));
      check('cfd.list.groups', l.groups.join(' ') === 'metals:4 energy:2 forex:7', { groups: l.groups });
      check('cfd.list.readable-names', l.rows.length === 13 && l.rows.every(r => r.name && r.name !== r.s && r.clipped === false), { rows: l.rows.map(r => `${r.s}=${r.name}${r.clipped ? ' (clipped)' : ''}`) });
      check('cfd.list.identity-marks', l.rows.every(r => r.icon) && l.flags.length === 14 && l.flags.every(f => f.ok && !/^https?:/.test(f.src)), { icons: l.rows.map(r => `${r.s}:${r.icon}`), flags: l.flags.length, broken: l.flags.filter(f => !f.ok) });
      const activeRow = l.rows.find(r => r.s === l.active);
      check('cfd.list.change-matches-strip', !!activeRow && !!l.barChange && activeRow.change !== '—' && l.barChange.includes(activeRow.change.replace('+', '')), { list: activeRow?.change, bar: l.barChange });
      await page.locator('.cfd-instruments-area input[type="search"]').fill('евро'); await page.waitForTimeout(250);
      const found = await page.evaluate(() => [...document.querySelectorAll('.cfd-option')].map(r => r.getAttribute('data-cfd-symbol')));
      await page.locator('.cfd-instruments-area input[type="search"]').fill('XAG'); await page.waitForTimeout(250);
      const found2 = await page.evaluate(() => [...document.querySelectorAll('.cfd-option')].map(r => r.getAttribute('data-cfd-symbol')));
      await page.locator('.cfd-instruments-area input[type="search"]').fill('');
      check('cfd.list.search', found.includes('EURUSD') && found.every(s => /EUR/.test(s)) && found2.join() === 'XAGUSD', { found, found2 });
      // Fast switching: five instruments in a row, the last one wins.
      const tickersBefore = requests.filter(r => r.path === '/api/v1/cfd/display/tickers').length, t = Date.now();
      for (const sym of ['EURUSD', 'WTIUSD', 'USDJPY', 'XPTUSD', 'GBPUSD']) await page.locator(`.cfd-option[data-cfd-symbol="${sym}"]`).click();
      const settled = await waitCandles(page);
      const sw = await page.evaluate(() => ({ url: location.search, active: document.querySelector('.cfd-option.active')?.getAttribute('data-cfd-symbol'), bar: document.querySelector('[data-cfd-stats] .cfd-symbol')?.textContent?.trim(), ticket: document.querySelector('.cfd-referencePrice')?.textContent?.trim() }));
      report.perf['cfd.list.fiveSwitchesMs'] = Date.now() - t;
      check('cfd.list.fast-switch', settled && /symbol=GBPUSD/.test(sw.url) && sw.active === 'GBPUSD' && sw.bar === 'GBPUSD' && /\d/.test(sw.ticket || '') && requests.filter(r => r.path === '/api/v1/cfd/display/tickers').length === tickersBefore, { ...sw, ms: report.perf['cfd.list.fiveSwitchesMs'] });
      await page.locator('.cfd-column-sorts button').nth(1).click(); await page.waitForTimeout(200);
      const sorted = await page.evaluate(() => [...document.querySelectorAll('[data-cfd-group]')].map(g => g.getAttribute('data-cfd-group')));
      check('cfd.list.sort-flattens-groups', sorted.join() === 'sorted', { sorted });
      const dailyCalls = requests.filter(r => r.path.startsWith('/api/v1/cfd/display/candles/') && r.interval === '1d' && r.limit === '20').length;
      check('cfd.list.daily-series-bounded', dailyCalls <= 13, { dailyCalls, note: 'one 20-bar daily request per instrument at most, six-hour cache' });
    } catch (error) { check('cfd.list.fatal', false, { error: String(error.message).slice(0, 400) }); }
    finally { await context.close(); }
  }

  // ── Practice trade cycle on the snapshot quote (browser storage only) ──
  if (want('trade')) for (const width of [1440, 390]) {
    const { context, page } = await open(width);
    const P = `cfd.trade.${width}`;
    try {
      await goto(page, 'XAUUSD');
      const mobile = width <= 900;
      const tab = async id => { if (mobile) { await page.locator(`#mobile-trade-${id}`).click(); await page.waitForTimeout(300); } };
      const writesBefore = report.blockedWrites;
      await tab('trade');
      const submit = page.locator('.cfd-order-panel button[type=submit]');
      check(`${P}.ticket.market-only`, (await page.locator('.cfd-order-type').innerText()).trim().length > 0 && (await page.locator('.cfd-order-panel .order-family-tabs button').count()) === 0, {});
      await page.locator('.cfd-order-panel input[type=number]').fill('');
      check(`${P}.ticket.empty-quantity-disabled`, await submit.isDisabled(), {});
      await page.locator('.cfd-order-panel input[type=number]').fill('0.2');
      const preview = await page.evaluate(() => [...document.querySelectorAll('.cfd-infoRow')].map(r => r.textContent.trim()));
      await submit.click(); await page.waitForTimeout(400);
      await page.locator('.cfd-sideTab').nth(1).click();
      await page.locator('.cfd-order-panel input[type=number]').fill('0.1'); await submit.click(); await page.waitForTimeout(400);
      await tab('account');
      const rows = await page.evaluate(() => [...document.querySelectorAll('.cfd-position-content tbody tr[data-cfd-position]')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
      check(`${P}.open-long-and-short`, rows.length === 2 && rows.some(r => /Long|Лонг|Покуп/i.test(r)) && rows.some(r => /Short|Шорт|Продаж/i.test(r)), { rows, preview });
      // Close half of the long, then the rest.
      const longRow = page.locator('.cfd-position-content tbody tr[data-cfd-position]').filter({ hasText: /0\.2/ }).first();
      await longRow.locator('.cfd-partialBtn').click(); await page.waitForTimeout(200);
      const prefilled = await page.locator('.cfd-partial-form input').inputValue();
      await page.locator('.cfd-partial-form input').fill('5'); await page.locator('.cfd-partialSubmit').click(); await page.waitForTimeout(200);
      const refused = await page.evaluate(() => document.querySelector('.cfd-wrap .cfd-error')?.textContent || '');
      await page.locator('.cfd-partial-chips button', { hasText: '50%' }).click(); await page.locator('.cfd-partialSubmit').click(); await page.waitForTimeout(400);
      const state1 = await page.evaluate(() => JSON.parse(localStorage.getItem('voltex_cfd_practice_v1') || 'null'));
      check(`${P}.partial-close`, prefilled === '0.1' && refused.length > 0 && state1.open.length === 2 && state1.open.some(p => p.size === '0.1' && p.side === 'LONG') && state1.history.length === 1 && state1.history[0].size === '0.1', { prefilled, refused, open: state1.open.map(p => `${p.side} ${p.size}`), history: state1.history.map(p => `${p.side} ${p.size} ${p.realizedPnl}`) });
      while (await page.locator('.cfd-position-content tbody tr[data-cfd-position]').count()) { await page.locator('.cfd-position-content tbody tr[data-cfd-position] .cfd-closeBtn:not(.cfd-partialBtn)').first().click(); await page.waitForTimeout(300); }
      await page.locator('.cfd-tab').nth(1).click(); await page.waitForTimeout(200);
      const hist = await page.evaluate(() => document.querySelectorAll('.cfd-position-content tbody tr').length);
      const state2 = await page.evaluate(() => JSON.parse(localStorage.getItem('voltex_cfd_practice_v1') || 'null'));
      check(`${P}.close-all-and-history`, state2.open.length === 0 && state2.history.length === 3 && hist === 3 && report.blockedWrites === writesBefore, { history: state2.history.map(p => `${p.side} ${p.size} ${p.realizedPnl}`), writesRefused: report.blockedWrites - writesBefore });
      await shot(page, `cfd-${PHASE}-${width}-history`, { fullPage: mobile });
      await page.locator('.cfd-tab').nth(0).click();
      const empty = await page.evaluate(() => ({ h: Math.round(document.querySelector('.cfd-bottom-panel')?.getBoundingClientRect().height || 0), text: document.querySelector('.cfd-empty')?.textContent?.trim() }));
      check(`${P}.empty-state-compact`, !!empty.text && (mobile || empty.h <= 140), empty);
    } catch (error) {
      check(`${P}.fatal`, false, { error: String(error.message).slice(0, 400) });
      await page.screenshot({ path: path.join(OUT, `cfd-${PHASE}-${width}-trade-failure.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }

  // ── Phones: the chart tab carries the workspace, nothing overflows ──
  if (want('mobile')) for (const width of [430, 390, 360, 320]) {
    const { context, page } = await open(width);
    const P = `cfd.mobile.${width}`;
    try {
      await goto(page, 'XAUUSD');
      await page.locator('#mobile-trade-chart').click().catch(() => {}); await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, toolbar: !!document.querySelector('.cfd-chart-area [data-cw-toolbar]'), sheet: !!document.querySelector('[data-cw-feature="phone-more"]'), canvas: (document.querySelector('.cfd-chart-area canvas')?.getBoundingClientRect().width || 0) > 200, stats: document.querySelectorAll('[data-cfd-stat]').length }));
      let sheet = null;
      if (m.sheet) { await page.locator('[data-cw-feature="phone-more"]').click(); await page.waitForTimeout(300); sheet = await page.evaluate(menuBox); await page.keyboard.press('Escape'); }
      check(`${P}.chart`, !m.overflow && m.toolbar && m.canvas && m.stats >= 4 && (!sheet || sheet.inside), { ...m, sheet });
      await page.locator('#mobile-trade-trade').click().catch(() => {}); await page.waitForTimeout(300);
      const t = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, submit: (document.querySelector('.cfd-submit')?.getBoundingClientRect().width || 0) > 100 }));
      check(`${P}.ticket`, !t.overflow && t.submit, t);
    } catch (error) { check(`${P}.fatal`, false, { error: String(error.message).slice(0, 400) }); }
    finally { await context.close(); }
  }

  await browser.close();
  report.blockedHosts = [...denied].sort();
}

main().catch(error => { report.fatal = { message: String(error && error.message), stack: String(error && error.stack).slice(0, 2000) }; console.error('FATAL', error); process.exitCode = 2; })
  .finally(() => {
    if (flag('serve')) return;
    stopCfdDisplayFeeds();
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `report-${PHASE}.json`), JSON.stringify(report, null, 2));
    const failed = report.checks.filter(c => c.pass === false).length;
    console.log(`DONE ${PHASE}: ${report.checks.filter(c => c.pass === true).length} pass, ${failed} fail, ${report.pageErrors.length} page errors, ${report.blockedWrites} writes refused`);
    if (failed && !process.exitCode) process.exitCode = 1;
    setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
  });
