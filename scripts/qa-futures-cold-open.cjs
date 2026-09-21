'use strict';
/**
 * FUTURES COLD OPEN IN A NEW TAB, INCLUDING ACROSS A DEPLOYMENT.
 *
 * The bug this covers: a tab holding the previous deployment's `index.html`
 * and entry chunk opens `/futures`, the router asks for a lazy chunk that the
 * current deployment no longer serves, and the viewer gets «Что-то пошло не
 * так». Measured thrown value, in Chromium, against two real builds:
 *
 *   TypeError: Failed to fetch dynamically imported module: …/FuturesPage-<hash>.js
 *
 * Scenarios, all against PRODUCTION BUILDS served by a static server that
 * models the host — no dev server, no mocked bundler:
 *
 *   A  same-tab navigation to Futures
 *   B  ctrl/cmd-click into a new tab
 *   C  duplicate tab
 *   D  pasted /futures into a fresh tab
 *   E  stale shell + newer deployment -> AT MOST ONE automatic reload
 *   F  a genuine component crash -> boundary, and NO reload loop
 *   G  offline -> no infinite reload
 *
 * Plus the two things a "fix" most easily breaks: SPA routing on direct entry
 * to every route, and the session surviving a new tab.
 *
 * Build both fixtures first — see BUILD_A / BUILD_B below.
 * Evidence: docs/qa/futures-cold-open/.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const A = process.env.BUILD_A || '/tmp/buildA';
const B = process.env.BUILD_B || '/tmp/buildB';
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/futures-cold-open');
fs.mkdirSync(OUT, { recursive: true });
const findings = [];
const report = { startedAt: new Date().toISOString(), scenarios: {}, findings,
  environment: 'LOCAL QA ONLY — two real production builds, static host model, no backend writes' };
const finding = t => { findings.push(t); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * The host, modelled.
 *
 * `stale` serves the OLD shell and lets the OLD entry chunk through as if it
 * came from the browser's own immutable HTTP cache, while every other old
 * chunk is gone — which is exactly the state that produces an ErrorBoundary
 * rather than a blank page: React is already running when the failure lands.
 */
function host(mode) {
  const app = express();
  const log = { served: [], failed: [], html: 0 };
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (/\.js$/.test(req.path)) (res.statusCode >= 400 ? log.failed : log.served).push(req.path);
    });
    next();
  });
  app.get('/assets/:file', (req, res) => {
    const live = path.join(B, 'assets', req.params.file);
    if (fs.existsSync(live)) return res.sendFile(live);
    const old = path.join(A, 'assets', req.params.file);
    if (mode === 'stale' && fs.existsSync(old) && /^index-/.test(req.params.file)) return res.sendFile(old);
    return res.status(404).type('text/plain').send('Not found');
  });
  app.get('/api/v1/*', (_q, r) => r.status(404).json({ error: 'not part of this harness' }));
  app.use(express.static(B, { index: false }));
  app.get('*', (_q, r) => {
    log.html++;
    // The browser's cached copy of the OLD shell is what the new tab boots
    // from — once. `location.reload()` revalidates, so the reload gets the
    // deployment that is actually live. That asymmetry IS the production
    // behaviour, and it is why the owner's manual reload always worked;
    // a host that kept serving the stale shell forever would be modelling
    // E2 below, not this.
    const stale = mode === 'stale' && log.html === 1;
    r.sendFile(path.join(stale ? A : B, 'index.html'));
  });
  return { app, log };
}

const STATE = () => ({
  boundary: (document.body.textContent || '').includes('Что-то пошло не так'),
  futures: !!document.querySelector('.futures-ticker-bar, .ticker-bar, .futures-reference, .reference-market'),
  rootChildren: document.getElementById('root')?.childElementCount ?? -1,
  path: location.pathname,
  guards: Object.keys(sessionStorage).filter(k => k.startsWith('voltex.chunk-recovery')),
});

async function newTab(ctx, token) {
  const page = await ctx.newPage();
  const nav = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) nav.push(f.url()); });
  if (token !== undefined) await page.addInitScript(t => {
    try { if (t === null) localStorage.removeItem('exchange_token'); else localStorage.setItem('exchange_token', t); localStorage.setItem('exchange_lang', 'ru'); } catch {}
  }, token);
  return { page, nav };
}

(async () => {
  for (const dir of [A, B]) if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`missing build fixture: ${dir}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // ── fresh deployment: A, B, C, D, SPA routing, auth ──────────────────────
  {
    const { app, log } = host('fresh');
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext();

    // D — pasted straight into a fresh tab.
    const { page } = await newTab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    report.scenarios.D_paste_new_tab = await page.evaluate(STATE);
    await page.screenshot({ path: path.join(OUT, 'D-paste-new-tab.png') });
    if (!report.scenarios.D_paste_new_tab.futures || report.scenarios.D_paste_new_tab.boundary) {
      finding('D: pasting /futures into a fresh tab did not open the terminal');
    }

    // A — same-tab navigation from home.
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await wait(1200);
    await page.evaluate(() => { history.pushState({}, '', '/futures'); dispatchEvent(new PopStateEvent('popstate')); });
    await wait(2000);
    report.scenarios.A_same_tab = await page.evaluate(STATE);
    if (report.scenarios.A_same_tab.boundary) finding('A: same-tab navigation hit the error boundary');

    // B — a genuinely separate tab in the same context (ctrl/cmd-click).
    const { page: tabB } = await newTab(ctx, undefined);
    await tabB.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    report.scenarios.B_new_tab = await tabB.evaluate(STATE);
    await tabB.screenshot({ path: path.join(OUT, 'B-new-tab.png') });
    if (!report.scenarios.B_new_tab.futures || report.scenarios.B_new_tab.boundary) {
      finding('B: ctrl/cmd-click into a new tab did not open the terminal');
    }

    // C — duplicate tab: same URL, same storage, brand-new page.
    const { page: tabC } = await newTab(ctx, undefined);
    await tabC.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    report.scenarios.C_duplicate_tab = await tabC.evaluate(STATE);
    if (!report.scenarios.C_duplicate_tab.futures || report.scenarios.C_duplicate_tab.boundary) {
      finding('C: duplicating the tab did not open the terminal');
    }

    // SPA routing must still answer direct entry on every route.
    const routes = {};
    for (const route of ['/futures', '/wallet', '/copy-trading', '/markets']) {
      const res = await ctx.request.get(`${origin}${route}`);
      const body = await res.text();
      routes[route] = { status: res.status(), isAppShell: body.includes('<div id="root">') };
      if (res.status() !== 200 || !body.includes('<div id="root">')) {
        finding(`SPA routing: direct ${route} did not return the app shell (status ${res.status()})`);
      }
    }
    report.scenarios.spa_routing = routes;

    // AUTH — a new tab must stay signed in, and a tab with no token must be
    // sent to the sign-in page rather than shown the terminal.
    const { page: authed } = await newTab(ctx, 'local-qa');
    await authed.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(2000);
    const authedState = await authed.evaluate(STATE);
    const anonCtx = await browser.newContext();
    const { page: anon } = await newTab(anonCtx, null);
    await anon.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(2000);
    const anonState = await anon.evaluate(STATE);
    report.scenarios.auth = { authenticatedPath: authedState.path, anonymousPath: anonState.path };
    if (authedState.path !== '/futures') finding('auth: an authenticated new tab was redirected away from /futures');
    if (anonState.path === '/futures') finding('auth: a tab with no token was left on /futures instead of the sign-in page');
    await anonCtx.close();

    report.scenarios.fresh_js_404s = log.failed;
    if (log.failed.length) finding(`fresh deployment served ${log.failed.length} JS 404(s): ${log.failed.slice(0,3)}`);
    await ctx.close(); server.close();
  }

  // ── E: stale shell + newer deployment ────────────────────────────────────
  {
    const { app, log } = host('stale');
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext();
    const { page, nav } = await newTab(ctx, 'local-qa');
    const warnings = [];
    page.on('console', m => { const t = m.text(); if (t.includes('voltex.bootstrap.chunk_recovery')) warnings.push(t); });

    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    // Long enough for the failure, the automatic reload, and the fresh boot.
    await wait(7000);
    const state = await page.evaluate(STATE);
    await page.screenshot({ path: path.join(OUT, 'E-stale-shell-recovered.png') });
    report.scenarios.E_stale_shell = {
      ...state, htmlRequests: log.html, navigations: nav.length,
      staleChunk404s: log.failed.length, recoveryLines: warnings,
    };
    // The point of the whole change: the terminal opens, and the viewer is
    // never shown a failure that a single reload was going to fix.
    if (state.boundary) finding('E: a stale shell still left the error boundary on screen');
    if (!state.futures) finding('E: the terminal did not open after the automatic recovery');
    // AT MOST ONE. The guard is keyed by shell+path, so a reload that returns
    // the same stale shell must not try again.
    if (nav.length > 3) finding(`E: ${nav.length} navigations — that is more than one recovery reload`);
    if (!warnings.some(w => w.includes('chunk_recovery.reloading'))) {
      finding('E: no classifiable recovery line was emitted');
    }
    await ctx.close(); server.close();
  }

  // ── E2: the stale shell NEVER goes away — recovery must give up ──────────
  {
    // Worst case: the HTML stays stale however often it is fetched, so the
    // reload cannot help. One attempt, then the honest boundary. This is the
    // case that separates a recovery from a reload loop.
    const app = express();
    const log = { html: 0 };
    app.get('/assets/:file', (req, res) => {
      const old = path.join(A, 'assets', req.params.file);
      if (fs.existsSync(old) && /^index-/.test(req.params.file)) return res.sendFile(old);
      return res.status(404).type('text/plain').send('Not found');
    });
    app.get('*', (_q, r) => { log.html++; r.sendFile(path.join(A, 'index.html')); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext();
    const { page, nav } = await newTab(ctx, 'local-qa');
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(9000);
    const state = await page.evaluate(STATE);
    await page.screenshot({ path: path.join(OUT, 'E2-permanently-stale.png') });
    report.scenarios.E2_permanently_stale = { ...state, navigations: nav.length, htmlRequests: log.html };
    if (!state.boundary) finding('E2: a permanently stale shell did not end at the error boundary');
    if (nav.length > 3) finding(`E2: RELOAD LOOP — ${nav.length} navigations`);
    if (state.guards.length !== 1) finding(`E2: expected exactly one spent guard, saw ${state.guards.length}`);
    await ctx.close(); server.close();
  }

  // ── F: a genuine component crash must never auto-reload ──────────────────
  {
    const { app } = host('fresh');
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext();
    const { page, nav } = await newTab(ctx, 'local-qa');
    // Break a browser API the terminal uses during render. This is an
    // ordinary runtime exception — not a missing module — and it must reach
    // the boundary and STAY there.
    await page.addInitScript(() => {
      // eslint-disable-next-line no-extend-native
      Array.prototype.map = function () { throw new TypeError('qa-injected ordinary render crash'); };
    });
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(8000);
    const state = await page.evaluate(STATE).catch(() => ({ boundary: null, guards: [] }));
    report.scenarios.F_ordinary_crash = { ...state, navigations: nav.length };
    await page.screenshot({ path: path.join(OUT, 'F-ordinary-crash.png') }).catch(() => {});
    if (nav.length > 2) finding(`F: an ordinary crash caused ${nav.length} navigations — it must cause none`);
    if (Array.isArray(state.guards) && state.guards.length) {
      finding('F: an ordinary crash consumed a chunk-recovery guard');
    }
    await ctx.close(); server.close();
  }

  // ── G: offline must not spin ─────────────────────────────────────────────
  {
    const { app } = host('fresh');
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext();
    const { page, nav } = await newTab(ctx, 'local-qa');
    // The shell loads, then the network dies before the lazy chunk arrives.
    await page.route('**/assets/FuturesPage-*.js', route => route.abort('internetdisconnected'));
    await page.goto(`${origin}/futures`, { waitUntil: 'domcontentloaded' });
    await wait(9000);
    const state = await page.evaluate(STATE);
    report.scenarios.G_offline = { ...state, navigations: nav.length };
    await page.screenshot({ path: path.join(OUT, 'G-offline.png') });
    // One attempt is legitimate — a transient drop is worth one retry. More
    // than that, with the network still down, is a loop.
    if (nav.length > 3) finding(`G: offline produced ${nav.length} navigations — reload loop`);
    if (!state.boundary && !state.futures) finding('G: offline left the page in neither a verdict nor the terminal');
    await ctx.close(); server.close();
  }

  await browser.close();
  report.status = findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings, scenarios: report.scenarios }, null, 2));
  process.exit(findings.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
