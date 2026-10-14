// QA-only recorder for a disposable, hash-guarded shadow. Never a production import.
import { AsyncLocalStorage } from 'node:async_hooks';
import { isMainThread, getEnvironmentData, setEnvironmentData } from 'node:worker_threads';
import { types } from 'node:util';

export const E = Object.freeze({ WINDOW_BEGIN:1, WINDOW_END:2, INGRESS:10, RESPONSE_FINISH:11, RESPONSE_CLOSE:12, REQUEST_ABORT:13,
  AUTH_BEGIN:20, AUTH_END:21, AUTH_FAIL:22, FETCH_DISPATCH:30, FETCH_HEADERS:31, BODY_BEGIN:32, BODY_FIRST_CHUNK:33, BODY_END:34, IDENTITY_RESULT:35, IDENTITY_ABORT:36, IDENTITY_DEADLINE:37,
  CONTEXT_BEGIN:40, CONTEXT_END:41, WORKER_ADMIT:50, WORKER_SEND:51, WORKER_RECEIVE:52, WORKER_RESULT:53, WORKER_SETTLE:54, WORKER_COMMAND_END:55, WORKER_CPU_CHECKPOINT:56,
  SQL_READ_BEGIN:60, SQL_READ_END:61, LEDGER_PARSE_BEGIN:62, LEDGER_PARSE_END:63, VALIDATE_BEGIN:64, VALIDATE_END:65, VIEW_BEGIN:66, VIEW_END:67,
  WORKER_CLONE_BEGIN:68, WORKER_CLONE_END:69, STATUS_SYNC_BEGIN:70, STATUS_SYNC_END:71, RESPONSE_JSON_BEGIN:72, RESPONSE_JSON_END:73,
  AUTH_JSON_BEGIN:74, AUTH_JSON_END:75, MAIN_CLONE_BEGIN:76, MAIN_CLONE_END:77, GATEWAY_ENTRY:80, GATEWAY_FINISH:81, GATEWAY_CLOSE:82 });
export const COLUMNS = Object.freeze(['seq','thread','request','workerCommand','span','event','monoNs','cpuUserUs','cpuSystemUs']);
export const CAPACITY = Object.freeze({ main:8192, worker:4096 });
export const ENVIRONMENT_KEY='voltex.stocks.auth-burst-trace-512.v1';
const COMMANDS=4096, HEADER=512, MAP_BYTES=COMMANDS*2*4, ROW_BYTES=(CAPACITY.main+CAPACITY.worker)*COLUMNS.length*8;
export const BUFFER_BYTES=HEADER+MAP_BYTES+ROW_BYTES;
const F=Object.freeze({ OVERFLOW:1, INVALID:2, DUPLICATE:4, CROSS_REQUEST:8, OPEN_SPANS:16, MISSING_REQUEST:32, WORKER_ACTIVE:64, UNEXPECTED_COMMAND:128 });
const EVENT_SET=new Set(Object.values(E));
const SYNC_BEGIN=new Set([60,62,64,66,68,70,72,74,76]);
const expectedIds=Array.from({length:50},(_,i)=>'trace_'+String(i+1).padStart(2,'0'));
export const allocateTraceBuffer=()=>new SharedArrayBuffer(BUFFER_BYTES);

export function createRecorder({ buffer=allocateTraceBuffer(), role=0, clock=process.hrtime.bigint, cpu=process.threadCpuUsage?.bind(process) }={}) {
  if (!(buffer instanceof SharedArrayBuffer)||buffer.byteLength!==BUFFER_BYTES||![0,1].includes(role)) throw Error('TRACE_BUFFER_INVALID');
  const control=new Int32Array(buffer,0,32),windows=new BigInt64Array(buffer,128,16),mapping=new Int32Array(buffer,HEADER,COMMANDS*2),rows=new BigInt64Array(buffer,HEADER+MAP_BYTES,ROW_BYTES/8);
  const als=new AsyncLocalStorage(),seen=new Set(),terminals=new Set(),gateway=new Set(),spans=new Map();
  let spanSerial=0,writerNs=0n,writerCalls=0,workerContext=null,generation=0,workerPrepared=false;
  const active=()=>Atomics.load(control,0)===1;
  const flag=bit=>{Atomics.or(control,4,bit);};
  const context=()=>role===1?workerContext:als.getStore();
  const cpuNow=()=>{try{return cpu?cpu():null;}catch{return null;}};
  const sample=()=>({ns:clock(),cpu:cpuNow()});
  function write(event,request=0,command=0,span=0,measurement) {
    if(!active())return;
    if(!EVENT_SET.has(event)||!Number.isSafeInteger(request)||request<0||request>50||!Number.isSafeInteger(command)||command<0||command>0x7fffffff||!Number.isSafeInteger(span)||span<0){flag(F.INVALID);return;}
    const start=clock(),counter=2+role,count=Atomics.load(control,counter),cap=role?CAPACITY.worker:CAPACITY.main;
    if(count>=cap){flag(F.OVERFLOW);return;}
    const base=((role?CAPACITY.main:0)+count)*COLUMNS.length;
    const values=[BigInt(count+1),BigInt(role),BigInt(request),BigInt(command),BigInt(span),BigInt(event),measurement?.ns??start,measurement?.cpu?BigInt(measurement.cpu.user):-1n,measurement?.cpu?BigInt(measurement.cpu.system):-1n];
    for(let i=0;i<values.length;i++)rows[base+i]=values[i];
    Atomics.store(control,counter,count+1);writerNs+=clock()-start;writerCalls++;windows[12+role]=writerNs;Atomics.store(control,7+role,writerCalls);
  }
  function record(event,request,command,span=0) {
    const ctx=context(),id=request??ctx?.request??0;
    if(active()&&event===E.GATEWAY_ENTRY){if(!id)flag(F.INVALID);if(gateway.has(id))flag(F.DUPLICATE);gateway.add(id);}
    write(event,id,command??ctx?.command??0,span);
  }
  function bindRecord(event) {
    const ctx=context(),request=ctx?.request??0,command=ctx?.command??0;
    if(active()&&!request)flag(F.CROSS_REQUEST);
    return()=>record(event,request,command);
  }
  const requestNumber=value=>{const n=typeof value==='string'&&/^trace_(0[1-9]|[1-4][0-9]|50)$/.test(value)?Number(value.slice(-2)):0;if(!n&&active())flag(F.INVALID);return n;};
  function beginWall(event) {
    if(!active())return null;
    const ctx=context();if(!ctx?.request){flag(F.CROSS_REQUEST);return null;}
    if(spans.size>=2048){flag(F.OVERFLOW);return null;}
    const mark={request:ctx.request,command:ctx.command||0,span:++spanSerial,event};spans.set(mark.span,mark);write(event,mark.request,mark.command,mark.span);return mark;
  }
  function endWall(mark,event) {
    if(!mark||!active())return;
    const ctx=context();if(spans.get(mark.span)!==mark){flag(F.DUPLICATE);return;}if(ctx?.request!==mark.request)flag(F.CROSS_REQUEST);
    spans.delete(mark.span);write(event,mark.request,mark.command,mark.span);
  }
  function sync(begin,end,fn) {
    if(!active())return fn();
    if(!SYNC_BEGIN.has(begin)||end!==begin+1){flag(F.INVALID);return fn();}
    const ctx=context();if(!ctx?.request){flag(F.CROSS_REQUEST);return fn();}
    const span=++spanSerial,request=ctx.request,command=ctx.command||0;
    write(begin,request,command,span,sample());
    try{const value=fn();if(types.isPromise(value))flag(F.INVALID);return value;}finally{write(end,request,command,span,sample());}
  }
  function http(req,res,fn) {
    if(!active())return fn(req,res);
    const request=requestNumber(req.headers['x-stocks-view']);
    if(!request||req.method!=='GET'||req.url!=='/__stocks_global/state'){flag(F.INVALID);return fn(req,res);}
    if(seen.has(request))flag(F.DUPLICATE);seen.add(request);Atomics.store(control,5,seen.size);
    return als.run({request,command:0},()=>{
      record(E.INGRESS);let done=false;
      const cleanup=()=>{res.off('finish',finish);res.off('close',close);req.off('aborted',abort);};
      const terminal=event=>{if(done){flag(F.DUPLICATE);return;}done=true;terminals.add(request);record(event,request,0);cleanup();};
      const finish=()=>terminal(E.RESPONSE_FINISH),close=()=>terminal(E.RESPONSE_CLOSE),abort=()=>record(E.REQUEST_ABORT,request,0);
      res.once('finish',finish);res.once('close',close);req.once('aborted',abort);
      return fn(req,res);
    });
  }
  function bind(command,type) {
    if(!active())return;
    const ctx=context();if(!ctx?.request||!Number.isSafeInteger(command)||command<1||command>0x7fffffff){flag(F.CROSS_REQUEST);return;}
    if(type!=='readView')flag(F.UNEXPECTED_COMMAND);
    const at=(command%COMMANDS)*2;if(Atomics.load(mapping,at)!==0){flag(F.DUPLICATE);return;}
    Atomics.store(mapping,at+1,ctx.request);Atomics.store(mapping,at,command);record(E.WORKER_ADMIT,ctx.request,command);
  }
  function mapped(command) {
    if(!Number.isSafeInteger(command)||command<1||command>0x7fffffff){flag(F.INVALID);return 0;}
    const at=(command%COMMANDS)*2;if(Atomics.load(mapping,at)!==command){flag(F.CROSS_REQUEST);return 0;}return Atomics.load(mapping,at+1);
  }
  function mainPost(worker,message) {
    if(!active()||!message.requestId)return worker.postMessage(message);
    const request=mapped(message.requestId);return als.run({request,command:message.requestId},()=>{record(E.WORKER_SEND);return sync(E.MAIN_CLONE_BEGIN,E.MAIN_CLONE_END,()=>worker.postMessage(message));});
  }
  const workerResult=command=>{if(active())record(E.WORKER_RESULT,mapped(command),command);};
  const workerSettle=command=>{if(active())record(E.WORKER_SETTLE,mapped(command),command);};
  function workerEnter(command,type) {
    if(!active())return;
    if(role!==1||workerContext){flag(F.WORKER_ACTIVE);return;}
    if(type!=='readView')flag(F.UNEXPECTED_COMMAND);
    const request=mapped(command);workerContext={request,command};Atomics.store(control,6,1);
    if(windows[6]===0n){const point=sample();windows[6]=point.ns;windows[7]=BigInt(point.cpu?.user??-1);windows[8]=BigInt(point.cpu?.system??-1);write(E.WINDOW_BEGIN,0,0,0,point);}
    record(E.WORKER_RECEIVE);
  }
  function workerExit() {
    if(!active()||!workerContext)return;
    record(E.WORKER_COMMAND_END);const point=sample();windows[9]=point.ns;windows[10]=BigInt(point.cpu?.user??-1);windows[11]=BigInt(point.cpu?.system??-1);
    write(E.WORKER_CPU_CHECKPOINT,0,0,0,point);
    workerContext=null;Atomics.store(control,6,0);
  }
  const workerPost=(port,message)=>active()&&workerContext?sync(E.WORKER_CLONE_BEGIN,E.WORKER_CLONE_END,()=>port.postMessage(message)):port.postMessage(message);
  function withWorkerTrace(create) {
    if(role!==0||active()||workerPrepared||typeof create!=='function')throw Error('TRACE_WORKER_SETUP_INVALID');
    if(getEnvironmentData(ENVIRONMENT_KEY)!==undefined)throw Error('TRACE_WORKER_ENVIRONMENT_COLLISION');
    workerPrepared=true;setEnvironmentData(ENVIRONMENT_KEY,buffer);
    try{return create();}finally{setEnvironmentData(ENVIRONMENT_KEY,undefined);}
  }
  function startWindow({requestIds}={}) {
    if(role!==0||active()||generation||JSON.stringify(requestIds)!==JSON.stringify(expectedIds))throw Error('TRACE_START_INVALID');
    new Uint8Array(buffer).fill(0);seen.clear();terminals.clear();gateway.clear();spans.clear();spanSerial=0;writerNs=0n;writerCalls=0;
    generation=1;Atomics.store(control,1,generation);Atomics.store(control,0,1);
    const point=sample();windows[0]=point.ns;windows[1]=BigInt(point.cpu?.user??-1);windows[2]=BigInt(point.cpu?.system??-1);write(E.WINDOW_BEGIN,0,0,0,point);
    return{active:true,generation,expectedRequests:50,capacity:CAPACITY};
  }
  function snapshot() {
    const bits=Atomics.load(control,4);return{active:active(),generation:Atomics.load(control,1),overflow:Boolean(bits&F.OVERFLOW),incomplete:bits!==0,flags:Object.entries(F).filter(([,bit])=>bits&bit).map(([name])=>name),counts:{main:Atomics.load(control,2),worker:Atomics.load(control,3),requests:Atomics.load(control,5)}};
  }
  function stopWindow() {
    if(role!==0||!active())throw Error('TRACE_STOP_INVALID');
    if(seen.size!==50||terminals.size!==50)flag(F.MISSING_REQUEST);if(spans.size)flag(F.OPEN_SPANS);if(Atomics.load(control,6))flag(F.WORKER_ACTIVE);
    const point=sample();windows[3]=point.ns;windows[4]=BigInt(point.cpu?.user??-1);windows[5]=BigInt(point.cpu?.system??-1);write(E.WINDOW_END,0,0,0,point);Atomics.store(control,0,0);
    const result=snapshot(),output=[];
    for(let thread=0;thread<2;thread++)for(let i=0;i<result.counts[thread?'worker':'main'];i++){const at=((thread?CAPACITY.main:0)+i)*COLUMNS.length;output.push(Array.from(rows.subarray(at,at+COLUMNS.length),String));}
    const window=(at,scope)=>{const available=windows[at]>0n&&windows[at+3]>0n&&windows[at+1]>=0n&&windows[at+4]>=0n;return{scope,startMonoNs:String(windows[at]),endMonoNs:String(windows[at+3]),cpuAvailable:available,userUs:available?String(windows[at+4]-windows[at+1]):null,systemUs:available?String(windows[at+5]-windows[at+2]):null};};
    return{...result,columns:COLUMNS,rows:output,windowCpu:{main:window(0,'startWindow to stopWindow; excludes trace serialization'),worker:window(6,'first traced command entry to last traced command finally; excludes time outside execution envelope')},writerMeasurement:{mainCriticalSectionWallNs:String(windows[12]),workerCriticalSectionWallNs:String(windows[13]),mainCalls:Atomics.load(control,7),workerCalls:Atomics.load(control,8),scope:'Partial append bracket wall duration including any descheduling inside the bracket; not CPU or total observer cost. Timestamp and CPU probes outside this bracket and separate clock, allocation and scheduling effects are unmeasured.'},limits:['Async span CPU is never recorded.','Synchronous CPU brackets include begin-record overhead; they are not uninstrumented operation CPU.','Nested synchronous spans must not be added as independent CPU.','Recording overhead changes timing; this is diagnostic evidence, never capacity acceptance.','Whole worker common-window CPU is unavailable; only the execution envelope is measured.','Worker CPU is last WORKER_CPU_CHECKPOINT minus first worker WINDOW_BEGIN. Differences between checkpoints must never be attributed to individual requests.']};
  }
  return{startWindow,stopWindow,snapshot,record,bindRecord,requestNumber,beginWall,endWall,sync,http,workerBind:bind,mainPost,workerResult,workerSettle,workerEnter,workerExit,workerPost,withWorkerTrace};
}
const inheritedBuffer=isMainThread?null:getEnvironmentData(ENVIRONMENT_KEY);
if(!isMainThread&&!(inheritedBuffer instanceof SharedArrayBuffer))throw Error('TRACE_WORKER_BUFFER_MISSING');
const singleton=createRecorder({role:isMainThread?0:1,buffer:isMainThread?allocateTraceBuffer():inheritedBuffer});
export const {startWindow,stopWindow,snapshot,record,bindRecord,requestNumber,beginWall,endWall,sync,http,workerBind,mainPost,workerResult,workerSettle,workerEnter,workerExit,workerPost,withWorkerTrace}=singleton;
