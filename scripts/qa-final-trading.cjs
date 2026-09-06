/** LOCAL QA ONLY — no production credentials, database, order or account writes.
 * Build backend + normal frontend first. Run:
 *   node scripts/qa-final-trading.cjs --self-test
 *   node scripts/qa-final-trading.cjs --port 4181
 * The second command stays running. Open its printed loopback bootstrap URL.
 * Actual compiled auth/orders/balances/trades routers, OrderService and
 * MatchingEngine; only Prisma persistence and unrelated account data are local
 * fixtures. Public market endpoints use actual Kraken/CoinGecko services.
 * The internal matching book starts EMPTY. External depth is NOT liquidity
 * supplied to the matching engine. No fake candles, prices, fills or WebSocket.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const output = path.join(root, 'outputs/final-trading-qa');
const selfTest = process.argv.includes('--self-test');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : selfTest ? 0 : 4181;
assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535, 'Valid loopback port required');
// Never load dotenv or consume a real secret/connection inherited by the shell.
delete process.env.DATABASE_URL; delete process.env.DIRECT_URL;
delete process.env.COINGECKO_API_KEY;
process.env.API_KEY_ENCRYPTION_SECRET = randomBytes(32).toString('hex');
process.env.JWT_SECRET = randomBytes(48).toString('hex');
const express = require('express');
const jwt = require('jsonwebtoken');
const BigNumber = require('bignumber.js');
const { MatchingEngine } = require('../dist/matching-engine/MatchingEngine');
const { ordersRouter } = require('../dist/api/routes/orders');
const { balancesRouter } = require('../dist/api/routes/balances');
const { tradesRouter } = require('../dist/api/routes/trades');
const { marketRouter } = require('../dist/api/routes/market');
const { requireAuth } = require('../dist/api/middleware/auth');
const { KrakenMarketDataService } = require('../dist/services/KrakenMarketDataService');
const { CoinGeckoService } = require('../dist/services/CoinGeckoService');
const { FearGreedService } = require('../dist/services/FearGreedService');

function memoryPrisma(engine) {
  const userId = 'local-spot-qa-viewer';
  let balances = new Map(['USDT', 'BTC'].map(asset => [userId + ':' + asset,
    { userId, asset, available: asset === 'USDT' ? '100000' : '2', locked: '0' }]));
  let orders = new Map(); let trades = [];
  const sessions = new Map(); const pairs = new Set(['BTC/USDT']);
  let tail = Promise.resolve();
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const match = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => match(row, part));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return value === undefined || row[key] === value;
  });
  const findOrders = ({ where, orderBy, take } = {}) => {
    const result = [...orders.values()].filter(row => match(row, where));
    if (orderBy?.createdAt) result.sort((a, b) => (Number(new Date(a.createdAt)) - Number(new Date(b.createdAt))) * (orderBy.createdAt === 'desc' ? -1 : 1));
    return copy(result.slice(0, take ?? result.length));
  };
  const db = {
    session: { async findUnique({ where }) { return copy(sessions.get(where.id) ?? null); },
      async update({ where, data }) { const row = { ...sessions.get(where.id), ...data }; sessions.set(where.id, row); return copy(row); } },
    apiKey: { async findUnique() { return null; } },
    user: { async findFirst() { return null; } },
    balance: {
      async findUnique({ where }) { const { userId, asset } = where.userId_asset; return copy(balances.get(userId + ':' + asset) ?? null); },
      async findMany({ where }) { return copy([...balances.values()].filter(row => match(row, where))); },
      async update({ where, data }) {
        const { userId, asset } = where.userId_asset; const key = userId + ':' + asset;
        assert.ok(balances.has(key), 'Balance exists');
        const row = { ...balances.get(key), ...data }; balances.set(key, row); return copy(row);
      },
      async upsert({ where, create, update }) {
        const { userId, asset } = where.userId_asset; const key = userId + ':' + asset;
        const row = balances.has(key) ? { ...balances.get(key), ...update } : copy(create);
        balances.set(key, row); return copy(row);
      },
    },
    order: {
      async create({ data }) {
        assert.ok(!orders.has(data.id), 'Unique local order ID'); pairs.add(data.pair);
        const row = { ...copy(data), createdAt: new Date(), updatedAt: new Date() }; orders.set(data.id, row); return copy(row);
      },
      async findUnique({ where }) { return copy(orders.get(where.id) ?? null); },
      async findFirst(query) { return findOrders(query)[0] ?? null; },
      async findMany(query) { return findOrders(query); },
      async update({ where, data }) {
        assert.ok(orders.has(where.id), 'Order exists');
        const row = { ...orders.get(where.id), ...copy(data), updatedAt: new Date() };
        orders.set(where.id, row); return copy(row);
      },
    },
    trade: {
      async create({ data }) { const row = { ...copy(data), executedAt: new Date() }; trades.push(row); return copy(row); },
      async findMany({ where, take }) { return copy(trades.filter(row => match(row, where)).slice().reverse().slice(0, take ?? 100)); },
    },
    async $transaction(work) {
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
      const before = { balances: copy(balances), orders: copy(orders), trades: copy(trades) };
      const engineOrders = [...pairs].flatMap(pair => ['BUY', 'SELL'].flatMap(side => engine.getBook(pair).getBook(side).map(order => ({ ...order,
        price: order.price === null ? null : new BigNumber(order.price), originalQuantity: new BigNumber(order.originalQuantity), remainingQuantity: new BigNumber(order.remainingQuantity) }))));
      try { return await work(db); }
      catch (error) {
        balances = before.balances; orders = before.orders; trades = before.trades;
        for (const pair of pairs) for (const side of ['BUY', 'SELL']) for (const order of [...engine.getBook(pair).getBook(side)]) engine.cancelOrder(pair, order.id);
        for (const order of engineOrders) engine.loadRestingOrder(order);
        throw error;
      } finally { release(); }
    },
  };
  const sid = 'local-' + randomBytes(12).toString('hex');
  sessions.set(sid, { id: sid, userId, revokedAt: null, lastSeenAt: new Date() });
  const token = jwt.sign({ sub: userId, sid }, process.env.JWT_SECRET, { expiresIn: '12h' });
  return { db, userId, token, snapshot: () => ({ balances: copy([...balances.values()]), orders: copy([...orders.values()]), trades: copy(trades) }) };
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Build the normal frontend first');
  fs.mkdirSync(output, { recursive: true });
  const run = fs.mkdtempSync(path.join(output, 'run-'));
  const engine = new MatchingEngine(); const fixture = memoryPrisma(engine);
  const kraken = new KrakenMarketDataService(); const coinGecko = new CoinGeckoService(); const fear = new FearGreedService();
  const app = express(); app.disable('x-powered-by');
  let origin; const journal = []; const bootstrapKey = randomBytes(18).toString('hex');
  const persist = () => fs.writeFileSync(path.join(run, 'journal.json'), JSON.stringify({ environment: 'LOCAL QA ONLY', market: 'Actual public Kraken/CoinGecko services; external book is not internal execution liquidity', requests: journal, ...fixture.snapshot() }, null, 2));
  app.use((req, res, next) => {
    const ownOrigin = origin || `http://127.0.0.1:${port}`;
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== new URL(ownOrigin).host) return res.status(403).json({ error: 'Loopback QA only' });
    if (req.headers.origin && req.headers.origin !== ownOrigin) return res.status(403).json({ error: 'Same-origin QA only' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Same-origin QA only' });
    // Guard against an accidentally production-bound VITE_API_URL. The real
    // public Kraken socket remains untouched; no fake websocket is served.
    res.setHeader('Content-Security-Policy', "connect-src 'self' wss://ws.kraken.com https://api.kraken.com");
    res.setHeader('Cache-Control', 'no-store');
    // Capture before mounted routers temporarily strip their prefix from
    // req.url/path. Completion logging must retain the original API route.
    const requestPath = req.originalUrl.split('?')[0];
    const requestMethod = req.method;
    res.on('finish', () => {
      if (!requestPath.startsWith('/api/') && !requestPath.startsWith('/__qa/')) return;
      journal.push({ at: new Date().toISOString(), method: requestMethod, path: requestPath, status: res.statusCode });
      persist();
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const auth = requireAuth(fixture.db);
  app.use('/api/v1', marketRouter(kraken, coinGecko, fear, fixture.db));
  app.use('/api/v1', ordersRouter(fixture.db, engine, kraken));
  app.use('/api/v1', balancesRouter(fixture.db));
  app.use('/api/v1', tradesRouter(fixture.db));
  app.get('/api/v1/me', auth, (_req, res) => res.json({ id: fixture.userId, displayName: 'Local Spot QA', email: 'local-spot-qa@example.invalid', isAdmin: false, avatarUrl: null, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: new Date().toISOString() }));
  app.get(['/api/v1/products', '/api/v1/user/products', '/api/v1/purchases/me', '/api/v1/futures/balances'], auth, (_req, res) => res.json([]));
  app.get('/api/v1/cfd/tickers', (_req, res) => res.json({ configured: false, tickers: [] }));
  app.get('/api/v1/support/conversations/mine', auth, (_req, res) => res.json({ conversation: null, messages: [] }));
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', environment: 'LOCAL QA ONLY' }));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside isolated Spot QA scope', path: req.path }));
  app.get('/__qa/bootstrap/:key', (req, res) => {
    if (req.params.key !== bootstrapKey) return res.sendStatus(404);
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>LOCAL SPOT QA</title><p>Local test account only. Opening the unchanged built Spot terminal…</p><script>if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('exchange_token',${JSON.stringify(fixture.token)});localStorage.setItem('exchange_lang','ru');location.replace('/trade');}</script>`);
  });
  app.get('/__qa/state', auth, (_req, res) => res.json({ environment: 'LOCAL QA ONLY', ...fixture.snapshot() }));
  app.use(express.static(dist, { index: false, redirect: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(port, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const boot = origin + '/__qa/bootstrap/' + bootstrapKey;
  fs.writeFileSync(path.join(run, 'ready.json'), JSON.stringify({ origin, bootstrap: boot, pid: process.pid, run, fixture: '100000 USDT / 2 BTC, local fake balance only; no internal counterparties initially' }, null, 2));
  console.log(JSON.stringify({ status: 'READY', origin, bootstrap: boot, run }));
  if (!selfTest) { persist(); return; }
  const checks = [];
  const call = async (route, method = 'GET', body, authenticated = true) => {
    const response = await fetch(origin + '/api/v1' + route, { method, headers: { ...(authenticated ? { Authorization: 'Bearer ' + fixture.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = response.status === 204 ? null : await response.json(); return { status: response.status, value };
  };
  const place = body => call('/orders', 'POST', body);
  const cancel = id => call('/orders/' + id, 'DELETE');
  try {
    assert.equal((await call('/orders/me', 'GET', undefined, false)).status, 401); checks.push('actual requireAuth rejects no token');
    assert.equal((await fetch(origin + '/api/v1/balances', { headers: { Origin: 'https://voltextech.net' } })).status, 403); checks.push('cross-origin rejected');
    assert.equal((await place({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '-1', quantity: '0.001' })).status, 400);
    assert.equal((await place({ pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.001' })).status, 400); checks.push('invalid limit and empty internal market reject truthfully');
    const ticker = await kraken.getTicker('BTC/USDT'); assert.ok(ticker && Number(ticker.lastPrice) > 0, 'Real Kraken price required, never synthesize');
    const p = new BigNumber(ticker.lastPrice); const value = multiplier => p.times(multiplier).toFixed(8);
    const limit = await place({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: value(0.5), quantity: '0.001' });
    assert.equal(limit.status, 201, JSON.stringify(limit.value)); assert.equal(limit.value.order.status, 'OPEN');
    assert.equal((await call('/orders/me?status=OPEN')).value.length, 1); assert.equal((await cancel(limit.value.order.id)).status, 204);
    assert.equal((await cancel(limit.value.order.id)).status, 404); checks.push('real resting LIMIT persisted, listed, cancelled and duplicate cancel rejected');
    const sellLimit = await place({ pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: value(1.5), quantity: '0.001' });
    assert.equal(sellLimit.status, 201, JSON.stringify(sellLimit.value)); assert.equal(sellLimit.value.order.status, 'OPEN');
    assert.equal((await cancel(sellLimit.value.order.id)).status, 204);
    const sellMarket = await place({ pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: '0.001' });
    assert.equal(sellMarket.status, 201); assert.equal(sellMarket.value.order.status, 'CANCELLED'); assert.deepEqual(sellMarket.value.trades, []);
    checks.push('SELL limit locks/refunds BTC; empty-book SELL market is honestly CANCELLED without fills');
    for (const type of ['STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET']) {
      const level = type.startsWith('STOP') ? 1.15 : 0.85;
      const result = await place({ pair: 'BTC/USDT', side: 'BUY', type, triggerPrice: value(level), ...(type.endsWith('LIMIT') ? { price: value(level) } : {}), quantity: '0.001' });
      assert.equal(result.status, 201, JSON.stringify(result.value)); assert.equal(result.value.order.status, 'PENDING_TRIGGER');
      const moved = await call('/orders/' + result.value.order.id + '/trigger', 'PATCH', { triggerPrice: value(type.startsWith('STOP') ? 1.2 : 0.8) });
      assert.equal(moved.status, 200, JSON.stringify(moved.value)); assert.equal((await cancel(result.value.order.id)).status, 204);
      checks.push(type + ': persisted, actual trigger patched, cancelled with refund');
    }
    assert.equal((await place({ pair: 'BTC/USDT', side: 'BUY', type: 'STOP_MARKET', triggerPrice: value(0.5), quantity: '0.001' })).status, 400); checks.push('wrong trigger direction rejected against real market');
    const oco = await call('/orders/oco', 'POST', { pair: 'BTC/USDT', side: 'BUY', quantity: '0.001', takeProfitPrice: value(0.8), stopTriggerPrice: value(1.2), stopLimitPrice: value(1.21) });
    assert.equal(oco.status, 201, JSON.stringify(oco.value)); assert.equal((await call('/orders/me?status=PENDING_TRIGGER')).value.length, 2);
    assert.equal((await cancel(oco.value.takeProfitOrderId)).status, 204); assert.equal((await call('/orders/me?status=PENDING_TRIGGER')).value.length, 0); checks.push('real OCO siblings persisted and both cancelled once');
    const before = fixture.snapshot();
    assert.equal((await place({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: value(10), quantity: '1000000' })).status, 400);
    assert.deepEqual(fixture.snapshot(), before); checks.push('insufficient funds transaction leaves state unchanged');
    const final = await call('/balances');
    assert.deepEqual(final.value.map(row => [row.asset, row.available, row.locked]), [['USDT', '100000', '0'], ['BTC', '2', '0']]);
    assert.equal((await call('/trades/me')).value.length, 0); checks.push('all locks refunded exactly; no invented fills');
    // An intentionally failed isolated transaction proves adapter rollback,
    // including the real in-memory order book, not just returned balances.
    const snapshot = fixture.snapshot();
    await assert.rejects(fixture.db.$transaction(async tx => {
      await tx.balance.update({ where: { userId_asset: { userId: fixture.userId, asset: 'USDT' } }, data: { available: '1' } });
      engine.loadRestingOrder({ id: 'local-rollback-proof', userId: fixture.userId, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: p,
        originalQuantity: new BigNumber('0.001'), remainingQuantity: new BigNumber('0.001'), status: 'OPEN', createdAt: Date.now(), updatedAt: Date.now() });
      throw new Error('intentional local rollback proof');
    }));
    assert.deepEqual(fixture.snapshot(), snapshot); assert.equal(engine.getBook('BTC/USDT').getBook('BUY').length, 0);
    checks.push('isolated serial transaction rollback restores database and actual engine order book');
    for (const [method, route, status] of [
      ['GET', '/api/v1/orders/me', 401], ['POST', '/api/v1/orders', 201],
      ['DELETE', '/api/v1/orders/' + limit.value.order.id, 204],
      ['GET', '/api/v1/balances', 200],
    ]) {
      assert.ok(journal.some(entry => entry.method === method && entry.path === route && entry.status === status),
        `Journal must retain mounted API path: ${method} ${route} ${status}`);
    }
    assert.ok(journal.some(entry => entry.method === 'PATCH' && entry.path.startsWith('/api/v1/orders/') && entry.status === 200));
    checks.push('completion journal retains original mounted API paths and actual status codes');
    const report = { status: 'PASS', checks, realTicker: { pair: 'BTC/USDT', price: ticker.lastPrice, observedAt: new Date().toISOString() }, run };
    fs.writeFileSync(path.join(run, 'self-test.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { persist(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
