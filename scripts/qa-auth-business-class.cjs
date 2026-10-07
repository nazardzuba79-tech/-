/** Built-bundle, offline-only visual QA. Never forwards an API request or write. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/auth-business-class');
const report = { head: process.env.QA_HEAD_SHA || process.env.GITHUB_SHA || null, fixtureOnly: true, cases: [], errors: [], failed: [], denied: [], writes: [], result: 'FAIL' };
fs.mkdirSync(out, { recursive: true });
const app = express();
app.use('/api', (_req, res) => res.status(405).end());
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1920, 1440, 1366, 430, 390, 360, 320]) {
      for (const routeName of ['login', 'register']) {
        const ctx = await browser.newContext({ viewport: { width, height: width > 760 ? 960 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 1 });
        await ctx.addInitScript(() => {
          localStorage.setItem('exchange_lang', 'ru');
          window.__authCLS = 0;
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__authCLS += entry.value;
          }).observe({ type: 'layout-shift', buffered: true });
        });
        await ctx.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (!['GET', 'HEAD'].includes(req.method())) {
            report.writes.push({ path: url.pathname, method: req.method() });
            return route.abort();
          }
          if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '/* local fallback font */' });
          if (url.origin === origin && !url.pathname.startsWith('/api')) return route.continue();
          report.denied.push(url.origin + url.pathname);
          return route.abort();
        });
        await ctx.routeWebSocket('**/*', socket => { report.denied.push(socket.url()); socket.close(); });
        const page = await ctx.newPage();
        page.on('pageerror', error => report.errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
        page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') report.failed.push(request.url()); });
        await page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
        await page.locator('.vx-auth-photo').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => { const img = document.querySelector('.vx-auth-photo'); return img.complete && img.naturalWidth > 0; });
        const measurements = await page.evaluate(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
          const img = document.querySelector('.vx-auth-photo');
          const headline = document.querySelector('.vx-auth-hero h2');
          return { overflow: document.documentElement.scrollWidth > innerWidth, brand: rect('.vx-auth-brand'), form: rect('.vx-auth-form'), heading: rect('.vx-auth-hero'), photo: rect('.vx-auth-photo'), src: img.currentSrc.split('/').pop(), cls: window.__authCLS,
            headlineLines: Math.round(headline.getBoundingClientRect().height / parseFloat(getComputedStyle(headline).lineHeight)),
            clipped: [...document.querySelectorAll('.vx-auth h1,.vx-auth h2,.vx-auth p,.vx-auth input,.vx-auth button')].filter(n => n.clientWidth && n.scrollWidth > n.clientWidth + 1).map(n => n.className) };
        });
        report.cases.push({ width, route: routeName, ...measurements });
        assert.equal(measurements.overflow, false, `${routeName} ${width} overflow`);
        assert.deepEqual(measurements.clipped, [], `${routeName} ${width} clipped content`);
        assert.ok(measurements.cls < .02, `${routeName} ${width} CLS ${measurements.cls}`);
        assert.ok(measurements.headlineLines <= 3, `${routeName} ${width} headline stays within three lines`);
        if (width > 760) assert.equal(measurements.brand.width, width / 2);
        else {
          assert.ok(measurements.brand.height <= 295, 'mobile hero stays compact');
          assert.ok(measurements.form.y < 650, 'mobile form is on first screen');
          assert.equal(measurements.src, 'business-class-mobile.webp');
        }
        assert.equal(await page.locator('h1').count(), 1, 'route form keeps the only h1');
        assert.equal(await page.locator('.vx-auth-hero h2').textContent(), 'Копируйте сделки лучших трейдеров мира.');
        assert.equal(await page.locator('.vx-auth-tabs a').first().getAttribute('href'), '/login?next=%2Fwallet');
        assert.equal(await page.locator('.vx-auth-tabs a').last().getAttribute('href'), '/register?next=%2Fwallet');
        await page.screenshot({ path: path.join(out, `${routeName}-${width}.png`), fullPage: true });
        await page.locator('input[type="email"]').fill('fixture@example.invalid');
        const password = page.locator('input[type="password"]').first();
        await password.fill('FixtureOnly123!');
        await page.locator('.vx-auth-toggle').first().click();
        assert.equal(await page.locator('input[value="FixtureOnly123!"]').first().getAttribute('type'), 'text');
        await page.locator('.vx-auth-toggle').first().click();
        await page.locator('input[type="email"]').fill('');
        await page.locator('input[type="password"]').first().fill('');
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        await page.evaluate(() => scrollTo(0, 0));
        await page.locator('.vx-auth-tabs a').nth(routeName === 'login' ? 1 : 0).click();
        await page.waitForURL(`${origin}/${routeName === 'login' ? 'register' : 'login'}?next=%2Fwallet`);
        assert.equal(await page.locator('.vx-auth-tabs a[aria-current="page"]').count(), 1);
        console.log('PASS', routeName, width, JSON.stringify(measurements));
        await ctx.close();
      }
    }
    for (const key of ['errors', 'failed', 'denied', 'writes']) assert.deepEqual(report[key], [], key);
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
