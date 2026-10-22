/** Production frontend bundle, loopback fixtures only. Every write and external request is refused. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const output = path.resolve('docs/qa/admin-scenario-lab');
fs.mkdirSync(output, { recursive: true });
const calls = [], writes = [], results = [], errors = [];
const app = express();
app.use('/api/v1', (req, res, next) => {
  calls.push(`${req.method} ${req.path}`);
  if (req.method !== 'GET') { writes.push(`${req.method} ${req.path}`); return res.status(405).json({ error: 'fixture_disallows_writes' }); }
  next();
});
app.get('/api/v1/me', (_req, res) => res.json({ id: 'lab-fixture-admin', role: 'ADMIN', isAdmin: true,
  email: 'fixture@example.invalid', displayName: 'Администратор', kycStatus: 'APPROVED', createdAt: '2026-01-01T00:00:00Z' }));
app.get('/api/v1/admin/listings', (_req, res) => res.json({ revision: '0', listings: [], serverTime: Date.now() }));
app.get('/api/v1/support/conversations/mine', (_req, res) => res.json({ conversation: null }));
app.get('/api/v1/*', (_req, res) => res.json([]));
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const names = ['Спокойный тренд', 'Импульсное движение', 'Тренд с откатами', 'Сжатие и пробой',
  'Боковой диапазон', 'Ложный пробой с возвратом', 'Длинные тени', 'Всплеск волатильности и затухание',
  'Снижение и восстановление', 'Стресс-сценарий'];
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, locale: 'ru-RU', serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', ws => ws.close());
      await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-fixture-not-a-real-token'); localStorage.setItem('exchange_lang', 'ru'); });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/admin/listings`);
      await page.locator('[data-open-scenario-lab]').click();
      await page.locator('[data-lab-start]').waitFor();
      await page.waitForTimeout(250);
      const before = calls.length;
      assert.equal(await page.locator('[data-lab-selection] option').count(), 11);
      const signatures = [];
      for (let i = 0; i < 11; i++) {
        await page.locator('[data-lab-start]').click();
        await page.waitForFunction(name => document.querySelector('[data-lab-scenario]')?.textContent === name, names[i % 10]);
        signatures.push(await page.locator('[data-lab-chart]').innerHTML());
      }
      assert.equal(new Set(signatures).size, 11);
      const original = await page.locator('[data-lab-chart]').innerHTML();
      const savedSeed = await page.locator('[data-lab-saved-seed]').innerText();
      for (const [value, count] of [[15, 192], [60, 48], [240, 12]]) {
        await page.locator(`[data-lab-interval="${value}"]`).click();
        assert.equal(await page.locator('[data-lab-bar]').count(), count);
        assert.match(await page.locator('[data-lab-chart]').textContent(), /СИМУЛЯЦИЯ/);
      }
      assert.equal(calls.length, before, 'local scenarios made an API request');
      await page.reload();
      await page.locator('[data-open-scenario-lab]').click();
      assert.equal(await page.locator('[data-lab-saved-seed]').innerText(), savedSeed);
      assert.equal(await page.locator('[data-lab-chart]').innerHTML(), original, 'reload repainted the saved path');
      const beforeManual = calls.length;
      await page.selectOption('[data-lab-selection]', 'stress');
      await page.locator('[data-lab-start]').click();
      await page.waitForFunction(() => document.querySelector('[data-lab-scenario]')?.textContent === 'Стресс-сценарий');
      await page.selectOption('[data-lab-selection]', 'auto');
      await page.locator('[data-lab-start]').click();
      await page.waitForFunction(() => document.querySelector('[data-lab-scenario]')?.textContent === 'Импульсное движение');
      await page.fill('[data-lab-price]', '-1');
      await page.locator('[data-lab-start]').click();
      assert.match(await page.locator('[data-scenario-lab] [role="alert"]').innerText(), /положительным/);
      assert.equal(calls.length, beforeManual, 'manual scenario or validation made an API request');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'page overflow');
      await page.locator('[data-lab-chart]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `lab-${width}.png`), fullPage: true });
      results.push({ width, autoCycle: 11, manualPreservesQueue: true, intervals: [192, 48, 12], reloadStable: true, scenarioApiCalls: 0 });
      await context.close();
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ results, writes, errors }, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify({ results, writes, errors }));
})().catch(error => { console.error(error); process.exitCode = 1; });
