'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const { fixture } = require('./qa-home-v0.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const optimized = process.argv.includes('--updated-only');
const mobile = process.argv.includes('--mobile');
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const out = path.resolve(`output/home-v0/performance${mobile ? '-mobile' : ''}${optimized ? '-optimized' : ''}.json`);
let browser, server, variant = 'baseline';
const rows = [];
(async () => {
  const dirs = { ...(optimized ? {} : { baseline: path.resolve('output/baseline-dist') }), updated: path.resolve('frontend/dist') };
  for (const dir of Object.values(dirs)) if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`Missing prepared build: ${dir}`);
  const app = express(); app.use('/api/v1', fixture);
  const statics = Object.fromEntries(Object.entries(dirs).map(([key, dir]) => [key, express.static(dir)]));
  app.use((req, res, next) => statics[variant](req, res, next));
  app.get('*', (_req, res) => res.sendFile(path.join(dirs[variant], 'index.html')));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  for (const next of optimized ? ['updated'] : ['baseline', 'updated', 'updated', 'baseline', 'baseline', 'updated']) {
    variant = next;
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.__perf = { tasks: [], lcp: [], shifts: [], frames: 0 };
      new PerformanceObserver(list => window.__perf.tasks.push(...list.getEntries().map(x => ({ start: x.startTime, duration: x.duration })))).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver(list => window.__perf.lcp.push(...list.getEntries().map(x => ({ time: x.startTime, element: x.element?.tagName + '.' + x.element?.className, url: x.url })))).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => window.__perf.shifts.push(...list.getEntries().filter(x => !x.hadRecentInput).map(x => x.value))).observe({ type: 'layout-shift', buffered: true });
      function frame() { window.__perf.frames++; requestAnimationFrame(frame); } requestAnimationFrame(frame);
    });
    const page = await context.newPage(); const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    const start = Date.now(); await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#home-live-terminal .book-row').first().waitFor();
    const coldReadyMs = Date.now() - start;
    if (mobile) await page.locator(variant === 'updated' ? '.v0-coins' : '.hero').scrollIntoViewIfNeeded();
    if (variant === 'updated') await page.waitForFunction(() => document.querySelector('.v0-coins')?.dataset.ready === 'true');
    await wait(2500);
    const snapshot = async () => ({ metrics: Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])), ui: await page.evaluate(() => ({ time: performance.now(), frames: window.__perf.frames, sceneFrames: document.querySelector('.v0-coins')?.__voltexHeroSceneStats.frames ?? 0 })) });
    const before = await snapshot(); await wait(6000); const after = await snapshot();
    const perf = await page.evaluate(() => ({ ...window.__perf, renderer: document.querySelector('.v0-coins')?.dataset ? { ...document.querySelector('.v0-coins').dataset, ...document.querySelector('.v0-coins').__voltexHeroSceneStats } : null }));
    const seconds = (after.ui.time - before.ui.time) / 1000;
    rows.push({ variant, coldReadyMs, lcpMs: perf.lcp.at(-1)?.time, lcpCandidates: perf.lcp, cls: perf.shifts.reduce((sum, x) => sum + x, 0), pageFps: (after.ui.frames - before.ui.frames) / seconds, sceneFps: (after.ui.sceneFrames - before.ui.sceneFrames) / seconds, taskSeconds: after.metrics.TaskDuration - before.metrics.TaskDuration, scriptSeconds: after.metrics.ScriptDuration - before.metrics.ScriptDuration, heapBytes: after.metrics.JSHeapUsedSize, warmLongTasks: perf.tasks.filter(x => x.start >= before.ui.time), coldLongTasks: perf.tasks.filter(x => x.start < before.ui.time), renderer: perf.renderer });
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ fixtureOnly: true, renderer: 'Chromium software WebGL (SwiftShader), not physical GPU telemetry', viewport, warmSampleSeconds: 6, rows }, null, 2));
  console.log(JSON.stringify({ out, rows }));
  if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
});
