#!/usr/bin/env node
/** Real production-bundle, loopback-only Futures presentation review.
 * No credentials, providers, database or financial writes. --serve leaves
 * the same fixture available for owner review. Never bundled into product.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/futures-proportions')));
const PHASE = arg('--phase', 'after');
const PORT = Number(arg('--port', '4394'));
const WIDTHS = arg('--widths', '1920,1664,1600,1440,1366,390').split(',').map(Number);
const MIN_TICKER_GAP = Number(arg('--ticker-gap-min', '0'));
const NOW = Date.UTC(2026, 9, 3, 10, 0, 0);
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', '1000PEPE/USDT'];
const PRICES = { BTCUSDT: 85421.3, ETHUSDT: 3211.42, '1000PEPEUSDT': 0.00001234 };
const hits = [];
const json = body => (_q, r) => r.json(body);
const key = s => s.replace(/[-/]/g, '');
const price = s => PRICES[key(s)] || PRICES.BTCUSDT;
const rows = SYMBOLS.map(pair => {
  const last = price(pair), base = pair.split('/')[0];
  return { id: 'linear_perpetual:' + key(pair), pair, symbol: pair, provider: 'bybit', providerSymbol: key(pair), marketType: 'linear_perpetual',
    baseAsset: base, quoteAsset: 'USDT', settleAsset: 'USDT', volumeAsset: base, turnoverAsset: 'USDT', lastPrice: last,
    bidPrice: last * .99999, askPrice: last * 1.00001, high24h: last * 1.025, low24h: last * .98,
    volume24h: 18235.5, quoteVolume24h: 1555469980.54, changePercent24h: 1.25, indexPrice: last * 1.00002,
    markPrice: last * 1.00001, fundingRate: .0001, openInterest: 126225.9959, openInterestValue: last * 126225.9959,
    fundingIntervalMinutes: 480, providerEventAt: NOW, receivedAt: NOW, fetchedAt: NOW, stale: false, sequence: null };
});
const display = value => ({ ...value, _display: { mode: 'snapshot', capturedAt: NOW, refreshMs: 60000 } });
function book(symbol) {
  const p = price(symbol), tick = p > 1000 ? .1 : .00000001;
  const levels = side => Array.from({ length: 35 }, (_, i) => ({ price: String(p + side * (i + 1) * tick), quantity: String(0.027 + (i % 9) * .048) }));
  return { available: true, symbol, pair: symbol.replace('-', '/'), timestamp: NOW, fetchedAt: NOW, providerTime: NOW, updateId: 1,
    bids: levels(-1), asks: levels(1), stale: false };
}
function candles(symbol, interval = '1h') {
  const step = ({ '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 })[interval] || 3600;
  const p = price(symbol);
  return Array.from({ length: 320 }, (_, i) => {
    const open = p * (0.982 + i * .000052 + Math.sin(i / 8) * .003), close = open * (1 + Math.sin(i * 3.4) * .0018);
    return { time: NOW / 1000 - (320 - i) * step, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * .999, close, volume: 6 + i % 15 };
  });
}
const POSITIONS = [
  { id: 'fixture-btc', symbol: 'BTC/USDT', side: 'LONG', size: '2.16560000', entryPrice: '84000.00', leverage: 10, marginType: 'CROSS', initialMargin: '18191.04000000', liquidationPrice: '74800.00', markPrice: '85421.30', unrealizedPnl: '3077.96628', realizedPnl: '0', roe: '16.92' },
  { id: 'fixture-eth', symbol: 'ETH/USDT', side: 'SHORT', size: '35.12500000', entryPrice: '3300.00', leverage: 5, marginType: 'ISOLATED', initialMargin: '23182.5', liquidationPrice: '3860.00', markPrice: '3211.42', unrealizedPnl: '3111.3725', realizedPnl: '0', roe: '13.42' },
  { id: 'fixture-small', symbol: '1000PEPE/USDT', side: 'LONG', size: '12345678.00000000', entryPrice: '0.00001220', leverage: 10, marginType: 'CROSS', initialMargin: '15.06172716', liquidationPrice: '0.00001099', markPrice: '0.00001234', unrealizedPnl: '1.72839492', realizedPnl: '0', roe: '11.48' },
].map((p, i) => ({ ...p, openedAt: new Date(NOW - 3600000 * (i + 1)).toISOString(), protection: { takeProfit: i === 0 ? { id: 'fixture-tp', kind: 'TAKE_PROFIT', triggerPrice: '90000', status: 'PENDING', attempts: 0, revision: 1 } : null, stopLoss: i === 0 ? { id: 'fixture-sl', kind: 'STOP_LOSS', triggerPrice: '81000', status: 'PENDING', attempts: 0, revision: 1 } : null } }));
const ACCOUNT = { settleBalance: '56405024.03', walletCollateral: '0', collateral: '56405024.03', unrealizedPnl: '6191.06717492', equity: '56411215.09717492', initialMargin: '23101.35', orderReserve: '0', maintenanceMargin: '950.24', available: '56381922.68', initialMarginRatio: '0.0004095', maintenanceRatio: '0.0000168', liquidatable: false, collateralComplete: true, unpricedAssets: [], collateralAsOf: NOW, isolatedMargin: '23182.5' };
const CONTRACT = { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMarketOrderQty: '119', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1', riskTiers: [{ maxNotional: '2000000000', maintenanceRate: '.005', deduction: '0', maxLeverage: '100' }], takerFeeRate: '.00055', makerFeeRate: '.0002' };
const state = filled => ({ initialized: true, revision: 1, source: 'PREVIEW_FIXTURE', asOf: NOW, model: { version: 'fixture', funding: { longCashflow: '0', shortCashflow: '0', unit: 'USDT', intervalMs: 28800000 } }, account: ACCOUNT, ledger: null,
  positions: filled ? POSITIONS.map(p => ({ ...p, symbol: key(p.symbol), quantity: p.size, leverage: String(p.leverage), marginMode: p.marginType, isolatedMargin: p.initialMargin, lastPrice: p.markPrice, status: 'OPEN', openedAt: Date.parse(p.openedAt), closedAt: null, historical: false, netPnl: p.unrealizedPnl, roiPercent: p.roe, roiBasis: p.initialMargin, closedRoiBasis: '0', fundingNet: '0', liquidationStatus: 'AVAILABLE', protection: { takeProfit: p.protection.takeProfit?.triggerPrice || null, stopLoss: p.protection.stopLoss?.triggerPrice || null, quantity: null, triggerBy: 'MARK' } })) : [], history: [], orders: [], events: [], entries: [] });

// These guards run before the real app. The preview cannot accidentally
// contact production, including when opened manually without Playwright.
const bootstrap = `(() => {
  if (location.hostname !== '127.0.0.1') throw new Error('Loopback only');
  localStorage.setItem('exchange_token','qa-proportions'); localStorage.setItem('exchange_lang','ru');
  if (!localStorage.getItem('voltex.chartSettings.v1')) localStorage.setItem('voltex.chartSettings.v1',JSON.stringify({preset:'classic',bodyUp:'#ffffff',bodyDown:'#ff9800',borderUp:'#ffffff',borderDown:'#ff9800',wickUp:'#ffffff',wickDown:'#ff9800'}));
  Date.now = () => ${NOW};
  const original = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url,location.origin);
    if (url.origin === 'https://market.voltextech.net') return original('/api/v1'+url.pathname+url.search,options);
    if (url.origin !== location.origin) return Promise.reject(new Error('External network blocked in fixture'));
    return original(input,options);
  };
  const books = ${JSON.stringify(Object.fromEntries(SYMBOLS.map(s => [key(s), book(key(s))])))};
  window.WebSocket = class extends EventTarget {
    static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3; readyState=0;
    constructor(url) { super(); this.url=String(url); setTimeout(()=>{this.readyState=1; this.fire('open',new Event('open'));},0); }
    fire(type,e) {this['on'+type]?.(e);this.dispatchEvent(e);}
    send(raw) { const q=JSON.parse(raw); for(const topic of q.args||[]) if(topic.startsWith('orderbook.')) { const symbol=topic.split('.').at(-1), b=books[symbol]; if(b) setTimeout(()=>this.fire('message',new MessageEvent('message',{data:JSON.stringify({topic,type:'snapshot',ts:${NOW},data:{s:symbol,b:b.bids.map(r=>[r.price,r.quantity]),a:b.asks.map(r=>[r.price,r.quantity]),u:1,seq:1}})})),0); } }
    close() {this.readyState=3;}
  };
  window.EventSource = class { close(){} addEventListener(){} removeEventListener(){} };
})();`;
function start() {
  const app = express();
  app.use(express.json());
  app.use((q, r, next) => {
    hits.push({ method: q.method, path: q.path }); r.set('Cache-Control', 'no-store');
    r.set('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; worker-src 'none'");
    if (!['GET', 'HEAD'].includes(q.method) && !['/api/v1/private-trading/native/execution-session', '/api/v1/private-trading/native/quote'].includes(q.path)) return r.status(405).json({ error: 'Read-only presentation fixture' });
    const state = /(?:^|;\s*)qa_state=([^;]+)/.exec(q.headers.cookie || '')?.[1] || 'empty';
    q.qaState = state;
    if (/^\/api\/v1\/(?:balances|futures\/(?:balances|positions|orders)|private-trading\/native\/(?:state|live))/.test(q.path)) {
      if (state === 'error') return r.status(503).json({ error: 'Synthetic account unavailable' });
      if (state === 'loading') return setTimeout(next, 10000);
    }
    next();
  });
  app.get('/__qa/bootstrap.js', (_q, r) => r.type('js').send(bootstrap));
  app.use('/__qa/evidence', express.static(OUT));
  app.get('/__qa/hits', (_q, r) => r.json(hits));
  app.get('/api/v1/me', json({ id: 'qa-proportions', email: 'preview@localhost.invalid', role: 'USER', isAdmin: false, avatarUrl: null, createdAt: '2025-01-01T00:00:00Z', emailVerified: true, kycStatus: 'NONE' }));
  app.get('/api/v1/private-trading/access', json({ allowed: true, nativeAvailable: true, simulationOnly: true }));
  app.get(['/api/v1/private-trading/native/state','/api/v1/private-trading/native/live'], (q,r) => r.json(state(q.qaState === 'filled')));
  app.get('/api/v1/private-trading/native/contracts/:symbol', (q,r) => r.json({ ...CONTRACT, symbol:q.params.symbol }));
  app.get('/api/v1/private-trading/native/history', (q,r) => r.json({ revision:1, kind:q.query.kind, items:[], nextCursor:null }));
  app.get('/api/v1/private-trading/native/wallet', json({ initialized:true,account:ACCOUNT,ledger:{entries:[],openingBalance:ACCOUNT.settleBalance,closingBalance:ACCOUNT.settleBalance,walletBalance:ACCOUNT.settleBalance,totals:{realizedPnl:'0',fees:'0',funding:'0',net:'0'},reconciled:true},collateral:{settleAsset:'USDT',lines:[],priced:'0',collateralPriced:'0',unpriced:[],collateralUnpriced:[],complete:true,asOf:NOW},rows:[],assetsValue:ACCOUNT.settleBalance,assetsEquityValue:ACCOUNT.equity,assetsComplete:true,unpricedAssets:[] }));
  app.post('/api/v1/private-trading/native/execution-session', json({ok:true}));
  app.post('/api/v1/private-trading/native/quote', (_q,r) => r.json({ kind:'ORDER',entryNotional:null,baseInitialMargin:null,closeFeeReserve:null,openingFee:null,positionMargin:null,totalCost:null,violation:null,rules:CONTRACT,takerFeeRate:'.00055',makerFeeRate:'.0002' }));
  app.get('/api/v1/futures/funding-rate/:symbol', json({ history:[{rate:'.0001',appliedAt:new Date(NOW).toISOString()}] }));
  app.get('/api/v1/market/derivatives/:base', (q,r) => r.json({available:true,source:'bybit',fetchedAt:NOW,stale:false,value:{baseAsset:q.params.base,turnover24hUsd:1555469980.54,turnoverVenues:['bybit'],openInterestBase:126225.9959,openInterestBaseVenues:['bybit'],openInterestUsd:10781530063.57,openInterestUsdVenues:['bybit']}}));
  app.get('/api/v1/futures/config', json({ symbols: SYMBOLS, minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8, highLeverageWarningThreshold: 50,
    leverageTiers: [{ notionalCap: 2000000, maxLeverage: 100, maintenanceMarginRate: .005, maintenanceAmount: 0 }, { notionalCap: null, maxLeverage: 50, maintenanceMarginRate: .01, maintenanceAmount: 10000 }] }));
  app.get('/api/v1/market/universe', json({ available: true, value: { instruments: rows.map(r => ({ ...r, status: 'Trading' })) } }));
  app.get('/api/v1/market/display', json(display({ version: 1, type: 'snapshot', epoch: 'local-proportions', revision: 1, status: 'live', rows })));
  app.get('/api/v1/market/display/futures-tickers', json(display({version:1,type:'snapshot',rows})));
  app.get('/api/v1/market/display/futures-book/:symbol', (q, r) => r.json(display(book(q.params.symbol))));
  app.get(['/api/v1/market/display/spot-book/:symbol', '/api/v1/market/futures/orderbook/:symbol', '/api/v1/market/external/orderbook/:symbol'], (q, r) => r.json(display(book(q.params.symbol))));
  app.get(['/api/v1/market/display/futures-trades/:symbol', '/api/v1/market/external/trades/:symbol'], (q, r) => r.json(display({ symbol: q.params.symbol, trades: [{ id: 'fixture-trade', price: String(price(q.params.symbol)), quantity: '.013', side: 'BUY', time: NOW, timestamp: NOW }] })));
  const spotSnapshot = { tickers: { available: true, source: 'local-fixture', fetchedAt: NOW, stale: false, value: rows }, overview: { available: false }, sentiment: { available: false } };
  app.get(['/api/v1/market/snapshot', '/api/v1/market/display/spot-snapshot'], json(display(spotSnapshot)));
  app.get('/api/v1/market/futures/candles/:symbol', (q, r) => r.json({ retCode: 0, result: { category: 'linear', symbol: key(q.params.symbol), list: candles(q.params.symbol, q.query.interval).map(c => [String(c.time * 1000), String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume)]) } }));
  app.get('/api/v1/market/external/candles/:symbol', (q, r) => r.json({ pair: q.params.symbol.replace('-', '/'), interval: q.query.interval || '1h', candles: candles(q.params.symbol, q.query.interval) }));
  app.get('/api/v1/futures/mark-price/:symbol', (q, r) => r.json({ symbol: key(q.params.symbol), markPrice: String(price(q.params.symbol)), indexPrice: String(price(q.params.symbol)) }));
  app.get('/api/v1/futures/positions', (q, r) => r.json(q.qaState === 'filled' ? POSITIONS : []));
  app.get(['/api/v1/futures/positions/history', '/api/v1/futures/orders/me', '/api/v1/orders', '/api/v1/orders/me', '/api/v1/deposit-chains', '/api/v1/wallet/history'], json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], json([{ asset: 'USDT', available: '56381922.68', locked: '23101.35', balance: '56405024.03' }, { asset: 'BTC', available: '1.25', locked: '0' }]));
  app.get('/api/v1/market/external/rankings', json({ source: 'local-fixture', rankings: SYMBOLS.map((pair, i) => ({ symbol: pair.split('/')[0], name: i === 0 ? 'Bitcoin' : i === 1 ? 'Ethereum' : 'Pepe Token Perpetual Long Name', rank: i + 1, price: price(pair), categories:[], marketCap: 1600000000000/(i+1), volume24h:1555469980.54, image:`/__qa/icon/${pair.split('/')[0]}`, changePercent24h: 1.25, changePercent7d: 2.5, changePercent30d:3.5, sparkline: [1, 1.1, 1.2] })) }));
  app.get(['/api/v1/market/test-assets', '/api/v1/market/nrx', '/api/v1/market/listings'], json({ serverTime: NOW, assets: [] }));
  app.get('/__qa/icon/:symbol', (q,r) => r.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#f7931a"/><text x="16" y="23" fill="white" font-size="22" font-family="Arial" text-anchor="middle">${q.params.symbol==='BTC'?'₿':q.params.symbol[0]}</text></svg>`));
  app.get('/api/v1/market/assets/icons', (q, r) => r.json({ assets: Object.fromEntries(String(q.query.symbols || '').split(',').map(s => [s, { id: 'fixture:' + s, name: s === 'BTC' ? 'Bitcoin' : s === 'ETH' ? 'Ethereum' : 'Pepe Token Perpetual Long Name', logoUrl: `/__qa/icon/${s}` }])) }));
  app.get('/api/v1/support/conversations/mine', json({ conversation: null, messages: [] }));
  app.all('/api/*', (q, r) => r.status(404).json({ error: 'Outside fixture scope', path: q.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.type('html').send(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('<head>', '<head><script src="/__qa/bootstrap.js"></script>')));
  return app.listen(PORT, '127.0.0.1');
}

const measure = page => page.evaluate(() => {
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2), font: s.fontSize, weight: s.fontWeight, color: s.color, background: s.backgroundColor, padding: s.padding, gap: s.gap, overflowX: s.overflowX, transform: s.transform, margin: s.margin, tabular: s.fontVariantNumeric }; };
  const one = s => rect(document.querySelector(s));
  const all = s => [...document.querySelectorAll(s)].map(rect);
  const contents=el=>{
    const parts=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);parts.push(...range.getClientRects());}
    for(const icon of el.querySelectorAll('svg'))parts.push(icon.getBoundingClientRect());
    const visible=parts.filter(r=>r.width>0&&r.height>0);
    return {contentX:visible.length?Math.min(...visible.map(r=>r.x)):null,contentRight:visible.length?Math.max(...visible.map(r=>r.right)):null};
  };
  return {
    ticker: one('.futures-ticker-bar, .ticker-bar'), chart: one('.chart-area'), book: one('.orderbook-area'), form: one('.order-form-area'),
    toolbar: one('.chart-toolbar'), grid: one('.main-grid'), bottom: one('.bottom-panel'), pair: one('.pair-name'), price: one('.futures-primary-price .value'),
    pairSelector:one('.futures-ticker-bar .pair-selector'),primaryPrice:one('.futures-primary-price'),
    tickerScroll: (() => { const el = document.querySelector('.futures-ticker-bar'); return el ? { scroll: el.scrollWidth, client: el.clientWidth, groups: [...el.children].map(rect) } : null; })(),
    toolbarChildren: all('.chart-toolbar > *'),
    labels: all('.futures-ticker-bar .ticker-item > .label'), statistics: all('.futures-ticker-bar .ticker-item > .value'), selectors: all('.fo-mlTrigger'),
    tickerMetrics: all('.futures-ticker-bar .ticker-item'),
    tickerStats:[...document.querySelectorAll('.futures-ticker-bar .ticker-item:not(.futures-primary-price)')].map(el=>({text:el.textContent.trim(),...rect(el),...contents(el)})),
    tickerText: [...document.querySelectorAll('.futures-ticker-bar .ticker-item > .label,.futures-ticker-bar .ticker-item > .value')].map(el=>({text:el.textContent,scroll:el.scrollWidth,client:el.clientWidth,...rect(el)})),
    fields: all('.fo-priceInputRow, .fo-qtyInputRow'), inputs: all('.fo-priceInputRow input, .fo-qtyInputRow input'),
    infoRows: all('.fo-infoBox > .fo-infoRow'), options: one('.fo-optionsRow'), tabs: all('.order-family-tabs button'),
    bookHeader: one('.rb-tabs'), bookRows: all('.rb-row:not(.is-placeholder)').slice(0, 3),
    funding: all('.futures-funding-values > *'), positions: all('.futures-positions-table tbody tr'),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    formScrollX: (() => { const f = document.querySelector('.order-form-area'); return f ? Math.max(0, f.scrollWidth - f.clientWidth) : 0; })(),
    sheetCount: document.styleSheets.length, stylesheets: [...document.styleSheets].map(s => s.href || 'inline'),
    calculators: [...document.querySelectorAll('[data-open-calculator]')].map(el => ({ ...rect(el), title: el.title, name: el.getAttribute('aria-label'), text: el.textContent.trim() })),
    header: {
      bar:one('.global-header'),brand:one('.header-brand'),nav:one('.main-nav'),account:one('.header-actions'),
      items:[...document.querySelectorAll('.main-nav > *')].map(el=>({text:el.textContent.trim(),...rect(el),...contents(el)})).filter(x=>x.width>0&&x.height>0&&x.contentX!==null),
      labels:[...document.querySelectorAll('.main-nav .top-nav-link')].map(el=>({text:el.textContent.trim(),scroll:el.scrollWidth,client:el.clientWidth,...rect(el)})).filter(x=>x.width>0&&x.height>0),
    },
  };
});
async function showTrade(page, mobile) { if (mobile) { await page.locator('#mobile-futures-trade').click(); await page.waitForTimeout(150); } }
async function captures(page, name, mobile) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), animations: 'disabled' });
  for (const [part, selector] of [['header','.global-header'],['ticker', '.futures-ticker-bar'], ['toolbar', '.chart-toolbar'], ['form', '.order-form-area']]) {
    if (part === 'form') await showTrade(page, mobile);
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) await el.screenshot({ path: path.join(OUT, `${name}-${part}.png`), animations: 'disabled' });
  }
  if(mobile)await page.screenshot({path:path.join(OUT,`${name}-form-viewport.png`),animations:'disabled'});
}
async function headerMenus(page,width,item,report){
  item.headerMenus=[];
  const candidates=page.locator('.main-nav > .header-disclosure,.main-nav > .nav-item-wrap');
  for(let i=0;i<await candidates.count();i++){
    const target=candidates.nth(i); const bounds=await target.boundingBox();
    if(!bounds||bounds.width===0||bounds.height===0)continue;
    const anchor=target.locator('a.top-nav-link').first();
    if(!await anchor.isVisible())continue;
    await anchor.hover();
    const panel=target.locator('.header-disclosure-panel,.nav-dropdown').first();
    await panel.waitFor({state:'visible'});
    const b=await panel.boundingBox();
    item.headerMenus.push({label:await anchor.textContent(),box:b});
    if(PHASE==='after'&&(b.x<0||b.x+b.width>width+1||b.y<0||b.y+b.height>(await page.viewportSize()).height+1))report.violations.push(`${width}: header menu outside viewport`);
    await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-header-menu-${i}.png`),animations:'disabled'});
    await page.mouse.move(width-10,70);await page.waitForTimeout(270);
  }
}
async function interactions(page, width, report) {
  const check = (ok, why) => { if (!ok) report.violations.push(`${width}: ${why}`); };
  const record = { dropdowns: [], inputs: {}, chart: {} };
  report.interactions[width] = record;
  const initialCanvases = await page.locator('.chart-area canvas').elementHandles();
  const requestsBefore = hits.filter(x => x.path.startsWith('/api/')).length;
  for (let i = 0; i < 2; i++) {
    const trigger = page.locator('.fo-mlTrigger').nth(i);
    await trigger.click();
    const dialog = page.locator('.fo-mlPopover');
    await dialog.waitFor();
    const b = await dialog.boundingBox(); record.dropdowns.push(b);
    check(b.x >= 0 && b.x + b.width <= width + 1, 'margin/leverage popup clipped horizontally');
    await page.screenshot({ path:path.join(OUT,`${PHASE}-${width}-selector-${i}.png`),animations:'disabled' });
    await page.keyboard.press('Escape');
    if (await dialog.isVisible()) await trigger.click();
  }
  const settings = page.locator('.chart-settings-trigger');
  if (await settings.isVisible()) {
    await settings.click();
    await page.waitForTimeout(100);
    const dialog = page.locator('[role="dialog"]').last();
    record.chart.settings = await dialog.isVisible();
    check(record.chart.settings,'chart settings open');
    await page.keyboard.press('Escape');
  }
  record.chart.canvasIdentityPreserved = await Promise.all(initialCanvases.map(h => h.evaluate(el => el.isConnected))).then(x => x.every(Boolean));
  check(record.chart.canvasIdentityPreserved,'presentation controls remount chart');
  record.chart.passiveRequests = hits.filter(x => x.path.startsWith('/api/')).length - requestsBefore;
  check(record.chart.passiveRequests === 0,'opening presentation controls adds API calls');
  await page.locator('.fo-mlTrigger').first().click();await page.locator('.fo-mlMode').first().click();
  record.isolated=await page.locator('.fo-mlTriggerText').evaluate(el=>({text:el.textContent,scroll:el.scrollWidth,client:el.clientWidth}));
  if(PHASE==='after')check(record.isolated.scroll<=record.isolated.client,'ISOLATED text clipped');
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-isolated.png`),animations:'disabled'});
  await page.locator('.fo-mlTrigger').first().click();await page.locator('.fo-mlMode').nth(1).click();
  for (const [name,selector,value] of [['price','.fo-priceInputRow input','123456789.12345678'],['quantity','.fo-qtyInputRow input','0.00000001']]) {
    const input = page.locator(selector); await input.fill(value); await input.focus();
    record.inputs[name] = {value:await input.inputValue(),focused:await input.evaluate(el=>el===document.activeElement),box:await input.boundingBox()};
    check(record.inputs[name].value===value&&record.inputs[name].focused,`${name} input/focus lost`);
    await page.keyboard.press('Tab');
  }
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-input-long.png`),animations:'disabled'});
  await page.locator('.fo-priceInputRow input').fill('85421.3'); await page.locator('.fo-qtyInputRow input').fill('0.012');
  const tp = page.locator('[data-entry-protection-toggle]'); await tp.check();
  check(await page.locator('[data-entry-take-profit]').isVisible(),'TP/SL fields do not expand');
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-tpsl.png`),animations:'disabled'});
  await tp.uncheck();
  for (let i=1;i<4;i++) {await page.locator('.order-family-tabs button').nth(i).click();check(await page.locator('.order-family-tabs button').nth(i).evaluate(el=>el.classList.contains('active')),'order tab failed '+i);}
  await page.locator('.order-family-tabs button').first().click();
  const calculator=page.locator('.archive-calculator-trigger[data-open-calculator="true"]'); await calculator.click();
  record.calculator=await page.locator('.futures-calculator, .fc-dialog, [role=dialog][aria-label*="алькулятор"]').count()>0;
  check(record.calculator,'calculator does not open'); await page.keyboard.press('Escape');
  if (await page.locator('.fc-overlay').isVisible().catch(()=>false)) await page.locator('.fc-overlay').click({position:{x:5,y:5}});
  // Use the actual SPA links, not full navigations, to expose CSS import-order effects.
  await page.locator('a[href="/wallet"]').filter({visible:true}).first().click();
  await page.waitForURL('**/wallet'); await page.waitForTimeout(200);
  await page.locator('a[href="/futures"]').filter({visible:true}).first().click();
  await page.locator('.futures-ticker-bar').waitFor();
  await page.locator('.header-brand').click(); await page.waitForURL('**/trade');
  await page.locator('a[href="/futures"]').filter({visible:true}).first().click();
  await page.locator('.futures-ticker-bar').waitFor(); await page.waitForTimeout(150);
  record.navigation = await measure(page); check(record.navigation.overflowX===0,'Wallet/Futures/Spot/Futures overflow');
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-navigation.png`),animations:'disabled'});
  // Existing drawing serialization is fed back through the real app loader.
  await page.evaluate(time => localStorage.setItem('voltex.drawings.futures.BTC/USDT',JSON.stringify({version:1,hidden:false,locked:false,drawings:[{kind:'horizontal',points:[{time,price:84750}],style:{color:'#ffffff',width:1,dash:'solid'}}]})),NOW/1000-7200);
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.futures-ticker-bar').waitFor(); await page.waitForTimeout(400);
  await page.locator('.chart-tabs button').filter({hasText:/^4h$/}).click();
  record.chart.timeframe=await page.locator('.chart-tabs button.active').textContent();
  record.chart.drawings=await page.evaluate(()=>JSON.parse(localStorage.getItem('voltex.drawings.futures.BTC/USDT')).drawings);
  check(record.chart.timeframe==='4h'&&record.chart.drawings.length===1,'timeframe change loses stored drawing');
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-drawing.png`),animations:'disabled'});
  await page.goto(`http://127.0.0.1:${PORT}/futures?pair=1000PEPE%2FUSDT`,{waitUntil:'domcontentloaded'});
  await page.locator('.pair-name').filter({hasText:'1000PEPE'}).waitFor();await page.waitForTimeout(300);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.pair-name').filter({hasText:'1000PEPE'}).waitFor();await page.waitForTimeout(300);
  record.instrument={text:await page.locator('.futures-ticker-bar .pair-name').textContent(),geometry:await measure(page)};
  check(record.instrument.text.includes('1000PEPE')&&record.instrument.geometry.overflowX===0,'long instrument persistence/overflow');
  await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-tiny-price-long-pair.png`),animations:'disabled'});
}
async function stateChecks(browser, report) {
  for (const stateName of ['filled','loading','error']) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${PORT}`?route.continue():route.abort());
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.addCookies([{name:'qa_state',value:stateName,url:`http://127.0.0.1:${PORT}`}]);
    const page=await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/futures?pair=BTC%2FUSDT`,{waitUntil:'domcontentloaded'});
    await page.locator('.futures-ticker-bar').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);
    await page.locator('.rb-row:not(.is-placeholder)').first().waitFor({state:'attached',timeout:5000});
    const result=await measure(page);result.balance=await page.locator('.fo-availValue').textContent();result.submitDisabled=await page.locator('.fo-submitPair button').first().isDisabled();
    await page.screenshot({path:path.join(OUT,`${PHASE}-1440-${stateName}.png`),animations:'disabled'});
    report[stateName]=result;
    if(result.overflowX)report.violations.push(`${stateName}: document overflow`);
    if(stateName==='filled'&&result.positions.length!==3)report.violations.push('filled: expected three positions');
    if(stateName!=='filled'&&(!result.submitDisabled||/[0-9]/.test(result.balance)))report.violations.push(`${stateName}: unknown balance not locked/unknown`);
    await context.close();
  }
}
async function run() {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const report = { phase: PHASE, fixedTime: NOW, dist: DIST, cases: [], violations: [], interactions: {} };
  const baselinePath=path.join(OUT,'before-report.json');
  const baseline=PHASE==='after'&&fs.existsSync(baselinePath)?JSON.parse(fs.readFileSync(baselinePath,'utf8')):null;
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 1920 ? 1080 : width === 1366 ? 768 : 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const external = [], pageErrors = [];
      await context.route('**/*', route => { if (new URL(route.request().url()).origin === `http://127.0.0.1:${PORT}`) return route.continue(); external.push(route.request().url()); return route.abort(); });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/futures?pair=BTC%2FUSDT`, { waitUntil: 'domcontentloaded' });
      await page.locator('.futures-ticker-bar').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1100);
      const initial = await measure(page);
      await captures(page, `${PHASE}-${width}`, width === 390);
      const ticket = await measure(page);
      const item = { width, initial, ticket, pageErrors, blockedExternal: external.length };
      const stats=initial.tickerStats.filter(x=>x.width>0).sort((a,b)=>a.y-b.y||a.x-b.x);
      item.tickerGaps=stats.slice(1).flatMap((x,i)=>Math.abs(x.y-stats[i].y)<1?[{left:stats[i].text,right:x.text,gap:+(x.x-stats[i].right).toFixed(2),contentGap:+(x.contentX-stats[i].contentRight).toFixed(2)}]:[]);
      report.cases.push(item);
      const check = (ok, why) => { if (!ok) report.violations.push(`${width}: ${why}`); };
      check(initial.overflowX === 0, 'document horizontal overflow'); check(ticket.formScrollX === 0, 'ticket horizontal overflow'); check(pageErrors.length === 0, 'page errors: ' + pageErrors.join('; '));
      if (PHASE === 'after' && width > 900) {
        check(ticket.form.width >= 300 && ticket.form.width <= 310, 'ticket width outside300–310');
        check(initial.ticker.x === initial.chart.x && Math.abs(initial.ticker.right - initial.book.right) <= 1, 'ticker grid bounds');
        check(initial.ticker.bottom <= Math.min(initial.chart.y, initial.book.y) + 1, 'ticker overlaps chart/book');
        check(initial.toolbar.height >= 40 && initial.toolbar.height <= 44, 'toolbar height outside40–44');
        check(ticket.selectors.every(s => s.height >= 34 && s.height <= 36), 'selector height outside34–36');
        check(ticket.fields.every(s => s.height >= 42 && s.height <= 46), 'field height outside42–46');
        check(ticket.fields.length === 2 && Math.abs(ticket.fields[0].x - ticket.fields[1].x) <= 1 && Math.abs(ticket.fields[0].right - ticket.fields[1].right) <= 1, 'price/quantity edges');
        check(ticket.calculators.length === 1 && ticket.calculators[0].name && ticket.calculators[0].title, 'single accessible calculator');
        check(initial.tickerScroll.scroll<=initial.tickerScroll.client+1,'ticker statistics clipped/requires horizontal scroll');
        check(initial.tickerMetrics.every(x=>x.width===0||(x.x>=initial.ticker.x-1&&x.right<=initial.ticker.right+1&&x.y>=initial.ticker.y-1&&x.bottom<=initial.ticker.bottom+1)),'ticker metric outside visible strip');
        check(initial.tickerText.every(x=>x.width===0||x.scroll<=x.client+1),'ticker text clipped');
        if(MIN_TICKER_GAP){
          const minimum=width>=1600?Math.max(28,MIN_TICKER_GAP):MIN_TICKER_GAP;
          check(item.tickerGaps.every(x=>x.contentGap>=minimum),'ticker statistics content spacing below requested minimum');
          if(width>=1600)check(Math.max(...item.tickerGaps.map(x=>x.gap))-Math.min(...item.tickerGaps.map(x=>x.gap))<=1,'desktop statistics spacing is uneven');
          const previous=baseline?.cases.find(c=>c.width===width)?.initial;
          if(previous){
            item.stableInstrument={};
            for(const part of ['pairSelector','primaryPrice']){
              item.stableInstrument[part]=['x','y','width','height'].every(k=>Math.abs(initial[part][k]-previous[part][k])<=1);
              check(item.stableInstrument[part],`${part} moved or resized`);
            }
          }
        }
        check(initial.toolbarChildren.filter(x=>x.width>0).every(x=>x.x>=initial.toolbar.x-1&&x.right<=initial.toolbar.right+1),'toolbar controls extend into book');
      }
      const header=initial.header;
      item.headerGaps=header.items.slice(1).map((x,i)=>({left:header.items[i].text,right:x.text,gap:+(x.contentX-header.items[i].contentRight).toFixed(2)}));
      if(PHASE==='after'&&width>=1440){
        check(header.nav.width>0,'desktop main navigation hidden');
        check(header.nav.right<=header.account.x,'navigation/account overlap');
        check(header.items.every(x=>x.contentRight<=header.account.x-1),'navigation content/account overlap');
        check(header.labels.every(x=>x.scroll<=x.client+1&&x.x>=header.nav.x-1&&x.right<=header.nav.right+1),'header label clipped');
        check(item.headerGaps.every(x=>x.gap>=12),'header adjacent item gap below12px');
      }
      if(width>=1440&&!args.includes('--quick'))await headerMenus(page,width,item,report);
      if(width===1440&&!args.includes('--quick')) await interactions(page,width,report);
      if(width===390){
        await page.locator('.futures-mobile-stats-toggle').click();
        item.mobileExpanded=await measure(page);
        check(await page.locator('.futures-mobile-stats-toggle').getAttribute('aria-expanded')==='true','mobile ticker details not expanded');
        check(item.mobileExpanded.overflowX===0,'mobile expanded ticker overflow');
        await page.screenshot({path:path.join(OUT,`${PHASE}-390-ticker-expanded.png`),animations:'disabled'});
        await page.locator('.futures-mobile-stats-toggle').click();
        await page.locator('#mobile-futures-chart').click();
        await page.locator('.futures-mobile-chart-tabs button').nth(1).click();await page.waitForTimeout(100);
        check(await page.locator('.orderbook-area').isVisible(),'mobile Book workspace missing');
        await page.screenshot({path:path.join(OUT,`${PHASE}-390-book.png`),animations:'disabled'});
        await page.locator('#mobile-futures-positions').click();await page.waitForTimeout(100);
        check(await page.locator('.bottom-panel').isVisible(),'mobile Positions workspace missing');
        await page.screenshot({path:path.join(OUT,`${PHASE}-390-positions.png`),animations:'disabled'});
      }
      // The real Spot route is rendered at every matching viewport.
      await page.goto(`http://127.0.0.1:${PORT}/trade?pair=BTC%2FUSDT`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1100); await page.evaluate(() => document.fonts.ready);
      item.spot = await measure(page);
      await page.screenshot({ path: path.join(OUT, `${PHASE}-${width}-spot.png`), animations: 'disabled' });
      const bodyTop=Math.ceil(item.spot.header.bar.bottom),viewport=page.viewportSize();
      await page.screenshot({path:path.join(OUT,`${PHASE}-${width}-spot-body.png`),animations:'disabled',clip:{x:0,y:bodyTop,width:viewport.width,height:viewport.height-bodyTop}});
      check(item.spot.overflowX === 0, 'Spot horizontal overflow');
      await context.close();
    }
    if(!args.includes('--quick')) await stateChecks(browser,report);
  } finally { await browser.close(); report.requests = hits; fs.writeFileSync(path.join(OUT, `${PHASE}-report.json`), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ phase: PHASE, cases: report.cases.length, violations: report.violations, report: path.join(OUT, `${PHASE}-report.json`) }, null, 2));
  if (PHASE === 'after') assert.deepEqual(report.violations, []);
}
const server = start();
if (args.includes('--serve')) console.log(`Read-only fixture preview: http://127.0.0.1:${PORT}/futures?pair=BTC%2FUSDT`);
else run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());
