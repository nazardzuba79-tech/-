#!/usr/bin/env node
/**
 * Futures trading panel and order book — the owner's visual-polish brief,
 * measured in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, an ordinary account on the real
 * execution path, and one write the fixture ACCEPTS AND RECORDS: the order
 * POST. Nothing leaves the machine.
 *
 * What is under test is the brief's own acceptance list, as numbers rather
 * than as an impression:
 *
 *   TRADING PANEL
 *     · the order-type tabs are EXACTLY what main has — no duplicated
 *       «Лимитный», nothing added, nothing renamed;
 *     · the heading carries exactly one control, the Calculator, and it
 *       still opens the calculator;
 *     · nothing in the panel is clipped and the page does not scroll
 *       sideways;
 *     · an order placed through the panel POSTs a body byte-for-byte equal
 *       to the one a build of main POSTs for the same clicks. That is what
 *       "order submission unchanged" means, so that is what is compared.
 *
 *   ORDER BOOK
 *     · price / quantity / total columns are measured for alignment;
 *     · both sides render, asks red above the mid, bids green below it;
 *     · grouping still regroups; Стакан / Сделки still switches;
 *     · a price click still fills the order form's price;
 *     · the number of API requests in an idle window is recorded, so a
 *       request storm would show up as a number, not a feeling.
 *
 *   node scripts/qa-futures-visual-polish.cjs [--dist path] [--label after]
 *
 * QA_MEASURE_ONLY=1 measures and screenshots without asserting — that is how
 * the BEFORE half is taken against a build of main.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4371'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-visual-polish')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1920x1080,1664x900,1440x900,1366x768,360x800,390x844,430x932')).split(',')
  .map(spec => { const [w, h] = spec.split('x').map(Number); return { width: w, height: h }; });
// The brief asks for screenshots at these three; the other two are measured
// for clipping and overflow only.
const SHOT_WIDTHS = new Set(['1440x900', '1664x900', '360x800', '390x844', '430x932']);
const MARKET_EDGE = 'https://market.voltextech.net';

const express = require('express');
const { chromium } = (()=>{try{return require('playwright');}catch{return require('/opt/node22/lib/node_modules/playwright');}})();

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'AKE/USDT'];
const MID = { BTCUSDT: 85833.5, ETHUSDT: 3120.55, AKEUSDT: 0.0536 };

/**
 * A book shaped like the reference's: a tight touch, sizes that vary, and
 * cumulative depth that actually grows — so the depth bars have a shape to
 * compare rather than a flat band.
 */
function book(symbol) {
  const mid = MID[symbol] ?? 100;
  const tick = mid > 1000 ? 0.1 : mid > 1 ? 0.01 : 0.0000001;
  const digits = mid > 1000 ? 1 : mid > 1 ? 2 : 7;
  const sizes = [0.007, 0.011, 0.008, 0.003, 0.003, 0.005, 0.005, 0.011, 0.012, 0.012, 0.009, 0.021,
    0.004, 0.017, 0.006, 0.031, 0.008, 0.013, 0.022, 0.005, 0.019, 0.007, 0.026, 0.010, 0.014];
  const scale = mid > 1000 ? 1 : mid > 1 ? 40 : 1_200_000;
  const level = (i, side) => ({
    price: (mid + side * (i + 1) * tick * (i < 4 ? 1 : 3)).toFixed(digits),
    quantity: String(+(sizes[i % sizes.length] * scale).toFixed(3)),
  });
  return {
    available: true, updateId: 1_000_000 + Math.floor(Date.now() / 1000),
    bids: Array.from({ length: 25 }, (_, i) => level(i, -1)),
    asks: Array.from({ length: 25 }, (_, i) => level(i, 1)),
  };
}

const candleRow = (base, i) => {
  const open = base * (1 + Math.sin(i / 7) * 0.01);
  const close = open * 1.001;
  const digits = base < 1 ? 8 : 2;
  const fixed = (value) => value.toFixed(digits);
  return [String(Date.UTC(2026, 8, 1) + i * 3_600_000), fixed(open), fixed(Math.max(open, close) * 1.004),
    fixed(Math.min(open, close) * 0.996), fixed(close), fixed(1000 + i)];
};

function start(log) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { log.requests.push(`${req.method} ${req.originalUrl}`); res.setHeader('Cache-Control', 'no-store'); next(); });
  const display=(value)=>({...value,_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:60_000}});
  const quoteRows=()=>SYMBOLS.map(pair=>{const symbol=pair.replace('/',''),price=MID[symbol];return{
    id:'linear_perpetual:'+symbol,pair,symbol:pair,provider:'bybit',providerSymbol:symbol,marketType:'linear_perpetual',
    baseAsset:pair.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',lastPrice:price,bidPrice:price-.1,askPrice:price+.1,
    high24h:price*1.05,low24h:price*.95,volume24h:100,quoteVolume24h:price*100,changePercent24h:1,indexPrice:price,markPrice:price,
    fundingRate:.0001,openInterest:100,openInterestValue:price*100,fundingIntervalMinutes:480,sequence:null,
    providerEventAt:Date.now(),fetchedAt:Date.now(),receivedAt:Date.now(),stale:false};});
  app.get('/api/v1/market/display',(_q,r)=>r.set('Cache-Control','public,max-age=60').json(display({version:1,type:'snapshot',epoch:'sampled-local',revision:1,status:'live',rows:quoteRows()})));
  app.get('/api/v1/market/display/futures-book/:symbol',(q,r)=>r.set('Cache-Control','public,max-age=60').json(display({...book(q.params.symbol),symbol:q.params.symbol,providerTime:Date.now(),fetchedAt:Date.now(),stale:false})));
  app.get('/api/v1/market/display/futures-trades/:symbol',(q,r)=>r.set('Cache-Control','public,max-age=60').json(display({symbol:q.params.symbol,trades:[{id:'sampled-tape-'+q.params.symbol,price:String(MID[q.params.symbol]),quantity:'0.01',time:Date.now(),side:'BUY'}]})));
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER', isAdmin: false, avatarUrl: null }));
  // ORDINARY account: the real execution path, the one most traders see.
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/config', (_q, r) => r.json({
    symbols: SYMBOLS, minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8,
    highLeverageWarningThreshold: 50,
    leverageTiers: [
      { notionalCap: 2_000_000, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 },
      { notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 10_000 },
    ],
  }));
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments:
    SYMBOLS.map(symbol => ({ symbol, marketType: 'linear_perpetual', quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading' })) } }));
  app.get('/api/v1/futures/mark-price/:slug', (req, r) => {
    const key = req.params.slug.replace('-', '');
    const mid = MID[key] ?? 100;
    r.json({ symbol: key, markPrice: String(mid), indexPrice: String(mid) });
  });
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history', '/api/v1/futures/orders/me', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_q, r) =>
    r.json([{ asset: 'USDT', available: '100000.00', balance: '100000.00' }]));
  // The one write, ACCEPTED AND RECORDED so the before and after payloads
  // can be compared field for field.
  app.post('/api/v1/futures/orders', (req, r) => { log.orders.push(req.body); r.status(201).json({ id: `qa-${log.orders.length}`, status: 'NEW' }); });
  app.get('/api/v1/market/futures/orderbook/:symbol', (req, r) => r.json(book(req.params.symbol.replace('-', ''))));
  app.get('/api/v1/market/futures/candles/:pair', (req, r) => {
    const symbol = req.params.pair.replace('-', '');
    r.json({ retCode: 0, result: { category: 'linear', symbol, list: Array.from({ length: 200 }, (_, i) => candleRow(MID[symbol] ?? 100, i)) } });
  });
  app.get('/api/v1/market/tickers', (_q, r) => r.json([]));
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

/** Everything the brief's acceptance list names, read off the live page. */
const measure = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
      bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const style = (el, props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p).trim()]));
  };
  const form = document.querySelector('.order-form-area');
  const bookEl = document.querySelector('.orderbook-area');
  const clippedIn = (root) => root ? [...root.querySelectorAll('*')]
    .filter(el => !el.children.length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
      && getComputedStyle(el).overflow !== 'visible' || (!el.children.length && el.clientWidth > 0
      && getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1))
    .filter(el => getComputedStyle(el).display !== 'none')
    // Screen-reader-only text (the slider's own «0%» output, the side
    // label) is 1px wide ON PURPOSE; it is not clipped copy.
    .filter(el => el.clientWidth > 2)
    .slice(0, 12)
    .map(el => ({ cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 24),
      scroll: el.scrollWidth, client: el.clientWidth })) : [];
  const heading = document.querySelector('.archive-trading-heading');
  const rows = (side) => [...document.querySelectorAll(`.rb-stack.rb-${side} .rb-row:not(.is-placeholder)`)];
  const asks = rows('asks'), bids = rows('bids');
  const firstRow = bids[0] || asks[0];
  const colX = (row) => row ? [...row.querySelectorAll(':scope > span')].map(s => {
    const r = s.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) };
  }) : [];
  const priceField = document.querySelector('.fo-priceField .fo-fieldRow, .fo-field .fo-fieldRow');
  return {
    tabs: [...document.querySelectorAll('.order-family-tabs button')].map(b => b.textContent.trim()),
    activeTab: document.querySelector('.order-family-tabs button.active')?.textContent.trim() ?? null,
    activeTabStyle: style(document.querySelector('.order-family-tabs button.active'), ['color', 'font-weight', 'border-bottom-width', 'box-shadow']),
    headingControls: heading ? [...heading.querySelectorAll('button, a, [role=button]')].map(b => ({
      label: b.getAttribute('aria-label') || b.textContent.trim(), calculator: b.hasAttribute('data-open-calculator') })) : null,
    field: priceField ? { box: box(priceField), style: style(priceField, ['background-color', 'border-top-width', 'border-top-color', 'border-radius', 'height']) } : null,
    fieldCaption: style(document.querySelector('.fo-fieldCaption'), ['font-size', 'color']),
    fieldInput: style(document.querySelector('.fo-field .fo-input'), ['font-size', 'font-weight', 'color']),
    selects: [...document.querySelectorAll('.fo-mlTrigger')].map(b => ({ box: box(b),
      style: style(b, ['background-color', 'border-top-width', 'border-radius', 'height']) })),
    slider: { track: box(document.querySelector('.percent-slider-track')),
      presets: [...document.querySelectorAll('.percent-slider-presets button, .percent-slider-presets span')].map(b => b.textContent.trim()) },
    buttons: [...document.querySelectorAll('.fo-submitPair button')].map(b => ({ text: b.textContent.trim(),
      disabled: b.disabled, box: box(b), style: style(b, ['border-radius', 'font-size', 'font-weight', 'height']) })),
    book: {
      tabs: [...document.querySelectorAll('.rb-tabs [role=tab]')].map(b => ({ text: b.textContent.trim(), selected: b.getAttribute('aria-selected') })),
      askCount: asks.length, bidCount: bids.length,
      rowHeight: firstRow ? Math.round(firstRow.getBoundingClientRect().height * 10) / 10 : null,
      rowFont: style(firstRow, ['font-family', 'font-size', 'font-variant-numeric']),
      askPriceColor: asks[0] ? getComputedStyle(asks[0].querySelector('span')).color : null,
      bidPriceColor: bids[0] ? getComputedStyle(bids[0].querySelector('span')).color : null,
      // Asks must sit above the mid and bids below it.
      order: (() => {
        const center = document.querySelector('.rb-center');
        if (!center || !asks.length || !bids.length) return null;
        const c = center.getBoundingClientRect();
        return { asksAbove: asks.every(r => r.getBoundingClientRect().bottom <= c.top + 1),
          bidsBelow: bids.every(r => r.getBoundingClientRect().top >= c.bottom - 1) };
      })(),
      // Column alignment: every row's price/qty/total span edges, which must
      // agree across rows to within a pixel.
      columns: (() => {
        const all = [...asks, ...bids].map(colX).filter(c => c.length === 3);
        if (!all.length) return null;
        const spread = (i, edge) => Math.max(...all.map(c => c[i][edge])) - Math.min(...all.map(c => c[i][edge]));
        return { priceLeftSpread: spread(0, 'left'), qtyRightSpread: spread(1, 'right'), totalRightSpread: spread(2, 'right') };
      })(),
      center: { box: box(document.querySelector('.rb-center')),
        strong: style(document.querySelector('.rb-center strong'), ['font-size', 'font-weight', 'color', 'font-family']) },
      depth: style(document.querySelector('.rb-row.ask .rb-depth'), ['background-color', 'top', 'bottom', 'height']),
      groupOptions: [...document.querySelectorAll('.rb-controls select option')].map(o => o.textContent.trim()),
    },
    formBox: box(form), bookBox: box(bookEl),
    clippedForm: clippedIn(form), clippedBook: clippedIn(bookEl),
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    formOverflowX: form ? Math.max(0, form.scrollWidth - form.clientWidth) : null,
  };
});

async function showOnMobile(page, which) {
  // Phones split the terminal into tabs; the book lives under «График»
  // behind its own Chart/Book switch, the ticket under «Торговля».
  if (which === 'trade') {
    const tab = page.locator('#mobile-futures-trade');
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(500); }
  } else {
    const tab = page.locator('#mobile-futures-chart');
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(300); }
    const bookTab = page.locator('.futures-mobile-chart-tabs button').nth(1);
    if (await bookTab.count()) { await bookTab.click(); await page.waitForTimeout(700); }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  const log = { requests: [], orders: [] };
  const server = start(log);
  await waitForServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const { width, height } of WIDTHS) {
      const key = `${width}x${height}`;
      const mobile = width <= 900;
      const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      // The page reaches only the fixture, as in qa-limit-close. On a runner
      // with internet the book otherwise subscribes to Bybit's real stream,
      // and the grouping check reads a live best ask: CI on #220 got
      // 84,325.00, already a multiple of 5, so grouping to 5 changed nothing.
      // The REST fallback reads the public market edge, so the edge's
      // display paths are answered by the fixture's own.
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        if (url.startsWith(`${MARKET_EDGE}/market/display/`)) {
          const response = await route.fetch({ url: `http://127.0.0.1:${PORT}/api/v1${url.slice(MARKET_EDGE.length)}` });
          return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
        }
        return route.abort();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push((e.stack || String(e)).split('\n')[0]));
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures?pair=BTC/USDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      // The venue socket is unreachable from here, so the book arrives on
      // the REST fallback a few seconds in. Measuring before it lands would
      // compare two empty ladders.
      if (mobile) await showOnMobile(page, 'book');
      await page.waitForSelector('.rb-stack.rb-bids .rb-row:not(.is-placeholder)', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (mobile) { const chart = page.locator('#mobile-futures-chart'); if (await chart.count()) await chart.click(); await page.waitForTimeout(300); }
      const shoot = SHOT_WIDTHS.has(key);

      if (shoot) await page.screenshot({ path: path.join(OUT, `${LABEL}-${key}-full.png`) });

      // ── The book, measured and shot on its own ─────────────────────────
      if (mobile) await showOnMobile(page, 'book');
      const bookState = await measure(page);
      if (shoot) await page.locator('.orderbook-area').screenshot({ path: path.join(OUT, `${LABEL}-${key}-orderbook.png`) });

      // Idle window: how many requests does the terminal make on its own?
      const idleStart = log.requests.length;
      await page.waitForTimeout(5000);
      const idle = log.requests.slice(idleStart);

      // Grouping still regroups.
      const select = page.locator('.rb-controls select');
      let grouping = null;
      if (await select.count()) {
        const options = await select.locator('option').allTextContents();
        const before = await page.locator('.rb-stack.rb-asks .rb-row:not(.is-placeholder) span').first().textContent().catch(() => null);
        if (options.length > 1) {
          await select.selectOption({ index: options.length - 1 });
          await page.waitForTimeout(500);
        }
        const after = await page.locator('.rb-stack.rb-asks .rb-row:not(.is-placeholder) span').first().textContent().catch(() => null);
        grouping = { options, firstAskBefore: before, firstAskAfter: after, changed: before !== after };
        if (options.length > 1) { await select.selectOption({ index: 0 }); await page.waitForTimeout(400); }
      }

      // Стакан / Сделки still switches, and back.
      const tabs = page.locator('.rb-tabs [role=tab]');
      let tabSwitch = null;
      if (await tabs.count() === 2) {
        await tabs.nth(1).click(); await page.waitForTimeout(300);
        const onTrades = await tabs.nth(1).getAttribute('aria-selected');
        const tape = await page.locator('.rb-tape').count();
        await tabs.nth(0).click(); await page.waitForTimeout(400);
        tabSwitch = { onTrades, tapeRendered: tape > 0, back: await tabs.nth(0).getAttribute('aria-selected') };
      }

      // A price click still fills the ticket's price (and, on a phone,
      // brings the ticket forward — the page's own behaviour).
      const pickRow = page.locator('.rb-stack.rb-bids .rb-row:not(.is-placeholder)').first();
      let pick = null;
      if (await pickRow.count()) {
        const label = await pickRow.getAttribute('aria-label');
        await pickRow.click(); await page.waitForTimeout(500);
        if (mobile) await showOnMobile(page, 'trade');
        const value = await page.locator('.fo-priceField input').first().inputValue().catch(() => null);
        pick = { row: label, priceField: value };
      } else if (mobile) await showOnMobile(page, 'trade');

      // ── The ticket, measured and shot ──────────────────────────────────
      const formState = await measure(page);
      if (shoot) await page.locator('.order-form-area').screenshot({ path: path.join(OUT, `${LABEL}-${key}-trading-panel.png`) });

      // The Calculator is still the heading's one control, and still opens.
      let calculator = null;
      const trigger = page.locator('[data-open-calculator="true"]');
      if (await trigger.count()) {
        await trigger.first().click(); await page.waitForTimeout(500);
        calculator = { opened: await page.locator('.futures-calculator, [role=dialog][aria-label*="алькулятор"], .fc-dialog').count() > 0 };
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      }

      // An order, through the ticket, recorded by the fixture: LIMIT, the
      // picked price, a typed quantity, Open Long. The same clicks on the
      // before and after builds must POST the same body.
      const ordersBefore = log.orders.length;
      let order = null;
      const qty = page.locator('.fo-field .fo-qtyInputRow input');
      if (await qty.count()) {
        await qty.fill('0.012');
        const long = page.locator('.fo-submitPair button').first();
        if (await long.isEnabled().catch(() => false)) {
          await long.click(); await page.waitForTimeout(1200);
          // A confirmation step, if the form shows one, is confirmed.
          const confirm = page.locator('.fo-confirm button, [data-confirm-order] button').last();
          if (await confirm.count()) { await confirm.click().catch(() => {}); await page.waitForTimeout(800); }
        }
        order = log.orders.slice(ordersBefore)[0] ?? null;
      }

      report[key] = { book: bookState.book, bookBox: bookState.bookBox, clippedBook: bookState.clippedBook,
        form: { tabs: formState.tabs, activeTab: formState.activeTab, activeTabStyle: formState.activeTabStyle,
          headingControls: formState.headingControls, field: formState.field, fieldCaption: formState.fieldCaption,
          fieldInput: formState.fieldInput, selects: formState.selects, slider: formState.slider,
          buttons: formState.buttons, formBox: formState.formBox, formOverflowX: formState.formOverflowX },
        clippedForm: formState.clippedForm, overflowX: Math.max(bookState.overflowX, formState.overflowX),
        idleRequests: idle.length, idleRequestKinds: [...new Set(idle.map(u => u.replace(/\?.*$/, '').replace(/\/[A-Z0-9-]+$/, '/:x')))],
        grouping, tabSwitch, pick, calculator, order, pageErrors };

      if (!MEASURE_ONLY) {
        const r = report[key];
        // TRADING PANEL
        assert.deepEqual(r.form.tabs, ['Лимитный', 'Рыночный', 'Стоп', 'Take Profit'], `${key}: order tabs are ${r.form.tabs.join(' | ')}`);
        assert.equal(r.form.tabs.filter(t => t === 'Лимитный').length, 1, `${key}: «Лимитный» appears more than once`);
        assert.ok(r.form.headingControls, `${key}: no trading heading`);
        assert.equal(r.form.headingControls.length, 1, `${key}: the heading carries ${r.form.headingControls.length} controls: ${JSON.stringify(r.form.headingControls)}`);
        assert.ok(r.form.headingControls[0].calculator, `${key}: the heading's one control is not the Calculator`);
        assert.ok(r.calculator && r.calculator.opened, `${key}: the Calculator did not open`);
        assert.deepEqual(r.clippedForm, [], `${key}: clipped text in the trading panel: ${JSON.stringify(r.clippedForm)}`);
        assert.equal(r.overflowX, 0, `${key}: the page scrolls sideways by ${r.overflowX}px`);
        assert.equal(r.form.formOverflowX, 0, `${key}: the trading panel scrolls sideways by ${r.form.formOverflowX}px`);
        assert.equal(r.form.buttons.length, 2, `${key}: expected Long and Short, found ${r.form.buttons.length}`);
        assert.ok(r.order, `${key}: the ticket did not POST an order`);
        // ORDER BOOK
        assert.ok(r.book.askCount > 0 && r.book.bidCount > 0, `${key}: book sides ${r.book.askCount}/${r.book.bidCount}`);
        if (r.book.order) {
          assert.ok(r.book.order.asksAbove, `${key}: asks are not all above the mid`);
          assert.ok(r.book.order.bidsBelow, `${key}: bids are not all below the mid`);
        }
        assert.ok(r.book.columns, `${key}: no book columns to measure`);
        for (const [k, v] of Object.entries(r.book.columns)) assert.ok(v <= 1, `${key}: book column ${k} drifts by ${v}px`);
        assert.deepEqual(r.clippedBook, [], `${key}: clipped text in the order book: ${JSON.stringify(r.clippedBook)}`);
        assert.ok(r.grouping && r.grouping.options.length > 1 && r.grouping.changed, `${key}: grouping did not regroup ${JSON.stringify(r.grouping)}`);
        assert.ok(r.tabSwitch && r.tabSwitch.onTrades === 'true' && r.tabSwitch.back === 'true', `${key}: Стакан/Сделки did not switch ${JSON.stringify(r.tabSwitch)}`);
        assert.ok(r.pick && r.pick.priceField && r.pick.row && r.pick.row.endsWith(r.pick.priceField), `${key}: a price click did not fill the ticket ${JSON.stringify(r.pick)}`);
        assert.deepEqual(r.pageErrors, [], `${key}: the page threw: ${r.pageErrors.join(' | ')}`);
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
