'use strict';
// Fixture-only browser QA. Unknown API/external traffic is denied. No credentials,
// production orders or deployment calls. The same harness measures main and PR.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const baseline = process.argv.includes('--baseline');
const quick = process.argv.includes('--quick');
const dist = path.resolve(baseline ? 'output/baseline-dist' : 'frontend/dist');
const out = path.resolve(`output/home-v0/${baseline ? 'baseline' : 'updated'}`);
fs.mkdirSync(out, { recursive: true });
const report = { baseline, fixtureOnly: true, startedAt: new Date().toISOString(), screenshots: [], findings: [], pageErrors: [], consoleErrors: [], unexpectedConsoleErrors: [], requests: [], blocked: [], metrics: {}, responsive: [], cycle: [] };
const prices = { BTC: 76746, ETH: 2479.53, SOL: 99.78, XRP: 1.35, BNB: 610, ADA: .24, DOGE: .095, TRX: .3 };
const tickers = Object.entries(prices).map(([base, price]) => ({ pair: `${base}/USDT`, lastPrice: String(price), bidPrice: String(price * .9999), askPrice: String(price * 1.0001), high24h: String(price * 1.02), low24h: String(price * .98), volume24h: '1000', quoteVolume24h: String(price * 1000), changePercent24h: '1.25' }));
const candles = Array.from({ length: 48 }, (_, i) => { const open = 76000 + i * 9, close = open + (i % 2 ? 14 : -8); return { time: 1799990000 + i * 900, open, high: Math.max(open, close) + 12, low: Math.min(open, close) - 10, close, volume: 40 + i }; });
function fixture(req, res) {
  const p = req.path;
  if (p === '/market/external/tickers') return res.json({ source: 'qa', tickers });
  if (p.startsWith('/market/external/orderbook/')) return res.json({ source: 'qa', pair: 'BTC/USDT', timestamp: Date.now(), bids: Array.from({ length: 8 }, (_, i) => ({ price: String(76745.9 - i * .1), quantity: String(.1 + i * .03) })), asks: Array.from({ length: 8 }, (_, i) => ({ price: String(76746.1 + i * .1), quantity: String(.12 + i * .025) })) });
  if (p.startsWith('/market/external/candles/')) return res.json({ source: 'qa', pair: 'BTC/USDT', interval: '15m', candles });
  if (p.startsWith('/market/external/trades/')) return res.json({ source: 'qa', pair: 'BTC/USDT', trades: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, price: String(76746 - i * .2), quantity: String(.02 + i * .01), side: i % 2 ? 'SELL' : 'BUY', time: Date.now() - i * 1000 })) });
  if (p === '/market/external/rankings') return res.json({ source: 'qa', rankings: [] });
  if (p === '/market/global') return res.json({ source: 'qa', global: null, fearGreed: null });
  if (p === '/market/assets/icons') return res.json({ icons: {} });
  if (p === '/cfd/display/tickers' || p === '/cfd/tickers') return res.json({ source: 'qa', configured: true, _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 21600000 }, tickers: Object.entries({ XAUUSD: 4349.19, WTIUSD: 96.607, EURUSD: 1.17, GBPUSD: 1.34, XAGUSD: 34.72, XBRUSD: 99.2, USDJPY: 146.7 }).map(([symbol, price]) => ({ symbol, name: symbol, price: String(price), changePercent24h: '1.02', status: 'sampled', stale: true, marketClosed: false, displayOnly: true, executionAllowed: false, entitlementVerified: false, provider: 'qa', providerSymbol: symbol, providerTimestamp: Date.now(), fetchedAt: Date.now(), asOf: Date.now(), maxQuoteAgeMs: 21600000 })) });
  if (p === '/futures/config') return res.json({ symbols: ['BTC/USDT'], tradingEnabled: false });
  if (p === '/support/conversations/mine') return res.json({ conversation: null, messages: [] });
  if (p === '/auth/me' || p === '/me') return res.status(401).json({ error: 'Unauthenticated' });
  return res.status(503).json({ error: 'Not used in fixture-only home QA' });
}
let server, browser, page, context;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function screenshot(name, fullPage = false) {
  const file = path.join(out, `${name}.png`); await page.screenshot({ path: file, fullPage }); report.screenshots.push(file);
}
async function geometry(label) {
  const state = await page.evaluate(() => {
    const r = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const copy = document.querySelector('.hs-root .copy'), coins = document.querySelector('.v0-coins'), terminal = document.querySelector('#home-live-terminal');
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, copy: copy && r(copy), coins: coins && r(coins), terminal: terminal && r(terminal), heading: document.querySelector('#hs-title')?.textContent, medallions: [...document.querySelectorAll('.v0-coin')].filter(e => getComputedStyle(e).visibility !== 'hidden').length, texts: [...document.querySelectorAll('.v0-quote')].map(x => x.textContent), brokenImages: [...document.images].filter(x => x.complete && !x.naturalWidth).map(x => x.getAttribute('src')) };
  });
  report.responsive.push({ label, ...state });
  assert.ok(state.overflow <= 1, `${label} overflow ${state.overflow}`);
  assert.equal(state.brokenImages.length, 0, `${label} broken images`);
  if (!baseline) {
    assert.ok(state.medallions >= (state.width > 900 ? 7 : 3) && state.medallions <= (state.width > 900 ? 8 : 4));
    if (state.width > 900) assert.ok(state.copy.x + state.copy.width <= state.coins.x + 4, `${label} copy/coin overlap`);
  }
}
module.exports = { fixture };
if (require.main === module) (async () => {
  const app = express(); app.use('/api/v1', (req, res) => { report.requests.push(req.method + ' ' + req.path); return fixture(req, res); });
  app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.HOME_QA_BROWSER_CHANNEL || undefined, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', recordVideo: !quick && !baseline ? { dir: path.join(out, 'video'), size: { width: 1440, height: 900 } } : undefined });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || url.protocol === 'data:') return route.continue(); report.blocked.push(url.origin + url.pathname); return route.abort(); });
  await context.addInitScript(() => {
    if (!localStorage.getItem('exchange_lang')) localStorage.setItem('exchange_lang', 'ru');
    window.__homePerf = { longTasks: [], shifts: [], fps: [], lcp: [] };
    new PerformanceObserver(list => window.__homePerf.lcp.push(...list.getEntries().map(x => x.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => window.__homePerf.longTasks.push(...list.getEntries().map(x => x.duration))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(list => window.__homePerf.shifts.push(...list.getEntries().filter(x => !x.hadRecentInput).map(x => x.value))).observe({ type: 'layout-shift', buffered: true });
    let frames = 0, previous = performance.now();
    function count(now) { frames++; if (now - previous >= 1000) { window.__homePerf.fps.push(frames * 1000 / (now - previous)); frames = 0; previous = now; } requestAnimationFrame(count); } requestAnimationFrame(count);
  });
  page = await context.newPage();
  const videoStartedAt = Date.now();
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    report.consoleErrors.push(message.text());
    const url = message.location().url;
    const parsed = url ? new URL(url) : null;
    const intentionallyBlocked = parsed && report.blocked.includes(parsed.origin + parsed.pathname);
    if (!(intentionallyBlocked && message.text() === 'Failed to load resource: net::ERR_FAILED')) {
      report.unexpectedConsoleErrors.push({ text: message.text(), url });
    }
  });
  const start = Date.now(); await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#home-live-terminal .book-row').first().waitFor({ timeout: 15000 });
  report.metrics.coldReadyMs = Date.now() - start;
  if (!baseline) await page.waitForFunction(() => document.querySelector('.v0-coins')?.dataset.ready === 'true', { timeout: 15000 });
  await geometry('1440'); await screenshot('home-1440');
  if (!quick) {
    for (const width of [1920, 1707, 1366, 1024, 768, 430, 390, 360, 320]) {
      await page.setViewportSize({ width, height: width > 1000 ? (width === 1366 ? 768 : 1080) : 900 });
      await wait(200); await geometry(String(width)); await screenshot(`home-${width}`);
    }
    if (!baseline) {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.locator('#hs-title').evaluate(element => { element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; });
      assert.equal(await page.locator('#hs-title').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'enlarged heading text stays within 320px copy');
      await page.locator('#hs-title').evaluate(element => element.style.removeProperty('font-size'));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!baseline) {
      // matchMedia/React/WebGL remount settle asynchronously after the last
      // mobile viewport. Begin the full physical cycle only on the ready desktop scene.
      await page.waitForFunction(() => document.querySelectorAll('.v0-coin').length === 24 && document.querySelector('.v0-coins')?.dataset.ready === 'true');
      const seen = new Set(); const requestsBefore = report.requests.length;
      report.videoCycleStartSeconds = (Date.now() - videoStartedAt) / 1000;
      for (let i = 0; i < 115; i++) {
        const ids = await page.locator('.v0-coin').evaluateAll(elements => elements.filter(x => getComputedStyle(x).visibility !== 'hidden').map(x => x.dataset.instrument));
        assert.equal(new Set(ids).size, ids.length, 'duplicate instrument in visible scene'); assert.ok(ids.length >= 7 && ids.length <= 8);
        ids.forEach(id => seen.add(id)); report.cycle.push(ids); await wait(650);
      }
      report.metrics.cycleInstruments = [...seen]; assert.equal(seen.size, 24, 'all archive instruments participate');
      report.metrics.cycleRequests = report.requests.slice(requestsBefore); // This fixture deliberately has global:null. The existing homepage retries
      // only that missing summary after 60s; the former 35s test never reached it.
      assert.ok(report.metrics.cycleRequests.length <= 2 && report.metrics.cycleRequests.every(p => p === 'GET /market/global'), 'animation must not request any quotes; only the unchanged missing-summary retry is allowed');
      const frames = () => page.locator('.v0-coins').evaluate(element => element.__voltexHeroSceneStats.frames);
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await wait(150); const a = await frames(); await wait(700); assert.equal(await frames(), a, 'offscreen loop stopped');
      await page.evaluate(() => scrollTo(0, 0)); await wait(200);
      await page.emulateMedia({ reducedMotion: 'reduce' }); await wait(100); const b = await frames(); await wait(700); assert.equal(await frames(), b, 'reduced-motion loop stopped');
      await screenshot('home-reduced-motion'); await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(await page.locator('.v0-motion-toggle').count(), 0, 'manual control removed');
      // Explicit visibility-state fixture; no claim that headless tabs model an
      // OS-minimized window. Exercise the same real visibility event handler.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await wait(100); const hidden = await frames(); await wait(500); assert.equal(await frames(), hidden, 'hidden-state handler stops renderer');
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    }
    await screenshot('home-full', true);
    report.metrics.browser = await page.evaluate(() => ({ ...window.__homePerf, heap: performance.memory?.usedJSHeapSize, renderer: { ...document.querySelector('.v0-coins')?.dataset, ...document.querySelector('.v0-coins')?.__voltexHeroSceneStats } }));
    for (const lang of ['en', 'zh', 'es', 'hi', 'ja', 'ko', 'ru']) {
      await page.evaluate(lang => localStorage.setItem('exchange_lang', lang), lang);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#hs-title').waitFor();
      await geometry(`language-${lang}`);
      report[`copy-${lang}`] = await page.locator('.hs-root .subtitle').innerText();
      await screenshot(`home-${lang}-1440`);
      await page.setViewportSize({ width: 320, height: 900 }); await wait(250); await geometry(`language-${lang}-320`);
      await page.setViewportSize({ width: 1440, height: 900 }); await wait(100);
    }
    assert.equal(new Set(['en', 'zh', 'es', 'hi', 'ja', 'ko', 'ru'].map(lang => report[`copy-${lang}`])).size, 7, 'seven real localized copies loaded');
    if (!baseline) {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.locator('.v0-coins').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelectorAll('.v0-coin').length === 24 && document.querySelector('.v0-coins')?.dataset.ready === 'true');
      const seen = new Set();
      for (let i = 0; i < 115; i++) { const ids = await page.locator('.v0-coin').evaluateAll(elements => elements.filter(x => getComputedStyle(x).visibility !== 'hidden').map(x => x.dataset.instrument)); assert.equal(new Set(ids).size, ids.length); assert.ok(ids.length >= 3 && ids.length <= 4); ids.forEach(id => seen.add(id)); await wait(650); }
      assert.equal(seen.size, 24, 'mobile cycle includes all 24 instruments'); report.metrics.mobileCycleInstruments = [...seen];
      await page.evaluate(() => scrollTo(0, 0)); await wait(100);
      const heroBottom = await page.locator('#home-global-hero').evaluate(element => Math.ceil(element.getBoundingClientRect().bottom));
      await page.screenshot({ path: path.join(out, 'home-mobile-hero.png'), fullPage: true, clip: { x: 0, y: 0, width: 390, height: heroBottom } });
      report.screenshots.push(path.join(out, 'home-mobile-hero.png'));
      await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => scrollTo(0, 0));
    }
    const memoryCdp = await context.newCDPSession(page); await memoryCdp.send('Performance.enable');
    report.metrics.remountHeapBytes = [];
    for (const route of ['/futures', '/trade', '/futures', '/trade', '/futures', '/trade', '/futures', '/trade']) {
      if (!baseline) await page.evaluate(() => { window.__oldHero = document.querySelector('.v0-coins'); });
      await page.locator(`.product-shortcuts a[href="${route}"]`).click(); await page.waitForURL(url => url.pathname === route || url.pathname === '/login');
      if (!baseline) {
        // A lazy route updates the URL before React commits the replacement.
        // Measure disposal after the actual unmount, not during that transition.
        await page.waitForFunction(() => !window.__oldHero.isConnected && !window.__oldHero.querySelector('canvas'));
        const stopped = await page.evaluate(() => window.__oldHero.__voltexHeroSceneStats.frames); await wait(120);
        assert.equal(await page.evaluate(() => window.__oldHero.__voltexHeroSceneStats.frames), stopped, 'unmounted renderer has no active RAF');
        assert.equal(await page.evaluate(() => window.__oldHero.querySelectorAll('canvas').length), 0, 'disposed canvas removed');
        await page.evaluate(() => { delete window.__oldHero; });
      }
      await page.goBack({ waitUntil: 'networkidle' }); await page.locator('#hs-title').waitFor();
      if (!baseline) {
        await page.waitForFunction(() => document.querySelector('.v0-coins')?.dataset.ready === 'true');
        assert.equal(await page.locator('.v0-coin-canvas').count(), 1, 'one canvas after route return');
        await memoryCdp.send('HeapProfiler.collectGarbage');
        report.metrics.remountHeapBytes.push((await memoryCdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'JSHeapUsedSize').value);
      }
    }
    if (!baseline) assert.ok(report.metrics.remountHeapBytes.at(-1) - report.metrics.remountHeapBytes[1] < 8 * 1024 * 1024, 'bounded post-GC heap across eight route remounts');
    for (const route of ['/login', '/register']) {
      await page.goto(origin + route, { waitUntil: 'networkidle' });
      assert.ok(await page.locator('input[type="password"]').count(), `${route} real form available`);
      await screenshot(route.slice(1));
    }
    await page.goto(origin, { waitUntil: 'networkidle' });
    if (!baseline) {
      // Exercise a real WebGL context loss: the complete readable static scene
      // must survive, not a blank canvas or raster with demo prices.
      await page.waitForFunction(() => document.querySelector('.v0-coins')?.dataset.ready === 'true');
      await page.locator('.v0-coin-canvas').evaluate(canvas => { window.__lost = canvas.getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lost.loseContext(); });
      await page.waitForFunction(() => document.querySelector('.v0-coins')?.dataset.ready === 'false');
      assert.equal(await page.locator('.v0-coin').count(), 24);
      assert.equal(await page.locator('.v0-coin-canvas').isVisible(), false, 'lost canvas must not cover static fallback');
      assert.equal(await page.locator('.v0-coin-fallback').first().isVisible(), true);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await wait(100);
      assert.equal(await page.locator('.v0-coins').getAttribute('data-active'), 'false', 'lost context must not restart on visibility');
      await screenshot('home-webgl-fallback');
      await page.evaluate(() => window.__lost.restoreContext());
      await page.waitForSelector('.v0-coins[data-ready=true][data-active=true]');
      const recovered = await page.locator('.v0-coins').evaluate(e => e.__voltexHeroSceneStats.frames);
      await wait(400); assert.ok(await page.locator('.v0-coins').evaluate(e => e.__voltexHeroSceneStats.frames) > recovered, 'restored context resumes movement');
    }
  }
  if (!report.metrics.browser) report.metrics.browser = await page.evaluate(() => ({ ...window.__homePerf, heap: performance.memory?.usedJSHeapSize, resources: performance.getEntriesByType('resource').map(x => ({ name: new URL(x.name).pathname, bytes: x.transferSize, duration: x.duration })), renderer: document.querySelector('.v0-coins')?.dataset ? { ...document.querySelector('.v0-coins').dataset } : null }));
  assert.equal(report.pageErrors.length, 0, 'browser exceptions');
  assert.equal(report.unexpectedConsoleErrors.length, 0, 'unexpected browser console errors');
  await context.close(); context = null;
})().catch(error => { report.findings.push(error.stack || String(error)); console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, findings: report.findings, errors: report.pageErrors, screenshots: report.screenshots, coldReadyMs: report.metrics.coldReadyMs }));
  if (context) await context.close(); if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
});
