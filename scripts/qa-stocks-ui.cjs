// Stocks panel/overview browser QA. Built UI, isolated read-only fixtures:
// crypto pages use the terminal QA's Express fixtures; Stocks reads the REAL
// stock server (services/stocks/server.mjs) over a disposable SQLite file of
// generated candles (scripts/qa-stocks-ui-fixture.mjs). Never contacts a
// provider or production; writes are refused. Every screenshot carries a
// "demo data" badge.
//
// Build first:  VITE_STOCKS_ENABLED=true VITE_STOCKS_ORIGIN=http://127.0.0.1:4431 npm run build --prefix frontend
// Optional:     QA_FLAG_OFF_DIST=<default build>   QA_BEFORE_DIST=<build of the previous head, same flags>
// Run:          QA_PLAYWRIGHT_MODULE=<playwright> node scripts/qa-stocks-ui.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const assert = require('node:assert/strict'), { once } = require('node:events'), { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.QA_OUT || path.join(root, 'output/stocks-ui-qa'));
const SHOTS = path.join(OUT, 'screens');
const ORIGIN = 'http://127.0.0.1:4430', STOCK = 'http://127.0.0.1:4431';
const AFTER_DIST = path.join(root, 'frontend/dist');
const LANGS = ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'];
const AAPL = 'XNGS:AAPL', MSFT = 'XNGS:MSFT', N225 = 'XJPX:N225', GAZP = 'MISX:GAZP', COST = 'XNGS:COST', TINY = 'PINX:MGNT';
const href = id => '/stocks/' + encodeURIComponent(id);
const listLink = id => `.vxs-list-tile .vxs-row > a[href="${href(id)}"]`;
const report = { checks: [], views: [], measurements: {}, pageErrors: [], startedAt: new Date().toISOString() };
const failures = [];
function check(name, ok, detail) { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); }

// Terminal QA fixtures (read-only Express app), pointed at any build.
const terminalQA = fs.readFileSync(path.join(__dirname, 'qa-spot-cfd-terminal.cjs'), 'utf8');
const fixtureSource = terminalQA.slice(0, terminalQA.indexOf('const DESKTOP ='));
assert.ok(fixtureSource.includes("path.resolve(__dirname, '../frontend/dist')"), 'terminal fixture dist path');
function fixtureApp(dist) {
  const module = { exports: {} };
  const source = fixtureSource.replace("path.resolve(__dirname, '../frontend/dist')", JSON.stringify(dist)) + '\nmodule.exports = app;';
  vm.runInNewContext(source, { require, __dirname, process, console, module });
  return module.exports;
}
async function serve(dist) {
  const server = fixtureApp(dist).listen(4430, '127.0.0.1');
  await once(server, 'listening');
  return () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
}

const BADGE = `addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('div'); b.id = 'qa-demo-badge';
  b.textContent = 'DEMO DATA · isolated QA fixtures, not market quotes';
  b.setAttribute('aria-hidden', 'true');
  Object.assign(b.style, { position: 'fixed', left: '8px', bottom: innerWidth <= 860 ? '76px' : '8px', zIndex: '2147483647', padding: '2px 8px', borderRadius: '4px', background: 'rgba(201,51,67,.9)', color: '#fff', font: '600 11px/16px Arial, sans-serif', pointerEvents: 'none' });
  document.body.appendChild(b);
});`;

async function context(browser, { width = 1440, height = 900, lang = 'ru', token = true, video } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'en-US', ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}) });
  await ctx.addInitScript(([l, t]) => {
    localStorage.setItem('exchange_lang', l);
    if (t) localStorage.setItem('exchange_token', 'isolated-qa');
    // Count live streams opened by any page, to prove Stocks adds none.
    const ES = window.EventSource, WS = window.WebSocket;
    window.__qaStreams = { eventSource: 0, webSocket: 0 };
    if (ES) window.EventSource = class extends ES { constructor(...a) { super(...a); window.__qaStreams.eventSource++; } };
    if (WS) window.WebSocket = class extends WS { constructor(...a) { super(...a); window.__qaStreams.webSocket++; } };
  }, [lang, token]);
  await ctx.addInitScript(BADGE);
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (!['GET', 'HEAD'].includes(r.method())) { report.writesBlocked = (report.writesBlocked ?? 0) + 1; return route.abort(); }
    if (u.origin === ORIGIN || u.origin === STOCK) return route.continue();
    if (u.hostname === 'market.voltextech.net') return route.fulfill({ response: await route.fetch({ url: ORIGIN + '/api/v1' + u.pathname + u.search }) });
    return route.abort();
  });
  await ctx.routeWebSocket('**/*', socket => socket.close());
  const page = await ctx.newPage();
  page.on('pageerror', error => report.pageErrors.push({ url: page.url(), message: error.message }));
  // Counted when issued (so every read, aborted ones too, is counted at once);
  // body bytes are filled in when the response has finished.
  const log = [], entries = new Map();
  page.on('request', request => { const entry = { url: request.url(), type: request.resourceType(), bytes: 0 }; entries.set(request, entry); log.push(entry); });
  page.on('requestfinished', async request => {
    const sizes = await request.sizes().catch(() => null);
    const entry = entries.get(request);
    if (entry && sizes) entry.bytes = sizes.responseBodySize;
  });
  return { ctx, page, log };
}
const stockReads = log => ({
  catalogue: log.filter(x => x.url === STOCK + '/stocks').length,
  history: log.filter(x => x.url.startsWith(STOCK + '/stocks/history/')).length,
});
const settle = page => page.waitForTimeout(700);
async function panelReady(page) {
  await page.locator('.vxs-terminal').waitFor();
  await page.waitForTimeout(120);
  // Loaded: no spinner and no skeleton rows (catalogue and history answered or failed).
  await page.waitForFunction(() => !document.querySelector('.vxs-spinner, .vxs-row.is-skeleton'));
  await settle(page);
}
const charts = page => page.evaluate(() => ({ charts: document.querySelectorAll('.tv-lightweight-charts').length, canvases: document.querySelectorAll('canvas').length, overlay: document.querySelector('.vxs-chart-overlay')?.textContent ?? null }));
const symbol = page => page.locator('.vxs-strip-id h2').textContent();
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(SHOTS, name + '.jpg'), type: 'jpeg', quality: 82, fullPage });

async function layout(page) {
  return page.evaluate(() => {
    const visible = sel => { const el = document.querySelector(sel); if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0; };
    const clipped = [...document.querySelectorAll('.vxs-strip-price strong, .vxs-row-price, .vxo-price, .vxo-index-value, .vxs-strip-metric, .vxs-list-button, .vxs-view-switch a, .vxo-tabs button, .vxs-periods button')]
      .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map(el => el.className + ':' + el.textContent.trim().slice(0, 24));
    const strip = document.querySelector('.vxs-strip')?.getBoundingClientRect();
    const outside = strip ? [...document.querySelectorAll('.vxs-strip > *')].filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().right > strip.right + 1).map(el => el.className) : [];
    return {
      overflow: document.documentElement.scrollWidth - innerWidth, list: visible('.vxs-list-tile'), facts: visible('.vxs-facts-tile'), about: visible('.vxs-about'),
      listButton: visible('.vxs-list-button'), clipped, outside, rawKeys: (document.querySelector('.vxs-main')?.innerText.match(/\bstocks\.[A-Za-z0-9]+/g) ?? []),
    };
  });
}

async function visualMatrix(browser) {
  const sizes = [[1920, 1080], [1707, 940], [1440, 900], [1366, 768], [1280, 800], [1100, 800], [900, 800], [861, 900], [860, 900], [768, 1024], [430, 932], [390, 844], [360, 780], [320, 640]];
  for (const [width, height] of sizes) {
    const { ctx, page } = await context(browser, { width, height });
    await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
    const panel = await layout(page), chart = await charts(page);
    const mode = width >= 1280 ? 'three-column' : width > 860 ? 'two-column' : 'phone';
    check(`panel ${width}: no horizontal overflow`, panel.overflow <= 1, panel.overflow);
    check(`panel ${width}: one chart, data drawn`, chart.charts === 1 && chart.overlay === null, chart);
    check(`panel ${width}: ${mode} layout`, mode === 'three-column' ? panel.list && panel.facts && !panel.about
      : mode === 'two-column' ? panel.list && !panel.facts && panel.about : !panel.list && panel.listButton && panel.about, panel);
    check(`panel ${width}: nothing clipped or pushed out of the strip`, !panel.clipped.length && !panel.outside.length, { clipped: panel.clipped, outside: panel.outside });
    await shot(page, `panel-ru-${width}`);
    await page.goto(ORIGIN + '/stocks?view=overview'); await page.locator('.vxo-row-link').nth(1).waitFor(); await settle(page);
    const overview = await layout(page), overviewCharts = await charts(page);
    check(`overview ${width}: no horizontal overflow`, overview.overflow <= 1, overview.overflow);
    check(`overview ${width}: no chart mounted behind it`, overviewCharts.charts === 0 && !(await page.locator('.vxs-terminal').count()), overviewCharts);
    check(`overview ${width}: nothing clipped`, !overview.clipped.length, overview.clipped);
    check(`overview ${width}: 250 rows, light root`, (await page.locator('.vxo-row-link').count()) === 250 && await page.evaluate(() => getComputedStyle(document.querySelector('.vx-stocks-overview > .vxs-main')).backgroundColor) === 'rgb(246, 247, 249)');
    await shot(page, `overview-ru-${width}`);
    report.views.push({ width, height, panel, overview });
    await ctx.close();
  }
  // Phones: drawer and «Об инструменте» open.
  for (const width of [390, 320]) {
    const { ctx, page } = await context(browser, { width, height: 844 });
    await page.goto(ORIGIN + href(GAZP)); await panelReady(page);
    await page.locator('.vxs-about > summary').click(); await settle(page);
    check(`phone ${width}: about expands without overflow`, (await layout(page)).overflow <= 1);
    await shot(page, `panel-ru-${width}-about`, true);
    await page.locator('.vxs-list-button').click(); await page.locator('.vxs-drawer').waitFor();
    await shot(page, `panel-ru-${width}-drawer`);
    await ctx.close();
  }
}

async function languages(browser) {
  for (const lang of LANGS) {
    for (const [width, height, url, name] of [[1440, 900, href(N225), 'panel'], [390, 844, '/stocks?view=overview', 'overview'], [390, 844, href(AAPL), 'panel']]) {
      const { ctx, page } = await context(browser, { width, height, lang });
      await page.goto(ORIGIN + url);
      if (name === 'panel') await panelReady(page); else { await page.locator('.vxo-row-link').nth(1).waitFor(); await settle(page); }
      const result = await layout(page);
      check(`${lang} ${name} ${width}: translated, no raw keys`, !result.rawKeys.length, result.rawKeys);
      check(`${lang} ${name} ${width}: no overflow or clipping`, result.overflow <= 1 && !result.clipped.length && !result.outside.length, result);
      if (width === 1440 || name === 'overview') await shot(page, `${name}-${lang}-${width}`);
      await ctx.close();
    }
  }
}

async function transitions(browser, video) {
  const { ctx, page, log } = await context(browser, { width: 1280, height: 720, video });
  await page.goto(ORIGIN + '/stocks?view=overview'); await page.locator('.vxo-row-link').nth(1).waitFor(); await settle(page);
  const cold = stockReads(log);
  check('cold overview: one catalogue read, no history', cold.catalogue === 1 && cold.history === 0, cold);
  await page.waitForTimeout(600);
  await page.locator(`a.vxo-row-link[href="${href(AAPL)}"]`).click(); await panelReady(page);
  check('overview → AAPL: history read once, catalogue reused', JSON.stringify(stockReads(log)) === JSON.stringify({ catalogue: 1, history: 1 }), stockReads(log));
  check('AAPL panel shows AAPL', (await symbol(page)) === 'AAPL');
  await page.waitForTimeout(900);
  await page.locator(listLink(MSFT)).click(); await panelReady(page);
  check('AAPL → MSFT in the list: one more history read', stockReads(log).history === 2 && (await symbol(page)) === 'MSFT', stockReads(log));
  await page.waitForTimeout(900);
  await page.locator('.vxs-list-tile .vxs-tabs button', { hasText: /Индексы/ }).click();
  await page.locator(listLink(N225)).click(); await panelReady(page);
  const index = await charts(page);
  check('stock → index: same single chart', index.charts === 1 && (await symbol(page)) === 'N225', index);
  await page.waitForTimeout(900);
  await page.locator('.vxs-list-tile .vxs-tabs button', { hasText: /Все/ }).click();
  await page.locator(listLink(AAPL)).click(); await panelReady(page);
  check('index → stock (cached within 15 min): no new read', stockReads(log).history === 3 && (await symbol(page)) === 'AAPL', stockReads(log));
  const canvasesAfter = await charts(page);
  check('chart instances never accumulate', canvasesAfter.charts === 1 && canvasesAfter.canvases === index.canvases, { index, canvasesAfter });
  // Period switch: zoom only, no request, chart never blank.
  const before = stockReads(log).history;
  for (const label of ['5Д', '1Д', 'Все']) {
    const button = page.locator('.vxs-periods button', { hasText: label });
    if (await button.count()) { await button.click(); await page.waitForTimeout(300); }
  }
  check('period switches read nothing and keep the chart drawn', stockReads(log).history === before && (await charts(page)).overlay === null);
  // Back/Forward and the overview toggle.
  await page.goBack(); await panelReady(page);
  check('Back → N225', (await symbol(page)) === 'N225' && page.url().endsWith(href(N225)));
  await page.goBack(); await panelReady(page);
  check('Back → MSFT', (await symbol(page)) === 'MSFT');
  await page.goForward(); await panelReady(page);
  check('Forward → N225', (await symbol(page)) === 'N225');
  await page.locator('.vxs-list-head .vxs-view-switch a', { hasText: 'Обзор' }).click(); await page.locator('.vxo-row-link').nth(1).waitFor();
  check('panel → overview: no catalogue re-read', stockReads(log).catalogue === 1, stockReads(log));
  check('overview unmounts the chart', (await charts(page)).charts === 0);
  await page.waitForTimeout(800);
  const streams = await page.evaluate(() => window.__qaStreams);
  report.measurements.transitionReads = { ...stockReads(log), streamsOpenedByPage: streams };
  const videoPath = await page.video()?.path();
  await ctx.close();
  if (videoPath) report.video = path.relative(OUT, videoPath).replaceAll('\\', '/');
  // Reload and direct URL.
  const second = await context(browser, { width: 1440, height: 900 });
  await second.page.goto(ORIGIN + href(N225)); await panelReady(second.page);
  check('direct URL to an index opens it', (await symbol(second.page)) === 'N225');
  await second.page.reload(); await panelReady(second.page);
  check('reload keeps the instrument', (await symbol(second.page)) === 'N225' && JSON.stringify(stockReads(second.log)) === JSON.stringify({ catalogue: 2, history: 2 }), stockReads(second.log));
  await second.page.goto(ORIGIN + '/stocks'); await panelReady(second.page);
  check('main entry restores the last valid instrument (replace)', second.page.url().endsWith(href(N225)));
  await second.ctx.close();
}

async function states(browser) {
  const { ctx, page, log } = await context(browser, { width: 1440, height: 900 });
  await page.goto(ORIGIN + '/stocks'); await page.locator('.vxs-choose h2').waitFor(); await settle(page);
  check('no saved instrument: «Выберите инструмент», no history read, no guessed instrument', (await page.locator('.vxs-choose h2').textContent()) === 'Выберите инструмент' && stockReads(log).history === 0 && page.url().endsWith('/stocks'));
  await shot(page, 'panel-ru-1440-choose');
  await page.goto(ORIGIN + '/stocks/ABCD%3ANOPE'); await page.locator('.vxs-choose h2').waitFor(); await settle(page);
  check('unknown id: unavailable, no history read', (await page.locator('.vxs-choose h2').textContent()) === 'Инструмент недоступен' && stockReads(log).history === 0);
  await page.goto(ORIGIN + '/stocks'); await page.locator('.vxs-choose h2').waitFor();
  check('an unknown id is never remembered', page.url().endsWith('/stocks'));
  await page.goto(ORIGIN + href(COST)); await panelReady(page);
  const empty = await page.evaluate(() => ({ price: document.querySelector('.vxs-strip-price strong')?.textContent, overlay: document.querySelector('.vxs-chart-overlay')?.textContent }));
  check('instrument without data: dash price, «История пока недоступна», nothing invented', empty.price?.startsWith('—') && empty.overlay === 'История пока недоступна', empty);
  await shot(page, 'panel-ru-1440-no-data');
  await page.goto(ORIGIN + href(TINY)); await panelReady(page);
  const tiny = await page.locator('.vxs-strip-price strong').textContent();
  check('sub-cent price keeps its digits', /^0\.00\d{4,}/.test(tiny), tiny);
  check('session status is neutral, not «closed»', (await page.locator('.vxs-session').first().textContent()) === 'Нет данных о сессии');
  const times = await page.evaluate(() => [...document.querySelectorAll('.vxs-facts-tile dd')].map(dd => dd.textContent));
  check('data time is the candle close / service fetch, not «now»', times.some(text => /GMT|EDT|EST/.test(text)) && !times.some(text => /сейчас|now/i.test(text)), times);
  await ctx.close();
}

async function filtersFavoritesSort(browser) {
  const { ctx, page } = await context(browser, { width: 1440, height: 900 });
  await page.goto(ORIGIN + '/stocks?view=overview'); await page.locator('.vxo-row-link').nth(1).waitFor();
  await page.locator('.vxo-tabs button', { hasText: 'Азия' }).click();
  await page.locator('.vxo-subtabs button', { hasText: 'Япония' }).click();
  await page.locator('.vxo-search input').fill('co');
  await page.locator('.vxo-row-head button', { hasText: /Инструмент/ }).click();
  await settle(page);
  const names = await page.locator('.vxo-row-link strong').allTextContents();
  const exchanges = await page.locator('.vxo-row-link small').allTextContents();
  check('Asia → Japan → search → name sort', names.length > 1 && exchanges.every(text => text.endsWith('JPX')) && names.every((n, i) => i === 0 || names[i - 1].localeCompare(n, 'ru') <= 0), { names: names.slice(0, 5), exchanges: exchanges.slice(0, 5) });
  const query = new URL(page.url()).search;
  check('the URL holds every overview choice', /tab=Asia/.test(query) && /asia=Japan/.test(query) && /q=co/.test(query) && /sort=name-asc/.test(query), query);
  await page.locator('.vxo-row-link').first().click(); await panelReady(page);
  await page.locator('.vxs-list-head .vxs-view-switch a', { hasText: 'Обзор' }).click(); await page.locator('.vxo-row-link').first().waitFor();
  check('panel → «Обзор» returns with the same filters and sort', new URL(page.url()).search === query && (await page.locator('.vxo-subtabs button[aria-pressed="true"]').textContent()) === 'Япония', { query, now: new URL(page.url()).search });
  await page.locator('.vxo-row-link').first().click(); await panelReady(page);
  await page.goBack(); await page.locator('.vxo-row-link').first().waitFor();
  check('Back from the panel returns to the filtered overview', new URL(page.url()).search === query);
  await page.reload(); await page.locator('.vxo-row-link').first().waitFor();
  check('reload keeps overview filters', new URL(page.url()).search === query && (await page.locator('.vxo-search input').inputValue()) === 'co');
  await shot(page, 'overview-ru-1440-filtered');
  // Favourites: star in the overview, visible in the panel's favourites tab, kept after reload.
  await page.goto(ORIGIN + '/stocks?view=overview'); await page.locator('.vxo-row-link').first().waitFor();
  const star = page.locator('.vxo-row').filter({ has: page.locator(`a[href="${href(GAZP)}"]`) }).locator('.vxs-star');
  await star.click();
  check('star toggles aria-pressed', (await star.getAttribute('aria-pressed')) === 'true');
  await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
  await page.locator('.vxs-list-tile .vxs-tabs button[aria-label="Избранное"]').click();
  const favoriteRows = () => page.locator('.vxs-list-tile .vxs-row > a').evaluateAll(a => a.map(x => x.getAttribute('href')));
  check('favourite appears in the panel list', JSON.stringify(await favoriteRows()) === JSON.stringify([href(GAZP)]), await favoriteRows());
  await page.reload(); await panelReady(page);
  check('favourite tab state and favourites survive reload', JSON.stringify(await favoriteRows()) === JSON.stringify([href(GAZP)]));
  await ctx.close();
}

async function failuresAndRetry(browser) {
  // Catalogue unavailable → error with retry, then recovery.
  let { ctx, page } = await context(browser, { width: 1440, height: 900 });
  await page.route(STOCK + '/stocks', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': ORIGIN, 'Retry-After': '15' }, body: '{"error":"unavailable"}' }));
  await page.goto(ORIGIN + '/stocks?view=overview'); await page.locator('.vxo-state .vxo-gold').waitFor();
  await shot(page, 'overview-ru-1440-error');
  await page.unroute(STOCK + '/stocks');
  await page.locator('.vxo-state .vxo-gold').click(); await page.locator('.vxo-row-link').nth(1).waitFor();
  check('catalogue 503 → «Повторить» recovers', (await page.locator('.vxo-row-link').count()) === 250);
  await ctx.close();
  // History 503 and timeout → chart overlay error, retry draws it.
  ({ ctx, page } = await context(browser, { width: 1440, height: 900 }));
  const history = STOCK + '/stocks/history/' + encodeURIComponent(AAPL);
  await page.route(history, route => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': ORIGIN }, body: '{}' }));
  await page.goto(ORIGIN + href(AAPL)); await page.locator('.vxs-chart-overlay .vxs-retry').waitFor();
  check('history 503: chart host kept, error overlay with retry', (await charts(page)).charts === 1);
  await shot(page, 'panel-ru-1440-history-error');
  await page.unroute(history);
  await page.locator('.vxs-chart-overlay .vxs-retry').click(); await page.waitForFunction(() => !document.querySelector('.vxs-chart-overlay'));
  check('history retry draws the chart', (await charts(page)).overlay === null);
  await ctx.close();
  ({ ctx, page } = await context(browser, { width: 1440, height: 900 }));
  await page.route(STOCK + '/stocks/history/' + encodeURIComponent(MSFT), () => { /* never answers */ });
  const started = Date.now();
  await page.goto(ORIGIN + href(MSFT)); await page.locator('.vxs-chart-overlay .vxs-retry').waitFor({ timeout: 20000 });
  check('stalled history becomes an error after the 12 s deadline', Date.now() - started >= 11500, Date.now() - started);
  await ctx.close();
  // A broken logo falls back to letters; the list still renders.
  ({ ctx, page } = await context(browser, { width: 1440, height: 900 }));
  await page.route(STOCK + '/stocks', async route => {
    const response = await route.fetch(); const body = await response.json();
    for (const item of body.instruments) if (item.instrumentId === AAPL || item.instrumentId === MSFT) item.logoPath = '/assets/stocks/qa-missing-logo.png';
    route.fulfill({ response, body: JSON.stringify(body) });
  });
  await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
  const logo = await page.evaluate(() => ({ images: document.querySelectorAll('.vxs-logo img').length, aapl: document.querySelector('.vxs-strip-id .vxs-logo')?.textContent, rows: document.querySelectorAll('.vxs-list-tile .vxs-row').length }));
  check('failed logo → letters fallback, list intact', logo.images === 0 && logo.aapl === 'AA' && logo.rows === 250, logo);
  await ctx.close();
}

/**
 * Failed refreshes over kept data, contract violations and the 15-minute
 * cadence, on a controlled page clock (no real 15-minute waits). Chart pixels
 * are compared to prove the same instrument, the same data and the same zoom.
 */
const historyURL = id => STOCK + '/stocks/history/' + encodeURIComponent(id);
const cors = { 'Access-Control-Allow-Origin': ORIGIN };
// After page.clock.fastForward the first real mouse click can be lost (a Playwright
// fake-clock input quirk; without the fake clock every click lands). Clicks that
// follow a fast-forward are dispatched to the element; pointer delivery is
// covered by the scenarios without a fake clock.
const tap = locator => locator.dispatchEvent('click');
async function plot(page) { await page.mouse.move(1, 1); await page.waitForTimeout(250); return page.locator('.vxs-chart-host').screenshot(); }
async function refreshStates(browser) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const phone = width <= 860;
    const { ctx, page, log } = await context(browser, { width, height });
    await page.clock.install();
    await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
    if (!phone) {
      // A reader's zoom: two wheel steps over the plot.
      const box = await page.locator('.vxs-chart-host').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300); await page.waitForTimeout(200); await page.mouse.wheel(0, -300);
    }
    const zoomed = await plot(page);
    const startReads = stockReads(log);
    await page.clock.fastForward('14:00'); await settle(page);
    check(`${width}: nothing is read inside the 15-minute window`, JSON.stringify(stockReads(log)) === JSON.stringify(startReads), { startReads, now: stockReads(log) });
    await page.clock.fastForward('01:30'); await settle(page);
    const cadence = stockReads(log);
    check(`${width}: at 15 minutes exactly one catalogue and one history read`, cadence.catalogue === startReads.catalogue + 1 && cadence.history === startReads.history + 1, { startReads, cadence });
    check(`${width}: a successful refresh of the same instrument keeps its zoom and pixels`, Buffer.compare(await plot(page), zoomed) === 0);

    // Refresh → 503: the chart stays, a compact warning with the data's own time and a retry.
    await page.route(historyURL(AAPL), route => route.fulfill({ status: 503, headers: cors, body: '{"error":"unavailable"}' }));
    await page.clock.fastForward('15:30');
    await page.locator('.vxs-chart .vxs-stale').waitFor();
    const stale = await page.evaluate(() => ({ text: document.querySelector('.vxs-chart .vxs-stale')?.textContent, overlay: !!document.querySelector('.vxs-chart-overlay'), charts: document.querySelectorAll('.tv-lightweight-charts').length, symbol: document.querySelector('.vxs-strip-id h2')?.textContent, instrument: document.querySelector('.vxs-chart-host')?.getAttribute('data-instrument') }));
    check(`${width}: refresh 503 → warning over kept AAPL data, no overlay, one chart`, stale.text?.includes('Не удалось обновить данные. Показаны последние полученные значения') && /Последняя свеча: .*(GMT|EDT|EST)/.test(stale.text) && !stale.overlay && stale.charts === 1 && stale.symbol === 'AAPL' && stale.instrument === AAPL, stale);
    await shot(page, `panel-ru-${width}-refresh-failed`);
    await page.unroute(historyURL(AAPL));
    const beforeRetry = stockReads(log).history;
    await page.locator('.vxs-chart .vxs-stale button').evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => !document.querySelector('.vxs-stale')); await settle(page);
    check(`${width}: retry clicked twice reads once and clears the warning`, stockReads(log).history === beforeRetry + 1, { beforeRetry, now: stockReads(log).history });
    check(`${width}: after the retry the same data and zoom are on screen`, Buffer.compare(await plot(page), zoomed) === 0);

    // Refresh → timeout: an ordinary wait first, an error only after the 12 s deadline.
    await page.route(historyURL(AAPL), () => { /* never answers */ });
    await page.clock.fastForward('15:30'); await page.waitForTimeout(400);
    check(`${width}: a refresh in flight is not an error and keeps the chart`, !(await page.locator('.vxs-stale').count()) && (await charts(page)).overlay === null);
    await page.clock.fastForward('00:13');
    await page.locator('.vxs-chart .vxs-stale').waitFor();
    check(`${width}: refresh timeout → warning over kept data`, (await charts(page)).overlay === null && (await charts(page)).charts === 1);
    await page.unroute(historyURL(AAPL));
    await tap(page.locator('.vxs-chart .vxs-stale button'));
    await page.waitForFunction(() => !document.querySelector('.vxs-stale'));
    check(`${width}: retry after the timeout clears the warning`, Buffer.compare(await plot(page), zoomed) === 0);

    // Catalogue refresh fails: the list keeps its rows, warned; so does the overview.
    await page.route(STOCK + '/stocks', route => route.fulfill({ status: 503, headers: cors, body: '{"error":"unavailable"}' }));
    await page.clock.fastForward('15:30'); await settle(page);
    if (phone) { await tap(page.locator('.vxs-list-button')); await page.locator('.vxs-drawer').waitFor(); }
    const list = phone ? '.vxs-drawer' : '.vxs-list-tile';
    await page.locator(`${list} .vxs-stale`).waitFor();
    check(`${width}: catalogue refresh fails → list rows kept with the warning`, (await page.locator(`${list} .vxs-row`).count()) === 250);
    await shot(page, `panel-ru-${width}-catalogue-refresh-failed`);
    if (phone) await tap(page.locator('.vxs-drawer-head button'));
    await tap(page.locator(phone ? '.vxs-strip .vxs-view-switch a' : '.vxs-list-head .vxs-view-switch a', { hasText: 'Обзор' }));
    await page.locator('.vxo-page .vxs-stale').waitFor();
    check(`${width}: overview keeps 250 rows with the warning`, (await page.locator('.vxo-row-link').count()) === 250 && !(await page.locator('.vxo-state').count()));
    await shot(page, `overview-ru-${width}-refresh-failed`);
    // A hidden tab starts no extra polling, even while a refresh is failing.
    const hiddenReads = stockReads(log);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.fastForward('45:00'); await settle(page);
    check(`${width}: hidden tab: no reads for 45 minutes`, JSON.stringify(stockReads(log)) === JSON.stringify(hiddenReads), { hiddenReads, now: stockReads(log) });
    await page.unroute(STOCK + '/stocks');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !document.querySelector('.vxs-stale')); await settle(page);
    check(`${width}: visible again: one catalogue read, warning cleared`, stockReads(log).catalogue === hiddenReads.catalogue + 1 && stockReads(log).history === hiddenReads.history, { hiddenReads, now: stockReads(log) });
    report.measurements[`refreshReads${width}`] = { start: startReads, atFifteen: cadence, end: stockReads(log) };
    await ctx.close();
  }
}

async function contractStates(browser) {
  const { ctx, page, log } = await context(browser, { width: 1440, height: 900 });
  await page.clock.install();
  const foreign = async route => {
    const other = await route.fetch({ url: historyURL(MSFT) });
    route.fulfill({ response: other, headers: { ...other.headers(), ...cors } });
  };
  // First read answers with another instrument: an error, never MSFT's candles.
  await page.route(historyURL(AAPL), foreign);
  await page.goto(ORIGIN + href(AAPL)); await page.locator('.vxs-chart-overlay .vxs-retry').waitFor();
  const first = await page.evaluate(() => ({ overlay: document.querySelector('.vxs-chart-overlay')?.textContent, ohlc: !!document.querySelector('.vxs-ohlc'), spinner: !!document.querySelector('.vxs-spinner'), instrument: document.querySelector('.vxs-chart-host')?.getAttribute('data-instrument') }));
  check('HTTP 200 with another instrumentId → data error with retry, no candles, no spinner', first.overlay?.includes('Получен некорректный ответ. Данные не показаны') && !first.ohlc && !first.spinner && first.instrument === AAPL, first);
  await shot(page, 'panel-ru-1440-foreign-instrument');
  await page.unroute(historyURL(AAPL));
  await page.locator('.vxs-chart-overlay .vxs-retry').click(); await page.waitForFunction(() => !document.querySelector('.vxs-chart-overlay')); await settle(page);
  const aapl = await plot(page);
  const price = await page.locator('.vxs-strip-price strong').textContent();
  // A later answer with another instrument: the last valid AAPL page stays, warned.
  await page.route(historyURL(AAPL), foreign);
  await page.clock.fastForward('15:30');
  await page.locator('.vxs-chart .vxs-stale').waitFor();
  const kept = await page.evaluate(() => ({ text: document.querySelector('.vxs-stale')?.textContent, symbol: document.querySelector('.vxs-strip-id h2')?.textContent }));
  check('foreign answer after a valid AAPL page → AAPL kept with the invalid-data warning', kept.text?.includes('Получен некорректный ответ. Показаны последние корректные значения') && kept.symbol === 'AAPL' && (await page.locator('.vxs-strip-price strong').textContent()) === price, kept);
  await shot(page, 'panel-ru-1440-foreign-instrument-kept');
  await page.unroute(historyURL(AAPL));
  await tap(page.locator('.vxs-chart .vxs-stale button')); await page.waitForFunction(() => !document.querySelector('.vxs-stale'));
  check('retry → AAPL again, identical pixels', Buffer.compare(await plot(page), aapl) === 0);
  // Fast AAPL → MSFT → AAPL with a slow MSFT answer: AAPL stays AAPL.
  await page.route(historyURL(MSFT), route => setTimeout(() => route.continue().catch(() => {}), 1500));
  await tap(page.locator(listLink(MSFT))); await tap(page.locator(listLink(AAPL)));
  await page.waitForTimeout(2200); await settle(page);
  const back = await page.evaluate(() => ({ symbol: document.querySelector('.vxs-strip-id h2')?.textContent, instrument: document.querySelector('.vxs-chart-host')?.getAttribute('data-instrument'), overlay: !!document.querySelector('.vxs-chart-overlay'), charts: document.querySelectorAll('.tv-lightweight-charts').length }));
  check('fast AAPL → MSFT → AAPL: AAPL drawn, late MSFT dropped, one chart', back.symbol === 'AAPL' && back.instrument === AAPL && !back.overlay && back.charts === 1 && Buffer.compare(await plot(page), aapl) === 0, back);
  await page.unroute(historyURL(MSFT));
  await ctx.close();
  // A valid empty page is "no history yet", not an error.
  const empty = await context(browser, { width: 1440, height: 900 });
  await empty.page.route(historyURL(AAPL), route => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"candles":[],"next":null}' }));
  await empty.page.goto(ORIGIN + href(AAPL)); await panelReady(empty.page);
  const view = await empty.page.evaluate(() => ({ overlay: document.querySelector('.vxs-chart-overlay')?.textContent, retry: !!document.querySelector('.vxs-chart-overlay button'), stale: !!document.querySelector('.vxs-stale') }));
  check('valid empty history → «История пока недоступна», no error, no retry', view.overlay === 'История пока недоступна' && !view.retry && !view.stale, view);
  await empty.ctx.close();
}

async function keyboard(browser) {
  const { ctx, page } = await context(browser, { width: 390, height: 844 });
  await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
  await page.locator('.vxs-list-button').focus(); await page.keyboard.press('Enter');
  await page.locator('.vxs-drawer').waitFor();
  check('drawer opens from the keyboard and focuses search', await page.evaluate(() => document.activeElement?.closest('.vxs-drawer .vxs-search') !== null));
  await page.keyboard.type('gaz'); await page.waitForTimeout(200);
  check('drawer search filters', (await page.locator('.vxs-drawer .vxs-row > a').count()) >= 1);
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('.vxs-drawer'));
  let trapped = true;
  for (let n = 0; n < 4; n++) { await page.keyboard.press('Shift+Tab'); trapped &&= await inside(); }
  for (let n = 0; n < 30; n++) { await page.keyboard.press('Tab'); trapped &&= await inside(); }
  check('Tab and Shift+Tab stay inside the modal drawer', trapped);
  await page.keyboard.press('Escape');
  check('Escape closes the drawer and returns focus', !(await page.locator('.vxs-drawer').count()) && await page.evaluate(() => document.activeElement?.classList.contains('vxs-list-button')));
  await page.locator('.vxs-list-button').click(); await page.locator('.vxs-drawer-backdrop').click({ position: { x: 380, y: 400 } });
  check('tapping outside closes the drawer', !(await page.locator('.vxs-drawer').count()));
  await page.locator('.vxs-list-button').click();
  await page.locator('.vxs-drawer .vxs-row:not(.is-active) > a').first().click(); await panelReady(page);
  check('choosing in the drawer closes it and opens the instrument', !(await page.locator('.vxs-drawer').count()) && !page.url().endsWith(href(AAPL)));
  await page.locator('.vxs-list-button').focus(); await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => { const el = document.activeElement; return el ? getComputedStyle(el).outlineStyle : 'none'; });
  check('focus is visible', outline !== 'none', outline);
  await ctx.close();
}

async function routeRun(browser) {
  for (const width of [1920, 390]) {
    const { ctx, page, log } = await context(browser, { width, height: width > 860 ? 1000 : 844 });
    const terminal = async () => {
      await page.locator('.trade-terminal').waitFor(); await page.waitForTimeout(700);
      return page.evaluate(() => {
        const el = document.querySelector('.trade-terminal'), css = getComputedStyle(el), chart = el.querySelector('.chart-area,.cfd-chart-area,.terminal-chart-shell');
        return { classes: el.className, id: el.id, tokens: Object.fromEntries(['--bg', '--panel', '--accent', '--buy', '--sell', '--text-primary', '--border', '--tile-fill'].map(k => [k, css.getPropertyValue(k).trim()])), chart: chart ? getComputedStyle(chart).backgroundColor : null, header: getComputedStyle(document.querySelector('.global-header')).backgroundColor, root: Object.fromEntries(['--bg', '--panel', '--accent', '--vx-bg'].map(k => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()])), streams: window.__qaStreams };
      });
    };
    const header = () => page.evaluate(() => { const h = getComputedStyle(document.querySelector('.global-header')); return { bg: h.backgroundColor, height: h.height, font: h.fontFamily, border: h.borderBottomColor }; });
    await page.goto(ORIGIN + '/academy'); await page.locator('.global-header').waitFor(); const academyBefore = await header();
    await page.goto(ORIGIN + '/futures'); const futures = await terminal();
    await page.goto(ORIGIN + '/trade'); const spot = await terminal();
    await page.goto(ORIGIN + '/trade?market=cfd'); const cfd = await terminal();
    await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
    const stocksHeader = await header();
    await page.locator(width > 860 ? '.vxs-list-head .vxs-view-switch a' : '.vxs-strip .vxs-view-switch a', { hasText: 'Обзор' }).click(); await page.locator('.vxo-row-link').first().waitFor();
    const overviewHeader = await header();
    const readsAtExit = stockReads(log);
    // Leave Stocks inside the app, then compare every terminal with its own baseline.
    await page.evaluate(() => { history.pushState({}, '', '/futures'); dispatchEvent(new PopStateEvent('popstate')); });
    const futuresAfter = await terminal();
    await page.waitForTimeout(2500);
    check(`${width}: leaving Stocks stops stock reads`, JSON.stringify(stockReads(log)) === JSON.stringify(readsAtExit), { readsAtExit, now: stockReads(log) });
    await page.goto(ORIGIN + '/trade'); const spotAfter = await terminal();
    await page.goto(ORIGIN + '/trade?market=cfd'); const cfdAfter = await terminal();
    await page.goto(ORIGIN + '/academy'); await page.locator('.global-header').waitFor(); const academyAfter = await header();
    const strip = x => ({ ...x, streams: undefined });
    check(`${width}: Futures unchanged after Stocks`, JSON.stringify(strip(futuresAfter)) === JSON.stringify(strip(futures)), { futures, futuresAfter });
    check(`${width}: Spot unchanged after Stocks`, JSON.stringify(strip(spotAfter)) === JSON.stringify(strip(spot)));
    check(`${width}: CFD unchanged after Stocks`, JSON.stringify(strip(cfdAfter)) === JSON.stringify(strip(cfd)));
    check(`${width}: shared header identical on Academy, panel and overview`, JSON.stringify(academyBefore) === JSON.stringify(stocksHeader) && JSON.stringify(stocksHeader) === JSON.stringify(overviewHeader) && JSON.stringify(academyAfter) === JSON.stringify(academyBefore), { academyBefore, stocksHeader, overviewHeader });
    check(`${width}: Futures opens the same live streams after Stocks`, JSON.stringify(futuresAfter.streams) === JSON.stringify(futures.streams), { before: futures.streams, after: futuresAfter.streams });
    report.measurements[`routeRun${width}`] = { futures, spot, cfd, stocksHeader };
    await ctx.close();
    // Login, signed out (the session token would redirect it to trading).
    const signedOut = await context(browser, { width, height: width > 860 ? 1000 : 844, token: false });
    await signedOut.page.goto(ORIGIN + href(AAPL)); await panelReady(signedOut.page);
    await signedOut.page.goto(ORIGIN + '/login'); await signedOut.page.waitForTimeout(1200);
    const login = await signedOut.page.evaluate(() => ({ path: location.pathname, bg: getComputedStyle(document.body).backgroundColor, rootBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), stocksRoot: !!document.querySelector('.vx-stocks-terminal,.vx-stocks-overview') }));
    check(`${width}: Login renders with the global theme after Stocks`, login.path === '/login' && login.rootBg === '#0a0c10' && !login.stocksRoot, login);
    await signedOut.ctx.close();
  }
}

async function flagOff(browser, dist) {
  if (!dist) { report.flagOff = 'skipped: QA_FLAG_OFF_DIST not set'; return; }
  const close = await serve(dist);
  try {
    const { ctx, page, log } = await context(browser, { width: 1440, height: 900 });
    for (const url of ['/trade', '/futures', '/stocks', href(AAPL), '/stocks?view=overview']) { await page.goto(ORIGIN + url); await page.waitForTimeout(1200); }
    const stockRequests = log.filter(x => x.url.startsWith(STOCK)).length;
    const chunks = log.filter(x => /Stocks(Page|Terminal|Overview)/.test(x.url)).map(x => x.url);
    await page.goto(ORIGIN + '/trade'); await page.locator('.global-header').waitFor();
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="/stocks"]')].length);
    await page.goto(ORIGIN + '/stocks'); await page.waitForTimeout(800);
    const surface = await page.locator('.vx-stocks-terminal, .vx-stocks-overview').count();
    check('flag OFF: no stock request, no Stocks chunk, no link, no surface', stockRequests === 0 && !chunks.length && links === 0 && surface === 0, { stockRequests, chunks, links, surface });
    report.flagOff = { stockRequests, chunks, links, surface };
    await ctx.close();
  } finally { await close(); }
}

/**
 * First-open cost and a 20-switch memory run, for any build. Signed out on
 * purpose: a signed-in session warms Trade/Wallet chunks on idle from any page
 * (App.tsx usePrefetchLikelyRoutes), which would be counted against Stocks.
 */
async function measure(browser, dist, label, flow) {
  const close = await serve(dist);
  try {
    const out = {};
    for (const [name, url] of [['panel', href(AAPL)], ['overview', '/stocks?view=overview'], ['entry', '/stocks']]) {
      const { ctx, page, log } = await context(browser, { width: 1440, height: 900, token: false });
      await page.goto(ORIGIN + url); await page.waitForTimeout(2500);
      const sum = filter => log.filter(filter).reduce((a, x) => a + x.bytes, 0);
      out[name] = {
        requests: log.length, bytes: sum(() => true), jsFiles: log.filter(x => x.type === 'script').length, jsBytes: sum(x => x.type === 'script'), cssBytes: sum(x => x.type === 'stylesheet'),
        stock: { ...stockReads(log), bytes: sum(x => x.url.startsWith(STOCK)) }, chart: (await charts(page)).charts,
        stockChunks: log.filter(x => /assets\/Stock/.test(x.url)).map(x => path.basename(new URL(x.url).pathname) + ':' + x.bytes),
        lightweightCharts: log.some(x => /lightweight-charts/.test(x.url)),
      };
      await ctx.close();
    }
    const { ctx, page, log } = await context(browser, { width: 1440, height: 900, token: false });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable');
    const metrics = async () => {
      for (let n = 0; n < 3; n++) await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics'); const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
      return { heapMiB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, ...(await charts(page)) };
    };
    const steps = await flow(page);
    const warm = await metrics();
    for (let n = 0; n < 20; n++) await steps(n);
    const after = await metrics();
    out.memory = { warm, after20Switches: after, heapDeltaMiB: +(after.heapMiB - warm.heapMiB).toFixed(2), nodesDelta: after.nodes - warm.nodes, listenersDelta: after.listeners - warm.listeners, reads: stockReads(log) };
    await ctx.close();
    report.measurements[label] = out;
  } finally { await close(); }
}
const IDS = [AAPL, MSFT, N225, GAZP, 'XHKG:HSI', 'XNYS:JPM', 'XKRX:KOSPI', 'XNGS:GOOGL', 'XNSE:NSEI', 'MISX:LKOH'];
const afterFlow = async page => {
  await page.goto(ORIGIN + href(AAPL)); await panelReady(page);
  for (const id of IDS.slice(1, 4)) { await page.locator(listLink(id)).click(); await panelReady(page); }
  return async n => {
    if (n % 5 === 4) { await page.locator('.vxs-list-head .vxs-view-switch a', { hasText: 'Обзор' }).click(); await page.locator('.vxo-row-link').first().waitFor(); await page.locator(`a.vxo-row-link[href="${href(IDS[n % 10])}"]`).click(); await panelReady(page); return; }
    await page.locator(listLink(IDS[n % 10])).click(); await panelReady(page);
  };
};
const beforeFlow = async page => {
  // The previous head: a catalogue page with separate detail pages.
  await page.goto(ORIGIN + '/stocks'); await page.locator('.stocks-row').nth(1).waitFor();
  const open = async id => {
    if (!page.url().endsWith('/stocks')) { await page.goBack(); await page.locator('.stocks-row').nth(1).waitFor(); }
    await page.locator(`.stocks-identity a[href="${href(id)}"]`).click(); await page.locator('.stocks-chart canvas, .stocks-empty').first().waitFor(); await page.waitForTimeout(500);
  };
  for (const id of IDS.slice(0, 3)) await open(id);
  return n => open(IDS[n % 10]);
};

function bundle(dist) {
  if (!dist || !fs.existsSync(dist)) return null;
  const files = fs.readdirSync(path.join(dist, 'assets'));
  const size = name => { const data = fs.readFileSync(path.join(dist, 'assets', name)); return { raw: data.length, gzip: zlib.gzipSync(data, { level: 9 }).length }; };
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const entry = [...html.matchAll(/assets\/(index-[^"]+\.js)/g)].map(m => m[1]);
  return {
    entry: Object.fromEntries(entry.map(name => [name, size(name)])),
    stocks: Object.fromEntries(files.filter(name => /^Stock/.test(name)).map(name => [name, size(name)])),
  };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { startStockFixture } = await import(pathToFileURL(path.join(__dirname, 'qa-stocks-ui-fixture.mjs')).href);
  const stock = await startStockFixture({ port: 4431, frontendOrigin: ORIGIN });
  report.fixture = { instruments: stock.instruments.length, withData: stock.instruments.filter(i => i.enabled).length, candles: stock.candles };
  const browser = await chromium.launch({ headless: true });
  try {
    const close = await serve(AFTER_DIST);
    try {
      await visualMatrix(browser);
      await languages(browser);
      await transitions(browser, path.join(OUT, 'video'));
      await states(browser);
      await filtersFavoritesSort(browser);
      await failuresAndRetry(browser);
      await refreshStates(browser);
      await contractStates(browser);
      await keyboard(browser);
      await routeRun(browser);
    } finally { await close(); }
    await flagOff(browser, process.env.QA_FLAG_OFF_DIST);
    await measure(browser, AFTER_DIST, 'after', afterFlow);
    if (process.env.QA_BEFORE_DIST) await measure(browser, process.env.QA_BEFORE_DIST, 'before', beforeFlow);
    report.bundle = { after: bundle(AFTER_DIST), before: bundle(process.env.QA_BEFORE_DIST), flagOff: bundle(process.env.QA_FLAG_OFF_DIST) };
  } finally {
    await browser.close(); await stock.close();
    report.finishedAt = new Date().toISOString();
    report.summary = { checks: report.checks.length, failed: failures.length, pageErrors: report.pageErrors.length, writesBlocked: report.writesBlocked ?? 0 };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report.summary));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  if (report.pageErrors.length) { console.error(JSON.stringify(report.pageErrors.slice(0, 5))); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
