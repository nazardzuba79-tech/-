import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { accountId } from './accounts.mjs';
import { ACCOUNT_MUTATIONS,ACCOUNT_READS } from './account-commands.mjs';
import { check,SimError } from './engine.mjs';

export async function openAccountWorker(path,{now=Date.now,diagnostics=false,maxPending=128,maxQueueBytes=1048576,queueTimeoutMs=2500,testHooks}={}){
  check(Number.isSafeInteger(maxPending)&&maxPending>0&&maxPending<=1024,'ACCOUNT_CONFIG_INVALID');
  check(Number.isSafeInteger(maxQueueBytes)&&maxQueueBytes>0&&maxQueueBytes<=16*1048576,'ACCOUNT_CONFIG_INVALID');
  check(Number.isSafeInteger(queueTimeoutMs)&&queueTimeoutMs>0&&queueTimeoutMs<=60000,'ACCOUNT_CONFIG_INVALID');
  check(testHooks===undefined||testHooks&&Object.keys(testHooks).every(k=>k==='commitControl'||k==='registrationControl'),'ACCOUNT_CONFIG_INVALID');
  const testControl=testHooks?.commitControl;
  check(testControl===undefined||testControl instanceof SharedArrayBuffer&&testControl.byteLength===5*Int32Array.BYTES_PER_ELEMENT,'ACCOUNT_CONFIG_INVALID');
  const registrationControl=testHooks?.registrationControl;
  check(registrationControl===undefined||registrationControl instanceof SharedArrayBuffer&&registrationControl.byteLength===5*Int32Array.BYTES_PER_ELEMENT,'ACCOUNT_CONFIG_INVALID');
  // Production uses the worker's actual execution clock. An explicitly injected
  // fixture clock is shared, refreshed at dispatch rather than queue admission.
  const clock=now===Date.now?null:new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
  const updateClock=()=>{if(clock){const time=now();check(Number.isSafeInteger(time)&&time>=0,'ACCOUNT_CONFIG_INVALID');Atomics.store(clock,0,BigInt(time));}};
  updateClock();
  // Commit fence shared with the worker: (sequence<<2)|decision, see account-worker-runtime.mjs.
  const fence=new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const worker=new Worker(new URL('./account-worker-runtime.mjs',import.meta.url),{workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl,fence:fence.buffer}});
  let ready=false,dead=false,closing=false,closed=false,closeSent=false,active=null,serial=0,bytes=0;
  const queue=[],counters={accepted:0,dispatched:0,completed:0,rejected:0,timedOut:0,cancelledReads:0,cancelledObservations:0,maxPending:0,maxBytes:0,waitMs:0,maxWaitMs:0,workMs:0,logicalWorkMs:0,registrationGroups:0,groupedRegistrations:0,maxRegistrationGroup:0};
  let sqlMetrics={sqlCalls:0,sqlReadCalls:0,sqlWriteCalls:0,sqlExecCalls:0,transactionExecCalls:0,sqlWallMs:0,sqlCpuMs:0,sqlThreadCpuAvailable:0,sqlStages:{},observedAt:0};
  let resolveReady,rejectReady,resolveClose,closePromise;
  const started=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const error=code=>new SimError(code);
  const detachAbort=entry=>entry.signal?.removeEventListener('abort',entry.onAbort);
  const settle=(entry,code,value)=>{clearTimeout(entry.timer);detachAbort(entry);bytes-=entry.bytes;if(code)entry.reject(error(code));else entry.resolve(value);};
  const fatal=()=>{
    if(dead||closed)return;dead=true;rejectReady(error('ACCOUNT_UNAVAILABLE'));
    if(active){const group=active;active=null;for(const entry of group.entries)settle(entry,group.registrationBatch||ACCOUNT_MUTATIONS.has(entry.type)?'ACCOUNT_OUTCOME_UNKNOWN':'ACCOUNT_UNAVAILABLE');}
    for(const entry of queue.splice(0))settle(entry,'ACCOUNT_UNAVAILABLE');
    resolveClose?.();
  };
  const pump=()=>{
    if(!ready||dead||active)return;
    const entries=[];
    while(queue.length){
      const entry=queue[0],waited=performance.now()-entry.enqueued;
      // The timer may be delayed by the host event loop. Expired work must not
      // become active (and later execute) merely because its callback is late.
      if(waited>=queueTimeoutMs){queue.shift();counters.rejected++;counters.timedOut++;settle(entry,'ACCOUNT_BUSY');continue;}
      if(entries.length&&(entries[0].type!=='ensure'||entry.type!=='ensure'||entries[0].existingOnly||entry.existingOnly||entries.length>=32))break;
      queue.shift();clearTimeout(entry.timer);detachAbort(entry);entries.push(entry);
      counters.waitMs+=waited;counters.maxWaitMs=Math.max(counters.maxWaitMs,waited);
      if(entry.type!=='ensure'||entry.existingOnly)break;
    }
    if(!entries.length){if(closing&&!closeSent){closeSent=true;worker.postMessage({kind:'close'});}return;}
    const first=entries[0],registrationBatch=entries.length>1;
    active={entries,requestId:first.requestId,registrationBatch,dispatchedAt:performance.now()};
    try{
      updateClock();
      worker.postMessage(registrationBatch?
        {kind:'ensureBatch',requestId:first.requestId,principals:entries.map(entry=>entry.principal)}:
        {kind:'command',requestId:first.requestId,principal:first.principal,type:first.type,input:first.input,...(first.existingOnly?{existingOnly:true}:{}),...(first.fence?{fenced:true}:{})});
      counters.dispatched+=entries.length;
      if(registrationBatch){counters.registrationGroups++;counters.groupedRegistrations+=entries.length;counters.maxRegistrationGroup=Math.max(counters.maxRegistrationGroup,entries.length);}
    }catch{active=null;for(const entry of entries)settle(entry,'ACCOUNT_COMMAND_INVALID');pump();}
  };
  worker.on('message',message=>{
    if(message.metrics)sqlMetrics=message.metrics;
    if(message.kind==='ready'){ready=true;resolveReady();pump();return;}
    if(message.kind==='closed'){closed=true;resolveClose?.();return;}
    if(message.kind==='fatal'){fatal();void worker.terminate();return;}
    if(message.kind==='fence'){
      // Only the active command's own authorization can release its COMMIT.
      const entry=active&&!active.registrationBatch&&active.requestId===message.requestId?active.entries[0]:null;
      const sequence=message.sequence;
      if(!entry?.fence||!Number.isSafeInteger(sequence)||sequence<1||sequence>0x1fffffff){fatal();void worker.terminate();return;}
      const decide=decision=>{Atomics.compareExchange(fence,0,sequence<<2,(sequence<<2)|decision);Atomics.notify(fence,0);};
      Promise.resolve().then(()=>entry.fence()).then(()=>decide(1),error=>decide(error instanceof SimError&&error.code==='AUTH_REQUIRED'?2:3));
      return;
    }
    if(message.kind!=='result'||!active||active.requestId!==message.requestId){fatal();void worker.terminate();return;}
    const group=active;
    if(group.registrationBatch&&!message.error&&(!Array.isArray(message.value?.ids)||message.value.ids.length!==group.entries.length||
      group.entries.some((entry,index)=>message.value.ids[index]!==accountId(entry.principal)))){fatal();void worker.terminate();return;}
    active=null;const elapsed=performance.now()-group.dispatchedAt;counters.completed+=group.entries.length;
    // workMs is physical worker occupancy; logicalWorkMs includes each waiting
    // group member's execution latency. SQL metrics report actual transactions.
    counters.workMs+=elapsed;counters.logicalWorkMs+=elapsed*group.entries.length;
    for(const entry of group.entries)settle(entry,message.error,group.registrationBatch?{id:accountId(entry.principal)}:message.value);
    // A failed rollback or response after COMMIT leaves the connection/outcome
    // uncertain. Fail closed instead of running another financial command on it.
    if(message.error==='ACCOUNT_OUTCOME_UNKNOWN'){fatal();void worker.terminate();return;}
    pump();
  });
  worker.on('error',fatal);
  worker.on('exit',()=>{if(!closed)fatal();});
  await started;
  const dispatch=(principal,type,input,options,existingOnly=false)=>{
    if(dead||closed||closing)return Promise.reject(error('ACCOUNT_UNAVAILABLE'));
    if(type!=='ensure'&&!ACCOUNT_MUTATIONS.has(type)&&!ACCOUNT_READS.has(type))return Promise.reject(error('ACCOUNT_COMMAND_INVALID'));
    // Only undispatched projections or optional market observations may be abandoned.
    // Orders, cancel/balance commands and every active command remain atomic.
    const signal=['readView','portfolioView','observe'].includes(type)?options?.signal:undefined;
    // A commit fence is the caller's re-authorization, run by the worker after
    // the write is staged and before COMMIT. Only state-changing commands take one.
    const fence=options?.fence;
    if(fence!==undefined&&(typeof fence!=='function'||!ACCOUNT_MUTATIONS.has(type)))return Promise.reject(error('ACCOUNT_COMMAND_INVALID'));
    if(signal?.aborted)return Promise.reject(error('ACCOUNT_READ_ABORTED'));
    let encoded,payload;
    try{
      // Snapshot the caller's values at admission so later mutation cannot
      // redirect queued work or change an accepted order's canonical payload.
      payload=structuredClone({principal,type,input,...(existingOnly?{existingOnly:true}:{})});encoded=JSON.stringify(payload);
    }catch{return Promise.reject(error('ACCOUNT_COMMAND_INVALID'));}
    const size=Buffer.byteLength(encoded),pending=queue.length+(active?.entries.length??0);
    if(pending>=maxPending||bytes+size>maxQueueBytes){counters.rejected++;return Promise.reject(error('ACCOUNT_BUSY'));}
    return new Promise((resolve,reject)=>{
      const entry={...payload,requestId:++serial,bytes:size,enqueued:performance.now(),resolve,reject,timer:null,signal,onAbort:null,fence};
      bytes+=size;counters.accepted++;counters.maxPending=Math.max(counters.maxPending,pending+1);counters.maxBytes=Math.max(counters.maxBytes,bytes);
      entry.timer=setTimeout(()=>{const index=queue.indexOf(entry);if(index<0)return;queue.splice(index,1);counters.rejected++;counters.timedOut++;settle(entry,'ACCOUNT_BUSY');pump();},queueTimeoutMs);
      queue.push(entry);
      if(signal){
        entry.onAbort=()=>{const index=queue.indexOf(entry);if(index<0)return;queue.splice(index,1);if(type==='observe')counters.cancelledObservations++;else counters.cancelledReads++;settle(entry,type==='observe'?'ACCOUNT_OBSERVATION_ABORTED':'ACCOUNT_READ_ABORTED');pump();};
        signal.addEventListener('abort',entry.onAbort,{once:true});
        if(signal.aborted)entry.onAbort();
      }
      pump();
    });
  };
  return{
    async forPrincipal(principal,{existingOnly=false}={}){
      check(typeof existingOnly==='boolean','ACCOUNT_COMMAND_INVALID');
      // Only the authenticated server constructs this principal. Account IDs
      // never come from an order body or a client-selected route parameter.
      const owner=structuredClone(principal),id=accountId(owner);
      await dispatch(owner,'ensure',undefined,undefined,existingOnly);
      // This mode is captured by the handle, never accepted from command input
      // or overridden through per-request signal/options objects.
      return{id,read:()=>dispatch(owner,'read',undefined,undefined,existingOnly),execute:(command,input,options)=>dispatch(owner,command,input,options,existingOnly)};
    },
    metrics(){return{...sqlMetrics,sqlStages:Object.fromEntries(Object.entries(sqlMetrics.sqlStages).map(([key,value])=>[key,{...value}])),updatedAt:sqlMetrics.observedAt,metricsAgeMs:sqlMetrics.observedAt?Math.max(0,Date.now()-sqlMetrics.observedAt):0,workerAlive:Number(!dead&&!closed),queue:{...counters,pending:queue.length,active:active?.entries.length??0,bytes,maxPendingLimit:maxPending,maxQueueBytesLimit:maxQueueBytes,queueTimeoutMs}};},
    close(){
      if(closePromise)return closePromise;
      if(dead||closed)return Promise.resolve();
      closing=true;closePromise=new Promise(resolve=>{resolveClose=resolve;});pump();return closePromise;
    },
  };
}
