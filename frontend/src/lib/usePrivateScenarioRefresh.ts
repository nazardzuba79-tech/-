import { useEffect,useRef } from 'react';
import { privateTradingApi,type PrivatePreview,type PrivateScenario } from './privateTradingApi';

type AdvanceClient=Pick<typeof privateTradingApi,'advance'|'getPreview'|'confirm'|'cancelPreview'>;
/** One bounded incremental calculation. Confirmation can only revise the existing, version-locked scenario. */
export async function refreshPrivateScenario(id:string,client:AdvanceClient,signal:AbortSignal,canContinue:()=>boolean,onConfirmed:()=>void,wait:(signal:AbortSignal)=>Promise<void>=signal=>new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},1000);
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
})){
  let job:PrivatePreview|undefined,confirmed=false;
  try{
    if(signal.aborted||!canContinue())return;
    job=await client.advance(id,new Date().toISOString(),crypto.randomUUID());
    for(let polls=0;job.status==='RUNNING'&&polls<45;polls++){
      if(signal.aborted||!canContinue())return;
      await wait(signal);job=await client.getPreview(job.id,signal);
    }
    if(job.status!=='READY'||signal.aborted||!canContinue())return;
    await client.confirm(job.id,crypto.randomUUID());confirmed=true;
    if(!signal.aborted)onConfirmed();
  }finally{if(job&&!confirmed)await client.cancelPreview(job.id).catch(()=>{});}
}

export function usePrivateScenarioRefresh(scenarios:PrivateScenario[],paused:boolean,onConfirmed:()=>void,onDenied:(error:unknown)=>void){
  const current=useRef({scenarios,paused,onConfirmed,onDenied});current.current={scenarios,paused,onConfirmed,onDenied};
  useEffect(()=>{
    const controller=new AbortController();let running=false;const attempted=new Map<string,number>();
    const tick=async()=>{
      if(running||controller.signal.aborted||document.hidden||current.current.paused)return;
      const scenario=current.current.scenarios.find(s=>s.status==='OPEN'&&s.verification==='VERIFIED'&&s.evaluatedThrough&&Date.now()-Date.parse(s.asOf)>60_000&&Date.now()-(attempted.get(s.id)||0)>60_000);
      if(!scenario)return;attempted.set(scenario.id,Date.now());running=true;
      try{await refreshPrivateScenario(scenario.id,privateTradingApi,controller.signal,()=>!document.hidden&&!current.current.paused,()=>current.current.onConfirmed());}
      catch(error){if(!controller.signal.aborted)current.current.onDenied(error);}
      finally{running=false;}
    };
    const timer=window.setInterval(()=>void tick(),5000);document.addEventListener('visibilitychange',tick);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
  },[]);
}
