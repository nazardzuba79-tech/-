import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const secret='synthetic-listings-secret-never-production-001';
const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const input=(ticker='QAONE')=>({ticker,name:'QA Orbit',logo,initialPrice:'0.025',listingAt:new Date(Date.now()+86400_000).toISOString(),ownerAllocation:'12000'});
let mf,options,outbound=0,row;
const call=(path='',method='GET',body,revision,key,auth=true)=>mf.dispatchFetch(`https://listings.local${path.startsWith('/market')?path:'/admin/listings'+path}`,{
  method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${secret}`}:{Origin:'https://voltextech.net'}),
    ...(revision?{'If-Match':String(revision)}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
before(async()=>{
  const bundled=await build({entryPoints:[fileURLToPath(new URL('./src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',external:['cloudflare:*']});
  const persist=await mkdtemp(join(tmpdir(),'voltex-managed-listings-'));
  options={...convertV4MiniflareOptions({durableObjectsPersist:persist,workers:[{name:'managed',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-01',
    bindings:{LISTINGS_STORE_TOKEN:secret},durableObjects:{MANAGED_LISTINGS:{className:'ManagedListingsDO',useSQLite:true}},
    outboundService:()=>{outbound++;throw new Error('Unexpected outbound IO');}}]}),isolatedResourcePersistencePath:persist,resourcePersistencePath:persist,telemetry:{enabled:false}};
  mf=new Miniflare(options);
});
after(async()=>{await mf?.dispose();assert.equal(outbound,0);});
test('private storage cannot be called by public browser, roles/URL flags do not grant auth',async()=>{
  for(const path of ['','?role=ADMIN','?draft=true'])assert.equal((await call(path,'GET',undefined,undefined,undefined,false)).status,401);
  assert.deepEqual((await (await call('/market/managed-listings?draft=true','GET',undefined,undefined,undefined,false)).json()).assets,[]);
});
test('validation rejects empty/invalid, reserved ticker, negative/zero price, allocation/date/logo',async()=>{
  for(const patch of [{name:''},{ticker:'VTA'},{ticker:'NRX'},{ticker:'BTC'},{ticker:'A/B'},{initialPrice:'0'},{initialPrice:'-1'},{initialPrice:'NaN'},{ownerAllocation:'-1'},{listingAt:'bad'},{listingAt:'2020-01-01T00:00:00Z'},{logo:'https://x/logo.svg'},{logo:'data:image/png;base64,PHN2Zz4='}]){
    assert.equal((await call('','POST',{...input(),...patch},undefined,crypto.randomUUID())).status,400,JSON.stringify(patch));
  }
  assert.deepEqual(await (await call()).json(),[]);
});
test('Create persists a draft with stable server seed and idempotent request',async()=>{
  const data=input(),key=crypto.randomUUID();
  const first=await call('','POST',data,undefined,key);assert.equal(first.status,201);row=await first.json();
  assert.equal(row.status,'draft');assert.equal(row.revision,1);assert.ok(row.seed);
  assert.deepEqual(await (await call('','POST',data,undefined,key)).json(),row);
  assert.equal((await call('','POST',{...data,name:'Different'},undefined,key)).status,409);
  assert.equal((await call('','POST',data,undefined,crypto.randomUUID())).status,409);
});
test('draft hidden by ticker, id, query and direct public API; private preview has no writes',async()=>{
  for(const path of [`/market/test-assets/${row.ticker}-USDT`,`/market/test-assets/${row.ticker}-USDT/candles?draft=true`,`/market/external/orderbook/${row.ticker}-USDT?preview=1`])assert.equal((await call(path,'GET',undefined,undefined,undefined,false)).status,404);
  const preview=await (await call(`/${row.id}/preview`)).json();assert.equal(preview.listing.seed,row.seed);assert.ok(preview.liveSample.candles.length>0);
  assert.equal(preview.asset.state.phase,'pre-listing');
  assert.deepEqual(await (await call(`/${row.id}`)).json(),row);
});
test('concurrent draft edit CAS: exactly one succeeds, seed identity cannot change',async()=>{
  const data=input();data.listingAt=row.listingAt;data.seed=row.seed;
  const responses=await Promise.all([call(`/${row.id}`,'PUT',{...data,name:'Winner A'},1),call(`/${row.id}`,'PUT',{...data,name:'Winner B'},1)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);row=await (await call(`/${row.id}`)).json();assert.equal(row.revision,2);
  assert.equal((await call(`/${row.id}`,'PUT',{...data,seed:'changed'},2)).status,409);
});
test('Publish is atomic/CAS/idempotent and immutable, public never exposes seed or owner allocation',async()=>{
  const key=crypto.randomUUID(),revision=row.revision;
  const results=await Promise.all([call(`/${row.id}/publish`,'POST',undefined,revision,key),call(`/${row.id}/publish`,'POST',undefined,revision,key)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  const [a,b]=await Promise.all(results.map(r=>r.json()));assert.deepEqual(a,b);row=a;
  assert.equal(row.status,'published');assert.equal(row.revision,3);
  assert.equal((await call(`/${row.id}`,'PUT',input(),3)).status,409);
  const list=await (await call('/market/managed-listings','GET',undefined,undefined,undefined,false)).json();assert.equal(list.assets.length,1);
  for(const key of ['seed','ownerAllocation','createdBy','id'])assert.equal(list.assets[0][key],undefined);
  const future=await (await call(`/market/test-assets/${row.ticker}-USDT?simulationPreviewTime=9999999999999`)).json();assert.equal(future.state.phase,'pre-listing');
});
test('restart preserves exact config/history and cannot regenerate auto seed',async()=>{
  const preview=await (await call(`/${row.id}/preview`)).json();
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call(`/${row.id}`)).json(),row);
  assert.deepEqual((await (await call(`/${row.id}/preview`)).json()).liveSample.candles,preview.liveSample.candles);
});
test('third non-hardcoded pair publishes with no deploy, automatic server-time live, book/tape/candles',async()=>{
  const data=input('THIRDQA');data.listingAt=new Date(Date.now()+2000).toISOString();data.seed='stable-manual-seed';
  const created=await (await call('','POST',data,undefined,crypto.randomUUID())).json();
  assert.equal((await call(`/${created.id}/publish`,'POST',undefined,1,crypto.randomUUID())).status,200);
  assert.equal((await (await call('/market/test-assets/THIRDQA-USDT')).json()).state.phase,'pre-listing');
  await new Promise(resolve=>setTimeout(resolve,12_200));
  const live=await (await call('/market/test-assets/THIRDQA-USDT')).json();assert.equal(live.state.phase,'live');assert.ok(live.state.lastPrice>0);
  assert.ok((await (await call('/market/test-assets/THIRDQA-USDT/candles?interval=5m')).json()).candles.length);
  assert.equal((await call('/market/test-assets/THIRDQA-USDT/candles?interval=1m')).status,400);
  assert.equal((await (await call('/market/external/orderbook/THIRDQA-USDT')).json()).bids.length,25);
  assert.ok((await (await call('/market/external/trades/THIRDQA-USDT')).json()).trades.length);
  const assets=(await (await call('/market/managed-listings')).json()).assets;assert.equal(assets.length,2);
  assert.equal(assets.find(a=>a.symbol==='QAONE').state.phase,'pre-listing');
  assert.equal((await call('/market/test-assets/VTA-USDT')).status,404);assert.equal((await call('/market/test-assets/NRX-USDT')).status,404);
  assert.equal(outbound,0);
});
