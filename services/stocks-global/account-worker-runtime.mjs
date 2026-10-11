import { parentPort,workerData } from 'node:worker_threads';
import { openAccounts,accountId } from './accounts.mjs';
import { executeAccountCommand,ACCOUNT_MUTATIONS } from './account-commands.mjs';
import { check,SimError } from './engine.mjs';
import { createObservations } from './account-observations.mjs';

const clock=workerData.clock?new BigInt64Array(workerData.clock):null;
const now=()=>clock?Number(Atomics.load(clock,0)):Date.now();
const control=workerData.testControl?new Int32Array(workerData.testControl):null;
const registrationControl=workerData.registrationControl?new Int32Array(workerData.registrationControl):null;
const beforeCommit=()=>{
  if(!control)return;
  Atomics.add(control,1,1);Atomics.notify(control,1);
  if(Atomics.load(control,0)){
    while(!Atomics.load(control,2))Atomics.wait(control,2,0);
    Atomics.store(control,0,0);
  }
  if(Atomics.load(control,4))throw new SimError('ACCOUNT_TEST_COMMIT_FAILURE');
};
const beforeRegistrationCommit=()=>{
  if(!registrationControl)return;
  Atomics.add(registrationControl,1,1);Atomics.notify(registrationControl,1);
  if(Atomics.load(registrationControl,0)){
    while(!Atomics.load(registrationControl,2))Atomics.wait(registrationControl,2,0);
    Atomics.store(registrationControl,0,0);
  }
  if(Atomics.load(registrationControl,4)===2)process.exit(74);
  if(Atomics.load(registrationControl,4))throw new SimError('ACCOUNT_TEST_REGISTRATION_COMMIT_FAILURE');
};
const repo=openAccounts(workerData.path,{now,diagnostics:workerData.diagnostics,beforeCommit,beforeRegistrationCommit}),handles=new Map();
const observations=createObservations({now});
const metrics=()=>({...repo.metrics(),...observations.metrics(),observedAt:Date.now()});
const get=(principal,registration)=>{
  const id=accountId(principal);let store=handles.get(id);
  if(!store){store=repo.forPrincipal(principal);handles.set(id,store);observations.register(id,registration?.created??store.created);while(handles.size>512){const first=handles.keys().next().value;handles.delete(first);observations.forget(first);}}
  return store;
};
let busy=false;
parentPort.on('message',async message=>{
  if(message.kind==='close'){check(!busy,'ACCOUNT_BUSY');repo.close();parentPort.postMessage({kind:'closed',metrics:metrics()});parentPort.close();return;}
  if(!['command','ensureBatch'].includes(message.kind)||busy){parentPort.postMessage({kind:'fatal'});return;}
  busy=true;
  let registrationCommitted=false;
  try{
    if(message.kind==='ensureBatch'){
      const principals=message.principals;
      check(Array.isArray(principals)&&principals.length>1&&principals.length<=32,'ACCOUNT_COMMAND_INVALID');
      // Validate the complete authenticated group before touching SQLite. Cached
      // owners need no write; all newly funded identities become visible at once.
      const identities=principals.map(principal=>accountId(principal));
      const uncached=principals.filter((_,index)=>!handles.has(identities[index]));
      const result=uncached.length?repo.ensurePrincipals(uncached):{owners:[],committed:false};
      registrationCommitted=result.committed;
      if(registrationCommitted&&registrationControl){
        const outcome=Atomics.load(registrationControl,3);
        if(outcome===2)throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
        if(outcome)process.exit(73);
      }
      const registrations=new Map(result.owners.map(owner=>[owner.id,owner]));
      for(let index=0;index<principals.length;index++)get(principals[index],registrations.get(identities[index]));
      parentPort.postMessage({kind:'result',requestId:message.requestId,value:{ids:identities},metrics:metrics()});
      return;
    }
    const {principal,type,input}=message,store=get(principal);let value,financialCommit=false;
    const mutate=async(fn,id,project=false)=>{
      let committedState,syncId=id;
      const result=await store.transact((state,time)=>{if(type==='submitObserved'&&state.orders.some(o=>o.id===input?.order?.id))syncId=null;const result=fn(state,time);committedState=structuredClone(state);return result;});
      financialCommit=true;
      try{committedState.revision=result.snapshot.revision;observations.committed(store.id,committedState,syncId);if(project)result.snapshot=observations.view(store.id,committedState);}
      catch{throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');}
      return result;
    };
    if(type==='ensure')value={id:store.id};
    else if(type==='read')value=store.read();
    else if(type==='readView')value=observations.view(store.id,store.readState());
    else if(type==='interests')value=executeAccountCommand(store.readState(),type,input,now());
    else if(['observe','observeFailed','observeBackground','observeFailedBackground'].includes(type)){
      const background=type==='observeBackground'||type==='observeFailedBackground';
      const received=type==='observe'||type==='observeBackground';
      const state=store.readState(),id=received?input?.instrumentId:input?.id;
      const durable=observations.hasOrders(state,id);
      let observation;
      if(received)observation=observations.observe(store.id,state,input);
      else observations.failed(store.id,state,id);
      if(durable){
        try{value=await mutate((s,t)=>received?(observation.quote?executeAccountCommand(s,'quote',observation.quote,t):undefined):executeAccountCommand(s,'quoteFailed',{id},t),id,!background);}
        catch(error){observations.failed(store.id,state,id);throw error;}
      }else value=background?{}:{snapshot:observations.view(store.id,state)};
      // Background polling needs the acknowledged outcome, not an account view.
      // Active orders still commit and synchronize the same durable state first;
      // explicit refresh/order responses keep their complete projected snapshot.
      if(background)value={};
      observations.count(durable);value.observation={durable,mode:durable?'committed':'volatile'};
    }
    else if(type==='submitObserved')value=await mutate((s,t)=>observations.submit(store.id,s,input,t),input?.order?.instrumentId,true);
    else{check(ACCOUNT_MUTATIONS.has(type),'ACCOUNT_COMMAND_INVALID');const id=type==='quote'?input?.instrumentId:type==='quoteFailed'?input?.id:type==='submit'?input?.instrumentId:null;value=await mutate((s,t)=>executeAccountCommand(s,type,input,t),id);}
    if(control&&financialCommit){
      const outcome=Atomics.load(control,3);
      if(outcome===2)throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
      if(outcome)process.exit(73);
    }
    parentPort.postMessage({kind:'result',requestId:message.requestId,value,metrics:metrics()});
  }catch(error){parentPort.postMessage({kind:'result',requestId:message.requestId,error:registrationCommitted?'ACCOUNT_OUTCOME_UNKNOWN':error instanceof SimError?error.code:'ACCOUNT_STORAGE_ERROR',metrics:metrics()});}
  finally{busy=false;}
});
parentPort.postMessage({kind:'ready',metrics:metrics()});
