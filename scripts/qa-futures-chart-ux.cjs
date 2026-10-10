/** Desktop Futures chart UX QA (Issue #502): indicator catalogue, white price
 *  scale, settings persistence, drawing rail. Reuses the read-only loopback
 *  fixture of qa-futures-proportions.cjs; never contacts production. */
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.CHART_QA_OUT || path.join(root, 'output/futures-chart-ux'));
const port = Number(process.env.CHART_QA_PORT || 4452);
const origin = `http://127.0.0.1:${port}`;
const LABEL = process.env.CHART_QA_LABEL || 'after';
const WIDTHS = (process.env.CHART_QA_WIDTHS || '1366x768,1440x900,1707x900,1920x1080').split(',').map(s => s.split('x').map(Number));

/** Pixels of the main pane's right price-scale canvas: `bright` = neutral and
 *  ≥ 150 on every channel (light grey-to-white digits; the gold last-price tag
 *  is not neutral and does not count), `white` = neutral and ≥ 225 on every
 *  channel (anti-aliased white text; a 12px glyph rarely covers a whole pixel,
 *  so pure 255 is not required). The Futures default axis tone is #8b8b8e
 *  (139 at most), so the default has no bright pixel, which is what «white»
 *  has to change. */
const SCALE_PIXELS = (which) => `(() => {
  const host = document.querySelector('.chart-view .tv-lightweight-charts');
  if (!host) return { error: 'no chart' };
  const rows = Array.from(host.querySelectorAll('table > tr'));
  const row = ${which === 'time' ? 'rows[rows.length - 1]' : 'rows[0]'};
  const cells = row ? Array.from(row.querySelectorAll('td')) : [];
  const canvases = cells.flatMap(cell => Array.from(cell.querySelectorAll('canvas')));
  const canvas = ${which === 'time'
    ? 'canvases.sort((a, b) => b.width - a.width)[0]'
    : 'cells.length ? cells[cells.length - 1].querySelector(\'canvas\') : null'};
  if (!canvas) return { error: 'no scale canvas' };
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let white = 0, bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Neutral and light: the digits, not the gold last-price tag the scale also carries.
    if (Math.min(r, g, b) >= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 12) bright++;
    if (Math.min(r, g, b) >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 8) white++;
  }
  return { white, bright, width: canvas.width, height: canvas.height };
})()`;
const WHITE_PIXELS = SCALE_PIXELS('price');
const TIME_PIXELS = SCALE_PIXELS('time');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'qa-futures-proportions.cjs'), '--serve', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 20000);
    server.stdout.on('data', () => { clearTimeout(timeout); resolve(); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited: ${code}`)); });
  });
  const browser = await chromium.launch({ headless: true });
  const report = { label: LABEL, cases: [], errors: [], external: [], writes: [], assertions: [] };
  const ok = (name, value) => { report.assertions.push({ name, ok: Boolean(value) }); assert.ok(value, name); };
  try {
    for (const [width, height] of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) { report.external.push(req.url()); return route.abort(); }
        if (!['GET', 'HEAD'].includes(req.method())) report.writes.push({ url: req.url(), method: req.method() });
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => { if (!/Invalid language tag/.test(error.message)) report.errors.push(error.message); });
      const open = async () => { await page.goto(`${origin}/futures?pair=BTC%2FUSDT`); await page.locator('.rb-row').first().waitFor(); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(900); };
      await open();
      const shot = name => page.screenshot({ path: path.join(out, `${LABEL}-${width}-${name}.png`) });
      await shot('initial');
      const item = { width, height };
      // (a) The indicator trigger never shows a count, whatever is active.
      const trigger = page.locator('.chart-indicators-trigger');
      const visibleText = await trigger.evaluate(el => Array.from(el.childNodes).map(n => n.nodeType === 3 ? n.textContent : (n.offsetWidth > 0 && n.offsetHeight > 0 && getComputedStyle(n).position !== 'absolute' ? n.textContent : '')).join('').trim());
      item.triggerText = visibleText;
      ok(`${width}: indicator trigger shows no digit (${visibleText})`, !/\d/.test(visibleText));
      ok(`${width}: no visible count badge`, await page.locator('.chart-menu-count').count() === 0);
      // Add three indicators through the catalogue: one price-pane, two lower-pane.
      await trigger.click();
      const menu = page.locator('.chart-menu-catalogue');
      await menu.waitFor();
      await shot('indicator-menu');
      ok(`${width}: catalogue lists 15 indicators`, await menu.locator('[data-chart-indicator]').count() === 15);
      await menu.locator('input[type="search"]').fill('ema');
      ok(`${width}: search narrows the catalogue`, await menu.locator('[data-chart-indicator]').count() === 1);
      await menu.locator('[data-chart-indicator="ema"]').click();
      await menu.locator('input[type="search"]').fill('');
      await menu.locator('[data-chart-indicator="rsi"]').click();
      await menu.locator('[data-chart-indicator="macd"]').click();
      await page.waitForTimeout(400);
      ok(`${width}: four instances on the chart`, await menu.locator('[data-chart-active-indicator]').count() === 4);
      const triggerAfter = await trigger.evaluate(el => Array.from(el.childNodes).map(n => n.nodeType === 3 ? n.textContent : (n.offsetWidth > 0 && n.offsetHeight > 0 && getComputedStyle(n).position !== 'absolute' ? n.textContent : '')).join('').trim());
      ok(`${width}: trigger still shows no digit with four active (${triggerAfter})`, !/\d/.test(triggerAfter));
      ok(`${width}: the count is announced to assistive technology`, (await trigger.getAttribute('data-chart-indicators-active')) === '4' && (await trigger.locator('.chart-menu-sr').count()) === 1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const panes = await page.evaluate(() => document.querySelectorAll('.chart-view .tv-lightweight-charts table > tr').length);
      item.paneRows = panes;
      // Rows: main pane, volume pane, RSI pane, MACD pane, the time axis row.
      ok(`${width}: two lower-pane indicators open two panes (rows ${panes})`, panes >= 5);
      const legend = await page.locator('.voltex-indicator-legend').innerText();
      item.legend = legend;
      ok(`${width}: legend names the instances`, /SMA 200/.test(legend) && /EMA 20/.test(legend) && /RSI 14/.test(legend) && /MACD 12/.test(legend));
      await shot('indicators-on');
      // Persistence across a reload and a timeframe change.
      await page.reload(); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(900);
      ok(`${width}: indicators persist across a reload`, /EMA 20/.test(await page.locator('.voltex-indicator-legend').innerText()));
      await page.locator('.chart-tabs .chart-tab').nth(1).click(); await page.waitForTimeout(900);
      ok(`${width}: indicators survive a timeframe change`, /RSI 14/.test(await page.locator('.voltex-indicator-legend').innerText()));
      // (b) White price-scale digits through Settings → Scales; Cancel reverts, Ok keeps.
      await shot('scales-default');
      const before = await page.evaluate(WHITE_PIXELS);
      item.whiteBefore = before;
      ok(`${width}: price scale digits are grey by default (bright ${before.bright}, white ${before.white})`, before.bright !== undefined && before.bright < 20 && before.white < 10);
      await page.locator('.chart-settings-trigger').click();
      await page.locator('#vcs-tab-scales').click();
      await shot('settings-scales');
      await page.locator('[data-axis-white="price-axis"]').click();
      await page.waitForTimeout(400);
      const previewed = await page.evaluate(WHITE_PIXELS);
      item.whitePreview = previewed;
      ok(`${width}: #FFFFFF paints the price scale digits white at once (bright ${previewed.bright}, white ${previewed.white})`, previewed.bright > 100 && previewed.white > 40);
      await page.locator('.vcs-foot .vcs-btn').nth(1).click(); // Cancel
      await page.waitForTimeout(400);
      const reverted = await page.evaluate(WHITE_PIXELS);
      ok(`${width}: Cancel puts the grey back (bright ${reverted.bright})`, reverted.bright < 20);
      await page.locator('.chart-settings-trigger').click();
      await page.locator('#vcs-tab-scales').click();
      await page.locator('[data-axis-white="price-axis"]').click();
      await page.locator('[data-axis-white="time-axis"]').click();
      await page.locator('[data-setting="axis-font-size"]').selectOption('14');
      await page.locator('.vcs-ok').click();
      await page.waitForTimeout(500);
      await shot('white-scales');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voltex.chartSettings.v1') || '{}'));
      item.saved = { priceAxisText: saved.priceAxisText, timeAxisText: saved.timeAxisText, axisFontSize: saved.axisFontSize };
      ok(`${width}: Ok keeps #ffffff and 14px in this browser`, saved.priceAxisText === '#ffffff' && saved.timeAxisText === '#ffffff' && saved.axisFontSize === 14);
      const kept = await page.evaluate(WHITE_PIXELS), time = await page.evaluate(TIME_PIXELS);
      item.whiteKept = kept; item.timeWhite = time;
      ok(`${width}: both scales are white after Ok (price ${kept.white}, time ${time.white})`, kept.white > 40 && time.white > 20);
      await page.reload(); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(900);
      const reloaded = await page.evaluate(WHITE_PIXELS);
      ok(`${width}: white scales survive a reload (white ${reloaded.white})`, reloaded.white > 40);
      await page.goto(`${origin}/futures?pair=ETH%2FUSDT`); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(900);
      ok(`${width}: white scales survive a symbol change`, (await page.evaluate(WHITE_PIXELS)).white > 40);
      await page.locator('.chart-tabs .chart-tab').nth(2).click(); await page.waitForTimeout(900);
      ok(`${width}: white scales survive an interval change`, (await page.evaluate(WHITE_PIXELS)).white > 40);
      // (e) The drawing rail: width, the collapse handle, reclaimed plot width, keyboard, persistence.
      await page.goto(`${origin}/futures?pair=BTC%2FUSDT`); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(900);
      const rail = await page.locator('.drawing-rail').boundingBox();
      const toggle = page.locator('.drawing-rail-toggle');
      const toggleBox = await toggle.boundingBox();
      const toggleStyle = await toggle.evaluate(el => { const c = getComputedStyle(el); return { color: c.color, background: c.backgroundColor, border: c.borderRightColor }; });
      item.rail = { width: rail.width, toggle: toggleBox, toggleStyle };
      ok(`${width}: rail is 56px wide (${rail.width})`, Math.abs(rail.width - 56) < 1);
      ok(`${width}: collapse handle is at least 22×48 (${toggleBox.width}×${toggleBox.height})`, toggleBox.width >= 22 && toggleBox.height >= 48);
      ok(`${width}: handle is white on a lifted surface`, toggleStyle.color === 'rgb(255, 255, 255)');
      const hit = await page.evaluate(() => { const el = document.querySelector('.drawing-rail-toggle'); const r = el.getBoundingClientRect(); const probe = document.elementFromPoint(r.right + 12, r.top + r.height / 2); return probe === el || el.contains(probe); });
      ok(`${width}: the handle's hit area reaches 12px past its edge`, hit);
      const plotBefore = (await page.locator('.chart-view .tv-lightweight-charts').boundingBox()).width;
      await toggle.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
      ok(`${width}: Enter collapses the rail (aria-expanded=false)`, (await toggle.getAttribute('aria-expanded')) === 'false' && (await page.locator('.drawing-rail').isHidden()));
      const plotAfter = (await page.locator('.chart-view .tv-lightweight-charts').boundingBox()).width;
      item.plot = { before: plotBefore, after: plotAfter };
      ok(`${width}: collapsing gives the plot the rail's width (${plotBefore} → ${plotAfter})`, plotAfter - plotBefore >= 50);
      await shot('rail-collapsed');
      await page.reload(); await page.locator('.chart-view canvas').first().waitFor(); await page.waitForTimeout(700);
      ok(`${width}: the collapsed rail is remembered`, (await page.locator('.drawing-rail-toggle').getAttribute('aria-expanded')) === 'false');
      await page.locator('.drawing-rail-toggle').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(500);
      ok(`${width}: Space expands it again`, (await page.locator('.drawing-rail-toggle').getAttribute('aria-expanded')) === 'true' && (await page.locator('.drawing-rail').isVisible()));
      const chart = await page.locator('.chart-area').boundingBox(), book = await page.locator('.orderbook-area').boundingBox(), form = await page.locator('.order-form-area').boundingBox();
      item.geometry = { chart, book, form };
      ok(`${width}: #494 geometry kept — book 286, ticket 300, chart beside the book`, Math.abs(book.width - 286) < 1.5 && Math.abs(form.width - 300) < 1.5 && Math.abs(chart.height - book.height) < 1.5);
      await shot('final');
      // Clean this context's storage for the next width: each context is new anyway.
      report.cases.push(item);
      await context.close();
    }
    // Phone sanity: the chart still mounts, the rail is a horizontal strip, no page errors.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await phone.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort(); return route.continue(); });
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => { if (!/Invalid language tag/.test(error.message)) report.errors.push('390: ' + error.message); });
    await mobile.goto(`${origin}/futures?pair=BTC%2FUSDT`); await mobile.locator('.futures-mobile-tabs button').first().waitFor();
    // The phone opens on the trading workspace; the chart is the first tab.
    await mobile.locator('.futures-mobile-tabs button').first().click();
    await mobile.locator('.chart-view canvas').first().waitFor(); await mobile.waitForTimeout(900);
    const phoneRail = await mobile.locator('.drawing-rail').boundingBox();
    ok(`390: phone rail stays a horizontal strip (${phoneRail && phoneRail.width}×${phoneRail && phoneRail.height})`, phoneRail && phoneRail.width > 300 && phoneRail.height < 60);
    await mobile.screenshot({ path: path.join(out, `${LABEL}-390-initial.png`) });
    await phone.close();
    assert.deepEqual(report.errors, [], 'no runtime exceptions');
    assert.deepEqual(report.external, [], 'no external requests');
    assert.ok(report.writes.every(r => /\/private-trading\/native\/(execution-session|quote)$/.test(new URL(r.url).pathname)), 'no financial execution writes (fixture session/quote only)');
  } finally {
    await browser.close(); server.kill();
    fs.writeFileSync(path.join(out, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ cases: report.cases.length, assertions: report.assertions.length, failed: report.assertions.filter(a => !a.ok).length, errors: report.errors, external: report.external, writeCount: report.writes.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
