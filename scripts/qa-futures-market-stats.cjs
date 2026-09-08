#!/usr/bin/env node
/**
 * Local browser-QA harness for the Futures header's two MARKET-reference
 * figures: 24h turnover and open interest, both now sourced from tracked
 * external derivatives venues instead of Kraken SPOT volume and VOLTEX's
 * own book.
 *
 * Same shape and same guarantees as scripts/qa-market-data-gateway.cjs:
 *
 *   - GET only. Every write verb is refused with 405, so no order, no
 *     transfer and no balance change is reachable even by accident.
 *   - Loopback only. It binds 127.0.0.1 and nothing else.
 *   - No production credentials, no database, NO PROVIDER EGRESS. The
 *     fixtures below are the only data source, so nothing this harness
 *     shows is evidence about live Binance or OKX responses.
 *
 * What it is for: confirming that each venue-availability scenario
 * renders the right number, in the right unit, with a source label naming
 * only the venues that actually contributed — and that an outage renders
 * a dash rather than a zero.
 *
 *   node scripts/qa-futures-market-stats.cjs [--port 4195]
 *
 * Scenario is selected per request via `?scenario=` on /__qa/reset:
 *   both | binance | okx | none | usd-only | stale
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 4195;
const DIST = path.join(ROOT, 'frontend', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const now = Date.now();
const PAIRS = [
  ['BTC/USDT', '104235.42', '2.41', '106000', '101500', '18234.5', '1902345678'],
  ['ETH/USDT', '3892.15', '-1.12', '3990', '3820', '92345.1', '359876543'],
  ['SOL/USDT', '214.83', '4.87', '221.40', '203.10', '1284321', '275934120'],
  ['XRP/USDT', '2.4312', '0.94', '2.51', '2.39', '84213456', '204731298'],
  ['DOGE/USDT', '0.38214', '-2.05', '0.3995', '0.3781', '923451234', '352918273'],
];
const tickers = PAIRS.map(([pair, last, chg, hi, lo, vol, qvol]) => ({
  pair, lastPrice: last, bidPrice: last, askPrice: last, high24h: hi, low24h: lo,
  volume24h: vol, quoteVolume24h: qvol, changePercent24h: chg,
}));
const meta = { source: 'kraken', fetchedAt: now, stale: false };
const FUTURES_SYMBOLS = PAIRS.map(([p]) => p);

// ── Tracked-venue derivatives fixtures ───────────────────────────────
//
// Per base asset, per scenario. The numbers differ sharply from the spot
// quoteVolume24h above ON PURPOSE: if the header ever renders the spot
// figure again, the QA screenshot shows it immediately.
//
// BTC's Binance turnover is deliberately far larger than its OKX one, and
// OKX contributes base-unit open interest but NO turnover in the
// `usd-only` scenario — that is the case where the label must fall back
// to USD and relabel, never print a USD notional under a base label.
const VENUE = {
  BTC: {
    binance: { turnover: 18_420_000_000, oiBase: 84_215.4218, oiUsd: null },
    okx: { turnover: 4_180_000_000, oiBase: 21_004.118, oiUsd: null },
  },
  ETH: {
    binance: { turnover: 9_140_000_000, oiBase: 1_284_512.55, oiUsd: null },
    okx: { turnover: 2_210_000_000, oiBase: 402_118.2, oiUsd: null },
  },
  SOL: {
    binance: { turnover: 3_420_000_000, oiBase: 8_412_005.1, oiUsd: null },
    okx: { turnover: 812_000_000, oiBase: 1_920_004.4, oiUsd: null },
  },
  XRP: {
    binance: { turnover: 1_940_000_000, oiBase: 412_004_118, oiUsd: null },
    okx: { turnover: 402_000_000, oiBase: 88_412_004, oiUsd: null },
  },
  DOGE: {
    // A venue that reports ONLY a USD notional. With Binance absent this
    // is the base-units-unavailable path.
    binance: { turnover: 1_120_000_000, oiBase: 9_412_004_118, oiUsd: null },
    okx: { turnover: 240_000_000, oiBase: null, oiUsd: 1_284_000_000 },
  },
};

let scenario = 'both';

function derivatives(baseAsset) {
  const per = VENUE[baseAsset];
  if (!per) return { available: false, reason: 'unsupported_asset', detail: 'Not a tracked contract.' };
  if (scenario === 'none') {
    return { available: false, reason: 'provider_unavailable', detail: 'No tracked venue answered.' };
  }
  const active = scenario === 'binance' ? ['binance']
    : scenario === 'okx' ? ['okx']
    : scenario === 'usd-only' ? ['okx']
    : ['binance', 'okx'];
  // `usd-only` forces the OKX-style base-less shape for every asset.
  const rows = active.map((v) => ({
    venue: v,
    ...(scenario === 'usd-only'
      ? { turnover: per[v].turnover, oiBase: null, oiUsd: 1_284_000_000 }
      : per[v]),
  }));

  const sum = (pick) => {
    const contributing = rows.filter((r) => pick(r) !== null && pick(r) !== undefined);
    if (contributing.length === 0) return [null, []];
    return [contributing.reduce((a, r) => a + pick(r), 0), contributing.map((r) => r.venue)];
  };
  const [turnover24hUsd, turnoverVenues] = sum((r) => r.turnover);
  const [openInterestBase, openInterestBaseVenues] = sum((r) => r.oiBase);
  const [openInterestUsd, openInterestUsdVenues] = sum((r) => r.oiUsd);

  return {
    available: true,
    source: turnoverVenues[0] || openInterestBaseVenues[0] || openInterestUsdVenues[0] || 'binance',
    fetchedAt: now,
    stale: scenario === 'stale',
    value: {
      baseAsset,
      turnover24hUsd, turnoverVenues,
      openInterestBase, openInterestBaseVenues,
      openInterestUsd, openInterestUsdVenues,
    },
  };
}

const hits = new Map();
const record = (p) => hits.set(p.split('?')[0], (hits.get(p.split('?')[0]) || 0) + 1);

function api(pathname, query) {
  if (pathname.startsWith('/api/v1/market/derivatives/')) {
    return derivatives(decodeURIComponent(pathname.split('/').pop()).toUpperCase());
  }
  if (pathname === '/api/v1/market/snapshot') {
    return {
      tickers: { available: true, ...meta, value: tickers },
      overview: { available: false, reason: 'provider_unavailable' },
      sentiment: { available: false, reason: 'provider_unavailable' },
    };
  }
  if (pathname === '/api/v1/market/external/tickers') return { source: 'kraken', tickers };
  if (pathname === '/api/v1/market/external/symbols') {
    return { source: 'kraken', symbols: tickers.map((t) => ({ pair: t.pair, baseAsset: t.pair.split('/')[0], quoteAsset: 'USDT' })) };
  }
  if (pathname.startsWith('/api/v1/market/external/candles/')) return { source: 'kraken', candles: [] };
  if (pathname.startsWith('/api/v1/market/external/orderbook/')) return { source: 'kraken', pair: 'BTC/USDT', bids: [], asks: [], timestamp: now };
  if (pathname.startsWith('/api/v1/market/external/trades/')) return { source: 'kraken', trades: [] };
  if (pathname === '/api/v1/market/assets/icons') return { assets: {} };
  if (pathname === '/api/v1/market/featured-trader') return { avatarUrl: null };
  if (pathname === '/api/v1/futures/config') {
    return { symbols: FUTURES_SYMBOLS, fundingIntervalHours: 8, minLeverage: 1, maxLeverage: 50, newAccountMaxLeverage: 10, newAccountPeriodDays: 30, highLeverageWarningThreshold: 20, leverageTiers: [], maintenanceMarginRate: '0.005' };
  }
  if (pathname.startsWith('/api/v1/futures/mark-price/')) {
    const sym = decodeURIComponent(pathname.split('/').pop()).replace('-', '/');
    const tk = tickers.find((t) => t.pair === sym.toUpperCase());
    return tk ? { symbol: sym, markPrice: tk.lastPrice, indexPrice: tk.lastPrice } : null;
  }
  if (pathname.startsWith('/api/v1/futures/funding-rate/')) {
    return { symbol: 'BTC/USDT', history: [{ rate: '0.00004', appliedAt: now - 3600_000 }] };
  }
  // Untouched by this task, and deliberately still served: the header no
  // longer reads it, so a hit count of 0 below is part of the evidence.
  if (pathname.startsWith('/api/v1/futures/open-interest/')) {
    return { symbol: 'BTC/USDT', openInterest: '0', openInterestValue: '0' };
  }
  if (pathname.startsWith('/api/v1/futures/orderbook/')) return { symbol: 'BTC/USDT', bids: [], asks: [], timestamp: now };
  // ── Signed-in shell fixtures (local identity only; see header) ─────
  if (pathname === '/api/v1/me') {
    return { id: 'qa-user', email: 'qa@localhost.invalid', role: 'USER', createdAt: new Date(now - 86400000 * 400).toISOString(), emailVerified: true, twoFactorEnabled: false, avatarUrl: null, kycStatus: 'NONE' };
  }
  if (pathname === '/api/v1/balances') return [{ asset: 'USDT', available: '25000.00000000', locked: '0' }];
  if (pathname === '/api/v1/futures/balances') return [{ asset: 'USDT', available: '10000.00000000', locked: '0' }];
  if (pathname === '/api/v1/futures/positions') return [];
  if (pathname === '/api/v1/futures/positions/history') return [];
  if (pathname === '/api/v1/futures/orders/me') return [];
  if (pathname === '/api/v1/orders/me') return [];
  if (pathname === '/api/v1/trades/me') return [];
  if (pathname === '/api/v1/products') return [];
  if (pathname === '/api/v1/portfolio/summary') return { totalUsd: '25000', assets: [] };
  if (pathname === '/api/v1/support/conversations/mine') return { conversation: null, messages: [] };
  if (pathname === '/api/v1/referral/me') return { code: 'QA', referredCount: 0 };
  if (pathname === '/api/v1/card/application') return { status: 'NONE', product: null };
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'QA harness is read-only' }));
  }
  if (url.pathname.startsWith('/api/')) {
    record(url.pathname);
    const body = api(url.pathname, url.searchParams);
    if (body === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not in fixture set' }));
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(body));
  }
  if (url.pathname === '/__qa/hits') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(Object.fromEntries(hits)));
  }
  if (url.pathname === '/__qa/reset') {
    hits.clear();
    scenario = url.searchParams.get('scenario') || 'both';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, scenario }));
  }
  const filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (filePath.startsWith(DIST) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(filePath));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(DIST, 'index.html')));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[qa-futures-market-stats] read-only fixture server on http://127.0.0.1:${PORT}`);
});
