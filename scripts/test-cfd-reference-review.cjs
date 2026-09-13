'use strict';
// Test-only local fixtures; no live network, accounts or database.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {observedFetch,failureCode,assertReviewEnvironment,createReviewServer}=require('./cfd-reference-review.cjs');
const lib=require('../dist/services/marketData/cfd/PublicReferenceFeed');
const {publicReferenceDisplay}=require('../dist/services/marketData/cfd/PublicReferenceDisplay');
const {CFD_REFERENCE_CATALOG}=require('../dist/services/marketData/cfd/catalog');
const now=Date.parse('2026-09-13T12:00:00Z'),url='https://api.gold-api.com/price/XAU';
const good=JSON.stringify({symbol:'XAU',price:1.25,updatedAt:new Date(now).toISOString()});
test('review requires explicit opt-in and rejects all exchange/database credentials',()=>{
  assert.throws(()=>assertReviewEnvironment({}));assert.doesNotThrow(()=>assertReviewEnvironment({VOLTEX_CFD_REFERENCE_REVIEW:'true'}));
  for(const name of ['DATABASE_URL','DIRECT_URL','JWT_SECRET','API_KEY_ENCRYPTION_SECRET','TWELVE_DATA_API_KEY','TWELVEDATA_API_KEY'])
    assert.throws(()=>assertReviewEnvironment({VOLTEX_CFD_REFERENCE_REVIEW:'true',[name]:'test-fixture'}));
});
test('instrumented transport preserves exact bytes with one HTTP request',async()=>{
  let calls=0;const trace=observedFetch(lib,async()=>{calls++;return new Response(good);},()=>now);
  assert.equal(await(await trace.fetch(url)).text(),good);assert.equal(calls,1);assert.equal(trace.diagnostics()[0].last.outcome,'parsed');
});
test('unknown destination never reaches transport',async()=>{
  let calls=0;const trace=observedFetch(lib,async()=>{calls++;return new Response(good);},()=>now);
  await assert.rejects(trace.fetch('https://example.invalid'));assert.equal(calls,0);
});
test('future source timestamp stays rejected with safe timing evidence',async()=>{
  const body=good.replace(new Date(now).toISOString(),new Date(now+10000).toISOString());
  const trace=observedFetch(lib,async()=>new Response(body),()=>now);
  await assert.rejects(trace.fetch(url));const d=trace.diagnostics()[0];
  assert.equal(d.last.stage,'parse');assert.equal(d.last.code,'metal_payload');assert.equal(d.last.sourceLeadMs,10000);assert.equal(d.last.httpStatus,200);
});
test('invalid JSON and oversized body are distinguishable and never exposed',async()=>{
  for(const [body,stage,code]of [['not-json','parse','invalid_json'],['x'.repeat(17000),'body','body_limit']]){
    const trace=observedFetch(lib,async()=>new Response(body),()=>now);await assert.rejects(trace.fetch(url));
    const d=trace.diagnostics()[0];assert.equal(d.last.stage,stage);assert.equal(d.last.code,code);assert.ok(!JSON.stringify(d).includes(body));
  }
});
test('network error codes are allowlisted and messages cannot leak',async()=>{
  const trace=observedFetch(lib,async()=>{throw new TypeError('secret_payload',{cause:{code:'ENOTFOUND'}});},()=>now);
  await assert.rejects(trace.fetch(url));assert.equal(trace.diagnostics()[0].last.code,'ENOTFOUND');assert.ok(!JSON.stringify(trace.diagnostics()).includes('secret_payload'));
  assert.equal(failureCode(new Error('unknown_secret'),'transport'),'source_unavailable');
});
test('HTTP 429 retains Retry-After and failure evidence survives successful recovery',async()=>{
  let fail=true;const trace=observedFetch(lib,async()=>fail?new Response('',{status:429,headers:{'retry-after':'600'}}):new Response(good),()=>now);
  const r=await trace.fetch(url);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'600');
  fail=false;await trace.fetch(url);const d=trace.diagnostics()[0];assert.equal(d.attempts,2);assert.equal(d.failures,1);assert.equal(d.lastFailure.code,'http_429');
  d.lastFailure.code='mutated';assert.equal(trace.diagnostics()[0].lastFailure.code,'http_429');
});
test('actual feed plus transport does not admit a malformed gold observation',async()=>{
  const trace=observedFetch(lib,async()=>new Response('{}'),()=>now);
  const feed=new lib.PublicReferenceFeed({enabled:true,fetchFn:trace.fetch,now:()=>now,sleep:async()=>{}});await feed.refreshDue();
  assert.equal(feed.snapshot().length,0);assert.equal(trace.diagnostics().length,7);assert.equal(trace.diagnostics().find(d=>d.id==='gold:XAU').last.code,'metal_identity');
});
test('read-only HTTP server retains catalog, unknown prices and rejects every write',async()=>{
  const feed={snapshot:()=>[],diagnostics:()=>[]},trace={diagnostics:()=>[]};
  const server=createReviewServer({feed,catalog:CFD_REFERENCE_CATALOG,display:publicReferenceDisplay,trace,now:()=>now});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const r=await fetch(origin+'/api/v1/cfd/tickers'),data=await r.json();assert.equal(data.tickers.length,13);
    assert.ok(data.tickers.every(q=>q.price===null&&q.executionAllowed===false&&q.bid===null&&q.ask===null));assert.equal(r.headers.get('cache-control'),'no-store');
    for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(origin+'/api/v1/cfd/positions',{method})).status,405);
    assert.equal((await fetch(origin+'/api/v1/me')).status,404);assert.equal((await(await fetch(origin+'/health')).json()).databaseUsed,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
