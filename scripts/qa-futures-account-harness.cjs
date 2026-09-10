#!/usr/bin/env node
/**
 * Local browser-QA harness for the AUTHENTICATED TERMINAL surface —
 * Futures account state, and the Spot conditional-order traffic the
 * charts on both terminals are measured against.
 *
 * `qa-perf-harness.cjs` is deliberately GET-only — it refuses every write
 * verb so no order, transfer or balance change is reachable from it even by
 * accident, and that guarantee is worth keeping. But the Futures account
 * audit has to measure request counts around order placement, position
 * close and Spot<->Futures transfer, which are writes. So this is a
 * SEPARATE harness rather than a hole punched in that one.
 *
 * What it is:
 *
 *   - Loopback only (binds 127.0.0.1, nothing else).
 *   - No production credentials, no database, no provider egress, no real
 *     funds. The whole "account" is the in-memory object below, rebuilt on
 *     every process start and on /__qa/reset.
 *   - Two fixture identities keyed by bearer token, so cross-session
 *     leakage can actually be tested: token `qa-user-a` and `qa-user-b`
 *     hold visibly different balances, positions and orders.
 *   - A per-method request log, which is the evidence for every before/
 *     after count in the audit.
 *
 *   node scripts/qa-futures-account-harness.cjs [--port 4231] [--dist path]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 4231;
const DIST = argv.includes('--dist')
  ? path.resolve(argv[argv.indexOf('--dist') + 1])
  : path.join(ROOT, 'frontend', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const now = Date.now();
const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
const MARK = { 'BTC/USDT': 104235, 'ETH/USDT': 3980.4, 'SOL/USDT': 214.85, 'XRP/USDT': 2.4312, 'DOGE/USDT': 0.38214 };

// ── Two fixture identities ──────────────────────────────────────────
//
// Deliberately different in every account figure, so "user B still sees
// user A's balance" is visible rather than something to squint at.
function freshAccounts() {
  return {
    'qa-user-a': {
      me: { id: 'qa-user-a', email: 'a@localhost.invalid', role: 'USER', createdAt: new Date(now - 86400000 * 400).toISOString(), emailVerified: true, twoFactorEnabled: false, avatarUrl: null, kycStatus: 'NONE' },
      spot: [{ asset: 'USDT', available: '25000.00000000', locked: '0' }],
      futures: [{ asset: 'USDT', available: '10000.00000000', locked: '250.00000000' }],
      positions: [{
        id: 'pos-a1', symbol: 'BTC/USDT', side: 'LONG', size: '0.05000000', entryPrice: '104000.00',
        leverage: 10, marginType: 'ISOLATED', initialMargin: '520.00000000', liquidationPrice: '94600.00',
        markPrice: '104235.00', unrealizedPnl: '11.75000000', roe: '2.26', openedAt: new Date(now - 7200000).toISOString(),
      }],
      orders: [{
        id: 'ord-a1', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '101000.00',
        originalQuantity: '0.02000000', remainingQuantity: '0.02000000', status: 'OPEN', reduceOnly: false,
        leverage: 10, marginType: 'ISOLATED', createdAt: new Date(now - 600000).toISOString(),
      }],
      spotOrders: freshSpotOrders(),
      history: [{
        id: 'pos-a0', symbol: 'ETH/USDT', side: 'SHORT', leverage: 5, marginType: 'ISOLATED',
        entryPrice: '4010.00', realizedPnl: '42.30000000', status: 'CLOSED',
        openedAt: new Date(now - 172800000).toISOString(), closedAt: new Date(now - 169200000).toISOString(),
      }],
    },
    'qa-user-b': {
      me: { id: 'qa-user-b', email: 'b@localhost.invalid', role: 'USER', createdAt: new Date(now - 86400000 * 90).toISOString(), emailVerified: true, twoFactorEnabled: false, avatarUrl: null, kycStatus: 'NONE' },
      spot: [{ asset: 'USDT', available: '777.00000000', locked: '0' }],
      futures: [{ asset: 'USDT', available: '333.00000000', locked: '0' }],
      positions: [],
      orders: [],
      spotOrders: [],
      history: [],
    },
  };
}

let accounts = freshAccounts();

// Fault injection for the failure-behaviour QA: a set of path fragments the
// server answers 503 for, so "what does the UI show when balances fail" is
// something to observe rather than infer.
let failing = new Set();

// ── Request log, per method+path ────────────────────────────────────
const hits = new Map();
function record(method, pathname) {
  const key = `${method} ${pathname.split('?')[0]}`;
  hits.set(key, (hits.get(key) || 0) + 1);
}

function tokenOf(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const num = (s) => Number(s);
const fixed = (n) => n.toFixed(8);

function marketRoutes(pathname) {
  if (pathname === '/api/v1/futures/config') {
    return {
      symbols: FUTURES_SYMBOLS, fundingIntervalHours: 8, minLeverage: 1, maxLeverage: 50,
      newAccountMaxLeverage: 10, newAccountPeriodDays: 30, highLeverageWarningThreshold: 20,
      leverageTiers: [{ notionalCap: 50000, maxLeverage: 50, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }],
      maintenanceMarginRate: '0.005',
    };
  }
  if (pathname.startsWith('/api/v1/futures/mark-price/')) {
    const sym = decodeURIComponent(pathname.split('/').pop()).replace('-', '/').toUpperCase();
    const p = MARK[sym];
    return p ? { symbol: sym, markPrice: String(p), indexPrice: String(p) } : null;
  }
  if (pathname.startsWith('/api/v1/futures/funding-rate/')) {
    return { symbol: 'BTC/USDT', history: [{ rate: '0.00004', markPrice: '104235', indexPrice: '104230', appliedAt: new Date(now - 3600000).toISOString() }] };
  }
  if (pathname.startsWith('/api/v1/futures/open-interest/')) return { symbol: 'BTC/USDT', openInterest: '0', openInterestValue: '0' };
  if (pathname.startsWith('/api/v1/futures/orderbook/') || pathname.startsWith('/api/v1/market/external/orderbook/')) {
    return {
      pair: 'BTC/USDT', timestamp: now,
      bids: Array.from({ length: 40 }, (_, i) => ({ price: String(104230 - i * 4), quantity: (0.4 + i * 0.06).toFixed(4), orders: 1 })),
      asks: Array.from({ length: 40 }, (_, i) => ({ price: String(104240 + i * 4), quantity: (0.4 + i * 0.05).toFixed(4), orders: 1 })),
    };
  }
  if (pathname === '/api/v1/market/snapshot') {
    return {
      tickers: {
        available: true, source: 'kraken', fetchedAt: now, stale: false,
        value: FUTURES_SYMBOLS.map((pair) => ({
          pair, lastPrice: String(MARK[pair]), bidPrice: String(MARK[pair] - 1), askPrice: String(MARK[pair] + 1),
          high24h: String(MARK[pair] * 1.02), low24h: String(MARK[pair] * 0.98),
          volume24h: '1000', quoteVolume24h: '100000000', changePercent24h: '1.20',
        })),
      },
      overview: { available: false, reason: 'not in fixture set' },
      sentiment: { available: false, reason: 'not in fixture set' },
    };
  }
  if (pathname.startsWith('/api/v1/market/candles')) return [];
  // Enough of the market surface for BOTH terminals to render real
  // candles and a real pair list, so the order-traffic counts below are
  // taken against a working chart rather than an empty one.
  if (pathname.startsWith('/api/v1/market/external/candles/')) {
    const base = 104000;
    return { candles: Array.from({ length: 520 }, (_, i) => ({
      time: Math.floor((now - (520 - i) * 900_000) / 1000),
      open: base + i, high: base + i + 40, low: base + i - 40, close: base + i + 10, volume: 12 + (i % 7),
    })) };
  }
  if (pathname === '/api/v1/market/external/tickers') {
    return { source: 'kraken', tickers: FUTURES_SYMBOLS.map((pair) => ({
      pair, lastPrice: String(MARK[pair]), bidPrice: String(MARK[pair] - 1), askPrice: String(MARK[pair] + 1),
      high24h: String(MARK[pair] * 1.02), low24h: String(MARK[pair] * 0.98),
      volume24h: '1000', quoteVolume24h: '100000000', changePercent24h: '1.20',
    })) };
  }
  if (pathname === '/api/v1/market/external/rankings') {
    // Shape matters: the real response is { source, rankings: [...] }, and
    // a fixture returning anything else makes a consumer map over
    // `undefined` and log a render error that has nothing to do with the
    // code under test.
    return { source: 'coingecko', rankings: FUTURES_SYMBOLS.map((pair, i) => {
      const symbol = pair.split('/')[0];
      return {
        symbol, rank: i + 1, name: symbol, image: '', categories: [],
        price: MARK[pair], changePercent24h: 1.2, changePercent7d: 3.4, changePercent30d: -2.1,
        volume24h: 1e8, marketCap: (i + 1) * 1e9,
        sparkline: Array.from({ length: 24 }, (_, n) => 100 + Math.sin(n / 3) * 8),
      };
    }) };
  }
  if (pathname === '/api/v1/market/global') {
    return {
      totalMarketCapUsd: 2.5e12, totalVolume24hUsd: 9e10, btcDominancePercent: 54.2,
      ethDominancePercent: 13.1, marketCapChangePercent24h: 1.4,
      fearGreed: { value: 61, classification: 'Greed', updatedAt: Math.floor(now / 1000) },
    };
  }
  if (pathname === '/api/v1/market/assets/icons') return {};
  if (pathname === '/api/v1/cfd/tickers') return { source: 'twelvedata', configured: false, tickers: [] };
  if (pathname === '/api/v1/support/conversations/mine') return { conversation: null, messages: [] };
  return undefined;
}

/**
 * Spot conditional (SL/TP trigger) orders.
 *
 * One PENDING_TRIGGER order on BTC/USDT, so the Spot chart genuinely draws
 * a conditional line and the Futures chart can be shown NOT to — the whole
 * point of the measurement. Held per account and mutated by PATCH
 * /orders/:id/trigger, so a drag can be verified end to end.
 */
function freshSpotOrders() {
  return [{
    id: 'spot-trigger-1', pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT',
    price: '98900.00000000', triggerPrice: '99000.00000000', ocoGroupId: null,
    originalQuantity: '0.10000000', remainingQuantity: '0.10000000',
    status: 'PENDING_TRIGGER', createdAt: new Date(now - 900000).toISOString(),
  }];
}

/**
 * Futures TP/SL fixture state, keyed by position id.
 *
 * Deliberately mirrors the SERVER contract rather than the UI's wishes: the
 * positions payload carries `protection`, and the editor's PUT/DELETE are
 * the only way it ever changes. So a browser run genuinely exercises "the
 * row shows server state" — if the UI ever painted a local draft as armed,
 * a reload against this harness would contradict it.
 */
function protectionOf(acct, positionId) {
  acct.protection = acct.protection || {};
  acct.protection[positionId] = acct.protection[positionId] || { takeProfit: null, stopLoss: null };
  return acct.protection[positionId];
}

function protectionTrigger(kind, triggerPrice) {
  return {
    id: `prot-${kind}-${Date.now()}`, kind, triggerPrice: String(triggerPrice),
    status: 'PENDING', lastError: null, attempts: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

/** The same rules FuturesProtectionService.validateTriggers enforces. */
function validateProtection(position, takeProfit, stopLoss) {
  const mark = MARK[position.symbol];
  const long = position.side === 'LONG';
  for (const [label, v] of [['takeProfit', takeProfit], ['stopLoss', stopLoss]]) {
    if (v === null) continue;
    if (!Number.isFinite(v) || v <= 0) return `${label} must be a positive price`;
  }
  if (takeProfit !== null && stopLoss !== null) {
    const ordered = long ? stopLoss < takeProfit : stopLoss > takeProfit;
    if (!ordered) {
      return long
        ? 'stopLoss must be below takeProfit for a LONG position'
        : 'stopLoss must be above takeProfit for a SHORT position';
    }
  }
  if (!Number.isFinite(mark)) return null;
  if (long) {
    if (takeProfit !== null && !(takeProfit > mark)) return 'takeProfit must be above the current mark price for a LONG position';
    if (stopLoss !== null && !(stopLoss < mark)) return 'stopLoss must be below the current mark price for a LONG position';
  } else {
    if (takeProfit !== null && !(takeProfit < mark)) return 'takeProfit must be below the current mark price for a SHORT position';
    if (stopLoss !== null && !(stopLoss > mark)) return 'stopLoss must be above the current mark price for a SHORT position';
  }
  return null;
}

const PROTECTION_PATH = /^\/api\/v1\/futures\/positions\/([^/]+)\/protection$/;

function authedRoutes(pathname, acct, query) {
  if (pathname === '/api/v1/me') return acct.me;
  if (pathname === '/api/v1/orders/me') {
    const status = query?.get('status') ?? '';
    // Same filter semantics as the real route: the client asks for the
    // statuses it wants and gets only those.
    if (!status || status.split(',').includes('PENDING_TRIGGER')) return acct.spotOrders;
    return [];
  }
  if (pathname === '/api/v1/balances') return acct.spot;
  if (pathname === '/api/v1/futures/balances') return acct.futures;
  if (pathname === '/api/v1/futures/positions') {
    return acct.positions.map((p) => ({ ...p, protection: protectionOf(acct, p.id) }));
  }
  const read = PROTECTION_PATH.exec(pathname);
  if (read) {
    const position = acct.positions.find((p) => p.id === read[1]);
    if (!position) return undefined; // 404, same as another user's position
    return { positionId: position.id, ...protectionOf(acct, position.id) };
  }
  if (pathname === '/api/v1/futures/positions/history') return acct.history;
  if (pathname === '/api/v1/futures/orders/me') return acct.orders;
  if (pathname === '/api/v1/trades/me') return [];
  if (pathname === '/api/v1/portfolio/summary') return { totalUsd: acct.spot[0].available, assets: [] };
  if (pathname === '/api/v1/referral/me') return { code: 'QA', referredCount: 0 };
  return undefined;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname } = url;
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };

  if (pathname === '/__qa/hits') return json(200, Object.fromEntries(hits));
  if (pathname === '/__qa/reset') { hits.clear(); accounts = freshAccounts(); failing = new Set(); return json(200, { ok: true }); }
  if (pathname === '/__qa/fail') {
    const spec = url.searchParams.get('paths');
    failing = new Set(spec ? spec.split(',').filter(Boolean) : []);
    return json(200, { failing: [...failing] });
  }
  if (pathname === '/__qa/state') {
    const t = url.searchParams.get('token') || 'qa-user-a';
    return json(200, accounts[t] ?? null);
  }

  if (pathname.startsWith('/api/')) {
    record(req.method, pathname);
    if ([...failing].some((f) => pathname.includes(f))) return json(503, { error: 'Injected failure' });
    const token = tokenOf(req);

    const market = marketRoutes(pathname);
    if (market !== undefined) return market === null ? json(404, { error: 'not in fixture set' }) : json(200, market);

    // Everything past here is account data and requires a session. An
    // unknown or missing token is 401 — the same shape the real API
    // returns, so the client's own unauthorized handling is exercised.
    const acct = token ? accounts[token] : null;
    if (!acct) return json(401, { error: 'Unauthorized' });

    if (req.method === 'GET') {
      const body = authedRoutes(pathname, acct, url.searchParams);
      if (body !== undefined) return json(200, body);
      return json(404, { error: 'not in fixture set' });
    }

    // ── Writes against the in-memory fixture account ────────────────
    const protectionWrite = PROTECTION_PATH.exec(pathname);
    if (protectionWrite && (req.method === 'PUT' || req.method === 'DELETE')) {
      const position = acct.positions.find((p) => p.id === protectionWrite[1]);
      if (!position) return json(404, { error: 'Position not found or not open' });
      const state = protectionOf(acct, position.id);
      if (req.method === 'DELETE') {
        state.takeProfit = null;
        state.stopLoss = null;
        res.writeHead(204, { 'access-control-allow-origin': '*' });
        return res.end();
      }
      const b = await readBody(req);
      const tp = b.takeProfit === undefined || b.takeProfit === null ? null : num(b.takeProfit);
      const sl = b.stopLoss === undefined || b.stopLoss === null ? null : num(b.stopLoss);
      const problem = validateProtection(position, tp, sl);
      if (problem) return json(400, { error: problem });
      state.takeProfit = tp === null ? null : protectionTrigger('TAKE_PROFIT', tp);
      state.stopLoss = sl === null ? null : protectionTrigger('STOP_LOSS', sl);
      return json(200, { positionId: position.id, ...state });
    }

    if (req.method === 'POST' && pathname === '/api/v1/futures/orders') {
      const b = await readBody(req);
      const price = b.type === 'MARKET' ? MARK[b.symbol] : num(b.price);
      const margin = (price * num(b.quantity)) / (b.leverage || 1);
      const usdt = acct.futures.find((x) => x.asset === 'USDT');
      if (!usdt || num(usdt.available) < margin) return json(400, { error: 'Insufficient margin' });
      usdt.available = fixed(num(usdt.available) - margin);
      usdt.locked = fixed(num(usdt.locked) + margin);
      const order = {
        id: `ord-${Date.now()}`, symbol: b.symbol, side: b.side, type: b.type,
        price: b.type === 'MARKET' ? null : String(price), originalQuantity: String(b.quantity),
        remainingQuantity: String(b.quantity), status: 'OPEN', reduceOnly: !!b.reduceOnly,
        leverage: b.leverage, marginType: b.marginType, createdAt: new Date().toISOString(),
      };
      acct.orders.push(order);
      return json(201, order);
    }

    if (req.method === 'DELETE' && /^\/api\/v1\/futures\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      const i = acct.orders.findIndex((o) => o.id === id);
      if (i === -1) return json(404, { error: 'Order not found' });
      acct.orders.splice(i, 1);
      return json(200, { status: 'CANCELLED' });
    }

    if (req.method === 'POST' && /^\/api\/v1\/futures\/positions\/[^/]+\/close$/.test(pathname)) {
      const id = pathname.split('/')[5];
      const i = acct.positions.findIndex((p) => p.id === id);
      if (i === -1) return json(404, { error: 'Position not found' });
      const [pos] = acct.positions.splice(i, 1);
      const usdt = acct.futures.find((x) => x.asset === 'USDT');
      const pnl = num(pos.unrealizedPnl ?? '0');
      usdt.locked = fixed(Math.max(0, num(usdt.locked) - num(pos.initialMargin)));
      usdt.available = fixed(num(usdt.available) + num(pos.initialMargin) + pnl);
      acct.history.unshift({
        id: pos.id, symbol: pos.symbol, side: pos.side, leverage: pos.leverage, marginType: pos.marginType,
        entryPrice: pos.entryPrice, realizedPnl: fixed(pnl), status: 'CLOSED',
        openedAt: pos.openedAt, closedAt: new Date().toISOString(),
      });
      return json(200, { status: 'CLOSED' });
    }

    if (req.method === 'PATCH' && /^\/api\/v1\/orders\/[^/]+\/trigger$/.test(pathname)) {
      const id = pathname.split('/')[4];
      const order = acct.spotOrders.find((o) => o.id === id);
      if (!order) return json(404, { error: 'Order not found' });
      const b = await readBody(req);
      if (b.triggerPrice) order.triggerPrice = String(b.triggerPrice);
      if (b.price) order.price = String(b.price);
      return json(200, { id: order.id, triggerPrice: order.triggerPrice, price: order.price });
    }

    if (req.method === 'POST' && pathname === '/api/v1/futures/transfer') {
      const b = await readBody(req);
      const amount = num(b.amount);
      const from = b.direction === 'TO_FUTURES' ? acct.spot : acct.futures;
      const to = b.direction === 'TO_FUTURES' ? acct.futures : acct.spot;
      const src = from.find((x) => x.asset === b.asset);
      if (!src || !(amount > 0) || num(src.available) < amount) return json(400, { error: 'Insufficient balance' });
      src.available = fixed(num(src.available) - amount);
      let dst = to.find((x) => x.asset === b.asset);
      if (!dst) { dst = { asset: b.asset, available: '0', locked: '0' }; to.push(dst); }
      dst.available = fixed(num(dst.available) + amount);
      return json(200, { status: 'OK' });
    }

    return json(405, { error: 'not in fixture set' });
  }

  const filePath = path.join(DIST, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
  if (filePath.startsWith(DIST) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(filePath));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(DIST, 'index.html')));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[qa-futures-account] fixture server on http://127.0.0.1:${PORT}`);
});
