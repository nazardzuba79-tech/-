'use strict';
/**
 * Local probe, no source change: what the PRODUCTION BUNDLE on this branch does when
 * a user presses Buy / Sell on (a) TERYVANE TYVN/USDT (tradable:false, scenario-controls-v2,
 * timer running) and (b) the existing demo listing AITH/USDT (tradable:false, capped-growth v1),
 * before and after the listing instant. Records every non-GET request the page attempts.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
process.env.NODE_ENV = 'test';
const repoRequire = require('node:module').createRequire(path.join(root, 'package.json'));
repoRequire('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const express = repoRequire('express');
const jwt = repoRequire('jsonwebtoken');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { parseListingConfig, withStableProfile } = require(path.join(root, 'src/services/listings/listingConfig'));
const { publicListingAsset } = require(path.join(root, 'src/services/listings/listingPublic'));
const { AITH_PUBLICATION_PROTOCOL } = require(path.join(root, 'src/shared/aithPublication'));

const dist = process.env.QA_FRONTEND_DIST;
const out = process.env.QA_OUT || path.join(__dirname, 'probe-out');
fs.mkdirSync(out, { recursive: true });
const tyvnCfg = withStableProfile(parseListingConfig(JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/tyvn.draft.json'), 'utf8'))), null, 7);
const aithCfg = withStableProfile(parseListingConfig(JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/aith.draft.json'), 'utf8'))), null, 1);
const START = Date.parse(tyvnCfg.listingAt), HOUR = 3_600_000;
const token = jwt.sign({ sub: 'qa-user' }, 'local-probe-secret');

const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/me': () => ({ id: 'qa-user', email: 'user@example.invalid', displayName: 'qa-user', role: 'USER', isAdmin: false, kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' }),
  '/market/test-assets': () => ({ serverTime: Date.now(), assets: [] }),
  '/market/display/spot-snapshot': () => ({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 }, tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] }, overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }, { asset: 'TYVN', available: '0', locked: '0' }, { asset: 'AITH', available: '0', locked: '0' }],
  '/orders/me': () => [],
  '/market/external/tickers': () => ({ tickers: [btc] }), '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }], '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }), '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }), '/market/snapshot': () => ({ pairs: [], fetchedAt: Date.now() }),
  '/futures/config': () => ({ symbols: [] }), '/market/display': () => ({ type: 'snapshot', rows: [] }), '/market/universe': () => ({ available: false, instruments: [] }),
};
const writes = [];
const app = express();
app.use(express.json());
app.use('/api/v1', (req, _res, next) => { if (req.method !== 'GET') writes.push(`${req.method} ${req.path}`); next(); });
app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'probe: writes are not expected' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));

const results = [];
(async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { label: 'TYVN pre-listing (timer running, 1 h before 13:00 UTC)', pair: 'TYVN/USDT', serverTime: START - HOUR },
      { label: 'TYVN live (1 h after 13:00 UTC)', pair: 'TYVN/USDT', serverTime: START + HOUR },
      { label: 'AITH existing demo listing, live', pair: 'AITH/USDT', serverTime: START + HOUR },
    ]) {
      for (const width of [1440, 390]) {
        const { serverTime } = scenario;
        const lease = { protocol: AITH_PUBLICATION_PROTOCOL, generation: 1, issuedAt: serverTime, expiresAt: serverTime + 45_000 };
        const assets = [
          publicListingAsset({ id: 'tyvn-probe', version: 1, publishedAt: new Date(serverTime - 6 * 24 * HOUR).toISOString(), config: tyvnCfg, countdown: { state: 'running', updatedAt: serverTime - 6 * 24 * HOUR, updatedBy: 'probe', startedAt: serverTime - 6 * 24 * HOUR } }, serverTime),
          publicListingAsset({ id: 'aith-probe', version: 1, publishedAt: new Date(serverTime - 20 * 24 * HOUR).toISOString(), config: aithCfg, readLease: lease }, serverTime),
        ];
        const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU', serviceWorkers: 'block' });
        await context.routeWebSocket(/.*/, (ws) => ws.close());
        const attempted = [];
        await context.route('**/*', (route) => {
          const req = route.request(), u = req.url(), p = new URL(u).pathname;
          if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') attempted.push(`${req.method()} ${p}`);
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (p.endsWith('/market/listings')) return json({ serverTime, revision: '1', assets });
          const m = p.match(/\/market\/test-assets\/([A-Z]+)-USDT$/);
          if (m) return json(assets.find((a) => a.symbol === m[1]) ?? {}, assets.some((a) => a.symbol === m[1]) ? 200 : 404);
          if (p.endsWith('/candles')) return json({ candles: [] });
          if (/spot-book|orderbook/.test(p)) return json({ available: false, bids: [], asks: [] });
          if (/trades/.test(p) && !p.startsWith('/trade')) return json({ trades: [] });
          if (u.startsWith(origin) || u.startsWith('data:')) return route.continue();
          return route.abort();
        });
        await context.addInitScript(([t, time]) => {
          try { localStorage.setItem('exchange_token', t); localStorage.setItem('exchange_lang', 'ru'); } catch {}
          const base = performance.now(); Date.now = () => time + (performance.now() - base);
        }, [token, serverTime]);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.goto(`${origin}/trade?pair=${encodeURIComponent(scenario.pair)}`);
        if (width < 600) { const tab = page.locator('#mobile-trade-trade'); if (await tab.count()) await tab.click(); else await page.getByRole('tab', { name: /Торговля/ }).first().click(); }
        const form = page.locator('form.order-form-content');
        await form.waitFor({ timeout: 20000 });
        const qty = form.getByLabel('Количество').first();
        const editable = await qty.isEditable();
        const submit = form.locator('button.submit-btn');
        const submitDisabledBefore = await submit.isDisabled();
        const outcome = {};
        for (const side of ['BUY', 'SELL']) {
          if (side === 'SELL') { await form.locator('button', { hasText: /^Продать$/ }).first().click().catch(() => {}); }
          await qty.fill('10');
          const price = form.getByLabel('Цена').first();
          if (await price.isEditable().catch(() => false)) await price.fill('0.03');
          const before = attempted.length;
          await submit.click();
          await page.waitForTimeout(800);
          const text = await page.locator('body').innerText();
          outcome[side] = { requestsSent: attempted.slice(before), message: /Этот актив пока не торгуется/.test(text) ? 'Этот актив пока не торгуется' : (text.match(/не торгуется[^\n]*|недоступн[^\n]*/) || [null])[0] };
        }
        const shot = `${scenario.pair.split('/')[0].toLowerCase()}-${scenario.serverTime < START ? 'pre' : 'live'}-${width}.png`;
        await page.screenshot({ path: path.join(out, shot) });
        results.push({ scenario: scenario.label, width, formEditable: editable, submitEnabled: !submitDisabledBefore, ...outcome, writesReachedServer: writes.length, pageErrors, screenshot: shot });
        await context.close();
      }
    }
  } finally {
    await browser.close(); server.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  for (const r of results) console.log(JSON.stringify(r));
  assert.ok(results.every((r) => r.BUY.requestsSent.length === 0 && r.SELL.requestsSent.length === 0 && r.writesReachedServer === 0 && r.pageErrors.length === 0));
})().catch((e) => { console.error(e); process.exitCode = 1; });
