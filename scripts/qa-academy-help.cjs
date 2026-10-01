/**
 * Browser QA for Academy and Help (frontend/content/). Serves a production
 * build the way Cloudflare Pages does (a file, then `<path>.html`, then the
 * SPA index.html), blocks every other host, and records what each page asks
 * for. The two /health checks of «Статус системы» are answered by the
 * fixture; nothing here reaches the real API.
 *
 *   QA_DIST=output/academy-qa QA_OUT=<dir> node scripts/qa-academy-help.cjs
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const dist = path.resolve(process.env.QA_DIST || 'output/academy-qa');
const out = path.resolve(process.env.QA_OUT || 'docs/qa/academy-help');
const API = 'https://api.voltextech.net';
const EDGE = 'https://market.voltextech.net';
fs.mkdirSync(out, { recursive: true });

const app = express();
app.use((req, res, next) => {
  const clean = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  const file = path.join(dist, clean);
  if (!file.startsWith(dist)) return res.status(400).end();
  if (clean !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return res.sendFile(file);
  if (fs.existsSync(`${file}.html`)) return res.sendFile(`${file}.html`);
  if (fs.existsSync(path.join(file, 'index.html'))) return res.sendFile(path.join(file, 'index.html'));
  next();
});
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));

const report = { checks: [], pages: [], external: [], health: [], errors: [] };
const check = (name) => { report.checks.push(name); console.log('✓', name); };

async function main() {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
  const healthGate = {};
  async function context(width, { lang = 'ru', token = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([l, tk]) => {
      localStorage.setItem('exchange_lang', l);
      if (tk) localStorage.setItem('exchange_token', tk); else localStorage.removeItem('exchange_token');
    }, [lang, token]);
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url === `${API}/health` || url === `${EDGE}/health`) {
        report.health.push(url);
        const gate = healthGate[url];
        if (gate) await gate.promise;
        return route.fulfill({ status: gate?.status ?? 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
      }
      report.external.push(url);
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(`${page.url()}: ${e.message}`));
    return { ctx, page };
  }
  const fits = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // Sections and one article per section, from the build's own static pages.
  const academyDir = path.join(dist, 'academy');
  const sections = fs.readdirSync(academyDir).filter((n) => fs.statSync(path.join(academyDir, n)).isDirectory()).sort();
  const content = { sections: sections.map((id) => ({ id })), firstArticles: sections.map((id) => ({ section: id, slug: fs.readdirSync(path.join(academyDir, id)).filter((n) => n.endsWith('.html')).sort()[0].replace(/\.html$/, '') })) };
  const visits = [
    ['/academy', 'academy-home'],
    ['/academy/glossary', 'academy-glossary'],
    ...content.sections.map((s) => [`/academy/${s.id}`, `academy-section-${s.id}`]),
    ...content.firstArticles.map((a) => [`/academy/${a.section}/${a.slug}`, `academy-article-${a.section}`]),
    ['/help/faq', 'help-faq'],
    ['/help/fees', 'help-fees'],
    ['/help/rules', 'help-rules'],
  ];
  const shots = new Set(['academy-home', 'academy-glossary', 'academy-article-osnovy', 'academy-article-futures', 'help-faq', 'help-fees', 'help-rules']);
  try {
    for (const width of [1440, 375]) {
      const { ctx, page } = await context(width);
      for (const [url, name] of visits) {
        const before = { external: report.external.length, health: report.health.length };
        await page.goto(origin + url, { waitUntil: 'networkidle' });
        await page.locator('main.vx-kb').waitFor();
        await page.waitForTimeout(150);
        const title = await page.title();
        const ok = await fits(page);
        const apiCalls = report.external.slice(before.external).filter((u) => u.startsWith(API));
        report.pages.push({ width, url, title, fits: ok, apiCalls: apiCalls.length + report.health.length - before.health, otherExternal: report.external.length - before.external - apiCalls.length });
        assert.equal(apiCalls.length, 0, `${url} asked the API`);
        assert.equal(report.health.length, before.health, `${url} checked health`);
        assert.ok(ok, `${url} scrolls sideways at ${width}`);
        assert.ok(title.includes('VOLTEX'), `${url} title`);
        if (shots.has(name)) await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: width < 600 ? false : true });
      }
      check(`${width}px: ${visits.length} Academy/Help pages open with zero requests to api.voltextech.net and no sideways scroll`);
      await ctx.close();
    }

    // In-app navigation keeps the title and description right.
    {
      const { ctx, page } = await context(1440);
      await page.goto(origin + '/academy', { waitUntil: 'networkidle' });
      await page.locator('[data-section="futures"]').click();
      await page.locator('[data-article]').first().click();
      await page.locator('[data-article-body]').waitFor();
      const h1 = await page.locator('[data-article-body] h1').textContent();
      assert.equal(await page.title(), `${h1} — Академия VOLTEX`);
      await page.locator('[data-academy-search]').count().then((n) => assert.equal(n, 0));
      await page.goto(origin + '/academy', { waitUntil: 'networkidle' });
      await page.locator('[data-academy-search]').fill('ликвид');
      assert.ok(await page.locator('[data-article]').count() > 0);
      await page.locator('[data-academy-search]').fill('');
      await page.locator('[data-level="Средний"]').click();
      assert.ok(await page.locator('[data-article]').count() > 0);
      await page.goto(origin + '/academy/glossary', { waitUntil: 'networkidle' });
      await page.locator('[data-glossary-search]').fill('Bid');
      assert.equal(await page.locator('[data-term]').count(), 1);
      await page.goto(origin + '/help/faq', { waitUntil: 'networkidle' });
      await page.locator('[data-faq-item] button').first().click();
      assert.equal(await page.locator('[data-faq-item] button').first().getAttribute('aria-expanded'), 'true');
      await page.locator('[data-help-support]').click();
      await page.locator('.support-panel[role="dialog"]').waitFor({ timeout: 5000 });
      assert.equal(report.external.filter((u) => u.startsWith(API)).length, 0);
      check('search, level filter, glossary search, FAQ accordion and «Напишите в поддержку» work; titles follow in-app moves');
      await ctx.close();
    }

    // Status: one check each, nothing on screen while waiting, then only what
    // the two checks prove (the API and the market Worker answered or not).
    for (const width of [1440, 375]) {
      let release;
      const gate = new Promise((done) => { release = done; });
      healthGate[`${API}/health`] = { promise: gate, status: 200 };
      healthGate[`${EDGE}/health`] = { promise: gate, status: 200 };
      const start = report.health.length;
      const { ctx, page } = await context(width);
      await page.goto(origin + '/help/status', { waitUntil: 'domcontentloaded' });
      await page.locator('[data-status-probe="api"]').waitFor();
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('[data-status]').count(), 0, 'nothing shown while waiting');
      assert.doesNotMatch(await page.locator('main').innerText(), /Ожида|Нет ответа|Проверяем/);
      release();
      await page.locator('[data-status-probe="api"] [data-status="ok"]').waitFor();
      await page.locator('[data-status-probe="market"] [data-status="ok"]').waitFor();
      assert.equal(await page.locator('[data-status-component]').count(), 0, 'no per-operation badges');
      assert.doesNotMatch(await page.locator('main').innerText(), /Работает/);
      assert.match(await page.locator('main').innerText(), /Опубликованных сообщений о сбоях нет/);
      await page.waitForTimeout(3000);
      assert.deepEqual(report.health.slice(start).sort(), [`${API}/health`, `${EDGE}/health`]);
      await page.screenshot({ path: path.join(out, `help-status-${width}.png`), fullPage: width >= 600 });
      assert.ok(await fits(page));
      await ctx.close();
    }
    healthGate[`${API}/health`] = { promise: Promise.resolve(), status: 503 };
    healthGate[`${EDGE}/health`] = { promise: Promise.resolve(), status: 200 };
    {
      const { ctx, page } = await context(1440);
      await page.goto(origin + '/help/status', { waitUntil: 'networkidle' });
      await page.locator('[data-status-probe="api"] [data-status="error"]').waitFor();
      assert.equal(await page.locator('[data-status-probe="api"] [data-status]').textContent(), 'Ответил с ошибкой');
      assert.equal(await page.locator('[data-status-probe="market"] [data-status]').textContent(), 'Отвечает');
      await ctx.close();
    }
    {
      // No answer reaches the browser (blocked here like a network or CORS failure).
      const { ctx, page } = await context(1440);
      await page.route(`${API}/health`, (route) => { report.health.push(`${API}/health`); return route.abort(); });
      await page.goto(origin + '/help/status', { waitUntil: 'networkidle' });
      await page.locator('[data-status-probe="api"] [data-status="unreachable"]').waitFor();
      assert.equal(await page.locator('[data-status-probe="api"] [data-status]').textContent(), 'Не удалось проверить');
      await ctx.close();
    }
    check('status: one GET to the API /health and one to the market Worker /health per open; nothing shown while waiting; rows name only the server and market data (200 → «Отвечает», 503 → «Ответил с ошибкой», no answer → «Не удалось проверить»); «Опубликованных сообщений о сбоях нет»');

    // English and a signed-in visitor.
    {
      const { ctx, page } = await context(1440, { lang: 'en', token: 'qa.eyJzdWIiOiJxYSJ9.qa' });
      const before = report.external.length;
      await page.goto(origin + '/help/fees', { waitUntil: 'networkidle' });
      assert.equal(await page.locator('[role="note"]').textContent(), 'This section is available in Russian only for now');
      assert.equal(await page.locator('[data-help-tab="fees"]').textContent(), 'Fees');
      await page.goto(origin + '/academy/osnovy/stablecoins', { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(out, 'academy-article-en-1440.png') });
      assert.equal(report.external.slice(before).filter((u) => u.startsWith(API)).length, 0);
      check('EN: labels in English, Russian text with the short note; a signed-in visitor also causes no API request');
      await ctx.close();
    }

    // «Академия» is a tab of the site header, for guests and signed-in visitors.
    for (const width of [1440, 1680, 1920]) {
      for (const token of [null, 'qa.eyJzdWIiOiJxYSJ9.qa']) {
        const { ctx, page } = await context(width, { token });
        const before = report.external.length;
        await page.goto(origin + '/academy', { waitUntil: 'networkidle' });
        await page.locator('main.vx-kb').waitFor();
        const tab = page.locator('.global-header .main-nav a[href="/academy"]');
        assert.equal(await tab.isVisible(), true, `Academy tab visible at ${width} (${token ? 'signed in' : 'guest'})`);
        assert.match(await tab.getAttribute('class'), /nav-active/);
        const gap = await page.evaluate(() => {
          const links = [...document.querySelectorAll('.global-header .main-nav > *')].filter((el) => el.getBoundingClientRect().width > 0);
          const right = Math.max(...links.map((el) => el.getBoundingClientRect().right));
          const actions = document.querySelector('.global-header .header-actions').getBoundingClientRect().left;
          return Math.round(actions - right);
        });
        report.headerClearance = [...(report.headerClearance ?? []), { width, signedIn: !!token, clearance: gap }];
        assert.ok(gap >= 20, `header clearance ${gap}px at ${width} (${token ? 'signed in' : 'guest'})`);
        assert.equal(report.external.slice(before).filter((u) => u.startsWith(API)).length, 0);
        if (width === 1440) await page.screenshot({ path: path.join(out, `academy-header-${token ? 'signed-in' : 'guest'}-1440.png`), clip: { x: 0, y: 0, width: 1440, height: 420 } });
        await ctx.close();
      }
    }
    check('«Академия» is a lit tab in the site header at 1440/1680/1920, guest and signed in, ≥20 px clear of the right cluster, no API request');
    // Below 1440 the site folds its sections into the drawer (signed in) —
    // Academy is in it — and guests get the Academy/Help row under the header.
    for (const width of [1280, 375]) {
      const guest = await context(width);
      await guest.page.goto(origin + '/academy', { waitUntil: 'networkidle' });
      assert.equal(await guest.page.locator('.vx-kb-guest-tabs a[href="/academy"][aria-current="page"]').isVisible(), true);
      await guest.ctx.close();
      const member = await context(width, { token: 'qa.eyJzdWIiOiJxYSJ9.qa' });
      await member.page.goto(origin + '/academy', { waitUntil: 'networkidle' });
      await member.page.locator('.global-header .nav-burger').click();
      assert.equal(await member.page.locator('.nav-mobile-menu a[href="/academy"]').isVisible(), true);
      assert.equal(await member.page.locator('.nav-mobile-menu a[href="/help/faq"]').isVisible(), true);
      if (width === 375) await member.page.screenshot({ path: path.join(out, 'academy-menu-signed-in-375.png') });
      await member.ctx.close();
    }
    check('below 1440: guests see the Academy/Help row, signed-in visitors find Academy and Help in the site drawer');

    // Static heads for search engines.
    const raw = await (await fetch(`${origin}/academy/osnovy/stablecoins`)).text();
    assert.match(raw, /<title>Стейблкоины[^<]*— Академия VOLTEX<\/title>/);
    assert.match(raw, /<meta name="description" content="Почему торговля/);
    check('each article address is served with its own <title> and description before any script runs');

    assert.deepEqual(report.errors, []);
    report.otherExternalHosts = [...new Set(report.external.map((u) => new URL(u).host))];
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
