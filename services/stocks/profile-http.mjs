// Offline HTTP CPU profile. Separate client process; no external provider or account DB.
// Uncapped local results diagnose code costs only and never establish production capacity.
import { readFileSync,mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
const here=resolve(fileURLToPath(new URL('.',import.meta.url))),moduleRoot=resolve(process.env.STOCK_PROFILE_MODULE_ROOT??here);
const {Store}=await import(pathToFileURL(join(moduleRoot,'core.mjs'))),{createStockServer}=await import(pathToFileURL(join(moduleRoot,'server.mjs')));
const instruments=JSON.parse(readFileSync(join(moduleRoot,'manifest.json'))).slice(0,20).map(i=>({...i,enabled:true,dataRightsStatus:'confirmed'}));
const dir=mkdtempSync(join(tmpdir(),'stocks-http-profile-')),store=new Store(join(dir,'candles.sqlite'));
const now=Date.now(),stages={},counters={},profile={measure(name,fn){const start=performance.now(),cpu=process.cpuUsage();try{return fn();}finally{const d=process.cpuUsage(cpu),m=stages[name]??={calls:0,cpuMs:0,wallMs:0};m.calls++;m.cpuMs+=(d.user+d.system)/1000;m.wallMs+=performance.now()-start;}},count(name,n=1){counters[name]=(counters[name]??0)+n;}};
for(const i of instruments)store.write(Array.from({length:499},(_,n)=>({instrumentId:i.instrumentId,interval:'15m',openTimeUtc:now-(500-n)*900000,closeTimeUtc:now-(499-n)*900000,open:'100',high:'102',low:'99',close:'101',volume:null,currency:i.currency,provider:i.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'})),i,now);
for(const name of ['history','encodedHistory'])if(typeof store[name]==='function'){const original=store[name].bind(store);store[name]=(...args)=>profile.measure(name==='history'?'sqlRows':'sqlEncodedPage',()=>original(...args));}
const stageHooks=process.env.STOCK_PROFILE_STAGES!=='false',server=createStockServer({store,instruments,...(stageHooks?{profile}:{})}),session=new Session();session.connect();
const post=(method,params={})=>new Promise((ok,fail)=>session.post(method,params,(error,value)=>error?fail(error):ok(value)));
let started=false;
try{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));started=true;
  await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');
  const cpu=process.cpuUsage(),start=performance.now();
  const reader=await new Promise((ok,fail)=>{const child=spawn(process.execPath,[join(here,'realistic-readers.mjs')],{env:{...process.env,STOCK_REALISTIC_URL:`http://127.0.0.1:${server.address().port}`,STOCK_REALISTIC_MODE:'history',STOCK_REALISTIC_USERS:'100',STOCK_REALISTIC_SECONDS:'8',STOCK_REALISTIC_CADENCE_MS:'200'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',fail);child.on('close',code=>{if(code!==0)fail(Error(stderr));else try{ok(JSON.parse(stdout.trim()));}catch(error){fail(error);}});});
  const elapsedMs=performance.now()-start,delta=process.cpuUsage(cpu),cpuMs=(delta.user+delta.system)/1000;
  const {profile:sampled}=await post('Profiler.stop');
  const out=resolve(process.env.STOCK_PROFILE_OUTPUT??join(dir,'http-profile'));mkdirSync(out,{recursive:true});writeFileSync(join(out,'http.cpuprofile'),JSON.stringify(sampled));
  const result={kind:'offline-http-cpu-profile',fixture:true,capacityClaim:false,moduleRoot,stageHooks,reader,elapsedMs,cpuMs,cpuVcpu:cpuMs/elapsedMs,rssBytes:process.memoryUsage().rss,stages,counters,externalApiCalls:0,accountDatabaseOpened:false,notes:['Process CPU excludes the separate reader process; Node inspector and stage instrumentation overhead remain.','Baseline without an optional server profile hook only exposes wrapped Store SQL stages; use raw V8 profile for the remaining stack costs.','Use STOCK_PROFILE_STAGES=false for like-for-like HTTP process CPU; per-request stage clocks otherwise add overhead only on revisions with hooks.','No cgroup/disk capacity guarantee is claimed for an uncapped local run.']};writeFileSync(join(out,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{session.disconnect();if(started){server.closeAllConnections();await new Promise(ok=>server.close(ok));}store.close();rmSync(dir,{recursive:true,force:true});}
