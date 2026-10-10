import { parentPort,workerData } from 'node:worker_threads';
import { openAccounts,accountId } from './accounts.mjs';
import { executeAccountCommand,ACCOUNT_MUTATIONS } from './account-commands.mjs';
import { check,SimError } from './engine.mjs';

const clock=workerData.clock?new BigInt64Array(workerData.clock):null;
const now=()=>clock?Number(Atomics.load(clock,0)):Date.now();
const control=workerData.testControl?new Int32Array(workerData.testControl):null;
const beforeCommit=()=>{
  if(!control)return;
  Atomics.add(control,1,1);Atomics.notify(control,1);
  if(Atomics.load(control,0)){
    while(!Atomics.load(control,2))Atomics.wait(control,2,0);
    Atomics.store(control,0,0);
  }
  if(Atomics.load(control,4))throw new SimError('ACCOUNT_TEST_COMMIT_FAILURE');
};
const repo=openAccounts(workerData.path,{now,diagnostics:workerData.diagnostics,beforeCommit}),handles=new Map();
const metrics=()=>({...repo.metrics(),observedAt:Date.now()});
const get=principal=>{
  const id=accountId(principal);let store=handles.get(id);
  if(!store){store=repo.forPrincipal(principal);handles.set(id,store);while(handles.size>512)handles.delete(handles.keys().next().value);}
  return store;
};
let busy=false;
parentPort.on('message',async message=>{
  if(message.kind==='close'){check(!busy,'ACCOUNT_BUSY');repo.close();parentPort.postMessage({kind:'closed',metrics:metrics()});parentPort.close();return;}
  if(message.kind!=='command'||busy){parentPort.postMessage({kind:'fatal'});return;}
  busy=true;
  try{
    const {principal,type,input}=message,store=get(principal);let value;
    if(type==='ensure')value={id:store.id};
    else if(type==='read')value=store.read();
    else if(type==='interests')value=executeAccountCommand(store.read(),type,input,now());
    else{check(ACCOUNT_MUTATIONS.has(type),'ACCOUNT_COMMAND_INVALID');value=await store.transact((s,t)=>executeAccountCommand(s,type,input,t));}
    if(control&&ACCOUNT_MUTATIONS.has(type)){
      const outcome=Atomics.load(control,3);
      if(outcome===2)throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
      if(outcome)process.exit(73);
    }
    parentPort.postMessage({kind:'result',requestId:message.requestId,value,metrics:metrics()});
  }catch(error){parentPort.postMessage({kind:'result',requestId:message.requestId,error:error instanceof SimError?error.code:'ACCOUNT_STORAGE_ERROR',metrics:metrics()});}
  finally{busy=false;}
});
parentPort.postMessage({kind:'ready',metrics:metrics()});
