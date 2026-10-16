'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, checkLedger, redact, MIGRATION } = require('./kyc-hetzner-prisma.cjs');
const env = { VOLTEX_RUNTIME_MODE: 'production', VOLTEX_RELEASE_SHA: 'a'.repeat(40) };
const approved = { ...env, KYC_APPROVED_RELEASE_SHA: env.VOLTEX_RELEASE_SHA, KYC_VERIFIED_BACKUP_SHA256: 'b'.repeat(64) };
test('status is explicit and read-only', () => assert.equal(plan(['status'], env), 'status'));
test('no implicit deploy or arbitrary Prisma command', () => {
  for (const args of [[], ['resolve'], ['deploy', '--force'], ['reset']]) assert.throws(() => plan(args, approved));
});
test('requires production mode and exact SHA', () => {
  assert.throws(() => plan(['status'], { ...env, VOLTEX_RUNTIME_MODE: 'verify' }));
  assert.throws(() => plan(['status'], { ...env, VOLTEX_RELEASE_SHA: 'main' }));
});
test('deploy requires matching approval and backup receipt', () => {
  assert.throws(() => plan(['deploy'], env));
  assert.throws(() => plan(['deploy'], { ...approved, KYC_APPROVED_RELEASE_SHA: 'c'.repeat(40) }));
  assert.throws(() => plan(['deploy'], { ...approved, KYC_VERIFIED_BACKUP_SHA256: '' }));
  assert.equal(plan(['deploy'], approved), 'deploy');
});
const old = { migration_name: 'old', finished_at: new Date(), rolled_back_at: null };
test('only exact KYC migration may be pending', () => {
  assert.doesNotThrow(() => checkLedger([old], ['old', MIGRATION]));
  assert.throws(() => checkLedger([old], ['old', 'another', MIGRATION]));
  assert.throws(() => checkLedger([old], ['old']));
  assert.throws(() => checkLedger([old], [MIGRATION]));
});
test('failed or already-applied KYC blocks retry', () => {
  assert.throws(() => checkLedger([old, { migration_name: MIGRATION, finished_at: null, rolled_back_at: null }], ['old', MIGRATION]));
  assert.throws(() => checkLedger([old, { ...old, migration_name: MIGRATION }], ['old', MIGRATION]));
});
test('redacts password, encoded password and connection URL', () => {
  const pass = 'synthetic:p@ss'; const url = 'postgresql://user:synthetic%3Ap%40ss@db/test';
  const clean = redact([pass, encodeURIComponent(pass), url, 'postgres://other:private@db/test'].join(' '), pass, url);
  assert.doesNotMatch(clean, /synthetic|private|postgres/);
});
