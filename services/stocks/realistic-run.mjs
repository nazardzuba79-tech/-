// Linux CI orchestration only. Images are built from exact before/after revisions by the workflow.
import { spawn,spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,copyFileSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineMetrics } from './realistic-metrics.mjs';
const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const output=resolve(process.env.STOCK_REALISTIC_OUTPUT??'.ci-output/stock-realistic');
const disk=process.env.STOCK_REALISTIC_DISK,device=process.env.STOCK_BENCH_DEVICE,cpu=process.env.BENCH_CPU,clientCpu=process.env.LOAD_CPU;
const images=JSON.parse(process.env.STOCK_REALISTIC_IMAGES??'{}');
const seconds=Number(process.env.STOCK_REALISTIC_SECONDS??30),repeats=Number(process.env.STOCK_REALISTIC_REPEATS??3);
if(process.platform!=='linux'||!disk||!device||cpu===undefined||clientCpu===undefined||!images.before||!images.after)throw Error('Linux, verified block device/CPU placement, disposable disk and exact before/after images required');
if(!Number.isSafeInteger(seconds)||seconds<18||seconds>60||!Number.isSafeInteger(repeats)||repeats<1||repeats>3)throw Error('Invalid fixture run length');
mkdirSync(output,{recursive:true});mkdirSync(disk,{recursive:true});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const docker=(args)=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:120000});if(r.status!==0)throw Error(`docker ${args[0]} failed: ${r.stderr}`);return r.stdout.trim();};
const bounded=(dir,{ports=false,profile=false,quota=.05}={})=>['--cpus',String(quota),'--cpuset-cpus',String(cpu),'--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--device-read-bps',`${device}:1048576`,'--device-write-bps',`${device}:131072`,'--mount',`type=bind,src=${dir},dst=/data`,...(ports?['--network','host']:['--network','none']),...(profile?['-e','STOCK_REALISTIC_PROFILE=/data/server.cpuprofile']:[])];
const client=async(script,args=[],env={})=>new Promise((ok,fail)=>{
  const child=spawn('taskset',['-c',String(clientCpu),process.execPath,join(here,script),...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',fail);child.on('close',code=>{if(code!==0)return fail(Error(`Reader exit ${code}: ${stderr}`));try{ok({value:JSON.parse(stdout.trim()),stdout,stderr});}catch(error){fail(Error(`Invalid reader output: ${error.message}\n${stdout}\n${stderr}`));}});
});
const waitReady=async(url,name)=>{for(let attempt=0;attempt<120;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await sleep(250);}throw Error(`Fixture not ready: ${name}: ${docker(['logs',name])}`);};
const results=[];
writeFileSync(join(output,'configuration.json'),JSON.stringify({fixture:true,images,seconds,repeats,cpu,clientCpu,limits:{cpuVcpu:.05,memoryBytes:268435456,readBps:1048576,writeBps:131072,deadlineMs:3000},externalApiCalls:0,notes:'Same bounded stock slice as the existing strict test. This is a tested allocation on a shared CI host, not measured production headroom.'},null,2));
async function runCase(variant,repeat,users,pattern,quota=.05){
  const label=`${variant}-${users}-${pattern}-${repeat}${quota===.05?'':'-cpu'+quota}`,dir=join(resolve(disk),label),name=`stocks-realistic-${process.pid}`;mkdirSync(dir,{recursive:true,mode:0o777});spawnSync('chmod',['777',dir]);
  let started=false;
  try{
    docker(['run','-d','--name',name,...bounded(dir,{ports:true,quota}),'-e','STOCK_REALISTIC_DB=/data/accounts.sqlite',images[variant]]);started=true;
    await waitReady('http://127.0.0.1:8092/__stocks_global/health',name);
    const reset=await fetch('http://127.0.0.1:8093/reset',{method:'POST'});if(!reset.ok)throw Error('Metrics reset failed');
    const reader=await client('realistic-readers.mjs',[],{STOCK_REALISTIC_URL:'http://127.0.0.1:8092',STOCK_REALISTIC_USERS:String(users),STOCK_REALISTIC_PATTERN:pattern,STOCK_REALISTIC_SECONDS:String(seconds)});
    const server=await(await fetch('http://127.0.0.1:8093/metrics')).json();
    const report={label,variant,repeat,allocationVcpu:quota,memoryBytes:268435456,readBps:1048576,writeBps:131072,capacityLadder:quota!==.05,...combineMetrics(reader.value,server)};results.push(report);writeFileSync(join(output,label+'.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({label,ok:reader.value.ok,errors:reader.value.errors,p95:reader.value.latencyMs.p95,cpu:server.cpuVcpu,rss:server.maxRssBytes,sql:server.sqlCalls,historyFixtureCalls:server.fixtureProviderHistoryCalls,pass:report.acceptance.pass}));
  }finally{if(started){docker(['stop','-t','15',name]);writeFileSync(join(output,label+'.log'),docker(['logs',name]));docker(['rm',name]);}}
}
for(const variant of ['before','after'])for(let repeat=0;repeat<repeats;repeat++)for(const users of [5,20,50])for(const pattern of ['mixed','shared'])await runCase(variant,repeat,users,pattern);
// Separate capacity evidence: only failures at the original budget justify trying
// a larger quota. This never changes the 0.05 acceptance verdict or before/after comparison.
if(process.env.STOCK_REALISTIC_CAPACITY_LADDER==='true'){
  let unresolved=[20,50].flatMap(users=>['mixed','shared'].map(pattern=>({users,pattern}))).filter(({users,pattern})=>results.some(r=>r.variant==='after'&&r.reader.users===users&&r.reader.pattern===pattern&&!r.acceptance.pass));
  for(const quota of [.10,.20]){
    if(!unresolved.length)break;
    for(const {users,pattern}of unresolved)for(let repeat=0;repeat<repeats;repeat++)await runCase('after',repeat,users,pattern,quota);
    unresolved=unresolved.filter(({users,pattern})=>results.some(r=>r.variant==='after'&&r.allocationVcpu===quota&&r.reader.users===users&&r.reader.pattern===pattern&&!r.acceptance.pass));
  }
}
// Actual sampled stacks are collected separately, never mixed into capacity measurements.
for(const variant of ['before','after']){
  const label=variant+'-profile',dir=join(resolve(disk),label),name=`stocks-profile-${process.pid}`;mkdirSync(dir,{recursive:true,mode:0o777});spawnSync('chmod',['777',dir]);let started=false;
  try{
    docker(['run','-d','--name',name,...bounded(dir,{ports:true,profile:true}),'-e','STOCK_REALISTIC_DB=/data/accounts.sqlite',images[variant]]);started=true;await waitReady('http://127.0.0.1:8092/__stocks_global/health',name);
    const reader=await client('realistic-readers.mjs',[],{STOCK_REALISTIC_URL:'http://127.0.0.1:8092',STOCK_REALISTIC_USERS:'50',STOCK_REALISTIC_PATTERN:'mixed',STOCK_REALISTIC_SECONDS:'18'});
    writeFileSync(join(output,label+'-readers.json'),JSON.stringify(reader.value));
  }finally{if(started){docker(['stop','-t','15',name]);writeFileSync(join(output,label+'.log'),docker(['logs',name]));docker(['rm',name]);}}
  copyFileSync(join(dir,'server.cpuprofile'),join(output,label+'.cpuprofile'));
  const r=spawnSync(process.execPath,[join(here,'profile-summary.mjs'),join(output,label+'.cpuprofile')],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);writeFileSync(join(output,label+'-summary.json'),r.stdout);
}
const minimumTestedAllocation=[5,20,50].flatMap(users=>['mixed','shared'].map(pattern=>{const quotas=[.05,.10,.20].filter(quota=>{const cases=results.filter(r=>r.variant==='after'&&r.allocationVcpu===quota&&r.reader.users===users&&r.reader.pattern===pattern);return cases.length===repeats&&cases.every(r=>r.acceptance.pass);});return{users,pattern,cpuVcpu:quotas[0]??null,memoryBytes:268435456,notes:quotas.length?'Minimum among tested quotas only; not production headroom or an interpolation.':'No passing allocation was confirmed among the tested quotas.'};}));
writeFileSync(join(output,'results.json'),JSON.stringify({fixture:true,results,acceptanceAtOriginalBudget:results.filter(r=>r.variant==='after'&&r.allocationVcpu===.05).every(r=>r.acceptance.pass),minimumTestedAllocation,externalApiCalls:0},null,2));
console.log(JSON.stringify({cases:results.length,minimumTestedAllocation,output}));
