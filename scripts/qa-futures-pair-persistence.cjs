#!/usr/bin/env node
/**
 * The three owner complaints, driven in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture market data, reads only, every write
 * 404s. No production account, no database, no external call.
 *
 *   1. REFRESH KEEPS THE CONTRACT. Open AKE/USDT, press F5, and the
 *      terminal must still be on AKE/USDT — chart, book and ticket with
 *      it. Same for ETH/USDT, same for a direct link, and BTC/USDT only
 *      when there is genuinely nothing to restore.
 *   2. THE CONTRACT NAME IN A POSITION OPENS THAT CONTRACT. Pressing
 *      `AKEUSDT` in the positions table must move the whole terminal to
 *      AKE — and must not close, resize or otherwise touch the position.
 *   3. «АДМИНКА» SITS BESIDE «КОШЕЛЁК». In its own violet, on one header
 *      row, admin-only, and out of the way on a phone.
 *
 * This is a real reload, a real click and a real measurement: the page is
 * navigated, `page.reload()` is called, the button is pressed, and what is
 * asserted afterwards is the live DOM, the live URL and the requests the
 * page actually made.
 *
 *   node scripts/qa-futures-pair-persistence.cjs [--dist path] [--label after]
 *
 * QA_MEASURE_ONLY=1 measures and screenshots without asserting, which is
 * how the "before" half is taken against a build that predates this work.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4361'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-pair-persistence')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1440x900,390x844')).split(',')
  .map(spec => { const [w, h] = spec.split('x').map(Number); return { width: w, height: h }; });

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

/** Three listed perpetuals, so "restore" and "fall back" are different outcomes. */
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'AKE/USDT'];

/** Two open positions on two DIFFERENT contracts — the whole point of test 2. */
const POSITIONS = [
  { id: 'qa-ake', symbol: 'AKE/USDT', side: 'LONG', size: '1500000', entryPrice: '0.004',
    leverage: 3, marginType: 'CROSS', initialMargin: '2000.00', liquidationPrice: '0.00266',
    markPrice: '0.0538', unrealizedPnl: '74700.00', realizedPnl: '0', roe: '3735.00',
    openedAt: '2026-09-01T10:00:00.000Z', protection: { takeProfit: null, stopLoss: null } },
  { id: 'qa-btc', symbol: 'BTC/USDT', side: 'SHORT', size: '0.250', entryPrice: '77260.40',
    leverage: 10, marginType: 'CROSS', initialMargin: '1931.51', liquidationPrice: '84986.44',
    markPrice: '77840.10', unrealizedPnl: '-144.93', realizedPnl: '0', roe: '-7.50',
    openedAt: '2026-09-01T11:00:00.000Z', protection: { takeProfit: null, stopLoss: null } },
];

/**
 * A candle in the shape `parseFuturesCandles` actually validates: the Bybit
 * v5 kline envelope, every OHLCV field a decimal STRING, `low` at or below
 * both open and close and `high` at or above both. A loose fixture would
 * leave the chart on its own «Не удалось загрузить график» panel and the
 * screenshots would prove nothing about the chart following the contract.
 */
const candleRow = (base, i) => {
  const open = base * (1 + Math.sin(i / 7) * 0.01);
  const close = open * 1.001;
  const digits = base < 1 ? 8 : 2;
  const fixed = (value) => value.toFixed(digits);
  return [String(Date.UTC(2026, 8, 1) + i * 3_600_000), fixed(open), fixed(Math.max(open, close) * 1.004),
    fixed(Math.min(open, close) * 0.996), fixed(close), fixed(1000 + i)];
};

function start(requests) {
  const app = express();
  app.use((req, res, next) => { requests.push(req.originalUrl); res.setHeader('Cache-Control', 'no-store'); next(); });
  // ADMIN, because complaint 3 is about a control only an admin ever sees.
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-admin', email: 'qa@example.invalid', role: 'ADMIN', isAdmin: true, avatarUrl: null }));
  // An ORDINARY trading account: the public terminal, the real execution
  // path, exactly as scripts/qa-futures-bottom-panel.cjs drives it.
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/config', (_q, r) => r.json({
    symbols: SYMBOLS, minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8,
    highLeverageWarningThreshold: 50,
    leverageTiers: [{ notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 0 }],
  }));
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments:
    SYMBOLS.map(symbol => ({ symbol, marketType: 'linear_perpetual', quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading' })) } }));
  app.get('/api/v1/futures/positions', (_q, r) => r.json(POSITIONS));
  app.get(['/api/v1/futures/positions/history', '/api/v1/futures/orders/me'], (_q, r) => r.json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_q, r) =>
    r.json([{ asset: 'USDT', available: '10000.00', balance: '10000.00' }]));
  app.get(['/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/futures/candles/:pair', (req, r) => {
    const symbol = req.params.pair.replace('-', '');
    const base = symbol.startsWith('BTC') ? 77_000 : symbol.startsWith('ETH') ? 3_100 : 0.0538;
    r.json({ retCode: 0, result: { category: 'linear', symbol,
      list: Array.from({ length: 200 }, (_, i) => candleRow(base, i)) } });
  });
  app.get('/api/v1/market/futures/orderbook/:symbol', (req, r) => {
    const base = req.params.symbol.startsWith('BTC') ? 77_000 : req.params.symbol.startsWith('ETH') ? 3_100 : 0.0538;
    const level = (n, side) => ({ price: String(base * (1 + n * 0.0001 * side)), quantity: String(10 + n) });
    r.json({ symbol: req.params.symbol, bids: Array.from({ length: 12 }, (_, i) => level(i + 1, -1)),
      asks: Array.from({ length: 12 }, (_, i) => level(i + 1, 1)), timestamp: Date.now() });
  });
  app.get('/api/v1/market/tickers', (_q, r) => r.json(SYMBOLS.map(pair => ({
    pair, lastPrice: pair.startsWith('BTC') ? '77840.10' : pair.startsWith('ETH') ? '3120.55' : '0.0538',
    changePercent24h: '1.20', high24h: '0', low24h: '0', volume24h: '1000', quoteVolume24h: '1000' }))));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

/**
 * What the terminal is looking at, and what it has under it.
 *
 * Every field is read off the LIVE page, never off a stylesheet or a
 * prop — a rule that is written but overridden cannot pass this.
 */
const state = (page) => page.evaluate(() => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height),
      background: cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage,
      color: cs.color, boxShadow: cs.boxShadow, borderRadius: cs.borderRadius, display: cs.display };
  };
  const rows = [...document.querySelectorAll('.futures-positions-table tbody tr')];
  return {
    url: location.pathname + location.search,
    // The contract the instrument row names — what the trader reads.
    pair: (text('.pair-name') || '').replace(/\s*Бесср\.?\s*$/, '').trim(),
    // The chart's own label, and whether it is drawing rather than offering
    // a retry — a blank canvas would make the screenshots prove nothing.
    chartLegend: text('.terminal-chart-shell .chart-legend, .terminal-chart-shell [class*="legend"]'),
    chartFailed: !!document.querySelector('.terminal-chart-shell button')
      && /Повторить/.test(document.querySelector('.terminal-chart-shell')?.textContent || ''),
    // The book and the ticket carry the base asset of whatever they are
    // pointed at, so they answer "did the WHOLE terminal follow" rather
    // than "did the heading change".
    bookColumns: [...document.querySelectorAll('.rb-columns small')].map(n => n.textContent.replace(/[()]/g, '')),
    ticketUnits: [...document.querySelectorAll('.fo-unit')].map(n => n.textContent.trim()),
    mobileTab: document.querySelector('.terminal')?.getAttribute('data-mobile-tab') ?? null,
    // The positions themselves, so "unchanged" is a comparison, not a claim.
    positions: rows.map(row => ({
      symbol: row.querySelector('[data-position-symbol]')?.getAttribute('data-position-symbol')
        ?? row.querySelector('.futures-position-ticker b')?.textContent?.trim() ?? null,
      cells: [...row.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()),
    })),
    tickerButtons: [...document.querySelectorAll('[data-position-symbol]')].map(b => ({
      symbol: b.getAttribute('data-position-symbol'), tag: b.tagName,
      label: b.getAttribute('aria-label'), text: b.textContent.trim(),
      cursor: getComputedStyle(b).cursor,
    })),
    header: {
      admin: box('.nav-admin-chip'),
      wallet: box('.nav-wallet-link'),
      deposit: box('.deposit-button'),
      bar: box('.global-header'),
      // DOM order, which is what a screen reader follows.
      clusterOrder: [...document.querySelectorAll('.header-actions > *')]
        .map(el => el.className.split(' ').find(c => /nav-admin-chip|nav-wallet-link|deposit-button|language|profile/.test(c)) || el.tagName.toLowerCase()),
      adminInDrawer: !!document.querySelector('.nav-mobile-menu a[href="/admin"]'),
      // The product sections, and whether the account cluster has squeezed
      // them past their own width. `.header-actions` never shrinks, so this
      // is where an over-wide cluster shows up: as a link cut off the end
      // rather than as a page that scrolls.
      navFit: (() => {
        const nav = document.querySelector('.main-nav');
        const actions = document.querySelector('.header-actions');
        if (!nav || !actions || getComputedStyle(nav).display === 'none') return null;
        const links = [...nav.querySelectorAll(':scope > a, :scope > .nav-item-wrap')]
          .filter(a => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0);
        const navRight = nav.getBoundingClientRect().right;
        const visible = links.filter(a => a.getBoundingClientRect().right <= navRight + 1);
        const lastRight = links.length ? Math.max(...links.map(a => a.getBoundingClientRect().right)) : 0;
        return {
          clipped: Math.max(0, nav.scrollWidth - nav.clientWidth),
          // THE REAL HEADROOM: the gap between the last product section and
          // the account cluster. `scrollWidth - clientWidth` is useless for
          // this — it reads 0 whenever the row fits at all, however barely.
          //
          // Recorded because "it fits" is not the same claim as "it fits
          // with room to spare". The first cut of this tier left 10px here
          // and came out 3px SHORT on the GitHub runner, whose font stack
          // measures the same text slightly wider, and OTC fell off the end.
          slack: Math.round(actions.getBoundingClientRect().left - lastRight),
          visible: visible.map(a => a.textContent.trim()),
        };
      })(),
      // Anything in the header whose text no longer fits its box, and any
      // control that has dropped onto a second row.
      clipped: [...document.querySelectorAll('.global-header *')]
        .filter(el => !el.children.length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 24) })),
    },
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
});

/** Open the positions tab, on whichever layout this width is. */
async function showPositions(page, width) {
  if (width <= 900) {
    const tab = page.locator('#mobile-futures-positions');
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(400); }
  }
  const reveal = page.locator('.terminal-account-toggle, [aria-controls="futures-bottom-content"]');
  if (await reveal.count() && await reveal.first().isVisible()) {
    const hidden = await page.locator('#futures-bottom-content').evaluate(el => el.hasAttribute('hidden')).catch(() => false);
    if (hidden) { await reveal.first().click(); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(600);
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${LABEL}-${name}.png`), fullPage: false });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  const requests = [];
  const server = start(requests);
  await waitForServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    for (const { width, height } of WIDTHS) {
      const key = `${width}x${height}`;
      report[key] = {};
      // `locale` is pinned because this sandbox's own LANG is `en_US@posix`,
      // which Chromium hands to `Intl` and which `Intl` rejects — the chart's
      // axis formatter then throws `RangeError: Invalid language tag` on
      // every draw. That is the environment, not the app; pinning a real
      // BCP-47 tag is what an ordinary browser would already have.
      const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      const page = await context.newPage();
      const pageErrors = [];
      let phase = 'boot';
      page.on('pageerror', (e) => pageErrors.push(`[${phase}] ` + (e.stack || String(e)).split('\n')[0]));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });

      // ── 1. A refresh keeps the contract ────────────────────────────────
      for (const pair of ['AKE/USDT', 'ETH/USDT']) {
        const slug = pair.split('/')[0];
        phase = `open-${slug}`;
        await page.goto(`http://127.0.0.1:${PORT}/futures?pair=${encodeURIComponent(pair)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2600);
        const before = await state(page);
        await shot(page, `${key}-${slug}-open`);
        phase = `reload-${slug}`;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2600);
        const after = await state(page);
        await shot(page, `${key}-${slug}-after-refresh`);
        report[key][`refresh-${slug}`] = { before: before.pair, after: after.pair, url: after.url,
          bookColumns: after.bookColumns, ticketUnits: after.ticketUnits };
        if (!MEASURE_ONLY) {
          assert.equal(before.pair, pair, `${key}: opened ${before.pair}, expected ${pair}`);
          assert.equal(after.pair, pair, `${key}: after refresh the terminal shows ${after.pair}, expected ${pair}`);
          assert.ok(after.url.includes(`pair=${encodeURIComponent(pair)}`), `${key}: the address lost the pair (${after.url})`);
        }
      }

      // ── 1a. THE OWNER'S ACTUAL FLOW ────────────────────────────────────
      // Open the terminal, pick a contract the way a trader picks one —
      // through the market list, not by editing the address — then press
      // F5. This is the case that was broken: the selection never reached
      // the address, so the refresh started from nothing and landed on
      // BTC/USDT with an AKE position still open underneath.
      phase = 'pick-then-refresh';
      await page.goto(`http://127.0.0.1:${PORT}/futures?pair=BTC/USDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      await shot(page, `${key}-picked-before`);
      await page.locator('.pair-selector').first().click();
      await page.waitForTimeout(700);
      await page.locator('.pair-row[aria-label="AKE/USDT"]').first().click();
      await page.waitForTimeout(2200);
      const picked = await state(page);
      await shot(page, `${key}-picked-AKE`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      const pickedAfter = await state(page);
      await shot(page, `${key}-picked-AKE-after-refresh`);
      report[key]['pick-then-refresh'] = { picked: picked.pair, pickedUrl: picked.url,
        afterRefresh: pickedAfter.pair, afterUrl: pickedAfter.url,
        book: pickedAfter.bookColumns, ticket: pickedAfter.ticketUnits };
      if (!MEASURE_ONLY) {
        assert.equal(picked.pair, 'AKE/USDT', `${key}: picking AKE/USDT from the list selected ${picked.pair}`);
        assert.ok(picked.url.includes('pair=AKE'), `${key}: the pick never reached the address (${picked.url})`);
        assert.equal(pickedAfter.pair, 'AKE/USDT', `${key}: F5 after picking AKE/USDT landed on ${pickedAfter.pair}`);
        // The chart really drew, so the screenshot beside this is evidence
        // rather than a picture of a retry panel.
        assert.equal(pickedAfter.chartFailed, false, `${key}: the chart is offering a retry instead of drawing`);
        assert.ok(pickedAfter.bookColumns.includes('AKE'), `${key}: after F5 the book shows ${pickedAfter.bookColumns.join('/')}`);
        assert.ok(pickedAfter.ticketUnits.includes('AKE'), `${key}: after F5 the ticket shows ${pickedAfter.ticketUnits.join('/')}`);
      }

      // ── 1b. A bare /futures restores the last contract ─────────────────
      phase = 'bare';
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      const bare = await state(page);
      report[key]['bare-futures'] = { pair: bare.pair, url: bare.url };
      if (!MEASURE_ONLY) {
        assert.equal(bare.pair, 'AKE/USDT', `${key}: a bare /futures opened ${bare.pair}, expected the last contract AKE/USDT`);
        assert.ok(bare.url.includes('pair=AKE'), `${key}: a bare /futures left the address without a pair (${bare.url})`);
      }

      // ── 1c. A contract the venue no longer lists falls back ────────────
      phase = 'delisted';
      await page.goto(`http://127.0.0.1:${PORT}/futures?pair=GONE/USDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      const gone = await state(page);
      report[key]['delisted'] = { pair: gone.pair, url: gone.url };
      if (!MEASURE_ONLY) {
        assert.equal(gone.pair, 'BTC/USDT', `${key}: a delisted pair opened ${gone.pair}, expected BTC/USDT`);
      }

      // ── 1d. The same cluster on an ORDINARY page ───────────────────────
      // The Futures terminal restyles its own header, so the base chip
      // rules in index.css are only exercised away from it.
      phase = 'markets-header';
      await page.goto(`http://127.0.0.1:${PORT}/markets`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      const markets = await state(page);
      await shot(page, `${key}-markets-header`);
      report[key]['header-markets'] = markets.header;
      if (!MEASURE_ONLY && width > 900) {
        const m = markets.header;
        assert.ok(m.admin, `${key}: no admin chip on /markets`);
        assert.equal(m.clusterOrder.indexOf('nav-admin-chip') + 1, m.clusterOrder.indexOf('nav-wallet-link'),
          `${key}: /markets cluster reads ${m.clusterOrder.join(' | ')}`);
        assert.ok(m.admin.right <= m.wallet.left, `${key}: /markets admin chip is not left of the wallet`);
        assert.ok(m.wallet.right <= m.deposit.left, `${key}: /markets wallet is not left of the deposit button`);
        const tops = [m.admin.top, m.wallet.top, m.deposit.top];
        assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `${key}: /markets header wrapped (tops ${tops.join(', ')})`);
        assert.equal(m.clipped.length, 0, `${key}: /markets header text is clipped: ${JSON.stringify(m.clipped)}`);
        assert.equal(markets.overflowX, 0, `${key}: /markets scrolls sideways by ${markets.overflowX}px`);
        assert.notEqual(m.admin.background, m.deposit.background, `${key}: /markets admin chip wears the deposit's fill`);
        // THE SECTIONS STILL FIT. On main an admin header was 51px short at
        // this width and cut «Админка» in half under «Кошелёк»; nothing may
        // be clipped off the end now.
        assert.ok(m.navFit, `${key}: /markets has no product nav to measure`);
        assert.equal(m.navFit.clipped, 0, `${key}: the product sections are cut off by ${m.navFit.clipped}px (${m.navFit.visible.join(' | ')})`);
        assert.ok(m.navFit.visible.includes('OTC'), `${key}: OTC fell off the header (${m.navFit.visible.join(' | ')})`);
        // Fitting by a hair is how this broke the first time. 15px is
        // comfortably more than the ~13px the runner's font stack differs
        // by, and far less than the ~27px this tier actually leaves — so
        // it catches a real narrowing without tripping on rendering noise.
        assert.ok(m.navFit.slack >= 20,
          `${key}: the sections clear the account cluster by only ${m.navFit.slack}px — too fine to survive another font stack`);
      }

      // ── 2. The contract name in a position opens that contract ─────────
      phase = 'click-setup';
      await page.goto(`http://127.0.0.1:${PORT}/futures?pair=BTC/USDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      await showPositions(page, width);
      const onBtc = await state(page);
      await shot(page, `${key}-positions-on-BTC`);

      const clickTicker = async (symbol) => {
        await showPositions(page, width);
        const mark = requests.length;
        await page.locator(`[data-position-symbol="${symbol}"]`).click();
        await page.waitForTimeout(2200);
        const after = await state(page);
        return { after, candleCalls: requests.slice(mark).filter(u => u.includes('/market/futures/candles/')) };
      };

      // A build that predates this work has no such button. That is the
      // "before" state, so it is recorded rather than treated as a crash;
      // `--label after` runs still require the buttons to be there.
      const clickable = await page.locator('[data-position-symbol]').count();
      report[key]['ticker-buttons-present'] = clickable;
      if (!clickable && MEASURE_ONLY) {
        report[key]['ticker-click'] = { skipped: 'this build renders the contract name as plain text' };
        report[key]['header'] = onBtc.header;
        report[key].pageErrors = pageErrors;
        await context.close();
        continue;
      }

      phase = 'click-AKE';
      const toAke = await clickTicker('AKE/USDT');
      await shot(page, `${key}-clicked-AKE`);
      phase = 'click-BTC';
      const toBtc = await clickTicker('BTC/USDT');
      await shot(page, `${key}-clicked-BTC`);

      report[key]['ticker-click'] = {
        startedOn: onBtc.pair,
        buttons: onBtc.tickerButtons,
        afterAke: { pair: toAke.after.pair, url: toAke.after.url, book: toAke.after.bookColumns,
          ticket: toAke.after.ticketUnits, mobileTab: toAke.after.mobileTab, candles: toAke.candleCalls },
        afterBtc: { pair: toBtc.after.pair, url: toBtc.after.url, book: toBtc.after.bookColumns,
          ticket: toBtc.after.ticketUnits, mobileTab: toBtc.after.mobileTab, candles: toBtc.candleCalls },
        positionsBefore: onBtc.positions,
        positionsAfter: toBtc.after.positions,
      };

      if (!MEASURE_ONLY) {
        assert.equal(onBtc.pair, 'BTC/USDT', `${key}: the click test must start on BTC/USDT, got ${onBtc.pair}`);
        assert.equal(onBtc.tickerButtons.length, 2, `${key}: expected two clickable contract names, got ${onBtc.tickerButtons.length}`);
        for (const button of onBtc.tickerButtons) {
          assert.equal(button.tag, 'BUTTON', `${key}: ${button.symbol} is a ${button.tag}, not a button`);
          assert.ok(button.label && button.label.includes(button.symbol), `${key}: ${button.symbol} has no accessible name`);
          assert.equal(button.cursor, 'pointer', `${key}: ${button.symbol} does not look pressable`);
        }
        // The terminal followed, all of it.
        assert.equal(toAke.after.pair, 'AKE/USDT', `${key}: pressing AKE/USDT left the terminal on ${toAke.after.pair}`);
        assert.ok(toAke.after.url.includes('pair=AKE'), `${key}: pressing AKE/USDT did not reach the address (${toAke.after.url})`);
        assert.ok(toAke.candleCalls.some(u => u.includes('AKE-USDT')), `${key}: the chart did not reload on AKE (${toAke.candleCalls.join(', ')})`);
        assert.ok(toAke.after.bookColumns.includes('AKE'), `${key}: the book still shows ${toAke.after.bookColumns.join('/')}`);
        assert.ok(toAke.after.ticketUnits.includes('AKE'), `${key}: the order form still shows ${toAke.after.ticketUnits.join('/')}`);
        // And back again, so this is a selector and not a one-way door.
        assert.equal(toBtc.after.pair, 'BTC/USDT', `${key}: pressing BTC/USDT left the terminal on ${toBtc.after.pair}`);
        assert.ok(toBtc.candleCalls.some(u => u.includes('BTC-USDT')), `${key}: the chart did not reload on BTC`);
        // THE POSITION IS NOT TOUCHED: same rows, same figures, in order.
        assert.deepEqual(toBtc.after.positions, onBtc.positions, `${key}: the positions table changed under the click`);
        if (width <= 900) {
          assert.equal(toAke.after.mobileTab, 'chart', `${key}: on a phone the chart was not brought forward (tab ${toAke.after.mobileTab})`);
        }
      }

      // ── 3. Админка beside Кошелёк ──────────────────────────────────────
      const header = onBtc.header;
      report[key]['header'] = header;
      if (!MEASURE_ONLY) {
        assert.equal(header.clipped.length, 0, `${key}: header text is clipped: ${JSON.stringify(header.clipped)}`);
        assert.equal(onBtc.overflowX, 0, `${key}: the page scrolls sideways by ${onBtc.overflowX}px`);
        assert.ok(header.adminInDrawer, `${key}: the drawer lost its admin entry`);
        if (width > 900) {
          assert.ok(header.admin, `${key}: no admin chip in the header`);
          assert.ok(header.wallet, `${key}: no wallet link in the header`);
          // Directly before the wallet, in DOM order AND on screen.
          const order = header.clusterOrder;
          assert.equal(order.indexOf('nav-admin-chip') + 1, order.indexOf('nav-wallet-link'),
            `${key}: the cluster reads ${order.join(' | ')}`);
          assert.ok(header.admin.right <= header.wallet.left, `${key}: the admin chip is not left of the wallet`);
          assert.ok(header.wallet.right <= header.deposit.left, `${key}: the wallet is not left of the deposit button`);
          // ONE ROW: all three sit in the same band, nothing wrapped.
          const tops = [header.admin.top, header.wallet.top, header.deposit.top];
          assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `${key}: the header wrapped (tops ${tops.join(', ')})`);
          assert.ok(header.admin.height >= 28 && header.admin.height <= 40, `${key}: the chip is ${header.admin.height}px tall`);
          // Its own colour, and NOT the deposit gold.
          assert.notEqual(header.admin.background, header.deposit.background, `${key}: the admin chip wears the deposit's fill`);
          assert.notEqual(header.admin.color, header.wallet.color, `${key}: the admin chip wears the wallet's label colour`);
          const violet = /rgba?\((\d+), (\d+), (\d+)/.exec(header.admin.color);
          assert.ok(violet && Number(violet[3]) > Number(violet[1]) && Number(violet[1]) >= Number(violet[2]),
            `${key}: the admin label is ${header.admin.color}, which is not a violet`);
        } else {
          // On a phone the cluster has room for the CTA and the profile
          // control and nothing else; the drawer carries admin instead.
          assert.ok(!header.admin || header.admin.display === 'none' || header.admin.width === 0,
            `${key}: the admin chip is still in the phone header`);
        }
      }

      /**
       * ONE known page error is tolerated, by name, and it is NOT this
       * work's.
       *
       * `Error: Object is disposed` comes out of lightweight-charts when
       * the chart is torn down for a contract change and a frame that was
       * already queued reaches the removed object. It reproduces IDENTICALLY
       * on a build of main with this fixture — two errors, same stack
       * (`n.get -> ve -> Rm -> yM`) — by switching contract through the
       * market chooser, which is the path that existed before the ticker
       * became clickable. It is recorded here rather than swallowed, and
       * anything else still fails the run.
       */
      const KNOWN_CHART_TEARDOWN = /Error: Object is disposed/;
      report[key].pageErrors = pageErrors;
      report[key].knownPreexistingChartTeardown = pageErrors.filter(e => KNOWN_CHART_TEARDOWN.test(e)).length;
      if (!MEASURE_ONLY) {
        const unexpected = pageErrors.filter(e => !KNOWN_CHART_TEARDOWN.test(e));
        assert.deepEqual(unexpected, [], `${key}: the page threw: ${unexpected.join(' | ')}`);
      }
      await context.close();
    }

    fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(MEASURE_ONLY ? '\nMEASURED (no assertions)' : '\nPASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
