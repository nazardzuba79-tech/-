'use strict';
/** Futures header — 24h turnover and open interest in the production state.
 *
 * On production the server's cross-venue turnover never arrives: Binance is
 * the only venue that publishes it, and Binance Futures refuses the
 * backend's US region, so the section answers with open interest only
 * (OKX), flagged stale. The owner saw «Оборот за 24ч» as «—» and the open
 * interest drawn dimmer than its neighbours.
 *
 * This harness serves the production bundle with exactly that section, and
 * the header's own Bybit linear ticker (the row its 24h high and low come
 * from) from a local fixture, then reads the two cells off the page:
 *   1  the turnover is the Bybit perpetual's own 24h turnover, not «—»;
 *   2  the open interest is drawn at the same opacity and colour as the
 *      mark price beside it;
 *   3  nothing outside this harness is contacted.
 * And the profile menu: «Профиль», «Админка», «Выйти», with no admin chip
 * in the header row.
 *
 * Usage: node scripts/qa-futures-header-turnover.cjs [frontend-dist-dir]
 * Evidence: docs/qa/futures-header-turnover/.
 */
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const DIST = path.resolve(process.argv[2] || path.join(__dirname, '..', 'frontend', 'dist'));
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '..', 'docs', 'qa', 'futures-header-turnover'));
const LABEL = process.env.QA_LABEL || 'after';
fs.mkdirSync(OUT, { recursive: true });

const BYBIT_TICKERS = {
  retCode: 0, retMsg: 'OK', time: Date.now(),
  result: { category: 'linear', list: [{
    symbol: 'BTCUSDT', lastPrice: '83514.90', highPrice24h: '85937.40', lowPrice24h: '82800.00', price24hPcnt: '-0.0281',
    turnover24h: '8234567890.1234', volume24h: '98765.432', bid1Price: '83514.80', ask1Price: '83515.00',
    markPrice: '83529.85', indexPrice: '83520.00', fundingRate: '0.0001', openInterest: '55123.4', openInterestValue: '4603650000',
  }] },
};

function start() {
  const app = express();
  app.use((_q, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-admin', email: 'qa@example.invalid', role: 'ADMIN', isAdmin: true, avatarUrl: null }));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: ['BTC/USDT'], minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8,
    highLeverageWarningThreshold: 50, leverageTiers: [{ notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 0 }] }));
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: [
    { symbol: 'BTC/USDT', marketType: 'linear_perpetual', quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading' }] } }));
  app.get('/api/v1/futures/mark-price/:symbol', (_q, r) => r.json({ markPrice: '83529.85', indexPrice: '83520.00' }));
  app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json({ history: [{ rate: '0.0001', timestamp: new Date().toISOString() }] }));
  // THE PRODUCTION STATE: open interest from OKX alone, stale; no turnover.
  app.get('/api/v1/market/derivatives/:base', (req, r) => r.json({ available: true, source: 'okx', fetchedAt: Date.now() - 60_000, stale: true,
    value: { baseAsset: req.params.base, turnover24hUsd: null, turnoverVenues: [], openInterestBase: 126305.2302, openInterestUsd: null,
      openInterestBaseVenues: ['okx'], openInterestUsdVenues: [] } }));
  // Off the production host the header's reference row comes from the app's
  // own display snapshot; on voltextech.net it is Bybit's linear ticker
  // (REST + socket), parsed into this same shape (parseDirectFuturesTickers).
  app.get('/api/v1/market/display', (_q, r) => {
    const t = BYBIT_TICKERS.result.list[0];
    const now = Date.now();
    r.json({ type: 'snapshot', rows: [{ id: 'linear_perpetual:BTCUSDT', pair: 'BTC/USDT', symbol: 'BTC/USDT', providerSymbol: 'BTCUSDT',
      provider: 'bybit', marketType: 'linear_perpetual', volumeAsset: 'BTC', turnoverAsset: 'USDT', baseAsset: 'BTC', quoteAsset: 'USDT',
      settleAsset: 'USDT', lastPrice: Number(t.lastPrice), bidPrice: Number(t.bid1Price), askPrice: Number(t.ask1Price),
      high24h: Number(t.highPrice24h), low24h: Number(t.lowPrice24h), volume24h: Number(t.volume24h), quoteVolume24h: Number(t.turnover24h),
      changePercent24h: Number(t.price24hPcnt) * 100, indexPrice: Number(t.indexPrice), markPrice: Number(t.markPrice),
      fundingRate: Number(t.fundingRate), fundingIntervalMinutes: 480, openInterest: Number(t.openInterest),
      openInterestValue: Number(t.openInterestValue), providerEventAt: now, sequence: null, receivedAt: now, fetchedAt: now, stale: false }] });
  });
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history', '/api/v1/futures/orders/me', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_q, r) => r.json([{ asset: 'USDT', available: '10000.00', balance: '10000.00' }]));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s === 'BTC' ? 'Bitcoin' : s, logoUrl: null }])) });
  });
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(0, '127.0.0.1');
}

(async () => {
  const server = start();
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  const report = { label: LABEL, dist: DIST, views: {} };
  try {
    for (const width of [1920, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(() => { try { localStorage.setItem('exchange_token', 'x.eyJzdWIiOiJxYSIsInNpZCI6InFhIn0.x'); localStorage.setItem('exchange_lang', 'ru'); } catch {} });
      const outside = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/tickers') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...BYBIT_TICKERS, time: Date.now() }) });
        }
        outside.push(url.origin);
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(`${origin}/futures?pair=BTC/USDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => [...document.querySelectorAll('.ticker-item .label')].some(el => /Открытый интерес/.test(el.textContent)), null, { timeout: 25_000 });
      await page.waitForTimeout(3500);
      const cells = await page.evaluate(() => {
        const read = (pattern) => {
          const item = [...document.querySelectorAll('.ticker-item')].find(el => pattern.test(el.querySelector('.label')?.textContent || ''));
          const value = item?.querySelector('.value');
          if (!value) return null;
          const style = getComputedStyle(value);
          return { label: item.querySelector('.label').textContent.trim(), text: value.textContent.trim(), className: value.className,
            opacity: style.opacity, color: style.color };
        };
        return { turnover: read(/Оборот/), openInterest: read(/Открытый интерес/), mark: read(/Маркировочная/) };
      });
      const header = await page.locator('.ticker-bar, .futures-ticker-bar, .archive-ticker').first();
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-header.png`), clip: { x: 0, y: 0, width, height: 150 } });
      // The profile menu, opened.
      await page.click('.top-nav-profile-btn');
      await page.waitForSelector('.top-nav-profile-menu', { timeout: 3000 });
      await page.waitForTimeout(500); // past the menu's 160ms entry animation
      const menu = await page.$$eval('.top-nav-profile-menu > *', els => els.map(el => el.textContent.trim()));
      const chip = await page.locator('.nav-admin-chip').count();
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${width}-profile-menu.png`), clip: { x: Math.max(0, width - 700), y: 0, width: 700, height: 240 } });
      report.views[width] = { cells, menu, adminChipInRow: chip, outside: [...new Set(outside)] };
      void header;
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.views, null, 2));
  if (LABEL === 'after') {
    for (const [width, view] of Object.entries(report.views)) {
      assert.equal(view.cells.turnover.text, '8,234,567,890.12', `${width}: turnover ${view.cells.turnover.text}`);
      assert.equal(view.cells.openInterest.opacity, view.cells.mark.opacity, `${width}: open interest opacity ${view.cells.openInterest.opacity}`);
      assert.equal(view.cells.openInterest.color, view.cells.mark.color, `${width}: open interest colour ${view.cells.openInterest.color}`);
      assert.deepEqual(view.menu, ['Профиль', 'Админка', 'Выйти'], `${width}: menu ${view.menu}`);
      assert.equal(view.adminChipInRow, 0, `${width}: admin chip still in the header row`);
      // Fonts and the chart library's CDN are aborted here like every other outside request.
      assert.deepEqual(view.outside.filter(o => !/fonts\.googleapis\.com|cdn\.jsdelivr\.net/.test(o)), [], `${width}: contacted ${view.outside}`);
    }
    console.log('PASS');
  }
})().catch(error => { console.error(error); process.exit(1); });
