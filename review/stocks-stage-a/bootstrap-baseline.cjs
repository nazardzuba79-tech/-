'use strict';
const assert=require('node:assert/strict');
function verifyInitialisation(before,after){
  // The unchanged production API warms its existing two modelled performance
  // ledgers and two derived marketplace sections 20s after startup on EMPTY PG.
  // Record that event explicitly; never exempt these rows from the later Stocks comparison.
  const changed=Object.keys(before.fingerprint).filter(k=>JSON.stringify(before.fingerprint[k])!==JSON.stringify(after.fingerprint[k]));
  assert.deepEqual(changed,['CopyPerformanceScenario'],'unexpected bootstrap table change');
  assert.equal(before.fingerprint.CopyPerformanceScenario.count,0);
  assert.equal(after.fingerprint.CopyPerformanceScenario.count,4);
  assert.equal(after.expectedCopyScenarioIds,true,'only the four original immutable-source row IDs');
  return{changedTables:changed,rowsCreated:4,reason:'unchanged existing API delayed Copy Performance warmup on empty disposable database',allOtherTablesIdentical:true};
}
module.exports={verifyInitialisation};
