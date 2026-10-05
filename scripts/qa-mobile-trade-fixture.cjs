'use strict';
/**
 * Read-only fixture for the mobile Spot / Futures / Deposit QA.
 *
 * Synthetic data only: invented prices, invented balances, invented deposit
 * addresses that are not anyone's wallet. Every non-GET request is refused, so
 * nothing the browser does here can place an order, move money or log a copy
 * to a real service. The page is the real production bundle (`--dist`).
 */
const express = require('express');
const path = require('node:path');

const NOW = () => Date.now();
const SPOT_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'PEPE/USDT'];
// PEPE/USDT is deliberately Spot-only: Futures must not invent a contract for it.
const FUTURES_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const PRICE = { BTC: 84890.1, ETH: 3121.45, SOL: 142.31, PEPE: 0.00001234 };
const CANDLES = (base) => Array.from({ length: 160 }, (_, i) => {
  const open = base * (1 + Math.sin(i / 9) * 0.006 + i * 0.00004);
  const close = open * (1 + Math.sin(i * 2.1) * 0.0012);
  return { time: Math.floor(NOW() / 1000) - (160 - i) * 60, open, high: Math.max(open, close) * 1.0006, low: Math.min(open, close) * 0.9994, close, volume: 12 + (i % 7) * 3 };
});
const baseOf = (pair) => String(pair).toUpperCase().replace(/[-_]/, '/').split('/')[0].replace(/USDT$/, '');
const pairOf = (raw) => { const s = String(raw).toUpperCase().replace('-', '/').replace('_', '/'); return s.includes('/') ? s : s.replace(/USDT$/, '') + '/USDT'; };
function levels(mid, side, count = 16) {
  const step = mid > 1000 ? 0.1 : mid > 10 ? 0.01 : mid > 1 ? 0.001 : mid / 10000;
  return Array.from({ length: count }, (_, i) => {
    const price = side === 'bid' ? mid - step * (i + 1) : mid + step * (i + 1);
    const quantity = (0.15 + ((i * 37) % 23) / 10).toFixed(4);
    return { price: price.toFixed(mid > 1 ? 2 : 10).replace(/0+$/, '').replace(/\.$/, ''), quantity };
  });
}

/** Deposit catalogue: invented addresses (fixed patterns, not real wallets). */
const DEPOSIT = [
  { assetId: 'usdt', asset: 'USDT', networkId: 'tron', networkName: 'Tron', standard: 'TRC-20', address: 'T' + 'QA9'.repeat(11), memo: '', memoLabel: '' },
  { assetId: 'usdt', asset: 'USDT', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + 'a1b2c3d4e5'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'usdt', asset: 'USDT', networkId: 'bsc', networkName: 'BNB Smart Chain', standard: 'BEP-20', address: '0x' + 'f0e1d2c3b4'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'usdc', asset: 'USDC', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + '9a8b7c6d5e'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'btc', asset: 'BTC', networkId: 'bitcoin', networkName: 'Bitcoin', standard: 'Native', address: 'bc1q' + 'qa7x'.repeat(9) + 'qa', memo: '', memoLabel: '' },
  { assetId: 'eth', asset: 'ETH', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + '0123456789'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'ton', asset: 'TON', networkId: 'ton', networkName: 'The Open Network', standard: 'Native', address: 'UQ' + 'QAtonQAton'.repeat(4) + 'QA', memo: '77300123', memoLabel: 'Memo' },
  { assetId: 'xrp', asset: 'XRP', networkId: 'xrp', networkName: 'XRP Ledger', standard: 'Native', address: 'r' + 'QAxrpQAxrp'.repeat(3) + 'Q', memo: '4410029', memoLabel: 'Destination Tag' },
].map(e => ({ ...e, memoAllowed: Boolean(e.memo), enabled: true, status: 'configured' }));

function createFixture({ dist, positions = 'one', catalogue = 'ok', guest = false } = {}) {
  dist = path.resolve(dist);
  const LISTING_AT = NOW() + 36 * 3600_000;
  const state = { requests: [], catalogueMode: catalogue, catalogueDelayMs: 0, positions };
  const app = express();
  app.use((q, r, next) => {
    state.requests.push({ method: q.method, path: q.path, at: NOW() });
    if (!['GET', 'HEAD'].includes(q.method)) return r.status(405).json({ error: 'Read-only fixture' });
    r.setHeader('Cache-Control', 'no-store');
    next();
  });
  const spotRows = SPOT_PAIRS.map(pair => ({ pair, symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'spot', baseAsset: baseOf(pair), quoteAsset: 'USDT', lastPrice: PRICE[baseOf(pair)], high24h: PRICE[baseOf(pair)] * 1.012, low24h: PRICE[baseOf(pair)] * 0.984, changePercent24h: baseOf(pair) === 'ETH' ? -0.84 : 1.25, quoteVolume24h: 3.19e9, volume24h: 15000, receivedAt: NOW(), fetchedAt: NOW(), stale: false }));
  const futRows = FUTURES_PAIRS.map(pair => { const base = baseOf(pair), row = spotRows.find(r => r.pair === pair);
    return { ...row, id: `linear_perpetual:${base}USDT`, provider: 'bybit', marketType: 'linear_perpetual', settleAsset: 'USDT', providerSymbol: `${base}USDT`,
      volumeAsset: base, turnoverAsset: 'USDT', markPrice: row.lastPrice * 0.99997, indexPrice: row.lastPrice * 0.9991, fundingRate: 0.0001, nextFundingTime: NOW() + 3 * 3600_000,
      openInterest: 30894.9, turnover24h: 3.19e9, bidPrice: row.lastPrice - 0.1, askPrice: row.lastPrice + 0.1 }; });
  const display = (value, refreshMs = 60000) => ({ ...value, _display: { mode: 'snapshot', capturedAt: NOW(), refreshMs } });
  app.get(['/api/v1/market/display', '/api/v1/market/display/futures-tickers'], (_q, r) => r.json(display({ version: 1, type: 'snapshot', epoch: 'fixture', revision: 1, status: 'live', rows: futRows })));
  app.get('/api/v1/market/display/spot-snapshot', (_q, r) => r.json(display({ tickers: { available: true, source: 'fixture', fetchedAt: NOW(), stale: false, value: spotRows }, overview: { available: false }, sentiment: { available: false } })));
  app.get(['/api/v1/market/display/spot-book/:symbol', '/api/v1/market/display/futures-book/:symbol'], (q, r) => {
    const mid = PRICE[baseOf(q.params.symbol)] ?? 100;
    r.json(display({ available: true, pair: pairOf(q.params.symbol), symbol: q.params.symbol, updateId: Math.floor(NOW() / 1000), timestamp: NOW(), fetchedAt: NOW(), stale: false, bids: levels(mid, 'bid'), asks: levels(mid, 'ask') }));
  });
  app.get('/api/v1/me', (_q, r) => guest ? r.status(401).json({ error: 'unauthorized' }) : r.json({ id: 'qa-user', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'APPROVED', isAdmin: false, role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: FUTURES_PAIRS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 25, leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }] }));
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: FUTURES_PAIRS.map(p => ({ symbol: p, providerSymbol: p.replace('/', ''), marketType: 'linear_perpetual', baseAsset: baseOf(p), quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ tickers: spotRows.map(x => ({ pair: x.pair, lastPrice: x.lastPrice, high24h: x.high24h, low24h: x.low24h, changePercent: x.changePercent24h, quoteVolume24h: x.quoteVolume24h, volume24h: x.volume24h })) }));
  app.get('/api/v1/market/external/ticker/:p', (q, r) => { const x = spotRows.find(s => s.pair === pairOf(q.params.p)) ?? spotRows[0]; r.json({ ...x, changePercent24h: String(x.changePercent24h), lastPrice: String(x.lastPrice), high24h: String(x.high24h), low24h: String(x.low24h), volume24h: String(x.volume24h), quoteVolume24h: String(x.quoteVolume24h) }); });
  app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ symbols: SPOT_PAIRS }));
  app.get('/api/v1/market/pairs', (_q, r) => r.json(SPOT_PAIRS.map(p => ({ pair: p, base: baseOf(p), quote: 'USDT' }))));
  app.get('/api/v1/futures/mark-price/:s', (q, r) => { const p = PRICE[baseOf(q.params.s)] ?? 100; r.json({ symbol: q.params.s, markPrice: String(p * 0.99997), indexPrice: String(p * 0.9991) }); });
  app.get('/api/v1/futures/funding-rate/:s', (_q, r) => r.json({ history: [{ rate: '0.0001', markPrice: '84887.45', indexPrice: '84123.99', appliedAt: new Date().toISOString() }] }));
  app.get('/api/v1/futures/open-interest/:s', (_q, r) => r.json({ available: true, value: { openInterestBase: 30894.9 } }));
  app.get('/api/v1/market/derivatives/:a', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: NOW(), stale: false, value: { turnover24hUsd: 3.19e9, openInterestBase: 30894.9, openInterestUsd: 9.2e8, fundingRate: 0.0001, nextFundingTime: NOW() + 3 * 3600_000 } }));
  app.get('/api/v1/wallet/overview', (_q, r) => r.json({ balances: { spot: [{ asset: 'USDT', available: '1250.50', locked: '0' }], futures: [{ asset: 'USDT', available: '3400.00', locked: '0' }], spotValueUsd: 1250.5, futuresValueUsd: 3400, totalValueUsd: 4650.5 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 84890 }));
  app.get('/api/v1/balances', (_q, r) => guest ? r.status(401).json({ error: 'unauthorized' }) : r.json([{ asset: 'USDT', available: '1250.50', locked: '0' }, { asset: 'BTC', available: '0.012345', locked: '0' }]));
  app.get('/api/v1/futures/balances', (_q, r) => guest ? r.status(401).json({ error: 'unauthorized' }) : r.json([{ asset: 'USDT', available: '3400.00', locked: '0' }]));
  const POSITION = { id: 'qa-pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '0.025', entryPrice: '83260.40', leverage: 10, marginType: 'CROSS', initialMargin: '208.15', liquidationPrice: '75118.20', markPrice: '84887.45', unrealizedPnl: '40.68', realizedPnl: '0', roe: '19.54', openedAt: new Date().toISOString(), protection: { takeProfit: null, stopLoss: null } };
  app.get('/api/v1/futures/positions', (_q, r) => guest ? r.status(401).json({ error: 'unauthorized' }) : r.json(state.positions === 'one' ? [POSITION] : []));
  app.get('/api/v1/futures/positions/history', (_q, r) => r.json([]));
  app.get(['/api/v1/orders', '/api/v1/orders/history', '/api/v1/orders/me', '/api/v1/futures/orders/me', '/api/v1/futures/orders'], (_q, r) => guest ? r.status(401).json({ error: 'unauthorized' }) : r.json([]));
  app.get('/api/v1/market/live', (_q, r) => { r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); r.write(': open\n\n'); });
  app.get('/api/v1/market/snapshot', (_q, r) => r.json({ pairs: spotRows.map(x => ({ pair: x.pair, lastPrice: x.lastPrice, changePercent: x.changePercent24h, high24h: x.high24h, low24h: x.low24h, quoteVolume24h: x.quoteVolume24h })), fetchedAt: NOW() }));
  app.get('/api/v1/market/assets/icons', (_q, r) => r.json({ icons: {} }));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ gainers: [], losers: [] }));
  app.get('/api/v1/market/external/candles/:p', (q, r) => r.json({ pair: pairOf(q.params.p), interval: q.query.interval, candles: CANDLES(PRICE[baseOf(q.params.p)] ?? 100) }));
  app.get('/api/v1/market/futures/candles/:p', (q, r) => {
    const symbol = pairOf(q.params.p).replace('/', '');
    const list = CANDLES(PRICE[baseOf(q.params.p)] ?? 100).reverse().map(c => [String(c.time * 1000), ...[c.open, c.high, c.low, c.close].map(v => v.toFixed(v > 1 ? 2 : 10)), String(c.volume)]);
    r.json({ retCode: 0, result: { category: 'linear', symbol, list } });
  });
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null }));
  app.get('/api/v1/deposit-catalogue', async (_q, r) => {
    if (state.catalogueDelayMs) await new Promise(resolve => setTimeout(resolve, state.catalogueDelayMs));
    if (state.catalogueMode === 'error') return r.status(503).json({ error: 'unavailable' });
    if (state.catalogueMode === 'empty') return r.json({ version: 'qa-empty', entries: [] });
    r.json({ version: 'qa-1', entries: DEPOSIT });
  });
  app.get('/api/v1/deposit-chains', (_q, r) => r.json({ chains: [], minDepositUsd: 300, usdPeggedAssets: ['USDT', 'USDC'] }));
  // VTA as an upcoming listing: its countdown must stay in view on a phone.
  const vta = () => ({ pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false, status: 'upcoming', listingArmed: true,
    listingAt: new Date(LISTING_AT).toISOString(), initialPrice: 0.01, state: { phase: 'pre-listing', lastPrice: null, serverTime: NOW() } });
  app.get('/api/v1/market/test-assets', (_q, r) => r.json({ serverTime: NOW(), assets: [vta()] }));
  app.get('/api/v1/market/test-assets/:slug/candles', (_q, r) => r.json({ candles: [] }));
  app.get(['/api/v1/market/listings', '/api/v1/market/nrx'], (_q, r) => r.json({ serverTime: NOW(), assets: [] }));
  app.get('/__qa/requests', (_q, r) => r.json(state.requests));
  app.get('/__qa/set', (q, r) => { if (q.query.catalogue) state.catalogueMode = String(q.query.catalogue); if (q.query.delay) state.catalogueDelayMs = Number(q.query.delay); if (q.query.positions) state.positions = String(q.query.positions); r.json(state); });
  app.use('/api/v1', (_q, r) => r.json([]));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
  return { app, state, DEPOSIT };
}

/** A token shaped like the real one (the copy log reads its `sub`); never valid anywhere. */
const qaToken = (sub) => `qa.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.fixture`;

/** Browser context that can only reach the fixture origin. */
async function fixtureContext(browser, origin, { width, height, guest = false, touch = true, lang = 'ru' }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', hasTouch: touch, isMobile: touch && width <= 900, deviceScaleFactor: 2 });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && ['GET', 'HEAD'].includes(route.request().method())) return route.continue();
    if (url.origin === origin) return route.fulfill({ status: 405, body: '{"error":"read-only"}' });
    return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(({ guest, lang, token }) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
      if (url.origin === 'https://market.voltextech.net') return original('/api/v1' + url.pathname + url.search, options);
      if (url.origin !== location.origin) return Promise.reject(new Error('External network blocked in fixture'));
      return original(input, options);
    };
    try { if (!guest) localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', lang); } catch {}
    window.__copies = []; window.__copyMode = 'success';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
      window.__copies.push(text);
      if (window.__copyMode === 'slow') return new Promise(resolve => setTimeout(resolve, 400));
      return window.__copyMode === 'failure' ? Promise.reject(new Error('Denied')) : Promise.resolve();
    } } });
  }, { guest, lang, token: qaToken('qa-user') });
  return context;
}

module.exports = { createFixture, fixtureContext, qaToken, DEPOSIT, SPOT_PAIRS, FUTURES_PAIRS, PRICE };
