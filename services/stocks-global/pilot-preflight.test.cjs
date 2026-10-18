'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePrincipals, inspectReadOnly } = require('./pilot-preflight.cjs');
const env = { STOCKS_PILOT_READONLY_ACK: 'READ_ONLY', STOCKS_IDENTITY_ISSUER: 'fixture-only',
  STOCKS_TRADE_PRINCIPALS: JSON.stringify([{issuer:'fixture-only',subject:'test-a'}, {issuer:'fixture-only',subject:'test-b'}]) };
function client({ missing = false, blocked = false, noCash = false, noSession = false, pendingMigration = false, pendingFunding = false } = {}) {
  const audit = [];
  const tx = {
    $executeRawUnsafe: async sql => { audit.push(sql); assert.equal(sql, 'SET TRANSACTION READ ONLY'); },
    user: { findMany: async () => { assert.equal(audit.length, 1); return missing ? [{id:'test-a',blockedAt:null}] : [{id:'test-a',blockedAt:blocked?new Date():null},{id:'test-b',blockedAt:null}]; } },
    demoBalance: { findMany: async () => [{userId:'test-a',available:{toString:()=>noCash?'0':'7.25'}},{userId:'test-b',available:{toString:()=> '8.50'}}] },
    session: { findMany: async () => noSession ? [{userId:'test-a'}] : [{userId:'test-a'},{userId:'test-b'}] },
    $queryRawUnsafe: async (sql, migration, funding) => { assert.equal(funding,'20261016170000_native_funding_model'); assert.match(sql,/SELECT migration_name/);assert.equal(migration,'20261016000000_stocks_test_cash_authority');assert.match(sql,/IN \(\$1,\$2\)/);return [{migration_name:migration,finished_at:pendingMigration?null:new Date(),rolled_back_at:null},{migration_name:'20261016170000_native_funding_model',finished_at:pendingFunding?null:new Date(),rolled_back_at:null}]; },
  };
  return { $transaction: async (fn, options) => { assert.equal(options.timeout,3000); return fn(tx); }, audit };
}
test('two immutable account subjects and explicit read-only acknowledgment required', () => {
  assert.deepEqual(validatePrincipals(env),['test-a','test-b']);
  assert.throws(() => validatePrincipals({...env,STOCKS_PILOT_READONLY_ACK:''}),/READ_ONLY_ACK_REQUIRED/);
  assert.throws(() => validatePrincipals({...env,STOCKS_TRADE_PRINCIPALS:'not-json'}),/PREFLIGHT_CONFIGURATION_INVALID/);
  assert.throws(() => validatePrincipals({...env,STOCKS_TRADE_PRINCIPALS:JSON.stringify([{issuer:'fixture-only',subject:'test-a'},{issuer:'fixture-only',subject:'test-a'}])}),/PREFLIGHT_CONFIGURATION_INVALID/);
  assert.throws(() => validatePrincipals({...env,STOCKS_TRADE_PRINCIPALS:JSON.stringify([{issuer:'fixture-only',subject:'test-a'},{issuer:'wrong',subject:'test-b'}])}),/PREFLIGHT_CONFIGURATION_INVALID/);
});
test('all scoped reads are blocked from writes and output contains counts, not IDs or amounts', async () => {
  const db=client(),result=await inspectReadOnly(db,env);
  assert.equal(db.audit[0],'SET TRANSACTION READ ONLY');
  assert.equal(result.status,'DB_PREFLIGHT_PASS_NOT_AUTHORIZATION');
  assert.equal(result.configuredPrincipals,2);
  assert.equal(result.productionAuthorized,false);
  assert.equal(result.liveQuoteRightsVerified,false);
  assert.equal(result.targetCapacityVerified,false);
  assert.equal(result.stocksMigrationApplied,true);
  assert.equal(result.fundingMigrationApplied,true);
  assert.ok(!/test-a|test-b|7.25|8.50|fixture-only/.test(JSON.stringify(result)));
});
for (const [label,override] of Object.entries({missing:{missing:true},blocked:{blocked:true},emptyCash:{noCash:true},missingSession:{noSession:true},migrationPending:{pendingMigration:true},fundingMigrationPending:{pendingFunding:true}})) {
  test('fail closed when '+label,async () => assert.equal((await inspectReadOnly(client(override),env)).status,'BLOCKED'));
}
