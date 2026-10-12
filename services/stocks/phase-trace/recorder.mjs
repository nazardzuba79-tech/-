// Disposable fixture diagnostics only. Never imported by the actual Stocks runtime.
import { AsyncLocalStorage } from 'node:async_hooks';
import { isMainThread, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const COLUMNS=Object.freeze(['seq','monoMs','event','http','command','group','a','b','c','d','e','f']);
export const EVENTS=Object.freeze({
 CLIENT_START:1,CLIENT_SOCKET:2,CLIENT_CONNECT:3,CLIENT_HEADERS:4,CLIENT_END:5,CLIENT_DEADLINE:6,
 HTTP_ARRIVAL:10,HTTP_FINISH:11,HTTP_CLOSE:12,HTTP_ABORTED:13,HTTP_HANDLER_END:14,
 AUTH_START:20,AUTH_END:21,CONTEXT_INIT:22,CONTEXT_WAIT:23,CONTEXT_READY:24,
 RESPONSE_BEGIN:25,RESPONSE_END:26,
 ADMISSION:30,ADMISSION_REJECT:31,DISPATCH:32,DISPATCH_MEMBER:33,SETTLE:34,MAIN_RECEIPT:35,
 WORKER_RECEIVE:40,WORKER_START:41,WORKER_END:42,WORKER_POST_BEGIN:43,WORKER_POST_END:44,
 SQL_BEGIN:50,SQL_END:51,LOOP_TICK:60,
});
export const COMMANDS=Object.freeze({ensure:1,read:2,readView:3,interests:4,observe:5,observeFailed:6,observeBackground:7,observeFailedBackground:8,submitObserved:9,submit:10,cancel:11,balances:12,quote:13,quoteFailed:14});
export const STAGES=Object.freeze({configure:1,read:2,exists:3,begin:4,write:5,commit:6,rollback:7});
export const KINDS=Object.freeze({sqlReadCalls:1,sqlWriteCalls:2,sqlExecCalls:3});
export const ERRORS=Object.freeze({ACCOUNT_BUSY:1,ACCOUNT_READ_ABORTED:2,ACCOUNT_UNAVAILABLE:3,ACCOUNT_COMMAND_INVALID:4,ACCOUNT_STORAGE_ERROR:5,ACCOUNT_OUTCOME_UNKNOWN:6,RATE_LIMIT:7,SOURCE_BUSY:8,DEADLINE_3000MS:9,ECONNRESET:10,ECONNREFUSED:11,ETIMEDOUT:12,ABORT_ERR:13,SOURCE_UNAVAILABLE:14,SOURCE_DNS_UNAVAILABLE:15,SOURCE_FORBIDDEN:16,RESPONSE_TOO_LARGE:17,INVALID_CANDLES:18,INVALID_DATA:19,INVALID_PAIR:20,INVALID_RANGE:21,UNSUPPORTED_TIMEFRAME:22,INSTRUMENT_UNVERIFIED:23,MARKET_CLOSED:24,QUOTE_UNAVAILABLE:25,FX_STALE:26,FX_UNAVAILABLE:27,MOEX_UNVERIFIED:28,AUTH_REQUIRED:29,AUTH_UNAVAILABLE:30,ACCOUNT_CAPACITY:31,ACCOUNT_NOT_FOUND:32,ACCOUNT_SELECTOR_FORBIDDEN:33,ACCOUNT_QUEUE_FULL:34,ACCOUNT_QUEUE_TIMEOUT:35,ACCOUNT_WORKER_UNAVAILABLE:36,ACCOUNT_WORKER_TIMEOUT:37,ACCOUNT_CONFIG_INVALID:38,HOST_FORBIDDEN:39,ORIGIN_FORBIDDEN:40,METHOD_NOT_ALLOWED:41,TOKEN_REQUIRED:42,JSON_REQUIRED:43,BODY_TOO_LARGE:44,INVALID_JSON:45,ROUTE_NOT_FOUND:46,LOCAL_SERVICE_ERROR:47,UNRECORDED:255});
export const FIELDS=Object.freeze({
 CLIENT_START:'a route enum; b deadlineMs',CLIENT_SOCKET:'a reusedSocket',CLIENT_CONNECT:'',
 CLIENT_HEADERS:'a status',CLIENT_END:'a error enum; b status; c bytes',CLIENT_DEADLINE:'',
 HTTP_ARRIVAL:'a route enum',HTTP_FINISH:'a status',HTTP_CLOSE:'a writableFinished; b status',
 HTTP_ABORTED:'',HTTP_HANDLER_END:'',AUTH_START:'',AUTH_END:'',
 CONTEXT_INIT:'a numeric context ID',CONTEXT_WAIT:'a context ID; b cached=1/shared-or-new-flight=0',CONTEXT_READY:'a context ID',
 RESPONSE_BEGIN:'a HTTP status',RESPONSE_END:'a HTTP status',
 ADMISSION:'a command enum; b context ID; c pending before admission; d bytes after admission',
 ADMISSION_REJECT:'a command enum; b error enum',
 DISPATCH:'a logical member count; b first command enum; c queue length; d total admitted bytes',
 DISPATCH_MEMBER:'a command enum; b context ID',
 SETTLE:'a command enum; b error enum; c queue bytes before settle',
 MAIN_RECEIPT:'a message kind result=1/ready=2/closed=3/fatal=4',
 WORKER_RECEIVE:'a command enum; b context ID; c registration batch count',
 WORKER_START:'a command enum',WORKER_END:'a thread CPU milliseconds; b error enum',
 WORKER_POST_BEGIN:'',WORKER_POST_END:'',
 SQL_BEGIN:'a SQL stage enum; b SQL method enum',
 SQL_END:'a SQL stage enum; b SQL method enum; c existing wallMs; d existing threadCpuMs; e calls=1',
 LOOP_TICK:'a scheduled monotonic ms; b lateByMs',
});
export const TRACE_VERSION=1,RECORD_BYTES=COLUMNS.length*8,HEADER_BYTES=128;
export const BOUNDS=Object.freeze({main:4*1024*1024,worker:4*1024*1024,client:2*1024*1024});
export const enabled=process.env.STOCKS_PHASE_TRACE==='1';
if(enabled&&process.env.STOCKS_PHASE_TRACE_FIXTURE!=='isolated-issue505')throw Error('TRACE_FIXTURE_CAPABILITY_REQUIRED');
export const mono=()=>Number(process.hrtime.bigint())/1e6;
export const errorCode=value=>value==null?0:(ERRORS[value]??ERRORS.UNRECORDED);
const role=isMainThread?(process.env.STOCKS_PHASE_TRACE_ROLE==='client'?'client':'main'):'worker';
const als=enabled&&role==='main'?new AsyncLocalStorage():null;
let requestSerial=0,contextSerial=0,pendingClients=0,workerContext=null,workerCpu=null,flushed=false,loopTimer;
function makeRegion(bytes){return new SharedArrayBuffer(bytes);}
const shared=enabled?(role==='worker'?workerData?.__phaseTrace:role==='main'?{main:makeRegion(BOUNDS.main),worker:makeRegion(BOUNDS.worker)}:{client:makeRegion(BOUNDS.client)}):null;
if(enabled&&(!shared?.[role]||!(shared[role] instanceof SharedArrayBuffer)))throw Error('TRACE_SHARED_REGION_REQUIRED');
const region=shared?.[role],header=region?new Int32Array(region,0,HEADER_BYTES/4):null;
const records=region?new Float64Array(region,HEADER_BYTES,Math.floor((region.byteLength-HEADER_BYTES)/8)):null;
const capacity=region?Math.floor((region.byteLength-HEADER_BYTES)/RECORD_BYTES):0;
const anchor=enabled?{monoMs:mono(),unixMs:Date.now()}:null;
export function emit(event,http=0,command=0,group=0,a=0,b=0,c=0,d=0,e=0,f=0){
 if(!enabled||flushed)return;
 const at=Atomics.load(header,0);
 if(at>=capacity){Atomics.add(header,1,1);return;}
 const offset=at*COLUMNS.length;
 records[offset]=at+1;records[offset+1]=mono();
 records[offset+2]=Number.isFinite(event)?event:0;records[offset+3]=Number.isFinite(http)?http:0;
 records[offset+4]=Number.isFinite(command)?command:0;records[offset+5]=Number.isFinite(group)?group:0;
 records[offset+6]=Number.isFinite(a)?a:0;records[offset+7]=Number.isFinite(b)?b:0;
 records[offset+8]=Number.isFinite(c)?c:0;records[offset+9]=Number.isFinite(d)?d:0;
 records[offset+10]=Number.isFinite(e)?e:0;records[offset+11]=Number.isFinite(f)?f:0;
 Atomics.store(header,0,at+1);
}
export function current(){return als?.getStore()??workerContext;}
export function event(eventId,a=0,b=0,c=0,d=0,e=0,f=0){if(!enabled)return;const ctx=current();emit(eventId,ctx?.http??0,ctx?.command??0,ctx?.group??0,a,b,c,d,e,f);}
export function workerTransfer(){return enabled?{__phaseTrace:shared}:{};}
export function http(req,res,handler){
 if(!enabled)return handler(req,res);
 const raw=req.headers['x-stocks-phase-request'];
 const httpId=typeof raw==='string'&&/^[1-9]\d{0,14}$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):0;
 return als.run({http:httpId,context:0},async()=>{
  event(EVENTS.HTTP_ARRIVAL,route(req.url));
  res.once('finish',()=>emit(EVENTS.HTTP_FINISH,httpId,0,0,res.statusCode));
  res.once('close',()=>emit(EVENTS.HTTP_CLOSE,httpId,0,0,Number(res.writableFinished),res.statusCode));
  req.once('aborted',()=>emit(EVENTS.HTTP_ABORTED,httpId));
  try{return await handler(req,res);}finally{emit(EVENTS.HTTP_HANDLER_END,httpId);}
 });
}
export function route(url){
 const text=typeof url==='string'?url:(url?.pathname??'')+(url?.search??'');
 if(text.startsWith('/__stocks_global/state'))return 1;
 if(text.startsWith('/__stocks_global/history'))return text.includes('before=')?3:2;
 if(text.startsWith('/__stocks_global/health'))return 4;
 if(text.startsWith('/__stocks_global/catalogue'))return 5;
 if(text.startsWith('/__stocks_global/orders'))return 6;
 if(text.startsWith('/__stocks_global/cancel'))return 7;
 if(text.startsWith('/__stocks_global/balances'))return 8;
 if(text.startsWith('/__stocks_global/refresh'))return 9;
 return 0;
}
export function contextId(existing){if(!enabled)return 0;const id=existing?.__phaseContext??++contextSerial;const ctx=current();if(ctx)ctx.context=id;return id;}
export function admit(entry,pending,bytes){
 if(!enabled)return;const ctx=current();entry.__phaseHttp=ctx?.http??0;entry.__phaseContext=ctx?.context??0;
 emit(EVENTS.ADMISSION,entry.__phaseHttp,entry.requestId,0,COMMANDS[entry.type]??0,entry.__phaseContext,pending,bytes);
}
export function reject(type,code){if(enabled)event(EVENTS.ADMISSION_REJECT,COMMANDS[type]??0,errorCode(code));}
export function dispatch(entries,queueLength,bytes){
 if(!enabled)return;const first=entries[0],group=first.requestId;
 emit(EVENTS.DISPATCH,first.__phaseHttp,group,group,entries.length,COMMANDS[first.type]??0,queueLength,bytes);
 for(const entry of entries){entry.__phaseGroup=group;emit(EVENTS.DISPATCH_MEMBER,entry.__phaseHttp,entry.requestId,group,COMMANDS[entry.type]??0,entry.__phaseContext);}
}
export function message(entry){return enabled?{__phase:{http:entry.__phaseHttp??0,context:entry.__phaseContext??0,command:COMMANDS[entry.type]??0}}:{};}
export function settle(entry,code,bytes){if(enabled)emit(EVENTS.SETTLE,entry.__phaseHttp,entry.requestId,entry.__phaseGroup??0,COMMANDS[entry.type]??0,errorCode(code),bytes);}
export function receipt(message){if(enabled){emit(EVENTS.MAIN_RECEIPT,0,message.requestId??0,message.requestId??0,({result:1,ready:2,closed:3,fatal:4})[message.kind]??0);if(message.kind==='closed')Atomics.store(header,2,1);}}
export function workerStart(message){
 if(!enabled)return;
 workerContext={http:message.__phase?.http??0,context:message.__phase?.context??0,command:message.requestId,group:message.requestId};
 event(EVENTS.WORKER_RECEIVE,message.__phase?.command??0,workerContext.context,message.kind==='ensureBatch'?message.principals.length:1);
 workerCpu=process.threadCpuUsage?.();event(EVENTS.WORKER_START,message.__phase?.command??0);
}
export function post(port,message){
 if(enabled&&message.kind==='result'){
  const cpu=workerCpu?process.threadCpuUsage(workerCpu):null;
  event(EVENTS.WORKER_END,cpu?(cpu.user+cpu.system)/1000:-1,errorCode(message.error));
  event(EVENTS.WORKER_POST_BEGIN);port.postMessage(message);event(EVENTS.WORKER_POST_END);
 }else{if(enabled&&message.kind==='closed')Atomics.store(header,2,1);port.postMessage(message);}
}
export function workerClear(){if(enabled){workerContext=null;workerCpu=null;}}
export function sqlStart(stage,kind){if(enabled)event(EVENTS.SQL_BEGIN,STAGES[stage]??0,KINDS[kind]??0);}
export function sqlEnd(stage,kind,wall,cpu){if(enabled)event(EVENTS.SQL_END,STAGES[stage]??0,KINDS[kind]??0,wall,cpu,1);}
export function clientStart(url,timeoutMs){
 // The same numeric correlation header is added in OFF and ON diagnostic shadows.
 const id=++requestSerial;if(enabled){pendingClients++;emit(EVENTS.CLIENT_START,id,0,0,route(url),timeoutMs);}return id;
}
export function clientSocket(id,req,socket){if(!enabled)return;emit(EVENTS.CLIENT_SOCKET,id,0,0,Number(req.reusedSocket));if(socket.connecting)socket.once('connect',()=>emit(EVENTS.CLIENT_CONNECT,id));}
export function clientHeaders(id,status){if(enabled)emit(EVENTS.CLIENT_HEADERS,id,0,0,status);}
export function clientEnd(id,error,value,httpError){if(enabled){pendingClients--;emit(EVENTS.CLIENT_END,id,0,0,errorCode(error?.code??(error?'UNRECORDED':httpError)),value?.status??0,value?.bytes??0);}}
export function clientDeadline(id){if(enabled)emit(EVENTS.CLIENT_DEADLINE,id);}
export function flush(){
 if(!enabled||!isMainThread||flushed)return;flushed=true;
 if(loopTimer)clearInterval(loopTimer);
 const dir=process.env.STOCKS_PHASE_TRACE_DIR;if(!dir)throw Error('TRACE_OUTPUT_DIR_REQUIRED');
 mkdirSync(dir,{recursive:true});
 for(const [name,buffer] of Object.entries(shared)){
  const state=new Int32Array(buffer,0,HEADER_BYTES/4),cap=Math.floor((buffer.byteLength-HEADER_BYTES)/RECORD_BYTES),count=Atomics.load(state,0),dropped=Atomics.load(state,1);
  writeFileSync(resolve(dir,name+'.bin'),Buffer.from(buffer,HEADER_BYTES,count*RECORD_BYTES));
  const writerStopped=name==='client'?pendingClients===0:Atomics.load(state,2)===1;
  writeFileSync(resolve(dir,name+'.meta.json'),JSON.stringify({version:TRACE_VERSION,role:name,columns:COLUMNS,recordBytes:RECORD_BYTES,byteOrder:'LE',count,dropped,capacity:cap,allocatedBytes:buffer.byteLength,clock:'Number(process.hrtime.bigint())/1e6',anchor,threadCpuAvailable:typeof process.threadCpuUsage==='function',sqlThreadCpuAvailable:typeof process.threadCpuUsage==='function',cpuUnavailableSentinel:-1,events:EVENTS,fields:FIELDS,commands:COMMANDS,stages:STAGES,kinds:KINDS,errors:ERRORS,writerStopped,complete:dropped===0&&writerStopped}));
 }
}
if(enabled&&isMainThread){
 process.once('exit',flush);
 if(role==='main'){
  const period=50;let due=mono()+period;
  loopTimer=setInterval(()=>{const actual=mono();emit(EVENTS.LOOP_TICK,0,0,0,due,Math.max(0,actual-due));due=actual+period;},period);loopTimer.unref();
 }
}
