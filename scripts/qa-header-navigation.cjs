/* Run against local Vite: node scripts/qa-header-navigation.cjs.
 * Override PLAYWRIGHT_MODULE if Playwright lives in a separate QA install.
 * All API traffic is synthetic; all non-local network traffic is blocked.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = 'http://127.0.0.1:4288';
const out = path.resolve('docs/qa/header-navigation');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mode of ['app', 'home', 'terminal']) for (const width of [1920, 1440, 1366, 390]) {
      const home = mode === 'home';
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
          url.pathname.endsWith('/me') ? { id: 'fixture-admin', isAdmin: true, email: 'fixture@example.invalid' } :
          url.pathname.endsWith('/balances') ? [{ asset: 'USDT', available: '1234.56', locked: '0' }] : []
        ) });
        return route.continue();
      });
      await context.routeWebSocket('**/*', ws => ws.close());
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'synthetic-header-fixture'); localStorage.setItem('exchange_lang', 'ru'); });
      await page.goto(`${origin}/qa/header-navigation.html${mode === 'app' ? '' : '?' + mode}`);
      await page.getByText('VOLTEX · Navigation preview').waitFor();
      const header = page.locator('header').first();
      if (width < 1440) await header.getByRole('button', { name: 'Меню', exact: true }).click();
      const nav = home ? header.locator('nav:visible') : width < 1440 ? header.locator('.nav-mobile-menu') : header.locator('.main-nav');
      const tools = nav.getByRole('link', { name: 'Инструменты', exact: true });
      const futures = nav.getByRole('link', { name: 'Фьючерсы', exact: true });
      if (width >= 1440) {
        const geometry = await header.evaluate(h => {
          const nav = h.querySelector('nav');
          const right = h.querySelector('.header-actions') || nav.nextElementSibling;
          const end = Math.max(...[...nav.children].map(n => n.getBoundingClientRect().right));
          return { end, right: right.getBoundingClientRect().left };
        });
        assert.ok(geometry.end <= geometry.right + 1, `overlap ${home ? 'home' : 'app'} ${width}: ${JSON.stringify(geometry)}`);
      }
      assert.equal(await tools.getAttribute('href'), '/tools');
      assert.equal(await futures.getAttribute('href'), '/futures');
      assert.equal(await futures.locator('xpath=ancestor::*[contains(@class,"header-disclosure") or contains(@class,"nav-item-wrap")]').count(), 0);
      const knowledge = nav.getByRole('button', { name: 'Центр знаний', exact: true });
      assert.equal(await nav.getByRole('link', { name: 'Центр знаний', exact: true }).isVisible(), true);
      await knowledge.scrollIntoViewIfNeeded();
      await knowledge.focus();
      await page.keyboard.press('Enter');
      const panel = nav.locator('.header-disclosure-panel:visible');
      assert.deepEqual(await panel.locator('a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), ['/academy/learn', '/academy/knowledge', '/academy/faq', '/academy/glossary']);
      assert.equal(await panel.getByText('Статус системы').count(), 0);
      await panel.locator('a').last().scrollIntoViewIfNeeded();
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 1001, `clipped knowledge panel ${JSON.stringify(box)}`);
      await page.screenshot({ path: path.join(out, `${mode}-${width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await knowledge.getAttribute('aria-expanded'), 'false');
      const trading = nav.getByRole('link', { name: 'Торговля', exact: true });
      if (home || width < 1440) {
        await nav.getByRole('button', { name: 'Торговля', exact: true }).focus();
        await page.keyboard.press('Enter');
      } else await trading.hover();
      const tradingPanel = nav.locator('.header-disclosure-panel:visible, .nav-dropdown:visible');
      assert.deepEqual(await tradingPanel.locator('a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), ['/trade', '/trade?market=cfd']);
      await tradingPanel.locator('a').last().click();
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/trade?market=cfd');
      assert.equal(await nav.locator('.header-disclosure-panel:visible').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow');
      if (width >= 1440) {
        const overlap = await header.evaluate(h => {
          const nav = h.querySelector('nav');
          const right = h.querySelector('.header-actions') || nav.nextElementSibling;
          return nav.getBoundingClientRect().right > right.getBoundingClientRect().left + 1;
        });
        assert.equal(overlap, false, 'navigation overlaps account controls');
      }
      assert.deepEqual(errors, []);
      results.push({ header: mode, width, passed: true });
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
