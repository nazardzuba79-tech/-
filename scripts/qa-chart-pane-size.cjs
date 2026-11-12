#!/usr/bin/env node
'use strict';
/**
 * Built Spot chart: the volume strip keeps the height the viewer dragged it to,
 * and everything drawn on the chart can be taken off it from the chart itself.
 * Disposable read-only fixtures only (the terminal fixture server of
 * qa-spot-cfd-terminal); nothing is sent to a market or account service.
 *
 *   node scripts/qa-chart-pane-size.cjs [--dist frontend/dist] [--out output/chart-pane-size]
 *        [--widths 1440,390] [--expect fixed|broken]
 *
 * --expect broken runs the same drag against an older build and requires the
 * old fault (the strip springs back on the next data update): the proof that
 * the scenario really exercises it.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/chart-pane-size')));
const WIDTHS = arg('--widths', '1440,390').split(',').map(Number);
const EXPECT = arg('--expect', 'fixed');
const HOUR = 3600;
const END = Math.floor(Date.now() / (HOUR * 1000)) * HOUR;
const LAYOUT_KEY = 'voltex.chartPaneLayout.v1';

function candles(lastClose) {
  return Array.from({ length: 48 }, (_, i) => {
    const open = 0.81 + i * 0.02, close = i === 47 ? lastClose : open + 0.01;
    return { time: END - (47 - i) * HOUR, open, close, high: Math.max(open, close) + 0.01, low: Math.max(0.01, open - 0.01), volume: 15000 + i * 150 };
  });
}
function asset(lastClose) {
  return { pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false,
    status: 'live', listingArmed: true, listingAt: new Date((END - 50 * HOUR) * 1000).toISOString(), initialPrice: 0.81,
    state: { phase: 'live', lastPrice: lastClose, openPrice24h: 1.2, change24hPercent: 12, high24h: lastClose + 0.02, low24h: 1.1,
      volume24h: 360000, quoteVolume24h: 600000, serverTime: Date.now() } };
}
function fixtureServer() {
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), `Build is missing: ${DIST}`);
  let source = fs.readFileSync(path.join(__dirname, 'qa-spot-cfd-terminal.cjs'), 'utf8').split('const DESKTOP =')[0];
  const original = "const dist = path.resolve(__dirname, '../frontend/dist');";
  assert.ok(source.includes(original), 'terminal fixture server entry must remain recognizable');
  source = source.replace(original, `const dist = ${JSON.stringify(DIST)};`);
  const sandbox = { require: createRequire(__filename), __dirname, process, console, module: { exports: {} } };
  vm.runInNewContext(source + '\nmodule.exports = app;', sandbox);
  return sandbox.module.exports.listen(0, '127.0.0.1');
}

/** The chart's rows as Lightweight Charts lays them out: panes, 1px separators, the time axis. */
const rows = page => page.evaluate(() => {
  const table = document.querySelector('.chart-view .tv-lightweight-charts table');
  if (!table) return null;
  const all = [...table.querySelectorAll(':scope > tr')].map(tr => { const b = tr.getBoundingClientRect(); return { top: b.top, left: b.left, width: b.width, height: b.height }; });
  const panes = all.slice(0, -1).filter(r => r.height > 3), separators = all.slice(0, -1).filter(r => r.height <= 3);
  return { panes, separators, total: panes.reduce((sum, r) => sum + r.height, 0) };
});
const share = layout => (layout.panes.length > 1 ? layout.panes[1].height / layout.total : 0);
const legendRows = page => page.evaluate(() => [...document.querySelectorAll('.voltex-indicator-legend > *')].map(el => el.textContent.trim()));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { expect: EXPECT, dist: path.relative(ROOT, DIST), environment: 'Built frontend; local VTA fixtures; writes and external transports denied', views: [] };
  const checks = [];
  const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); };
  let server, browser;
  try {
    server = fixtureServer();
    if (!server.listening) await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
    for (const width of WIDTHS) {
      const phone = width < 600, P = String(width);
      let lastClose = 1.76;
      const view = { width, errors: [], writes: [], blockedExternal: [] };
      report.views.push(view);
      const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 940 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv', serviceWorkers: 'block', hasTouch: false });
      await context.addInitScript(() => {
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.setItem('exchange_token', 'local-fixture-only');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const q = route.request(), u = new URL(q.url());
        if (!['GET', 'HEAD'].includes(q.method())) { view.writes.push(`${q.method()} ${u.pathname}`); return route.abort(); }
        if (/\/market\/test-assets\/VTA-USDT\/candles$/i.test(u.pathname)) return route.fulfill({ json: { pair: 'VTA/USDT', interval: u.searchParams.get('interval') ?? '1h', candles: candles(lastClose) } });
        if (/\/market\/test-assets\/?$/.test(u.pathname)) return route.fulfill({ json: { serverTime: Date.now(), assets: [asset(lastClose)] } });
        if (/\/market\/(test-assets|listings)\/?$/.test(u.pathname)) return route.fulfill({ json: { serverTime: Date.now(), assets: [] } });
        if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ response: await route.fetch({ url: origin + u.pathname + u.search, maxRedirects: 0 }) });
        if (u.origin === origin) return route.continue();
        view.blockedExternal.push(u.href);
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => view.errors.push(e.message));
      const open = async () => {
        await page.goto(origin + '/trade?pair=VTA%2FUSDT', { waitUntil: 'domcontentloaded' });
        if (phone) await page.locator('#mobile-trade-chart').click();
        await page.locator('.chart-view .tv-lightweight-charts table').first().waitFor({ timeout: 20000 });
        await page.waitForFunction(() => document.querySelectorAll('.chart-view .tv-lightweight-charts table > tr').length >= 4, null, { timeout: 20000 });
        await page.waitForTimeout(700);
        await page.locator('.chart-view').first().scrollIntoViewIfNeeded();
      };
      await open();

      const initial = await rows(page);
      view.initial = { panes: initial.panes.length, volumeShare: share(initial) };
      ok(`${P}: volume has a strip of its own at the chart's default height`, initial.panes.length === 2 && share(initial) > 0.15 && share(initial) < 0.25, view.initial);
      await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-1-default.png`) });

      // The viewer drags the separator between the candles and the volume strip down.
      const sep = initial.separators[0];
      const x = sep.left + sep.width * 0.4, y = sep.top + sep.height / 2, by = Math.round(initial.panes[1].height * 0.62);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + by / 2, { steps: 6 });
      await page.mouse.move(x, y + by, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const dragged = await rows(page);
      view.dragged = { volumeShare: share(dragged), volumePx: dragged.panes[1].height };
      ok(`${P}: dragging the separator makes the volume strip smaller`, share(dragged) < share(initial) * 0.6, view.dragged);
      await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-2-dragged.png`) });
      const near = (a, b) => Math.abs(a - b) <= 0.012;

      // A data update: the fixture's last candle moves, the chart reloads its candles and recomputes.
      lastClose = 1.83;
      await page.waitForFunction(() => /1[.,]83/.test(document.querySelector('.chart-view')?.closest('main, body')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(6500);
      const afterData = await rows(page);
      view.afterData = { volumeShare: share(afterData) };
      if (EXPECT === 'broken') {
        ok(`${P}: OLD BUILD — the strip springs back after a data update (the reported fault)`, share(afterData) > share(dragged) * 1.5, view.afterData);
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-3-after-data.png`) });
        await context.close();
        continue;
      }
      ok(`${P}: the strip keeps its size after a data update`, near(share(afterData), share(dragged)), view.afterData);

      // A timeframe change reloads every candle.
      const tabs = page.locator('.chart-tabs .chart-tab');
      if (await tabs.count() > 1) { await tabs.nth(1).click(); await page.waitForTimeout(1200); }
      const afterTf = await rows(page);
      view.afterTimeframe = { volumeShare: share(afterTf) };
      ok(`${P}: the strip keeps its size after a timeframe change`, near(share(afterTf), share(dragged)), view.afterTimeframe);
      await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-3-after-updates.png`) });

      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), LAYOUT_KEY);
      view.stored = stored;
      ok(`${P}: the size is kept for Spot only, as a ratio to the candles`, !!stored && typeof stored.spot?.volume === 'number' && stored.spot.volume < 0.2
        && Object.keys(stored.futures ?? {}).length === 0 && Object.keys(stored.cfd ?? {}).length === 0, stored);

      // A reload: the size comes back from the browser's own storage.
      await open();
      const afterReload = await rows(page);
      view.afterReload = { volumeShare: share(afterReload) };
      ok(`${P}: the strip keeps its size after a reload`, near(share(afterReload), share(dragged)), view.afterReload);

      // Everything on the chart can be taken off it.
      const legend = await legendRows(page);
      view.legend = legend;
      if (phone) {
        ok(`${P}: the phone legend stays short (no volume line)`, !legend.some(text => /Объём/.test(text)), legend);
      } else {
        ok(`${P}: the legend lists the volume strip and the indicators`, legend.some(text => /^Объём$/.test(text)) && legend.some(text => /SMA 200/.test(text)), legend);
        ok(`${P}: legend buttons add no text to a row`, legend.every(text => !/Удалить|Настро/.test(text)), legend);
        const smaRow = page.locator('.voltex-indicator-legend [data-legend-row]').filter({ hasText: 'SMA 200' }).first();
        await smaRow.hover();
        const smaRemove = smaRow.locator('[data-legend-remove]');
        ok(`${P}: an indicator's remove button is named`, /Удалить: SMA 200/.test(await smaRemove.getAttribute('aria-label') ?? ''), await smaRemove.getAttribute('aria-label'));
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-4-legend-hover.png`) });
        await smaRemove.click();
        await page.waitForTimeout(300);
        const withoutSma = await legendRows(page);
        const savedIndicators = await page.evaluate(() => JSON.parse(localStorage.getItem('voltex.chartIndicators.v1') || '[]'));
        ok(`${P}: removing SMA 200 from the legend removes it from the chart and from the saved list`, !withoutSma.some(text => /SMA 200/.test(text)) && !savedIndicators.some(i => i.type === 'ma' || (i.type === 'sma' && i.params?.period === 200)), { withoutSma, saved: savedIndicators.map(i => i.type) });

        const volumeRow = page.locator('.voltex-indicator-legend [data-legend-row="volume"]');
        await volumeRow.hover();
        await volumeRow.locator('[data-legend-remove]').click();
        await page.waitForTimeout(400);
        const noVolume = await rows(page);
        const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('voltex.chartSettings.v1') || 'null'));
        view.noVolume = { panes: noVolume.panes.length, setting: settings?.volume };
        ok(`${P}: removing «Объём» closes the volume strip and saves the choice`, noVolume.panes.length === 1 && settings?.volume === false, view.noVolume);
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-5-no-volume.png`) });
      }

      // The Indicators menu switches the volume strip on any screen.
      // On a phone the chart type and indicator menus live in the toolbar's «Ещё» sheet.
      const visibleTrigger = async () => { const t = page.locator('.chart-indicators-trigger:visible').first(); return (await t.count()) > 0 ? t : null; };
      let trigger = await visibleTrigger();
      if (!trigger) { await page.locator('[data-cw-feature="phone-more"], [data-cw-feature="more"]').first().click(); await page.waitForTimeout(300); trigger = await visibleTrigger(); }
      const hasMenu = !!trigger;
      if (hasMenu) {
        await trigger.click();
        const item = page.locator('[data-chart-builtin="volume"]').first();
        await item.waitFor({ timeout: 5000 });
        const before = await item.getAttribute('aria-checked');
        await page.screenshot({ path: path.join(OUT, `${EXPECT}-${P}-menu-open.png`) });
        ok(`${P}: «Индикаторы» lists the volume strip with its current state`, before === (phone ? 'true' : 'false'), before);
        await item.click();
        await page.waitForTimeout(450);
        if (phone) {
          const off = await rows(page);
          ok(`${P}: «Индикаторы» takes the volume strip off the phone chart`, off.panes.length === 1 && await item.getAttribute('aria-checked') === 'false', { panes: off.panes.length });
          await item.click(); await page.waitForTimeout(450);
        }
        for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
        const sheetClose = page.locator('.cw-sheet-done:visible').first();
        if (await sheetClose.count()) { await sheetClose.click(); await page.waitForTimeout(250); }
        const back = await rows(page);
        view.volumeBack = { panes: back.panes.length, volumeShare: share(back) };
        ok(`${P}: switched back on, the strip returns at the size the viewer chose, not at the default`, back.panes.length === 2 && near(share(back), share(dragged)), view.volumeBack);
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-6-volume-back.png`) });
      } else {
        ok(`${P}: the Indicators menu is reachable`, false, 'no visible .chart-indicators-trigger');
      }

      // TradingView's quick measure: hold Shift over the chart, click, move, click.
      if (!phone) {
        const rulers = () => page.locator('g[data-drawing-kind="ruler"]').count();
        const armed = () => page.evaluate(() => document.querySelector('button[data-drawing-tool="ruler"]')?.getAttribute('aria-pressed') ?? null);
        const plot = (await rows(page)).panes[0];
        const ax = plot.left + plot.width * 0.35, ay = plot.top + plot.height * 0.7, bx = plot.left + plot.width * 0.6, byy = plot.top + plot.height * 0.3;
        await page.mouse.move(ax, ay);
        await page.keyboard.down('Shift');
        await page.waitForTimeout(120);
        const armedOnShift = await armed();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(120);
        ok(`${P}: Shift over the chart arms the ruler, and letting go without a click puts the cursor back`, armedOnShift === 'true' && await armed() === 'false' && await rulers() === 0, { armedOnShift, after: await armed(), rulers: await rulers() });
        await page.keyboard.down('Shift');
        await page.waitForTimeout(120);
        await page.mouse.click(ax, ay);
        await page.mouse.move((ax + bx) / 2, (ay + byy) / 2, { steps: 5 });
        await page.keyboard.up('Shift'); // released mid-measurement: the measurement goes on
        await page.mouse.move(bx, byy, { steps: 5 });
        await page.waitForTimeout(120);
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-7-shift-measure.png`) });
        await page.mouse.click(bx, byy);
        await page.waitForTimeout(300);
        const label = await page.evaluate(() => [...document.querySelectorAll('g[data-drawing-kind="ruler"] text')].map(el => el.textContent));
        view.shiftMeasure = { rulers: await rulers(), label, tool: await armed() };
        ok(`${P}: Shift+click measures price, percent, bars and time, then the cursor is back`, view.shiftMeasure.rulers === 1 && /%/.test(label.join(' ')) && /бар/.test(label.join(' ')) && view.shiftMeasure.tool === 'false', view.shiftMeasure);
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${EXPECT}-${P}-8-shift-measured.png`) });
        // Shift inside a field types a capital letter; it must not arm anything.
        await page.keyboard.press('Escape');
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${P}: no horizontal page overflow`, overflow <= 1, overflow);
      // External requests (fonts, icon CDN) are aborted by the route above and only counted.
      ok(`${P}: no page errors and no write requests; external requests were blocked`, view.errors.length === 0 && view.writes.length === 0,
        { errors: view.errors, writes: view.writes, blockedExternal: view.blockedExternal.length });
      await context.close();
    }
  } finally {
    await browser?.close();
    server?.close();
  }
  report.checks = checks;
  report.passed = checks.filter(c => c.pass).length;
  report.failed = checks.filter(c => !c.pass).length;
  fs.writeFileSync(path.join(OUT, `${EXPECT}-report.json`), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
