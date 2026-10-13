import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { instrument,transform,SOURCE_REVISION } from './instrument.mjs';
import { schedule,validateBounds,validateDeviceAncestry } from './run.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const cleanup=base=>{assert.equal(dirname(resolve(base)),resolve(tmpdir()));assert.ok(basename(base).startsWith('stocks-phase512-test-'));rmSync(base,{recursive:true,force:true});};
function archive(){const base=mkdtempSync(join(tmpdir(),'stocks-phase512-test-')),source=join(base,'source');mkdirSync(source);execFileSync('git',['archive','--format=tar','--output='+join(base,'source.tar'),SOURCE_REVISION,'services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});execFileSync('tar',['-xf',join(base,'source.tar'),'-C',source]);return {base,source};}
test('diagnostic transform accepts only all exact06a files, parses, preserves original resources and readers',()=>{
 const {base,source}=archive();try{const out=join(base,'shadow'),manifest=instrument(source,out);assert.equal(manifest.sourceRevision,SOURCE_REVISION);assert.equal(manifest.files.filter(f=>f.anchors.length).length,5);
 for(const item of manifest.files.filter(f=>f.anchors.length))execFileSync(process.execPath,['--check',join(out,item.file)]);
 for(const file of ['services/stocks/realistic-readers.mjs','services/stocks/limits.json','services/stocks/io-proof.mjs','services/stocks-global/engine.mjs','services/stocks-global/account-observations.mjs'])assert.equal(readFileSync(join(source,file),'utf8').replace(/\r\n/g,'\n'),readFileSync(join(out,file),'utf8'));
 assert.throws(()=>instrument(source,out),/MUST_BE_EMPTY/);
 writeFileSync(join(source,'services/stocks-global/engine.mjs'),'changed');assert.throws(()=>instrument(source,join(base,'other')),/UNVERIFIED_SOURCE/);
 }finally{cleanup(base);}
});
test('source anchor drift fails closed; source directory cannot be its own shadow',()=>{assert.throws(()=>transform('services/stocks-global/accounts.mjs','drift'),/ANCHOR_COUNT/);assert.throws(()=>instrument(root,root),/OUTSIDE_SOURCE/);});
test('three pristine/OFF/ON controls are counterbalanced and retain original quota',()=>{const plan=schedule();assert.equal(plan.length,9);for(let repeat=0;repeat<3;repeat++)assert.deepEqual(plan.filter(r=>r.repeat===repeat).map(r=>r.mode).sort(),['off','on','pristine']);for(let position=0;position<3;position++)assert.deepEqual(plan.filter(r=>r.index%3===position).map(r=>r.mode).sort(),['off','on','pristine']);const valid={cpuMax:'5000 100000',memoryMax:'268435456',ioMax:'8:0 rbps=1048576 wbps=131072'};validateBounds(valid);assert.throws(()=>validateBounds({...valid,cpuMax:'10000 100000'}));assert.throws(()=>validateBounds({...valid,ioMax:'8:0 rbps=max wbps=max'}));});
test('mounted partition accepts verified parent ancestry and rejects unrelated disk',()=>{const rows=[['/dev/sda','8:0'],['/dev/sda1','8:1'],['/dev/sdb','8:16']];assert.equal(validateDeviceAncestry('8:1',rows,['/dev/sda1','/dev/sda'],'/dev/sda'),'/dev/sda1');assert.throws(()=>validateDeviceAncestry('8:1',rows,['/dev/sda1','/dev/sda'],'/dev/sdb'),/MISMATCH/);assert.throws(()=>validateDeviceAncestry('9:9',rows,[], '/dev/sda'),/MISMATCH/);});
test('recorder opt-in gate and bounded allowed numeric stages',()=>{
 const recorder=new URL('./recorder.mjs',import.meta.url).href;
 const script=`const p=await import(${JSON.stringify(recorder)});for(let i=0;i<32;i++)p.sync('json',()=>JSON.stringify({private:'not traced'}));p.add('queue.readView',123);console.log(JSON.stringify(p.snapshot()));`;
 const run=env=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,...env}}));
 assert.equal(run({STOCKS_PHASE_512:'1',STOCKS_PHASE_512_FIXTURE:''}).enabled,false);
 const on=run({STOCKS_PHASE_512:'1',STOCKS_PHASE_512_FIXTURE:'isolated-issue505'});assert.equal(on.roles.main.json.calls,32);assert.equal(on.roles.main.json.samples,2);assert.equal(on.roles.main['queue.readView'].wallMs,123);assert.ok(!JSON.stringify(on).includes('not traced'));
});
test('shadow HTTP and worker still return isolated unchanged accounts in OFF and ON',()=>{
 const {base,source}=archive();try{
  const out=join(base,'shadow');instrument(source,out);
  const fixture=pathToFileURL(join(out,'services/stocks/realistic-global-fixture.mjs')).href;
  const results=[];
  for(const on of [false,true]){
   const script=`import assert from 'node:assert/strict';const {startFixture}=await import(${JSON.stringify(fixture)});const app=await startFixture({port:0,controlPort:0,path:${JSON.stringify(join(base,'ledger-'))}+${JSON.stringify(String(on))}+'.sqlite'});try{const views=[];for(const user of [0,1]){const r=await fetch('http://127.0.0.1:'+app.port+'/__stocks_global/state',{headers:{authorization:'Bearer fixture-user-'+user}});assert.equal(r.status,200);views.push(await r.json());}assert.notEqual(views[0].account.id,views[1].account.id);console.log(JSON.stringify({wallets:views.map(v=>v.wallets),orders:views.map(v=>v.orders),metrics:app.metrics()}));}finally{await app.close();}`;
   const scriptPath=join(base,'smoke-'+on+'.mjs');writeFileSync(scriptPath,script);
   results.push(JSON.parse(execFileSync(process.execPath,[scriptPath],{encoding:'utf8',timeout:15000,env:{...process.env,STOCKS_PHASE_512:String(Number(on)),STOCKS_PHASE_512_FIXTURE:'isolated-issue505'}})));
  }
  assert.deepEqual(results[0].wallets,results[1].wallets);assert.deepEqual(results[0].orders,results[1].orders);assert.equal(results[0].metrics.phase512.enabled,false);const traced=results[1].metrics.phase512;
  assert.equal(traced.roles.main['queue.readView'].calls,2);assert.equal(traced.roles.worker['execute.readView'].calls,2);assert.equal(traced.roles.main.postMessage.calls,4,'two ensures and two views cross the real main→worker transport');assert.ok(traced.roles.worker.postMessage.calls>=5,'ready and four replies cross the worker→main transport');assert.equal(results[1].metrics.externalApiCalls,0);assert.equal(results[1].metrics.sqlWriteCalls,2);
 }finally{cleanup(base);}
});
