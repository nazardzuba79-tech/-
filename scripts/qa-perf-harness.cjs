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
  // ── Copy Trading marketplace, at realistic size ───────────────────
  //
  // Shaped like CopyPerformanceService's real output so the payload
  // measurement is honest: 365 days of equity/AUM/daily history and a
  // year of trades, per strategy, plus followers and weekly/monthly rollups.
  if (pathname === '/api/v1/copy-trading/marketplace') {
    const day = (i) => new Date(now - (365 - i) * 86400000).toISOString().slice(0, 10);
    const strategy = (id, name) => ({
      trader: { id, name, vip: true },
      simulation: { seed: 1, mode: 'REAL_TIME', simulatedAt: new Date(now).toISOString(), stateVersion: 8 },
      traderEarnings365: 412000,
      economics: {
        methodology: 'DAILY_TWR', performanceFeeRate: 0.2,
        periods: Object.fromEntries(['7D','30D','90D','ALL'].map(p => [p, {
          roi: 5.2, masterPnl: 420000, masterTradingVolume: 92000000, copiedTradingVolume: 71000000,
          grossFollowersPnl: 398000, performanceFeeEarnings: 80000, netFollowersPnl: 318000,
          activeTradingDays: 300, calendarDays: 365, maximumDrawdown: 12.8, annualizedVolatility: 34.2,
          sharpe: 1.42, sortino: 2.1, profitFactor: 1.87,
        }])),
      },
      analytics: {
        roi7: 2.1, roi30: 8.4, roi90: 22.7, roiAll: 64.2, winRate: 61.4, maximumDrawdown: 12.8,
        averageWinR: 1.9, averageLossR: 1, plRatio: 1.9, grossProfit: 900000, grossLoss: 480000,
        profitFactor: 1.87, expectancy: 240, expectancyR: 0.31, sharpe: 1.42, sortino: 2.1, calmar: 1.8,
        annualizedVolatility: 34.2, totalTradingDays: 365, totalTrades: 2920, winningTrades: 1793,
        losingTrades: 1127, tradesLast7D: 22, tradesLast30D: 96, averageTradesPerDay: 3.4,
        averageTradesPerWeek: 23.8, averageHoldingTimeMinutes: 214, medianHoldingTimeMinutes: 168,
        longestTradeMinutes: 5400, shortestTradeMinutes: 4, masterPnl: 420000, followerPnl: 318000,
        followerPnl7: 9000, followerPnl30: 41000, followerPnl90: 118000, aum: 4200000,
        activeFollowers: 32, tradingVolume: 92000000,
        allTime: { roi: 64.2, pnl: 420000, totalTrades: 2920, winningTrades: 1793, losingTrades: 1127,
          winRate: 61.4, maximumDrawdown: 12.8, profitFactor: 1.87, sharpe: 1.42, sortino: 2.1,
          tradingDays: 365, averageTrade: 339, followersPnl: 318000, aum: 4200000 },
      },
      trades: Array.from({ length: 2920 }, (_, i) => ({
        // The last 12 trades are deliberately XRP/DOGE while the strategy's
        // year is BTC/ETH/SOL, so the browser QA can see for itself that
        // Main Markets describes the history and not this morning.
        id: `${id}-t${i}`,
        symbol: i < 12 ? (i % 2 ? 'XRP/USDT' : 'DOGE/USDT') : ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][i % 3],
        side: i % 2 ? 'LONG' : 'SHORT',
        openedAt: new Date(now - i * 3600000).toISOString(), closedAt: new Date(now - i * 3600000 + 900000).toISOString(),
        entryPrice: 104000 + i, exitPrice: 104200 + i, quantity: 0.12, leverage: 10,
        netPnl: (i % 3 ? 1 : -1) * (120 + i), returnPct: 0.42, holdingTimeMinutes: 40 + (i % 13),
        grossPnl: 130 + i, fees: 1.2, funding: 0.3, riskR: 0.9, result: i % 3 ? 'WIN' : 'LOSS',
      })),
      equityHistory: Array.from({ length: 365 }, (_, i) => ({ date: day(i), equity: 1000000 + i * 1150 })),
      aumHistory: Array.from({ length: 365 }, (_, i) => ({ date: day(i), aum: 3000000 + i * 3200, followerCount: 100 + i })),
      dailyResults: Array.from({ length: 365 }, (_, i) => ({ date: day(i), startEquity: 1000000 + i * 1150,
        endEquity: 1000000 + (i + 1) * 1150, realizedPnl: 1150, dailyReturn: 0.11, drawdown: 0.4 })),
      followers: Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, displayName: `Follower ${i}`,
        copyStartDate: day(i % 365), allocatedCapital: 10000 + i, currentEquity: 12000 + i, realizedPnl: 1200,
        unrealizedPnl: 40, roi: 12.4, copiedTrades: 300, copyRatio: 1, slippageBps: 4, latencyMs: 120,
        active: true, startingAllocation: 10000, grossPnl: 1400, performanceFees: 200, netPnl: 1200,
        copiedVolume: 900000, highWaterMark: 12500 })),
      weekly: Array.from({ length: 52 }, (_, i) => ({ period: `W${i}`, roi: 1.2, pnl: 8000, trades: 24, winRate: 61, maxDrawdown: 3.1 })),
      monthly: Array.from({ length: 12 }, (_, i) => ({ period: `M${i}`, roi: 5.2, pnl: 34000, trades: 103, winRate: 61, maxDrawdown: 6.4 })),
    });
    // The server now summarizes before responding (see
    // src/services/copyTrading/marketplaceSummary.ts): statistics from the
    // complete history, ten display rows on the wire. `?full=1` serves the
    // old shape so the before/after measurement uses one fixture.
    const PERIOD_DAYS = { '7D': 7, '30D': 30, '90D': 90, ALL: Infinity };
    const summarize = (data) => {
      const stats = {};
      const last = data.equityHistory[data.equityHistory.length - 1];
      for (const period of ['7D', '30D', '90D', 'ALL']) {
        const cutoff = period === 'ALL' ? ''
          : new Date(Date.parse(`${last.date}T00:00:00Z`) - PERIOD_DAYS[period] * 86400000).toISOString().slice(0, 10);
        const rows = period === 'ALL' ? data.trades : data.trades.filter((t) => t.closedAt.slice(0, 10) > cutoff);
        const wins = rows.filter((t) => t.netPnl > 0);
        const losses = rows.filter((t) => t.netPnl < 0);
        stats[period] = {
          totalTrades: rows.length, winningTrades: wins.length, losingTrades: losses.length,
          grossProfit: wins.reduce((s, t) => s + t.netPnl, 0),
          grossLoss: Math.abs(losses.reduce((s, t) => s + t.netPnl, 0)),
          netPnlTotal: rows.reduce((s, t) => s + t.netPnl, 0),
          holdingTimeTotalMinutes: rows.reduce((s, t) => s + t.holdingTimeMinutes, 0),
        };
      }
      // Main Markets over the COMPLETE history, mirroring
      // marketplaceSummary.mainMarketsOf — including the XRP retention rule.
      const counts = data.trades.reduce((r, t) => {
        const sym = t.symbol.replace('/USDT', '').replace(/USDT$/, '');
        r[sym] = (r[sym] ?? 0) + 1; return r;
      }, {});
      const mainMarkets = Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([sym]) => sym);
      if (counts.XRP && !mainMarkets.includes('XRP')) mainMarkets.push('XRP');
      return { ...data, tradeStats: stats, mainMarkets, tradeHistoryCount: data.trades.length,
        trades: [...data.trades].sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt)).slice(0, 10) };
    };
    const shape = query.get('full') === '1' ? (d) => d : summarize;
    return {
      nazar: shape(strategy('VX-001', 'Nazar')),
      ksenia: shape({ ...strategy('VX-KSENIA', 'Ksenia'), provenance: 'SYNTHETIC_REVIEW', traderEarnings365: 412000 }),
      identities: [{ traderId: 'VX-001', displayName: 'Nazar', avatarUrl: null, verified: true, premium: true, avatarVersion: null },
                   { traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: null, verified: true, premium: true, avatarVersion: null }],
      generatedAt: new Date(now).toISOString(), errors: {},
    };
  }
  if (pathname === '/api/v1/copy-trading/identities') {
    return { identities: [{ traderId: 'VX-001', displayName: 'Nazar', avatarUrl: null, verified: true, premium: true, avatarVersion: null },
                          { traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: null, verified: true, premium: true, avatarVersion: null }] };
  }
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
      },
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
  console.log(`[qa-perf] read-only fixture server on http://127.0.0.1:${PORT}`);
});
