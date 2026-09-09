#!/usr/bin/env node
/**
 * Local browser-QA harness for the Futures AUTHENTICATED ACCOUNT surface.
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
  if (pathname === '/api/v1/support/conversations/mine') return { conversation: null, messages: [] };
  return undefined;
}

function authedRoutes(pathname, acct) {
  if (pathname === '/api/v1/me') return acct.me;
  if (pathname === '/api/v1/balances') return acct.spot;
  if (pathname === '/api/v1/futures/balances') return acct.futures;
  if (pathname === '/api/v1/futures/positions') return acct.positions;
  if (pathname === '/api/v1/futures/positions/history') return acct.history;
  if (pathname === '/api/v1/futures/orders/me') return acct.orders;
  if (pathname === '/api/v1/orders/me' || pathname === '/api/v1/trades/me') return [];
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
      const body = authedRoutes(pathname, acct);
      if (body !== undefined) return json(200, body);
      return json(404, { error: 'not in fixture set' });
    }

    // ── Writes against the in-memory fixture account ────────────────
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
