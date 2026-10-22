'use strict';
/**
 * LOCAL MOBILE CLIENT AUDIT FIXTURE — read-only, loopback only, synthetic data.
 *
 * Serves the real production bundle (`frontend/dist`) behind an in-memory API
 * so every customer page can be opened on a phone-sized viewport with FILLED
 * states: balances, open orders, positions with negative PnL, deposit and
 * withdrawal history, a rejected KYC, long e-mails, long asset names, tiny
 * and huge prices. Nothing here is anyone's wallet, account or price.
 *
 * Every non-GET request is refused with 405 (the one exception is the Earn
 * calculator's POST, a pure projection answered from the programme table
 * below with nothing stored), so no browser action taken
 * against this server can place an order, move money, change a profile or
 * send a message. The copy-trading marketplace is produced by the compiled,
 * unchanged backend router over an in-memory database (no Postgres), exactly
 * as scripts/qa-copy-production.cjs does.
 *
 * Only Playwright (scripts/qa-mobile-client-audit.cjs) is meant to talk to
 * this server; it additionally blocks every other origin in the browser.
 *
 *   node scripts/qa-mobile-client-fixture.cjs --port 4189   # manual preview
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const NOW = () => Date.now();
const ISO = (daysAgo, hour = 10) => new Date(Date.UTC(2026, 9, 9 - daysAgo, hour, 24, 0)).toISOString();

const SPOT_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'PEPE/USDT', 'SHIB/USDT', 'ICP/USDT', 'DOGE/USDT'];
const FUTURES_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
const PRICE = { BTC: 108436.17, ETH: 3921.45, SOL: 182.31, XRP: 2.8534, PEPE: 0.00001234, SHIB: 0.00002118, ICP: 12.4471, DOGE: 0.24891 };
const NAME = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', PEPE: 'Pepe', SHIB: 'Shiba Inu', ICP: 'Internet Computer Protocol', DOGE: 'Dogecoin' };
const CHANGE = { BTC: 1.25, ETH: -0.84, SOL: 4.12, XRP: -12.73, PEPE: 38.9, SHIB: -0.02, ICP: 0.4, DOGE: 7.77 };
const baseOf = (pair) => String(pair).toUpperCase().replace(/[-_]/, '/').split('/')[0].replace(/USDT$/, '');
const pairOf = (raw) => { const s = String(raw).toUpperCase().replace('-', '/').replace('_', '/'); return s.includes('/') ? s : s.replace(/USDT$/, '') + '/USDT'; };
const fixed = (value, mid) => value.toFixed(mid >= 1000 ? 2 : mid >= 1 ? 4 : 10).replace(/0+$/, '').replace(/\.$/, '');

const CANDLES = (base) => Array.from({ length: 220 }, (_, i) => {
  const open = base * (1 + Math.sin(i / 9) * 0.012 + i * 0.00004);
  const close = open * (1 + Math.sin(i * 2.1) * 0.0022);
  return { time: Math.floor(NOW() / 1000) - (220 - i) * 60, open, high: Math.max(open, close) * 1.0009, low: Math.min(open, close) * 0.9991, close, volume: 12 + (i % 7) * 3 };
});
function levels(mid, side, count = 18) {
  const step = mid > 1000 ? 0.1 : mid > 10 ? 0.01 : mid > 1 ? 0.001 : mid / 10000;
  return Array.from({ length: count }, (_, i) => {
    const price = side === 'bid' ? mid - step * (i + 1) : mid + step * (i + 1);
    const quantity = (0.15 + ((i * 37) % 23) / 10 + (i === 3 ? 1250.123456 : 0)).toFixed(6);
    return { price: fixed(price, mid), quantity };
  });
}

const DEPOSIT_CATALOGUE = [
  { assetId: 'usdt', asset: 'USDT', networkId: 'tron', networkName: 'Tron', standard: 'TRC-20', address: 'T' + 'QA9'.repeat(11), memo: '', memoLabel: '' },
  { assetId: 'usdt', asset: 'USDT', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + 'a1b2c3d4e5'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'usdt', asset: 'USDT', networkId: 'bsc', networkName: 'BNB Smart Chain', standard: 'BEP-20', address: '0x' + 'f0e1d2c3b4'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'usdc', asset: 'USDC', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + '9a8b7c6d5e'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'btc', asset: 'BTC', networkId: 'bitcoin', networkName: 'Bitcoin', standard: 'Native', address: 'bc1q' + 'qa7x'.repeat(9) + 'qa', memo: '', memoLabel: '' },
  { assetId: 'eth', asset: 'ETH', networkId: 'ethereum', networkName: 'Ethereum', standard: 'ERC-20', address: '0x' + '0123456789'.repeat(4), memo: '', memoLabel: '' },
  { assetId: 'ton', asset: 'TON', networkId: 'ton', networkName: 'The Open Network', standard: 'Native', address: 'UQ' + 'QAtonQAton'.repeat(4) + 'QA', memo: '77300123', memoLabel: 'Memo' },
  { assetId: 'xrp', asset: 'XRP', networkId: 'xrp', networkName: 'XRP Ledger', standard: 'Native', address: 'r' + 'QAxrpQAxrp'.repeat(3) + 'Q', memo: '4410029', memoLabel: 'Destination Tag' },
].map(e => ({ ...e, memoAllowed: Boolean(e.memo), enabled: true, status: 'configured' }));

const LONG_EMAIL = 'maximilian.aleksandrovich.dolgorukov-voronezhsky@corporate-mail-services.example';
const LONG_ADDRESS = 'bc1q' + 'qa7x'.repeat(9) + 'qa';
const USER_ID = 'qa-mobile-audit-viewer';

/** Copy-trading marketplace from the compiled, unchanged backend router. */
function copyTradingRouter(jwtSecret) {
  const { copyPerformanceRouter } = require(path.join(root, 'dist/api/routes/copyPerformance'));
  const { CopyPerformanceService } = require(path.join(root, 'dist/services/copyTrading/CopyPerformanceService'));
  const jwt = require('jsonwebtoken');
  const scenarios = new Map();
  const sid = 'qa-session-mobile-audit';
  const session = { id: sid, userId: USER_ID, revokedAt: null, lastSeenAt: new Date() };
  const avatarFile = path.join(root, 'frontend/public/copy-trading/avatars/moon-rabbit.webp');
  const fixtureAvatar = fs.existsSync(avatarFile) ? 'data:image/webp;base64,' + fs.readFileSync(avatarFile).toString('base64') : null;
  const identities = new Map([
    ['VX-001', { publicName: 'Nazar', ownerUserId: 'qa-nazar-owner', premium: true }],
    ['VX-KSENIA', { publicName: 'Ksenia', ownerUserId: 'qa-ksenia-owner', premium: true }],
  ]);
  const ownerRows = new Map([
    ['qa-nazar-owner', { avatarUrl: null, kycStatus: 'NOT_STARTED' }],
    ['qa-ksenia-owner', { avatarUrl: fixtureAvatar, kycStatus: 'NOT_STARTED' }],
  ]);
  const db = {
    copyPerformanceScenario: {
      async findUnique({ where }) { const row = scenarios.get(where.id); return row ? { ...row } : null; },
      async create({ data }) {
        if (scenarios.has(data.id)) throw Object.assign(new Error('Unique scenario'), { code: 'P2002' });
        const row = { ...data, revision: 0 }; scenarios.set(data.id, row); return { ...row };
      },
      async updateMany({ where, data }) {
        const row = scenarios.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        scenarios.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 };
      },
    },
    copyStrategyOwner: { async findUnique({ where }) { return identities.get(where.traderId) || null; } },
    user: { async findUnique({ where }) { return ownerRows.get(where.id) || null; } },
    session: {
      async findUnique({ where }) { return where.id === sid ? session : null; },
      async update({ data }) { Object.assign(session, data); return session; },
    },
  };
  const service = new CopyPerformanceService(db, () => new Date('2026-10-09T12:00:00Z'));
  const token = jwt.sign({ sub: USER_ID, sid }, jwtSecret, { expiresIn: '12h' });
  return { router: copyPerformanceRouter(db, service), token };
}

function createFixture({ dist = path.join(root, 'frontend/dist') } = {}) {
  dist = path.resolve(dist);
  process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(48).toString('hex');
  delete process.env.DATABASE_URL; delete process.env.DIRECT_URL;
  const copy = copyTradingRouter(process.env.JWT_SECRET);
  const state = { requests: [], unknown: [] };
  const app = express();
  app.disable('x-powered-by');
  app.use((q, r, next) => {
    state.requests.push({ method: q.method, path: q.path, at: NOW() });
    // One POST is answered: /banking/calculate is a pure projection (the page
    // POSTs the inputs and shows the figures; nothing is stored anywhere).
    // It is computed below from the fixture's own programme table. Every
    // other non-GET request is refused with 405.
    if (!['GET', 'HEAD'].includes(q.method) && !(q.method === 'POST' && q.path === '/api/v1/banking/calculate')) return r.status(405).json({ error: 'Read-only mobile audit fixture' });
    r.setHeader('Cache-Control', 'no-store');
    next();
  });

  const spotRows = SPOT_PAIRS.map(pair => { const b = baseOf(pair); return ({ pair, symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'spot', baseAsset: b, quoteAsset: 'USDT', lastPrice: PRICE[b], high24h: PRICE[b] * 1.032, low24h: PRICE[b] * 0.954, changePercent24h: CHANGE[b], quoteVolume24h: b === 'BTC' ? 3.19e9 : b === 'PEPE' ? 12345678.9 : 8.4e7, volume24h: b === 'PEPE' ? 9.9e12 : 15000, receivedAt: NOW(), fetchedAt: NOW(), stale: false }); });
  const futRows = FUTURES_PAIRS.map(pair => { const base = baseOf(pair), row = spotRows.find(r => r.pair === pair);
    return { ...row, id: `linear_perpetual:${base}USDT`, provider: 'bybit', marketType: 'linear_perpetual', settleAsset: 'USDT', providerSymbol: `${base}USDT`,
      volumeAsset: base, turnoverAsset: 'USDT', markPrice: row.lastPrice * 0.99997, indexPrice: row.lastPrice * 0.9991, fundingRate: 0.0001, nextFundingTime: NOW() + 3 * 3600_000,
      openInterest: 30894.9, turnover24h: 3.19e9, bidPrice: row.lastPrice * 0.99999, askPrice: row.lastPrice * 1.00001 }; });
  const display = (value, refreshMs = 60000) => ({ ...value, _display: { mode: 'snapshot', capturedAt: NOW(), refreshMs } });
  const tickerOf = (x) => ({ pair: x.pair, lastPrice: String(x.lastPrice), bidPrice: String(x.lastPrice * 0.99999), askPrice: String(x.lastPrice * 1.00001), high24h: String(x.high24h), low24h: String(x.low24h), changePercent: String(x.changePercent24h), changePercent24h: String(x.changePercent24h), quoteVolume24h: String(x.quoteVolume24h), volume24h: String(x.volume24h) });

  // ---- market ----
  app.get(['/api/v1/market/display', '/api/v1/market/display/futures-tickers'], (_q, r) => r.json(display({ version: 1, type: 'snapshot', epoch: 'fixture', revision: 1, status: 'live', rows: futRows })));
  app.get('/api/v1/market/display/spot-snapshot', (_q, r) => r.json(display({ tickers: { available: true, source: 'fixture', fetchedAt: NOW(), stale: false, value: spotRows }, overview: { available: true, source: 'fixture', fetchedAt: NOW(), stale: false, value: { totalVolume24hUsd: 1.23e11, totalMarketCapUsd: 3.78e12, btcDominancePercent: 57.3, ethDominancePercent: 12.1, marketCapChangePercent24h: -1.42 } }, sentiment: { available: true, source: 'fixture', fetchedAt: NOW(), stale: false, value: { value: 71, classification: 'Greed', updatedAt: NOW() } } })));
  app.get(['/api/v1/market/display/spot-book/:symbol', '/api/v1/market/display/futures-book/:symbol'], (q, r) => {
    const mid = PRICE[baseOf(q.params.symbol)] ?? 100;
    r.json(display({ available: true, pair: pairOf(q.params.symbol), symbol: q.params.symbol, updateId: Math.floor(NOW() / 1000), timestamp: NOW(), fetchedAt: NOW(), stale: false, bids: levels(mid, 'bid'), asks: levels(mid, 'ask') }));
  });
  const tradesOf = (symbol, mid) => Array.from({ length: 30 }, (_, i) => ({ id: `${symbol}-t${i}`, price: fixed(mid * (1 + Math.sin(i) * 0.0004), mid), quantity: (0.01 + (i % 9) * 0.37 + (i === 5 ? 12500.5 : 0)).toFixed(4), side: i % 3 ? 'BUY' : 'SELL', time: NOW() - i * 4100 }));
  app.get('/api/v1/market/display/futures-trades/:symbol', (q, r) => r.json(display({ available: true, symbol: q.params.symbol, fetchedAt: NOW(), stale: false, trades: tradesOf(q.params.symbol, PRICE[baseOf(q.params.symbol)] ?? 100) })));
  app.get('/api/v1/market/display/spot-trades/:symbol', (q, r) => r.json(display({ available: true, pair: pairOf(q.params.symbol), symbol: q.params.symbol, fetchedAt: NOW(), stale: false, trades: tradesOf(q.params.symbol, PRICE[baseOf(q.params.symbol)] ?? 100) })));
  app.get('/api/v1/market/display/futures-candles/:symbol', (q, r) => { const list = CANDLES(PRICE[baseOf(q.params.symbol)] ?? 100).reverse().map(c => [String(c.time * 1000), ...[c.open, c.high, c.low, c.close].map(v => v.toFixed(v > 1 ? 2 : 10)), String(c.volume)]); r.json(display({ retCode: 0, result: { category: 'linear', symbol: q.params.symbol, list } })); });
  app.get('/api/v1/market/display/spot-candles/:symbol', (q, r) => r.json(display({ available: true, pair: pairOf(q.params.symbol), interval: q.query.interval, fetchedAt: NOW(), stale: false, candles: CANDLES(PRICE[baseOf(q.params.symbol)] ?? 100) })));
  app.get('/api/v1/market/display/spot-tickers', (_q, r) => r.json(display({ available: true, source: 'fixture', fetchedAt: NOW(), stale: false, value: spotRows, tickers: spotRows })));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ source: 'fixture', tickers: spotRows.map(tickerOf) }));
  app.get(['/api/v1/market/external/ticker/:p', '/api/v1/market/external/tickers/:p'], (q, r) => { const x = spotRows.find(s => s.pair === pairOf(q.params.p)) ?? spotRows[0]; r.json({ source: 'fixture', ticker: tickerOf(x), ...tickerOf(x) }); });
  app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ source: 'fixture', symbols: SPOT_PAIRS.map(p => ({ pair: p, baseAsset: baseOf(p), quoteAsset: 'USDT' })) }));
  app.get('/api/v1/market/pairs', (_q, r) => r.json(SPOT_PAIRS.map(p => ({ pair: p, base: baseOf(p), quote: 'USDT' }))));
  app.get('/api/v1/market/snapshot', (_q, r) => r.json({ pairs: spotRows.map(x => ({ pair: x.pair, lastPrice: x.lastPrice, changePercent: x.changePercent24h, high24h: x.high24h, low24h: x.low24h, quoteVolume24h: x.quoteVolume24h })), fetchedAt: NOW() }));
  app.get('/api/v1/market/assets/icons', (_q, r) => r.json({ icons: {} }));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'fixture', rankings: SPOT_PAIRS.map((p, i) => { const b = baseOf(p); return { symbol: b, rank: i + 1, name: NAME[b], image: '', categories: i % 2 ? ['layer-1', 'smart-contracts'] : ['meme'], price: PRICE[b], changePercent24h: CHANGE[b], changePercent7d: CHANGE[b] * 2.3, changePercent30d: -CHANGE[b] * 1.1, volume24h: 1.2e9 / (i + 1), marketCap: 2.1e12 / (i + 1), sparkline: Array.from({ length: 24 }, (_, k) => PRICE[b] * (1 + Math.sin(k / 3) * 0.02)) }; }) }));
  app.get('/api/v1/market/global', (_q, r) => r.json({ source: 'fixture', global: { totalVolume24hUsd: 1.23e11, totalMarketCapUsd: 3.78e12, btcDominancePercent: 57.3, ethDominancePercent: 12.1, marketCapChangePercent24h: -1.42 }, fearGreed: { value: 71, classification: 'Greed', updatedAt: NOW() } }));
  app.get('/api/v1/market/featured-trader', (_q, r) => r.json({ avatarUrl: null }));
  app.get(['/api/v1/market/external/candles/:p', '/api/v1/candles/:p'], (q, r) => r.json({ pair: pairOf(q.params.p), interval: q.query.interval, candles: CANDLES(PRICE[baseOf(q.params.p)] ?? 100) }));
  app.get('/api/v1/market/futures/candles/:p', (q, r) => {
    const symbol = pairOf(q.params.p).replace('/', '');
    const list = CANDLES(PRICE[baseOf(q.params.p)] ?? 100).reverse().map(c => [String(c.time * 1000), ...[c.open, c.high, c.low, c.close].map(v => v.toFixed(v > 1 ? 2 : 10)), String(c.volume)]);
    r.json({ retCode: 0, result: { category: 'linear', symbol, list } });
  });
  app.get('/api/v1/market/external/trades/:p', (q, r) => { const mid = PRICE[baseOf(q.params.p)] ?? 100; r.json({ pair: pairOf(q.params.p), trades: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, price: fixed(mid * (1 + Math.sin(i) * 0.0004), mid), quantity: (0.01 + (i % 9) * 0.37 + (i === 5 ? 12500.5 : 0)).toFixed(4), side: i % 3 ? 'BUY' : 'SELL', time: NOW() - i * 4100 })) }); });
  app.get('/api/v1/market/external/orderbook/:p', (q, r) => { const mid = PRICE[baseOf(q.params.p)] ?? 100; r.json({ bids: levels(mid, 'bid').map(l => [Number(l.price), Number(l.quantity)]), asks: levels(mid, 'ask').map(l => [Number(l.price), Number(l.quantity)]), fetchedAt: NOW() }); });
  app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: FUTURES_PAIRS.map(p => ({ symbol: p, providerSymbol: p.replace('/', ''), marketType: 'linear_perpetual', baseAsset: baseOf(p), quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
  app.get('/api/v1/market/derivatives/:a', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: NOW(), stale: false, value: { turnover24hUsd: 3.19e9, openInterestBase: 30894.9, openInterestUsd: 9.2e8, fundingRate: 0.0001, nextFundingTime: NOW() + 3 * 3600_000 } }));
  const LISTING_AT = NOW() + 36 * 3600_000;
  const vta = () => ({ pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false, status: 'upcoming', listingArmed: true, listingAt: new Date(LISTING_AT).toISOString(), initialPrice: 0.01, state: { phase: 'pre-listing', lastPrice: null, serverTime: NOW() } });
  app.get('/api/v1/market/test-assets', (_q, r) => r.json({ serverTime: NOW(), assets: [vta()] }));
  app.get('/api/v1/market/test-assets/:slug/candles', (_q, r) => r.json({ candles: [] }));
  app.get(['/api/v1/market/listings', '/api/v1/market/nrx'], (_q, r) => r.json({ serverTime: NOW(), assets: [] }));
  app.get('/api/v1/market/live', (_q, r) => { r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); r.write(': open\n\n'); });
  app.get('/api/v1/orderbook/:p', (q, r) => { const mid = PRICE[baseOf(q.params.p)] ?? 100; r.json({ bids: levels(mid, 'bid').map(l => [l.price, l.quantity]), asks: levels(mid, 'ask').map(l => [l.price, l.quantity]) }); });

  // ---- futures ----
  app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: FUTURES_PAIRS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 25, leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }] }));
  app.get('/api/v1/futures/mark-price/:s', (q, r) => { const p = PRICE[baseOf(q.params.s)] ?? 100; r.json({ symbol: q.params.s, markPrice: String(p * 0.99997), indexPrice: String(p * 0.9991) }); });
  app.get('/api/v1/futures/funding-rate/:s', (_q, r) => r.json({ history: [{ rate: '0.0001', markPrice: '108432.45', indexPrice: '108123.99', appliedAt: new Date().toISOString() }] }));
  app.get('/api/v1/futures/open-interest/:s', (_q, r) => r.json({ available: true, value: { openInterestBase: 30894.9 } }));
  app.get('/api/v1/futures/orderbook/:s', (q, r) => { const mid = PRICE[baseOf(q.params.s)] ?? 100; r.json({ bids: levels(mid, 'bid'), asks: levels(mid, 'ask') }); });
  app.get('/api/v1/futures/balances', (_q, r) => r.json([{ asset: 'USDT', available: '12345678.91', locked: '2345.67' }]));
  const POSITIONS = [
    { id: 'qa-pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '0.025', entryPrice: '106260.40', leverage: 10, marginType: 'CROSS', initialMargin: '265.65', liquidationPrice: '96118.20', markPrice: '108432.45', unrealizedPnl: '54.30', realizedPnl: '0', roe: '20.44', openedAt: ISO(1), protection: { takeProfit: null, stopLoss: null } },
    { id: 'qa-pos-2', symbol: 'DOGE/USDT', side: 'SHORT', size: '1250000', entryPrice: '0.21004', leverage: 50, marginType: 'ISOLATED', initialMargin: '5251.00', liquidationPrice: '0.21424', markPrice: '0.24890', unrealizedPnl: '-48575.00', realizedPnl: '-1234.56', roe: '-925.06', openedAt: ISO(3), protection: { takeProfit: { price: '0.18000', triggerBy: 'MARK' }, stopLoss: { price: '0.21300', triggerBy: 'MARK' } } },
  ];
  app.get('/api/v1/futures/positions', (_q, r) => r.json(POSITIONS));
  app.get('/api/v1/futures/positions/history', (_q, r) => r.json([
    { id: 'qa-hist-1', symbol: 'ETH/USDT', side: 'LONG', leverage: 20, marginType: 'CROSS', entryPrice: '3810.12', realizedPnl: '1234.56', status: 'CLOSED', openedAt: ISO(5), closedAt: ISO(4) },
    { id: 'qa-hist-2', symbol: 'XRP/USDT', side: 'SHORT', leverage: 5, marginType: 'ISOLATED', entryPrice: '3.1234', realizedPnl: '-98765.4321', status: 'LIQUIDATED', openedAt: ISO(9), closedAt: ISO(8) },
  ]));
  const FUT_ORDERS = [
    { id: 'qa-fo-1', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '104000.00', originalQuantity: '0.5', remainingQuantity: '0.5', status: 'OPEN', reduceOnly: false, leverage: 10, marginType: 'CROSS', createdAt: ISO(0, 8) },
    { id: 'qa-fo-2', symbol: 'DOGE/USDT', side: 'SELL', type: 'LIMIT', price: '0.26000', originalQuantity: '2500000', remainingQuantity: '1234567', status: 'PARTIALLY_FILLED', reduceOnly: true, leverage: 50, marginType: 'ISOLATED', createdAt: ISO(1, 8) },
  ];
  app.get(['/api/v1/futures/orders/me', '/api/v1/futures/orders'], (q, r) => r.json(q.query.status === 'OPEN' || !q.query.status ? FUT_ORDERS : [...FUT_ORDERS.map(o => ({ ...o, status: 'FILLED', remainingQuantity: '0' })), { ...FUT_ORDERS[0], id: 'qa-fo-3', status: 'CANCELLED', createdAt: ISO(4, 8) }]));

  // ---- spot ----
  const BALANCES = [
    { asset: 'USDT', available: '32726245.123456', locked: '150000' },
    { asset: 'BTC', available: '268.51234567', locked: '2.5' },
    { asset: 'XRP', available: '1200000', locked: '0' },
    { asset: 'ETH', available: '0.00412', locked: '0' },
    { asset: 'PEPE', available: '98765432109.87', locked: '0' },
    { asset: 'ICP', available: '0', locked: '0' },
  ];
  app.get('/api/v1/balances', (_q, r) => r.json(BALANCES));
  const ORDERS = [
    { id: 'qa-order-1', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '104000.00', triggerPrice: null, ocoGroupId: null, originalQuantity: '0.75', remainingQuantity: '0.75', status: 'OPEN', createdAt: ISO(0, 9) },
    { id: 'qa-order-2', pair: 'PEPE/USDT', side: 'SELL', type: 'STOP_LIMIT', price: '0.00001400', triggerPrice: '0.00001350', ocoGroupId: null, originalQuantity: '12345678901', remainingQuantity: '12345678901', status: 'PENDING_TRIGGER', createdAt: ISO(1, 9) },
    { id: 'qa-order-3', pair: 'ETH/USDT', side: 'BUY', type: 'LIMIT', price: '3500.00', triggerPrice: null, ocoGroupId: 'oco-1', originalQuantity: '10', remainingQuantity: '4.5', status: 'PARTIALLY_FILLED', createdAt: ISO(2, 9) },
  ];
  app.get(['/api/v1/orders/me', '/api/v1/orders', '/api/v1/orders/history'], (q, r) => {
    const status = String(q.query.status || '');
    if (status === 'PENDING_TRIGGER') return r.json(ORDERS.filter(o => o.status === 'PENDING_TRIGGER'));
    if (status && status !== 'OPEN') return r.json([{ ...ORDERS[0], id: 'qa-order-h1', status: 'FILLED', remainingQuantity: '0', createdAt: ISO(6, 9) }, { ...ORDERS[2], id: 'qa-order-h2', status: 'CANCELLED', createdAt: ISO(7, 9) }]);
    return r.json(ORDERS);
  });
  app.get('/api/v1/trades/me', (_q, r) => r.json([
    { id: 'qa-trade-1', pair: 'BTC/USDT', side: 'BUY', price: '106260.40', quantity: '0.1', executedAt: ISO(1, 8) },
    { id: 'qa-trade-2', pair: 'PEPE/USDT', side: 'SELL', price: '0.00001234', quantity: '9876543210.5', executedAt: ISO(2, 8) },
    { id: 'qa-trade-3', pair: 'XRP/USDT', side: 'SELL', price: '2.8534', quantity: '1500', executedAt: ISO(3, 8) },
  ]));

  // ---- cfd ----
  const CFD = [
    { symbol: 'XAUUSD', name: 'Gold Spot / U.S. Dollar', price: '2650.34', changePercent24h: '0.41' },
    { symbol: 'EURUSD', name: 'Euro / U.S. Dollar', price: '1.08421', changePercent24h: '-0.12' },
    { symbol: 'NAS100', name: 'US Tech 100 Index Cash CFD', price: '19876.5', changePercent24h: '1.87' },
    { symbol: 'USOIL', name: 'Crude Oil WTI', price: '71.23', changePercent24h: '-2.54' },
  ];
  const cfdTicker = (x) => ({ ...x, status: 'sampled', stale: false, marketClosed: false, displayOnly: true, executionAllowed: false, provider: 'fixture', providerSymbol: x.symbol, providerTimestamp: NOW(), fetchedAt: NOW(), asOf: NOW(), maxQuoteAgeMs: 21600000 });
  app.get('/api/v1/cfd/display/tickers', (_q, r) => r.json(display({ configured: true, tickers: CFD.map(cfdTicker) }, 21600000)));
  app.get('/api/v1/cfd/display/candles/:symbol', (q, r) => { const base = Number(CFD.find(c => c.symbol === q.params.symbol)?.price ?? 100); r.json(display({ symbol: q.params.symbol, interval: q.query.interval, fetchedAt: NOW(), bars: CANDLES(base).map(c => ({ ...c, openTime: c.time * 1000 })) }, 21600000)); });
  app.get('/api/v1/cfd/tickers', (_q, r) => r.json({ source: 'fixture', configured: true, tickers: CFD.map(cfdTicker) }));
  app.get('/api/v1/cfd/config', (_q, r) => r.json({ symbols: CFD.map(c => c.symbol), minLeverage: 1, maxLeverage: 20, newAccountMaxLeverage: 5, newAccountPeriodDays: 30, highLeverageWarningThreshold: 10, leverageTiers: [{ notionalCap: 1e9, maxLeverage: 20, maintenanceMarginRate: 0.01, maintenanceAmount: 0 }] }));
  app.get('/api/v1/cfd/positions', (_q, r) => r.json([{ id: 'qa-cfd-1', symbol: 'XAUUSD', side: 'LONG', size: '12.5', entryPrice: '2601.10', leverage: 20, initialMargin: '1625.69', liquidationPrice: '2480.00', status: 'OPEN', realizedPnl: '0', openedAt: ISO(2), closedAt: null, markPrice: '2650.34', unrealizedPnl: '615.50', roe: '37.86' }]));
  app.get('/api/v1/cfd/positions/history', (_q, r) => r.json([{ id: 'qa-cfd-h1', symbol: 'EURUSD', side: 'SHORT', size: '100000', entryPrice: '1.09210', leverage: 10, initialMargin: '10921.00', liquidationPrice: '1.20000', status: 'CLOSED', realizedPnl: '-789.00', openedAt: ISO(6), closedAt: ISO(5) }]));
  app.get('/api/v1/cfd/instruments', (_q, r) => r.json({ instruments: CFD.map(c => ({ symbol: c.symbol, displayName: c.name, category: 'cfd' })) }));
  app.get('/api/v1/cfd/quotes', (_q, r) => r.json({ quotes: CFD.map(c => ({ symbol: c.symbol, bid: Number(c.price) * 0.9999, ask: Number(c.price) * 1.0001, changePercent: Number(c.changePercent24h) })) }));
  app.get('/api/v1/cfd/candles/:s', (q, r) => { const base = Number(CFD.find(c => c.symbol === q.params.s)?.price ?? 100); r.json({ symbol: q.params.s, interval: q.query.interval, candles: CANDLES(base) }); });

  // ---- account ----
  const ME = { id: USER_ID, email: LONG_EMAIL, displayName: 'Максимилиан Александрович Долгоруков-Воронежский', phone: '+380 (97) 123-45-67', country: 'UA', avatarUrl: null, isAdmin: false, role: 'USER', kycStatus: 'REJECTED', twoFactorEnabled: true, createdAt: ISO(400) };
  app.get('/api/v1/me', (_q, r) => r.json(ME));
  app.get('/api/v1/kyc/me', (_q, r) => r.json({ kycStatus: 'REJECTED', latestSubmission: { id: 'qa-sub-1', country: 'UA', fullName: 'Максимилиан Александрович Долгоруков-Воронежский', documentType: 'PASSPORT', status: 'REJECTED', rejectionReason: 'Фотография документа размыта, машиночитаемая зона не читается, а срок действия документа истёк. Загрузите новое фото обеих сторон при хорошем освещении.', createdAt: ISO(3) } }));
  app.get('/api/v1/account/security-log', (_q, r) => r.json([0, 1, 2, 3].map(i => ({ id: `log-${i}`, action: ['LOGIN', 'PASSWORD_CHANGED', 'LOGIN', 'TWO_FACTOR_ENABLED'][i], createdAt: ISO(i, 9), metadata: { ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36' } }))));
  app.get('/api/v1/me/sessions', (_q, r) => r.json([
    { id: 'qa-s-1', ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36', createdAt: ISO(2), lastSeenAt: ISO(0, 12), current: true, remembered: true },
    { id: 'qa-s-2', ip: '203.0.113.42', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', createdAt: ISO(20), lastSeenAt: ISO(1, 12), current: false, remembered: false },
  ]));
  app.get('/api/v1/api-keys', (_q, r) => r.json([{ id: 'qa-key-1', label: 'Длинное название торгового бота для арбитража на бирже', apiKey: 'vx_live_' + 'a1b2c3d4'.repeat(6), canTrade: true, lastUsedAt: ISO(0, 11), createdAt: ISO(30) }]));
  app.get('/api/v1/referral/me', (_q, r) => r.json({ referralCode: 'VXMAXIMILIAN2026', rewardPercent: 20, referredCount: 1234, rewardsByAsset: [{ asset: 'USDT', amount: '123456.789012' }, { asset: 'BTC', amount: '0.12345678' }], recentRewards: [{ id: 'rw-1', asset: 'USDT', amount: '1234.56', createdAt: ISO(1) }, { id: 'rw-2', asset: 'BTC', amount: '0.00012345', createdAt: ISO(2) }] }));
  app.get('/api/v1/reserves', (_q, r) => r.json([{ chain: 'tron', asset: 'USDT', treasuryAddress: 'T' + 'QA9'.repeat(11), internalLiabilities: '32876245.12', onChainBalance: '41234567.89', coverageRatio: 1.254 }, { chain: 'bitcoin', asset: 'BTC', treasuryAddress: LONG_ADDRESS, internalLiabilities: '271.01234567', onChainBalance: null, coverageRatio: null }]));
  app.get('/api/v1/private-trading/access', (_q, r) => r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/private-trading/native/wallet', (_q, r) => r.status(404).json({ error: 'not_available' }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/card/application/me', (_q, r) => r.status(404).json({ error: 'not_found' }));

  // ---- wallet ----
  const spotValued = BALANCES.map(b => ({ ...b, priceUsd: PRICE[b.asset] ?? (b.asset === 'USDT' ? 1 : null), valueUsd: (Number(b.available) + Number(b.locked)) * (PRICE[b.asset] ?? (b.asset === 'USDT' ? 1 : 0)) }));
  const spotValueUsd = spotValued.reduce((s, b) => s + b.valueUsd, 0);
  const futValued = [{ asset: 'USDT', available: '12345678.91', locked: '2345.67', priceUsd: 1, valueUsd: 12348024.58 }];
  const totalValueUsd = spotValueUsd + futValued[0].valueUsd;
  app.get('/api/v1/wallet/overview', (_q, r) => r.json({
    real: { spot: spotValued, futures: futValued, spotValueUsd, futuresValueUsd: futValued[0].valueUsd, totalValueUsd },
    balances: { spot: spotValued, futures: futValued, spotValueUsd, futuresValueUsd: futValued[0].valueUsd, totalValueUsd },
    presentation: null, displaySpotUsd: spotValueUsd, displayFuturesUsd: futValued[0].valueUsd, displayTotalUsd: totalValueUsd,
    valuationComplete: false, unpricedAssets: ['ICP'], btcPriceUsd: PRICE.BTC,
  }));
  const periods = Object.fromEntries(['7d', '30d', '90d', '1y', 'all'].map((period, i) => {
    const pnl = [-43212.25, 128450.5, -368210.1, 1098205.05, 13420750.75][i];
    const points = Array.from({ length: 10 }, (_, day) => ({ date: `2026-09-${String(day + 1).padStart(2, '0')}`, equity: totalValueUsd - pnl + pnl * day / 9 }));
    return [period, { period, available: true, startDate: points[0].date, endDate: points.at(-1).date, startEquity: totalValueUsd - pnl, endEquity: totalValueUsd, absolutePnl: pnl, percent: pnl / (totalValueUsd - pnl) * 100, points }];
  }));
  app.get('/api/v1/wallet/performance', (_q, r) => r.json({ ageDays: 400, startedOn: '2025-09-04', periods }));
  app.get('/api/v1/wallet/portfolio-history', (_q, r) => r.json({ points: Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, totalValueUsd: String(totalValueUsd * (0.9 + i / 120)) })) }));
  app.get('/api/v1/deposits/me', (_q, r) => r.json([
    { id: 'qa-dep-1', asset: 'USDT', chain: 'tron', txHash: 'f'.repeat(64), amount: '1200000', confirmations: 20, status: 'CREDITED', createdAt: ISO(2) },
    { id: 'qa-dep-2', asset: 'BTC', chain: 'bitcoin', txHash: null, amount: '0.01234567', confirmations: 1, status: 'PENDING', createdAt: ISO(1) },
    { id: 'qa-dep-3', asset: 'USDT', chain: 'tron', txHash: 'a'.repeat(64), amount: '15', confirmations: 20, status: 'BELOW_MINIMUM', createdAt: ISO(0) },
  ]));
  app.get('/api/v1/withdrawals/me', (_q, r) => r.json([
    { id: 'qa-wd-1', asset: 'XRP', network: 'native', toAddress: 'r' + 'QAxrpQAxrp'.repeat(3) + 'Q', amount: '350000', status: 'SENT', rejectionReason: null, createdAt: ISO(3) },
    { id: 'qa-wd-2', asset: 'USDT', network: 'TRC20', toAddress: 'T' + 'QA9'.repeat(11), amount: '250000.5', status: 'PENDING', rejectionReason: null, createdAt: ISO(1) },
    { id: 'qa-wd-3', asset: 'BTC', network: 'native', toAddress: LONG_ADDRESS, amount: '0.001', status: 'REJECTED', rejectionReason: 'Адрес не прошёл проверку риск-отдела: получатель находится в санкционном списке. Средства возвращены на спотовый баланс.', createdAt: ISO(5) },
  ]));
  app.get('/api/v1/withdrawals/options', (_q, r) => r.json({ source: 'SPOT', assets: BALANCES.map(b => ({ asset: b.asset, available: b.available })), futures: [{ asset: 'USDT', available: '12345678.91' }] }));
  app.get(['/api/v1/products', '/api/v1/purchases/me'], (_q, r) => r.json([]));
  const CHAINS = [
    { chain: 'tron', nativeAsset: 'TRX', tokens: ['USDT'], supportedAssets: ['USDT', 'TRX'], address: 'T' + 'QA9'.repeat(11) },
    { chain: 'ethereum', nativeAsset: 'ETH', tokens: ['USDT', 'USDC'], supportedAssets: ['ETH', 'USDT', 'USDC'], address: '0x' + 'a1b2c3d4e5'.repeat(4) },
    { chain: 'bitcoin', nativeAsset: 'BTC', tokens: [], supportedAssets: ['BTC'], address: LONG_ADDRESS },
  ];
  app.get('/api/v1/deposit-chains', (_q, r) => r.json({ chains: CHAINS, minDepositUsd: 300, usdPeggedAssets: ['USDT', 'USDC'], version: 'qa-v1' }));
  app.get('/api/v1/deposit-config-version', (_q, r) => r.json({ version: 'qa-v1' }));
  app.get('/api/v1/deposit-address/:chain', (q, r) => { const c = CHAINS.find(x => x.chain === q.params.chain) ?? CHAINS[0]; r.json({ chain: c.chain, address: c.address, nativeAsset: c.nativeAsset, tokens: c.tokens }); });
  app.get('/api/v1/deposit-catalogue', (_q, r) => r.json({ version: 'qa-1', entries: DEPOSIT_CATALOGUE }));
  app.get('/api/v1/deposit-address-copies', (_q, r) => r.json([]));

  // ---- banking ----
  const PROGRAMS = [
    { id: 'MONTHLY_17_24M', name: 'Ежемесячные выплаты 17% на 24 месяца', monthlyRate: '1.4167', termMonths: 24, minUsd: '2500', assets: ['USDT', 'USDC', 'BTC', 'ETH', 'SOL'], compound: false, payoutFrequency: 'MONTHLY', lockRule: 'Досрочное закрытие недоступно до окончания срока размещения', enabled: true, availableFrom: null, availableUntil: null },
    { id: 'COMPOUND_21_12M', name: 'Капитализация 21% на 12 месяцев', monthlyRate: '1.75', termMonths: 12, minUsd: '2500', assets: ['USDT', 'USDC'], compound: true, payoutFrequency: 'MATURITY', lockRule: 'Выплата при погашении', enabled: true, availableFrom: null, availableUntil: null },
  ];
  const cardYield = { annualRate: '6', asset: 'USDT', locked: false, availableCardBalance: '12345.67', accruedReward: '123.4567', dataStatus: 'available' };
  app.get('/api/v1/banking/config', (_q, r) => r.json({ programs: PROGRAMS, assets: ['USDT', 'USDC', 'BTC', 'ETH', 'SOL'].map(a => ({ asset: a, priceUsd: String(PRICE[a] ?? 1), minimumAssetQty: String(2500 / (PRICE[a] ?? 1)) })), rewardCurrencyRule: 'Вознаграждение начисляется в активе размещения', usdValuesAreReferenceOnly: true, cardYield }));
  app.get('/api/v1/banking/state', (_q, r) => r.json({ placements: [
    { id: 'qa-pl-1', programId: 'MONTHLY_17_24M', programName: PROGRAMS[0].name, asset: 'BTC', principal: '1.23456789', monthlyRate: '1.4167', termMonths: 24, compound: false, payoutFrequency: 'MONTHLY', lockRule: PROGRAMS[0].lockRule, openedAt: ISO(100), maturityDate: ISO(-630), completedMonths: 3, status: 'ACTIVE', rewardAccrued: '0.05247', currentBalance: '1.28703789', rewardCurrency: 'BTC', priceUsd: String(PRICE.BTC), principalUsd: String(1.23456789 * PRICE.BTC) },
    { id: 'qa-pl-2', programId: 'COMPOUND_21_12M', programName: PROGRAMS[1].name, asset: 'USDT', principal: '1250000', monthlyRate: '1.75', termMonths: 12, compound: true, payoutFrequency: 'MATURITY', lockRule: PROGRAMS[1].lockRule, openedAt: ISO(400), maturityDate: ISO(35), completedMonths: 12, status: 'MATURED', rewardAccrued: '287654.32', currentBalance: '1537654.32', rewardCurrency: 'USDT', priceUsd: '1', principalUsd: '1250000' },
  ], ledger: [{ id: 'l1', placement_id: 'qa-pl-1', entry_type: 'REWARD', asset: 'BTC', amount: '0.01749', period_index: 3, effectiveAt: ISO(10), createdAt: ISO(10) }], summary: { totalUsd: String(1.28703789 * PRICE.BTC + 1537654.32), accruedUsd: String(0.05247 * PRICE.BTC + 287654.32), activeCount: 1 }, cardYield }));
  // Pure projection of the Earn calculator (see the guard above): simple
  // monthly reward or compounding over the programme term, no state.
  app.post('/api/v1/banking/calculate', express.json(), (q, r) => {
    const b = q.body || {};
    const program = PROGRAMS.find(p => p.id === b.programId) || PROGRAMS[0];
    const principal = Number(b.amount);
    if (!Number.isFinite(principal) || principal <= 0) return r.status(400).json({ error: 'invalid_amount', code: 'invalid_amount' });
    const months = Math.max(1, Math.min(program.termMonths, Number(b.periodMonths) || program.termMonths));
    const rate = Number(program.monthlyRate) / 100;
    const monthly = program.compound ? null : principal * rate;
    const balance = program.compound ? principal * Math.pow(1 + rate, months) : principal;
    const totalRewards = program.compound ? balance - principal : monthly * months;
    const start = b.startDate ? new Date(b.startDate) : new Date(NOW());
    const plus = (m) => { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
    const price = PRICE[b.asset] ?? 1;
    const fix = (n) => String(Number(n.toFixed(8)));
    r.json({ programId: program.id, asset: b.asset || 'USDT', principal: fix(principal), completedMonths: months, startDate: start.toISOString().slice(0, 10), endDate: plus(months), maturityDate: plus(program.termMonths),
      monthlyReward: monthly === null ? null : fix(monthly), totalRewards: fix(totalRewards), balance: fix(balance), profit: fix(totalRewards), priceUsd: String(price), minimumAssetQty: String(2500 / price), usdEquivalent: fix(principal * price), rewardCurrency: b.asset || 'USDT' });
  });
  app.get('/api/v1/banking/referral', (_q, r) => r.json({ referralCode: 'VXMAXIMILIAN2026', referralPercent: 20, referredCount: 1234, rewardsByAsset: [{ asset: 'USDT', amount: '123456.78' }], recentRewards: [{ id: 'br-1', asset: 'USDT', amount: '1234.56', sourceProfitAmount: '6172.80', createdAt: ISO(1) }] }));

  // ---- otc ----
  app.get('/api/v1/otc/config', (_q, r) => r.json({ enabled: true, routes: [{ country: 'UA', cityId: 'kyiv', asset: 'USDT', fiat: 'UAH', cashPrecision: 0 }] }));
  app.get('/api/v1/otc/balances', (_q, r) => r.json({ eligible: true, balances: BALANCES.map(b => ({ asset: b.asset, available: b.available })) }));
  app.get('/api/v1/otc/requests', (_q, r) => r.json({ rows: [], hasMore: false }));

  // ---- copy trading (compiled router) ----
  app.use('/api/v1', copy.router);

  app.get('/__qa/requests', (_q, r) => r.json(state.requests));
  app.get('/__qa/unknown', (_q, r) => r.json([...new Set(state.unknown)]));
  app.use('/api/v1', (q, r) => { state.unknown.push(`${q.method} ${q.path}`); r.status(404).json({ error: 'Not in mobile audit fixture', path: q.path }); });
  app.use(express.static(dist, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
  return { app, state, token: copy.token, DEPOSIT_CATALOGUE, SPOT_PAIRS, FUTURES_PAIRS, PRICE };
}

module.exports = { createFixture, SPOT_PAIRS, FUTURES_PAIRS, PRICE, LONG_EMAIL };

if (require.main === module) {
  const { once } = require('node:events');
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4189;
  const { app, token } = createFixture({});
  const server = app.listen(port, '127.0.0.1');
  once(server, 'listening').then(() => {
    console.log(`Mobile audit fixture (read-only, synthetic): http://127.0.0.1:${port}/`);
    console.log(`Sign in by running in DevTools: localStorage.setItem('exchange_token', ${JSON.stringify(token)}); localStorage.setItem('exchange_lang','ru'); location.reload()`);
  });
}
