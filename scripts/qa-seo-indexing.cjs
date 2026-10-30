#!/usr/bin/env node
/**
 * Issue #632 browser and crawler check of the BUILT frontend (frontend/dist),
 * served by `wrangler pages dev` — the local Cloudflare Pages emulator, which
 * applies the same _headers, x.html address mapping and SPA fallback as the
 * Pages project. Nothing is deployed; every request outside 127.0.0.1 is
 * blocked, so no API, market feed or font is contacted.
 *
 *   QA_PLAYWRIGHT_MODULE=<…/node_modules/playwright> QA_WRANGLER_BIN=<…/node_modules/.bin/wrangler> \
 *     node scripts/qa-seo-indexing.cjs
 *
 * 1. As a crawler without scripts: robots.txt, sitemap.xml, every sitemap URL
 *    (200, its own canonical, no noindex), old Help copies, every signed-in
 *    and sign-in address (robots meta and/or X-Robots-Tag, no canonical),
 *    deep and unknown links (still the SPA fallback, never a 404).
 * 2. Chromium with JavaScript off: the head of public pages is complete.
 * 3. Chromium at 1440×900 and 390×844 with JavaScript: the page renders, no
 *    uncaught error, no horizontal scroll, and the rendered head keeps the
 *    right canonical and robots after the app's own redirects.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend', 'dist');
const out = path.join(root, 'output', 'seo-indexing');
const ORIGIN = 'https://voltextech.net';
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const wranglerBin = process.env.QA_WRANGLER_BIN;
if (!wranglerBin || !fs.existsSync(wranglerBin)) throw new Error('QA_WRANGLER_BIN must point at a wrangler binary');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the frontend first: npm run build --prefix frontend');

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) console.error(`FAIL ${name}`, detail ?? ''); };
const all = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
const headOf = (html) => ({
  title: all(html, /<title>([^<]*)<\/title>/g)[0] ?? null,
  canonical: all(html, /<link rel="canonical" href="([^"]+)"/g),
  ogUrl: all(html, /<meta property="og:url" content="([^"]+)"/g),
  robots: all(html, /<meta name="robots" content="([^"]+)"/g),
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
    server.on('error', reject);
  });
}

async function startPages() {
  // Its own folder with its own minimal config, so wrangler never picks up a Worker config from a parent directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-pages-'));
  fs.writeFileSync(path.join(dir, 'wrangler.toml'), 'name = "voltex-seo-qa"\ncompatibility_date = "2026-10-01"\npages_build_output_dir = "dist"\n');
  fs.symlinkSync(dist, path.join(dir, 'dist'), 'dir');
  const port = await freePort();
  const log = fs.openSync(path.join(out, 'wrangler.log'), 'w');
  const child = spawn(wranglerBin, ['pages', 'dev', 'dist', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: dir, stdio: ['ignore', log, log], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`wrangler exited ${child.exitCode}; see output/seo-indexing/wrangler.log`);
    try { if ((await fetch(`${base}/`)).ok) return { base, stop: () => child.kill('SIGTERM') }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error('Pages emulator did not start');
}

async function crawler(base) {
  const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type') || '', xRobots: r.headers.get('x-robots-tag'), body: await r.text() }; };

  const robots = await get('/robots.txt');
  check('robots.txt is served as text with the sitemap', robots.status === 200 && robots.type.startsWith('text/plain') && robots.body.includes(`Sitemap: ${ORIGIN}/sitemap.xml`) && /^Disallow:\s*$/m.test(robots.body), robots.type);
  const sitemap = await get('/sitemap.xml');
  const locs = all(sitemap.body, /<loc>([^<]+)<\/loc>/g);
  check('sitemap.xml is served as XML with absolute main-domain URLs', sitemap.status === 200 && /xml/.test(sitemap.type) && locs.length > 30 && locs.every((u) => u.startsWith(`${ORIGIN}/`)), { type: sitemap.type, urls: locs.length });

  const listed = [];
  for (const url of locs) {
    const p = url.slice(ORIGIN.length) || '/';
    const page = await get(p);
    const head = headOf(page.body);
    listed.push({ path: p, ...head });
    check(`listed ${p}: 200, own canonical, indexable`, page.status === 200 && page.type.startsWith('text/html') && head.canonical.join() === url && head.ogUrl.join() === url && head.robots.length === 0 && !page.xRobots && head.title, { status: page.status, head, xRobots: page.xRobots });
  }
  for (const [p, target] of [['/help', '/academy/faq'], ['/help/faq', '/academy/faq'], ['/help/fees', '/academy/knowledge'], ['/help/rules', '/academy/knowledge']]) {
    const head = headOf((await get(p)).body);
    check(`old Help ${p} names ${target}`, head.canonical.join() === ORIGIN + target && !locs.includes(ORIGIN + p), head);
  }

  // Every X-Robots-Tag rule in the built _headers, plus deep links that fall back to index.html.
  const rules = [...fs.readFileSync(path.join(dist, '_headers'), 'utf8').matchAll(/^(\/\S*)\n\s+X-Robots-Tag: (.+)$/gm)].map((m) => ({ p: m[1], robots: m[2].trim() }));
  const unlisted = rules.map(({ p, robots }) => ({ p: p.replace('/*', '/deep/link'), robots, staticCopy: !p.includes('*') }));
  unlisted.push({ p: '/admin/users/42', robots: 'noindex, nofollow', staticCopy: false }, { p: '/trade?pair=BTC_USDT', robots: 'noindex, nofollow', staticCopy: true }, { p: '/login?next=%2Fwallet', robots: 'noindex, follow', staticCopy: true });
  for (const { p, robots, staticCopy } of unlisted) {
    const page = await get(p);
    const head = headOf(page.body);
    const ok = page.status === 200 && page.xRobots === robots && !locs.some((u) => u.slice(ORIGIN.length) === p.split('?')[0])
      && (staticCopy ? head.robots.join() === robots && head.canonical.length === 0 : true);
    check(`unlisted ${p}: ${robots}${staticCopy ? ' (header and meta)' : ' (header)'}`, ok, { status: page.status, xRobots: page.xRobots, head });
  }
  for (const p of ['/does/not/exist', '/SOMECODE', '/academy/no-such-section/no-such-article']) {
    const page = await get(p);
    check(`unknown ${p} still gets the SPA (200, not a Pages 404)`, page.status === 200 && page.body.includes('<div id="root"></div>'), page.status);
  }
  return { locs, listed, unlisted: unlisted.length };
}

async function browsers(base, locs) {
  const browser = await chromium.launch();
  const offline = async (context) => context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });

  // JavaScript off: what a crawler that does not run scripts sees.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  await offline(noJs);
  const raw = await noJs.newPage();
  for (const p of ['/', '/academy', '/academy/futures/perpetual', '/academy/faq', '/legal/terms', '/help/status']) {
    await raw.goto(base + p);
    const head = await raw.evaluate(() => ({
      title: document.title,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    }));
    check(`no-JS ${p}: title, description and canonical present`, head.title.length > 5 && head.description.length > 20 && head.canonical === (p === '/' ? `${ORIGIN}/` : ORIGIN + p) && head.robots === null, head);
  }
  await noJs.close();

  const routes = [
    // [address, final path after the app's own redirects, expected canonical (null = none), expected robots (null = none)]
    ['/', '/', `${ORIGIN}/`, null],
    ['/academy', '/academy', `${ORIGIN}/academy`, null],
    ['/academy/learn', '/academy/learn', `${ORIGIN}/academy/learn`, null],
    ['/academy/knowledge', '/academy/knowledge', `${ORIGIN}/academy/knowledge`, null],
    ['/academy/faq', '/academy/faq', `${ORIGIN}/academy/faq`, null],
    ['/academy/glossary', '/academy/glossary', `${ORIGIN}/academy/glossary`, null],
    ['/academy/futures/perpetual', '/academy/futures/perpetual', `${ORIGIN}/academy/futures/perpetual`, null],
    ['/help/status', '/help/status', `${ORIGIN}/help/status`, null],
    ['/help/faq', '/academy/faq', `${ORIGIN}/academy/faq`, null],
    ['/help/fees', '/academy/knowledge', `${ORIGIN}/academy/knowledge`, null],
    ['/legal/terms', '/legal/terms', `${ORIGIN}/legal/terms`, null],
    ['/legal/about', '/legal/about', `${ORIGIN}/legal/about`, null],
    // The licences page adds its own identical noindex, nofollow (LicencesPage); compared as a set.
    ['/legal/licenses', '/legal/licenses', null, 'noindex, nofollow'],
    ['/wallet', '/login', null, 'noindex, follow'],
    ['/trade', '/login', null, 'noindex, follow'],
    ['/register', '/register', null, 'noindex, follow'],
  ];
  const results = [];
  for (const [label, viewport, extra] of [['desktop-1440', { width: 1440, height: 900 }, {}], ['mobile-390', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const context = await browser.newContext({ viewport, ...extra, locale: 'ru-RU' });
    await offline(context);
    const page = await context.newPage();
    for (const [address, finalPath, canonical, robots] of routes) {
      const errors = [];
      const onError = (error) => errors.push(String(error.message || error).slice(0, 200));
      page.on('pageerror', onError);
      await page.goto(base + address, { waitUntil: 'domcontentloaded' });
      // Wait for the page's own text, not just any child of #root: a lazy route first mounts the text-free Suspense
      // shell (RouteShell), and on a loaded runner its chunk can take longer than the 1.2 s settle below (#613 CI:
      // Academy pages at 390 read `rendered: 0`). The assertion below is unchanged.
      await page.waitForFunction(() => (document.getElementById('root')?.innerText || '').trim().length > 20, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => ({
        path: location.pathname,
        title: document.title,
        canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
        ogUrl: [...document.querySelectorAll('meta[property="og:url"]')].map((m) => m.getAttribute('content')),
        robots: [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute('content')),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        rendered: (document.getElementById('root')?.innerText || '').trim().length,
        h1: document.querySelector('h1')?.textContent?.trim() || null,
      }));
      page.off('pageerror', onError);
      const shot = `${label}${address.replace(/[^a-z0-9]+/gi, '_')}.png`;
      await page.screenshot({ path: path.join(out, shot) });
      const ok = state.path === finalPath && errors.length === 0 && state.overflow <= 1 && state.rendered > 20
        && state.canonical.join() === (canonical ?? '') && state.ogUrl.join() === (canonical ?? '') && [...new Set(state.robots)].join() === (robots ?? '');
      results.push({ viewport: label, address, ...state, errors, screenshot: shot });
      check(`${label} ${address} → ${finalPath}: renders, canonical ${canonical ?? 'none'}, robots ${robots ?? 'none'}`, ok, { ...state, errors });
    }
    await context.close();
  }
  await browser.close();
  return results;
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const pages = await startPages();
  let report;
  try {
    const crawl = await crawler(pages.base);
    const rendered = await browsers(pages.base, crawl.locs);
    report = { sitemapUrls: crawl.locs.length, unlistedAddresses: crawl.unlisted, renderedChecks: rendered.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks, rendered };
  } finally {
    pages.stop();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sitemapUrls: report.sitemapUrls, unlistedAddresses: report.unlistedAddresses, renderedChecks: report.renderedChecks, passed: report.passed, failed: report.failed }, null, 2));
  process.exitCode = report.failed ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });
