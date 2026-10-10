import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { accountId } from './accounts.mjs';
import { ACCOUNT_MUTATIONS,ACCOUNT_READS } from './account-commands.mjs';
import { check,SimError } from './engine.mjs';

export async function openAccountWorker(path,{now=Date.now,diagnostics=false,maxPending=128,maxQueueBytes=1048576,queueTimeoutMs=2500,testHooks}={}){
  check(Number.isSafeInteger(maxPending)&&maxPending>0&&maxPending<=1024,'ACCOUNT_CONFIG_INVALID');
  check(Number.isSafeInteger(maxQueueBytes)&&maxQueueBytes>0&&maxQueueBytes<=16*1048576,'ACCOUNT_CONFIG_INVALID');
  check(Number.isSafeInteger(queueTimeoutMs)&&queueTimeoutMs>0&&queueTimeoutMs<=60000,'ACCOUNT_CONFIG_INVALID');
  check(testHooks===undefined||testHooks&&Object.keys(testHooks).every(k=>k==='commitControl'),'ACCOUNT_CONFIG_INVALID');
  const testControl=testHooks?.commitControl;
  check(testControl===undefined||testControl instanceof SharedArrayBuffer&&testControl.byteLength===5*Int32Array.BYTES_PER_ELEMENT,'ACCOUNT_CONFIG_INVALID');
  // Production uses the worker's actual execution clock. An explicitly injected
  // fixture clock is shared, refreshed at dispatch rather than queue admission.
  const clock=now===Date.now?null:new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
  const updateClock=()=>{if(clock){const time=now();check(Number.isSafeInteger(time)&&time>=0,'ACCOUNT_CONFIG_INVALID');Atomics.store(clock,0,BigInt(time));}};
  updateClock();
  const worker=new Worker(new URL('./account-worker-runtime.mjs',import.meta.url),{workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl}});
  let ready=false,dead=false,closing=false,closed=false,closeSent=false,active=null,serial=0,bytes=0;
  const queue=[],counters={accepted:0,dispatched:0,completed:0,rejected:0,timedOut:0,maxPending:0,maxBytes:0,waitMs:0,maxWaitMs:0,workMs:0};
  let sqlMetrics={sqlCalls:0,sqlReadCalls:0,sqlWriteCalls:0,sqlExecCalls:0,transactionExecCalls:0,sqlWallMs:0,sqlCpuMs:0,sqlThreadCpuAvailable:0,sqlStages:{},observedAt:0};
  let resolveReady,rejectReady,resolveClose,closePromise;
  const started=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const error=code=>new SimError(code);
  const settle=(entry,code,value)=>{clearTimeout(entry.timer);bytes-=entry.bytes;if(code)entry.reject(error(code));else entry.resolve(value);};
  const fatal=()=>{
    if(dead||closed)return;dead=true;rejectReady(error('ACCOUNT_UNAVAILABLE'));
    if(active){const entry=active;active=null;settle(entry,ACCOUNT_MUTATIONS.has(entry.type)?'ACCOUNT_OUTCOME_UNKNOWN':'ACCOUNT_UNAVAILABLE');}
    for(const entry of queue.splice(0))settle(entry,'ACCOUNT_UNAVAILABLE');
    resolveClose?.();
  };
  const pump=()=>{
    if(!ready||dead||active)return;
    const entry=queue.shift();
    if(!entry){if(closing&&!closeSent){closeSent=true;worker.postMessage({kind:'close'});}return;}
    clearTimeout(entry.timer);active=entry;const waited=performance.now()-entry.enqueued;
    counters.waitMs+=waited;counters.maxWaitMs=Math.max(counters.maxWaitMs,waited);entry.dispatchedAt=performance.now();
    try{updateClock();worker.postMessage({kind:'command',requestId:entry.requestId,principal:entry.principal,type:entry.type,input:entry.input});counters.dispatched++;}
    catch{active=null;settle(entry,'ACCOUNT_COMMAND_INVALID');pump();}
  };
  worker.on('message',message=>{
    if(message.metrics)sqlMetrics=message.metrics;
    if(message.kind==='ready'){ready=true;resolveReady();pump();return;}
    if(message.kind==='closed'){closed=true;resolveClose?.();return;}
    if(message.kind==='fatal'){fatal();void worker.terminate();return;}
    if(message.kind!=='result'||!active||active.requestId!==message.requestId){fatal();void worker.terminate();return;}
    const entry=active;active=null;counters.completed++;counters.workMs+=performance.now()-entry.dispatchedAt;
    settle(entry,message.error,message.value);
    // A failed rollback or response after COMMIT leaves the connection/outcome
    // uncertain. Fail closed instead of running another financial command on it.
    if(message.error==='ACCOUNT_OUTCOME_UNKNOWN'){fatal();void worker.terminate();return;}
    pump();
  });
  worker.on('error',fatal);
  worker.on('exit',()=>{if(!closed)fatal();});
  await started;
  const dispatch=(principal,type,input)=>{
    if(dead||closed||closing)return Promise.reject(error('ACCOUNT_UNAVAILABLE'));
    if(type!=='ensure'&&!ACCOUNT_MUTATIONS.has(type)&&!ACCOUNT_READS.has(type))return Promise.reject(error('ACCOUNT_COMMAND_INVALID'));
    let encoded,payload;
    try{
      // Snapshot the caller's values at admission so later mutation cannot
      // redirect queued work or change an accepted order's canonical payload.
      payload=structuredClone({principal,type,input});encoded=JSON.stringify(payload);
    }catch{return Promise.reject(error('ACCOUNT_COMMAND_INVALID'));}
    const size=Buffer.byteLength(encoded),pending=queue.length+Number(!!active);
    if(pending>=maxPending||bytes+size>maxQueueBytes){counters.rejected++;return Promise.reject(error('ACCOUNT_BUSY'));}
    return new Promise((resolve,reject)=>{
      const entry={...payload,requestId:++serial,bytes:size,enqueued:performance.now(),resolve,reject,timer:null};
      bytes+=size;counters.accepted++;counters.maxPending=Math.max(counters.maxPending,pending+1);counters.maxBytes=Math.max(counters.maxBytes,bytes);
      entry.timer=setTimeout(()=>{const index=queue.indexOf(entry);if(index<0)return;queue.splice(index,1);counters.rejected++;counters.timedOut++;settle(entry,'ACCOUNT_BUSY');pump();},queueTimeoutMs);
      queue.push(entry);pump();
    });
  };
  return{
    async forPrincipal(principal){
      // Only the authenticated server constructs this principal. Account IDs
      // never come from an order body or a client-selected route parameter.
      const owner=structuredClone(principal),id=accountId(owner);
      await dispatch(owner,'ensure');
      return{id,read:()=>dispatch(owner,'read'),execute:(command,input)=>dispatch(owner,command,input)};
    },
    metrics(){return{...sqlMetrics,sqlStages:Object.fromEntries(Object.entries(sqlMetrics.sqlStages).map(([key,value])=>[key,{...value}])),updatedAt:sqlMetrics.observedAt,metricsAgeMs:sqlMetrics.observedAt?Math.max(0,Date.now()-sqlMetrics.observedAt):0,workerAlive:Number(!dead&&!closed),queue:{...counters,pending:queue.length,active:Number(!!active),bytes,maxPendingLimit:maxPending,maxQueueBytesLimit:maxQueueBytes,queueTimeoutMs}};},
    close(){
      if(closePromise)return closePromise;
      if(dead||closed)return Promise.resolve();
      closing=true;closePromise=new Promise(resolve=>{resolveClose=resolve;});pump();return closePromise;
    },
  };
}
