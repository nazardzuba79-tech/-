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
