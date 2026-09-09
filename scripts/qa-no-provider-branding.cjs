#!/usr/bin/env node
/**
 * Local browser-QA harness for the Market Data Gateway.
 *
 * Serves the real production frontend build over loopback, backed by
 * deterministic fixture responses for the read-only market endpoints.
 * Deliberately narrow:
 *
 *   - GET only. Every write verb is refused with 405, so no order, no
 *     transfer and no balance change is reachable from this harness even
 *     by accident.
 *   - Loopback only. It binds 127.0.0.1 and nothing else.
 *   - No production credentials, no database, no provider egress. The
 *     fixtures below are the only data source.
 *
 * What it is for: confirming that the migrated surfaces render real
 * numbers, that unavailable data renders as a dash rather than a zero,
 * and — the point of the whole task — that the page issues ONE shared
 * market poll instead of one per component. The request log it prints is
 * the evidence for that last claim.
 *
 *   node scripts/qa-market-data-gateway.cjs [--port 4194]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 4194;
// `--dist` lets the same fixtures serve a different build, which is how
// the before/after request counts in the handoff were measured against
// the pre-migration frontend.
const DIST = argv.includes('--dist')
  ? path.resolve(argv[argv.indexOf('--dist') + 1])
  : path.join(ROOT, 'frontend', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

// ── Fixtures ─────────────────────────────────────────────────────────
//
// Shaped exactly like the real gateway output, including provenance and
// freshness. `ZERO_VOLUME` is deliberately a REAL zero: the QA pass has to
// confirm it renders as 0 and not as a dash, the same way an unavailable
// section has to render as a dash and not as 0.

const now = Date.now();
const PAIRS = [
  ['BTC/USDT', '104235.42', '2.41', '106000', '101500', '18234.5', '1902345678'],
  ['ETH/USDT', '3892.15', '-1.12', '3990', '3820', '92345.1', '359876543'],
  ['SOL/USDT', '214.83', '4.87', '221.40', '203.10', '1284321', '275934120'],
  ['XRP/USDT', '2.4312', '0.94', '2.51', '2.39', '84213456', '204731298'],
  ['DOGE/USDT', '0.38214', '-2.05', '0.3995', '0.3781', '923451234', '352918273'],
  ['TRX/USDT', '0.31842', '0.00', '0.3241', '0.3150', '482913745', '153728194'],
  ['ADA/USDT', '1.0421', '3.18', '1.0810', '0.9982', '284917364', '297183645'],
  ['LINK/USDT', '24.918', '-0.44', '25.61', '24.32', '4218394', '105128374'],
  // A genuinely zero-volume market. Must render as 0, never as a dash.
  ['QUIET/USDT', '1.0000', '0.00', '1.0000', '1.0000', '0', '0'],
];

const tickers = PAIRS.map(([pair, last, chg, hi, lo, vol, qvol]) => ({
  pair,
  lastPrice: last,
  bidPrice: last,
  askPrice: last,
  high24h: hi,
  low24h: lo,
  volume24h: vol,
  quoteVolume24h: qvol,
  changePercent24h: chg,
}));

const CATALOGUE = [
  { symbol: 'BTC', id: 'cg:bitcoin', name: 'Bitcoin', rank: 1, tradable: true },
  { symbol: 'ETH', id: 'cg:ethereum', name: 'Ethereum', rank: 2, tradable: true },
  { symbol: 'SOL', id: 'cg:solana', name: 'Solana', rank: 5, tradable: true },
  { symbol: 'XRP', id: 'cg:ripple', name: 'XRP', rank: 6, tradable: true },
  { symbol: 'DOGE', id: 'cg:dogecoin', name: 'Dogecoin', rank: 9, tradable: true },
  { symbol: 'TRX', id: 'cg:tron', name: 'TRON', rank: 11, tradable: true },
  { symbol: 'ADA', id: 'cg:cardano', name: 'Cardano', rank: 12, tradable: true },
  { symbol: 'LINK', id: 'cg:chainlink', name: 'Chainlink', rank: 14, tradable: true },
  { symbol: 'QUIET', id: 'kraken:QUIET', name: 'QUIET', rank: null, tradable: true },
  // Catalogued but NOT tradable — proves the split is visible in the UI.
  { symbol: 'XMR', id: 'cg:monero', name: 'Monero', rank: 30, tradable: false },
];

const assets = CATALOGUE.map((a) => ({
  id: a.id,
  symbol: a.symbol,
  name: a.name,
  logoUrl: null,
  providers: a.tradable ? { coingecko: a.id.replace('cg:', ''), kraken: a.symbol } : { coingecko: a.id.replace('cg:', '') },
  tradingPairs: a.tradable ? [`${a.symbol}/USDT`] : [],
  tradable: a.tradable,
  metadataSource: a.id.startsWith('cg:') ? 'coingecko' : 'kraken',
  rank: a.rank,
  ambiguous: false,
  collidingIds: [],
}));

const meta = { source: 'kraken', fetchedAt: now, stale: false };

const SNAPSHOT = {
  tickers: { available: true, ...meta, value: tickers },
  overview: {
    available: true,
    source: 'coingecko',
    fetchedAt: now,
    stale: false,
    value: {
      totalMarketCapUsd: 3_482_190_000_000,
      totalVolume24hUsd: 148_320_000_000,
      btcDominancePercent: 56.4,
      ethDominancePercent: 12.8,
      marketCapChangePercent24h: 1.92,
    },
  },
  sentiment: {
    available: true,
    source: 'alternative.me',
    fetchedAt: now,
    stale: false,
    value: { value: 68, classification: 'Greed', updatedAt: Math.floor(now / 1000) },
  },
};

// The degraded variant, for the unavailable-never-becomes-zero check.
const DEGRADED = {
  tickers: SNAPSHOT.tickers,
  overview: { available: false, reason: 'provider_unavailable', detail: 'CoinGecko is unavailable.' },
  sentiment: { available: false, reason: 'provider_unavailable', detail: 'Fear & Greed is unavailable.' },
};

const CFD = [
  { symbol: 'XAUUSD', name: 'Gold US Dollar', price: '2648.35', changePercent24h: '0.42' },
  { symbol: 'EURUSD', name: 'Euro vs US Dollar', price: '1.08214', changePercent24h: '-0.11' },
  // Price but NO 24h change — must render a dash, not +0.00%.
  { symbol: 'GBPUSD', name: 'British Pound vs US Dollar', price: '1.27431' },
];

const candles = (() => {
  const out = [];
  let price = 101000;
  for (let i = 300; i > 0; i--) {
    const drift = Math.sin(i / 9) * 420 + Math.cos(i / 23) * 260;
    const open = price;
    const close = 101000 + drift;
    out.push({
      time: Math.floor(now / 1000) - i * 900,
      open,
      high: Math.max(open, close) + 120,
      low: Math.min(open, close) - 120,
      close,
      volume: 40 + (i % 17),
    });
    price = close;
  }
  return out;
})();

const book = {
  pair: 'BTC/USDT',
  bids: Array.from({ length: 40 }, (_, i) => ({ price: String(104230 - i * 4), quantity: (0.4 + i * 0.06).toFixed(4) })),
  asks: Array.from({ length: 40 }, (_, i) => ({ price: String(104240 + i * 4), quantity: (0.4 + i * 0.05).toFixed(4) })),
  timestamp: now,
};

const trades = Array.from({ length: 50 }, (_, i) => ({
  id: `t${i}`,
  price: String(104235 + ((i % 7) - 3) * 6),
  quantity: (0.01 + (i % 9) * 0.004).toFixed(5),
  side: i % 2 === 0 ? 'BUY' : 'SELL',
  time: now - i * 1400,
}));

const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];

// ── Request log: the evidence for the one-shared-poll claim ──────────
const hits = new Map();
function record(pathname) {
  const key = pathname.split('?')[0];
  hits.set(key, (hits.get(key) || 0) + 1);
}

let degraded = false;
let stale = false;

function api(pathname, query) {
  if (pathname === '/api/v1/market/snapshot') return degraded ? DEGRADED : SNAPSHOT;
  if (pathname === '/api/v1/market/assets') {
    const list = query.get('tradable') === 'true' ? assets.filter((a) => a.tradable) : assets;
    return {
      available: true,
      source: 'coingecko',
      fetchedAt: now,
      stale: false,
      value: {
        assets: list,
        total: list.length,
        catalogueTotal: assets.length,
        tradableCount: assets.filter((a) => a.tradable).length,
        collisions: [],
        metadataComplete: true,
        limit: 100,
        offset: 0,
      },
    };
  }
  if (pathname === '/api/v1/market/assets/icons') {
    const wanted = (query.get('symbols') || '').split(',').filter(Boolean);
    const out = {};
    for (const s of wanted) {
      const found = assets.find((a) => a.symbol === s.toUpperCase());
      if (found) out[found.symbol] = { id: found.id, name: found.name, logoUrl: found.logoUrl };
    }
    return { assets: out };
  }
  if (pathname === '/api/v1/market/external/tickers') return { source: 'kraken', tickers };
  if (pathname === '/api/v1/market/external/symbols') {
    return { source: 'kraken', symbols: tickers.map((t) => ({ pair: t.pair, baseAsset: t.pair.split('/')[0], quoteAsset: 'USDT' })) };
  }
  if (pathname.startsWith('/api/v1/market/external/tickers/')) {
    const pair = decodeURIComponent(pathname.split('/').pop()).replace('-', '/');
    const found = tickers.find((t) => t.pair === pair.toUpperCase());
    return found ? { source: 'kraken', ticker: found } : null;
  }
  if (pathname.startsWith('/api/v1/market/external/candles/')) return { source: 'kraken', candles };
  if (pathname.startsWith('/api/v1/market/external/orderbook/')) return { source: 'kraken', ...book };
  if (pathname.startsWith('/api/v1/market/external/trades/')) return { source: 'kraken', trades };
  if (pathname === '/api/v1/market/global') {
    return degraded
      ? { source: 'coingecko', global: null, fearGreed: null }
      : { source: 'coingecko', global: SNAPSHOT.overview.value, fearGreed: { value: 68, classification: 'Greed', updatedAt: now } };
  }
  if (pathname === '/api/v1/market/external/rankings') {
    return {
      source: 'coingecko',
      rankings: assets
        .filter((a) => a.rank !== null)
        .map((a) => {
          const tk = tickers.find((t) => t.pair.startsWith(`${a.symbol}/`));
          return {
            symbol: a.symbol,
            rank: a.rank,
            name: a.name,
            image: '',
            categories: [],
            price: tk ? Number(tk.lastPrice) : 0,
            changePercent24h: tk ? Number(tk.changePercent24h) : null,
            changePercent7d: 1.2,
            changePercent30d: 4.5,
            volume24h: tk ? Number(tk.quoteVolume24h) : 0,
            marketCap: (a.rank || 50) * 1_000_000_000,
            sparkline: Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i / 3) * 8),
          };
        }),
    };
  }
  if (pathname === '/api/v1/market/featured-trader') return { avatarUrl: null };
  if (pathname === '/api/v1/cfd/tickers') return { source: 'twelvedata', configured: true, tickers: CFD };
  if (pathname === '/api/v1/cfd/config') {
    return { symbols: CFD.map((c) => c.symbol), minLeverage: 1, maxLeverage: 20, newAccountMaxLeverage: 5, newAccountPeriodDays: 30, highLeverageWarningThreshold: 10, leverageTiers: [] };
  }
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
  if (pathname.startsWith('/api/v1/futures/open-interest/')) {
    // A REAL zero: the QA pass confirms it renders as 0, not as a dash.
    return { symbol: 'BTC/USDT', openInterest: '0', openInterestValue: '0' };
  }
  if (pathname.startsWith('/api/v1/futures/orderbook/')) return { symbol: 'BTC/USDT', bids: book.bids, asks: book.asks, timestamp: now };
  // ── Signed-in shell fixtures ──────────────────────────────────────
  //
  // The market routes sit behind RequireAuth, so QA needs a session to
  // reach them at all. This is a LOCAL FIXTURE identity: no password, no
  // real token, no production account, and every write verb is refused
  // above. It exists purely so the guarded pages render.
  if (pathname === '/api/v1/me') {
    return { id: 'qa-user', email: 'qa@localhost.invalid', role: 'USER', createdAt: new Date(now - 86400000 * 400).toISOString(), emailVerified: true, twoFactorEnabled: false, avatarUrl: null, kycStatus: 'NONE' };
  }
  if (pathname === '/api/v1/balances') {
    return [
      { asset: 'USDT', available: '25000.00000000', locked: '0' },
      { asset: 'BTC', available: '0.42000000', locked: '0' },
      { asset: 'ETH', available: '3.10000000', locked: '0' },
    ];
  }
  if (pathname === '/api/v1/futures/balances') return [{ asset: 'USDT', available: '10000.00000000', locked: '0' }];
  if (pathname === '/api/v1/futures/positions') return [];
  if (pathname === '/api/v1/futures/positions/history') return [];
  if (pathname === '/api/v1/futures/orders/me') return [];
  if (pathname === '/api/v1/cfd/positions') return [];
  if (pathname === '/api/v1/cfd/positions/history') return [];
  if (pathname === '/api/v1/orders/me') return [];
  if (pathname === '/api/v1/trades/me') return [];
  if (pathname === '/api/v1/portfolio/summary') return { totalUsd: '25000', assets: [] };
  if (pathname === '/api/v1/products') return [];
  // The support widget is mounted globally; without this it 404s on every
  // page and adds console noise unrelated to whatever is being QA'd.
  if (pathname === '/api/v1/support/conversations/mine') return { conversation: null, messages: [] };
  if (pathname === '/api/v1/referral/me') return { code: 'QA', referredCount: 0 };
  if (pathname === '/api/v1/card/application') return { status: 'NONE', product: null };
  // ── Analytics ─────────────────────────────────────────────────────
  //
  // Shaped exactly like AnalyticsDataService's output. Deliberately mixed:
  // BTC/USDT has a REAL zero open interest (must render as 0), ETH/USDT
  // has never settled funding (must render as a dash), and `?degraded=true`
  // makes the market-wide sections unavailable so the QA pass can confirm
  // they render dashes rather than zeros.
  if (pathname === '/api/v1/analytics/overview') {
    const derivativeContracts = [
      { symbol: 'BTC/USDT', markPrice: '104235.42', indexPrice: '104198.10', openInterestBase: '0', openInterestUsd: '0', fundingRate: '0.00004', fundingAppliedAt: now - 3_600_000 },
      { symbol: 'ETH/USDT', markPrice: '3892.15', indexPrice: '3890.44', openInterestBase: '128.5412', openInterestUsd: '500172.87', fundingRate: null, fundingAppliedAt: null },
      { symbol: 'SOL/USDT', markPrice: '214.83', indexPrice: '214.61', openInterestBase: '4210.5', openInterestUsd: '904542.71', fundingRate: '-0.000112', fundingAppliedAt: now - 7_200_000 },
      { symbol: 'XRP/USDT', markPrice: '2.4312', indexPrice: '2.4298', openInterestBase: '182450', openInterestUsd: '443473.44', fundingRate: '0.0000087', fundingAppliedAt: now - 1_800_000 },
      { symbol: 'DOGE/USDT', markPrice: null, indexPrice: null, openInterestBase: '0', openInterestUsd: null, fundingRate: null, fundingAppliedAt: null },
    ];
    // ── Analytics Phase 2 external sections, so the branding QA pass can
    //    see the modules that used to render venue names. ───────────
    const oiVenues = [
      { venue: 'binance', contract: 'BTCUSDT', openInterestBase: 84215.42, openInterestUsd: 8_780_000_000, fetchedAt: now, stale: false },
      { venue: 'okx', contract: 'BTC-USDT-SWAP', openInterestBase: 21004.11, openInterestUsd: 2_190_000_000, fetchedAt: now, stale: false },
    ];
    const fundingVenues = [
      { venue: 'binance', contract: 'BTCUSDT', fundingRate: 0.000041, nextFundingAt: now + 4_000_000, fetchedAt: now, stale: false },
      { venue: 'okx', contract: 'BTC-USDT-SWAP', fundingRate: 0.000088, nextFundingAt: now + 4_000_000, fetchedAt: now, stale: false },
    ];
    const basisVenues = [
      { venue: 'binance', contract: 'BTCUSDT', markPrice: 104235.42, indexPrice: 104198.1, basisPercent: 0.0358, fetchedAt: now, stale: false },
      { venue: 'okx', contract: 'BTC-USDT-SWAP', markPrice: 104240.0, indexPrice: 104230.0, basisPercent: 0.0096, fetchedAt: now, stale: false },
    ];
    const ext = (value, venues) => ({ available: true, source: 'binance', fetchedAt: now, stale, value, venues });
    const unsupported = {};
    for (const key of ['liquidations','liquidationHeatmap','marketWideOpenInterest','longShortRatio','etfFlows','exchangeFlows','whaleActivity','volatility','futuresBasis','correlations','sectorRotation']) {
      unsupported[key] = { available: false, reason: 'unsupported_metric', detail: 'No source connected.' };
    }
    return {
      generatedAt: now,
      contracts: FUTURES_SYMBOLS,
      sections: {
        marketOverview: degraded
          ? { available: false, reason: 'provider_unavailable', detail: 'CoinGecko is unavailable.' }
          : { ...SNAPSHOT.overview, stale },
        sentiment: degraded
          ? { available: false, reason: 'provider_unavailable', detail: 'Fear & Greed is unavailable.' }
          : { ...SNAPSHOT.sentiment, stale },
        derivatives: {
          available: true,
          source: 'voltex',
          fetchedAt: now,
          stale: false,
          value: { scope: 'venue', intervalHours: 8, nextSettlementAt: now + 4_120_000, contracts: derivativeContracts },
        },
        externalOpenInterest: degraded
          ? { available: false, reason: 'provider_unavailable' }
          : ext({ baseAsset: 'BTC', totalOpenInterestUsd: 10_970_000_000, venues: oiVenues }, oiVenues),
        externalFunding: degraded
          ? { available: false, reason: 'provider_unavailable' }
          : ext({ baseAsset: 'BTC', venues: fundingVenues }, fundingVenues),
        perpetualBasis: degraded
          ? { available: false, reason: 'provider_unavailable' }
          : ext({ baseAsset: 'BTC', venues: basisVenues }, basisVenues),
        longShortPositioning: degraded
          ? { available: false, reason: 'provider_unavailable' }
          : {
              available: true, source: 'binance', fetchedAt: now, stale,
              value: { baseAsset: 'BTC', ratios: [
                { venue: 'binance', contract: 'BTCUSDT', kind: 'global_account', period: '5m', longAccount: 0.612, shortAccount: 0.388, ratio: 1.577, timestamp: now },
                { venue: 'binance', contract: 'BTCUSDT', kind: 'top_account', period: '5m', longAccount: 0.548, shortAccount: 0.452, ratio: 1.212, timestamp: now },
                { venue: 'binance', contract: 'BTCUSDT', kind: 'top_position', period: '5m', longAccount: 0.501, shortAccount: 0.499, ratio: 1.004, timestamp: now },
              ] },
            },
      },
      trackedAssets: ['BTC', 'ETH'],
      selectedAsset: 'BTC',
      unsupported,
    };
  }
  if (pathname === '/api/v1/analytics/diagnostics') {
    // The harness serves this unauthenticated, but the REAL route is
    // requireAuth + requireAdmin — asserted in the route test suite.
    return { providers: [{ provider: 'kraken', state: 'CLOSED', healthy: true, consecutiveFailures: 0, lastSuccessAt: now, lastFailureAt: null, cooldownUntil: null, rateLimitHits: 0 }] };
  }
  if (pathname === '/api/v1/arbitrage/opportunities') {
    return {
      source: 'multi',
      opportunities: [
        { pair: 'BTC/USDT', buyExchange: 'Binance', buyPrice: 104200, sellExchange: 'OKX', sellPrice: 104290, spreadPercent: 0.0864, netSpreadPercent: -0.1136, sources: ['Binance', 'Kraken', 'OKX'], observedAt: now },
      ],
    };
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Nothing in this harness may mutate anything, ever.
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
    degraded = url.searchParams.get('degraded') === 'true';
    stale = url.searchParams.get('stale') === 'true';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, degraded, stale }));
  }

  const filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (filePath.startsWith(DIST) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(filePath));
  }
  // SPA fallback.
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(DIST, 'index.html')));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[qa-no-provider-branding] read-only fixture server on http://127.0.0.1:${PORT}`);
});
