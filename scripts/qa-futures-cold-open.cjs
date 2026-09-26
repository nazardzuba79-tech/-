'use strict';
/**
 * COLD OPEN ACROSS A DEPLOYMENT, AGAINST THE HOST AS IT REALLY BEHAVES.
 *
 * The earlier harness modelled a missing asset as `404 text/plain`. The live
 * Cloudflare Pages project does not do that. Measured on voltextech.net:
 *
 *   GET /assets/<name that does not exist>.js
 *   → 200, content-type: text/html (the SPA's index.html),
 *     cache-control: public, max-age=31536000, immutable
 *
 * Pages treats the project as a single-page app (no top-level 404.html), so a
 * miss anywhere — /assets included — answers with the shell, and the
 * `/assets/*` rule in _headers stamps it `immutable`. A browser that asks for
 * a chunk at the wrong moment (an old shell after a deploy, or a new shell
 * whose file the edge has not caught up with yet) stores HTML under a script
 * URL for a year and never asks again. A plain reload cannot fix that, which
 * is what turns a stale shell into a page that stays black.
 *
 * This host serves two REAL production builds with exactly that contract:
 *   HTML            200, Cache-Control: no-cache, no validators (as observed)
 *   existing asset  200, Cache-Control: public, max-age=31536000, immutable
 *   missing asset   200 text/html index.html, the same immutable header
 * plus two knobs for the deploy window: `staleHtml` (an edge still hands out
 * the previous deployment's shell) and `lag` (one asset is not there yet).
 *
 * The browser keeps its real HTTP cache for the whole scenario (no request
 * interception, which would switch that cache off), so poisoning and healing
 * happen exactly as they would for a visitor.
 *
 * Build both fixtures first (BUILD_A / BUILD_B). Evidence: docs/qa/futures-cold-open/.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const DIRS = { A: process.env.BUILD_A || '/tmp/buildA', B: process.env.BUILD_B || '/tmp/buildB' };
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/futures-cold-open');
const EXPECT_FIXED = process.env.QA_EXPECT !== 'baseline';
fs.mkdirSync(OUT, { recursive: true });
const findings = [];
const report = { startedAt: new Date().toISOString(), scenarios: {}, findings,
  environment: 'LOCAL QA ONLY — two real production builds, Cloudflare Pages cache model, no backend' };
const finding = t => { findings.push(t); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

function entryOf(which) {
  return fs.readFileSync(path.join(DIRS[which], 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/)[1];
}
function chunkOf(which, prefix) {
  return fs.readdirSync(path.join(DIRS[which], 'assets')).find(f => f.startsWith(prefix) && f.endsWith('.js'));
}

function pagesHost() {
  const s = { deployment: 'A', previous: 'A', staleHtml: 0, lag: new Set(), cancelAfterStale: false, cancelArmed: false,
    log: { html: [], fallbacks: [], cancelled: 0 } };
  const app = express();
  app.disable('x-powered-by');
  const send = (res, file, cacheControl, type) => {
    res.set('Cache-Control', cacheControl);
    if (type) res.type(type);
    res.sendFile(file, { etag: false, lastModified: false, cacheControl: false });
  };
  app.get('/assets/:file', (req, res) => {
    const name = req.params.file;
    const dir = DIRS[s.deployment];
    const live = path.join(dir, 'assets', name);
    if (s.lag.has(name)) {
      s.lag.delete(name);
      s.log.fallbacks.push(`${name} (not propagated yet)`);
      return send(res, path.join(dir, 'index.html'), IMMUTABLE, 'html');
    }
    if (fs.existsSync(live)) return send(res, live, IMMUTABLE);
    s.log.fallbacks.push(name);
    return send(res, path.join(dir, 'index.html'), IMMUTABLE, 'html');
  });
  app.get('/api/v1/*', (_q, r) => r.status(404).json({ error: 'not part of this harness' }));
  app.get('*', (req, res) => {
    const file = path.join(DIRS[s.deployment], req.path);
    if (req.path !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file, NO_CACHE);
    if (s.cancelArmed && req.headers['sec-fetch-dest'] === 'document') {
      // The recovery reload does not complete. A 204 to a navigation leaves
      // the current document on screen and running — exactly what a blocked
      // reload, a webview that ignores it, or a dead network leaves behind.
      s.cancelArmed = false; s.log.cancelled++;
      return res.status(204).end();
    }
    let which = s.deployment;
    if (s.staleHtml > 0) { s.staleHtml--; which = s.previous; if (s.cancelAfterStale) s.cancelArmed = true; }
    s.log.html.push(which);
    return send(res, path.join(DIRS[which], 'index.html'), NO_CACHE, 'html');
  });
  return { app, s };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const STATE = () => {
  const text = (document.body.innerText || '').trim();
  return {
    path: location.pathname,
    entry: document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null,
    blank: text === '',
    text: text.slice(0, 120),
    futures: !!document.querySelector('.futures-ticker-bar, .ticker-bar, .futures-reference, .reference-market'),
    boundary: text.includes('Что-то пошло не так'),
    bootScreen: !!document.getElementById('boot-recovery'),
    recovering: !!document.querySelector('[data-recovering="true"]'),
    reactStarted: document.documentElement.hasAttribute('data-app-started'),
    guards: Object.keys(sessionStorage).filter(k => k.startsWith('voltex.')),
  };
};

async function tab(ctx, token) {
  const page = await ctx.newPage();
  const nav = [];
  const lines = [];
  // Real document loads only (goto + reloads). framenavigated also fires for
  // the router's history.replaceState, which is not a reload.
  page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) nav.push(r.url()); });
  page.on('console', m => { const t = m.text(); if (t.startsWith('voltex.bootstrap')) lines.push(t); });
  await page.addInitScript(t => {
    try {
      if (t === null) localStorage.removeItem('exchange_token'); else if (t) localStorage.setItem('exchange_token', t);
      localStorage.setItem('exchange_lang', 'ru');
    } catch {}
  }, token);
  return { page, nav, lines };
}

async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  return page.evaluate(STATE).catch(e => ({ error: String(e) }));
}

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

(async () => {
  for (const d of Object.values(DIRS)) if (!fs.existsSync(path.join(d, 'index.html'))) throw new Error(`missing build fixture: ${d}`);
  if (entryOf('A') === entryOf('B')) throw new Error('both builds emitted the same entry; nothing would be stale');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // ── 0. The host model itself matches production ──────────────────────────
  {
    const { app } = pagesHost();
    const { server, origin } = await listen(app);
    const miss = await fetch(`${origin}/assets/FuturesPage-deadbeef.js`);
    const html = await fetch(`${origin}/futures`);
    report.scenarios.host_model = {
      missingAsset: { status: miss.status, type: miss.headers.get('content-type'), cache: miss.headers.get('cache-control') },
      spaEntry: { status: html.status, cache: html.headers.get('cache-control') },
    };
    if (miss.status !== 200 || !/text\/html/.test(miss.headers.get('content-type')) || !/immutable/.test(miss.headers.get('cache-control'))) {
      finding('host model: a missing asset must answer like Pages (200 text/html immutable)');
    }
    server.close();
  }

  // ── 1. Owner's scenario: build A cached, build B deployed, A's chunks gone ─
  for (const [label, device] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
    const { app, s } = pagesHost();
    const { server, origin } = await listen(app);
    const ctx = await browser.newContext(device);
    // Load and cache build A's shell and entry (home page, signed out).
    const warm = await tab(ctx, null);
    await warm.page.goto(`${origin}/`, { waitUntil: 'load' });
    await wait(1500);
    await warm.page.close();
    // Deploy B. One edge still hands out A's shell once (the deploy window).
    s.deployment = 'B'; s.previous = 'A'; s.staleHtml = 1;
    const { page, nav, lines } = await tab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    const samples = [];
    for (let i = 0; i < 10; i++) { await wait(800); samples.push(await page.evaluate(STATE).catch(() => null)); }
    const state = await snap(page, `1-stale-shell-${label}`);
    report.scenarios[`1_stale_shell_${label}`] = { ...state, navigations: nav.length, html: s.log.html, fallbacks: s.log.fallbacks, lines };
    if (!state.futures) finding(`1 ${label}: the terminal did not open after build B replaced build A`);
    if (state.blank) finding(`1 ${label}: the page ended blank`);
    if (nav.length > 2) finding(`1 ${label}: ${nav.length - 1} reloads — at most one is allowed`);
    await ctx.close(); server.close();
  }

  // ── 2. The entry chunk poisoned in the deploy window → the black page ────
  {
    const { app, s } = pagesHost();
    const { server, origin } = await listen(app);
    s.deployment = 'B'; s.lag.add(entryOf('B'));
    const ctx = await browser.newContext(DESKTOP);
    const { page, nav, lines } = await tab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(9000);
    const first = await snap(page, '2-entry-poisoned');
    // The viewer's own reload, the thing that "always worked" before.
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await wait(5000);
    const afterManualReload = await snap(page, '2-entry-poisoned-after-reload');
    report.scenarios['2_entry_poisoned'] = { first, afterManualReload, navigations: nav.length, fallbacks: s.log.fallbacks, lines };
    if (!first.futures) finding('2: a poisoned entry chunk left the terminal unopened');
    if (first.blank) finding('2: a poisoned entry chunk left a BLANK page');
    if (!afterManualReload.futures) finding('2: after a manual reload the terminal still did not open');
    if (nav.length > 3) finding(`2: ${nav.length - 2} automatic reloads — at most one is allowed`);
    await ctx.close(); server.close();
  }

  // ── 3. The route chunk poisoned in the deploy window ─────────────────────
  {
    const { app, s } = pagesHost();
    const { server, origin } = await listen(app);
    s.deployment = 'B'; s.lag.add(chunkOf('B', 'FuturesPage-'));
    const ctx = await browser.newContext(DESKTOP);
    const { page, nav, lines } = await tab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(9000);
    const state = await snap(page, '3-route-chunk-poisoned');
    report.scenarios['3_route_chunk_poisoned'] = { ...state, navigations: nav.length, fallbacks: s.log.fallbacks, lines };
    if (!state.futures) finding('3: a poisoned FuturesPage chunk left the terminal unopened');
    if (state.blank) finding('3: a poisoned FuturesPage chunk left a BLANK page');
    if (nav.length > 2) finding(`3: ${nav.length - 1} reloads — at most one is allowed`);
    await ctx.close(); server.close();
  }

  // ── 4. The recovery reload itself never completes ────────────────────────
  {
    const { app, s } = pagesHost();
    const { server, origin } = await listen(app);
    const ctx = await browser.newContext(DESKTOP);
    const warm = await tab(ctx, null);
    await warm.page.goto(`${origin}/`, { waitUntil: 'load' });
    await wait(1500); await warm.page.close();
    s.deployment = 'B'; s.previous = 'A'; s.staleHtml = 1; s.cancelAfterStale = true;
    const { page, nav, lines } = await tab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const early = await snap(page, '4-reload-pending');
    await wait(11_000);
    const late = await snap(page, '4-reload-never-completed');
    report.scenarios['4_reload_does_not_complete'] = { early, late, navigations: nav.length, cancelled: s.log.cancelled, lines };
    if (s.log.cancelled !== 1) finding('4: the harness did not cancel the recovery reload');
    if (!early || early.blank) finding('4: while the recovery reload was pending the page was BLANK');
    if (!late || late.blank) finding('4: a recovery reload that never completed left the page BLANK');
    if (late && !late.boundary) finding('4: a recovery reload that never completed did not end on the readable card');
    await ctx.close(); server.close();
  }

  // ── 5. A shell that stays stale however often it is fetched ──────────────
  {
    const { app, s } = pagesHost();
    const { server, origin } = await listen(app);
    const ctx = await browser.newContext(DESKTOP);
    const warm = await tab(ctx, null);
    await warm.page.goto(`${origin}/`, { waitUntil: 'load' });
    await wait(1500); await warm.page.close();
    s.deployment = 'B'; s.previous = 'A'; s.staleHtml = Infinity;
    const { page, nav, lines } = await tab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(14_000);
    const state = await snap(page, '5-permanently-stale');
    report.scenarios['5_permanently_stale'] = { ...state, navigations: nav.length, html: s.log.html.length, lines };
    if (state.blank) finding('5: a permanently stale shell ended BLANK instead of a readable verdict');
    if (!state.boundary && !state.bootScreen) finding('5: a permanently stale shell showed neither the boundary nor the recovery screen');
    if (nav.length > 2) finding(`5: RELOAD LOOP — ${nav.length - 1} reloads`);
    await ctx.close(); server.close();
  }

  // ── 6. A genuine render crash must never auto-reload ─────────────────────
  {
    const { app, s } = pagesHost();
    s.deployment = 'B';
    const { server, origin } = await listen(app);
    const ctx = await browser.newContext(DESKTOP);
    const { page, nav } = await tab(ctx, 'local-qa');
    await page.addInitScript(() => {
      // An ordinary runtime exception in the terminal's own render (price
      // formatting) — not a missing module, and not something React itself
      // needs, so the boundary can still paint.
      // eslint-disable-next-line no-extend-native
      Number.prototype.toFixed = function () { throw new TypeError('qa-injected ordinary render crash'); };
    });
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(9000);
    const state = await snap(page, '6-ordinary-crash');
    report.scenarios['6_ordinary_crash'] = { ...state, navigations: nav.length };
    if (nav.length > 1) finding(`6: an ordinary crash caused ${nav.length - 1} reload(s) — it must cause none`);
    if (state.blank) finding('6: an ordinary crash left a BLANK page');
    if (!state.boundary) finding('6: an ordinary crash did not show the boundary');
    await ctx.close(); server.close();
  }

  // ── 7. Offline when the route chunk is due: one try at most, then a verdict
  {
    const { app, s } = pagesHost();
    s.deployment = 'B';
    const { server, origin } = await listen(app);
    const ctx = await browser.newContext(DESKTOP);
    const { page, nav } = await tab(ctx, 'local-qa');
    await page.route('**/assets/FuturesPage-*.js', route => route.abort('internetdisconnected'));
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(14_000);
    const state = await snap(page, '7-offline');
    report.scenarios['7_offline'] = { ...state, navigations: nav.length };
    if (nav.length > 2) finding(`7: offline produced ${nav.length - 1} reloads — reload loop`);
    if (state.blank) finding('7: offline left a BLANK page');
    await ctx.close(); server.close();
  }

  // ── 8. Fresh deployment: every entry route cold-opens, desktop and mobile ─
  {
    const { app, s } = pagesHost();
    s.deployment = 'B';
    const { server, origin } = await listen(app);
    const routes = {};
    for (const [label, device] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
      for (const route of ['/futures', '/trade', '/wallet']) {
        const ctx = await browser.newContext(device);
        const { page, nav } = await tab(ctx, 'local-qa');
        await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
        await wait(3500);
        const state = await snap(page, `8-fresh-${label}${route.replace('/', '-')}`);
        routes[`${label} ${route}`] = { path: state.path, blank: state.blank, boundary: state.boundary, bootScreen: state.bootScreen, navigations: nav.length };
        if (state.blank || state.boundary || state.bootScreen) finding(`8: fresh ${label} ${route} did not open cleanly`);
        if (state.path !== route) finding(`8: fresh ${label} ${route} was redirected to ${state.path}`);
        if (nav.length > 1) finding(`8: fresh ${label} ${route} reloaded (${nav.length - 1} time(s))`);
        await ctx.close();
      }
    }
    report.scenarios['8_fresh_routes'] = { routes, fallbacks: s.log.fallbacks };
    if (s.log.fallbacks.length) finding(`8: a fresh deployment answered ${s.log.fallbacks.length} asset request(s) with the HTML fallback`);
    server.close();
  }

  await browser.close();
  report.status = findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings, scenarios: report.scenarios }, null, 2));
  process.exit(EXPECT_FIXED && findings.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
