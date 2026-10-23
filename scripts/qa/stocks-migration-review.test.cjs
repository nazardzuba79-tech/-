'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { review, hash } = require('./stocks-migration-review.cjs');
const old = { name: '20261015090000_kyc_material_requests', sha256: hash('historical\r\n') };
const stocks = { name: '20261016000000_stocks_test_cash_authority', sha256: hash('synthetic stocks') };
const funding = { name: '20261016170000_native_funding_model', sha256: hash('synthetic funding') };
test('exact history and sole reviewed Stocks SQL pass file review, not authorization', () => {
  const result = review([old], [old, stocks], [stocks]);
  assert.equal(result.status, 'PASS_FILE_REVIEW_ONLY');
  assert.equal(result.productionAuthorized, false);
  assert.equal(result.sqlExecuted, false);
});
test('full main funding addition cannot silently enter a Stocks-only candidate', () => {
  assert.deepEqual(review([old], [old, stocks, funding], [stocks]).unexpected, [funding.name]);
});
test('historical CRLF to LF substitution is detected without rewriting SQL', () => {
  const result = review([old], [{ ...old, sha256: hash('historical\n') }, stocks], [stocks]);
  assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.changedHistory, [old.name]);
});
test('missing historical migration blocks', () => assert.deepEqual(review([old], [stocks], [stocks]).missing, [old.name]));
test('changed approved SQL blocks', () => assert.deepEqual(review([old], [old, { ...stocks, sha256: hash('changed') }], [stocks]).changedPending, [stocks.name]));
test('missing approved SQL blocks', () => assert.deepEqual(review([old], [old], [stocks]).missingApproved, [stocks.name]));
test('duplicate manifests and overlapping approvals fail closed', () => {
  assert.throws(() => review([old], [old, old], []), /DUPLICATE/);
  assert.throws(() => review([old], [old], [old]), /OVERLAPS/);
});
test('empty baseline, unsafe names and invalid hashes fail closed', () => {
  assert.throws(() => review([], [old], []), /EMPTY/);
  assert.throws(() => review([{ ...old, name: '../escape' }], [], []), /INVALID/);
  assert.throws(() => review([old], [{ ...stocks, sha256: 'bad' }], []), /INVALID/);
});
