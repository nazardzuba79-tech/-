'use strict';
// CI transport and disposable database fixtures only. Never imported by the app.
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const config = fs.existsSync('/smoke-private/config.json') ? JSON.parse(fs.readFileSync('/smoke-private/config.json', 'utf8')) : {};
const APP = '133cb85a95003c229829b1ecef3d8d0e6308db95';
const ORIGIN = 'https://stocks.fixture.invalid:4443';
const ID = 'BYBIT:AAPLXUSDT';
const users = ['stocks-smoke-trader-a', 'stocks-smoke-trader-b', 'stocks-smoke-viewer'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const prisma = () => {
  const { PrismaClient } = require('/app/node_modules/@prisma/client');
  const url = new URL(config.databaseUrl);
  assert.equal(url.hostname, 'postgres');
  assert.match(url.pathname, /^\/stocks_disposable_[a-z0-9_]+$/);
  return new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
};
const pass = (name, evidence = {}) => console.log(JSON.stringify({ check: name, result: 'PASS', ...evidence }));
async function setup() {
  let db = prisma();
  try {
    const actual = await db.$queryRawUnsafe('SELECT current_database() AS name, version() AS version');
    assert.equal(actual[0].name, new URL(config.databaseUrl).pathname.slice(1));
    assert.match(actual[0].version, /^PostgreSQL 18\.6 /);
    const tls = await db.$queryRawUnsafe('SELECT ssl, version FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    assert.equal(tls[0].ssl, true); assert.match(tls[0].version, /^TLSv1\.[23]$/);
    assert.deepEqual(await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'"), []);
    pass('empty-disposable-postgresql', { version: actual[0].version });
    pass('postgresql-client-certificate-verification-and-tls', { protocol: tls[0].version });
    pass('runtime-components', { node: process.version, openssl: process.versions.openssl,
      prisma: require('/app/node_modules/@prisma/client').Prisma.prismaVersion.client });
  } finally { await db.$disconnect(); }
  cp.execFileSync(process.execPath, ['/app/node_modules/prisma/build/index.js', 'db', 'push',
    '--skip-generate', '--schema', '/smoke/base-schema.prisma'], {
    env: { ...process.env, DATABASE_URL: config.databaseUrl, DIRECT_URL: config.databaseUrl },
    stdio: 'pipe', timeout: 60000,
  });
  db = prisma();
  try {
    const sql = fs.readFileSync('/app/prisma/migrations/20261016000000_stocks_test_cash_authority/migration.sql', 'utf8');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    const passwordHash = await require('/app/node_modules/bcrypt').hash(config.password, 10);
    const sessions = [];
    for (let i = 0; i < users.length; i++) {
      await db.user.create({ data: { id: users[i], email: users[i] + '@example.invalid',
        passwordHash, referralCode: crypto.randomBytes(10).toString('hex'), role: 'USER' } });
      if (i < 2) {
        sessions.push(await db.session.create({ data: { userId: users[i] } }));
        await db.demoBalance.create({ data: { userId: users[i], asset: 'USDT',
          available: i === 0 ? '731.25' : '129.875', locked: '0' } });
      }
    }
    const { openPostgresAuthority } = await import('/app/services/stocks-global/postgres-authority.mjs');
    const authority = openPostgresAuthority(db, { issuer: config.issuer, tradePrincipals: config.principals });
    for (let i = 0; i < 2; i++) await authority.bindExisting({
      issuer: config.issuer, subject: users[i], userId: users[i],
      sessionId: sessions[i].id, expiresAt: Date.now() + 3600000,
    });
    pass('fabricated-users-and-existing-demo-cash-bound', { traders: 2, viewers: 1, asset: 'USDT' });
  } finally { await db.$disconnect(); }
}
function transport(role) {
  const tls = { key: fs.readFileSync('/smoke-private/key.pem'), cert: fs.readFileSync('/smoke-private/cert.pem') };
  let sequence = 1;
  const counts = {};
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  // These deliberately fictional prices are confined to the private Docker network.
  // Real application parsers, freshness checks and accounting are not replaced.
  if (role === 'provider') https.createServer(tls, (req, res) => {
    if(req.url === '/__smoke/provider-counts') return json(res, 200, counts);
    const u = new URL(req.url, 'https://' + req.headers.host);
    counts[u.hostname + u.pathname] = (counts[u.hostname + u.pathname] || 0) + 1;
    const now = Date.now();
    if (u.hostname === 'api.bybit.com') {
      let result;
      if (u.pathname === '/v5/market/instruments-info') result = { list: [
        { symbol: 'AAPLXUSDT', status: 'Trading', xstockMultiplier: '1' },
      ] };
      if (u.pathname === '/v5/market/tickers') result = { list: [
        { symbol: 'AAPLXUSDT', lastPrice: '100', price24hPcnt: '0', volume24h: '1000' },
      ] };
      if (u.pathname === '/v5/market/orderbook') result = {
        s: 'AAPLXUSDT', ts: now, cts: now, u: sequence++, b: [['100', '1']], a: [['100', '1']],
      };
      if (u.pathname === '/v5/market/kline') {
        const step = Number(u.searchParams.get('interval') || 15) * 60000;
        const end = Math.floor(Math.min(Number(u.searchParams.get('end') || now), now) / step) * step;
        result = { symbol: 'AAPLXUSDT', list: Array.from({ length: 600 }, (_, i) =>
          [String(end - i * step), '100', '101', '99', '100', '1000', '100000']) };
      }
      if (result) return json(res, 200, { retCode: 0, time: now, result });
    }
    if (u.hostname === 'api.binance.com') {
      if (u.pathname === '/api/v3/exchangeInfo') return json(res, 200, { symbols: [] });
      if (u.pathname === '/api/v3/trades' && u.searchParams.get('symbol') === 'USDCUSDT')
        return json(res, 200, [{ id: sequence++, time: now, price: '1.001', qty: '1' }]);
      if (u.pathname === '/api/v3/ticker/24hr') return json(res, 200, []);
    }
    return json(res, 503, { error: 'CI_FIXTURE_NO_SOURCE' });
  }).listen(443, '127.0.0.1', () => pass('local-provider-transport-listening'));
  if (role === 'frontend') https.createServer(tls, (req, res) => {
    if (req.headers.host !== new URL(ORIGIN).host)
      return json(res, 403, { error: 'CI_PROXY_HOST_FORBIDDEN' });
    if (req.url === '/__smoke/ready') return json(res, 200, { isolatedFixture: true });
    const auth = /^\/api\/v1\/auth\/(login|logout)(?:\?|$)/.test(req.url);
    const stocks = req.url.startsWith('/__stocks_global/');
    const health = req.url === '/health';
    if (!auth && !stocks && !health) return json(res, 404, { error: 'PRIVATE_ROUTE_NOT_EXPOSED' });
    // Keep hostile forwarded headers intact: the real hosted adapter must reject them.
    const headers = { ...req.headers, host: new URL(ORIGIN).host };
    const out = http.request({ ...(stocks ? { socketPath: '/run/stocks-ingress/ingress.sock' } : { host: 'api-production', port: 3000 }),
      method: req.method, path: req.url, headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    out.setTimeout(10000, () => out.destroy(new Error('CI_PROXY_UPSTREAM_TIMEOUT')));
    out.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'CI_PROXY_UPSTREAM_UNAVAILABLE' }); else res.destroy(); });
    req.pipe(out);
  }).listen(4443, '0.0.0.0', () => pass('local-tls-proxy-listening'));
}
function request(path, { token, body, method, csrf, port = 4443, headers: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const secure = port === 4443;
    const client = secure ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = client.request({
      hostname: secure ? 'stocks.fixture.invalid' : '127.0.0.1', port, path,
      ...(secure ? { ca: fs.readFileSync('/smoke-private/cert.pem'), rejectUnauthorized: true } : {}),
      method: method || (payload === undefined ? 'GET' : 'POST'),
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        ...(secure ? { origin: ORIGIN } : {}), ...(csrf ? { 'x-stocks-token': csrf } : {}), ...extra },
      timeout: 12000,
    }, res => {
      const tls = secure ? { authorized: res.socket.authorized, protocol: res.socket.getProtocol() } : undefined;
      const chunks = [];
      res.on('data', x => chunks.push(x));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data; try { data = JSON.parse(raw); } catch { data = { nonJson: raw.slice(0,1000) }; }
        resolve({ status: res.statusCode, headers: res.headers, data, tls });
      });
    });
    req.on('timeout', () => req.destroy(new Error('CI_HTTP_TIMEOUT')));
    req.on('error', reject);
    req.end(payload);
  });
}
function expect(response, status, name) {
  assert.equal(response.status, status, `${name}: HTTP ${response.status}, safe error ${response.data?.error ?? 'none'}`);
  return response.data;
}
async function ready(token) {
  expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token }), 200, 'state demand');
  await sleep(2300);
  return expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token }), 200, 'fresh state');
}
async function check() {
  const db = prisma();
  try {
    const health = await request('/health');
    assert.equal(expect(health, 200, 'API health').commit, APP);
    assert.equal(health.tls.authorized, true);
    assert.match(health.tls.protocol, /^TLSv1\.[23]$/);
    pass('api-default-entrypoint-over-verified-local-tls', { commit: APP, protocol: health.tls.protocol });
    const before = await db.demoBalance.findMany({ orderBy: { userId: 'asc' } });
    const tokens = [];
    for (const user of users) {
      const data = expect(await request('/api/v1/auth/login', {
        body: { email: user + '@example.invalid', password: config.password },
      }), 200, 'normal VOLTEX password login');
      assert.equal(typeof data.token, 'string'); tokens.push(data.token);
    }
    assert.deepEqual(await db.demoBalance.findMany({ orderBy: { userId: 'asc' } }), before);
    pass('normal-http-login-does-not-create-or-credit-balances');
    for (const token of tokens.slice(0,2)) expect(await request('/api/v1/stocks-test-cash/wallet', { port:3000, token }), 200, 'existing public wallet remains authenticated and available');
    const readiness = expect(await request('/api/v1/stocks-test-cash/readiness', {
      port: 3001, headers: { 'x-stocks-authority-key': config.gatewayKey },
    }), 200, 'PG authority readiness');
    assert.equal(readiness.authority, 'postgres'); assert.equal(readiness.tradingEnabled, true);
    pass('real-postgresql-authority-readiness');
    const catalogue = expect(await request('/__stocks_global/catalogue', { token: tokens[0] }), 200, 'catalogue');
    assert.ok(catalogue.catalogue.some(x => x.id === ID && x.online), 'real parser recognizes isolated provider fixture');
    const history = expect(await request('/__stocks_global/history?id=' + encodeURIComponent(ID) + '&interval=15m', {
      token: tokens[0],
    }), 200, 'candle parser');
    assert.ok(history.candles.length > 0);
    assert.ok(history.candles.every(x => x.high === 101 && x.low === 99));
    pass('provider-wire-fixture-through-unchanged-parsers', { fixtureOnly: true, candles: history.candles.length });
    const order = (overrides = {}) => ({ id: crypto.randomUUID(), instrumentId: ID,
      currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1', ...overrides });
    const trade = async (token, body) => {
      const state = await ready(token);
      return request('/__stocks_global/orders', { token, csrf: state.token, body });
    };
    for (let i = 0; i < 2; i++) {
      const initial = await ready(tokens[i]);
      const buyIntent = order();
      const buy = expect(await request('/__stocks_global/orders', {
        token: tokens[i], csrf: initial.token, body: buyIntent,
      }), 200, 'BUY');
      assert.equal(buy.positions[ID + '|USDT'].quantity, '0.10000000');
      assert.equal(Number(buy.wallets.USDT.cash), Number(initial.wallets.USDT.cash) - 10);
      const replay = expect(await request('/__stocks_global/orders', {
        token: tokens[i], csrf: initial.token, body: buyIntent,
      }), 200, 'same-intent replay');
      assert.deepEqual(replay.wallets, buy.wallets);
      const partial = expect(await trade(tokens[i], order({ side: 'SELL', quantity: '0.04' })), 200, 'partial SELL');
      assert.equal(partial.positions[ID + '|USDT'].quantity, '0.06000000');
      const closed = expect(await trade(tokens[i], order({ side: 'SELL', quantity: '0.06' })), 200, 'full SELL');
      assert.equal(closed.positions[ID + '|USDT'].quantity, '0.00000000');
      assert.equal(closed.wallets.USDT.cash, initial.wallets.USDT.cash);
      const limitIntent = order({ type: 'LIMIT', limitPrice: '90' });
      const limit = expect(await trade(tokens[i], limitIntent), 200, 'LIMIT');
      assert.equal(limit.orders.find(x => x.id === limitIntent.id).status, 'OPEN');
      const cash = await db.demoBalance.findUnique({ where: { userId_asset: { userId: users[i], asset: 'USDT' } } });
      assert.equal(Number(cash.locked), 9);
      const state = await ready(tokens[i]);
      const cancelled = expect(await request('/__stocks_global/cancel', {
        token: tokens[i], csrf: state.token, body: { id: limitIntent.id },
      }), 200, 'cancel LIMIT');
      assert.equal(cancelled.orders.find(x => x.id === limitIntent.id).status, 'CANCELLED');
      const oversell = await trade(tokens[i], order({ side: 'SELL', quantity: '0.1' }));
      expect(oversell, 422, 'oversell rejected'); assert.equal(oversell.data.error, 'INSUFFICIENT_SHARES');
      const insufficient = await trade(tokens[i], order({ type: 'LIMIT', limitPrice: '1000000' }));
      expect(insufficient, 422, 'overspend rejected'); assert.equal(insufficient.data.error, 'INSUFFICIENT_FUNDS');
      const final = await ready(tokens[i]);
      assert.equal(final.wallets.USDT.cash, initial.wallets.USDT.cash);
      assert.equal(final.fills.length, 3);
      assert.ok(final.fills.every(x => Number(x.realized) === 0));
      pass('trader-' + i + '-buy-partial-full-sell-limit-cancel-idempotency', { fills: 3, cashRestored: true });
    }
    const rows = async () => ({
      cash: await db.demoBalance.findMany({ orderBy: { userId: 'asc' } }),
      receipts: await db.$queryRawUnsafe('SELECT * FROM "StocksTestReceipt" ORDER BY "intentId"'),
      audit: await db.$queryRawUnsafe('SELECT * FROM "StocksTestAudit" ORDER BY "intentId"'),
    });
    const protectedBefore = await rows();
    const viewer = await ready(tokens[2]);
    assert.equal(viewer.account.canTrade, false);
    expect(await request('/__stocks_global/orders', { token: tokens[2], csrf: viewer.token, body: order() }), 401, 'viewer write');
    const signedWrong = require('/app/node_modules/jsonwebtoken').sign({ sub: users[0], sid: 'wrong' },
      crypto.randomBytes(32).toString('hex'), { expiresIn: '5m' });
    expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token: signedWrong }), 401, 'bad JWT');
    const jwt = require('/app/node_modules/jsonwebtoken');
    const mismatchedIdentity = jwt.sign({ sub: users[2], sid: jwt.decode(tokens[0]).sid },
      config.jwtSecret, { expiresIn: '5m' });
    expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token: mismatchedIdentity }),
      401, 'valid signature cannot pair a different user with a trader session');
    const noTrade = expect(await request('/api/v1/stocks-test-cash/command', {
      port: 3011, token: tokens[0], headers: { 'x-stocks-authority-key': config.gatewayKey }, body: { type: 'ensure' },
    }), 403, 'financial-off authority');
    assert.equal(noTrade.error, 'STOCKS_TRADING_DISABLED');
    expect(await request('/api/v1/stocks-test-cash/command', { token: tokens[0], body: { type: 'ensure' } }),
      404, 'authority cannot be reached through public TLS');
    const forwarded = await request('/__stocks_global/state?id=' + encodeURIComponent(ID), {
      token: tokens[0], headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    assert.ok(forwarded.status >= 400 && forwarded.status < 500);
    assert.equal(forwarded.data.error, 'HOST_FORBIDDEN');
    const hostileOrigin = await request('/__stocks_global/state?id=' + encodeURIComponent(ID), {
      token: tokens[0], headers: { origin: 'https://different.fixture.invalid' },
    });
    assert.ok(hostileOrigin.status >= 400 && hostileOrigin.status < 500);
    assert.equal(hostileOrigin.data.error, 'ORIGIN_FORBIDDEN');
    const hostileHost = await request('/__stocks_global/state?id=' + encodeURIComponent(ID), {
      port: 4438, token: tokens[0], headers: { host: 'different.fixture.invalid' },
    });
    assert.ok(hostileHost.status >= 400 && hostileHost.status < 500);
    assert.equal(hostileHost.data.error, 'HOST_FORBIDDEN');
    expect(await request('/api/v1/auth/logout', { token: tokens[0], body: {} }), 200, 'logout');
    expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token: tokens[0] }), 401, 'revoked read');
    expect(await request('/__stocks_global/orders', { token: tokens[0], csrf: viewer.token, body: order() }), 401, 'revoked write');
    expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token: tokens[1] }), 200, 'other trader unaffected');
    assert.deepEqual(await rows(), protectedBefore);
    assert.equal(await db.demoBalance.count(), 2);
    for (const row of await db.demoBalance.findMany()) {
      assert.equal(Number(row.locked), 0);
      assert.equal(String(row.available), String(before.find(x => x.userId === row.userId).available));
    }
    pass('viewer-jwt-revocation-financial-off-private-route-and-ingress-protection');
    pass('single-existing-USDT-demo-cash-isolated-and-no-denial-writes');
    console.log(JSON.stringify({ providerCalls: await (await fetch('https://api.bybit.com/__smoke/provider-counts')).json() }));
    await quotaChecks(tokens[1], rows, protectedBefore);
    pass('positive-smoke-complete', { applicationSha: APP, realProductionBootstrap: 'NOT_RUN' });
  } finally { await db.$disconnect(); }
}
async function quotaChecks(token, rows, before) {
  const live = expect(await request('/__stocks_global/state?id=' + encodeURIComponent(ID), { token }), 200, 'trader context before quota check');
  const csrf = live.token;
  for (const headers of [{}, { 'x-stocks-authority-key': config.gatewayKey },
    { 'x-stocks-authority-key': config.gatewayKey, 'x-forwarded-for': '127.0.0.1' }]) {
    expect(await request('/api/v1/stocks-test-cash/identity', { port: 3000, token, headers }), 403, 'public listener cannot claim private quota');
  }
  // Exhaust only AFTER the complete financial/denial scenario; no retries or sleeps
  // to manufacture sufficient quota during that scenario. These are bounded checks.
  const probe = (phase = false) => request('/api/v1/stocks-test-cash/readiness', {
    port: 3001, headers: { 'x-stocks-authority-key': config.gatewayKey, ...(phase ? { 'x-smoke-phase': 'after-functional-scenario' } : {}) },
  });
  const first = await probe(true); expect(first, 200, 'remaining private quota after full scenario');
  assert.equal(Number(first.headers['ratelimit-limit']), 240);
  const remaining = Number(first.headers['ratelimit-remaining']);
  assert.ok(Number.isInteger(remaining) && remaining >= 0 && remaining < 240);
  pass('full-financial-scenario-before-intentional-quota-exhaustion', { remaining, resetSeconds: first.headers['ratelimit-reset'] });
  for (let i = 0; i < remaining; i++) expect(await probe(), 200, 'private quota remaining token');
  const denied = await probe(); expect(denied, 429, 'private quota exhausted');
  assert.equal(denied.data.error, 'AUTH_RATE_LIMIT');
  assert.ok(Number(denied.headers['retry-after']) > 0);
  const blockedOrder = await request('/__stocks_global/orders', {
    token, csrf, body: { id: crypto.randomUUID(), instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'LIMIT', quantity: '0.1', limitPrice: '90' },
  });
  expect(blockedOrder, 429, 'exhausted authority becomes gateway429, no financial retry');
  assert.equal(blockedOrder.data.error, 'AUTH_RATE_LIMIT');
  assert.deepEqual(await rows(), before, 'quota denial cannot mutate balances/receipts/audit');
  const publicFirst = await request('/health', { port: 3000 }); expect(publicFirst, 200, 'independent public budget');
  assert.equal(Number(publicFirst.headers['ratelimit-limit']), 120);
  const publicRemaining = Number(publicFirst.headers['ratelimit-remaining']);
  assert.ok(Number.isInteger(publicRemaining) && publicRemaining >= 0 && publicRemaining < 120);
  for (let i = 0; i < publicRemaining; i++) expect(await request('/health', { port: 3000 }), 200, 'public quota remaining token');
  expect(await request('/health', { port: 3000 }), 429, 'public120 unchanged');
  pass('bounded-private240-public120-exhaustion-and-no-financial-write');
}
const mode = process.argv[2];
Promise.resolve().then(() => {
  assert.equal(process.versions.node, '22.23.3');
  if (mode === 'setup') return setup();
  if (mode === 'provider' || mode === 'frontend') return transport(mode);
  if (mode === 'check') return check();
  if (mode === 'ready') return request('/health').then(r => expect(r, 200, 'ready'));
  throw new Error('UNKNOWN_FIXTURE_MODE');
}).catch(error => {
  // The host redacts generated fixture secrets before logging this output.
  console.error(error.stack || error.message);
  if (error.stderr) console.error(String(error.stderr));
  process.exitCode = 1;
});
