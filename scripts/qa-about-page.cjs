/** Actual production frontend bundle. All API/font responses are local fixtures;
 * external HTTP/WebSocket traffic and every write are denied before dispatch.
 * No real account, market operation, database, backend or production service.
 * QA_DIST=frontend/dist QA_OUT=output/about-page node scripts/qa-about-page.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.env.QA_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/about-page');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the frontend before About QA');
fs.mkdirSync(out, { recursive: true });
const report = { commit: process.env.QA_HEAD_SHA || process.env.GITHUB_SHA || null, fixtureOnly: true, productionAccess: false, cases: [], checks: [], requests: [], fontFixtures: [], legacyTickerFixtures: [], denied: [], writes: [], errors: [], consoleErrors: [], failedRequests: [], responseErrors: [], result: 'FAIL' };
const app = express();
app.use('/api', (_req, res) => res.status(405).json({ error: 'No backend is running in this fixture' }));
app.use(express.static(dist, { extensions: ['html'], redirect: false }));
app.use((req, res) => /\.[a-z0-9]+$/i.test(req.path) ? res.status(404).end() : res.sendFile(path.join(dist, 'index.html')));
const check = name => { report.checks.push(name); console.log('PASS', name); };
const token = 'header.eyJzdWIiOiJxYS1hYm91dCIsInNpZCI6InFhLWFib3V0In0.signature';

async function main() {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
    async function context(width, signedIn = false, reducedMotion = 'reduce') {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion, serviceWorkers: 'block' });
      await ctx.addInitScript(([signed, fixtureToken]) => {
        localStorage.setItem('exchange_lang', 'ru');
        if (signed) localStorage.setItem('exchange_token', fixtureToken);
        else localStorage.removeItem('exchange_token');
      }, [signedIn, token]);
      await ctx.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method();
        if (!['GET', 'HEAD'].includes(method)) {
          report.writes.push({ path: url.pathname, method });
          return route.abort('blockedbyclient');
        }
        // Existing global optional fonts are fixture CSS, never fetched remotely.
        if (url.hostname === 'fonts.googleapis.com') {
          report.fontFixtures.push(url.pathname);
          return route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline QA: use the page font fallback */' });
        }
        if (url.pathname.startsWith('/api/') || ['api.voltextech.net', 'market.voltextech.net'].includes(url.hostname)) {
          const pagePath = new URL(request.frame().url()).pathname;
          report.requests.push({ path: url.pathname, method, pagePath });
          if (/\/me$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'qa-about', email: 'about@example.invalid', displayName: 'Тестовый пользователь', isAdmin: false, avatarUrl: null }) });
          // Existing legal documents keep the old shared Nav ticker. Only their
          // known read is a fixture; About must never mount that subscriber.
          if (/^\/legal\/(terms|privacy|risk|support)$/.test(pagePath) && url.pathname === '/api/v1/market/display/spot-snapshot') {
            report.legacyTickerFixtures.push({ path: url.pathname, pagePath });
            const unavailable = { available: false, value: null, source: 'offline-qa', fetchedAt: 0, stale: true };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tickers: unavailable, overview: unavailable, sentiment: unavailable }) });
          }
          report.denied.push({ kind: 'unexpected-api', path: url.pathname, method });
          return route.abort('blockedbyclient');
        }
        if (url.origin === origin) return route.continue();
        report.denied.push({ kind: 'external-http', host: url.hostname, path: url.pathname, method });
        return route.abort('blockedbyclient');
      });
      await ctx.routeWebSocket('**/*', socket => { report.denied.push({ kind: 'websocket', url: socket.url() }); socket.close(); });
      const page = await ctx.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }); });
      page.on('response', response => { if (response.status() >= 400) report.responseErrors.push({ url: response.url(), status: response.status() }); });
      return { ctx, page };
    }
    async function open(page) {
      await page.goto(origin + '/legal/about', { waitUntil: 'networkidle' });
      await page.locator('main.about-main h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
    }
    async function revealAllImages(page) {
      const images = page.locator('main.about-main img');
      for (let i = 0; i < await images.count(); i++) if (await images.nth(i).isVisible()) await images.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('main.about-main img')].filter(image => image.getBoundingClientRect().width > 0).every(image => image.complete));
      const broken = await images.evaluateAll(nodes => nodes.filter(image => image.getBoundingClientRect().width > 0 && (!image.naturalWidth || !image.naturalHeight)).map(image => image.currentSrc));
      assert.deepEqual(broken, [], 'all actual image files decode');
    }
    async function measure(page) {
      return page.evaluate(() => {
        const main = document.querySelector('main.about-main');
        const columns = selector => getComputedStyle(document.querySelector(selector)).gridTemplateColumns.split(/\s+/).length;
        const paragraphs = [...main.querySelectorAll('p')].filter(node => !node.closest('.about-eyebrow, .about-caption') && !/eyebrow|caption/.test(node.className));
        const clipping = [...main.querySelectorAll('h1,h2,h3,p,a,button')].filter(node => {
          if (node.closest('[aria-hidden="true"]')) return false;
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return rect.width && rect.height && style.visibility !== 'hidden' && (node.scrollWidth > node.clientWidth + 2 || (['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 2));
        }).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent.slice(0, 70), width: node.clientWidth, scrollWidth: node.scrollWidth }));
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          overflowingElements: [...document.querySelectorAll('body *')].filter(node => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(node).position !== 'absolute';
          }).slice(0, 20).map(node => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })),
          h1: main.querySelectorAll('h1').length,
          h1Size: parseFloat(getComputedStyle(main.querySelector('h1')).fontSize), directions: columns('.about-markets-grid'), cards: columns('.about-approach-grid'),
          bodySizes: paragraphs.map(node => parseFloat(getComputedStyle(node).fontSize)), clipping,
          headerCount: document.querySelectorAll('header').length, footerCount: document.querySelectorAll('footer').length,
          photos: [...main.querySelectorAll('img')].map(image => ({ src: image.currentSrc, alt: image.alt, width: image.naturalWidth, height: image.naturalHeight })),
          heroDescriptionMargins: ['marginTop', 'marginBottom'].map(property => parseFloat(getComputedStyle(main.querySelector('.about-hero-description'))[property])),
          background: getComputedStyle(document.querySelector('.about-page')).backgroundColor,
        };
      });
    }
    for (const width of [1920, 1440, 1366, 768, 430, 390, 360, 320]) {
      const { ctx, page } = await context(width);
      try {
        await open(page);
        await revealAllImages(page);
        const measurements = await measure(page);
        report.cases.push({ width, signedIn: false, ...measurements });
        assert.equal(measurements.overflow, false, `horizontal overflow at ${width}`);
        assert.equal(measurements.h1, 1);
        assert.equal(measurements.headerCount, 1);
        assert.equal(measurements.footerCount, 1);
        assert.deepEqual(measurements.clipping, [], `text clipping at ${width}`);
        assert.ok(measurements.bodySizes.every(size => size >= 16), `body below 16px at ${width}: ${measurements.bodySizes}`);
        assert.ok(measurements.heroDescriptionMargins.every(value => value >= 18), 'scoped reset does not override hero paragraph spacing');
        assert.equal(measurements.directions, width <= 430 ? 2 : 4);
        assert.equal(measurements.cards, width <= 430 ? 1 : width === 768 ? 2 : 3);
        if (width <= 430) assert.ok(measurements.h1Size >= (width === 320 ? 30 : 34) && measurements.h1Size <= 40, `mobile H1 ${measurements.h1Size}px at ${width}`);

        const accordion = page.locator('.about-accordion-trigger');
        assert.deepEqual(await accordion.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded'))), ['true', 'false', 'false', 'false']);
        await accordion.nth(1).focus();
        await page.keyboard.press('Enter');
        assert.equal(await accordion.nth(1).getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Space');
        assert.equal(await accordion.nth(1).getAttribute('aria-expanded'), 'false');
        const panelId = await accordion.nth(1).getAttribute('aria-controls');
        assert.equal(await page.locator(`#${panelId}`).getAttribute('aria-hidden'), 'true');
        const durations = await page.locator('.about-accordion-panel').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).transitionDuration));
        assert.ok(durations.every(value => value.split(',').every(part => parseFloat(part) <= .01)), 'reduced motion turns off accordion transitions');
        const focus = await accordion.nth(1).evaluate(node => getComputedStyle(node).outlineStyle);
        assert.notEqual(focus, 'none', 'keyboard focus remains visible');
        for (const [key, target] of [['ArrowDown', 2], ['ArrowUp', 1], ['End', 3], ['Home', 0]]) {
          await page.keyboard.press(key);
          assert.equal(await accordion.nth(target).evaluate(node => node === document.activeElement), true, `${key} moves accordion focus`);
        }
        // Restore the approved initial composition for evidence.
        if (await accordion.nth(0).getAttribute('aria-expanded') !== 'true') await accordion.nth(0).click();

        await page.locator('.about-hero a[href="#overview"]').click();
        await page.waitForFunction(() => document.activeElement?.id === 'overview');
        const overview = await page.locator('#overview').boundingBox();
        assert.ok(overview && overview.y >= -1 && overview.y < 160, `hero scroll lands at overview: ${overview?.y}`);
        await page.evaluate(() => { history.replaceState(null, '', '/legal/about'); scrollTo(0, 0); });
        for (const href of ['/legal/about', '/legal/terms', '/legal/privacy', '/legal/risk', '/academy', '/academy/faq']) assert.ok(await page.locator(`footer a[href="${href}"]`).count(), `footer ${href}`);
        assert.equal(await page.getByRole('link', { name: 'Перейти к платформе', exact: true }).getAttribute('href'), '/markets');
        assert.equal(await page.getByRole('link', { name: 'Открыть VOLTEX', exact: true }).getAttribute('href'), '/markets');
        if (width < 1440) {
          const menu = page.getByRole('button', { name: 'Меню', exact: true });
          await menu.click();
          assert.equal(await menu.getAttribute('aria-expanded'), 'true');
          const navigation = page.getByRole('navigation', { name: 'Мобильная навигация', exact: true });
          assert.ok(await navigation.locator('a[href="/futures"]').count(), 'guest menu retains Futures route');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `expanded shared menu overflow at ${width}`);
          await menu.click();
        }
        if ([1440, 390].includes(width)) {
          await page.screenshot({ path: path.join(out, `about-${width}.png`), fullPage: true });
          await page.screenshot({ path: path.join(out, `about-${width}-hero.png`) });
        }
        check(`${width}px: actual page, loaded photos, readable text, responsive grids, keyboard accordion, anchor and shared layout`);
      } catch (error) {
        await page.screenshot({ path: path.join(out, `failure-${width}.png`), fullPage: true }).catch(() => {});
        throw error;
      } finally { await ctx.close(); }
    }

    // Existing guest route guard still takes public CTA visitors to sign-in.
    {
      const { ctx, page } = await context(390);
      try {
        await open(page);
        await page.getByRole('link', { name: 'Открыть VOLTEX', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/login');
        assert.ok(new URL(page.url()).searchParams.get('next')?.startsWith('/markets'));
        check('guest platform CTA follows the existing /markets sign-in guard');
      } finally { await ctx.close(); }
    }

    // Both authenticated desktop and mobile retain the existing Nav, and legal
    // documents remain the original component after visiting About (CSS loaded).
    for (const width of [1440, 390]) {
      const { ctx, page } = await context(width, true, 'no-preference');
      try {
        await open(page);
        assert.equal(await page.locator('header.global-header').count(), 1);
        assert.ok(await page.locator('header a[href="/wallet"]').count(), 'existing account wallet destination');
        const durations = await page.locator('.about-accordion-panel').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).transitionDuration));
        assert.ok(durations.some(value => value.split(',').some(part => parseFloat(part) > .01)), 'normal motion retains accordion transitions');
        if (width === 390) {
          const menu = page.locator('header button.nav-burger');
          await menu.click();
          assert.equal(await menu.getAttribute('aria-expanded'), 'true');
          assert.ok(await page.locator('a[href="/futures"]').count());
          await menu.click();
        }
        assert.equal((await measure(page)).overflow, false);
        for (const doc of ['terms', 'privacy', 'risk', 'support']) {
          if (doc === 'terms') {
            await page.locator('footer a[href="/legal/terms"]').click();
            await page.waitForURL(url => url.pathname === '/legal/terms');
          } else await page.goto(`${origin}/legal/${doc}`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => !document.querySelector('.about-page'));
          await page.locator('main h1').waitFor();
          assert.equal(await page.locator('.about-page').count(), 0, `preserve /legal/${doc}`);
          assert.ok(await page.evaluate(() => [...document.styleSheets].filter(sheet => !sheet.href || new URL(sheet.href).origin === location.origin).some(sheet => [...sheet.cssRules].some(rule => rule.cssText.includes('.about-page')))), 'About CSS is still loaded during legal preservation checks');
          assert.equal(await page.locator('main h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 28, 'legacy legal heading styles preserved');
          assert.ok((await page.locator('main').innerText()).length > 150);
        }
        check(`${width}px: account navigation and terms/privacy/risk/support preserved`);
      } finally { await ctx.close(); }
    }
    assert.deepEqual(report.writes, [], 'no financial or other writes attempted');
    assert.ok(report.requests.filter(request => request.pagePath === '/legal/about').every(request => /\/me$/.test(request.path)), 'About has only the existing account profile read, never market or financial reads');
    assert.deepEqual(report.denied, [], 'no unexpected API or external destinations');
    assert.deepEqual(report.errors, [], 'no page exceptions');
    assert.deepEqual(report.consoleErrors, [], 'no console errors');
    assert.deepEqual(report.failedRequests, [], 'no failed requests');
    assert.deepEqual(report.responseErrors, [], 'no failed HTTP responses');
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().then(() => console.log('About page browser QA: PASS'), error => { console.error(error); process.exitCode = 1; });
