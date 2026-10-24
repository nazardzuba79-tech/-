const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {verify,OVERLAY}=require('./provenance.cjs');
test('PG readiness requires the actual fixture database over TCP, not init-only socket acceptance',()=>{
 const {ready}=require('./pg-ready.cjs');let args;
 assert.equal(ready(a=>{args=a;return 'accepting connections';},'fixture'),false);
 assert.ok(args.includes('127.0.0.1'));assert.ok(args.includes('SELECT current_database()'));
 assert.equal(ready(()=>{throw Error('temporary init server/no fixture DB');},'fixture'),false);
 assert.equal(ready(()=>'postgres','fixture'),false);
 assert.equal(ready(()=>'voltex_stage','fixture'),true);
});
test('overlay exactly preserves production base outside four reviewed source hooks',()=>{const receipt=verify(path.resolve(__dirname,'../..'));assert.equal(receipt.overlay,OVERLAY);assert.equal(receipt.changed,164);});
test('benchmark rejects observed degradation and refuses low-sample PASS',()=>{const {compare}=require('./benchmark.cjs');const rows=(ms,n=90)=>Array.from({length:n},(_,i)=>({at:i*2000,ms}));assert.equal(compare(rows(100),rows(106)).result,'FAIL');assert.equal(compare(rows(100),rows(100)).result,'PASS');assert.equal(compare(rows(100,20),rows(100,20)).result,'INCONCLUSIVE');});
test('fixture fence survives production bootstrap NODE_OPTIONS replacement and rejects external network',()=>{
 const fence=path.join(__dirname,'net-boundary.cjs');const code=`const assert=require('assert/strict'),dns=require('dns'),net=require('net'),cp=require('child_process');let n=0;dns.lookup('api.bybit.com',e=>{assert.equal(e.code,'ENETUNREACH');n++});const s=net.connect({host:'8.8.8.8',port:443});s.on('error',e=>{assert.equal(e.code,'ENETUNREACH');n++});assert.throws(()=>cp.spawn(process.execPath,['migrate']),/STAGE_A_UNEXPECTED_CHILD/);setTimeout(()=>{assert.equal(n,2);console.log('FENCE_OK')},100);`;
 const r=cp.spawnSync(process.execPath,['--require',fence,'-e',code],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/FENCE_OK/);
 const source=fs.readFileSync(fence,'utf8');assert.ok(source.includes("env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --require '+__filename"));
});
test('Stage A workflow is controlled exact-head free runner with no deployment or secret reads',()=>{const text=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/stocks-stage-a.yml'),'utf8');assert.match(text,/types: \[labeled\]/);assert.match(text,/ubuntu-24\.04/);assert.match(text,/pull_request\.head\.sha/);assert.doesNotMatch(text,/secrets\.|workflow_dispatch|push:|wrangler deploy|docker push|ssh |migrate deploy/);});
