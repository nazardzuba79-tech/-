#!/usr/bin/env node
'use strict';
/**
 * Built Spot/NRX ruler regression, using disposable read-only fixtures only.
 * Reuses the terminal fixture server and persisted drawings used by the existing
 * qa-vta-presentation harness. Nothing is sent to a market/account service.
 *
 * node scripts/qa-chart-ruler-label.cjs --widths 1440,1366,390 --label after
 * Optional: --dist /path/to/frontend/dist --out /path/to/artifacts
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
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/chart-ruler-label')));
const WIDTHS = arg('--widths', '1440,1366,390').split(',').map(Number);
const LABEL = arg('--label', 'after');
const HOUR = 3600;
const END = Math.floor(Date.now() / (HOUR * 1000)) * HOUR;
const STORAGE_KEY = 'voltex.drawings.spot.NRX/USDT';
const CASES = [
  { name: 'zero-baseline', from: 0, to: 247.58, expected: '+247,58 (—%)' },
  { name: 'negative-baseline', from: -5, to: 247.58, expected: '+252,58 (—%)' },
  { name: 'positive-entry', from: 0.81, to: 247.58, expected: '+246,77 (+30\u00a0465,43%)' },
  { name: 'live-end', from: 0.81, to: 100, live: true, expected: '+246,77 (+30\u00a0465,43%)' },
];

// One rising fixture window puts the zero/negative ruler origins in the real
// linear autoscale margin. Candle prices themselves are always positive.
function candles(lastClose = 247.58) {
  return Array.from({ length: 48 }, (_, i) => {
    const open = 0.81 + i * (247.58 - 0.81) / 47;
    const close = i === 47 ? lastClose : open + 0.1;
    return { time: END - (47 - i) * HOUR, open, close,
      high: Math.max(open, close) + 0.15, low: Math.max(0.01, open - 0.15), volume: 15000 + i * 15 };
  });
}
function asset(lastClose) {
  return { pair: 'NRX/USDT', symbol: 'NRX', name: 'NEURIX', quote: 'USDT', isTestAsset: true, isTradable: true,
    status: 'live', listingArmed: true, listingAt: new Date((END - 50 * HOUR) * 1000).toISOString(), initialPrice: 0.81,
    state: { phase: 'live', lastPrice: lastClose, openPrice24h: 125, change24hPercent: 98.06,
      high24h: lastClose + 0.15, low24h: 124, volume24h: 360000, quoteVolume24h: 71000000, serverTime: Date.now() } };
}

// The existing fixture server stops before its browser scenarios. Give it the
// requested built bundle while retaining all existing read-only endpoint shapes.
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

async function measurement(page) {
  return page.locator('g[data-drawing-kind="ruler"]').evaluate(ruler => {
    const texts = [...ruler.querySelectorAll('text')];
    const group = texts[0]?.parentElement;
    const card = group?.querySelector('rect');
    const svg = ruler.closest('svg');
    const chart = svg?.parentElement?.querySelector('.tv-lightweight-charts');
    const pane = chart?.querySelector('tr:first-child td:nth-child(2) canvas');
    if (!card || !pane || !svg) throw new Error('Ruler label or real candle pane missing');
    const rect = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    return { lines: texts.map(el => el.textContent), card: rect(card), plot: rect(pane), overlay: rect(svg),
      texts: texts.map(el => ({ text: el.textContent, box: rect(el), fontSize: Number(el.getAttribute('font-size')) })),
      live: ruler.hasAttribute('data-drawing-live'), selected: ruler.hasAttribute('data-drawing-selected'),
      handles: [...svg.querySelectorAll('[data-drawing-anchor]')].map(el => ({ id: el.getAttribute('data-drawing-anchor'), box: rect(el.querySelector('circle:last-child')) })),
      body: rect(ruler.querySelector('polygon[fill="transparent"]')),
      toolbar: document.querySelector('[data-drawing-object-toolbar]') ? rect(document.querySelector('[data-drawing-object-toolbar]')) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}

function verify(m, expected, context) {
  // Mobile is allowed to wrap the price and percent onto separate lines.
  const first = m.lines[0].includes('(') ? m.lines[0] : `${m.lines[0]} ${m.lines[1]}`;
  assert.equal(first, expected, `${context}: signed price and percentage`);
  assert.ok(!/NaN|Infinity|undefined/.test(m.lines.join(' ')), `${context}: finite display`);
  assert.ok(m.plot.width > 100 && m.plot.width < m.overlay.width, `${context}: measured candle plot excludes price axis`);
  assert.ok(m.card.left >= m.plot.left - 1 && m.card.right <= m.plot.right + 1
    && m.card.top >= m.plot.top - 1 && m.card.bottom <= m.plot.bottom + 1,
  `${context}: whole card fits the actual candle pane: ${JSON.stringify({ card: m.card, plot: m.plot })}`);
  for (const text of m.texts) {
    assert.ok(text.box.left >= m.card.left + 3 && text.box.right <= m.card.right - 3
      && text.box.top >= m.card.top && text.box.bottom <= m.card.bottom,
    `${context}: text must not clip its card: ${JSON.stringify(text)}`);
  }
  if (m.selected && m.toolbar) {
    const overlapWidth = Math.min(m.card.right, m.toolbar.right) - Math.max(m.card.left, m.toolbar.left);
    const overlapHeight = Math.min(m.card.bottom, m.toolbar.bottom) - Math.max(m.card.top, m.toolbar.top);
    assert.ok(overlapWidth <= 1 || overlapHeight <= 1,
      `${context}: selected toolbar must not cover the measurement card: ${JSON.stringify({ card: m.card, toolbar: m.toolbar })}`);
  }
  assert.ok(m.overflow <= 1, `${context}: no horizontal page overflow`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { label: LABEL, environment: 'Built frontend; local NRX fixtures; all writes and external transports denied', cases: [] };
  let server, browser;
  try {
    server = fixtureServer();
    if (!server.listening) await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
    for (const width of WIDTHS) for (const scenario of CASES) {
      let lastClose = 247.58;
      const view = { width, scenario: scenario.name, errors: [], writes: [], blockedExternal: [], blockedWebSockets: [], continuedUrls: [] };
      report.cases.push(view);
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 940 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv', serviceWorkers: 'block' });
      let page;
      try {
        await context.addInitScript(({ key, from, to, live, end, hour }) => {
          localStorage.setItem('exchange_token', 'local-fixture-only');
          localStorage.setItem('exchange_lang', 'ru');
          localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false, locked: false, drawings: [{ kind: 'ruler',
            points: [{ time: end - 25 * hour, price: from }, { time: end - 4 * hour, price: to }], ...(live ? { followLast: true } : {}) }] }));
        }, { key: STORAGE_KEY, ...scenario, end: END, hour: HOUR });
        await context.routeWebSocket(/.*/, ws => { view.blockedWebSockets.push(ws.url()); ws.close(); });
        await context.route('**/*', async route => {
          const q = route.request(), u = new URL(q.url());
          if (!['GET', 'HEAD'].includes(q.method())) { view.writes.push(`${q.method()} ${u.pathname}`); return route.abort(); }
          if (/\/market\/test-assets\/NRX-USDT\/candles$/i.test(u.pathname)) return route.fulfill({ json: { candles: candles(lastClose) } });
          if (/\/market\/nrx\/?$/.test(u.pathname)) return route.fulfill({ json: { serverTime: Date.now(), assets: [asset(lastClose)] } });
          if (/\/market\/(test-assets|listings)\/?$/.test(u.pathname)) return route.fulfill({ json: { serverTime: Date.now(), assets: [] } });
          // route.fetch is explicitly redirected to loopback, never the request's origin.
          if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ response: await route.fetch({ url: origin + u.pathname + u.search, maxRedirects: 0 }) });
          if (u.origin === origin) { view.continuedUrls.push(u.href); return route.continue(); }
          view.blockedExternal.push(u.href);
          return route.abort();
        });
        page = await context.newPage();
        page.on('pageerror', e => view.errors.push(e.message));
        await page.goto(origin + '/trade?pair=NRX%2FUSDT', { waitUntil: 'domcontentloaded' });
        await page.locator('g[data-drawing-kind="ruler"] text').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(500);
        await page.locator('.chart-view').first().scrollIntoViewIfNeeded();
        view.initial = await measurement(page);
        verify(view.initial, scenario.expected, `${width}/${scenario.name}`);
        assert.equal(view.initial.live, !!scenario.live, 'live marker follows persisted state');
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-${scenario.name}-unselected-chart.png`) });

        const body = view.initial.body;
        const plot = view.initial.plot;
        await page.mouse.click(Math.max(plot.left + 12, Math.min(body.left + body.width * 0.3, plot.right - 12)),
          Math.max(plot.top + 12, Math.min(body.top + body.height * 0.65, plot.bottom - 12)));
        await page.waitForTimeout(150);
        view.selected = await measurement(page);
        assert.equal(view.selected.selected, true, `${width}/${scenario.name}: ruler selectable`);
        assert.deepEqual(view.selected.handles.map(h => h.id), ['0', '1', 'edge0', 'edge1'], 'selected ruler keeps all four handles');
        verify(view.selected, scenario.expected, `${width}/${scenario.name}/selected`);
        await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-${scenario.name}.png`), fullPage: true });
        await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-${scenario.name}-chart.png`) });

        if (scenario.live) {
          lastClose = 260;
          await page.waitForFunction(() => [...document.querySelectorAll('g[data-drawing-kind="ruler"] text')].some(el => el.textContent.includes('+259,19')), null, { timeout: 12000 });
          view.afterTick = await measurement(page);
          verify(view.afterTick, '+259,19 (+31\u00a0998,77%)', `${width}/live/refresh`);
          assert.equal(view.afterTick.live, true, 'refresh keeps live end enabled');
          assert.deepEqual(view.afterTick.handles.map(h => h.id), ['0', '1', 'edge0', 'edge1'], 'live refresh keeps all handles');
          await page.locator('[data-object-action="measure"]').click();
          const form = page.locator('form[data-object-menu="measure"]');
          assert.equal(await form.locator('input[name="to"]').inputValue(), '260', 'exact end field follows latest candle');
          assert.equal(await form.locator('input[name="followLast"]').isChecked(), true, 'live checkbox stays checked');
          await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-live-refreshed-settings.png`), fullPage: true });
          // Exact prices stay editable and stop following when requested.
          await form.locator('input[name="followLast"]').uncheck();
          await form.locator('input[name="to"]').fill('200');
          await form.locator('button[type="submit"]').click();
          view.fixed = await measurement(page);
          verify(view.fixed, '+199,19 (+24\u00a0591,36%)', `${width}/fixed-price`);
          assert.equal(view.fixed.live, false, 'exact fixed-price edit clears live end');

          // The price-only end handle still exposes the guide, hides the label
          // during a drag, snaps to latest price, then restores exact measurement.
          const edge = view.fixed.handles.find(h => h.id === 'edge1').box;
          const liveEdge = view.afterTick.handles.find(h => h.id === 'edge1').box;
          const x = edge.x + edge.width / 2, y = edge.y + edge.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x, y - 15, { steps: 4 });
          view.dragging = { guide: await page.locator('[data-drawing-guide]').count(), label: await page.locator('g[data-drawing-kind="ruler"] text').count() };
          assert.deepEqual(view.dragging, { guide: 1, label: 0 }, 'drag shows price guide and hides measurement card');
          await page.mouse.move(x, liveEdge.y + liveEdge.height / 2 + 3, { steps: 8 });
          assert.equal(await page.locator('[data-guide-snapped]').count(), 1, 'end handle snaps to the current price');
          view.snappedTag = await page.locator('[data-drawing-guide] text').textContent();
          assert.match(view.snappedTag, /Текущая цена 260/, 'guide prints the exact current fixture price');
          await page.locator('.chart-view').first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-drag-snap-chart.png`) });
          await page.mouse.up();
          view.dropped = await measurement(page);
          verify(view.dropped, '+259,19 (+31\u00a0998,77%)', `${width}/drag-released`);
          assert.equal(await page.locator('[data-drawing-guide]').count(), 0, 'drag guide clears after release');
        }
        assert.deepEqual(view.errors, [], `${width}/${scenario.name}: no browser errors`);
        assert.deepEqual(view.writes, [], `${width}/${scenario.name}: no trading/account writes`);
        assert.ok(view.continuedUrls.every(url => new URL(url).origin === origin), `${width}/${scenario.name}: continued HTTP requests are loopback only`);
        console.log(`${width}/${scenario.name}: PASS; plot ${view.initial.plot.width.toFixed(0)}px; ${view.initial.lines.join(' / ')}`);
      } catch (error) {
        view.failure = error.stack || String(error);
        if (page) await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-${scenario.name}-failed.png`), fullPage: true }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  } catch (error) {
    report.failure = error.stack || String(error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
