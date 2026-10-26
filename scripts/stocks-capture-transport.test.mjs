import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {PILOTS,boundedResponseText,capture} from './stocks-verify-clmm-proof.mjs';

test('pinned source layout retains the exact SHA256 referenced by the proof contract',async()=>{
 const metadataUrl=new URL('../research/solana-xstocks/proof-615-20261026/pool-layout-source.json',import.meta.url);
 const metadata=JSON.parse(await readFile(metadataUrl));
 const raw=await readFile(new URL(metadata.savedFile,metadataUrl));
 assert.equal(createHash('sha256').update(raw).digest('hex'),metadata.sha256);
});

test('standalone pilot pins match both original public issuer/pool packets, without a frontend catalogue',async()=>{
 for(const ticker of ['SPYx','CRCLx']){
  const packet=JSON.parse(await readFile(new URL(`../research/solana-xstocks/proof-615-20261025/${ticker}-final/manifest.json`,import.meta.url)));
  assert.equal(PILOTS[ticker].mint,packet.mint);assert.equal(PILOTS[ticker].pool,packet.pool);
  assert(Object.isFrozen(PILOTS[ticker]));
 }
});
test('bounded response counts UTF8 bytes rather than JS characters',async()=>{
 const r=new Response('€€');assert.deepEqual(await boundedResponseText(r,6),{text:'€€',bytes:6});
});
test('stream without Content-Length is cancelled as soon as it exceeds the byte cap',async()=>{
 let cancelled=false;
 const r=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}}));
 await assert.rejects(boundedResponseText(r,32),/RESPONSE_TOO_LARGE/);assert.equal(cancelled,true);
});
test('oversized declared response is rejected before reading its stream',async()=>{
 let cancelled=false;
 const r=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':'999'}});
 await assert.rejects(boundedResponseText(r,32),/RESPONSE_TOO_LARGE/);assert.equal(cancelled,true);
});
async function probe(fn){
 const out=await mkdtemp(join(tmpdir(),'voltex-public-capture-test-'));
 const end=Math.floor(Date.now()/60000)*60-120;
 try{return await fn({out,from:new Date((end-60)*1000).toISOString(),to:new Date(end*1000).toISOString()});}
 finally{assert.equal(dirname(out),tmpdir());assert(basename(out).startsWith('voltex-public-capture-test-'));await rm(out,{recursive:true,force:true});}
}
test('live acquisition reaches the issuer transport instead of the missing frontend-file dependency',()=>probe(async options=>{
 let calls=0;
 const result=await capture({...options,fetchImpl:async()=>{calls++;throw Error('FIXTURE_TRANSPORT_REACHED');}});
 assert.equal(calls,1);assert.deepEqual(result.blockers,['FIXTURE_TRANSPORT_REACHED']);
 assert.equal(result.metrics.httpRequests,1);assert.equal(result.metrics.rpcAttempts,0);
 assert.equal(result.metrics.automaticRetries,0);assert.equal(result.productionReady,false);
 assert.equal(result.ohlcv,null);
}));
test('real HTTP denial is retained once; no provider or proxy bypass, no retries',()=>probe(async options=>{
 let calls=0;const result=await capture({...options,fetchImpl:async()=>{calls++;return new Response('{"error":"denied"}',{status:403});}});
 assert.equal(calls,1);assert.deepEqual(result.blockers,['HTTP_403']);assert.equal(result.receipts[0].httpStatus,403);
 assert.equal(result.metrics.responseBytes,18);assert.equal(result.metrics.monetarySpend,0);
 assert.equal(result.metrics.rpcCompletions,0);assert.equal(result.intervalComplete,false);
}));
test('wrong issuer mint cannot cause a Solana request',()=>probe(async options=>{
 let calls=0;const result=await capture({...options,fetchImpl:async()=>{calls++;return Response.json({symbol:'SPYx',deployments:[{network:'Solana',address:PILOTS.CRCLx.mint}]});}});
 assert.equal(calls,1);assert.deepEqual(result.blockers,['ISSUER_MINT']);assert.equal(result.rpcRequests,0);
}));
