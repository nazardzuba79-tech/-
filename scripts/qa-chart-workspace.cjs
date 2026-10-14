#!/usr/bin/env node
/**
 * CHART WORKSPACE 2.0 — browser QA on the real production bundle.
 *
 * Loopback-only Express fixture (read-only, no credentials, no providers,
 * no database, no financial writes) serving a deterministic OHLCV source
 * for every catalogue interval on Spot and Futures, then Chromium drives
 * the terminal through the workspace: timeframes (native and derived),
 * chart types, «Сравнить», «Данные», «Аналитика», the 1/2/4 layout,
 * «Шаблоны», «К дате», the snapshot, full screen, keyboard, menus inside
 * the viewport, the phone row and sheet, browser zoom, and the request /
 * socket / memory counters for scenarios A, B and C.
 *
 *   node scripts/qa-chart-workspace.cjs --dist frontend/dist --out docs/qa/chart-workspace --phase after
 *   node scripts/qa-chart-workspace.cjs --dist <main build> --phase before   (screenshots + geometry + perf A only)
 *   node scripts/qa-chart-workspace.cjs --serve                              (leave the fixture up for a look)
 *
 * Never bundled into the product. Exit code 1 when a check fails.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');

const args = process.argv.slice(2);
const arg = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs/qa/chart-workspace')));
const PHASE = arg('--phase', 'after');
const PORT = Number(arg('--port', '0'));
const ONLY = arg('--only', '').split(',').filter(Boolean);
const DESKTOP = arg('--widths', '1366,1440,1600,1707,1920').split(',').map(Number);
const PHONES = arg('--phones', '320,360,390,430,768').split(',').map(Number);
const SERVE = args.includes('--serve');
const PERF_WINDOW_MS = Number(arg('--perf-window', '15000'));

// ── Fixture data ──────────────────────────────────────────────────────────
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
const PRICES = { BTCUSDT: 85421.3, ETHUSDT: 3211.42, SOLUSDT: 178.44, XRPUSDT: 0.5312, DOGEUSDT: 0.1234, AITHUSDT: 21.93, NRXUSDT: 0.62, VTAUSDT: 10.1 };
const STEP = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200, '1d': 86400, '1w': 604800, '1M': 2592000 };
const BYBIT_CODES = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 720: '12h', D: '1d', W: '1w', M: '1M' };
const key = s => s.replace(/[-/]/g, '');
const price = s => PRICES[key(s)] || PRICES.BTCUSDT;
const hits = [];
const NOW_TICKER = Date.UTC(2026, 9, 13, 10, 0, 0);

/** Deterministic bars on a fixed grid: the same bucket always gets the same
 *  values, so a refresh, a derived build and a history page agree. */
function bucketStart(interval, seconds) {
  if (interval === '1w') return Math.floor((seconds - 4 * 86400) / 604800) * 604800 + 4 * 86400; // Monday
  if (interval === '1M') { const d = new Date(seconds * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; }
  return Math.floor(seconds / STEP[interval]) * STEP[interval];
}
function nextBucket(interval, start) {
  if (interval === '1M') { const d = new Date(start * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000; }
  return start + STEP[interval];
}
function previousBucket(interval, start) {
  if (interval === '1M') { const d = new Date(start * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / 1000; }
  return start - STEP[interval];
}
const phase = symbol => [...key(symbol)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 17;
function bar(symbol, interval, time) {
  const p = price(symbol), i = Math.floor(time / STEP[interval] || 1), k = phase(symbol);
  const drift = Math.sin(i / 9 + k) * 0.012 + Math.sin(i / 37 + k * 0.7) * (0.03 + k * 0.002) + Math.cos(i / 3.1 + k) * 0.004 + Math.sin(i / 120 + k) * 0.02 * (k % 3);
  const open = p * (0.97 + drift), close = open * (1 + Math.sin(i * 2.7) * 0.0025);
  return { time, open, high: Math.max(open, close) * (1 + 0.0009 + Math.abs(Math.sin(i)) * 0.0006), low: Math.min(open, close) * (1 - 0.0009 - Math.abs(Math.cos(i)) * 0.0006), close, volume: 5 + ((i * 7) % 23) };
}
function candles(symbol, interval, limit, endMs) {
  const step = STEP[interval];
  if (!step) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  let last = bucketStart(interval, endMs ? Math.min(nowSec, Math.floor(endMs / 1000)) : nowSec);
  if (endMs && nextBucket(interval, last) * 1000 > endMs) last = previousBucket(interval, last); // the page ends strictly before `end`
  const out = [];
  let t = last;
  for (let n = 0; n < Math.min(1000, Math.max(1, limit)); n += 1) { out.unshift(bar(symbol, interval, t)); t = previousBucket(interval, t); }
  return out;
}

const rows = SYMBOLS.map(pair => {
  const last = price(pair), base = pair.split('/')[0];
  return { id: 'linear_perpetual:' + key(pair), pair, symbol: pair, provider: 'bybit', providerSymbol: key(pair), marketType: 'linear_perpetual',
    baseAsset: base, quoteAsset: 'USDT', settleAsset: 'USDT', volumeAsset: base, turnoverAsset: 'USDT', lastPrice: last,
    bidPrice: last * 0.99999, askPrice: last * 1.00001, high24h: last * 1.025, low24h: last * 0.98, volume24h: 18235.5, quoteVolume24h: 1555469980.54,
    changePercent24h: 1.25, changePercent: 1.25, indexPrice: last * 1.00002, markPrice: last * 1.00001, fundingRate: 0.0001, openInterest: 126225.9959,
    openInterestValue: last * 126225.9959, fundingIntervalMinutes: 480, providerEventAt: NOW_TICKER, receivedAt: NOW_TICKER, fetchedAt: NOW_TICKER, stale: false, sequence: null };
});
const display = value => ({ ...value, _display: { mode: 'snapshot', capturedAt: NOW_TICKER, refreshMs: 60000 } });
function book(symbol) {
  const p = price(symbol), tick = p > 1000 ? 0.1 : p > 10 ? 0.01 : 0.0001;
  const levels = side => Array.from({ length: 35 }, (_, i) => ({ price: String(p + side * (i + 1) * tick), quantity: String(0.027 + (i % 9) * 0.048) }));
  return { available: true, symbol, pair: symbol.replace('-', '/'), timestamp: NOW_TICKER, fetchedAt: NOW_TICKER, providerTime: NOW_TICKER, updateId: 1, bids: levels(-1), asks: levels(1), stale: false };
}
// ── Test markets (VOLTEX simulated assets) ───────────────────────────────
// Mirrors what the market edge (AITH, NRX) and the API host (VTA) were verified
// to serve on 2026-10-14 (read-only probes): native 1m, 5m, 15m, 1h, 4h, 1d and
// a Monday-anchored 1w; HTTP 400 for any other code; at most 1000 bars; no bar
// before `listingAt`; 1m straight from ticks, the rest aggregated. AITH is a
// managed listing (~21 h of history, 2 → ~22 USDT, as in production on
// 2026-10-14), NRX and VTA listed weeks ago. Nothing here is production data.
const TEST_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const FIXTURE_NOW = Date.now();
const hourFloor = ms => Math.floor(ms / 3600000) * 3600000;
const TEST_ASSETS = {
  'AITH/USDT': { symbol: 'AITH', name: 'AITH', managed: true, tradable: false, version: 7, listingAt: hourFloor(FIXTURE_NOW) - 21 * 3600000, initialPrice: 2, lastPrice: 21.93, catalogue: 'listings' },
  'NRX/USDT': { symbol: 'NRX', name: 'NEURIX', managed: false, tradable: true, listingAt: Date.UTC(2026, 8, 20, 12), initialPrice: 0.1, lastPrice: 0.62, catalogue: 'nrx' },
  'VTA/USDT': { symbol: 'VTA', name: 'VOLTORA', managed: false, tradable: false, listingAt: Date.UTC(2026, 8, 28, 12), initialPrice: 0.01, lastPrice: 10.1, catalogue: 'test-assets' },
};
const testAssetBySlug = slug => { const pair = String(slug).toUpperCase().replace('-', '/'); return TEST_ASSETS[pair] ? { pair, asset: TEST_ASSETS[pair] } : null; };
/** One deterministic minute bar: a log ramp from the listing price to today's with bounded noise; the same minute always gets the same bar. */
function testBar1m(asset, timeSec) {
  const i = Math.floor((timeSec * 1000 - asset.listingAt) / 60000);
  const total = Math.max(1, Math.floor((FIXTURE_NOW - asset.listingAt) / 60000));
  const ramp = Math.min(1.2, i / total);
  const trend = asset.initialPrice * Math.pow(asset.lastPrice / asset.initialPrice, Math.pow(ramp, 0.7));
  const noise = 1 + Math.sin(i / 7) * 0.012 + Math.sin(i / 31 + 1) * 0.02 + Math.cos(i / 3.3) * 0.004;
  const open = trend * noise, close = open * (1 + Math.sin(i * 1.9) * 0.006);
  const high = Math.max(open, close) * (1 + 0.002 + Math.abs(Math.sin(i * 0.7)) * 0.003), low = Math.min(open, close) * (1 - 0.002 - Math.abs(Math.cos(i * 0.9)) * 0.003);
  return { time: timeSec, open, high, low, close, volume: 120 + ((i * 13) % 400) };
}
/** The server's candle list for an interval: the last `limit` buckets (≤ 1000), the first one cut at the listing, 1m from the ticks. */
function testCandles(asset, interval, limit) {
  const size = STEP[interval];
  const nowSec = Math.floor(Date.now() / 1000), listingSec = Math.floor(asset.listingAt / 1000);
  const count = Math.max(1, Math.min(1000, Math.floor(limit) || 300));
  const current = bucketStart(interval, nowSec);
  const from = Math.max(listingSec, current - (count - 1) * size);
  const buckets = new Map();
  for (let t = Math.ceil(from / 60) * 60; t <= nowSec; t += 60) {
    const bar = testBar1m(asset, t);
    const start = interval === '1m' ? t : bucketStart(interval, t);
    const b = buckets.get(start);
    if (!b) buckets.set(start, { time: start, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    else { b.high = Math.max(b.high, bar.high); b.low = Math.min(b.low, bar.low); b.close = bar.close; b.volume += bar.volume; }
  }
  return [...buckets.values()].filter(c => c.time >= current - (count - 1) * size).slice(-count);
}
const testAssetState = (asset, serverTime) => {
  const dayAgo = testCandles(asset, '1h', 24);
  const last = testBar1m(asset, Math.floor(serverTime / 60000) * 60).close;
  const open24 = dayAgo[0]?.open ?? asset.initialPrice;
  return { phase: 'live', lastPrice: last, openPrice24h: open24, change24hPercent: (last / open24 - 1) * 100, high24h: Math.max(...dayAgo.map(c => c.high), last), low24h: Math.min(...dayAgo.map(c => c.low), last), volume24h: dayAgo.reduce((s, c) => s + c.volume, 0), quoteVolume24h: dayAgo.reduce((s, c) => s + c.volume * c.close, 0), serverTime };
};
/** The public row of a test asset, in the shape lib/testMarkets parses (a live AITH lease every time it is read). */
const testAssetRow = (pair, asset, serverTime) => ({
  pair, symbol: asset.symbol, name: asset.name, quote: 'USDT', isTestAsset: true, isTradable: asset.tradable, status: asset.managed ? '' : 'TEST · NOT TRADABLE', listingArmed: true,
  listingAt: new Date(asset.listingAt).toISOString(), initialPrice: asset.initialPrice, state: testAssetState(asset, serverTime),
  ...(asset.managed ? { managed: true, version: asset.version, readLease: { protocol: 'aith-prelisting-v1', generation: asset.version, issuedAt: serverTime, expiresAt: serverTime + 45000 }, logo: null, displayTimeZone: 'UTC' } : {}),
});
const testCatalogue = catalogue => { const serverTime = Date.now(); return { serverTime, assets: Object.entries(TEST_ASSETS).filter(([, a]) => a.catalogue === catalogue).map(([pair, a]) => testAssetRow(pair, a, serverTime)) }; };

const CONTRACT = { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMarketOrderQty: '119', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1', riskTiers: [{ maxNotional: '2000000000', maintenanceRate: '.005', deduction: '0', maxLeverage: '100' }], takerFeeRate: '.00055', makerFeeRate: '.0002' };

const bootstrap = `(() => {
  if (location.hostname !== '127.0.0.1') throw new Error('Loopback only');
  localStorage.setItem('exchange_token','qa-chart-workspace'); localStorage.setItem('exchange_lang','ru');
  window.__qa = { fetches: [], sockets: 0, socketUrls: [] };
  const original = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
    window.__qa.fetches.push({ url: url.pathname + url.search, at: performance.now() });
    if (url.origin === 'https://market.voltextech.net') return original('/api/v1' + url.pathname + url.search, options);
    if (url.origin !== location.origin) return Promise.reject(new Error('External network blocked in fixture'));
    return original(input, options);
  };
  const books = ${JSON.stringify(Object.fromEntries(SYMBOLS.map(s => [key(s), book(key(s))])))};
  window.WebSocket = class extends EventTarget {
    static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3; readyState=0;
    constructor(url) { super(); this.url=String(url); window.__qa.sockets += 1; window.__qa.socketUrls.push(this.url); setTimeout(()=>{this.readyState=1; this.fire('open',new Event('open'));},0); }
    fire(type,e) {this['on'+type]?.(e);this.dispatchEvent(e);}
    send(raw) { let q; try { q = JSON.parse(raw); } catch { return; } for(const topic of q.args||[]) if(topic.startsWith('orderbook.')) { const symbol=topic.split('.').at(-1), b=books[symbol]; if(b) setTimeout(()=>this.fire('message',new MessageEvent('message',{data:JSON.stringify({topic,type:'snapshot',ts:Date.now(),data:{s:symbol,b:b.bids.map(r=>[r.price,r.quantity]),a:b.asks.map(r=>[r.price,r.quantity]),u:1,seq:1}})})),0); } }
    close() {this.readyState=3;}
  };
  window.EventSource = class { close(){} addEventListener(){} removeEventListener(){} };
})();`;

function start() {
  const app = express();
  app.use((q, r, next) => {
    hits.push({ method: q.method, path: q.path, query: q.query, at: Date.now() }); r.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(q.method)) return r.status(405).json({ error: 'Read-only presentation fixture' });
    next();
  });
  app.get('/__qa/bootstrap.js', (_q, r) => r.type('js').send(bootstrap));
  app.get('/__qa/hits', (_q, r) => r.json(hits));
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-chart', email: 'preview@localhost.invalid', role: 'USER', isAdmin: false, avatarUrl: null, createdAt: '2025-01-01T00:00:00Z', emailVerified: true, kycStatus: 'NONE' }));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false }));
  app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: SYMBOLS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 50,
    leverageTiers: [{ notionalCap: 2000000, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }, { notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 10000 }] }));
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: rows.map(x => ({ ...x, status: 'Trading' })) } }));
  app.get(['/api/v1/market/display', '/api/v1/market/display/futures-tickers'], (_q, r) => r.json(display({ version: 1, type: 'snapshot', epoch: 'local-chart-workspace', revision: 1, status: 'live', rows })));
  app.get('/api/v1/market/display/futures-book/:symbol', (q, r) => r.json(display(book(q.params.symbol))));
  app.get(['/api/v1/market/display/spot-book/:symbol', '/api/v1/market/futures/orderbook/:symbol', '/api/v1/market/external/orderbook/:symbol'], (q, r) => r.json(display(book(q.params.symbol))));
  app.get(['/api/v1/market/display/futures-trades/:symbol', '/api/v1/market/external/trades/:symbol'], (q, r) => r.json(display({ symbol: q.params.symbol, trades: [{ id: 'fixture-trade', price: String(price(q.params.symbol)), quantity: '.013', side: 'BUY', time: NOW_TICKER, timestamp: NOW_TICKER }] })));
  const spotSnapshot = { tickers: { available: true, source: 'local-fixture', fetchedAt: NOW_TICKER, stale: false, value: rows }, overview: { available: false }, sentiment: { available: false } };
  app.get(['/api/v1/market/snapshot', '/api/v1/market/display/spot-snapshot'], (_q, r) => r.json(display(spotSnapshot)));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ tickers: rows.map(x => ({ pair: x.pair, lastPrice: x.lastPrice, high24h: x.high24h, low24h: x.low24h, changePercent: 1.25, quoteVolume24h: x.quoteVolume24h, volume24h: x.volume24h })) }));
  app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ symbols: SYMBOLS }));
  app.get('/api/v1/market/pairs', (_q, r) => r.json(SYMBOLS.map(p => ({ pair: p, base: p.split('/')[0], quote: 'USDT' }))));
  app.get('/api/v1/orderbook/:a/:b', (q, r) => { const b = book(q.params.a + q.params.b); r.json({ bids: b.bids.map(l => [l.price, l.quantity]), asks: b.asks.map(l => [l.price, l.quantity]) }); });
  // Futures candles: the Bybit shape, every catalogue code, `endTime`/`end` paging.
  app.get('/api/v1/market/futures/candles/:symbol', (q, r) => {
    const interval = BYBIT_CODES[q.query.interval] || q.query.interval;
    const end = Number(q.query.endTime || q.query.end) || undefined;
    const list = candles(q.params.symbol, interval, Number(q.query.limit) || 300, end);
    if (!list) return r.status(400).json({ retCode: 10001, retMsg: 'interval unsupported by fixture' });
    r.json({ retCode: 0, result: { category: 'linear', symbol: key(q.params.symbol), list: list.map(c => [String(c.time * 1000), String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume)]) } });
  });
  app.get('/api/v1/market/display/futures-candles/:symbol', (q, r) => {
    const interval = BYBIT_CODES[q.query.interval] || q.query.interval;
    const list = candles(q.params.symbol, interval, Number(q.query.limit) || 300, Number(q.query.end) || undefined);
    if (!list) return r.status(400).json({ error: 'interval' });
    r.json({ retCode: 0, result: { category: 'linear', symbol: key(q.params.symbol), list: list.map(c => [String(c.time * 1000), String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume)]) } });
  });
  // Spot candles: the app shape; only the venue's native intervals exist here (the rest are derived by the client).
  app.get(['/api/v1/market/external/candles/:symbol', '/api/v1/market/display/spot-candles/:symbol'], (q, r) => {
    const interval = String(q.query.interval || '1h');
    if (!['1m', '5m', '15m', '1h', '4h', '1d', '1w'].includes(interval)) return r.status(400).json({ error: 'spot interval unsupported' });
    r.json({ pair: q.params.symbol.replace('-', '/'), interval, candles: candles(q.params.symbol, interval, Number(q.query.limit) || 300) });
  });
  app.get('/api/v1/futures/mark-price/:symbol', (q, r) => r.json({ symbol: key(q.params.symbol), markPrice: String(price(q.params.symbol)), indexPrice: String(price(q.params.symbol)) }));
  app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json({ history: [{ rate: '.0001', appliedAt: new Date(NOW_TICKER).toISOString() }] }));
  app.get('/api/v1/market/derivatives/:base', (q, r) => r.json({ available: true, source: 'fixture', fetchedAt: NOW_TICKER, stale: false, value: { baseAsset: q.params.base, turnover24hUsd: 1555469980.54, turnoverVenues: ['x'], openInterestBase: 126225.9959, openInterestBaseVenues: ['x'], openInterestUsd: 10781530063.57, openInterestUsdVenues: ['x'] } }));
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history', '/api/v1/futures/orders', '/api/v1/futures/orders/me', '/api/v1/orders', '/api/v1/orders/me', '/api/v1/orders/history', '/api/v1/deposit-chains', '/api/v1/wallet/history', '/api/v1/balances', '/api/v1/futures/balances'], (_q, r) => r.json([]));
  app.get('/api/v1/wallet/overview', (_q, r) => r.json({ balances: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 85421 }));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'local-fixture', rankings: SYMBOLS.map((pair, i) => ({ symbol: pair.split('/')[0], name: pair.split('/')[0], rank: i + 1, price: price(pair), categories: [], marketCap: 1.6e12 / (i + 1), volume24h: 1555469980.54, image: `/__qa/icon/${pair.split('/')[0]}`, changePercent24h: 1.25, changePercent7d: 2.5, changePercent30d: 3.5, sparkline: [1, 1.1, 1.2] })) }));
  // Test markets: the three catalogues (VTA on the API host, NRX and the managed listings on the market edge, which the bootstrap routes here) and their candles with the real interval limits.
  app.get('/api/v1/market/test-assets', (_q, r) => r.json(testCatalogue('test-assets')));
  app.get('/api/v1/market/nrx', (_q, r) => r.json(testCatalogue('nrx')));
  app.get('/api/v1/market/listings', (_q, r) => r.json(testCatalogue('listings')));
  app.get('/api/v1/market/test-assets/:slug/candles', (q, r) => {
    const found = testAssetBySlug(q.params.slug);
    if (!found) return r.status(404).json({ error: 'unknown_test_asset' });
    const interval = String(q.query.interval || '5m');
    // The edge answers `unsupported_interval`, the API host `Unsupported interval: <code>` (both verified 2026-10-14); the client reads neither.
    if (!TEST_INTERVALS.includes(interval)) return r.status(400).json({ error: found.asset.catalogue === 'test-assets' ? `Unsupported interval: ${interval}` : 'unsupported_interval' });
    r.json({ source: 'simulation', pair: found.pair, interval, isTestAsset: true, serverTime: Date.now(), candles: testCandles(found.asset, interval, Number(q.query.limit) || 300) });
  });
  app.get('/api/v1/market/test-assets/:slug', (q, r) => { const found = testAssetBySlug(q.params.slug); if (!found) return r.status(404).json({ error: 'unknown_test_asset' }); r.json(testAssetRow(found.pair, found.asset, Date.now())); });
  app.get('/__qa/test-assets', (_q, r) => r.json(Object.fromEntries(Object.entries(TEST_ASSETS).map(([pair, a]) => [pair, { listingAt: a.listingAt, bars: Object.fromEntries(TEST_INTERVALS.map(tf => [tf, testCandles(a, tf, 1000).length])) }]))));
  app.get('/__qa/icon/:symbol', (q, r) => r.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#f7931a"/><text x="16" y="23" fill="white" font-size="20" font-family="Arial" text-anchor="middle">${q.params.symbol[0]}</text></svg>`));
  app.get('/api/v1/market/assets/icons', (q, r) => r.json({ assets: Object.fromEntries(String(q.query.symbols || '').split(',').filter(Boolean).map(s => [s, { id: 'fixture:' + s, name: s, logoUrl: `/__qa/icon/${s}` }])) }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/private-trading/native/contracts/:symbol', (q, r) => r.json({ ...CONTRACT, symbol: q.params.symbol }));
  app.get('/api/v1/market/live', (_q, r) => { r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); r.write(': open\n\n'); });
  app.all('/api/*', (q, r) => r.status(404).json({ error: 'Outside fixture scope', path: q.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.type('html').send(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('<head>', '<head><script src="/__qa/bootstrap.js"></script>')));
  return app.listen(PORT, '127.0.0.1');
}

// ── Checks ────────────────────────────────────────────────────────────────
const report = { phase: PHASE, dist: DIST, startedAt: new Date().toISOString(), checks: [], perf: {}, screenshots: [], environment: 'LOCAL QA ONLY — production bundle, loopback read-only fixture' };
const check = (id, ok, detail) => { report.checks.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); return !!ok; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wants = id => !ONLY.length || ONLY.some(prefix => id.startsWith(prefix));

/** Candle geometry from the main pane's own pixels (no chart internals): the widest body on the
 *  middle rows, the lowest and highest painted candle rows, and — through the read-only handle the
 *  chart exposes for acceptance tooling — the prices at the pane's top and bottom edges. */
const GEOMETRY_PIXELS = () => {
  const canvases = [...document.querySelectorAll('.terminal-chart-shell canvas')].filter(c => c.width > 200 && c.height > 120);
  const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!canvas) return null;
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const isCandle = (r, g, b) => (g > 150 && r < 110 && b < 160) || (r > 200 && g < 120 && b < 140);
  const widest = (y) => { const row = ctx.getImageData(0, y, W, 1).data; let run = 0, best = 0, runs = 0; for (let x = 0; x < W; x += 1) { const i = x * 4; if (isCandle(row[i], row[i + 1], row[i + 2])) { run += 1; } else { if (run) { runs += 1; best = Math.max(best, run); } run = 0; } } if (run) { runs += 1; best = Math.max(best, run); } return { best, runs }; };
  const rows = [0.3, 0.45, 0.6].map(f => widest(Math.round(H * f)));
  let lowest = -1, highest = -1;
  for (let y = 0; y < H; y += 2) { const row = ctx.getImageData(0, y, W, 1).data; for (let x = 0; x < W; x += 3) { const i = x * 4; if (isCandle(row[i], row[i + 1], row[i + 2])) { if (highest < 0) highest = y; lowest = y; break; } } }
  const scale = window.devicePixelRatio || 1;
  const host = document.querySelector('[data-chart-state] > div');
  const api = host && host.__voltexChart;
  let prices = null;
  if (api && api.series && api.chart) { try { const h = api.chart.paneSize(0).height; prices = { top: api.series.coordinateToPrice(0), bottom: api.series.coordinateToPrice(h - 1), paneHeight: h, logical: api.chart.timeScale().getVisibleLogicalRange(), barSpacing: api.chart.timeScale().options().barSpacing }; } catch (e) { prices = { error: String(e).slice(0, 80) }; } }
  return { widthCss: Math.round(W / scale), heightCss: Math.round(H / scale), widestBodyPx: Math.round(Math.max(...rows.map(r => r.best)) / scale), bodiesOnRow: Math.max(...rows.map(r => r.runs)), lowestCandleRatio: lowest < 0 ? null : Number((lowest / H).toFixed(3)), highestCandleRatio: highest < 0 ? null : Number((highest / H).toFixed(3)), prices };
};
const geometryOf = page => page.evaluate(GEOMETRY_PIXELS);
/** The second pane's state, instrument, interval and — through its handle — the bars it holds. */
const PANE_STATE = () => {
  const pane = document.querySelector('[data-cw-pane]'); const host = pane?.querySelector('.cw-pane-chart'); const api = host && host.__voltexChart;
  let last = null, bars = 0;
  try { const data = api?.series?.data?.() || []; bars = data.length; last = data.length ? data[data.length - 1].close : null; } catch { /* no series yet */ }
  return { state: pane?.getAttribute('data-cw-pane-state') || null, source: pane?.getAttribute('data-cw-pane-source') || null, pair: pane?.querySelector('[data-cw-pane-symbol]')?.value || null, tf: pane?.querySelector('[data-cw-pane-timeframe]')?.value || null,
    shown: pane?.querySelector('[data-cw-pane-last]')?.textContent || null, stale: pane?.querySelector('[data-cw-pane-stale]')?.textContent || null, note: pane?.querySelector('.cw-pane-note')?.textContent || null, bars, last };
};
const GEOMETRY = () => {
  const vw = window.innerWidth, doc = document.scrollingElement || document.documentElement;
  const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const toolbar = document.querySelector('[data-cw-toolbar]') || document.querySelector('.chart-toolbar');
  const heading = document.querySelector('.terminal-chart-heading');
  const chart = document.querySelector('.terminal-chart-shell canvas, .chart-area canvas');
  const features = [...document.querySelectorAll('[data-cw-feature]')].map(el => ({ id: el.getAttribute('data-cw-feature'), ...rect(el), hidden: el.offsetParent === null }));
  const clipped = features.filter(f => !f.hidden && (f.x < 0 || f.x + f.w > vw + 1 || f.w < 8));
  return { vw, scrollWidth: doc.scrollWidth, overflow: doc.scrollWidth > vw + 1, toolbar: toolbar ? rect(toolbar) : null, heading: heading ? rect(heading) : null,
    views: document.querySelector('[data-cw-views]') ? rect(document.querySelector('[data-cw-views]')) : null,
    chart: chart ? rect(chart) : null, features: features.filter(f => !f.hidden).map(f => f.id), clipped: clipped.map(f => f.id),
    quick: [...document.querySelectorAll('[data-cw-tf]')].map(el => el.getAttribute('data-cw-tf')), chartState: document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') };
};
const menuBox = () => {
  const el = document.querySelector('[data-cw-menu], [data-cw-menu-layer] .cw-menu, [data-cw-menu-layer] .cw-sheet');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-cw-menu'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight,
    inside: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 };
};

/** The row is quiet: measured, and the same keys at the same place across two reads 150 ms apart.
 *  A layout change re-measures the row (the «Раскладка» badge changes, the row grows or shrinks), moving keys
 *  into «Ещё» or back; a click that lands while a key moves hits a detached element. */
async function settleToolbar(page, { timeout = 3000 } = {}) {
  const read = () => page.evaluate(() => {
    const row = document.querySelector('[data-cw-toolbar]');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { measured: row.classList.contains('is-measured'), menu: !!document.querySelector('[data-cw-menu]'),
      keys: [...row.querySelectorAll('[data-cw-feature]')].map(el => { const b = el.getBoundingClientRect(); return `${el.getAttribute('data-cw-feature')}@${Math.round(b.left)},${Math.round(b.top)}`; }).join('|'),
      box: `${Math.round(r.width)}x${Math.round(r.height)}` };
  });
  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    const now = await read();
    if (!now) return false;
    if (now.measured && previous && previous.keys === now.keys && previous.box === now.box) return true;
    previous = now;
    await page.waitForTimeout(150);
  }
  console.log(`  toolbar did not settle in ${timeout} ms: ${JSON.stringify(previous).slice(0, 300)}`);
  return false;
}

/** Open a feature from the row, or from «Ещё» when the row put it there (a menu body is inline in «Ещё»; an action is a list key).
 *  Menus are portaled, so the row key is looked up under the toolbar; every click is bounded and a key that moved
 *  under the pointer (the row re-measuring after a layout change) is retried from a quiet row. */
async function openFeatureOn(page, feature) {
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-cw-menu]'), null, { timeout: 1500 }).catch(() => {});
    await settleToolbar(page);
    const trigger = page.locator(`[data-cw-toolbar] [data-cw-feature="${feature}"]`).first();
    let action = false;
    try {
      if (!(await trigger.count()) || !(await trigger.isVisible())) {
        const more = page.locator('[data-cw-toolbar] [data-cw-feature="more"]');
        if (await more.count()) {
          await more.click({ timeout: 5000 }); await page.waitForTimeout(150);
          const item = page.locator(`[data-cw-menu="more"] [data-cw-feature="${feature}"]`).first();
          if (await item.count()) { await item.click({ timeout: 5000 }); action = true; }
        }
      } else { await trigger.click({ timeout: 5000 }); action = !(await trigger.getAttribute('aria-haspopup')); }
    } catch (error) {
      if (attempt === ATTEMPTS - 1) throw error;
      console.log(`  retry ${feature}: ${String(error.message || error).split('\n')[0].slice(0, 120)}`);
      await page.waitForTimeout(300);
      continue;
    }
    await page.waitForTimeout(220);
    const box = await page.evaluate(menuBox);
    // An action key (full screen) opens nothing; a menu key must — one retry covers a re-render closing it at once.
    if (box || action) return box;
    await page.waitForTimeout(300);
  }
  return page.evaluate(menuBox);
}

async function openTerminal(ctx, origin, market, { width, height, mobile, pair = 'BTC/USDT' }) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|External network/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  const t0 = Date.now();
  await page.goto(`${origin}${market === 'futures' ? '/futures' : '/trade'}?pair=${encodeURIComponent(pair)}`, { waitUntil: 'domcontentloaded' });
  if (mobile) {
    // The phone opens on the trading workspace; the chart is one tap away.
    const tab = page.locator(market === 'futures' ? '#mobile-futures-chart' : '#mobile-trade-chart');
    await tab.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 4; i += 1) {
      if (await tab.count()) await tab.first().click().catch(() => {});
      await page.waitForTimeout(250);
      if (await page.locator('.terminal[data-mobile-tab="chart"]').count()) break;
    }
  }
  let opened = null;
  try { await page.waitForSelector('[data-chart-state="candles"]', { timeout: 20000 }); opened = Date.now() - t0; } catch { /* reported by the caller */ }
  await page.waitForTimeout(600);
  return { page, errors, opened, width, height };
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start(); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (SERVE) { console.log(`Fixture: ${origin}/futures  ${origin}/trade  (Ctrl+C to stop)`); return new Promise(() => {}); }
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  const shot = async (page, name, clip) => { const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, clip, fullPage: false }); report.screenshots.push(path.basename(file)); return file; };
  const context = async (width, height, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', acceptDownloads: true, ...extra });
    await ctx.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(); });
    return ctx;
  };
  const chartClip = async (page, extra = 0) => page.evaluate(x => {
    const shell = document.querySelector('.terminal-chart-shell') || document.querySelector('.chart-area');
    const r = shell.getBoundingClientRect();
    return { x: Math.max(0, r.left - x), y: Math.max(0, r.top - x), width: Math.min(window.innerWidth, r.width + 2 * x), height: Math.min(window.innerHeight - Math.max(0, r.top - x), r.height + 2 * x) };
  }, extra);

  // ── Desktop: geometry + screenshots for every width, both markets ───────
  for (const width of DESKTOP) {
    for (const market of ['futures', 'spot']) {
      const id = `geometry.${market}.${width}`;
      if (!wants('geometry') && !wants(id)) continue;
      const ctx = await context(width, 900);
      const { page, errors, opened } = await openTerminal(ctx, origin, market, { width, height: 900 });
      const g = await page.evaluate(GEOMETRY);
      check(`${id}.loaded`, opened !== null && g.chartState === 'candles', { opened, chartState: g.chartState, errors });
      check(`${id}.no-overflow`, !g.overflow, { vw: g.vw, scrollWidth: g.scrollWidth });
      if (PHASE === 'after') {
        check(`${id}.two-rows`, g.toolbar && g.toolbar.h <= 46 && (!g.heading || g.heading.h <= 46), { toolbar: g.toolbar, heading: g.heading, views: g.views });
        check(`${id}.features-inside`, g.clipped.length === 0, { visible: g.features, clipped: g.clipped });
        // The full default list, or the measured row's reduced set (five, then three) when the strip had to shed — never a clipped one.
        const dense = await page.evaluate(() => document.querySelector('[data-cw-toolbar]')?.getAttribute('data-cw-dense'));
        const expected = dense === '2' ? '15m 1h 1d' : dense === '1' ? '1m 15m 1h 4h 1d' : '1m 5m 15m 1h 4h 1d 1w';
        check(`${id}.quick-timeframes`, g.quick.join(' ') === expected, { quick: g.quick, dense });
      }
      report.perf[`${id}.chart`] = g.chart;
      await shot(page, `${PHASE}-${market}-${width}`, await chartClip(page, 4));
      await shot(page, `${PHASE}-${market}-${width}-page`);
      await ctx.close();
    }
  }

  // ── AITH: a managed listing with ~21 h of history on the Spot desktop (the owner's screenshots, 2026-10-14) ──
  // Runs in both phases: `before` records the defects as shipped (1m shown unavailable, one weekly
  // candle stretched over the plot, a price scale below zero), `after` asserts the fixes.
  if (wants('aith')) {
    const ctx = await context(1440, 900);
    const { page, errors, opened } = await openTerminal(ctx, origin, 'spot', { width: 1440, height: 900, pair: 'AITH/USDT' });
    const P = 'aith.spot.1440';
    const fixtureBars = (await (await fetch(`${origin}/__qa/test-assets`)).json())['AITH/USDT'].bars;
    const candleRequests = () => page.evaluate(() => window.__qa.fetches.filter(f => /candles/.test(f.url)).map(f => f.url));
    const lastRequest = async () => { const list = await candleRequests(); const last = list.at(-1) || ''; const url = new URL(last, origin); return { path: url.pathname, interval: url.searchParams.get('interval'), limit: Number(url.searchParams.get('limit')) }; };
    check(`${P}.loaded`, opened !== null && /test-assets\/AITH-USDT\/candles/.test((await lastRequest()).path), { opened, errors: errors.slice(0, 4), last: await lastRequest(), fixtureBars });
    await shot(page, `${PHASE}-aith-1440`, await chartClip(page, 4));
    await shot(page, `${PHASE}-aith-1440-page`);
    // What the strip and the full menu offer, and what they show as unavailable.
    const strip = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf]')].map(el => ({ tf: el.getAttribute('data-cw-tf'), plan: el.getAttribute('data-cw-tf-plan'), off: el.getAttribute('aria-disabled') === 'true' })));
    await openFeatureOn(page, 'timeframes');
    const options = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf-option]')].map(el => ({ tf: el.getAttribute('data-cw-tf-option'), disabled: el.disabled, title: el.getAttribute('title') || '', hint: el.querySelector('.cw-item-hint')?.textContent || '' })));
    await shot(page, `${PHASE}-aith-1440-tf-menu`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    report.perf[`${P}.timeframes`] = { strip, options, unavailableOnStrip: strip.filter(x => x.off).map(x => x.tf), disabledInMenu: options.filter(o => o.disabled).map(o => o.tf) };
    if (PHASE === 'after') {
      check(`${P}.timeframes.nothing-disabled`, strip.length > 0 && strip.every(x => !x.off) && options.length === 13 && options.every(o => !o.disabled), report.perf[`${P}.timeframes`]);
      check(`${P}.timeframes.1m-native-3m-derived`, strip.find(x => x.tf === '1m')?.plan === 'native' && options.some(o => o.tf === '3m') && options.every(o => !o.hint), { strip, hints: options.filter(o => o.hint).map(o => o.tf) });
    } else console.log('BEFORE', P, 'unavailable on strip:', JSON.stringify(report.perf[`${P}.timeframes`].unavailableOnStrip), 'disabled in menu:', JSON.stringify(report.perf[`${P}.timeframes`].disabledInMenu));
    const geometry = () => geometryOf(page);
    for (const tf of ['1w', '1d', '1h', '5m', '1m']) {
      const before = (await candleRequests()).length;
      const key = page.locator(`[data-cw-tf="${tf}"]`);
      const onStrip = (await key.count()) > 0;
      const offStrip = onStrip && (await key.getAttribute('aria-disabled')) === 'true';
      if (offStrip) {
        // BEFORE only: the key is shown but refuses the click — recorded as the defect, then the menu path is tried.
        await openFeatureOn(page, 'timeframes');
        const option = page.locator(`[data-cw-tf-option="${tf}"]`);
        if (await option.isDisabled()) { await page.keyboard.press('Escape'); report.perf[`${P}.${tf}`] = { unavailable: true, bars: fixtureBars[tf] }; console.log('BEFORE', P, tf, 'unavailable on strip and in menu, bars in fixture:', fixtureBars[tf]); if (PHASE === 'after') check(`${P}.${tf}.native-request`, false, { unavailable: true }); continue; }
        await option.click();
      } else if (onStrip) await key.click(); else { await openFeatureOn(page, 'timeframes'); await page.locator(`[data-cw-tf-option="${tf}"]`).click(); }
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, before, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      const last = await lastRequest();
      const state = await page.getAttribute('[data-chart-state]', 'data-chart-state');
      const g = await geometry();
      report.perf[`${P}.${tf}`] = { request: last, state, bars: fixtureBars[tf], ...g };
      await shot(page, `${PHASE}-aith-1440-${tf}`, await chartClip(page, 4));
      if (PHASE === 'after') {
        check(`${P}.${tf}.native-request`, last.interval === tf && state === 'candles', { last, state });
        // A young asset's few bars are drawn at a readable width at the right of the plot — never one bar stretched over it.
        check(`${P}.${tf}.readable-bars`, g && g.widestBodyPx >= 2 && g.widestBodyPx <= 40, { widestBodyPx: g?.widestBodyPx, bodiesOnRow: g?.bodiesOnRow, bars: fixtureBars[tf] });
        // A positive-price chart never autoscales below zero.
        check(`${P}.${tf}.scale-non-negative`, g && g.prices && typeof g.prices.bottom === 'number' && g.prices.bottom >= 0 && g.prices.top > g.prices.bottom, g?.prices);
      } else console.log('BEFORE', P, tf, JSON.stringify({ request: last, state, bars: fixtureBars[tf], widestBodyPx: g?.widestBodyPx, lowestCandleRatio: g?.lowestCandleRatio }));
    }
    // The chart settings gear, the indicator legend's honest state (22 hourly bars under an SMA 200) and the derived month on 2 days of history.
    await page.locator('[data-cw-tf="1h"]').click(); await page.waitForTimeout(900);
    const extras = await page.evaluate(() => ({ gear: !!document.querySelector('.chart-settings-trigger'), legend: document.querySelector('.voltex-indicator-legend')?.textContent?.trim() || null, insufficient: document.querySelectorAll('[data-indicator-insufficient]').length }));
    report.perf[`${P}.extras`] = extras;
    if (PHASE === 'after') {
      check(`${P}.settings-gear`, extras.gear, extras);
      check(`${P}.indicator-insufficient-state`, extras.insufficient >= 1 && /200/.test(extras.legend || ''), extras);
      await openFeatureOn(page, 'timeframes');
      const monthBefore = (await candleRequests()).length;
      await page.locator('[data-cw-tf-option="1M"]').click();
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, monthBefore, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      const month = { last: await lastRequest(), state: await page.getAttribute('[data-chart-state]', 'data-chart-state'), g: await geometry(), partial: await page.evaluate(() => document.querySelector('[data-cw-tf-partial]')?.textContent || null) };
      check(`${P}.1M.derived-from-1d-forming`, month.last.interval === '1d' && month.state === 'candles' && month.g && month.g.widestBodyPx <= 40 && month.g.prices && month.g.prices.bottom >= 0, { last: month.last, state: month.state, widest: month.g?.widestBodyPx, prices: month.g?.prices, partial: month.partial });
      await shot(page, `${PHASE}-aith-1440-1M`, await chartClip(page, 4));
      await page.locator('[data-cw-tf="1h"]').click(); await page.waitForTimeout(600);
    } else console.log('BEFORE', P, 'extras', JSON.stringify(extras));
    // Compare with BTC and a second pane on BTC: both must read Spot's own source, never the listing's.
    await openFeatureOn(page, 'compare');
    await page.locator('[data-cw-compare-search]').fill('BTC'); await page.waitForTimeout(150);
    if (await page.locator('[data-cw-compare-option="BTC/USDT"]').count()) await page.locator('[data-cw-compare-option="BTC/USDT"]').first().click();
    await page.waitForFunction(() => /%|Не удалось|failed/i.test(document.querySelector('[data-cw-compare-entry="BTC/USDT"]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const compare = await page.evaluate(() => ({ entry: document.querySelector('[data-cw-compare-entry="BTC/USDT"]')?.textContent?.trim() || null, value: document.querySelector('[data-cw-compare-value="BTC/USDT"]')?.textContent || null, requests: window.__qa.fetches.filter(f => /candles/.test(f.url) && /BTC/.test(f.url)).map(f => f.url.split('?')[0]) }));
    await shot(page, `${PHASE}-aith-1440-compare`, await chartClip(page, 4));
    report.perf[`${P}.compare`] = compare;
    if (PHASE === 'after') check(`${P}.compare.btc-from-spot-source`, /%/.test(compare.value || '') && compare.requests.length > 0 && compare.requests.every(u => !/test-assets/.test(u)), compare);
    else console.log('BEFORE', P, 'compare', JSON.stringify(compare));
    await openFeatureOn(page, 'compare');
    if (await page.locator('[data-cw-compare-exit]').count()) await page.locator('[data-cw-compare-exit]').click();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await openFeatureOn(page, 'layout');
    await page.locator('[data-cw-layout-option="2"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-cw-pane]').length === 1 && ['ok', 'failed', 'empty', 'error'].includes(document.querySelector('[data-cw-pane]')?.getAttribute('data-cw-pane-state')), null, { timeout: 12000 }).catch(() => {});
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const pane = await page.evaluate(() => ({ state: document.querySelector('[data-cw-pane]')?.getAttribute('data-cw-pane-state') || null, pair: document.querySelector('[data-cw-pane] [data-cw-pane-symbol]')?.value || null, options: [...document.querySelectorAll('[data-cw-pane] [data-cw-pane-timeframe] option')].map(o => o.value), last: document.querySelector('[data-cw-pane-last]')?.textContent || null, requests: window.__qa.fetches.filter(f => /candles/.test(f.url) && !/AITH/.test(f.url)).map(f => f.url.split('?')[0]).slice(-3) }));
    await shot(page, `${PHASE}-aith-1440-layout2`, await chartClip(page, 4));
    report.perf[`${P}.pane`] = pane;
    if (PHASE === 'after') check(`${P}.layout.pane-own-source`, pane.state === 'ok' && pane.pair && !/AITH/.test(pane.pair) && pane.requests.length > 0 && pane.requests.every(u => !/test-assets/.test(u)), pane);
    else console.log('BEFORE', P, 'pane', JSON.stringify(pane));
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="1"]').click(); await page.keyboard.press('Escape');
    if (PHASE === 'after') {
      // Go to a date before the listing: an honest "not loaded", no request for bars that never existed.
      await openFeatureOn(page, 'goto');
      await page.locator('[data-cw-goto-input]').fill('2026-01-05T10:00');
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(900);
      const goto = await page.evaluate(() => ({ open: !!document.querySelector('[data-cw-goto]'), status: document.querySelector('[data-cw-goto] [role="status"]')?.textContent || null, paged: window.__qa.fetches.filter(f => /AITH-USDT\/candles/.test(f.url) && /end/.test(f.url)).length }));
      check(`${P}.goto.before-listing-honest`, goto.open && !!goto.status && goto.paged === 0, goto);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      // The data window and the analytics over 22 hourly bars: real rows, the whole short history.
      await page.locator('[data-cw-view="data"]').click(); await page.waitForTimeout(300);
      const box = await page.locator('.terminal-chart-shell canvas').first().boundingBox();
      for (let i = 0; i < 12; i += 1) await page.mouse.move(box.x + box.width * (0.66 + i * 0.02), box.y + box.height * 0.4);
      await page.waitForTimeout(400);
      const data = await page.evaluate(() => { const el = document.querySelector('[data-cw-data-window]'); return el ? { rows: el.querySelectorAll('dt').length, text: el.textContent.slice(0, 160) } : null; });
      check(`${P}.data.window`, !!data && data.rows >= 8, data);
      await shot(page, 'after-aith-1440-data', await chartClip(page, 4));
      await page.locator('[data-cw-view="analytics"]').click(); await page.waitForTimeout(400);
      await page.locator('[data-cw-analytics-period="all"]').click(); await page.waitForTimeout(300);
      const analytics = await page.evaluate(() => ({ blocks: document.querySelectorAll('[data-cw-analytics-block]').length, text: document.querySelector('[data-cw-analytics]')?.textContent?.slice(0, 260) }));
      check(`${P}.analytics.all-history`, analytics.blocks >= 2 && /2[012]/.test(analytics.text || ''), analytics);
      await shot(page, 'after-aith-1440-analytics', await chartClip(page, 4));
      await page.locator('[data-cw-view="chart"]').click(); await page.waitForTimeout(200);
      // The scalping template on a listing: 5m, with 1m and 3m on the row since the source serves them; digit 1 is 1m.
      await openFeatureOn(page, 'presets'); await page.locator('[data-cw-preset="builtin-scalping"]').click(); await page.waitForTimeout(900);
      const preset = await page.evaluate(() => ({ quick: [...document.querySelectorAll('[data-cw-tf]')].map(el => el.getAttribute('data-cw-tf')), pressed: document.querySelector('[data-cw-tf][aria-pressed="true"]')?.getAttribute('data-cw-tf'), state: document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') }));
      check(`${P}.presets.scalping-offers-1m-3m`, preset.pressed === '5m' && preset.quick.includes('1m') && preset.quick.includes('3m') && preset.state === 'candles', preset);
      await page.evaluate(() => document.body.focus()); await page.keyboard.press('1'); await page.waitForTimeout(800);
      const digit = await page.evaluate(() => ({ pressed: document.querySelector('[data-cw-tf][aria-pressed="true"]')?.getAttribute('data-cw-tf'), last: window.__qa.fetches.filter(f => /AITH-USDT\/candles/.test(f.url)).at(-1)?.url || '' }));
      check(`${P}.keyboard.digit-1-is-1m`, digit.pressed === '1m' && /interval=1m/.test(digit.last), digit);
      await openFeatureOn(page, 'presets'); await page.locator('[data-cw-preset-reset]').click(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
      // A snapshot of a short history is still a real PNG.
      await openFeatureOn(page, 'snapshot');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('[data-cw-snapshot-download]').click()]);
      let size = 0;
      if (download) { const file = path.join(OUT, 'snapshot-aith.png'); await download.saveAs(file); size = fs.statSync(file).size; report.screenshots.push('snapshot-aith.png'); }
      check(`${P}.snapshot.png`, !!download && size > 10000, { size });
      await page.keyboard.press('Escape');
    }
    check(`${P}.errors`, errors.filter(e => !/ResizeObserver/.test(e)).length === 0, errors.slice(0, 6));
    await ctx.close();
    if (PHASE === 'after') {
      // The phone: the strip's sheet offers the same intervals, none greyed, inside the screen.
      const mctx = await context(390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const m = await openTerminal(mctx, origin, 'spot', { width: 390, height: 844, mobile: true, pair: 'AITH/USDT' });
      await m.page.locator('[data-cw-feature="timeframes"]').click(); await m.page.waitForTimeout(400);
      const sheet = await m.page.evaluate(() => ({ options: [...document.querySelectorAll('[data-cw-tf-option]')].map(el => ({ tf: el.getAttribute('data-cw-tf-option'), disabled: el.disabled })), inside: (() => { const el = document.querySelector('[data-cw-menu]'); const r = el?.getBoundingClientRect(); return r ? r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1 : false; })() }));
      await shot(m.page, 'after-aith-mobile-390-tf-sheet');
      check('aith.mobile.390.sheet-nothing-disabled', m.opened !== null && sheet.options.length === 13 && sheet.options.every(o => !o.disabled) && sheet.inside, { opened: m.opened, disabled: sheet.options.filter(o => o.disabled).map(o => o.tf), count: sheet.options.length, inside: sheet.inside });
      await m.page.keyboard.press('Escape'); await m.page.waitForTimeout(200);
      await shot(m.page, 'after-aith-mobile-390');
      await mctx.close();
    }
  }

  // ── Every context offers exactly what its source serves: Futures BTC, Spot BTC, NRX, VTA ──
  if (PHASE === 'after' && wants('contexts')) {
    for (const [market, pair] of [['futures', 'BTC/USDT'], ['spot', 'BTC/USDT'], ['spot', 'NRX/USDT'], ['spot', 'VTA/USDT']]) {
      const ctx = await context(1440, 900);
      const { page, errors, opened } = await openTerminal(ctx, origin, market, { width: 1440, height: 900, pair });
      const id = `contexts.${market}.${pair.split('/')[0]}`;
      const strip = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf]')].map(el => ({ tf: el.getAttribute('data-cw-tf'), plan: el.getAttribute('data-cw-tf-plan'), off: el.getAttribute('aria-disabled') === 'true' || el.disabled })));
      await openFeatureOn(page, 'timeframes');
      const options = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf-option]')].map(el => { const tf = el.getAttribute('data-cw-tf-option'); return { tf, plan: el.getAttribute('data-cw-tf-plan'), disabled: el.disabled, star: !!document.querySelector(`[data-cw-tf-star="${tf}"]`)?.disabled }; }));
      await shot(page, `after-${market}-${pair.split('/')[0]}-tf-menu`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      report.perf[`${id}.timeframes`] = { native: options.filter(o => o.plan === 'native').map(o => o.tf), derived: options.filter(o => o.plan === 'derived').map(o => o.tf) };
      check(`${id}.nothing-disabled`, opened !== null && strip.length >= 3 && strip.every(x => !x.off) && options.length === 13 && options.every(o => !o.disabled && !o.star), { opened, strip: strip.map(x => `${x.tf}:${x.plan}`), options: options.map(o => `${o.tf}:${o.plan}${o.disabled ? '!' : ''}`), errors: errors.slice(0, 3) });
      if (pair === 'VTA/USDT') {
        // A thousandfold mover (0.01 → 10): the axis never goes below zero on the long intervals either.
        for (const tf of ['1d', '1w']) {
          await page.locator(`[data-cw-tf="${tf}"]`).click();
          await page.waitForFunction(t => (window.__qa.fetches.filter(f => /candles/.test(f.url)).at(-1) || { url: '' }).url.includes(`interval=${t}`), tf, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(900);
          const g = await geometryOf(page);
          check(`${id}.${tf}.scale-non-negative`, !!g && !!g.prices && typeof g.prices.bottom === 'number' && g.prices.bottom >= 0 && g.widestBodyPx >= 2 && g.widestBodyPx <= 40, { prices: g?.prices, widest: g?.widestBodyPx });
          await shot(page, `after-spot-VTA-${tf}`, await chartClip(page, 4));
        }
      }
      await ctx.close();
    }
  }

  // ── Second pane: its own source, cleared on change, late answers dropped, honest states ──
  if (PHASE === 'after' && wants('panes')) {
    const ctx = await context(1440, 900);
    const { page, errors } = await openTerminal(ctx, origin, 'spot', { width: 1440, height: 900 });
    const P = 'panes.spot.1440';
    const paneState = () => page.evaluate(PANE_STATE);
    const waitState = (wanted, timeout = 8000) => page.waitForFunction(w => document.querySelector('[data-cw-pane]')?.getAttribute('data-cw-pane-state') === w, wanted, { timeout }).catch(() => {});
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="2"]').click(); await page.keyboard.press('Escape');
    await waitState('ok', 12000);
    const initial = await paneState();
    check(`${P}.opens-on-another-instrument`, initial.state === 'ok' && !!initial.pair && initial.pair !== 'BTC/USDT' && initial.bars > 0, initial);
    // Out of order: SOL answers slowly, the listing fast; the pane must end on the listing and never paint SOL over it.
    await ctx.route('**/candles/SOL*', async route => { await sleep(2500); await route.continue(); });
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'SOL/USDT');
    await page.waitForTimeout(150);
    const mid = await paneState();
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'AITH/USDT');
    await waitState('ok');
    const quick = await paneState();
    await page.waitForTimeout(3200);
    const late = await paneState();
    await ctx.unroute('**/candles/SOL*');
    await shot(page, 'after-spot-1440-pane-aith', await chartClip(page, 4));
    check(`${P}.switch-clears-at-once`, mid.state === 'loading' && mid.bars === 0 && mid.shown === null, mid);
    check(`${P}.late-answer-dropped`, quick.pair === 'AITH/USDT' && quick.source === 'test-market' && quick.state === 'ok' && quick.last !== null && quick.last < 30 && late.pair === 'AITH/USDT' && late.last !== null && late.last < 30 && late.state === 'ok', { quick, late });
    // A failing source: the first request fails → an error with a retry; after the source is back the retry recovers.
    await ctx.route('**/candles/DOGE*', route => route.abort());
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'DOGE/USDT');
    await waitState('error');
    const failed = await paneState();
    await shot(page, 'after-spot-1440-pane-error', await chartClip(page, 4));
    await ctx.unroute('**/candles/DOGE*');
    if (await page.locator('[data-cw-pane-retry]').count()) await page.locator('[data-cw-pane-retry]').click();
    await waitState('ok');
    const recovered = await paneState();
    check(`${P}.error-then-retry`, failed.state === 'error' && failed.bars === 0 && recovered.state === 'ok' && recovered.bars > 0 && recovered.pair === 'DOGE/USDT', { failed, recovered });
    // A refresh that fails keeps the bars and dates them; it is never a blank or an error over good bars.
    await ctx.route('**/candles/DOGE*', route => route.abort());
    await waitState('stale', 16000);
    const stale = await paneState();
    await shot(page, 'after-spot-1440-pane-stale', await chartClip(page, 4));
    await ctx.unroute('**/candles/DOGE*');
    check(`${P}.refresh-failure-is-stale-not-blank`, stale.state === 'stale' && stale.bars > 0 && !!stale.stale, stale);
    // An empty answer is not a success: a listing whose source answers no bars shows "no history", not a chart of nothing.
    await ctx.route('**/test-assets/NRX-USDT/candles*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'simulation', pair: 'NRX/USDT', interval: '1h', isTestAsset: true, serverTime: Date.now(), candles: [] }) }));
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'NRX/USDT');
    await waitState('empty');
    const empty = await paneState();
    await ctx.unroute('**/test-assets/NRX-USDT/candles*');
    check(`${P}.empty-answer-is-not-success`, empty.state === 'empty' && empty.bars === 0 && !!empty.note, empty);
    check(`${P}.errors`, errors.filter(e => !/ResizeObserver|Failed to load resource|net::ERR/.test(e)).length === 0, errors.slice(0, 6));
    await ctx.close();
  }

  // ── The main chart is never remounted by a layout change; the ticket stays ──
  if (PHASE === 'after' && wants('keep')) {
    const ctx = await context(1440, 900);
    const { page } = await openTerminal(ctx, origin, 'futures', { width: 1440, height: 900 });
    const P = 'keep.futures.1440';
    const before = await page.evaluate(() => { const host = document.querySelector('[data-chart-state] > div'); host.dataset.qaMark = 'main'; host.__voltexChart.token = 'kept'; const form = document.querySelector('.order-form-area'); if (form) form.dataset.qaMark = 'form'; const range = host.__voltexChart.chart.timeScale().getVisibleLogicalRange(); return { from: Math.round(range.from), to: Math.round(range.to) }; });
    for (const value of [2, 4, 1]) { await openFeatureOn(page, 'layout'); await page.locator(`[data-cw-layout-option="${value}"]`).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(900); }
    const after = await page.evaluate(() => { const host = document.querySelector('[data-qa-mark="main"]'); const api = host && host.__voltexChart; const range = api?.chart.timeScale().getVisibleLogicalRange(); return { kept: !!host, token: api?.token || null, form: !!document.querySelector('[data-qa-mark="form"]'), from: range ? Math.round(range.from) : null, to: range ? Math.round(range.to) : null, panes: document.querySelectorAll('[data-cw-pane]').length }; });
    check(`${P}.main-chart-never-remounted`, after.kept && after.token === 'kept' && after.form && after.panes === 0 && Math.abs((after.to ?? -99) - before.to) <= 2, { before, after });
    await ctx.close();
  }

  // ── «Синхронизировать таймфрейм» moves every chart, both ways ──
  if (PHASE === 'after' && wants('synctf')) {
    const ctx = await context(1440, 900);
    const { page } = await openTerminal(ctx, origin, 'futures', { width: 1440, height: 900 });
    const P = 'synctf.futures.1440';
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('voltex.chartWorkspace.futures.v1') || 'null'));
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="2"]').click(); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-sync="timeframe"]').check(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-cw-pane]')?.getAttribute('data-cw-pane-state') === 'ok', null, { timeout: 12000 }).catch(() => {});
    await page.locator('[data-cw-tf="15m"]').click(); await page.waitForTimeout(800);
    const follows = await page.evaluate(() => document.querySelector('[data-cw-pane-timeframe]')?.value);
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-timeframe]', '4h'); await page.waitForTimeout(900);
    const leads = { main: (await store())?.timeframe, pressed: await page.getAttribute('[data-cw-tf="4h"]', 'aria-pressed') };
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-sync="timeframe"]').uncheck(); await page.keyboard.press('Escape');
    await page.selectOption('[data-cw-pane="1"] [data-cw-pane-timeframe]', '1h'); await page.waitForTimeout(700);
    const own = { main: (await store())?.timeframe, pane: (await store())?.panes?.[0]?.timeframe };
    check(`${P}.sync-timeframe-is-real`, follows === '15m' && leads.main === '4h' && leads.pressed === 'true' && own.main === '4h' && own.pane === '1h', { follows, leads, own });
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="1"]').click(); await page.keyboard.press('Escape');
    await ctx.close();
  }
  if (PHASE !== 'after') { await perf(browser, origin, context, chartClip, shot); await finish(browser, server); return; }

  // ── Interactions at 1440 (Futures and Spot) and 1920 (layout 4) ────────
  for (const market of ['futures', 'spot']) {
    const ctx = await context(1440, 900);
    const { page, errors } = await openTerminal(ctx, origin, market, { width: 1440, height: 900 });
    const P = `${market}.1440`;
    const candleRequests = () => page.evaluate(() => window.__qa.fetches.filter(f => /candles/.test(f.url)).map(f => f.url));
    const store = () => page.evaluate(m => JSON.parse(localStorage.getItem(`voltex.chartWorkspace.${m}.v1`) || 'null'), market);
    const lastInterval = async () => { const list = await candleRequests(); const last = list.at(-1) || ''; return new URL(last, origin).searchParams.get('interval'); };
    const openFeature = feature => openFeatureOn(page, feature);

    // Timeframes --------------------------------------------------------
    if (wants('timeframes')) {
      const before = (await candleRequests()).length;
      await page.locator('[data-cw-tf="1m"]').click();
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, before, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      const t1 = Date.now();
      check(`${P}.timeframes.1m-native`, (await lastInterval()) === '1m' && (await page.getAttribute('[data-cw-tf="1m"]', 'aria-pressed')) === 'true', { interval: await lastInterval(), store: (await store())?.timeframe });
      const swStart = Date.now(), swBefore = (await candleRequests()).length;
      await page.locator('[data-cw-tf="4h"]').click();
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, swBefore, { timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-chart-state="candles"]', { timeout: 8000 }).catch(() => {});
      report.perf[`${P}.timeframeSwitchMs`] = Date.now() - swStart;
      check(`${P}.timeframes.4h`, (await lastInterval()) === '4h', { ms: Date.now() - swStart, t1 });
      const menu = await openFeature('timeframes');
      const options = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf-option]')].map(el => ({ tf: el.getAttribute('data-cw-tf-option'), disabled: el.disabled, title: el.getAttribute('title') || '' })));
      check(`${P}.timeframes.menu`, menu && menu.inside && options.length === 13, { menu, options: options.map(o => o.tf + (o.disabled ? '!' : '')) });
      const derivedBefore = (await candleRequests()).length;
      await page.locator('[data-cw-tf-option="3m"]').click();
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, derivedBefore, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const last = new URL((await candleRequests()).at(-1), origin);
      const plan3m = await page.getAttribute('[data-cw-tf="3m"]', 'data-cw-tf-plan').catch(() => null);
      if (market === 'futures') check(`${P}.timeframes.3m-native`, last.searchParams.get('interval') === '3m' && plan3m === 'native', { url: last.pathname + last.search, plan3m });
      else check(`${P}.timeframes.3m-derived-from-1m`, last.searchParams.get('interval') === '1m' && Number(last.searchParams.get('limit')) >= 3 * 100, { url: last.pathname + last.search, plan3m });
      check(`${P}.timeframes.3m-chart`, (await page.getAttribute('[data-chart-state]', 'data-chart-state')) === 'candles', await store());
      await openFeature('timeframes');
      const monthBefore = (await candleRequests()).length;
      await page.locator('[data-cw-tf-option="1M"]').click();
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, monthBefore, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const lastMonth = new URL((await candleRequests()).at(-1), origin);
      check(`${P}.timeframes.1M`, lastMonth.searchParams.get('interval') === (market === 'futures' ? '1M' : '1d') && (await page.getAttribute('[data-chart-state]', 'data-chart-state')) === 'candles', { url: lastMonth.pathname + lastMonth.search });
      await shot(page, `after-${market}-1440-1M`, await chartClip(page, 4));
      // favourites: star 30m into the quick list, then reset
      await openFeature('timeframes');
      await page.locator('[data-cw-tf-star="30m"]').click();
      await page.waitForTimeout(200);
      const quickPlus = (await store())?.quickTimeframes ?? [];
      const shownPlus = await page.evaluate(() => [...document.querySelectorAll('[data-cw-tf]')].map(el => el.getAttribute('data-cw-tf')));
      // A row that had to shed quick timeframes keeps the star in the store and the «▾» menu, not on the strip.
      const denseRow = await page.evaluate(() => !!document.querySelector('[data-cw-toolbar]')?.getAttribute('data-cw-dense'));
      await page.locator('[data-cw-tf-reset]').click();
      await page.waitForTimeout(200);
      const quickReset = (await store())?.quickTimeframes ?? [];
      check(`${P}.timeframes.favourites`, quickPlus.includes('30m') && quickPlus.length === 8 && (denseRow || shownPlus.includes('30m')) && quickReset.join(' ') === '1m 5m 15m 1h 4h 1d 1w', { quickPlus, shownPlus, denseRow, quickReset });
      await page.keyboard.press('Escape');
      await page.locator('[data-cw-tf="1h"]').click();
      await page.waitForTimeout(700);
    }

    // Chart types -------------------------------------------------------
    if (wants('types')) {
      for (const kind of ['bars', 'hollow', 'heikin', 'line', 'candles']) {
        await page.keyboard.press('Escape');
        await page.locator('.chart-type-trigger').click();
        await page.waitForTimeout(150);
        const item = page.locator(`[data-chart-type="${kind}"]`);
        const present = await item.count();
        if (present) await item.click();
        await page.waitForTimeout(250);
        const s = await store();
        check(`${P}.types.${kind}`, present && s?.barType === kind, { present, barType: s?.barType });
        if (kind === 'hollow' || kind === 'heikin') await shot(page, `after-${market}-1440-${kind}`, await chartClip(page, 4));
      }
    }

    // Compare -----------------------------------------------------------
    if (wants('compare')) {
      const menu = await openFeature('compare');
      check(`${P}.compare.menu`, menu && menu.inside, menu);
      const add = async (query, pair) => {
        if (!(await page.locator('[data-cw-compare-search]').count())) await openFeature('compare');
        const state = await page.evaluate(() => ({ disabled: document.querySelector('[data-cw-compare-search]')?.disabled, entries: document.querySelectorAll('[data-cw-compare-entry]').length, hint: document.querySelector('[data-cw-menu="compare"] .cw-hint')?.textContent }));
        if (state.disabled) { console.log('compare search disabled before add', JSON.stringify(state)); await page.keyboard.press('Escape'); await openFeature('compare'); }
        await page.locator('[data-cw-compare-search]').fill(query);
        await page.waitForTimeout(120);
        await page.locator(`[data-cw-compare-option="${pair}"]`).first().click();
        await page.waitForTimeout(900);
      };
      const tB = Date.now();
      await add('ETH', 'ETH/USDT');
      await page.waitForFunction(() => document.querySelector('[data-cw-compare-value="ETH/USDT"]')?.textContent?.includes('%'), null, { timeout: 8000 }).catch(() => {});
      report.perf[`${P}.compareFirstLineMs`] = Date.now() - tB;
      const one = await page.evaluate(() => ({ entries: document.querySelectorAll('[data-cw-compare-entry]').length, attr: document.querySelector('[data-cw-compare]')?.getAttribute('data-cw-compare'), legend: !!document.querySelector('[data-cw-compare-legend]'), value: document.querySelector('[data-cw-compare-value="ETH/USDT"]')?.textContent, main: document.querySelector('[data-cw-compare-value="BTC/USDT"]')?.textContent, leftScale: !!document.querySelector('.terminal-chart-shell table td:first-child canvas') }));
      check(`${P}.compare.one`, one.entries === 1 && one.attr === '1' && one.legend && /%/.test(one.value || ''), one);
      await add('SOL', 'SOL/USDT'); await add('XRP', 'XRP/USDT');
      const three = await page.evaluate(() => ({ entries: document.querySelectorAll('[data-cw-compare-entry]').length, options: document.querySelectorAll('[data-cw-compare-option]').length, values: [...document.querySelectorAll('[data-cw-compare-value]')].map(el => el.textContent) }));
      // At three the search is disabled and no fourth option is offered (by design).
      const searchDisabled = await page.evaluate(() => document.querySelector('[data-cw-compare-search]')?.disabled);
      if (!searchDisabled) await page.locator('[data-cw-compare-search]').fill('DOGE');
      await page.waitForTimeout(120);
      const fourth = await page.locator('[data-cw-compare-option="DOGE/USDT"]').count();
      if (fourth) await page.locator('[data-cw-compare-option="DOGE/USDT"]').first().click();
      await page.waitForTimeout(300);
      const stillThree = await page.evaluate(() => document.querySelectorAll('[data-cw-compare-entry]').length);
      check(`${P}.compare.three-max`, three.entries === 3 && stillThree === 3 && searchDisabled === true && fourth === 0, { three, searchDisabled, fourthOffered: fourth, stillThree });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-cw-compare-value]')].every(el => /%|—/.test(el.textContent || '')), null, { timeout: 8000 }).catch(() => {});
      await shot(page, `after-${market}-1440-compare`, await chartClip(page, 4));
      await shot(page, `after-${market}-1440-compare-page`);
      // period chips, hide, remove
      await page.locator('[data-cw-compare-period="1w"]').click(); await page.waitForTimeout(400);
      const period = (await store())?.comparePeriod;
      await page.locator('[data-cw-compare-entry="ETH/USDT"] [data-cw-compare-toggle]').click(); await page.waitForTimeout(200);
      const hidden = await page.evaluate(() => document.querySelector('[data-cw-compare-entry="ETH/USDT"]')?.className.includes('is-hidden'));
      await page.locator('[data-cw-compare-entry="XRP/USDT"] [data-cw-compare-remove]').click(); await page.waitForTimeout(200);
      const two = await page.evaluate(() => document.querySelectorAll('[data-cw-compare-entry]').length);
      check(`${P}.compare.period-hide-remove`, period === '1w' && hidden === true && two === 2, { period, hidden, two });
      // analytics with relative strength while comparing
      await page.keyboard.press('Escape');
      await page.locator('[data-cw-view="analytics"]').click(); await page.waitForTimeout(500);
      const rs = await page.evaluate(() => ({ panel: !!document.querySelector('[data-cw-analytics]'), rs: !!document.querySelector('[data-cw-analytics-rs]'), text: document.querySelector('[data-cw-analytics-rs]')?.textContent?.slice(0, 200) }));
      check(`${P}.compare.relative-strength`, rs.panel && rs.rs, rs);
      await shot(page, `after-${market}-1440-analytics-rs`, await chartClip(page, 4));
      await page.locator('[data-cw-view="chart"]').click(); await page.waitForTimeout(200);
      // exit restores the candles
      await openFeature('compare');
      await page.locator('[data-cw-compare-exit]').click(); await page.waitForTimeout(600);
      const restored = await page.evaluate(() => ({ attr: document.querySelector('[data-cw-compare]')?.getAttribute('data-cw-compare') ?? null, entries: document.querySelectorAll('[data-cw-compare-entry]').length, legend: !!document.querySelector('.indicator-legend, [data-indicator-legend]'), state: document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') }));
      check(`${P}.compare.exit-restores`, restored.attr === null && restored.state === 'candles' && (await store())?.compare?.length === 0, restored);
    }

    // Data window -------------------------------------------------------
    if (wants('data')) {
      await page.keyboard.press('Escape');
      await page.locator('[data-cw-view="data"]').click(); await page.waitForTimeout(300);
      const canvas = await page.locator('.terminal-chart-shell canvas').first().boundingBox();
      const before = (await candleRequests()).length;
      for (let i = 0; i < 20; i += 1) await page.mouse.move(canvas.x + canvas.width * (0.3 + i * 0.02), canvas.y + canvas.height * 0.4);
      await page.waitForTimeout(400);
      const after = (await candleRequests()).length;
      const dataWindow = await page.evaluate(() => { const el = document.querySelector('[data-cw-data-window]'); return el ? { rows: el.querySelectorAll('dt').length, text: el.textContent.slice(0, 400) } : null; });
      check(`${P}.data.window`, dataWindow && dataWindow.rows >= 8 && /UTC/.test(dataWindow.text) && after === before, { rows: dataWindow?.rows, requestsDuringHover: after - before, sample: dataWindow?.text.slice(0, 160) });
      await shot(page, `after-${market}-1440-data`, await chartClip(page, 4));
      await page.locator('[data-cw-view="chart"]').click(); await page.waitForTimeout(200);
    }

    // Analytics ---------------------------------------------------------
    if (wants('analytics')) {
      await page.locator('[data-cw-view="analytics"]').click(); await page.waitForTimeout(400);
      const a = await page.evaluate(() => ({ blocks: document.querySelectorAll('[data-cw-analytics-block]').length, periods: [...document.querySelectorAll('[data-cw-analytics-period]')].map(el => el.getAttribute('data-cw-analytics-period')), text: document.querySelector('[data-cw-analytics]')?.textContent?.slice(0, 300) }));
      await page.locator('[data-cw-analytics-period="1w"]').click(); await page.waitForTimeout(300);
      const pressed = await page.getAttribute('[data-cw-analytics-period="1w"]', 'aria-pressed');
      check(`${P}.analytics.panel`, a.blocks >= 2 && a.periods.length >= 4 && pressed === 'true', { blocks: a.blocks, periods: a.periods, pressed, sample: a.text?.slice(0, 120) });
      await shot(page, `after-${market}-1440-analytics`, await chartClip(page, 4));
      await page.locator('[data-cw-view="chart"]').click(); await page.waitForTimeout(200);
    }

    // Layout 2 ----------------------------------------------------------
    if (wants('layout')) {
      await openFeature('layout');
      const tL = Date.now();
      await page.locator('[data-cw-layout-option="2"]').click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-cw-pane]')].length === 1 && [...document.querySelectorAll('[data-cw-pane]')].every(p => p.getAttribute('data-cw-pane-state') === 'ok'), null, { timeout: 12000 }).catch(() => {});
      report.perf[`${P}.layout2OpenMs`] = Date.now() - tL;
      const l2 = await page.evaluate(() => ({ panes: [...document.querySelectorAll('[data-cw-pane]')].map(p => p.getAttribute('data-cw-pane-state')), layout: document.querySelector('[data-cw-layout]')?.getAttribute('data-cw-layout'), tickets: document.querySelectorAll('.order-form-area, .cfd-form-area').length, canvases: document.querySelectorAll('.terminal-chart-shell canvas').length }));
      check(`${P}.layout.two`, l2.panes.length === 1 && l2.panes[0] === 'ok' && l2.layout === '2' && l2.tickets <= 1, { ...l2, ms: report.perf[`${P}.layout2OpenMs`] });
      await page.keyboard.press('Escape');
      await shot(page, `after-${market}-1440-layout2`, await chartClip(page, 4));
      await shot(page, `after-${market}-1440-layout2-page`);
      // the second pane changes instrument and timeframe on its own
      const paneBefore = (await candleRequests()).length;
      await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'SOL/USDT');
      await page.waitForFunction(() => window.__qa.fetches.some(f => /candles\/SOL/.test(f.url)), null, { timeout: 8000 }).catch(() => {});
      await page.selectOption('[data-cw-pane="1"] [data-cw-pane-symbol]', 'ETH/USDT');
      await page.waitForFunction(n => window.__qa.fetches.filter(f => /candles\/ETH/.test(f.url)).length > 0 && window.__qa.fetches.filter(f => /candles/.test(f.url)).length > n, paneBefore, { timeout: 8000 }).catch(() => {});
      await page.selectOption('[data-cw-pane="1"] [data-cw-pane-timeframe]', '15m');
      await page.waitForTimeout(900);
      const paneReq = (await candleRequests()).filter(u => /candles\/ETH/.test(u)).map(u => new URL(u, origin).searchParams.get('interval'));
      const mainPair = await page.evaluate(() => document.querySelector('.terminal-chart-shell .pair-name, .futures-ticker-symbol, .ticker-pair, h1, [data-ticker-symbol]')?.textContent?.trim());
      check(`${P}.layout.pane-own-instrument`, paneReq.length >= 1 && paneReq.includes('15m'), { paneReq, mainPair, store: (await store())?.panes?.[0] });
      // sync cursor on, hover the main chart
      await openFeature('layout');
      await page.locator('[data-cw-sync="cursor"]').check(); await page.waitForTimeout(100);
      await page.keyboard.press('Escape');
      const canvas = await page.locator('.terminal-chart-shell canvas').first().boundingBox();
      await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5); await page.waitForTimeout(200);
      check(`${P}.layout.sync-cursor`, (await store())?.syncCursor === true, { syncCursor: (await store())?.syncCursor });
      // «Торговать» on the pane moves the terminal, never an order
      const urlBefore = page.url();
      await page.locator('[data-cw-pane="1"] [data-cw-pane-trade]').click(); await page.waitForTimeout(800);
      const after = { url: page.url(), hits: hits.filter(h => h.method !== 'GET' && h.method !== 'HEAD').length };
      check(`${P}.layout.pane-trade-switches-terminal`, /pair=ETH/.test(decodeURIComponent(after.url)) && after.hits === 0, { before: urlBefore, ...after });
      await page.waitForSelector('[data-chart-state="candles"]', { timeout: 10000 }).catch(() => {});
      await openFeature('layout');
      await page.locator('[data-cw-layout-option="1"]').click(); await page.waitForTimeout(400);
      check(`${P}.layout.back-to-one`, (await page.locator('[data-cw-pane]').count()) === 0, {});
      await page.keyboard.press('Escape');
    }

    // Presets -----------------------------------------------------------
    if (wants('presets')) {
      await openFeature('presets');
      await page.locator('[data-cw-preset="builtin-scalping"]').click(); await page.waitForTimeout(600);
      const s = await store();
      const indicators = await page.evaluate(m => JSON.parse(localStorage.getItem(`voltex.chartIndicators.${m}.v1`) || localStorage.getItem('voltex.chartIndicators.v1') || '[]'), market);
      check(`${P}.presets.builtin-scalping`, s?.timeframe === '5m' && Array.isArray(indicators) && indicators.some(i => /ema/i.test(i.type || i.key || '')), { timeframe: s?.timeframe, indicators: indicators.map(i => i.type || i.key) });
      await openFeature('presets');
      await page.locator('[data-cw-preset-new]').click();
      await page.locator('[data-cw-preset-name]').fill('QA шаблон');
      await page.locator('[data-cw-preset-save]').click(); await page.waitForTimeout(300);
      const saved = await page.evaluate(() => document.querySelectorAll('[data-cw-preset-row]').length);
      const row = page.locator('[data-cw-preset-row]').first();
      const id = await row.getAttribute('data-cw-preset-row');
      await page.locator(`[data-cw-preset-rename="${id}"]`).click();
      await page.locator('[data-cw-preset-form] input, [data-cw-preset-rename-input]').first().fill('QA 2');
      await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const renamed = await page.evaluate(() => document.querySelector('[data-cw-preset-row] [data-cw-preset]')?.textContent?.trim());
      await page.locator(`[data-cw-preset-delete="${id}"]`).click(); await page.waitForTimeout(250);
      const afterDelete = await page.evaluate(() => document.querySelectorAll('[data-cw-preset-row]').length);
      const file = await page.evaluate(m => JSON.parse(localStorage.getItem(`voltex.chartWorkspacePresets.${m}.v1`) || 'null'), market);
      check(`${P}.presets.custom-save-rename-delete`, saved === 1 && /QA 2/.test(renamed || '') && afterDelete === 0 && file && file.version === 1, { saved, renamed, afterDelete, version: file?.version });
      await page.locator('[data-cw-preset-reset]').click(); await page.waitForTimeout(400);
      check(`${P}.presets.reset`, (await store())?.timeframe === '1h', { timeframe: (await store())?.timeframe });
      await page.keyboard.press('Escape');
    }

    // Go to date --------------------------------------------------------
    if (wants('goto')) {
      await page.waitForSelector('[data-chart-state="candles"]', { timeout: 10000 }).catch(() => {});
      await openFeature('goto');
      const twoDays = new Date(Date.now() - 2 * 86400000); twoDays.setUTCMinutes(0, 0, 0);
      await page.locator('[data-cw-goto-input]').fill(twoDays.toISOString().slice(0, 16));
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(700);
      const closedOk = !(await page.locator('[data-cw-goto]').count());
      const range = await page.evaluate(() => { const el = document.querySelector('.terminal-chart-shell'); return el?.textContent?.length; });
      await openFeature('goto');
      const future = new Date(Date.now() + 3 * 86400000);
      await page.locator('[data-cw-goto-input]').fill(future.toISOString().slice(0, 16));
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(300);
      const futureWarn = await page.evaluate(() => document.querySelector('[data-cw-goto] [role="status"]')?.textContent || '');
      const ancient = new Date('2015-01-01T00:00');
      await page.locator('[data-cw-goto-input]').fill(ancient.toISOString().slice(0, 16));
      const histBefore = (await candleRequests()).length;
      await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(1200);
      const histAfter = (await candleRequests()).filter(u => /end/.test(u)).length;
      const stillOpen = await page.locator('[data-cw-goto]').count();
      check(`${P}.goto.loaded-bar`, closedOk, { closedOk, range });
      check(`${P}.goto.future-refused`, futureWarn.length > 0, { futureWarn });
      check(`${P}.goto.history-honest`, market === 'futures' ? histAfter >= 1 : true, { pagedRequests: histAfter, requestsBefore: histBefore, dialogStillOpen: stillOpen });
      await page.keyboard.press('Escape');
    }

    // Snapshot ----------------------------------------------------------
    if (wants('snapshot')) {
      await openFeature('snapshot');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('[data-cw-snapshot-download]').click()]);
      let size = 0, file = null;
      if (download) { file = path.join(OUT, `snapshot-${market}.png`); await download.saveAs(file); size = fs.statSync(file).size; report.screenshots.push(path.basename(file)); }
      check(`${P}.snapshot.png`, download && size > 10000 && /\.png$/.test(download.suggestedFilename()), { file: download?.suggestedFilename(), size });
      await page.keyboard.press('Escape');
    }

    // Full screen -------------------------------------------------------
    if (wants('fullscreen')) {
      await openFeature('fullscreen'); await page.waitForTimeout(500); // on a narrow row the key sits inside «Ещё»
      const fs1 = await page.evaluate(() => ({ attr: document.querySelector('[data-cw-fullscreen]') !== null, shell: document.querySelector('.terminal-chart-shell')?.getBoundingClientRect().width, ticket: !!document.querySelector('.order-form-area, .cfd-form-area') }));
      await shot(page, `after-${market}-1440-fullscreen`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      const fs2 = await page.evaluate(() => document.querySelector('[data-cw-fullscreen]') !== null);
      check(`${P}.fullscreen.toggle-escape`, fs1.attr && fs1.shell >= 1400 && fs1.ticket && !fs2, { ...fs1, afterEscape: fs2 });
    }

    // Keyboard ----------------------------------------------------------
    if (wants('keyboard')) {
      await openFeature('compare');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const closed = await page.evaluate(() => ({ menu: !!document.querySelector('[data-cw-menu]'), focus: document.activeElement?.getAttribute('data-cw-feature') }));
      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('3'); await page.waitForTimeout(500);
      const digit = (await store())?.timeframe;
      await openFeature('compare');
      await page.locator('[data-cw-compare-search]').fill(''); await page.keyboard.type('5'); await page.waitForTimeout(300);
      const typed = (await store())?.timeframe;
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      const focusVisible = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { tag: el.tagName, feature: el.getAttribute('data-cw-feature') || el.getAttribute('data-cw-tf') || el.className, outline: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' }; });
      // Escape returns focus to whichever trigger opened the menu: «Сравнить» itself, or «Ещё» on a narrow row.
      check(`${P}.keyboard.escape-digits-inputs`, !closed.menu && (closed.focus === 'compare' || closed.focus === 'more') && digit === '15m' && typed === '15m', { closed, digit, typed, focusVisible });
      await page.locator('[data-cw-tf="1h"]').click(); await page.waitForTimeout(500);
    }

    // Every menu inside the viewport --------------------------------------
    if (wants('menus')) {
      const boxes = {};
      for (const feature of ['timeframes', 'compare', 'layout', 'tools', 'presets', 'goto', 'scale', 'snapshot']) {
        const box = await openFeature(feature);
        boxes[feature] = box ? { inside: box.inside, x: box.x, y: box.y, w: box.w, h: box.h } : null;
        await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      }
      check(`${P}.menus.inside-viewport`, Object.values(boxes).every(b => b && b.inside), boxes);
      // the indicator and type menus still open over content (existing menus)
      await page.locator('.chart-indicators-trigger').click(); await page.waitForTimeout(150);
      const ind = await page.evaluate(() => { const el = document.querySelector('[role="menu"]'); const r = el?.getBoundingClientRect(); return r ? { inside: r.right <= innerWidth && r.bottom <= innerHeight, w: Math.round(r.width) } : null; });
      await page.keyboard.press('Escape');
      check(`${P}.menus.indicators`, ind && ind.inside, ind);
    }

    // Regression: the order form, book and ticker are still there -----------
    const regression = await page.evaluate(() => ({ form: !!document.querySelector('.order-form-area, .cfd-form-area'), formVisible: (document.querySelector('.order-form-area, .cfd-form-area')?.getBoundingClientRect().width || 0) > 100, book: !!document.querySelector('.orderbook-area, .futures-book, [data-sampled-book]'), rail: !!document.querySelector('.drawing-rail, [data-drawing-rail], .draw-toolbar'), tv: [...document.querySelectorAll('.terminal-chart-heading [role="group"] button, .terminal-chart-source button')].map(b => b.textContent) }));
    check(`${P}.regression.terminal-intact`, regression.form && regression.formVisible && regression.book && regression.tv.includes('VOLTEX'), regression);
    // TradingView switch keeps the terminal, workspace tabs disabled for the data views
    if (regression.tv.includes('TradingView')) {
      await page.locator('.terminal-chart-heading [role="group"] button, .terminal-chart-source button', { hasText: 'TradingView' }).first().click(); await page.waitForTimeout(500);
      const tv = await page.evaluate(() => ({ iframe: !!document.querySelector('iframe'), dataDisabled: document.querySelector('[data-cw-view="data"]')?.disabled, form: !!document.querySelector('.order-form-area, .cfd-form-area') }));
      await page.locator('.terminal-chart-heading [role="group"] button, .terminal-chart-source button', { hasText: 'VOLTEX' }).first().click(); await page.waitForTimeout(500);
      const back = await page.evaluate(() => document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state'));
      check(`${P}.regression.tradingview-switch`, tv.dataDisabled === true && tv.form && back === 'candles', { ...tv, back });
    }
    check(`${P}.errors`, errors.filter(e => !/ResizeObserver/.test(e)).length === 0, errors.slice(0, 6));
    await ctx.close();
  }

  // ── 1920: four panes ──────────────────────────────────────────────────
  if (wants('layout4')) {
    const ctx = await context(1920, 1000);
    const { page } = await openTerminal(ctx, origin, 'futures', { width: 1920, height: 1000 });
    await openFeatureOn(page, 'layout');
    const tL = Date.now();
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    await page.locator('[data-cw-layout-option="4"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-cw-pane]').length === 3 && [...document.querySelectorAll('[data-cw-pane]')].every(p => p.getAttribute('data-cw-pane-state') === 'ok'), null, { timeout: 15000 }).catch(() => {});
    report.perf['futures.1920.layout4OpenMs'] = Date.now() - tL;
    await page.keyboard.press('Escape');
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const l4 = await page.evaluate(() => ({ panes: [...document.querySelectorAll('[data-cw-pane]')].map(p => p.getAttribute('data-cw-pane-state')), overflow: document.documentElement.scrollWidth > innerWidth + 1, tickets: document.querySelectorAll('.order-form-area').length }));
    check('futures.1920.layout.four', l4.panes.length === 3 && l4.panes.every(s => s === 'ok') && !l4.overflow && l4.tickets === 1, { ...l4, ms: report.perf['futures.1920.layout4OpenMs'], heapBefore, heapAfter });
    await shot(page, 'after-futures-1920-layout4', await chartClip(page, 4));
    await shot(page, 'after-futures-1920-layout4-page');
    // one pane expanded to full size
    await page.locator('[data-cw-pane="2"] [data-cw-pane-expand]').click(); await page.waitForTimeout(400);
    const expanded = await page.evaluate(() => ({ expanded: document.querySelector('[data-cw-expanded]')?.getAttribute('data-cw-expanded'), width: document.querySelector('.cw-pane.is-expanded')?.getBoundingClientRect().width }));
    check('futures.1920.layout.pane-expand', expanded.expanded === '2' && expanded.width > 900, expanded);
    await page.locator('[data-cw-pane="2"] [data-cw-pane-expand]').click(); await page.waitForTimeout(300);
    await ctx.close();
  }

  // ── Mobile ────────────────────────────────────────────────────────────
  const phones = [...PHONES.map(w => [w, w === 320 ? 568 : w === 360 ? 740 : w === 390 ? 844 : w === 768 ? 1024 : 932]), [844, 390]];
  for (const [w, h] of phones) {
    if (!wants('mobile')) break;
    for (const market of ['futures', 'spot']) {
      const ctx = await context(w, h, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const { page, errors } = await openTerminal(ctx, origin, market, { width: w, height: h, mobile: true });
      const id = `mobile.${market}.${w}x${h}`;
      const g = await page.evaluate(GEOMETRY);
      const row = await page.evaluate(() => { const r = document.querySelector('[data-cw-toolbar]'); const start = document.querySelector('.cw-start'); const more = document.querySelector('[data-cw-feature="timeframes"]'); const sr = start?.getBoundingClientRect(), mr = more?.getBoundingClientRect(); return r ? { h: Math.round(r.getBoundingClientRect().height), quick: document.querySelectorAll('[data-cw-tf]').length, sheet: !!document.querySelector('[data-cw-feature="phone-more"]'), rows: Math.round(r.scrollHeight / 36), stripScrolls: start ? start.scrollWidth > start.clientWidth + 2 || (start.firstElementChild && start.firstElementChild.scrollWidth > start.firstElementChild.clientWidth + 2) : null, menuKeyVisible: !!(sr && mr && mr.right <= sr.right + 1) } : null; });
      check(`${id}.loaded`, g.chartState === 'candles' && !g.overflow, { chartState: g.chartState, overflow: g.overflow, errors: errors.slice(0, 3) });
      // A narrow phone keeps three to seven quick timeframes, the «▾» stays on screen, nothing wraps.
      check(`${id}.phone-row`, row && row.sheet && row.quick >= 3 && row.h <= 48 && row.menuKeyVisible && !row.stripScrolls && g.clipped.length === 0, { ...row, clipped: g.clipped });
      await shot(page, `after-${market}-mobile-${w}x${h}`);
      await page.locator('[data-cw-feature="phone-more"]').click(); await page.waitForTimeout(350);
      const sheet = await page.evaluate(menuBox);
      const sheetItems = await page.evaluate(() => [...document.querySelectorAll('[data-cw-menu="phone-sheet"] [data-cw-section], [data-cw-menu="phone-sheet"] [data-cw-feature]')].map(el => el.getAttribute('data-cw-section') || el.getAttribute('data-cw-feature')));
      check(`${id}.sheet`, sheet && sheet.inside && sheetItems.length >= 5, { sheet, sheetItems });
      if (w === 390 && h === 844) await shot(page, `after-${market}-mobile-390-sheet`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      // compare from the phone row
      if (w === 390) {
        await page.locator('[data-cw-feature="compare"]').first().click(); await page.waitForTimeout(250);
        await page.locator('[data-cw-compare-search]').fill('ETH'); await page.waitForTimeout(150);
        await page.locator('[data-cw-compare-option="ETH/USDT"]').first().click(); await page.waitForTimeout(1200);
        const cmp = await page.evaluate(() => ({ entries: document.querySelectorAll('[data-cw-compare-entry]').length, box: (() => { const el = document.querySelector('[data-cw-menu]'); const r = el?.getBoundingClientRect(); return r ? { inside: r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 } : null; })() }));
        check(`${id}.compare-sheet`, cmp.entries === 1 && cmp.box && cmp.box.inside, cmp);
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        await shot(page, `after-${market}-mobile-390-compare`);
        await page.locator('[data-cw-feature="compare"]').first().click(); await page.waitForTimeout(250);
        await page.locator('[data-cw-compare-exit]').click(); await page.waitForTimeout(300);
        // two charts on a phone: one active chart with tabs
        await page.locator('[data-cw-feature="phone-more"]').click(); await page.waitForTimeout(300);
        const layoutInSheet = page.locator('[data-cw-menu="phone-sheet"] [data-cw-layout-option="2"]');
        if (await layoutInSheet.count()) { await layoutInSheet.click(); await page.waitForTimeout(1500); }
        const tabs = await page.evaluate(() => ({ tabs: document.querySelectorAll('[data-cw-layout-tab]').length, panes: document.querySelectorAll('[data-cw-pane]').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
        check(`${id}.layout-tabs`, tabs.tabs === 2 && !tabs.overflow, tabs);
        await page.keyboard.press('Escape');
        await shot(page, `after-${market}-mobile-390-layout2`);
        await page.evaluate(m => { const raw = localStorage.getItem(`voltex.chartWorkspace.${m}.v1`); if (raw) { const s = JSON.parse(raw); s.layout = 1; localStorage.setItem(`voltex.chartWorkspace.${m}.v1`, JSON.stringify(s)); } }, market);
      }
      // the order form is still one tap away
      const tradeTab = page.locator(market === 'futures' ? '#mobile-futures-trade' : '#mobile-trade-trade');
      if (await tradeTab.count()) { await tradeTab.click(); await page.waitForTimeout(400); }
      const form = await page.evaluate(() => { const el = document.querySelector('.order-form-area'); const r = el?.getBoundingClientRect(); return r ? { visible: r.width > 100 && r.height > 100 } : null; });
      check(`${id}.order-form-reachable`, form && form.visible, form);
      await ctx.close();
    }
  }

  // ── Browser zoom 90 / 100 / 110 / 125 % at a 1440 window ───────────────
  if (wants('zoom')) {
    for (const zoom of [0.9, 1, 1.1, 1.25]) {
      const width = Math.round(1440 / zoom), height = Math.round(900 / zoom);
      const ctx = await context(width, height, { deviceScaleFactor: zoom });
      const { page } = await openTerminal(ctx, origin, 'futures', { width, height });
      const g = await page.evaluate(GEOMETRY);
      check(`zoom.${Math.round(zoom * 100)}`, !g.overflow && g.clipped.length === 0 && g.toolbar && g.toolbar.h <= 46, { cssWidth: width, toolbar: g.toolbar, clipped: g.clipped, features: g.features.length });
      await shot(page, `after-futures-zoom-${Math.round(zoom * 100)}`, await chartClip(page, 4));
      await ctx.close();
    }
  }

  await perf(browser, origin, context, chartClip, shot);
  await finish(browser, server);
}

/** Scenario counters: A one chart, B chart + 3 compares, C 2 and 4 charts, plus a hidden tab. */
async function perf(browser, origin, context, chartClip, shot) {
  if (!wants('perf')) return;
  const ctx = await context(1440, 900);
  const { page, opened } = await openTerminal(ctx, origin, 'futures', { width: 1440, height: 900 });
  const snapshot = async label => {
    await page.evaluate(() => { window.__qa.mark = { fetches: window.__qa.fetches.length, sockets: window.__qa.sockets }; });
    const cpu0 = await cpu(page);
    await sleep(PERF_WINDOW_MS);
    const cpu1 = await cpu(page);
    const m = await page.evaluate(() => ({ candleRequests: window.__qa.fetches.slice(window.__qa.mark.fetches).filter(f => /candles/.test(f.url)).length, allRequests: window.__qa.fetches.length - window.__qa.mark.fetches, newSockets: window.__qa.sockets - window.__qa.mark.sockets, socketsTotal: window.__qa.sockets, heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, canvases: document.querySelectorAll('canvas').length }));
    const out = { ...m, cpuTaskMs: cpu1 !== null && cpu0 !== null ? Math.max(0, Math.round((cpu1 - cpu0) * 1000)) : null, windowMs: PERF_WINDOW_MS };
    report.perf[label] = out; console.log('PERF', label, JSON.stringify(out));
    return out;
  };
  report.perf[`${PHASE}.chartOpenMs`] = opened;
  const A = await snapshot(`${PHASE}.A.one-chart`);
  if (PHASE === 'after') {
    const add = async (q, pair) => { await openFeatureOn(page, 'compare'); await page.locator('[data-cw-compare-search]').fill(q); await page.waitForTimeout(120); await page.locator(`[data-cw-compare-option="${pair}"]`).first().click(); await page.waitForTimeout(600); };
    await add('ETH', 'ETH/USDT'); await add('SOL', 'SOL/USDT'); await add('XRP', 'XRP/USDT'); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('[data-cw-compare-entry]').length === 3, null, { timeout: 8000 }).catch(() => {});
    const B = await snapshot('after.B.three-compares');
    await openFeatureOn(page, 'compare'); await page.locator('[data-cw-compare-exit]').click(); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="2"]').click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('[data-cw-pane][data-cw-pane-state="ok"]').length === 1, null, { timeout: 12000 }).catch(() => {});
    const C2 = await snapshot('after.C.two-charts');
    await page.setViewportSize({ width: 1920, height: 1000 }); await page.waitForTimeout(400);
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="4"]').click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('[data-cw-pane][data-cw-pane-state="ok"]').length === 3, null, { timeout: 15000 }).catch(() => {});
    const C4 = await snapshot('after.C.four-charts');
    // hidden tab: the chart, the panes and the compares all stop asking
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(500);
    const H = await snapshot('after.hidden-tab.four-charts');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    await openFeatureOn(page, 'layout'); await page.locator('[data-cw-layout-option="1"]').click(); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    const back = await snapshot('after.A.after-collapse');
    const budget = PERF_WINDOW_MS / 5000 + 2; // the 5 s tail poll plus slack
    check('perf.A.one-chart-requests', A.candleRequests <= budget && A.newSockets === 0, A);
    check('perf.B.compares-bounded', B.candleRequests <= budget + 3 * Math.ceil(PERF_WINDOW_MS / 30000) + 1 && B.newSockets === 0, B);
    check('perf.C.two-charts-bounded', C2.candleRequests <= budget + Math.ceil(PERF_WINDOW_MS / 10000) + 1 && C2.newSockets === 0, C2);
    check('perf.C.four-charts-bounded', C4.candleRequests <= budget + 3 * Math.ceil(PERF_WINDOW_MS / 10000) + 3 && C4.newSockets === 0, C4);
    check('perf.hidden-tab-silent', H.candleRequests === 0, H);
    check('perf.collapse-stops-panes', back.candleRequests <= budget && back.canvases <= A.canvases + 2, { ...back, canvasesBefore: A.canvases });
  }
  await ctx.close();
}
async function cpu(page) {
  try { const session = await page.context().newCDPSession(page); await session.send('Performance.enable'); const { metrics } = await session.send('Performance.getMetrics'); await session.detach(); return metrics.find(m => m.name === 'TaskDuration')?.value ?? null; } catch { return null; }
}
async function finish(browser, server) {
  await browser.close(); server.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok).length };
  fs.writeFileSync(path.join(OUT, `report-${PHASE}.json`), JSON.stringify(report, null, 2));
  const lines = [`# Chart workspace QA — ${PHASE}`, '', `Build: ${DIST}`, `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed`, '', '| check | result | detail |', '|---|---|---|',
    ...report.checks.map(c => `| ${c.id} | ${c.ok ? 'PASS' : 'FAIL'} | ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail).replace(/\|/g, '\\|').slice(0, 300)} |`), '', '## Performance', '', '| measure | value |', '|---|---|',
    ...Object.entries(report.perf).map(([k, v]) => `| ${k} | ${typeof v === 'object' ? JSON.stringify(v).replace(/\|/g, '\\|') : v} |`), ''];
  fs.writeFileSync(path.join(OUT, `REPORT-${PHASE}.md`), lines.join('\n'));
  console.log(`\n${report.summary.passed} passed, ${report.summary.failed} failed → ${OUT}`);
  process.exitCode = report.summary.failed ? 1 : 0;
}

run().catch(error => { console.error(error); process.exit(2); });
