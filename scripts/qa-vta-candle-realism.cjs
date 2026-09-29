/**
 * VTA in the real terminal, before/after candle realism. Local only.
 *
 * Real: the Render test-market routes (testMarketsRouter) on the real clock
 * and the production frontend bundle (`npm run build --prefix frontend`).
 * Synthetic: every other /api/v1 read. External requests are blocked.
 *
 *   QA_REALISM=off node scripts/qa-vta-candle-realism.cjs   → before (the plain model)
 *   node scripts/qa-vta-candle-realism.cjs                  → after (VTA's profile)
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { VOLTORA } = require('../src/services/testMarkets/testAssetConfig');
const off = process.env.QA_REALISM === 'off';
if (off) VOLTORA.candleRealism = false; // this process only: the plain model, for the "before" picture
const { testMarketsRouter } = require('../src/api/routes/testMarkets');

const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const out = path.resolve(process.env.QA_OUTPUT || 'docs/qa/candle-realism');
fs.mkdirSync(out, { recursive: true });
const label = off ? 'before' : 'after';
const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/me': () => ({ id: 'qa-user', email: 'user@example.invalid', role: 'USER', isAdmin: false, kycStatus: 'APPROVED' }),
  '/market/display/spot-snapshot': () => ({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 },
    tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] },
    overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }],
  '/market/external/tickers': () => ({ tickers: [btc] }),
  '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }],
  '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }),
  '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }),
  '/market/snapshot': () => ({ pairs: [], fetchedAt: Date.now() }),
  '/futures/config': () => ({ symbols: [] }),
  '/market/display': () => ({ type: 'snapshot', rows: [] }),
  '/market/universe': () => ({ available: false, instruments: [] }),
};
const app = express();
app.use('/api/v1', testMarketsRouter());
app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA: read-only' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));

(async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU' });
      await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-qa-only'); localStorage.setItem('exchange_lang', 'ru'); });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/trade?pair=VTA%2FUSDT`);
      await page.locator('[data-test-market] canvas').first().waitFor({ timeout: 20000 });
      const fiveMinutes = page.getByRole('button', { name: '5m', exact: true }).first();
      if (await fiveMinutes.count()) await fiveMinutes.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(out, `terminal-${label}-${width}.png`) });
      assert.deepEqual(errors, []);
      await context.close();
      console.log('wrote', `terminal-${label}-${width}.png`);
    }
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
