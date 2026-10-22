'use strict';
/* VOLTEX generic listing soak: exactly twenty TYVN-shaped synthetic configurations
 * through the real admin API router and isolated Worker Durable Object.
 * NO PRODUCTION: fixture auth, ephemeral SQLite, zero outbound, zero PostgreSQL,
 * no wallet funding, no real pair publication, no HTTP requests outside loopback.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'twenty-listing-qa-only-not-production';
delete process.env.LISTINGS_STORE_URL; delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({transpileOnly:true,project:path.join(__dirname,'../tsconfig.json')});
const express = require('express');
const jwt = require('jsonwebtoken');
const {build} = require('esbuild');
const {Miniflare, convertV4MiniflareOptions} = require('miniflare');
const {adminListingsRouter} = require('../src/api/routes/adminListings');
const {CloudflareListingStore} = require('../src/services/listings/store');
const {ManagedListingRegistry} = require('../src/services/listings/registry');
const {assertSpotListing} = require('../src/services/testMarkets/nrxSpot');
const root = path.resolve(__dirname,'..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'voltex-20-listing-fixture-'));
const output = process.env.QA_OUT || path.join(tmp,'evidence');
let outbound = 0;
const result = {scope:'Synthetic, loopback only — not a live listing or production load test',
  source:process.env.GITHUB_SHA || 'local', total:20, drafts:0, staged:0, timerActions:0,
  denies:0, previews:0, outbound:0, financialCalls:0, failures:[]};
async function run(){
 const js = await build({entryPoints:[path.join(root,'workers/market-edge/src/worker.ts')],bundle:true,
   write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const persist=path.join(tmp,'sqlite');
 const mf=new Miniflare({...convertV4MiniflareOptions({durableObjectsPersist:persist,workers:[{
   name:'market-edge',modules:true,script:js.outputFiles[0].text,compatibilityDate:'2026-09-01',
   bindings:{LISTINGS_STORE_TOKEN:'twenty-listings-qa-fixture-local-bearer-00000000001',
             LISTINGS_PUBLIC_CACHE_MS:'0',LISTINGS_MIN_LEAD_MS:'5000'},
   durableObjects:{LISTINGS:{className:'ManagedListingsDO',useSQLite:true}},
   outboundService:()=>{outbound++;throw Error('OUTBOUND_FORBIDDEN')}
 }]}),isolatedResourcePersistencePath:persist,resourcePersistencePath:persist,
 telemetry:{enabled:false},host:'127.0.0.1',port:0});
 await mf.ready;
 const port=mf.getURL ? new URL(await mf.getURL()).origin : null;
 assert.ok(port&&port.startsWith('http://127.0.0.1:'),'disposable workerd only');
 const userIds={'qa-admin':'ADMIN','qa-user':'USER'};
 const prisma={user:{findUnique:async({where:{id}})=>userIds[id]?{id,role:userIds[id]}:null},
  session:{findUnique:async()=>null,update:async()=>null},
  ...Object.fromEntries(['order','trade','balance','futuresOrder','futuresPosition'].map(k=>[k,{count:async()=>{result.financialCalls++;throw Error('FINANCIAL_ACCESS_FORBIDDEN')}}]))};
 const store=new CloudflareListingStore(port,'twenty-listings-qa-fixture-local-bearer-00000000001');
 const registry=new ManagedListingRegistry(store);
 const app=express();app.use(express.json({limit:'300kb'}));
 app.use('/api/v1',adminListingsRouter(prisma,store,{hasSpotPair:()=>false},registry));
 const server=await new Promise(ok=>{let s=app.listen(0,'127.0.0.1',()=>ok(s))});
 const base='http://127.0.0.1:'+server.address().port;
 const admin=jwt.sign({sub:'qa-admin'},process.env.JWT_SECRET);
 const user=jwt.sign({sub:'qa-user'},process.env.JWT_SECRET);
 const req=async(p,{method='GET',token=admin,body}={})=>{
   const response=await fetch(base+'/api/v1'+p,{method,
     headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},
     ...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,json:await response.json().catch(()=>({}))};
 };
 const catalogue=async()=>{const q=await fetch(port+'/market/listings');assert.equal(q.status,200);
    const j=await q.json();assert.ok(Array.isArray(j.assets));return j.assets};
 const template=JSON.parse(fs.readFileSync(path.join(root,'config/test-markets/tyvn.draft.json')));
 assert.equal(template.seed,'teryvane-20261026-v1');
 assert.equal(template.tradable,false);
 assert.equal(template.simulationProgram?.kind,'scenario-controls-v2');
 const now=Date.now(),records=[];
 try{
  for(let i=1;i<=20;i++){
   const suffix=String(i).padStart(2,'0');
   const symbol='QSL'+suffix,listingAt=new Date(Math.ceil((now+(3+i)*86400000)/1000)*1000).toISOString().replace('.000Z','Z');
   const config={...template,symbol,name:'QA Self Service '+suffix,seed:'qa-20-listings-'+suffix+'-fixed-20261022',
       listingAt,ownerAllocation:'0',tradable:false};
   const created=await req('/admin/listings',{method:'POST',body:{config}});
   assert.equal(created.status,201,JSON.stringify(created.json).slice(0,200));
   const {id,draftRevision}=created.json;
   assert.ok(id&&Number.isInteger(draftRevision));
   result.drafts++;
   if(i===1||i===20){
     const preview=await req('/admin/listings/'+encodeURIComponent(id)+'/preview');
     assert.equal(preview.status,200,JSON.stringify(preview.json).slice(0,250));
     result.previews++;
   }
   const pub=await req('/admin/listings/'+encodeURIComponent(id)+'/publish',
      {method:'POST',body:{draftRevision,publishKey:'qa-twenty-publish-'+suffix+'-20261022',countdown:'staged'}});
   assert.equal(pub.status,200,JSON.stringify(pub.json).slice(0,200));
   assert.equal(pub.json.countdown?.state,'staged');
   result.staged++;records.push({symbol,id});
   assert.equal((await catalogue()).length,0,'no staged market publicly visible');
  }
  const listed=await req('/admin/listings');
  assert.equal(listed.status,200);
  assert.equal(records.filter(r=>listed.json.listings.some(x=>x.id===r.id&&x.countdown?.state==='staged')).length,20);
  const first=records[0],last=records[19];
  for(const item of [first,last]){
    let denial=await req('/admin/listings/'+item.id+'/countdown',{method:'POST',token:user,body:{action:'start'}});
    assert.equal(denial.status,403);result.denies++;
    denial=await req('/admin/listings/'+item.id+'/countdown',{method:'POST',token:null,body:{action:'start'}});
    assert.equal(denial.status,401);result.denies++;
    const start=await req('/admin/listings/'+item.id+'/countdown',{method:'POST',body:{action:'start'}});
    assert.equal(start.status,200);assert.equal(start.json.countdown?.state,'running');result.timerActions++;
    assert.deepEqual((await catalogue()).map(x=>x.pair),[item.symbol+'/USDT']);
    await registry.ensureFresh(3000);
    assert.throws(()=>assertSpotListing(item.symbol+'/USDT'),'still not tradable');
    const stop=await req('/admin/listings/'+item.id+'/countdown',{method:'POST',body:{action:'stop'}});
    assert.equal(stop.status,200);assert.equal(stop.json.countdown?.state,'staged');result.timerActions++;
    assert.equal((await catalogue()).length,0);
  }
  assert.equal(outbound,0);
  assert.equal(result.financialCalls,0);
  result.outbound=outbound;
  console.log('PASS 20/20 saved+staged, 2 previews, 4 auth denials, 4 timer actions; 0 published markets or financial writes');
 }finally{
  await new Promise(resolve=>server.close(resolve));await mf.dispose();
 }
}
run().catch(e=>{result.failures.push(String(e.stack||e).slice(0,900));console.error('FAIL',e);process.exitCode=1})
 .finally(()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
   if(!process.env.QA_KEEP_TMP)fs.rmSync(tmp,{recursive:true,force:true})});
