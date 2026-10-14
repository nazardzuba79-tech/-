import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getEnvironmentData,setEnvironmentData } from 'node:worker_threads';
import observer from '../auth-http-fixture-512/durability-observer.cjs';
import { E,CAPACITY,COLUMNS,BUFFER_BYTES,ENVIRONMENT_KEY,allocateTraceBuffer,createRecorder } from './recorder.mjs';
import { SOURCE_REVISION,PATHS,transform,derive } from './instrument.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const ids=Array.from({length:50},(_,i)=>'trace_'+String(i+1).padStart(2,'0'));
const sha=b=>createHash('sha256').update(b).digest('hex');
// Deployment archives use Git LF bytes; Windows worktrees may contain mixed EOLs.
const archiveSource=file=>Buffer.from(readFileSync(join(root,file),'utf8').replace(/\r\n/g,'\n'));
function recorder(role=0,buffer=allocateTraceBuffer()) {
  let ticks=0n,usage=0;
  return createRecorder({role,buffer,clock:()=>++ticks,cpu:()=>({user:++usage,system:++usage})});
}
function pair(n) {const req=new EventEmitter(),res=new EventEmitter();req.method='GET';req.url='/__stocks_global/state';req.headers={'x-stocks-view':ids[n-1]};return{req,res};}
function complete(main,n,fn=()=>{}) {const {req,res}=pair(n);return main.http(req,res,()=>{const value=fn();res.emit('finish');return value;});}

test('exact f045 transformations have reversible byte provenance; drift and second instrumentation reject',()=>{
  assert.equal(SOURCE_REVISION,'f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8');
  for(const file of PATHS){const input=archiveSource(file),derived=transform(file,input);assert.equal(derived.proof.originalSha256,sha(input));assert.equal(derived.proof.outputSha256,sha(derived.text));assert.equal(derived.proof.reverseOriginalBytesVerified,true);assert.ok(derived.proof.hunks.length>0);assert.ok(derived.proof.hunks.every(h=>h.count>0&&h.originalFragmentSha256.length===64&&h.replacementSha256.length===64));assert.throws(()=>transform(file,Buffer.concat([input,Buffer.from('\n')])),/TRACE_SOURCE_HASH/);assert.throws(()=>transform(file,derived.text),/TRACE_SOURCE_HASH/);const crlf=Buffer.from(input.toString().replace(/\n/g,'\r\n'));assert.equal(transform(file,crlf).proof.originalSha256,sha(crlf));assert.throws(()=>transform(file,input.toString().replace('\n','\r\n')),/TRACE_SOURCE_FORMAT_INVALID/);}
  assert.throws(()=>transform('services/stocks-global/engine.mjs',''),/TRACE_SOURCE_HASH/);
});

test('derive creates only guarded overlay outside source and parses without executing runtime',()=>{
  const temp=mkdtempSync(join(tmpdir(),'stocks-trace-pure-'));
  try{const source=join(temp,'source');for(const file of PATHS){const p=join(source,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,archiveSource(file));}const out=join(temp,'overlay'),manifest=derive(source,out);assert.equal(manifest.files.length,5);assert.equal(manifest.capacityAcceptance,'NOT_EVALUATED');assert.equal(manifest.financialInvariants.asyncCPUAttributed,false);assert.equal(manifest.recorder.sha256,sha(readFileSync(join(out,manifest.recorder.path))));for(const f of manifest.files)execFileSync(process.execPath,['--check',join(out,f.path)],{stdio:'pipe'});assert.throws(()=>derive(source,out),/TRACE_OUTPUT_MUST_BE_EMPTY/);assert.throws(()=>derive(source,join(source,'trace-shadow-forbidden')),/TRACE_OUTPUT_MUST_BE_OUTSIDE_SOURCE/);}
  finally{rmSync(temp,{recursive:true,force:true});}
});

test('no warmup events, numeric bounded output, explicit one-window lifecycle',()=>{
  const main=recorder();main.record(E.INGRESS,1);assert.equal(main.snapshot().counts.main,0);
  assert.throws(()=>main.startWindow({requestIds:ids.slice(1)}),/TRACE_START_INVALID/);
  assert.equal(main.startWindow({requestIds:ids}).active,true);
  for(let n=1;n<=50;n++)complete(main,n,()=>main.record(E.CONTEXT_END));
  const out=main.stopWindow();assert.equal(out.incomplete,false);assert.equal(out.counts.requests,50);assert.deepEqual(out.columns,COLUMNS);assert.equal(out.rows.every(row=>row.length===9&&row.every(x=>/^-?\d+$/.test(x))),true);assert.ok(BUFFER_BYTES<1024*1024);assert.equal(out.windowCpu.worker.cpuAvailable,false);
  assert.throws(()=>main.startWindow({requestIds:ids}),/TRACE_START_INVALID/);assert.throws(()=>main.stopWindow(),/TRACE_STOP_INVALID/);
});

test('service correlation uses only the original proxy-forwarded view header',()=>{
  const main=recorder();main.startWindow({requestIds:ids});const first=pair(1);first.req.headers['x-fixture-request-id']='trace_50';
  main.http(first.req,first.res,()=>first.res.emit('finish'));for(let n=2;n<=50;n++)complete(main,n);
  const out=main.stopWindow();assert.equal(out.incomplete,false);assert.equal(out.rows.find(row=>Number(row[5])===E.INGRESS)[2],'1');
  const missing=recorder();missing.startWindow({requestIds:ids});const second=pair(1);second.req.headers={'x-fixture-request-id':'trace_01'};
  missing.http(second.req,second.res,()=>second.res.emit('finish'));const failed=missing.stopWindow();assert.ok(failed.flags.includes('INVALID'));assert.equal(failed.counts.requests,0);
});

test('async spans never acquire CPU; sync brackets preserve values and exact thrown object',async()=>{
  const main=recorder();main.startWindow({requestIds:ids});const {req,res}=pair(1),sentinel={private:'not-recorded'},error=new Error('fixture-only');
  await main.http(req,res,async()=>{const mark=main.beginWall(E.AUTH_BEGIN);await Promise.resolve();main.endWall(mark,E.AUTH_END);assert.equal(main.sync(E.AUTH_JSON_BEGIN,E.AUTH_JSON_END,()=>sentinel),sentinel);assert.throws(()=>main.sync(E.RESPONSE_JSON_BEGIN,E.RESPONSE_JSON_END,()=>{throw error;}),e=>e===error);res.emit('finish');});
  for(let n=2;n<=50;n++)complete(main,n);
  const out=main.stopWindow();assert.equal(out.incomplete,false);for(const row of out.rows){const event=Number(row[5]);if([E.AUTH_BEGIN,E.AUTH_END].includes(event))assert.deepEqual(row.slice(7),['-1','-1']);if([E.AUTH_JSON_BEGIN,E.AUTH_JSON_END].includes(event))assert.ok(BigInt(row[7])>0n);}
  assert.equal(JSON.stringify(out).includes('not-recorded'),false);assert.equal(JSON.stringify(out).includes('fixture-only'),false);
});

test('worker command mapping remains numeric without modifying original message or value',()=>{
  const buffer=allocateTraceBuffer(),main=recorder(0,buffer),worker=recorder(1,buffer);main.startWindow({requestIds:ids});
  for(let n=1;n<=50;n++)complete(main,n,()=>{
    const id=100+n,message=Object.freeze({kind:'command',requestId:id,type:'readView',principal:Object.freeze({id:'fixture-secret'})});main.workerBind(id,'readView');
    main.mainPost({postMessage(sent){assert.equal(sent,message);worker.workerEnter(sent.requestId,sent.type);const value={ledger:'private-fixture'};assert.equal(worker.sync(E.VIEW_BEGIN,E.VIEW_END,()=>value),value);const result=Object.freeze({kind:'result',requestId:id,value});worker.workerPost({postMessage(received){assert.equal(received,result);}},result);worker.workerExit();}},message);
    main.workerResult(id);main.workerSettle(id);
  });
  const out=main.stopWindow();assert.equal(out.incomplete,false);assert.equal(out.windowCpu.worker.cpuAvailable,true);assert.equal(out.rows.filter(row=>Number(row[5])===E.WORKER_RECEIVE).length,50);assert.equal(out.rows.filter(row=>Number(row[5])===E.WORKER_ADMIT).every(row=>Number(row[3])===Number(row[2])+100),true);assert.equal(JSON.stringify(out).includes('fixture-secret'),false);assert.equal(JSON.stringify(out).includes('private-fixture'),false);
  const workerBegin=out.rows.find(row=>row[1]==='1'&&Number(row[5])===E.WINDOW_BEGIN),checkpoints=out.rows.filter(row=>Number(row[5])===E.WORKER_CPU_CHECKPOINT),last=checkpoints.at(-1);
  assert.equal(checkpoints.length,50);assert.ok(checkpoints.every(row=>row[1]==='1'&&row[2]==='0'&&row[3]==='0'&&row[4]==='0'));
  assert.equal(out.windowCpu.worker.startMonoNs,workerBegin[6]);assert.equal(out.windowCpu.worker.endMonoNs,last[6]);assert.equal(out.windowCpu.worker.userUs,String(BigInt(last[7])-BigInt(workerBegin[7])));assert.equal(out.windowCpu.worker.systemUs,String(BigInt(last[8])-BigInt(workerBegin[8])));
});

test('derived Worker expression preserves the exact workerData accepted by unchanged observer',()=>{
  const buffer=allocateTraceBuffer(),main=recorder(0,buffer),source=transform('services/stocks-global/account-worker.mjs',archiveSource('services/stocks-global/account-worker.mjs')).text;
  const statement=source.split('\n').find(line=>line.includes('const worker=__bt.withWorkerTrace'));
  assert.ok(statement);let constructions=0,actualData;const sentinel=Object.freeze({fakeWorker:true});
  class FakeWorker {constructor(url,options){constructions++;assert.ok(url instanceof URL);assert.deepEqual(Object.keys(options),['workerData']);assert.equal(getEnvironmentData(ENVIRONMENT_KEY),buffer);actualData=options.workerData;return sentinel;}}
  // Evaluate only the hash-guarded constructor expression with a fake constructor.
  // No production module is imported and no real worker, SQLite or server starts.
  const expression=statement.replace('import.meta.url','importMetaUrl')+'\nreturn worker;';
  const actual=Function('__bt','Worker','URL','importMetaUrl','path','diagnostics','clock','testControl','registrationControl',expression)(main,FakeWorker,URL,'file:///source/services/stocks-global/account-worker.mjs',observer.LEDGER,true,null,undefined,undefined);
  assert.equal(actual,sentinel);assert.equal(constructions,1);assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);
  assert.deepEqual(actualData,{path:observer.LEDGER,diagnostics:true,clock:undefined,testControl:undefined,registrationControl:undefined});
  const invocation={platform:'linux',version:'v24.21.0',arch:'x64',uid:10001,gid:10001,execPath:observer.EXECUTABLE,execArgv:['--require',observer.OBSERVER],argv:[observer.EXECUTABLE],env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',NODE_VERSION:'24.21.0',AUTH_HTTP_FIXTURE_512:'true'},filename:observer.OBSERVER,isMainThread:false,threadId:1,workerData:actualData};
  assert.equal(observer.validateInvocation(invocation),true);assert.equal(observer.validateInvocation({...invocation,argv:[observer.EXECUTABLE,observer.WORKER]},'configuration'),true);
  assert.throws(()=>observer.validateInvocation({...invocation,workerData:{...actualData,burstTrace512Buffer:buffer}}),error=>error.code==='OBSERVER_WORKER_INVALID');
  assert.throws(()=>main.withWorkerTrace(()=>sentinel),/TRACE_WORKER_SETUP_INVALID/);assert.equal(constructions,1);
});

test('startup environment channel is bounded, collision-safe and removed when constructor throws',()=>{
  const main=recorder(),failure=Error('constructor-fixture-failure');
  assert.throws(()=>main.withWorkerTrace(()=>{assert.equal(getEnvironmentData(ENVIRONMENT_KEY).byteLength,BUFFER_BYTES);throw failure;}),error=>error===failure);
  assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);assert.throws(()=>main.withWorkerTrace(()=>{}),/TRACE_WORKER_SETUP_INVALID/);
  const other=recorder(),sentinel=Object.freeze({ownedByOtherFixture:true});setEnvironmentData(ENVIRONMENT_KEY,sentinel);
  try{assert.throws(()=>other.withWorkerTrace(()=>assert.fail('must not call constructor')),/TRACE_WORKER_ENVIRONMENT_COLLISION/);assert.equal(getEnvironmentData(ENVIRONMENT_KEY),sentinel);}finally{setEnvironmentData(ENVIRONMENT_KEY,undefined);}
});

test('loss, duplicates, foreign correlation, outstanding spans and unexpected commands are explicit INCOMPLETE',()=>{
  const main=recorder();main.startWindow({requestIds:ids});let mark;
  complete(main,1,()=>{mark=main.beginWall(E.AUTH_BEGIN);main.workerBind(9,'readView');main.workerBind(9,'readView');});
  complete(main,2,()=>{main.endWall(mark,E.AUTH_END);main.beginWall(E.AUTH_BEGIN);main.workerBind(10,'submit');});
  complete(main,2);main.record(E.GATEWAY_ENTRY,1);main.record(E.GATEWAY_ENTRY,1);main.record(999,1);
  const out=main.stopWindow();for(const name of ['INVALID','DUPLICATE','CROSS_REQUEST','OPEN_SPANS','MISSING_REQUEST','UNEXPECTED_COMMAND'])assert.ok(out.flags.includes(name),name);assert.equal(out.incomplete,true);
});

test('fixed append capacity never overwrites old rows and cannot report capacity success',()=>{
  const main=recorder();main.startWindow({requestIds:ids});for(let n=0;n<CAPACITY.main+3;n++)main.record(E.CONTEXT_BEGIN,1);
  const out=main.stopWindow();assert.equal(out.overflow,true);assert.equal(out.incomplete,true);assert.equal(out.rows.length,CAPACITY.main);assert.equal(out.rows[0][5],String(E.WINDOW_BEGIN));assert.equal(out.rows.at(-1)[0],String(CAPACITY.main));
});

test('abort may omit auth result but listeners detach and failed auth wall span terminates',()=>{
  const main=recorder();main.startWindow({requestIds:ids});const {req,res}=pair(1);
  main.http(req,res,()=>{const mark=main.beginWall(E.AUTH_BEGIN);req.emit('aborted');main.endWall(mark,E.AUTH_FAIL);res.emit('close');});
  for(let n=2;n<=50;n++)complete(main,n);
  const out=main.stopWindow();assert.equal(out.incomplete,false);assert.equal(out.rows.some(row=>Number(row[5])===E.IDENTITY_RESULT),false);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('finish'),0);assert.equal(res.listenerCount('close'),0);
});

test('a Promise passed as synchronous span is flagged, never awaited or relabeled CPU attribution',()=>{
  const main=recorder();main.startWindow({requestIds:ids});const value=Promise.resolve(5);complete(main,1,()=>assert.equal(main.sync(E.VIEW_BEGIN,E.VIEW_END,()=>value),value));
  for(let n=2;n<=50;n++)complete(main,n);assert.ok(main.stopWindow().flags.includes('INVALID'));
});

test('synchronous return inspection never reads a user-defined then getter',()=>{
  const main=recorder();main.startWindow({requestIds:ids});let getterCalls=0;const value=Object.defineProperty({},'then',{get(){getterCalls++;throw Error('not-an-observer-effect');}});
  complete(main,1,()=>assert.equal(main.sync(E.VIEW_BEGIN,E.VIEW_END,()=>value),value));for(let n=2;n<=50;n++)complete(main,n);
  assert.equal(getterCalls,0);assert.equal(main.stopWindow().incomplete,false);
});

test('abort and deadline callbacks retain the registering request outside ALS',()=>{
  const main=recorder();main.startWindow({requestIds:ids});const controllers=[new AbortController(),new AbortController()],emitter=new EventEmitter();let timerCallback;
  complete(main,1,()=>controllers[0].signal.addEventListener('abort',main.bindRecord(E.IDENTITY_ABORT),{once:true}));
  complete(main,2,()=>emitter.once('close',main.bindRecord(E.IDENTITY_ABORT)));
  complete(main,3,()=>{timerCallback=main.bindRecord(E.IDENTITY_DEADLINE);});
  // These callbacks are deliberately invoked after all registering ALS.run calls returned.
  controllers[0].abort();emitter.emit('close');timerCallback();
  // A foreign active request must not steal a previously captured request's event.
  complete(main,4,()=>controllers[1].signal.addEventListener('abort',main.bindRecord(E.IDENTITY_ABORT),{once:true}));
  complete(main,5,()=>controllers[1].abort());for(let n=6;n<=50;n++)complete(main,n);
  const out=main.stopWindow(),events=out.rows.filter(row=>[E.IDENTITY_ABORT,E.IDENTITY_DEADLINE].includes(Number(row[5])));
  assert.equal(out.incomplete,false);assert.deepEqual(events.map(row=>[row[2],row[3],row[5]]),[['1','0',String(E.IDENTITY_ABORT)],['2','0',String(E.IDENTITY_ABORT)],['3','0',String(E.IDENTITY_DEADLINE)],['4','0',String(E.IDENTITY_ABORT)]]);
});
