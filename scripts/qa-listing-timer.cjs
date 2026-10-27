'use strict';
/**
 * The pre-listing timer, as the exchange and the admin show it — browser QA on
 * the production bundle with every HTTP response fulfilled from fixtures.
 * Nothing is served by Render or the Worker: the pre-listing card and the
 * admin page are rendered from the exact public/admin shapes those two serve
 * (listingPublic.publicListingAsset, the admin list), and the only thing that
 * changes between captures is the fixture's server time and timer state.
 *
 * Listing instant: Monday 2026-10-26 13:00 UTC = 16:00 Moscow (one moment).
 * The ticker QTM and its name are synthetic QA fixtures, not the next asset.
 *
 *   QA_FRONTEND_DIST=<vite build dir> node scripts/qa-listing-timer.cjs
 * Output: docs/qa/listing-timer/ (PNG + report.json). No production calls, no writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || (fs.existsSync('/opt/node22/lib/node_modules/playwright') ? '/opt/node22/lib/node_modules/playwright' : 'playwright'));

const root = path.resolve(process.env.QA_FRONTEND_DIST || path.resolve(__dirname, '../frontend/dist'));
const out = path.resolve(process.env.QA_OUT || 'docs/qa/listing-timer');
const ORIGIN = 'http://127.0.0.1:4476';
const LISTING_AT = '2026-10-26T13:00:00Z';
const START = Date.parse(LISTING_AT);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const TIMER_LINE = '26.10.2026 — 13:00 UTC / 16:00 МСК';
const PAUSED_TEXT = 'Отсчёт до листинга приостановлен';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };

/* The published listing, as the admin list carries it (synthetic). */
const config = {
  schemaVersion: 1, symbol: 'QTM', name: 'QA Timer (fixture)', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'Europe/Moscow',
  ownerAllocation: '0', seedMode: 'manual', seed: 'qtm-20261026-synthetic', tradable: false, simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1',
};
/* The same listing on the public edge (listingPublic.publicListingAsset), for a timer state and a server time. */
const publicAsset = (countdown, serverTime) => {
  const armed = countdown === 'running';
  const live = armed && serverTime >= START;
  return {
    pair: 'QTM/USDT', symbol: 'QTM', name: config.name, quote: 'USDT', isTestAsset: true, isTradable: false, status: 'TEST · NOT TRADABLE',
    listingArmed: armed, listingAt: new Date(START).toISOString(), initialPrice: 2, managed: true, listingId: 'qtm-fixture', version: 1,
    logo: null, displayTimeZone: 'Europe/Moscow', countdown,
    state: { phase: live ? 'live' : 'pre-listing', lastPrice: live ? 2 : null, openPrice24h: live ? 2 : null, change24hPercent: live ? 0 : null,
      high24h: live ? 2 : null, low24h: live ? 2 : null, volume24h: live ? 0 : null, quoteVolume24h: live ? 0 : null, serverTime },
  };
};
const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/market/test-assets': (t) => ({ serverTime: t, assets: [] }),
  '/market/nrx': (t) => ({ serverTime: t, assets: [] }),
  '/market/display/spot-snapshot': (t) => ({ _display: { mode: 'snapshot', capturedAt: t, refreshMs: 60000 },
    tickers: { available: true, source: 'fixture', fetchedAt: t, stale: false, value: [btc] }, overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }],
  '/market/external/tickers': () => ({ tickers: [btc] }),
  '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }],
  '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }),
  '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }),
  '/market/snapshot': (t) => ({ pairs: [], fetchedAt: t }),
  '/futures/config': () => ({ symbols: [] }),
  '/market/display': () => ({ type: 'snapshot', rows: [] }),
  '/market/universe': () => ({ available: false, instruments: [] }),
};

const report = { scope: 'Production bundle in Chromium; every response is a fixture (no Render, no Worker, no venue). Synthetic ticker QTM; listing 2026-10-26T13:00:00Z.',
  cases: [], screenshots: [], pageErrors: [], writes: 0 };
const check = (name) => { report.cases.push(name); console.log('✓', name); };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  assert.ok(fs.existsSync(path.join(root, 'index.html')), `build the frontend first: QA_FRONTEND_DIST=${root}`);
  const browser = await chromium.launch({ headless: true });
  try {
    /**
     * One isolated browser context. `state.serverTime` is what every fixture
     * answers as the server clock; `state.browserSkewMs` is how wrong the
     * viewer's own clock is (the page must not care).
     */
    async function open(width, state, who = 'user') {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, serviceWorkers: 'block', locale: 'ru-RU' });
      await ctx.addInitScript(({ who }) => {
        // The viewer's clock: the fixture time plus a deliberate skew, advancing with the page.
        const base = performance.now();
        Date.now = () => window.__fixtureBrowserTime + (performance.now() - base);
        localStorage.setItem('exchange_lang', 'ru');
        localStorage.setItem('exchange_token', `isolated-timer-fixture-${who}`);
      }, { who });
      await ctx.routeWebSocket('**/*', (socket) => socket.close());
      await ctx.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const t = state.serverTime;
        if (url.origin === ORIGIN && !p.startsWith('/api/')) {
          const file = path.resolve(root, path.extname(p) ? '.' + p : 'index.html');
          if (file.startsWith(root + path.sep) && fs.existsSync(file)) return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
          return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'index.html')) });
        }
        if (p.endsWith('/market/listings')) return json({ serverTime: t, revision: '7', assets: state.countdown === 'staged' ? [] : [publicAsset(state.countdown, t)] });
        if (/\/market\/test-assets\/QTM-USDT$/.test(p)) return state.countdown === 'staged' ? json({ error: 'not_found' }, 404) : json(publicAsset(state.countdown, t));
        if (p.endsWith('/candles')) return json({ source: 'simulation', pair: 'QTM/USDT', interval: '5m', serverTime: t, candles: [] });
        if (/spot-book|orderbook/.test(p)) return json({ available: false, bids: [], asks: [] });
        if (/spot-trades|\/trades\//.test(p)) return json({ source: 'simulation', pair: 'QTM/USDT', trades: [], serverTime: t });
        if (p === '/api/v1/me') return json({ id: `fixture-${who}`, email: `${who}@example.invalid`, displayName: who, role: who === 'admin' ? 'ADMIN' : 'USER', isAdmin: who === 'admin', kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' });
        if (p === '/api/v1/admin/listings' && request.method() === 'GET') {
          return json({ revision: '7', serverTime: t, listings: [{ id: 'qtm-fixture', symbol: 'QTM', draft: config, draftRevision: 3, draftUpdatedAt: '2026-10-20T10:00:00.000Z', draftUpdatedBy: 'fixture-admin',
            activeVersion: 1, active: config, versions: [{ version: 1, publishedAt: '2026-10-20T10:00:00.000Z', publishedBy: 'fixture-admin' }],
            countdown: state.countdown === 'legacy' ? null : { state: state.countdown, updatedAt: t - HOUR, updatedBy: 'fixture-admin', ...(state.startedAt ? { startedAt: state.startedAt } : {}) } }] });
        }
        if (p === '/api/v1/admin/listings/qtm-fixture/countdown' && request.method() === 'POST') {
          // The admin's start / pause / stop: the fixture store answers like the Durable Object does.
          const { action } = JSON.parse(request.postData() || '{}');
          if (action === 'start' && t >= START) return json({ error: 'LISTING_TIME_PAST', message: 'The listing time has passed' }, 422);
          state.countdown = action === 'start' ? 'running' : action === 'pause' ? 'paused' : 'staged';
          if (action === 'start') state.startedAt = t;
          state.timerCalls.push(action);
          return json({ id: 'qtm-fixture', countdown: { state: state.countdown, updatedAt: t, updatedBy: 'fixture-admin', ...(state.startedAt ? { startedAt: state.startedAt } : {}) }, changed: true });
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes++; return json({ error: 'QA disallows writes' }, 405); }
        if (p === '/api/v1/market/live') return route.fulfill({ status: 204, body: '' });
        if (p.startsWith('/api/v1/')) { const fixture = fixtures[p.slice('/api/v1'.length)]; return json(fixture ? fixture(t) : []); }
        return json({ error: 'Unavailable' }, 503);
      });
      const page = await ctx.newPage();
      page.on('pageerror', (error) => report.pageErrors.push(`${who}@${width}: ${error.message}`));
      await page.addInitScript(({ time }) => { window.__fixtureBrowserTime = time; }, { time: state.serverTime + state.browserSkewMs });
      return { ctx, page };
    }
    const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name), animations: 'disabled' }); report.screenshots.push(name); };
    const cells = async (page) => page.locator('.vta-countdown-cell strong').allInnerTexts();

    for (const width of [1440, 390]) {
      /* ---- The exchange: the timer runs, by the server clock, survives a reload, pauses, and the market opens at 13:00 UTC. ---- */
      // 5 d 03 h 30 min before the instant (a margin off the hour boundary, which the first tick would cross).
      const state = { serverTime: START - 5 * DAY - 3 * HOUR - 30 * 60_000, browserSkewMs: 6 * HOUR, countdown: 'running', timerCalls: [] };
      let { ctx, page } = await open(width, state);
      await page.goto(`${ORIGIN}/trade?pair=QTM%2FUSDT`);
      if (width < 600) await page.locator('#mobile-trade-chart').click();
      const card = page.locator('.vta-prelisting[data-countdown="running"]');
      await card.waitFor({ timeout: 15000 });
      await page.locator('.vta-countdown').waitFor();
      // 5 d 03 h on the server; the viewer's clock is 6 h ahead and must not matter.
      assert.deepEqual((await cells(page)).slice(0, 2), ['05', '03'], 'countdown follows the server clock, not the viewer\'s');
      const facts = await page.locator('.vta-prelisting-facts').innerText();
      assert.ok(facts.includes(TIMER_LINE), facts);
      // Owner, 2026-10-22: no market notice («Учебный рынок · Торговля пока недоступна») anywhere on the page.
      for (const text of ['Учебный рынок', 'Торговля пока недоступна']) assert.ok(!(await page.locator('body').innerText()).includes(text), `notice «${text}» on the page`);
      await shot(page, `trade-running-${width}.png`);
      // Reload: the same server clock, the same remaining time — nothing resets.
      await page.reload();
      if (width < 600) await page.locator('#mobile-trade-chart').click();
      await page.locator('.vta-countdown').waitFor();
      assert.deepEqual((await cells(page)).slice(0, 2), ['05', '03'], 'a reload keeps the countdown');
      check(`trade ${width}: running countdown 5 d 03 h to ${TIMER_LINE} with the viewer's clock 6 h wrong; identical after a reload`);

      // Paused by the admin: the date stays, the counter goes, the market stays frozen.
      state.countdown = 'paused';
      await page.evaluate(() => window.dispatchEvent(new Event('voltex:browser-activity')));
      const paused = page.locator('.vta-prelisting[data-countdown="paused"]');
      await paused.waitFor({ timeout: 15000 });
      assert.equal(await page.locator('.vta-countdown').count(), 0);
      const pausedText = await paused.innerText();
      assert.ok(pausedText.includes(PAUSED_TEXT) && pausedText.includes(TIMER_LINE), pausedText);
      assert.ok(!pausedText.includes('Ожидаем подтверждения'));
      await shot(page, `trade-paused-${width}.png`);
      check(`trade ${width}: paused — «${PAUSED_TEXT}», the date ${TIMER_LINE} stays, no counter`);
      await ctx.close();

      // The last seconds before 13:00 UTC: 00 00 00 02 → 01; at 13:00:00 the server says live and the chart replaces the card.
      const edge = { serverTime: START - 2_500, browserSkewMs: -2 * HOUR, countdown: 'running', timerCalls: [] };
      ({ ctx, page } = await open(width, edge));
      await page.goto(`${ORIGIN}/trade?pair=QTM%2FUSDT`);
      if (width < 600) await page.locator('#mobile-trade-chart').click();
      await page.locator('.vta-countdown').waitFor({ timeout: 15000 });
      const last = await cells(page);
      assert.deepEqual(last.slice(0, 3), ['00', '00', '00']);
      assert.ok(['02', '01'].includes(last[3]), last.join(':'));
      await shot(page, `trade-last-second-${width}.png`);
      edge.serverTime = START;
      await page.evaluate(() => window.dispatchEvent(new Event('voltex:browser-activity')));
      await page.locator('.managed-demo-chart').waitFor({ timeout: 15000 });
      assert.equal(await page.locator('.vta-countdown').count(), 0);
      await shot(page, `trade-live-1300utc-${width}.png`);
      check(`trade ${width}: the last seconds show 00:00:00:0${last[3].slice(1)}; at 13:00:00 UTC the server's phase is live and the chart appears`);
      await ctx.close();

      /* ---- The admin: before the start the market is hidden and the button waits; start → running; pause; a passed date is an alert. ---- */
      const adminState = { serverTime: START - 5 * DAY - 3 * HOUR - 30 * 60_000, browserSkewMs: 6 * HOUR, countdown: 'staged', timerCalls: [] };
      ({ ctx, page } = await open(width, adminState, 'admin'));
      await page.goto(`${ORIGIN}/admin/listings`);
      const timer = page.locator('[data-listing-timer]');
      await timer.waitFor({ timeout: 20000 });
      assert.equal(await timer.getAttribute('data-listing-timer'), 'staged');
      assert.ok((await timer.innerText()).includes(TIMER_LINE));
      assert.ok((await page.locator('.listing-when').innerText()).includes('Москва (UTC+3)'));
      await page.locator('[data-timer-action="start"]').waitFor();
      await shot(page, `admin-before-start-${width}.png`);
      // The exchange shows nothing for a staged listing.
      const hidden = await open(width, adminState);
      await hidden.page.goto(`${ORIGIN}/markets`);
      await hidden.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      assert.ok(!(await hidden.page.locator('body').innerText()).includes('QTM'), 'a staged listing is not on the exchange');
      await shot(hidden.page, `markets-before-start-${width}.png`);
      await hidden.ctx.close();
      check(`admin ${width}: before the start — «Таймер не запущен», «Запустить таймер», the market absent from the exchange`);

      await page.locator('[data-timer-action="start"]').click();
      await page.locator('[data-listing-timer="running"]').waitFor({ timeout: 15000 });
      assert.deepEqual(adminState.timerCalls, ['start']);
      assert.ok((await page.locator('[data-listing-notice]').innerText()).includes(TIMER_LINE));
      await shot(page, `admin-after-start-${width}.png`);
      const shown = await open(width, adminState);
      await shown.page.goto(`${ORIGIN}/markets`);
      await shown.page.locator('.test-market-row[data-pair="QTM/USDT"]').waitFor({ timeout: 15000 });
      assert.ok((await shown.page.locator('.test-market-row[data-pair="QTM/USDT"]').innerText()).includes(TIMER_LINE));
      await shot(shown.page, `markets-after-start-${width}.png`);
      await shown.ctx.close();
      check(`admin ${width}: «Запустить таймер» → «Таймер запущен», the exchange lists QTM/USDT with ${TIMER_LINE}`);

      await page.locator('[data-timer-action="pause"]').click();
      await page.locator('[data-listing-timer="paused"]').waitFor({ timeout: 15000 });
      await shot(page, `admin-paused-${width}.png`);
      await page.locator('[data-timer-action="stop"]').click();
      await page.locator('[data-listing-timer="staged"]').waitFor({ timeout: 15000 });
      assert.deepEqual(adminState.timerCalls, ['start', 'pause', 'stop']);
      check(`admin ${width}: pause and stop, no draft or publish request (writes to anything else: ${report.writes})`);
      await ctx.close();

      // The date passed while the timer never ran: an alert, no start button, nothing opened.
      const overdue = { serverTime: START + DAY, browserSkewMs: 0, countdown: 'staged', timerCalls: [] };
      ({ ctx, page } = await open(width, overdue, 'admin'));
      await page.goto(`${ORIGIN}/admin/listings`);
      await page.locator('[data-listing-timer="overdue"]').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-timer-action]').count(), 0);
      assert.ok((await page.locator('[data-listing-timer="overdue"]').innerText()).includes('назначьте новую дату'));
      await shot(page, `admin-overdue-${width}.png`);
      check(`admin ${width}: a passed date with a timer that never ran — alert «назначьте новую дату», no start button`);
      await ctx.close();
    }
    assert.equal(report.writes, 0);
    assert.deepEqual(report.pageErrors, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ cases: report.cases.length, screenshots: report.screenshots.length, pageErrors: report.pageErrors, writes: report.writes }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
