#!/usr/bin/env node
'use strict';
/**
 * Spot and CFD on a phone in the Futures phone layout (owner, 2026-11-19:
 * SpotMobileReference.css): the view switch in the instrument row, the Spot
 * ticket on the left and a short order book on the right, the order lists
 * under the ticket, the «Ордера» screen, «Купить» / «Продать» under the chart.
 *
 * Built frontend against a read-only loopback fixture (the routes of
 * qa-spot-cfd-terminal.cjs plus balances, two open orders and a deeper book).
 * Every write answers 405 and the run fails on any write request: controls
 * are pressed to prove they open what they should, nothing is submitted.
 *
 *   node scripts/qa-spot-mobile-terminal.cjs [--dist frontend/dist] [--out output/spot-mobile-terminal] [--widths 320,360,390,430]
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const dist = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/spot-mobile-terminal')));
const WIDTHS = arg('--widths', '320,360,390,430').split(',').map(Number);

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); };

const PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT'];
const CANDLES = Array.from({ length: 120 }, (_, i) => { const open = 83800 + i * 9 + Math.sin(i / 8) * 140, close = open + Math.sin(i * 2) * 35; return { time: Math.floor(Date.now() / 1000) - (120 - i) * 60, open, high: Math.max(open, close) + 20, low: Math.min(open, close) - 20, close, volume: 12 + i % 7 }; });
const app = express();
app.use((q,r,next) => ['GET','HEAD'].includes(q.method) ? next() : r.status(405).json({error:'Read-only fixture'}));
const stamp = () => new Date().toISOString();
const OPEN = [{id:'ord-open-1',pair:'BTC/USDT',side:'BUY',type:'LIMIT',status:'OPEN',price:'84000',triggerPrice:null,ocoGroupId:null,originalQuantity:'0.015',remainingQuantity:'0.015',createdAt:stamp()},{id:'ord-open-2',pair:'ETH/USDT',side:'SELL',type:'LIMIT',status:'PARTIALLY_FILLED',price:'3300',triggerPrice:null,ocoGroupId:null,originalQuantity:'1.2',remainingQuantity:'0.7',createdAt:stamp()}];
const HISTORY = [{id:'ord-h-1',pair:'BTC/USDT',side:'BUY',type:'MARKET',status:'FILLED',price:null,triggerPrice:null,ocoGroupId:null,originalQuantity:'0.01',remainingQuantity:'0',createdAt:stamp()}];
app.get('/api/v1/orders/me',(q,r)=>r.json(q.query.status&&/OPEN|PARTIALLY|PENDING/.test(String(q.query.status))?OPEN:q.query.status?HISTORY:[...OPEN,...HISTORY]));
app.get('/api/v1/balances',(_q,r)=>r.json([{asset:'USDT',available:'12500.50',locked:'1260'},{asset:'BTC',available:'0.4215',locked:'0'}]));
app.get('/api/v1/market/display/spot-book/:symbol',(q,r)=>r.json({available:true,pair:q.params.symbol.replace('-','/'),symbol:q.params.symbol,timestamp:Date.now(),fetchedAt:Date.now(),stale:false,bids:Array.from({length:14},(_,i)=>({price:String(84880-i),quantity:(0.2+i*0.13).toFixed(3)})),asks:Array.from({length:14},(_,i)=>({price:String(84892+i),quantity:(0.15+i*0.11).toFixed(3)})),_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:60000}}));
// Current display endpoints; fixtures only, never proxy a production service.
const rows = PAIRS.map(pair => ({pair,symbol:pair,providerSymbol:pair.replace('/',''),marketType:'linear_perpetual',baseAsset:pair.split('/')[0],quoteAsset:'USDT',lastPrice:84890.1,high24h:85954.6,low24h:83535,changePercent24h:1.25,quoteVolume24h:3.19e9,volume24h:15000,receivedAt:Date.now(),fetchedAt:Date.now(),stale:false}));
const display = (value,refreshMs=60000) => ({...value,_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs}});
app.get(['/api/v1/market/display','/api/v1/market/display/futures-tickers'],(_q,r)=>r.json(display({version:1,type:'snapshot',epoch:'fixture',revision:1,status:'live',rows})));
app.get('/api/v1/market/display/spot-snapshot',(_q,r)=>r.json(display({tickers:{available:true,source:'fixture',fetchedAt:Date.now(),stale:false,value:rows},overview:{available:false},sentiment:{available:false}})));
app.get(['/api/v1/market/display/spot-book/:symbol','/api/v1/market/display/futures-book/:symbol'],(q,r)=>r.json(display({available:true,symbol:q.params.symbol,timestamp:Date.now(),fetchedAt:Date.now(),stale:false,bids:[{price:'84880',quantity:'1.2'}],asks:[{price:'84892',quantity:'0.9'}]})));
app.get('/api/v1/cfd/display/tickers',(_q,r)=>r.json(display({configured:true,tickers:[{symbol:'XAUUSD',name:'Gold',price:'2650.3',changePercent24h:'0.4',status:'sampled',stale:false,displayOnly:true,executionAllowed:false,fetchedAt:Date.now(),asOf:Date.now(),providerTimestamp:Date.now(),maxQuoteAgeMs:21600000}]},21600000)));
app.get('/api/v1/cfd/display/candles/:symbol',(q,r)=>r.json(display({symbol:q.params.symbol,interval:q.query.interval,fetchedAt:Date.now(),bars:CANDLES.map(c=>({...c,openTime:c.time*1000,open:c.open/32,high:c.high/32,low:c.low/32,close:c.close/32}))},21600000)));
app.get('/api/v1/me', (_q,r)=>r.json({id:'qa',displayName:'QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin:false,role:'USER'}));
app.get('/api/v1/futures/config',(_q,r)=>r.json({symbols:PAIRS,minLeverage:1,maxLeverage:100,leverageStep:1,fundingIntervalHours:8,highLeverageWarningThreshold:25,leverageTiers:[{notionalCap:null,maxLeverage:100,maintenanceMarginRate:0.005,maintenanceAmount:0}]}));
app.get('/api/v1/market/universe',(_q,r)=>r.json({available:true,value:{instruments:PAIRS.map(p=>({symbol:p,providerSymbol:p.replace('/',''),marketType:'linear_perpetual',baseAsset:p.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',status:'Trading',fundingIntervalMinutes:480}))}}));
app.get('/api/v1/market/external/tickers',(_q,r)=>r.json({tickers:PAIRS.map(p=>({pair:p,lastPrice:84890.1,high24h:85954.6,low24h:83535,changePercent:1.25,quoteVolume24h:3.19e9,volume24h:15000}))}));
app.get('/api/v1/market/external/symbols',(_q,r)=>r.json({symbols:PAIRS}));
app.get('/api/v1/market/pairs',(_q,r)=>r.json(PAIRS.map(p=>({pair:p,base:p.split('/')[0],quote:'USDT'}))));
app.get('/api/v1/futures/mark-price/:s',(_q,r)=>r.json({symbol:'BTCUSDT',markPrice:'84887.45',indexPrice:'84123.99'}));
app.get('/api/v1/futures/funding-rate/:s',(_q,r)=>r.json({history:[{rate:'0.0001',markPrice:'84887.45',indexPrice:'84123.99',appliedAt:new Date().toISOString()}]}));
app.get('/api/v1/futures/open-interest/:s',(_q,r)=>r.json({available:true,value:{openInterestBase:30894.9}}));
app.get('/api/v1/market/derivatives/:a',(_q,r)=>r.json({available:true,source:'qa',fetchedAt:Date.now(),stale:false,value:{turnover24hUsd:3.19e9,openInterestBase:30894.9,openInterestUsd:9.2e8}}));
app.get('/api/v1/wallet/overview',(_q,r)=>r.json({balances:{spot:[],futures:[],spotValueUsd:0,futuresValueUsd:0,totalValueUsd:0},valuationComplete:true,unpricedAssets:[],btcPriceUsd:84890}));
app.get('/api/v1/futures/positions',(_q,r)=>r.json([])); app.get('/api/v1/futures/orders',(_q,r)=>r.json([]));
app.get('/api/v1/orders',(_q,r)=>r.json([])); app.get('/api/v1/orders/history',(_q,r)=>r.json([]));
app.get('/api/v1/balances',(_q,r)=>r.json([]));
app.get('/api/v1/orderbook/:a/:b',(_q,r)=>r.json({bids:[['84880','1.2'],['84879','0.8']],asks:[['84892','0.9'],['84893','1.5']]}));
app.get('/api/v1/cfd/instruments',(_q,r)=>r.json({instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals'},{symbol:'EURUSD',displayName:'Euro',category:'fx'}]}));
app.get('/api/v1/cfd/quotes',(_q,r)=>r.json({quotes:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,changePercent:0.4}]}));
app.get('/api/v1/cfd/positions',(_q,r)=>r.json({positions:[]}));
app.get('/api/v1/market/live',(_q,r)=>{r.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});r.write(': open\n\n');});
app.get('/api/v1/market/snapshot',(_q,r)=>r.json({pairs:PAIRS.map(p=>({pair:p,lastPrice:84890.1,changePercent:1.25,high24h:85954.6,low24h:83535,quoteVolume24h:3.19e9})),fetchedAt:Date.now()}));
app.get('/api/v1/market/assets/icons',(_q,r)=>r.json({icons:{}}));
app.get('/api/v1/market/external/rankings',(_q,r)=>r.json({gainers:[],losers:[]}));
app.get('/api/v1/market/external/orderbook/:p',(_q,r)=>r.json({bids:[[84880,1.2],[84879,0.8],[84878,2.1]],asks:[[84892,0.9],[84893,1.5],[84894,1.1]],fetchedAt:Date.now()}));
app.get(['/api/v1/market/external/candles/:p','/api/v1/market/futures/candles/:p','/api/v1/cfd/candles/:s','/api/v1/private-trading/candles'],(q,r)=>r.json({pair:(q.params.p||'BTC-USDT').replace('-','/'),interval:q.query.interval,candles:CANDLES}));
app.get('/api/v1/cfd/config',(_q,r)=>r.json({configured:true,instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals',minQuantity:0.01,quantityStep:0.01,leverage:20}]}));
app.get('/api/v1/cfd/tickers',(_q,r)=>r.json({tickers:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,last:2650.3,changePercent:0.4,high24h:2662,low24h:2640}]}));
app.get(['/api/v1/orders/me','/api/v1/futures/orders/me'],(_q,r)=>r.json([]));
app.get('/api/v1/futures/balances',(_q,r)=>r.json([]));
app.get('/api/v1/private-trading/access',(_q,r)=>r.json({allowed:false}));
app.get('/api/v1/support/conversations/mine',(_q,r)=>r.json({conversation:null}));
app.use('/api/v1',(_q,r)=>r.json([]));
app.use(express.static(dist,{index:false}));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));



/** Geometry and text of the Spot phone screen, read in the page. */
const readSpot = page => page.evaluate(() => {
  const q = sel => document.querySelector(sel);
  const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const bar = q('.ticker-bar'), tabs = [...document.querySelectorAll('.terminal-mobile-tabs button')];
  const submit = q('.order-form-content .submit-btn');
  return {
    tab: q('.terminal').getAttribute('data-mobile-tab'), pane: q('.terminal').getAttribute('data-mobile-pane'), viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    header: shown(bar) ? { rect: rect(bar), position: getComputedStyle(bar).position, background: getComputedStyle(bar).backgroundColor, pair: q('.ticker-bar .pair-name')?.textContent.trim(), priceShown: shown(q('.ticker-bar .value.price')), stats: rect(q('.spot-mobile-stats-toggle')), text: bar.innerText.replace(/\s+/g, ' ') } : null,
    switch: tabs.map(b => ({ id: b.id, selected: b.getAttribute('aria-selected'), label: b.querySelector('.terminal-mobile-tab-label')?.textContent ?? null, icon: !!b.querySelector('svg'), ...rect(b) })),
    form: rect(q('.order-form-area')), bookArea: shown(q('.orderbook-area')) ? rect(q('.orderbook-area')) : null,
    sides: [...document.querySelectorAll('.order-form-tab')].map(b => ({ text: b.textContent.trim(), active: b.classList.contains('active'), bg: getComputedStyle(b).backgroundColor, ...rect(b) })),
    family: q('.order-type-select select')?.value ?? null,
    available: q('.available-balance')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    fields: [...document.querySelectorAll('.order-form-content .input-group')].filter(shown).map(el => Math.round(el.getBoundingClientRect().height)),
    presets: [...document.querySelectorAll('.slider-labels button')].filter(shown).map(b => Math.round(b.getBoundingClientRect().height)), slider: shown(q('.terminal-size-range')),
    submit: submit ? { text: submit.textContent.trim(), radius: parseFloat(getComputedStyle(submit).borderTopLeftRadius), bg: getComputedStyle(submit).backgroundColor, clipped: submit.scrollWidth > submit.clientWidth + 1, ...rect(submit) } : null,
    book: { asks: document.querySelectorAll('.orderbook-asks .ob-row').length, bids: document.querySelectorAll('.orderbook-bids .ob-row').length, last: q('.ob-spread-price')?.textContent.trim() ?? null, step: shown(q('.ob-group-select')), title: shown(q('.orderbook-title')),
      clipped: [...document.querySelectorAll('.ob-row .cell')].filter(shown).filter(c => c.scrollWidth > c.clientWidth + 1).length },
    bottomTabs: [...document.querySelectorAll('.bottom-tabs .bottom-tab')].map(b => { const short = b.getAttribute('data-mobile-label'); return { id: b.id, text: ((short ?? [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')) + (b.querySelector('.badge') ? `(${b.querySelector('.badge').textContent})` : '')).trim(), shown: shown(b), active: b.classList.contains('active'), wide: b.scrollWidth > b.clientWidth + 1 }; }),
    ordersOpen: shown(q('.terminal-mobile-orders-open')) ? rect(q('.terminal-mobile-orders-open')) : null, cancelAll: shown(q('.bottom-action-btn')) ? q('.bottom-action-btn').textContent.trim() : null,
    ordersBar: shown(q('.terminal-mobile-orders-bar')) ? q('.terminal-mobile-orders-bar').innerText.trim() : null,
    quick: [...document.querySelectorAll('.terminal-mobile-quick button')].filter(shown).map(b => ({ text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, ...rect(b) })),
    cards: document.querySelectorAll('[data-order-id], .spot-order-card, .spot-orders-card').length, text: document.body.innerText,
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
  const report = { dist: path.relative(ROOT, dist), environment: 'Built frontend; read-only loopback fixture; nothing submitted', views: [] };
  const session = async (width, height, url, phone = true) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: phone, isMobile: phone, locale: 'ru-RU' });
    await context.addInitScript(() => { try { localStorage.setItem('exchange_token', 'local-qa'); localStorage.setItem('exchange_lang', 'ru'); } catch {} });
    const view = { width, url, writes: [], errors: [] }; report.views.push(view);
    await context.route('**/*', async route => {
      const request = route.request(), u = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) view.writes.push(`${request.method()} ${u.host}${u.pathname}`);
      if (u.origin === origin) return route.continue();
      // The public display reads go to the market edge in a production build; the stand answers them itself.
      if (/\/market\/display\//.test(u.pathname)) { try { const res = await fetch(origin + '/api/v1' + u.pathname.slice(u.pathname.indexOf('/market/display/')) + u.search); return route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() }); } catch { return route.abort(); } }
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => view.errors.push(e.message.slice(0, 200)));
    await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
    return { context, page, view };
  };
  try {
    for (const width of WIDTHS) {
      const P = `spot ${width}`;
      const { context, page, view } = await session(width, width <= 320 ? 700 : 844, '/trade?pair=BTC%2FUSDT');
      await page.locator('.orderbook-bids .ob-row').first().waitFor({ timeout: 20000 });
      await page.waitForFunction(() => /12[,\s]?500/.test(document.querySelector('.available-balance')?.textContent ?? ''), null, { timeout: 15000 });
      await page.waitForTimeout(500);
      const t = await readSpot(page);

      ok(`${P}: opens on the trade screen without a horizontal page scroll`, t.tab === 'trade' && t.overflow <= 1, { tab: t.tab, overflow: t.overflow });
      ok(`${P}: instrument row — the pair and the «24h» figures key; the price is stated once, in the book`, t.header && /^BTC\/USDT/.test(t.header.pair) && Math.round(t.header.rect.height) === 48 && t.header.position === 'sticky' && !t.header.priceShown && t.header.stats.width >= 40
        && !/rgba\(0, 0, 0, 0\)|transparent/.test(t.header.background), t.header && { height: t.header.rect.height, stats: Math.round(t.header.stats.width) });
      const sw = t.switch;
      ok(`${P}: the view switch is three icon keys in the instrument row, at its right edge: chart, ticket, orders — as on Futures`, sw.length === 3 && sw.map(b => b.id).join() === 'mobile-trade-chart,mobile-trade-trade,mobile-trade-account'
        && sw.every(b => b.icon && b.label && b.height >= 36 && b.width >= 36 && b.top >= t.header.rect.top && b.bottom <= t.header.rect.bottom) && sw[1].selected === 'true'
        && Math.abs(sw[2].right - (t.viewport - (width < 360 ? 8 : 12))) <= 1 && t.header.stats.right <= sw[0].left, sw.map(b => [b.id.replace('mobile-trade-', ''), Math.round(b.left), Math.round(b.width)]));
      ok(`${P}: the ticket is on the left and the order book on the right, side by side, inside the screen`, t.bookArea && t.form.left < t.bookArea.left && t.form.right <= t.bookArea.left + 1 && Math.abs(t.form.top - t.bookArea.top) <= 1
        && t.form.width > t.bookArea.width && t.bookArea.width >= width * 0.34 && t.bookArea.right <= t.viewport + 0.5 && t.form.left >= 7.5, t.bookArea && { form: Math.round(t.form.width), book: Math.round(t.bookArea.width) });
      const [buy, sell] = t.sides;
      ok(`${P}: «Купить | Продать» is one segmented pill over the ticket; the chosen side carries its colour`, t.sides.length === 2 && buy.text === 'Купить' && sell.text === 'Продать' && buy.active && !sell.active && Math.abs(buy.top - sell.top) <= 1
        && Math.round(buy.height) === 32 && buy.bg !== sell.bg && Math.abs(buy.left - t.form.left) <= 1 && Math.abs(sell.right - t.form.right) <= 1, t.sides.map(s => [s.text, Math.round(s.width), Math.round(s.height)]));
      ok(`${P}: ticket — order type, available balance, price, quantity and total fields, the size slider with its five stops as small tick labels`, t.family === 'LIMIT' && /Доступно/.test(t.available) && /12[,\s]?500\.50 USDT/.test(t.available)
        && t.fields.length === 3 && t.fields.every(h => h >= 40) && t.slider && t.presets.length === 5 && t.presets.every(h => h >= 28 && h <= 30), { family: t.family, available: t.available, fields: t.fields, presets: t.presets });
      ok(`${P}: the action is one pill with its word whole`, t.submit && t.submit.text === 'Купить' && Math.round(t.submit.height) === 40 && t.submit.radius >= 20 && !t.submit.clipped
        && Math.abs(t.submit.left - t.form.left) <= 1 && Math.abs(t.submit.right - t.form.right) <= 1, t.submit && [t.submit.text, Math.round(t.submit.width), Math.round(t.submit.height), t.submit.bg, buy.bg, t.submit.radius, t.submit.clipped]);
      ok(`${P}: book column — at least four asks and four bids around the last price, the price step under them, no heading, no cut figure`, t.book.asks >= 4 && t.book.bids >= 4 && /84,?88\d/.test(t.book.last ?? '') && t.book.step && !t.book.title && t.book.clipped === 0, t.book);
      const names = t.bottomTabs.filter(b => b.shown).map(b => b.text.replace(/\s/g, ''));
      ok(`${P}: under the ticket — «Ордера» with its count, «История ордеров», «Активы», the list key for the full screen and «Отменить все»`, names.join('|') === 'Ордера(1)|Историяордеров|Активы' && t.bottomTabs[0].active && t.ordersOpen && t.ordersOpen.width >= 36
        && t.cancelAll === 'Отменить все' && !t.ordersBar && t.quick.length === 0, { tabs: names, cancelAll: t.cancelAll });
      ok(`${P}: no demo wording on the screen`, !/демо|demo/i.test(t.text));
      await page.screenshot({ path: path.join(OUT, `spot-${width}-trade.png`), animations: 'disabled' });

      // ── The controls do what they did ──
      await page.locator('.order-form-tab.sell').click(); await page.waitForTimeout(120);
      const sold = await readSpot(page);
      ok(`${P}: «Продать» turns the pill and the action to the sell side`, sold.sides[1].active && !sold.sides[0].active && sold.submit.text === 'Продать' && sold.submit.bg !== t.submit.bg && sold.sides[1].bg !== t.sides[0].bg, [sold.submit.text]);
      await page.locator('.order-form-tab.buy').click();
      await page.locator('.orderbook-asks .ob-row').last().click(); await page.waitForTimeout(150);
      ok(`${P}: a price pressed in the book fills the ticket and keeps the trade screen`, /^8489\d/.test((await page.locator('.order-form-content .input-group input').first().inputValue()).replace(/[,\s]/g, '')) && await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade', await page.locator('.order-form-content .input-group input').first().inputValue());
      await page.locator('.order-type-select select').selectOption({ index: 1 }); await page.waitForTimeout(150);
      ok(`${P}: the order type select switches the ticket`, await page.locator('.order-type-select select').inputValue() !== 'LIMIT' && (await readSpot(page)).overflow <= 1, await page.locator('.order-type-select select').inputValue());
      await page.locator('.order-type-select select').selectOption({ index: 0 });
      await page.locator('.spot-mobile-stats-toggle').click(); await page.waitForTimeout(150);
      const figures = await readSpot(page);
      ok(`${P}: the «24h» key opens the figures of the pair in place`, /84,890\.10/.test(figures.header.text) && /85,954\.60/.test(figures.header.text) && /83,535/.test(figures.header.text) && figures.overflow <= 1, figures.header.text.slice(0, 120));
      await page.locator('.spot-mobile-stats-toggle').click();
      await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(150);
      const pinned = await page.evaluate(() => { const b = document.querySelector('.ticker-bar').getBoundingClientRect(), k = document.querySelector('#mobile-trade-trade').getBoundingClientRect(); return { top: Math.round(b.top), switchTop: Math.round(k.top) }; });
      ok(`${P}: scrolled, the instrument row and the switch stay at the top`, pinned.top === 0 && pinned.switchTop >= 0 && pinned.switchTop <= 8, pinned);
      await page.evaluate(() => window.scrollTo(0, 0));

      // ── «Ордера» ──
      await page.locator('.terminal-mobile-orders-open').click(); await page.waitForTimeout(250);
      const orders = await readSpot(page);
      ok(`${P}: the list key opens «Ордера»: a title row with the way back and the three lists`, orders.tab === 'account' && orders.ordersBar === 'Ордера' && orders.header === null && orders.bottomTabs.every(b => b.shown) && orders.switch[2].selected === 'true' && orders.overflow <= 1 && /BTC\/USDT/.test(orders.text) && /84,000/.test(orders.text), orders.bottomTabs.map(b => b.text));
      await page.screenshot({ path: path.join(OUT, `spot-${width}-orders.png`), animations: 'disabled' });
      await page.locator('#spot-tab-orderHistory').click(); await page.waitForTimeout(300);
      ok(`${P}: order history opens on the «Ордера» screen`, await page.locator('#spot-tab-orderHistory').getAttribute('aria-selected') === 'true' && (await readSpot(page)).overflow <= 1);
      await page.locator('#spot-tab-open').click();
      await page.locator('.terminal-mobile-orders-bar button').click(); await page.waitForTimeout(200);
      ok(`${P}: the arrow in the title row returns to the ticket`, await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade');

      // ── Chart ──
      await page.locator('#mobile-trade-chart').click(); await page.waitForTimeout(700);
      const chart = await readSpot(page);
      const panes = await page.evaluate(() => [...document.querySelectorAll('.terminal-mobile-chart-tabs button')].map(b => b.textContent.trim()));
      const price = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ticker-bar .value.price')).fontSize));
      ok(`${P}: chart screen — last price large with its change, the day's high and low, then «График | Стакан | Рынки»`, chart.tab === 'chart' && /84,890\.10/.test(chart.header.text) && /1\.25%/.test(chart.header.text) && /85,954\.60/.test(chart.header.text) && /83,535/.test(chart.header.text)
        && price >= 20 && panes.join('|') === 'График|Стакан|Рынки' && chart.overflow <= 1, chart.header.text.slice(0, 120));
      const nav = await page.evaluate(() => { const n = document.querySelector('.bottom-nav'); return n ? n.getBoundingClientRect().top : null; });
      ok(`${P}: «Купить» and «Продать» sit under the chart, above the bottom menu, in their colours`, chart.quick.length === 2 && chart.quick[0].text === 'Купить' && chart.quick[1].text === 'Продать' && chart.quick.every(b => b.height >= 44)
        && chart.quick[0].bg !== chart.quick[1].bg && (nav === null || chart.quick[0].bottom <= nav + 1), chart.quick.map(b => [b.text, Math.round(b.width)]));
      await page.screenshot({ path: path.join(OUT, `spot-${width}-chart.png`), animations: 'disabled' });
      await page.locator('.terminal-mobile-quick button.sell').click(); await page.waitForTimeout(250);
      const viaQuick = await readSpot(page);
      ok(`${P}: «Продать» under the chart opens the ticket on the sell side and submits nothing`, viaQuick.tab === 'trade' && viaQuick.sides[1].active && viaQuick.submit.text === 'Продать' && view.writes.length === 0, view.writes);
      await page.locator('#mobile-trade-chart').click(); await page.waitForTimeout(300);
      await page.locator('.terminal-mobile-chart-tabs button').nth(1).click(); await page.waitForTimeout(400);
      ok(`${P}: «Стакан» on the chart screen shows the full book`, await page.locator('.orderbook-area').isVisible() && await page.locator('.orderbook-asks .ob-row').count() >= 4 && (await readSpot(page)).overflow <= 1);
      ok(`${P}: no page error and no write request`, view.errors.length === 0 && view.writes.length === 0, { errors: view.errors, writes: view.writes });
      await context.close();
    }

    // ── CFD: the same instrument row and ticket language ──
    for (const width of [360, 390]) {
      const P = `cfd ${width}`;
      const { context, page, view } = await session(width, 844, '/trade?market=cfd');
      await page.locator('.cfd-ticker-bar').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
      const read = () => page.evaluate(() => {
        const q = sel => document.querySelector(sel), rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        const submit = q('.cfd-submit'), price = q('.cfd-ticker-bar .cfd-ticker-price');
        return { tab: q('.terminal').getAttribute('data-mobile-tab'), viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          switch: [...document.querySelectorAll('.terminal-mobile-tabs button')].map(b => ({ id: b.id, selected: b.getAttribute('aria-selected'), icon: !!b.querySelector('svg'), ...rect(b) })),
          bar: shown(q('.cfd-ticker-bar')) ? rect(q('.cfd-ticker-bar')) : null, symbol: q('.cfd-ticker-bar .cfd-symbol')?.textContent.trim() ?? null,
          price: shown(price) ? { text: price.textContent.trim(), size: parseFloat(getComputedStyle(price).fontSize), ...rect(price) } : null,
          sides: [...document.querySelectorAll('.cfd-sideTab')].filter(shown).map(b => ({ text: b.textContent.trim(), active: b.classList.contains('active'), bg: getComputedStyle(b).backgroundColor, ...rect(b) })),
          submit: shown(submit) ? { text: submit.textContent.trim(), radius: parseFloat(getComputedStyle(submit).borderTopLeftRadius), ...rect(submit) } : null,
          ordersBar: shown(q('.terminal-mobile-orders-bar')) ? q('.terminal-mobile-orders-bar').innerText.trim() : null, panes: [...document.querySelectorAll('.terminal-mobile-chart-tabs button')].filter(shown).map(b => b.textContent.trim()) };
      });
      const c = await read();
      ok(`${P}: the same icon switch in the instrument row; the last price is large and clear of the switch`, c.switch.length === 3 && c.switch.every(b => b.icon && b.height >= 36) && c.symbol === 'XAUUSD' && c.price && c.price.size >= 20 && /2,650\.30/.test(c.price.text)
        && c.price.top >= c.switch[0].bottom - 1 && c.price.left < 40 && Math.abs(c.switch[2].right - (c.viewport - 12)) <= 1 && c.overflow <= 1, c.price && { price: c.price.text, top: Math.round(c.price.top), left: Math.round(c.price.left) });
      ok(`${P}: chart screen — «График | Рынки» as text tabs`, c.tab === 'chart' && c.panes.join('|') === 'График|Рынки', c.panes);
      await page.screenshot({ path: path.join(OUT, `cfd-${width}-chart.png`), animations: 'disabled' });
      await page.locator('#mobile-trade-trade').click(); await page.waitForTimeout(400);
      const f = await read();
      ok(`${P}: ticket — the side as one segmented pill, the action as a pill`, f.tab === 'trade' && f.sides.length === 2 && f.sides[0].active && Math.round(f.sides[0].height) === 36 && f.sides[0].bg !== f.sides[1].bg && Math.abs(f.sides[0].top - f.sides[1].top) <= 1
        && f.submit && Math.round(f.submit.height) === 40 && f.submit.radius >= 20 && f.overflow <= 1, { sides: f.sides.map(s => s.text), submit: f.submit && f.submit.text });
      await page.screenshot({ path: path.join(OUT, `cfd-${width}-trade.png`), animations: 'disabled' });
      await page.locator('#mobile-trade-account').click(); await page.waitForTimeout(400);
      const a = await read();
      ok(`${P}: «Позиции» is a full screen with its title row and way back`, a.tab === 'account' && a.ordersBar === 'Позиции' && a.bar === null && a.overflow <= 1);
      await page.locator('.terminal-mobile-orders-bar button').click(); await page.waitForTimeout(200);
      ok(`${P}: the arrow returns to the ticket; no page error and no write request`, await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade' && view.errors.length === 0 && view.writes.length === 0, { errors: view.errors, writes: view.writes });
      await context.close();
    }

    // Desktop is not touched by the phone sheet.
    {
      const { context, page } = await session(1440, 900, '/trade?pair=BTC%2FUSDT', false);
      await page.locator('.order-form-content').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
      const desktop = await page.evaluate(() => { const shown = sel => [...document.querySelectorAll(sel)].some(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
        return { phoneOnly: ['.terminal-mobile-tabs', '.terminal-mobile-orders-bar', '.terminal-mobile-orders-open', '.terminal-mobile-quick'].filter(shown), openTab: document.querySelector('#spot-tab-open')?.innerText.replace(/\s+/g, ' ').trim() }; });
      ok('spot 1440: none of the phone controls is drawn and the first tab keeps its full name', desktop.phoneOnly.length === 0 && /^Открытые ордера/.test(desktop.openTab ?? ''), desktop);
      await context.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  report.checks = checks; report.passed = checks.filter(c => c.pass).length; report.failed = checks.filter(c => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
