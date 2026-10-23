'use strict';
// Actual API router module-load smoke on Node 22.23.3, with NO database,
// credentials, provider calls, network listeners, trades or migrations.
// Uses the built CommonJS API, not ts-jest or a mocked ESM factory.
const test = require('node:test');
const assert = require('node:assert/strict');
// JWT auth middleware validates the secret during module import, before any
// route is constructed. Use an explicitly synthetic value in this test ONLY.
process.env.JWT_SECRET = 'synthetic-stocks-node22-jwt-unit-test-secret-long-enough';
const { stocksTestCashRouter } = require('../../../dist/api/routes/stocksTestCash.js');
const { openPostgresAuthority } = require('../postgres-authority.mjs');

const issuer = 'synthetic-node22-issuer';
const principals = [
  { issuer, subject: 'synthetic-principal-a' },
  { issuer, subject: 'synthetic-principal-b' },
];
const db = new Proxy({}, { get() { throw new Error('DATABASE_ACCESS_FORBIDDEN'); } });
const config = {
  enabled: true, issuer, principals,
  gatewayKey: 'synthetic-node22-gateway-capability-never-used',
  secret: 'synthetic-node22-session-secret-never-used',
};

test('runs exactly the pinned Hetzner Node version', () => {
  assert.equal(process.versions.node, '22.23.3');
});

test('actual ESM authority is synchronously loadable without database side effects', () => {
  assert.equal(typeof openPostgresAuthority, 'function');
  const authority = openPostgresAuthority(db, { issuer, tradePrincipals: principals });
  assert.equal(typeof authority.execute, 'function');
  assert.equal(typeof authority.metrics, 'function');
});

test('default-off route stays empty, even if other auth config is invalid', () => {
  const was = process.env.STOCKS_TEST_CASH_ENABLED;
  const tradePrincipals = process.env.STOCKS_TRADE_PRINCIPALS;
  try {
    process.env.STOCKS_TEST_CASH_ENABLED = 'false';
    process.env.STOCKS_TRADE_PRINCIPALS = 'malformed-json';
    const router = stocksTestCashRouter(db);
    assert.deepEqual(router.stack, []);
  } finally {
    if (was === undefined) delete process.env.STOCKS_TEST_CASH_ENABLED;
    else process.env.STOCKS_TEST_CASH_ENABLED = was;
    if (tradePrincipals === undefined) delete process.env.STOCKS_TRADE_PRINCIPALS;
    else process.env.STOCKS_TRADE_PRINCIPALS = tradePrincipals;
  }
});

test('enabled route loads its REAL ESM authority on Node 22 and declares only expected endpoints', () => {
  // No injected fake authority: exercise the production require(ESM) path.
  const router = stocksTestCashRouter(db, config);
  const paths = router.stack.filter(layer => layer.route).map(layer => layer.route.path).sort();
  assert.deepEqual(paths, [
    '/stocks-test-cash/command',
    '/stocks-test-cash/identity',
    '/stocks-test-cash/readiness',
    '/stocks-test-cash/wallet',
  ]);
});

test('misconfigured enabled route fails closed before reading the database', () => {
  assert.throws(
    () => stocksTestCashRouter(db, { ...config, principals: [] }),
    /STOCKS_AUTHORITY_CONFIG_INVALID/,
  );
});

test('compiled catalogue-only API permits authenticated identity/readiness but never finance', async () => {
  const express = require('express'), request = require('supertest'), jwt = require('jsonwebtoken');
  const counts = { transactions: 0, writes: 0, schema: 0 };
  const fakeDb = {
    user: {
      findUnique: async ({where}) => ({id: where.id}),
      findMany: async () => principals.map(p => ({id: p.subject})),
    },
    session: { findUnique: async ({where}) => ({
      id: where.id, userId: where.id.slice('session-'.length), revokedAt: null,
      lastSeenAt: new Date(), remembered: false, user: {email: 'fixture@example.invalid'},
    }) },
    auditLog: {findFirst: async () => null},
    $queryRawUnsafe: async query => {
      assert.match(query, /^SELECT "principalHash" FROM "StocksTest(Account|Receipt|Audit)" WHERE false$/);
      counts.schema++; return [];
    },
    $executeRawUnsafe: async () => { counts.writes++; throw Error('FINANCIAL_WRITE_FORBIDDEN'); },
    $transaction: async () => { counts.transactions++; throw Error('FINANCIAL_TRANSACTION_FORBIDDEN'); },
  };
  const cfg = {...config, enabled: false, catalogueEnabled: true, secret: process.env.JWT_SECRET};
  const app = express(); app.use(express.json());
  app.use('/api/v1', stocksTestCashRouter(fakeDb, cfg)); // REAL PostgreSQL authority factory.
  const base = '/api/v1/stocks-test-cash';
  assert.equal((await request(app).get(base+'/readiness')).status, 401);
  assert.equal(counts.schema, 0);
  const proof = await request(app).get(base+'/readiness').set('x-stocks-authority-key', config.gatewayKey);
  assert.equal(proof.status, 200);
  assert.equal(proof.body.authority, 'postgres');
  assert.equal(proof.body.tradingEnabled, false);
  assert.equal(counts.schema, 3);
  for (const subject of [...principals.map(p => p.subject), 'fixture-viewer']) {
    const token = jwt.sign({sub: subject, sid: 'session-'+subject, role: 'admin'}, process.env.JWT_SECRET, {expiresIn:'1h'});
    assert.equal((await request(app).get(base+'/identity').set('Authorization','Bearer '+token)).status, 200);
    for (const [route,method] of [['wallet','get'],['command','post']]) {
      const response = await request(app)[method](base+'/'+route).set('Authorization','Bearer '+token)
        .set('x-stocks-authority-key', config.gatewayKey).send({type:'ensure'});
      assert.equal(response.status,403);
      assert.equal(response.body.error,'STOCKS_TRADING_DISABLED');
      assert.equal((await request(app)[method](base+'/'+route).set('x-stocks-authority-key', config.gatewayKey)).status,401);
    }
  }
  // Enabling finance still does not let a forged viewer reach a transaction.
  const enabledApp = express(); enabledApp.use(express.json());
  // Both server gates on (finance and #593's order execution): the viewer is still refused by the authority itself.
  enabledApp.use('/api/v1', stocksTestCashRouter(fakeDb, {...cfg, enabled:true, orderExecutionEnabled:true}));
  const forged = jwt.sign({sub:'fixture-viewer',sid:'session-fixture-viewer',isOwner:true},process.env.JWT_SECRET,{expiresIn:'1h'});
  const denied = await request(enabledApp).post(base+'/command').set('Authorization','Bearer '+forged)
    .set('x-stocks-authority-key',config.gatewayKey).send({type:'ensure'});
  assert.equal(denied.status,401); assert.equal(denied.body.error,'AUTH_REQUIRED');
  assert.equal(counts.transactions,0); assert.equal(counts.writes,0);
});
