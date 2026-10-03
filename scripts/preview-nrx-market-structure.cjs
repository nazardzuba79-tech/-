// NRX chart preview on the production frontend: 15m / 1h / 4h, base engine
// ("before") vs post-listing wave structure ("after"), each at fixed simulated
// instants after the listing. Local only: the actual NRX edge handler and
// fixtures; every other request is blocked.
// Build first: `npm run build` and `npm --prefix frontend run build`.
//   node scripts/preview-nrx-market-structure.cjs [views=15m@12,15m@72,1h@30,1h@72,4h@72,4h@168]
const fs = require('node:fs'), path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { nrxPublicResponse } = require('../dist/services/testMarkets/nrxPublic');
const { NEURIX } = require('../dist/services/testMarkets/neurix');
const { testMarketCandles } = require('../dist/services/testMarkets/testMarketService');

const VIEWS = (process.argv[2] || '15m@12,15m@72,1h@30,1h@72,4h@72,4h@168').split(',')
  .map((view) => { const [interval, hours] = view.split('@'); return { interval, hours: Number(hours) }; });
const root = path.resolve(__dirname, '..'), out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/nrx-market-structure'));
const { marketStructure: _waves, ...BASE } = NEURIX;
const VARIANTS = { before: BASE, after: NEURIX };

const app = express(); app.use(express.static(path.join(root, 'frontend/dist'), { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'frontend/dist/index.html')));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let now = NEURIX.listingAt;
  const shots = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [variant, asset] of Object.entries(VARIANTS)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      await context.addInitScript(() => { localStorage.setItem('exchange_token', 'local-preview-only'); localStorage.setItem('exchange_lang', 'ru'); });
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.origin === origin && !p.startsWith('/api/v1/')) return route.continue();
        if (p.toUpperCase().includes('NRX')) {
          if (/\/candles(\/|$)|\/candles\//.test(p) || p.endsWith('/candles') || p.includes('spot-candles') || p.includes('external/candles')) {
            const interval = url.searchParams.get('interval') || '5m';
            return json({ source: 'simulation', pair: NEURIX.pair, interval, serverTime: now,
              candles: testMarketCandles(asset, interval, now, Number(url.searchParams.get('limit')) || 300) });
          }
          const response = nrxPublicResponse(new Request(req.url(), { method: req.method() }), () => now);
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        }
        const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
        if (p === '/api/v1/market/display/spot-snapshot') return json({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 },
          tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] },
          overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } });
        if (p === '/api/v1/me') return json({ id: 'preview', email: 'preview@example.invalid', role: 'USER', isAdmin: false, kycStatus: 'APPROVED' });
        if (p === '/api/v1/balances') return json([{ asset: 'USDT', available: '1000', locked: '0' }]);
        if (p === '/api/v1/market/external/tickers') return json({ tickers: [btc] });
        if (p === '/api/v1/market/external/symbols') return json({ symbols: ['BTC/USDT'] });
        if (p === '/api/v1/market/pairs') return json([{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }]);
        if (p === '/api/v1/market/assets/icons') return json({ icons: {} });
        if (p === '/api/v1/market/external/rankings') return json({ rankings: [] });
        if (p === '/api/v1/private-trading/access') return json({ allowed: false });
        if (p === '/api/v1/support/conversations/mine') return json({ conversation: null });
        if (p === '/api/v1/market/snapshot') return json({ pairs: [], fetchedAt: Date.now() });
        if (p === '/api/v1/futures/config') return json({ symbols: [] });
        if (p === '/api/v1/market/live') return route.fulfill({ status: 204, body: '' });
        if (p.startsWith('/api/v1/')) return json([]);
        return route.abort();
      });
      for (const { interval, hours } of VIEWS) {
        now = NEURIX.listingAt + hours * 3600e3;
        await page.goto(`${origin}/trade?pair=NRX%2FUSDT`, { waitUntil: 'domcontentloaded' });
        await page.locator('.chart-area canvas').first().waitFor({ state: 'attached', timeout: 30000 })
          .catch(async (error) => { await page.screenshot({ path: path.join(out, `failed-${variant}.png`) }); throw error; });
        await Promise.all([
          page.waitForResponse((response) => response.url().includes(`interval=${interval}`), { timeout: 15000 }).catch(() => null),
          page.locator('.chart-area').getByRole('button', { name: interval, exact: true }).click(),
        ]);
        await page.waitForTimeout(1200);
        const file = path.join(out, `${variant}-${interval}-${hours}h.png`);
        await page.locator('.chart-area').screenshot({ path: file, animations: 'disabled' });
        shots.push(path.relative(root, file));
      }
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ listingAt: new Date(NEURIX.listingAt).toISOString(), views: VIEWS, shots }, null, 2));
    console.log('NRX preview:', shots.join(', '));
  } finally { await browser?.close(); server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
