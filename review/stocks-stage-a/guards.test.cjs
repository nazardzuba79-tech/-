const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {verify,OVERLAY}=require('./provenance.cjs');
test('cold crypto bootstrap never excuses changed balances/orders/history or later Stocks writes',()=>{
 const {verifyInitialisation}=require('./bootstrap-baseline.cjs');
 const before={fingerprint:{CopyPerformanceScenario:{count:0,hash:'empty'},DemoBalance:{count:2,hash:'cash'},Order:{count:1,hash:'history'}}};
 const after=structuredClone(before);after.fingerprint.CopyPerformanceScenario={count:4,hash:'original-source-generated'};after.expectedCopyScenarioIds=true;
 assert.equal(verifyInitialisation(before,after).allOtherTablesIdentical,true);
 for(const table of ['DemoBalance','Order']){const bad=structuredClone(after);bad.fingerprint[table].hash='mutated';assert.throws(()=>verifyInitialisation(before,bad),/unexpected bootstrap table change/);}
 const bad=structuredClone(after);bad.expectedCopyScenarioIds=false;assert.throws(()=>verifyInitialisation(before,bad),/original immutable-source/);
 const source=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8');assert.match(source,/assert\.deepEqual\(report\.after\.fingerprint,before\.fingerprint/);assert.doesNotMatch(source,/require\('\.\/benchmark\.cjs'\)\.run/);
});
test('process census keeps Docker-required PID field and rejects duplicate or missing API/collector',()=>{
 const {count}=require('./process-count.cjs');const ps='PID COMMAND\n1 node /opt/operations/runtime-bootstrap.cjs\n10 /usr/local/bin/node scripts/start-render-single-service.cjs\n20 /usr/local/bin/node dist/marketDataCollector.js\n30 /usr/local/bin/node dist/index.js\n';
 assert.deepEqual(count(ps),{api:1,collector:1});
 assert.throws(()=>count(ps+'40 node dist/index.js\n'),/exactly one API/);
 assert.throws(()=>count(ps.replace('20 /usr/local/bin/node dist/marketDataCollector.js\n','')),/exactly one collector/);
 assert.throws(()=>count('COMMAND\nnode dist/index.js'),/PID/);
});
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
