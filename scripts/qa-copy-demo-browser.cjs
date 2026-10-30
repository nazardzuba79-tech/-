const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { chromium } = require(process.env.COPY_DEMO_PLAYWRIGHT || 'playwright');
async function run({ origin, token, sourceOrder, cancelSource, drain, out }) {
  const browser = await chromium.launch({ headless: true });
  const errors = [], external = [], blockedFonts = [], unexpectedWrites = [], results = [];
  const open = async (width, lang = 'en') => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ token, lang }) => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', lang); }, { token, lang });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        // Existing site-wide remote fonts remain blocked in this offline test.
        if (['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) blockedFonts.push(url.origin);
        else external.push(url.origin);
        return route.abort();
      }
      if (url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/copy-trading/demo') && route.request().method() !== 'GET') {
        unexpectedWrites.push(url.pathname); return route.abort();
      }
      if (url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/copy-trading/demo')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await page.goto(origin + '/copy-trading/demo');
    return { page, context };
  };
  try {
    const desktop = await open(1440), page = desktop.page;
    await page.getByText('No server subscription', { exact: true }).waitFor();
    await page.getByLabel('Size ratio (0–1)', { exact: true }).fill('0.25');
    await page.getByLabel('Maximum order (USDT)', { exact: true }).fill('50');
    await page.getByLabel('Maximum total exposure (USDT)', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Subscribe / save limits', exact: true }).click();
    await page.getByText('Active demo subscription', { exact: true }).waitFor();
    const master = await sourceOrder(); await drain();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText(/BTC\/USDT · BUY · Open/).waitFor();
    await page.reload(); await page.getByText(/BTC\/USDT · BUY · Open/).waitFor();
    await page.screenshot({ path: path.join(out, 'demo-desktop.png'), fullPage: true }); results.push('1440 subscribe, actual DB-backed order, reload');
    const mobile = await open(390); await mobile.page.getByText('Active demo subscription', { exact: true }).waitFor();
    await mobile.page.getByText(/BTC\/USDT · BUY · Open/).waitFor();
    assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await mobile.page.screenshot({ path: path.join(out, 'demo-mobile.png'), fullPage: true });
    await mobile.page.getByRole('button', { name: 'Stop copying', exact: true }).click();
    await mobile.page.getByText('Stopped', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByText('Stopped', { exact: true }).waitFor();
    await cancelSource(master); results.push('390 independent device, no overflow, stop propagated to desktop');
    await mobile.context.close(); await desktop.context.close();
    for (const lang of ['ru', 'zh', 'es', 'hi', 'ja', 'ko']) {
      const { page, context } = await open(390, lang);
      await page.locator('form').waitFor(); await page.waitForFunction(() => !document.querySelector('form button').disabled);
      assert.ok((await page.locator('h1').innerText()).length > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await context.close(); results.push(`${lang} isolated mobile render`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpectedWrites, []);
    fs.writeFileSync(path.join(out, 'browser.json'), JSON.stringify({ passed: true, results, errors, external, blockedFonts: blockedFonts.length, unexpectedWrites, backend: 'real isolated PostgreSQL and copy router', production: false }, null, 2));
    console.log('PASS browser', results.length, 'cases');
  } finally { await browser.close(); }
}
module.exports = { run };
