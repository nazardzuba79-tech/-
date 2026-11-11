// Full built Wallet on loopback. All accounts/quotes below are explicit fixtures.
// No external network, production auth, financial POST or real balances.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express'), jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const output = path.resolve('output/trx697'); fs.mkdirSync(output, { recursive: true });
const overview = { real: { spot: [{ asset: 'TRC', available: '0', locked: '0', priceUsd: null, valueUsd: null }], futures: [{ asset: 'TRX', available: '1684', locked: '0', priceUsd: 0.32, valueUsd: 538.88 }], spotValueUsd: 0, futuresValueUsd: 538.88, totalValueUsd: 538.88 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 75000 };
async function main() {
  const app = express();
  app.use(express.static(dist, { index: false })); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`, results = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const token = jwt.sign({ sub: 'qa697-fixture', exp: Math.floor(Date.now() / 1000) + 600 }, 'LOCAL-QA-ONLY');
      await context.addInitScript(token => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); localStorage.removeItem('exchange_hide_balance'); }, token);
      const page = await context.newPage(), financialWrites = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname;
        if (p.startsWith('/api/')) {
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (!['GET', 'HEAD'].includes(request.method())) {
            if (/orders|withdraw|transfer|convert|commands|adjust/.test(p)) financialWrites.push({ method: request.method(), path: p });
            return json({ error: 'QA blocks every write' }, 403);
          }
          if (p.endsWith('/me')) return json({ id: 'qa697-fixture', email: 'qa697@example.invalid', role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: '2026-01-01T00:00:00Z' });
          if (p.endsWith('/wallet/overview')) return json(overview);
          if (p.endsWith('/wallet/performance')) return json({ periods: {}, ageDays: 0, startedOn: null });
          if (p.endsWith('/market/external/rankings')) return json({ rankings: [{ symbol: 'TRX', name: 'TRON', rank: 1, price: 0.32, changePercent24h: 0, image: '', categories: [], sparkline: [] }] });
          if (p.endsWith('/wallet/portfolio-history')) return json({ points: [] });
          if (p.endsWith('/futures/balances')) return json(overview.real.futures);
          if (p.endsWith('/balances')) return json(overview.real.spot);
          if (p.includes('/private-trading/')) return json({ error: 'Not a private demo trader' }, 403);
          if (p.endsWith('/support/conversations/mine')) return json({ conversation: null, messages: [] });
          return json({ error: 'Outside QA fixture scope' }, 404);
        }
        if (url.origin === origin) return route.continue();
        return route.abort('blockedbyclient');
      });
      await page.goto(origin + '/wallet');
      await page.getByRole('button', { name: 'Unified Trading', exact: true }).click();
      const quantity = page.locator(width < 768 ? '.wallet-ledger-mobile-quantity' : '.wallet-ledger-quantity').filter({ hasText: 'TRX' });
      await quantity.waitFor({ state: 'visible', timeout: 20000 });
      assert.match((await quantity.innerText()).replace(/[\s\u00a0\u202f]/g, ''), /1684(?:[.,]0+)?TRX/);
      assert.match(await page.locator('.wallet-ledger-cross:visible').innerText(), /Cross:/);
      await page.screenshot({ path: path.join(output, `wallet-${width}.png`), fullPage: true });
      await page.reload(); await page.getByRole('button', { name: 'Unified Trading', exact: true }).click(); await quantity.waitFor({ state: 'visible' });
      assert.match((await quantity.innerText()).replace(/[\s\u00a0\u202f]/g, ''), /1684(?:[.,]0+)?TRX/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(financialWrites, []); assert.deepEqual(errors, []);
      results.push({ width, visibleTRX: 1684, CrossLocation: 'PASS', reload: 'PASS', financialWrites: 0, pageErrors: 0, overflow: false, scope: 'LOCAL FIXTURE' });
      console.log(`PASS isolated Wallet ${width}: Cross TRX visible, reload stable, zero financial writes`);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(results, null, 2)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
