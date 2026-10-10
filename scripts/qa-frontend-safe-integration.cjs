/** Integration-only browser review. Built frontend, synthetic read-only fixture,
 * loopback networking, no production credentials, no order submission. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./qa-mobile-client-fixture.cjs');
const out = path.resolve(process.env.QA_OUT || 'output/frontend-safe-integration');
fs.mkdirSync(out, { recursive: true });
const languages = ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'];
const widths = [320, 360, 390, 430, 1366, 1440, 1920];
const routes = ['/', '/login', '/register', '/trade?pair=BTC%2FUSDT', '/futures', '/trade?market=cfd', '/wallet', '/card'];
const report = { cases: [], navigation: [], failures: [], pageErrors: [], blockedExternal: [], writes: [] };
const fixture = createFixture({});
let browser, server;
async function main() {
  server = fixture.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const jobs = languages.flatMap(lang => widths.map(width => ({ lang, width })));
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { lang, width } = jobs[next++];
      const context = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 900 }, serviceWorkers: 'block' });
      context.setDefaultTimeout(10000);
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { report.blockedExternal.push(url.origin); return route.abort(); }
        if (!['GET', 'HEAD'].includes(req.method())) {
          report.writes.push({ lang, width, path: url.pathname, method: req.method() });
          return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"Read-only QA"}' });
        }
        return route.continue();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.addInitScript(({ lang, token }) => {
        localStorage.setItem('exchange_lang', lang);
        if (['/', '/login', '/register'].includes(location.pathname)) localStorage.removeItem('exchange_token');
        else localStorage.setItem('exchange_token', token);
        const original = window.fetch.bind(window);
        window.fetch = (input, options) => {
          const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
          if (u.origin === 'https://market.voltextech.net') return original('/api/v1' + u.pathname + u.search, options);
          if (u.origin !== location.origin) return Promise.reject(new Error('External networking denied by fixture'));
          return original(input, options);
        };
      }, { lang, token: fixture.token });
      const page = await context.newPage();
      page.on('pageerror', e => report.pageErrors.push({ lang, width, message: e.message }));
      for (const route of routes) {
        const label = `${lang}-${width}-${route}`;
        try {
          await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => document.documentElement.hasAttribute('data-app-started'));
          await page.waitForTimeout(1000);
          assert.equal(new URL(page.url()).pathname, new URL(origin + route).pathname, `${label}: route preserved`);
          const measure = await page.evaluate(() => ({
            overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
            textLength: document.body.innerText.length,
            rawKeys: /\b(?:nav\.card|authShell\.communityTitle|wallet\.title)\b/.test(document.body.innerText),
          }));
          assert.ok(measure.textLength > 30, `${label}: rendered content`);
          assert.ok(measure.overflow <= 1, `${label}: horizontal overflow ${measure.overflow}`);
          assert.equal(measure.rawKeys, false, `${label}: untranslated key`);
          const file = `${lang}-${width}-${route === '/' ? 'home' : route.includes('market=cfd') ? 'cfd' : route.split('?')[0].slice(1)}.png`;
          await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
          report.cases.push({ lang, width, route, ...measure, screenshot: file });
          if (route === '/' || route === '/futures') {
            const header = page.locator(route === '/' ? 'header' : '.global-header').first();
            let card = header.locator('a[href="/card"]:visible').first();
            if (!await card.count()) {
              // The accessible menu name is localized; identify the same menu
              // control by its icon, not a Russian-only name.
              await header.locator(route === '/' ? 'button:has(svg.lucide-menu)' : '.nav-burger').click();
              card = header.locator('a[href="/card"]:visible').first();
            }
            await card.scrollIntoViewIfNeeded();
            assert.equal((await card.innerText()).trim(), 'Card', `${label}: Card label`);
            assert.ok(await card.locator('svg.lucide-credit-card').count(), `${label}: CreditCard icon`);
            await page.screenshot({ path: path.join(out, `nav-${file}`), animations: 'disabled' });
            await card.click();
            if (route === '/') {
              // Card is already auth-protected. Guest navigation must preserve
              // the /card return target, not briefly match it before redirect.
              await page.waitForURL(u => u.pathname === '/login' && u.searchParams.get('next') === '/card', { waitUntil: 'domcontentloaded' });
              await page.locator('#login-email').waitFor();
            } else {
              await page.waitForURL('**/card', { waitUntil: 'domcontentloaded' });
              await page.locator('.vc-card-hero-layout').waitFor();
            }
            const destination = new URL(page.url());
            report.navigation.push({ lang, width, from: route, target: '/card', to: destination.pathname + destination.search, creditCard: true });
          }
        } catch (e) { report.failures.push({ label, error: String(e) }); }
      }
      await context.close();
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`checked ${lang} ${width}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  report.blockedExternal = [...new Set(report.blockedExternal)];
  report.fixtureWrites = fixture.state.requests.filter(r => !['GET', 'HEAD'].includes(r.method));
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.pageErrors, []);
  // Wallet's existing background snapshot request is a write attempt, and is
  // deliberately answered 405 in the browser above. Never forward it or any
  // other write. Report it honestly; unexpected write attempts still fail QA.
  assert.deepEqual(report.writes.filter(r => r.path !== '/api/v1/wallet/portfolio-snapshot'), []);
  assert.deepEqual(report.fixtureWrites, []);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); server?.close();
  console.log(JSON.stringify({ cases: report.cases.length, navigation: report.navigation.length, failures: report.failures.length, pageErrors: report.pageErrors.length, writes: report.writes.length }));
});
