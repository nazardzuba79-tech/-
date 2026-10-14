import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrace } from './analyze.mjs';
import { E, COLUMNS } from './recorder.mjs';

// Numeric lifecycle unit fixtures only: no market data, HTTP, database or workload.
function fixture({ deadline = false } = {}) {
  const rows=[], seq=[0,0], ordinary=[], authorityEvents=[]; let clock=10000n, span=0, workerStart, workerEnd;
  const emit=(thread,request,event,{command=0,s=0,cpu=false}={}) => {
    clock+=1000n; const row=[++seq[thread],thread,request,command,s,event,clock,cpu?clock/1000n:-1,cpu?0:-1].map(String); rows.push(row); return row;
  };
  const mainStart=emit(0,0,E.WINDOW_BEGIN,{cpu:true});
  for(let r=1;r<=50;r++) {
    ordinary.push({requestId:'trace_'+String(r).padStart(2,'0'),startedMonoNs:String(clock),endedMonoNs:String(clock+3000000000n),
      elapsedMs:deadline?3000:20,outcome:deadline?'DEADLINE':'HTTP',status:deadline?null:200,reason:deadline?'DEADLINE_3000MS':null});
    emit(0,r,E.GATEWAY_ENTRY); emit(0,r,E.INGRESS);
    const auth=++span;
    emit(0,r,E.AUTH_BEGIN,{s:auth}); const dispatch=emit(0,r,E.FETCH_DISPATCH);
    if(deadline) {
      emit(0,r,E.IDENTITY_ABORT); emit(0,r,E.AUTH_FAIL,{s:auth});
      emit(0,r,E.RESPONSE_CLOSE); emit(0,r,E.GATEWAY_CLOSE); continue;
    }
    const headers=emit(0,r,E.FETCH_HEADERS);
    for(const e of [E.BODY_BEGIN,E.BODY_FIRST_CHUNK,E.BODY_END])emit(0,r,e);
    const authJson=++span;emit(0,r,E.AUTH_JSON_BEGIN,{s:authJson,cpu:true});emit(0,r,E.AUTH_JSON_END,{s:authJson,cpu:true});
    emit(0,r,E.IDENTITY_RESULT);emit(0,r,E.AUTH_END,{s:auth});emit(0,r,E.CONTEXT_BEGIN);emit(0,r,E.CONTEXT_END);
    const startedMonoNs=String(BigInt(dispatch[6])+1n),requestId=ordinary.at(-1).requestId;
    authorityEvents.push({type:'authority-start',requestId,sequence:r,startedMonoNs},
      {type:'authority-terminal',requestId,sequence:r,startedMonoNs,endedMonoNs:String(BigInt(headers[6])-1n),status:200,terminal:'finish'});
    const admissionClone=++span;emit(0,r,E.MAIN_CLONE_BEGIN,{s:admissionClone,cpu:true});emit(0,r,E.MAIN_CLONE_END,{s:admissionClone,cpu:true});
    for(const e of [E.WORKER_ADMIT,E.WORKER_SEND])emit(0,r,e,{command:r});
    const sendClone=++span;emit(0,r,E.MAIN_CLONE_BEGIN,{command:r,s:sendClone,cpu:true});emit(0,r,E.MAIN_CLONE_END,{command:r,s:sendClone,cpu:true});
    workerStart??=emit(1,0,E.WINDOW_BEGIN,{cpu:true}); emit(1,r,E.WORKER_RECEIVE,{command:r});
    for(const e of [E.SQL_READ_BEGIN,E.LEDGER_PARSE_BEGIN,E.VALIDATE_BEGIN,E.VIEW_BEGIN]) {
      const s=++span; emit(1,r,e,{command:r,s,cpu:true}); emit(1,r,e+1,{command:r,s,cpu:true});
    }
    const workerClone=++span;emit(1,r,E.WORKER_CLONE_BEGIN,{command:r,s:workerClone,cpu:true});emit(1,r,E.WORKER_CLONE_END,{command:r,s:workerClone,cpu:true});
    emit(1,r,E.WORKER_COMMAND_END,{command:r}); workerEnd=emit(1,0,E.WORKER_CPU_CHECKPOINT,{cpu:true});
    emit(0,r,E.WORKER_RESULT,{command:r}); emit(0,r,E.WORKER_SETTLE,{command:r});
    const status=++span;emit(0,r,E.STATUS_SYNC_BEGIN,{s:status,cpu:true});emit(0,r,E.STATUS_SYNC_END,{s:status,cpu:true});
    const json=++span; emit(0,r,E.RESPONSE_JSON_BEGIN,{s:json,cpu:true}); emit(0,r,E.RESPONSE_JSON_END,{s:json,cpu:true});
    emit(0,r,E.RESPONSE_FINISH); emit(0,r,E.GATEWAY_FINISH);
  }
  const mainEnd=emit(0,0,E.WINDOW_END,{cpu:true});
  const window=(a,b)=>({scope:'unit synchronous envelope',cpuAvailable:!!a&&!!b,userUs:a&&b?String(BigInt(b[7])-BigInt(a[7])):null,
    systemUs:a&&b?'0':null,startMonoNs:a?.[6]??'0',endMonoNs:b?.[6]??'0'});
  return {trace:{columns:COLUMNS,rows,counts:{main:seq[0],worker:seq[1]},active:false,incomplete:false,overflow:false,flags:[],
    windowCpu:{main:window(mainStart,mainEnd),worker:window(workerStart,workerEnd)},writerMeasurement:{mainCriticalSectionWallNs:'100',scope:'partial wall only'}},
    ordinary,authorityEvents,cgroupWindow:{startMonoNs:'1',endMonoNs:String(clock+1000n)}};
}
test('complete numeric trace stays diagnostic and keeps latency/CPU scopes separate',()=>{
  const result=analyzeTrace(fixture()); assert.equal(result.captureStatus,'COMPLETE'); assert.equal(result.ordinaryStatus,'PASS');
  assert.equal(result.capacityAcceptance,false); assert.equal(result.releaseGatePass,false); assert.equal(result.requests.length,50);
  assert.equal(result.latencyMs.p95,20); assert.equal(result.cpu.worker.commonWindow,false); assert.ok(result.cpu.worker.unattributedUs>0);
  assert.equal(result.spans.filter(x=>x.scope==='wall only').every(x=>x.cpuUs===null),true);
});
test('cancelled before enqueue is legitimate; observed deadlines remain FAIL',()=>{
  const result=analyzeTrace(fixture({deadline:true})); assert.equal(result.captureStatus,'COMPLETE'); assert.equal(result.ordinaryStatus,'FAIL');
  assert.equal(result.latencyMs.p95,3000); assert.equal(result.spans.some(x=>x.name==='SQL_READ'),false);
});
test('lost event and cross-request command cannot produce complete evidence',()=>{
  const f=fixture();f.trace.rows.splice(4,1);assert.equal(analyzeTrace(f).captureStatus,'INCOMPLETE');
  const g=fixture();const row=g.trace.rows.find(r=>Number(r[5])===E.WORKER_RECEIVE);row[2]='2';
  assert.equal(analyzeTrace(g).captureStatus,'INCOMPLETE');
});
test('thread CPU around async and incomplete spans fail closed',()=>{
  const f=fixture();f.trace.rows.find(r=>Number(r[5])===E.AUTH_BEGIN)[7]='1';
  assert.equal(analyzeTrace(f).captureStatus,'INCOMPLETE');
  const g=fixture();g.trace.rows.find(r=>Number(r[5])===E.AUTH_END)[4]='0';
  assert.ok(analyzeTrace(g).issues.includes('UNPAIRED_SPAN'));
});
test('authority terminal after client close is retained with safe fields only',()=>{
  const f=fixture({deadline:true});const r=f.ordinary[0];f.authorityEvents=[{requestId:r.requestId,type:'authority-start',sequence:1,startedMonoNs:r.startedMonoNs},
    {requestId:r.requestId,type:'authority-terminal',sequence:1,startedMonoNs:r.startedMonoNs,endedMonoNs:String(BigInt(r.endedMonoNs)+1000n),status:200,terminal:'finish',authorization:'must-not-appear'}];
  const result=analyzeTrace(f);assert.equal(result.captureStatus,'COMPLETE');
  assert.equal(result.requests[0].authorityEvents[1].endedMonoNs,String(BigInt(r.endedMonoNs)+1000n));
  assert.equal(JSON.stringify(result).includes('must-not-appear'),false);
});
test('missing CPU proof, corrupt window and missing authority events cannot be COMPLETE',()=>{
  const f=fixture();f.trace.windowCpu.main.cpuAvailable=false;assert.equal(analyzeTrace(f).captureStatus,'INCOMPLETE');
  const g=fixture();g.trace.windowCpu.worker.userUs='9999';assert.ok(analyzeTrace(g).issues.includes('THREAD_CPU_WITNESS_MISMATCH'));
  const h=fixture();h.authorityEvents=[];assert.ok(analyzeTrace(h).issues.includes('MISSING_OR_DUPLICATE_AUTHORITY_BOUNDARY'));
  const i=fixture();i.cgroupWindow.startMonoNs=i.trace.windowCpu.main.endMonoNs;assert.equal(analyzeTrace(i).captureStatus,'INCOMPLETE');
});
test('recorder loss and missing successful phase retain INCOMPLETE',()=>{
  const f=fixture();f.trace.flags=['OVERFLOW'];assert.equal(analyzeTrace(f).captureStatus,'INCOMPLETE');
  const g=fixture();g.trace.rows.find(r=>Number(r[5])===E.FETCH_HEADERS)[5]=String(E.BODY_FIRST_CHUNK);
  assert.ok(analyzeTrace(g).issues.includes('SUCCESS_MISSING_PHASE_FETCH_HEADERS'));
});
test('every emitted successful body, JSON, status and clone phase is mandatory',()=>{
  const cases=[
    [E.BODY_BEGIN], [E.BODY_FIRST_CHUNK], [E.BODY_END],
    [E.AUTH_JSON_BEGIN,E.AUTH_JSON_END], [E.STATUS_SYNC_BEGIN,E.STATUS_SYNC_END],
    [E.WORKER_CLONE_BEGIN,E.WORKER_CLONE_END], [E.WORKER_COMMAND_END],
    [E.MAIN_CLONE_BEGIN,E.MAIN_CLONE_END],
  ];
  for(const removed of cases) {
    const f=fixture();
    f.trace.rows=f.trace.rows.filter(row=>!(row[2]==='1' && removed.includes(Number(row[5]))));
    const seq=[0,0];for(const row of f.trace.rows)row[0]=String(++seq[Number(row[1])]);
    f.trace.counts={main:seq[0],worker:seq[1]};
    const result=analyzeTrace(f);assert.equal(result.captureStatus,'INCOMPLETE');
    for(const code of removed) {
      const name=Object.entries(E).find(([,value])=>value===code)[0];
      assert.ok(result.issues.includes('SUCCESS_MISSING_PHASE_'+name),name+' cannot silently disappear');
    }
    assert.equal(result.issues.includes('NON_MONOTONIC_SEQUENCE'),false);
  }
});
test('CPU components must be monotonic even when their combined delta is positive',()=>{
  for(const component of [7,8]) {
    const f=fixture();
    const a=f.trace.rows.find(row=>Number(row[5])===E.AUTH_JSON_BEGIN);
    const b=f.trace.rows.find(row=>Number(row[5])===E.AUTH_JSON_END);
    a[7]='100';a[8]='10';b[7]='110';b[8]='20';b[component]=String(BigInt(a[component])-1n);
    assert.ok(BigInt(b[7])+BigInt(b[8])>BigInt(a[7])+BigInt(a[8]));
    const result=analyzeTrace(f);assert.equal(result.captureStatus,'INCOMPLETE');
    assert.ok(result.issues.includes('NON_MONOTONIC_THREAD_CPU'));
  }
});
test('negative reported CPU component is rejected before combined-window accounting',()=>{
  for(const component of ['userUs','systemUs']) {
    const f=fixture(),window=f.trace.windowCpu.main;
    window.userUs='100';window.systemUs='100';window[component]='-1';
    const result=analyzeTrace(f);assert.equal(result.captureStatus,'INCOMPLETE');
    assert.ok(result.issues.includes('NEGATIVE_THREAD_CPU_COMPONENT'));
  }
});
test('writer wall limit includes in-bracket effects and does not claim full observer overhead',()=>{
  const result=analyzeTrace(fixture());
  assert.ok(result.limits.some(value=>value.includes('include any allocation/descheduling within the bracket')));
  assert.ok(result.limits.some(value=>value.includes('not CPU or total observer cost')));
  assert.equal(result.limits.some(value=>value.includes('excludes allocations/scheduling')),false);
});
