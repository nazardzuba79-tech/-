/** Paired built-UI fixture benchmark; SQL is measured separately by bench-admin-reads.cjs.
 * Cold = fresh browser context; warm = one primed context, full page navigation. HTTP cache is disabled by network isolation in BOTH modes.
 * Measures navigation to data rendered, NOT React CPU/profiler duration. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
exports.run = async ({ origin, variant, out, state, userCount }) => {
  const browser = await chromium.launch({ channel: process.env.QA_BROWSER || 'msedge', headless: true });
  const report = { variant, userCount, repetitions: 30, runtime: 'Edge; actual Vite build; localhost JSON fixtures', sql: 'Not measured here. See isolated PostgreSQL benchmark.', samples: [], summary: [], errors: [], external: [] };
  const routes = [
    { name: 'users', slug: 'users', ready: '[data-user-row]', rows: '[data-user-row]', api: variant === 'before' ? '/admin/users' : '/admin/users/page' },
    { name: 'profile', slug: 'users/qa-user-1', ready: '.admin-main h1', text: 'client.01@example.invalid', rows: '.admin-main span.mono', api: '/admin/users/qa-user-1' + (variant === 'before' ? '' : '/profile') },
    { name: 'audit', slug: 'audit-log', ready: variant === 'before' ? '.admin-main .admin-history-grid' : '.admin-audit-list article', rows: variant === 'before' ? '.admin-main .admin-history-grid' : '.admin-audit-list article', api: '/admin/audit-log' + (variant === 'before' ? '' : '/page') },
  ];
  async function makeContext() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external.push(url.origin); return route.abort(); });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    return context;
  }
  async function sample(page, scenario, mode, index, record = true) {
    const responses = []; let apiBytes = 0, apiHttp = 0;
    const collect = response => { if (!response.url().startsWith(origin + '/api/v1/')) return; apiHttp++; responses.push(response.body().then(body => { apiBytes += body.length; }).catch(() => {})); };
    page.on('response', collect);
    const start = performance.now();
    const apiReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + scenario.api && response.status() === 200);
    await page.goto(`${origin}/admin/${scenario.slug}`, { waitUntil: 'domcontentloaded' });
    await apiReady;
    const ready = page.locator(scenario.ready).first();
    await ready.waitFor({ state: 'visible' });
    if (scenario.text) await page.waitForFunction(text => document.querySelector('.admin-main h1')?.textContent?.includes(text), scenario.text);
    const readyMs = performance.now() - start;
    // Allow auxiliary responses already initiated by this render to complete; excluded from readiness time.
    await page.waitForTimeout(40);
    await Promise.all(responses); page.off('response', collect);
    if (record) report.samples.push({ scenario: scenario.name, mode, index, readyMs, apiHttp, apiBytes, domRows: await page.locator(scenario.rows).count() });
  }
  try {
    for (const scenario of routes.filter(x => !process.env.QA_SCENARIO || x.name === process.env.QA_SCENARIO)) for (const mode of ['cold', 'warm']) {
      let context, page;
      if (mode === 'warm') { context = await makeContext(); page = await context.newPage(); await sample(page, scenario, mode, -1, false); }
      for (let index = 0; index < 30; index++) {
        if (mode === 'cold') { context = await makeContext(); page = await context.newPage(); }
        page.removeAllListeners('pageerror'); page.on('pageerror', error => report.errors.push(error.message));
        await sample(page, scenario, mode, index);
        if (mode === 'cold') await context.close();
      }
      if (mode === 'warm') await context.close();
      const data = report.samples.filter(row => row.scenario === scenario.name && row.mode === mode);
      const quantile = (key, p) => [...data].map(x => x[key]).sort((a,b) => a-b)[Math.ceil(data.length * p) - 1];
      report.summary.push({ scenario: scenario.name, mode, n: data.length, medianMs: quantile('readyMs', .5), p95Ms: quantile('readyMs', .95), medianHttp: quantile('apiHttp', .5), medianBytes: quantile('apiBytes', .5), medianDomRows: quantile('domRows', .5) });
      console.log(JSON.stringify(report.summary.at(-1)));
    }
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors)); assert.equal(state.unexpected.length, 0, JSON.stringify(state.unexpected)); assert.equal(report.external.length, 0);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, `browser-benchmark-${userCount}.json`), JSON.stringify(report, null, 2));
  }
};
