'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const workerRequire = createRequire(path.resolve('workers/market-edge/package.json'));
const {Miniflare,convertV4MiniflareOptions} = workerRequire('miniflare');
const [before,after,hold] = process.argv.slice(2);
const root = fs.mkdtempSync(path.join(os.tmpdir(),'listings-recovery-'));
const token = 'isolated-fixture-706-recovery-local-only';
const config = { schemaVersion:1,name:'Fixture alpha',symbol:'OG01',logo:null,initialPrice:'2',
  listingAt:new Date(Date.now()+7*86400000).toISOString().slice(0,10)+'T00:00:00Z',displayTimeZone:'UTC',ownerAllocation:'0',
  seedMode:'manual',seed:'original-browser-706',tradable:false };
const original = {...config,originalRegime:{id:'G01',version:'voltex-original-regimes-v1',disclosure:'SIMULATED_ORIGINAL_MODEL'}};
let worker;
async function open(dir) {
  if (worker) await worker.dispose();
  worker = new Miniflare({...convertV4MiniflareOptions({workers:[{
    name:'recovery-check',modules:true,script:fs.readFileSync(path.join(dir,'worker.js'),'utf8'),
    compatibilityDate:'2026-09-01',bindings:{LISTINGS_STORE_TOKEN:token},
    durableObjects:{LISTINGS:{className:'ManagedListingsDO',useSQLite:true}},
    outboundService(){throw Error('External request from isolated recovery check');},
  }]}),isolatedResourcePersistencePath:root,resourcePersistencePath:root,telemetry:{enabled:false},host:'127.0.0.1',port:0});
  await worker.ready;
}
async function req(route,method='GET',body,rev=0) {
  const res = await worker.dispatchFetch('http://local.invalid/internal/listings'+route,{method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Voltex-Admin-Id':'fixture-706','If-Match':String(rev),'X-Voltex-Listing-Protocol':'aith-prelisting-v1'},
    ...(body ? {body:JSON.stringify(body)} : {})});
  return {status:res.status,body:await res.json()};
}
async function stored() {
  const {serverTime, ...state} = (await req('')).body;
  assert(Number.isFinite(serverTime));
  return state;
}
(async()=>{
  await open(before);
  assert.equal((await req('/fixture-original/draft','PUT',{originalRegimeConfig:original})).status,422);
  assert.deepEqual((await req('')).body.listings,[]);
  const legacy={...config,symbol:'OLD',name:'Fixture older market'};
  const created=await req('/fixture-old/draft','PUT',{config:legacy});
  assert.equal(created.status,200,JSON.stringify(created.body));
  await open(after);
  const saved=await req('/fixture-original/draft','PUT',{originalRegimeConfig:original});
  assert.equal(saved.status,200);assert.equal(saved.body.draft.originalRegime.id,'G01');
  assert.equal((await req('/fixture-original/publish','POST',{draftRevision:1,publishKey:'fixture-original-publish-0001',countdown:'staged'})).status,200);
  const snapshot=await stored();
  await open(hold);
  assert.deepEqual(await stored(),snapshot);
  const mutationCases=[
    ['/fixture-new/draft','PUT',{originalRegimeConfig:original},0],
    ['/fixture-original/draft','PUT',{config},1],
    ['/fixture-original/publish','POST',{draftRevision:1,publishKey:'fixture-original-publish-0002'},0],
    ['/fixture-original/countdown','POST',{action:'start'},0],
    ['/fixture-original/delete','POST',{},0],
  ];
  for(const args of mutationCases){
    const reply=await req(...args);
    assert.equal(reply.status,409);assert.equal(reply.body.error,'original_listing_read_only');
  }
  assert.deepEqual(await stored(),snapshot);
  assert.equal((await req('/fixture-old/draft','PUT',{config:legacy},1)).status,200);
  await open(after);
  const final=(await req('')).body.listings.find(x=>x.id==='fixture-original');
  assert.deepEqual(final,snapshot.listings.find(x=>x.id==='fixture-original'));
  console.log('PASS mixed-version creation rejected by legacy storage; published original survives rollback, write freeze and recovery; legacy edit works');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(worker) await worker.dispose();fs.rmSync(root,{recursive:true,force:true});
});
