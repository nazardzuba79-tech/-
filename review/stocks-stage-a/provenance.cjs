'use strict';
// Separate production-base overlay contract. Does NOT relax the original f97 source guard.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const BASE='89c3ac003b44a6a0e7630d2ecbe5d7164e85b683';
const APP='3894caea32048a6f5cdbfd046900d0b41743d699';
const OVERLAY='d71821c7fdb6df7f097b247269166aca1c4554f7';
const TREE='df214f1eaa0220910c07d28b3f5130c966772520';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>cp.execFileSync('git',['-C',root,...args],{maxBuffer:32*1024*1024});
const text=(root,...args)=>git(root,...args).toString().trim();
function verify(root){
  assert.equal(text(root,'rev-parse',OVERLAY+'^'),BASE);
  assert.equal(text(root,'rev-parse',OVERLAY+'^{tree}'),TREE);
  const changed=text(root,'diff','--name-only',BASE,OVERLAY).split('\n');
  const hooks=['src/index.ts','src/api/middleware/auth.ts','src/api/middleware/stocksAuthorityIngress.ts','src/api/routes/stocksTestCash.ts'];
  const extra=['services/stocks-simulator/engine.mjs','scripts/qa/stocks-runtime-closure.cjs','scripts/qa/stocks-release-package.cjs','scripts/qa/stocks-migration-review.cjs','prisma/migrations/20261016000000_stocks_test_cash_authority/migration.sql','prisma/migrations/20261016170000_native_funding_model/migration.sql'];
  for(const f of changed){
    assert.ok(hooks.includes(f)||extra.includes(f)||f.startsWith('services/stocks-global/'),'UNRELATED_OVERLAY_CHANGE '+f);
    if(!['src/index.ts','src/api/middleware/auth.ts'].includes(f))assert.ok(git(root,'show',OVERLAY+':'+f).equals(git(root,'show',APP+':'+f)),'APP_SOURCE_MISMATCH '+f);
  }
  assert.deepEqual(changed.filter(f=>f.startsWith('src/')).sort(),hooks.sort());
  const preserved=['scripts/start-render-single-service.cjs','src/marketDataCollector.ts','src/buildCommit.ts','prisma/schema.prisma','package.json','package-lock.json','tsconfig.json'];
  for(const f of preserved)assert.ok(git(root,'show',BASE+':'+f).equals(git(root,'show',OVERLAY+':'+f)),'PRODUCTION_BASE_CHANGED '+f);
  const bootstrap=fs.readFileSync(path.join(__dirname,'runtime-bootstrap.cjs'));
  assert.equal(sha(bootstrap),'1a76646d2a0987b9560cb70d2cabe870656b9eab1d7e698d764b2a9aee631866');
  return{base:BASE,stocksSource:APP,overlay:OVERLAY,tree:TREE,changed:changed.length,onlySourceHooks:hooks,preserved,bootstrapSha256:sha(bootstrap),originalSourceGuardUnchanged:true};
}
module.exports={BASE,APP,OVERLAY,TREE,sha,git,text,verify};
if(require.main===module)console.log(JSON.stringify(verify(process.argv[2]||process.cwd()),null,2));
