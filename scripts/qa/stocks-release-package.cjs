'use strict';
// Offline bytes only. No Prisma invocation, connection, SQL or ledger repair.
const fs = require('node:fs'), path = require('node:path');
const { review, readDirectory, hash } = require('./stocks-migration-review.cjs');
const PENDING = Object.freeze([
  {name:'20261016000000_stocks_test_cash_authority',sha256:'0cfe2bc2e8b0c847a5da87c87db76b0e8ed214e3df4ed29f1b953c22c459a5cb'},
  {name:'20261016170000_native_funding_model',sha256:'3fb628ed357985986033bb7fdb3634fe8888f8a8e78cffa31cfafb84f78ff8d8'},
]);
function verify(directory) {
  const baseline = JSON.parse(fs.readFileSync(path.join(directory,'baseline.json'),'utf8'));
  if (baseline.migrations?.length !== 44) throw Error('VERIFIED_44_FILE_BASELINE_REQUIRED');
  const result = review(baseline.migrations,readDirectory(path.join(directory,'migrations')),PENDING);
  if (result.status !== 'PASS_FILE_REVIEW_ONLY') throw Error('RELEASE_MIGRATION_BYTES_MISMATCH');
  const lock = fs.readFileSync(path.join(directory,'migrations/migration_lock.toml'));
  if (lock.toString() !== 'provider = "postgresql"\n') throw Error('POSTGRES_MIGRATION_LOCK_REQUIRED');
  return {...result, historicalCount:44, pendingCount:2, ledgerCompatibility:'NOT_ATTESTED',
    engineCompatibility:'NOT_ATTESTED', releaseAuthorized:false};
}
function stage({snapshot, baselineFile, pending, output}) {
  // Work must supply an independently verified production-file manifest/snapshot.
  // Git checkout bytes are NOT an acceptable substitute for that attestation.
  const baselineBytes = fs.readFileSync(baselineFile), baseline = JSON.parse(baselineBytes);
  if (baseline.migrations?.length !== 44) throw Error('VERIFIED_44_FILE_BASELINE_REQUIRED');
  const oldRows = readDirectory(snapshot), newRows = readDirectory(pending);
  if (review(baseline.migrations,oldRows,[]).status !== 'PASS_FILE_REVIEW_ONLY' ||
      newRows.length !== 2 ||
      review(baseline.migrations,[...oldRows,...newRows],PENDING).status !== 'PASS_FILE_REVIEW_ONLY') {
    throw Error('RELEASE_MIGRATION_BYTES_MISMATCH');
  }
  // Read and verify every byte before creating output; no normalization, including EOL.
  const files = [...oldRows.map(row=>({...row,root:snapshot})),...newRows.map(row=>({...row,root:pending}))]
    .map(row=>{const bytes=fs.readFileSync(path.join(row.root,row.name,'migration.sql'));
      if(hash(bytes)!==row.sha256)throw Error('MIGRATION_SOURCE_CHANGED');
      return {...row,bytes};});
  fs.mkdirSync(output); // refuses overwrite of any existing artifact
  fs.writeFileSync(path.join(output,'baseline.json'),baselineBytes,{flag:'wx'});
  fs.mkdirSync(path.join(output,'migrations'));
  for (const file of files) {
    const dir = path.join(output,'migrations',file.name);fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'migration.sql'),file.bytes,{flag:'wx'});
  }
  fs.writeFileSync(path.join(output,'migrations/migration_lock.toml'),'provider = "postgresql"\n',{flag:'wx'});
  const result = verify(output);
  fs.writeFileSync(path.join(output,'file-review.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
module.exports = {stage,verify,PENDING};
if (require.main===module) {
  try {
    const args=process.argv.slice(2);
    const result=args.length===2&&args[0]==='--verify'?verify(args[1]):
      args.length===4?stage({snapshot:args[0],baselineFile:args[1],pending:args[2],output:args[3]}):
      (()=>{throw Error('USAGE: snapshot baseline.json pending-dir NEW-output-dir OR --verify package-dir');})();
    console.log(JSON.stringify(result,null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
