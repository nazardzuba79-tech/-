'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audit, sanitize, QUERIES } = require('./demo-production-preflight-readonly.cjs');

test('four static SELECT-only aggregates use one read-only transaction and redact identities', async () => {
  const actions = [];
  const responses = [
    [{ count: 0n, pairs: 0n }],
    [{ count: 2n }],
    [{ count: 3n }],
    [{ status: 'APPROVED', count: 1n }, { status: 'PENDING', count: 2n }],
  ];
  const prisma = {
    async $transaction(work) {
      actions.push('TRANSACTION');
      return work({
        async $executeRawUnsafe(sql) { actions.push(sql); },
        async $queryRawUnsafe(sql) { actions.push(sql); return responses.shift(); },
      });
    },
  };
  const report = await audit(prisma);
  assert.equal(report.legacyActiveDemoOrders.count, '0');
  assert.equal(report.legacyActiveDemoOrders.pairs, '0');
  assert.equal(report.dualLedgerAccounts.count, '2');
  assert.equal(report.legacyOrdinaryFundedAccounts.count, '3');
  assert.deepEqual(report.unheldCrossWithdrawals, { PENDING: '2', APPROVED: '1' });
  assert.equal(report.decision, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(report.blockers.dualLedgerOwnerReview, true);
  assert.equal(report.blockers.unheldCrossRequestsOwnerReview, true);
  assert.equal(report.blockers.inconsistentDemoOrders, false);
  assert.equal(actions[1], 'SET TRANSACTION READ ONLY');
  assert.equal(actions.filter(sql => /SELECT/i.test(sql)).length, QUERIES.length);
  for (const sql of actions.slice(4)) {
    assert.match(sql, /^\s*(WITH|SELECT)/i);
    assert.doesNotMatch(sql, /\b(INSERT|DELETE|UPDATE|TRUNCATE|ALTER|DROP|CREATE)\s+["A-Za-z]/i);
  }
  assert(!JSON.stringify(report).includes('@example'));
  assert(!JSON.stringify(report).includes('postgresql://'));
});

test('bad or unexpected result never prints raw rows or secrets', () => {
  assert.throws(() => sanitize([{ count: '1', email: 'private@example.invalid' }, { count: '2' }], 'dualLedgerAccounts'));
  assert.throws(() => sanitize([{ status: 'SENT', count: '2' }], 'unheldCrossWithdrawals'));
  assert.throws(() => sanitize([{ count: '-4' }], 'dualLedgerAccounts'));
});

test('query set is stable and covers all three mandatory preflight checks', () => {
  assert.deepEqual(QUERIES.map(q => q.name), [
    'legacyActiveDemoOrders','dualLedgerAccounts','legacyOrdinaryFundedAccounts','unheldCrossWithdrawals',
  ]);
});
