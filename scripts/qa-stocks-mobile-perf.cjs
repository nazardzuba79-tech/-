#!/usr/bin/env node
'use strict';
/**
 * #613, report only: the Stocks route on a phone (390×844, DPR 3, touch, 4× CPU throttling) through the real app
 * on the same disposable stack as qa-stocks-route-browser.cjs (real PostgreSQL authority, hosted bundle served by
 * the gateway with its synthetic market). Measures catalogue and terminal open, every timeframe switch, a touch
 * pan and 30 s of an open terminal: long tasks (≥ 50 ms), main-thread busy time (CPU profile), requests, DOM
 * nodes, JS heap and layout shift. With QA_PROFILE_OUT set it also writes the CPU profiles.
 *
 *   QA_STOCKS_DIST=<hosted vite build, see qa-stocks-route-browser.cjs> STOCKS_DISPOSABLE_PG_URL=… \
 *     STOCKS_PG_DISPOSABLE_CONFIRM=… node scripts/qa-stocks-mobile-perf.cjs [out.json]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fixture, disposableUrl } = require('../services/stocks-global/testing/disposable-postgres.cjs');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const API_PORT = 4791, GATEWAY_PORT = 4792, base = `http://127.0.0.1:${GATEWAY_PORT}`, dist = path.resolve(process.env.QA_STOCKS_DIST || 'frontend/dist');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), cleanups = [];
// Busy main-thread time of a CPU profile: every sample except idle, program and the profiler's own root.
const busyMs = profile => profile.samples.reduce((t, id, i) => { const n = profile.nodes.find(x => x.id === id); return ['(idle)', '(program)', '(root)'].includes(n.callFrame.functionName) ? t : t + (profile.timeDeltas[i] ?? 0); }, 0) / 1000;

(async () => {
  assert(disposableUrl(), 'STOCKS_DISPOSABLE_PG_URL and STOCKS_PG_DISPOSABLE_CONFIRM are required');
  const f = await fixture({ after: fn => cleanups.push(fn) }, { normalLogin: true, releaseRouter: true, wallClock: true, apiPort: API_PORT, gatewayPort: GATEWAY_PORT, dist, orderExecutionEnabled: false });
  const email = `synthetic-stocks-mobile-${crypto.randomUUID()}@example.invalid`;
  await f.db.user.create({ data: { id: 'synthetic-stocks-mobile-' + crypto.randomUUID(), email, passwordHash: await require('bcrypt').hash(f.loginPassword, 4), referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}); cleanups.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  let outbound = 0;
  await context.route('**/*', route => { const url = new URL(route.request().url()); if ([base, f.apiOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); outbound++; return route.abort(); });
  await context.addInitScript(() => {
    try { localStorage.setItem('exchange_lang', 'ru'); } catch {}
    window.__long = []; window.__cls = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  const page = await context.newPage(), cdp = await context.newCDPSession(page), requests = [], errors = [];
  page.on('request', request => { const url = new URL(request.url()); requests.push({ at: Date.now(), path: url.pathname }); });
  page.on('pageerror', error => errors.push(String(error.message || error)));
  await page.goto(base + '/login');
  await page.locator('#login-email').fill(email); await page.locator('#login-password').fill(f.loginPassword);
  await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20000 }), page.locator('.vx-auth-submit').click()]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const report = { scope: 'report only: 390x844, DPR 3, 4x CPU throttling, synthetic disposable stack', timeframes: {}, profilesBusyMs: {} };
  const longSince = n => page.evaluate(n => window.__long.slice(n), n), mark = () => page.evaluate(() => window.__long.length);
  const measured = async (name, fn) => {
    const n = await mark(), start = Date.now();
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
    await fn();
    const { profile } = await cdp.send('Profiler.stop');
    if (process.env.QA_PROFILE_OUT) { fs.mkdirSync(process.env.QA_PROFILE_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.QA_PROFILE_OUT, name + '.cpuprofile'), JSON.stringify(profile)); }
    const long = await longSince(n);
    return { ms: Date.now() - start, busyMs: Math.round(busyMs(profile)), longTasks: long.length, longTaskMs: long.reduce((a, b) => a + b, 0), maxLongTaskMs: Math.max(0, ...long) };
  };
  report.catalogue = await measured('catalogue', async () => { await page.goto(base + '/stocks'); await page.locator('.vxo-original-row').first().waitFor({ timeout: 60000 }); });
  report.terminal = await measured('terminal', async () => {
    await page.locator(`a[href="/stocks/${encodeURIComponent(f.ID)}"]`).first().click();
    await page.locator('.vxg-plot canvas').first().waitFor({ timeout: 60000 }); await page.locator('.vxg-mobile-tabs').first().waitFor(); await pause(1500);
  });
  await page.locator('.vxg-mobile-tabs button').filter({ hasText: 'График' }).click();
  const frames = await page.locator('.vxg-timeframes button').allInnerTexts();
  for (const frame of [...frames.slice(1), frames[0]]) report.timeframes[frame] = await measured('tf-' + frame, async () => {
    const loaded = page.waitForResponse(r => { const u = new URL(r.url()); return u.pathname === '/__stocks_global/history' && u.searchParams.get('interval') === frame; }, { timeout: 30000 });
    await page.locator('.vxg-timeframes button').filter({ hasText: new RegExp(`^${frame}$`) }).click(); await loaded;
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await pause(600);
  });
  const box = await page.locator('.vxg-plot canvas').first().boundingBox();
  report.pan = await measured('pan', async () => {
    const at = x => [{ x: box.x + box.width * x, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0.7) });
    for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.7 - i * 0.02) }); await pause(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
  const from = Date.now();
  report.idle30s = await measured('idle-30s', () => pause(30000));
  report.idle30s.requests = requests.filter(r => r.at >= from).reduce((m, r) => ({ ...m, [r.path]: (m[r.path] ?? 0) + 1 }), {});
  await cdp.send('Performance.enable');
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  Object.assign(report, { domNodes: metrics.Nodes, jsHeapMb: Math.round(metrics.JSHeapUsedSize / 2 ** 20 * 10) / 10, layoutShift: await page.evaluate(() => window.__cls), outbound, pageErrors: errors });
  const total = Object.values(report.timeframes);
  report.timeframeTotals = { busyMs: total.reduce((t, x) => t + x.busyMs, 0), longTaskMs: total.reduce((t, x) => t + x.longTaskMs, 0) };
  console.log(JSON.stringify(report, null, 1));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  assert.equal(outbound, 0); assert.deepEqual(errors, []);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { for (const fn of cleanups.reverse()) await fn().catch(() => {}); });
