'use strict';
// Narrow compiled-router unit/integration test. No Prisma connection, migration,
// real account, existing balance or external market source is opened.
process.env.JWT_SECRET = 'catalogue-readiness-synthetic-session-key-only';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:9/catalogue_never_connected';
process.env.DIRECT_URL = process.env.DATABASE_URL;
const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express'), jwt = require('jsonwebtoken');
const { stocksTestCashRouter } = require('../../dist/api/routes/stocksTestCash.js');
const issuer = 'catalogue-readiness-unit', key = 'catalogue-readiness-internal-synthetic-key-32';
async function fixture(t, { enabled = false, schemaPresent = false, boundUsers = 2 } = {}) {
  const calls = { schema: [], financial: 0, identities: 0, bindingChecks: 0 }, revoked = new Set();
  const prisma = {
    user: {
      findMany: async () => { calls.bindingChecks++; return Array.from({ length: boundUsers }, (_, i) => ({ id: 'fixture-' + i })); },
      findUnique: async ({ where }) => ({ id: where.id }),
    },
    session: {
      findUnique: async ({ where }) => { calls.identities++; return { id: where.id, userId: where.id.slice(8), revokedAt: revoked.has(where.id) ? new Date() : null, lastSeenAt: new Date(), remembered: false, user: { email: 'fixture@example.invalid' } }; },
      update: async () => {},
    },
    auditLog: { findFirst: async () => null },
    $queryRawUnsafe: async sql => { calls.schema.push(sql); if (!schemaPresent) throw Error('MISSING_FINANCIAL_TABLE'); return []; },
    $transaction: async () => { calls.financial++; throw Error('FINANCIAL_ACCESS_FORBIDDEN'); },
    // requireAuth singleSessionRead: the one-query session read (one id, or all of an identity batch), from the rows above.
    $queryRaw: async (_sql, ...values) => {
      const { contactEmailHash } = require('../../dist/services/ContactEmailPolicy.js'), rows = [];
      for (const id of [values[values.length - 1]].flat()) {
        const s = await prisma.session.findUnique({ where: { id } }); if (!s) continue;
        const event = await prisma.auditLog.findFirst({});
        rows.push({ ...s, createdAt: null, email: s.user.email, role: null, emailHash: contactEmailHash(s.user.email), contactAction: event?.action ?? null });
      }
      return rows;
    },
  };
  for (const name of ['demoBalance', 'stocksTestAccount', 'stocksTestReceipt', 'stocksTestAudit']) Object.defineProperty(prisma, name, { get() { calls.financial++; throw Error('FINANCIAL_ACCESS_FORBIDDEN'); } });
  const app = express(); app.use(express.json());
  app.use('/api/v1', stocksTestCashRouter(prisma, { catalogueEnabled: true, enabled, orderExecutionEnabled: false,
    issuer, gatewayKey: key, secret: process.env.JWT_SECRET,
    principals: [0,1].map(i => ({ issuer, subject: 'fixture-' + i })),
  })); // Actual PostgreSQL authority constructor; no injected fake readiness route.
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/stocks-test-cash/';
  const token = subject => jwt.sign({ sub: subject, sid: 'session-' + subject }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { calls, revoked, token, request: (route, options) => fetch(base + route, options) };
}
test('catalogue-only readiness works without financial tables/balances; every identity request still checks revocation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('readiness')).status, 401);
  assert.equal(f.calls.bindingChecks, 0);
  const readiness = await f.request('readiness', { headers: { 'x-stocks-authority-key': key } });
  assert.equal(readiness.status, 200, 'catalogue does not depend on optional trading DDL');
  assert.equal((await readiness.json()).tradingEnabled, false);
  assert.deepEqual(f.calls.schema, []);
  for (const subject of ['fixture-0', 'fixture-1', 'viewer']) {
    const headers = { Authorization: 'Bearer ' + f.token(subject), 'x-stocks-authority-key': key, 'Content-Type': 'application/json' };
    assert.equal((await f.request('identity', { headers })).status, 200);
    for (const [route, options] of [['wallet', { headers }], ['command', { method: 'POST', headers, body: JSON.stringify({ type: 'ensure' }) }]]) {
      const response = await f.request(route, options);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'STOCKS_TRADING_DISABLED');
    }
  }
  f.revoked.add('session-viewer');
  assert.equal((await f.request('identity', { headers: { Authorization: 'Bearer ' + f.token('viewer') } })).status, 401);
  assert.ok(f.calls.identities >= 4);
  assert.equal(f.calls.financial, 0);
  assert.deepEqual(f.calls.schema, []);
});
test('financial authority still requires all three tables, even with order execution OFF', async t => {
  const missing = await fixture(t, { enabled: true });
  assert.equal((await missing.request('readiness', { headers: { 'x-stocks-authority-key': key } })).status, 503);
  assert.equal(missing.calls.schema.length, 1);
  const ready = await fixture(t, { enabled: true, schemaPresent: true });
  const response = await ready.request('readiness', { headers: { 'x-stocks-authority-key': key } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tradingEnabled, false);
  assert.equal(ready.calls.schema.length, 3);
  assert.equal(ready.calls.financial, 0);
});
test('catalogue readiness still fails closed on unavailable approved bindings', async t => {
  const f = await fixture(t, { boundUsers: 1 });
  assert.equal((await f.request('readiness', { headers: { 'x-stocks-authority-key': key } })).status, 503);
  assert.equal(f.calls.financial, 0);
});
