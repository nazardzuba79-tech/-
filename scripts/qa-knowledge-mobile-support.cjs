/** Real production bundle; loopback fixtures only, never production or a real message. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.env.QA_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/knowledge-mobile-support');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the frontend first');
fs.mkdirSync(out, { recursive: true });
const report = { commit: process.env.GITHUB_SHA || null, cases: [], errors: [], result: 'FAIL' };
const app = express();
app.use(express.static(dist, { extensions: ['html'], redirect: false }));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
const paths = ['/academy', '/academy/learn', '/academy/futures', '/academy/futures/perpetual', '/academy/knowledge', '/academy/faq', '/academy/glossary', '/help/faq', '/help/fees', '/help/rules', '/help/status'];
const launcher = '.support-launcher';
const inline = '[data-kb-inline-support] button';
const panel = '#voltex-assistant-panel';

async function main() {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
    for (const signedIn of [false, true]) {
      for (const width of [320, 390, 768, 900, 901, 1440]) {
        const mobile = width <= 900;
        const ctx = await browser.newContext({ viewport: { width, height: 812 }, colorScheme: 'dark', reducedMotion: 'reduce' });
        const requests = [];
        await ctx.addInitScript(signed => {
          localStorage.setItem('exchange_lang', 'ru');
          if (signed) localStorage.setItem('exchange_token', 'header.eyJzdWIiOiJxYS1yZWFkaW5nIiwic2lkIjoicWEifQ.signature');
        }, signedIn);
        await ctx.route('**/*', async route => {
          const req = route.request(), u = new URL(req.url());
          // Even loopback /api requests are intercepted. No backend is running.
          if (u.pathname.startsWith('/api/') || u.hostname === 'api.voltextech.net' || u.hostname === 'market.voltextech.net') {
            requests.push({ path: u.pathname, method: req.method() });
            if (req.method() !== 'GET') return route.abort();
            if (u.pathname === '/health') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
            if (/\/me$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"qa-reading","email":"reader@example.invalid","displayName":"Reader","isAdmin":false,"avatarUrl":null}' });
            return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Fixture only"}' });
          }
          if (u.origin === origin && ['GET', 'HEAD'].includes(req.method())) return route.continue();
          return route.abort();
        });
        const page = await ctx.newPage();
        page.on('pageerror', e => report.errors.push(e.message));
        try {
          for (const pathname of paths) {
            const before = requests.length;
            await page.goto(origin + pathname, { waitUntil: 'networkidle' });
            await page.locator('main.vx-kb').waitFor();
            const action = page.locator(inline);
            assert.equal(await action.isVisible(), mobile, `${pathname} inline at ${width}`);
            assert.equal(await page.locator(launcher).isVisible(), signedIn && !mobile, `${pathname} launcher at ${width}`);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${pathname} overflow at ${width}`);
            assert.equal(await page.locator('.vx-kb-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(247, 241, 232)');
            if (pathname !== '/help/status') assert.equal(requests.length, before, `${pathname}: no entry API requests`);
            else assert.ok(requests.slice(before).every(r => r.path === '/health' && r.method === 'GET'), 'status only existing probes');
            if (mobile) {
              const box = await action.boundingBox();
              assert.ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, 'tap target fits');
              assert.equal(await page.locator('[data-kb-inline-support]').evaluate(el => getComputedStyle(el).position), 'static');
              for (const fraction of [0.5, 1]) {
                await page.evaluate(f => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), fraction);
                assert.equal(await page.locator(launcher).isVisible(), false, 'no floating support over middle/end of text');
              }
              await page.evaluate(() => window.scrollTo(0, 0));
            }
            report.cases.push({ pathname, width, signedIn, mobile, entryApiRequests: requests.length - before });
          }
          if (mobile && !signedIn) {
            await page.locator(inline).click();
            await page.waitForURL('**/login');
            assert.equal(await page.locator(panel).count(),0);
            assert.ok(requests.every(r=>r.method==='GET'), 'guest cannot send Support');
          }
          // Actual global widget, not a stub: only signed-in users can open it.
          if (mobile && signedIn) {
            await page.goto(origin + '/academy/futures/perpetual', { waitUntil: 'networkidle' });
            const action = page.locator(inline);
            const before = requests.length;
            await action.focus();
            await page.keyboard.press('Enter');
            await page.locator(panel).waitFor({ state: 'visible' });
            assert.ok(await page.locator('.support-form').isVisible(), 'existing human-support form opens');
            const box = await page.locator(panel).boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'dialog fits');
            await page.keyboard.press('Escape');
            await page.locator(panel).waitFor({ state: 'hidden' });
            assert.equal(await action.evaluate(el => document.activeElement === el), true, 'focus returns to inline support');
            assert.equal(await page.locator(launcher).isVisible(), false, 'launcher stays off reading text after close');
            const opened = requests.slice(before);
            assert.ok(opened.every(r => r.method === 'GET' && /\/me$/.test(r.path)), 'only existing explicit profile prefill');
            assert.ok(opened.length <= (signedIn ? 1 : 0), 'prefill bounded');
            await action.click();
            await page.locator(panel).waitFor({ state: 'visible' });
            await page.locator('.support-panel-close').click();
            assert.equal(await action.evaluate(el => document.activeElement === el), true);
            const shot = `article-${width}-${signedIn ? 'account' : 'guest'}.png`;
            if ([320, 390, 768].includes(width)) await page.screenshot({ path: path.join(out, shot) });
            // CSS remains loaded across SPA navigation: hiding must stop on non-reading routes.
            if (signedIn && width === 390) {
              await page.locator('a[href="/legal/privacy"]').first().click();
              await page.locator('.vx-kb-page').waitFor({ state: 'detached' });
              assert.ok(await page.locator(launcher).isVisible(), 'launcher restored away from reading');
              await page.goBack();
              await page.locator('.vx-kb-page').waitFor();
              assert.equal(await page.locator(launcher).isVisible(), false, 'back restores reading mode');
              await page.setViewportSize({ width: 1440, height: 900 });
              assert.ok(await page.locator(launcher).isVisible(), 'desktop launcher restored on resize');
              assert.equal(await page.locator(inline).isVisible(), false);
              await page.setViewportSize({ width: 390, height: 812 });
              assert.ok(await page.locator(inline).isVisible());
              assert.equal(await page.locator(launcher).isVisible(), false);
              const count = requests.length;
              await page.clock.install();
              await page.clock.fastForward(60 * 60 * 1000);
              assert.equal(requests.length, count, 'one virtual idle hour adds no API request');
            }
          }
        } finally { await ctx.close(); }
      }
    }
    assert.deepEqual(report.errors, [], 'no uncaught browser exceptions');
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().then(() => console.log('Knowledge mobile support: PASS'), error => { console.error(error); process.exitCode = 1; });
