// Opt-in, aggregate-only Linux syscall diagnosis of newly created fixture containers.
// This instrumented workload is never evidence for an uninstrumented capacity PASS.
import { spawn,spawnSync } from 'node:child_process';
import { mkdirSync,readFileSync,writeFileSync,chmodSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const SYSCALLS=Object.freeze(['fsync','fdatasync','pwrite64','pread64','fcntl']);
const here=fileURLToPath(new URL('.',import.meta.url));
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
export function parseStraceSummary(value){
  const rows=[];
  for(const line of value.split(/\r?\n/)){
    const match=line.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(?:(\d+)\s+)?(\w+)$/);
    if(!match)continue;
    const [,percent,seconds,microseconds,calls,errors,name]=match;
    if(name==='total')continue;
    if(!SYSCALLS.includes(name))throw Error('Unexpected syscall in aggregate summary');
    rows.push({syscall:name,wallSeconds:Number(seconds),calls:Number(calls),errors:Number(errors??0),percentOfTracedWallTime:Number(percent),averageMicroseconds:Number(microseconds)});
  }
  if(new Set(rows.map(row=>row.syscall)).size!==rows.length)throw Error('Duplicate syscall in aggregate summary');
  return {rows,totalWallSeconds:rows.reduce((sum,row)=>sum+row.wallSeconds,0),totalCalls:rows.reduce((sum,row)=>sum+row.calls,0),totalErrors:rows.reduce((sum,row)=>sum+row.errors,0)};
}
export function fixtureDockerArgs({name,dir,device,cpu,image}){
  return ['run','-d','--name',name,'--cpus','0.05','--cpuset-cpus',String(cpu),'--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--device-read-bps',`${device}:1048576`,'--device-write-bps',`${device}:131072`,'--mount',`type=bind,src=${dir},dst=/data`,'--network','host','-e','STOCK_REALISTIC_DB=/data/accounts.sqlite',image];
}
function command(binary,args,timeout=120000){
  const result=spawnSync(binary,args,{encoding:'utf8',timeout});
  if(result.error||result.status!==0)throw Object.assign(Error(`${binary} ${args[0]} failed`),{code:binary==='docker'?'DOCKER_COMMAND_FAILED':'HOST_COMMAND_FAILED'});
  return result.stdout.trim();
}
const docker=args=>command('docker',args);
function processWithOutput(binary,args,options={}){
  const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],...options});let stdout='',stderr='',settled=false;
  const done=new Promise(ok=>{
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>4*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});
    child.on('error',error=>{settled=true;ok({code:null,error:error.code,stdout,stderr});});
    child.on('close',code=>{settled=true;ok({code,stdout,stderr});});
  });
  return {child,done,get settled(){return settled;},get stderr(){return stderr;}};
}
async function waitReady(){
  const end=Date.now()+90000;
  while(Date.now()<end){try{if((await fetch('http://127.0.0.1:8092/__stocks_global/health',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await sleep(250);}
  throw Object.assign(Error('Fixture readiness deadline exceeded'),{code:'FIXTURE_NOT_READY'});
}
function tracerPid(pid){
  try{return Number(readFileSync(`/proc/${pid}/status`,'utf8').match(/^TracerPid:\s*(\d+)$/m)?.[1]??0);}catch{return 0;}
}
function attachFailure(stderr){
  if(/Operation not permitted|Permission denied/i.test(stderr))return 'PTRACE_NOT_PERMITTED';
  if(/invalid option.*w|unrecognized option.*w/i.test(stderr))return 'STRACE_WALL_TIME_UNSUPPORTED';
  return 'TRACER_ATTACH_FAILED';
}
async function stopTracer(trace,pid){
  if(!trace)return {flushed:false,reason:'NOT_STARTED'};
  if(!trace.settled&&Number.isSafeInteger(pid)&&pid>1){
    command('sudo',['-n','kill','-INT',String(pid)],5000);
  }
  let result=await Promise.race([trace.done,sleep(10000).then(()=>null)]);
  if(!result){
    if(Number.isSafeInteger(pid)&&pid>1)command('sudo',['-n','kill','-TERM',String(pid)],5000);
    result=await Promise.race([trace.done,sleep(5000).then(()=>null)]);
  }
  return {flushed:!!result,exitCode:result?.code??null,reason:result?null:'TRACER_STOP_TIMEOUT'};
}
export async function main(){
  if(process.env.STOCK_SQLITE_IO_DIAGNOSTIC!=='true')throw Error('Explicit STOCK_SQLITE_IO_DIAGNOSTIC=true required');
  const output=resolve(process.env.STOCK_SQLITE_IO_OUTPUT??'.ci-output/stock-performance/sqlite-io');mkdirSync(output,{recursive:true});
  const results={diagnosticOnly:true,capacityClaim:false,externalApiCalls:0,syscalls:SYSCALLS,limits:{cpuVcpu:.05,memoryBytes:268435456,readBps:1048576,writeBps:131072},workload:{users:20,pattern:'mixed',seconds:30,deadlineMs:3000},cases:[],notes:['Host strace wall time includes kernel waits, not CPU. Threads may overlap; summed syscall wall time can exceed elapsed time.','Aggregate -f -c cannot attribute rows to a particular thread or database. fcntl includes all fcntl uses, not only locking.','Tracing perturbs scheduling. These separate diagnostic runs cannot establish a capacity PASS. No payloads, syscall arguments or individual traces are recorded.']};
  const save=()=>writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));
  if(process.platform!=='linux'){results.unavailable='LINUX_REQUIRED';save();console.log(JSON.stringify(results));return;}
  const disk=process.env.STOCK_REALISTIC_DISK,device=process.env.STOCK_BENCH_DEVICE,cpu=process.env.BENCH_CPU,clientCpu=process.env.LOAD_CPU,images=JSON.parse(process.env.STOCK_REALISTIC_IMAGES??'{}');
  if(!disk||!device||cpu===undefined||clientCpu===undefined||!images.before||!images.after)throw Error('Verified device/CPU placement, disposable disk and exact before/after images required');
  results.images=images;results.cpuPlacement={server:cpu,reader:clientCpu};
  const available=spawnSync('sudo',['-n','strace','-V'],{encoding:'utf8',timeout:5000});
  if(available.error||available.status!==0){results.unavailable='SUDO_OR_STRACE_UNAVAILABLE';save();console.log(JSON.stringify(results));return;}
  results.straceVersion=available.stdout.split(/\r?\n/)[0];
  for(const variant of ['before','after']){
    const id=randomUUID(),name=`stocks-sqlite-io-${id}`,dir=join(resolve(disk),`sqlite-io-${variant}-${id}`),summaryPath=join(output,`${variant}-strace-summary.txt`),pidPath=join(output,`${variant}-${id}-tracer.pid`);
    mkdirSync(dir,{recursive:true,mode:0o777});chmodSync(dir,0o777);
    const report={variant,diagnosticOnly:true,capacityClaim:false,fixtureOnly:true};let started=false,trace=null,pid=null,stopped=false;
    try{
      docker(fixtureDockerArgs({name,dir,device,cpu,image:images[variant]}));started=true;await waitReady();
      const target=Number(docker(['inspect','--format','{{.State.Pid}}',name]));
      if(!Number.isSafeInteger(target)||target<=1)throw Object.assign(Error('Invalid fixture PID'),{code:'INVALID_FIXTURE_PID'});
      if(tracerPid(target))throw Object.assign(Error('Fixture is already traced'),{code:'FIXTURE_ALREADY_TRACED'});
      // Fixed shell source, all paths and arguments passed as argv; shell exec preserves own PID.
      trace=processWithOutput('sudo',['-n','sh','-c','printf "%s\\n" "$$" > "$1"; shift; exec "$@"','sh',pidPath,'strace','-f','-c','-w','-e',`trace=${SYSCALLS.join(',')}`,'-p',String(target),'-o',summaryPath]);
      const attachDeadline=Date.now()+10000;
      while(Date.now()<attachDeadline&&!trace.settled){
        try{pid=Number(readFileSync(pidPath,'utf8').trim());}catch{}
        if(Number.isSafeInteger(pid)&&pid>1&&tracerPid(target)===pid)break;
        await sleep(100);
      }
      if(!pid||tracerPid(target)!==pid)throw Object.assign(Error('Fixture tracer unavailable'),{code:attachFailure(trace.stderr)});
      report.traceStartedAt=new Date().toISOString();
      const reset=await fetch('http://127.0.0.1:8093/reset',{method:'POST',signal:AbortSignal.timeout(10000)});if(!reset.ok)throw Object.assign(Error('Metrics reset failed'),{code:'METRICS_RESET_FAILED'});
      report.readerStartedAt=new Date().toISOString();
      const reader=processWithOutput('taskset',['-c',String(clientCpu),process.execPath,join(here,'realistic-readers.mjs')],{env:{...process.env,STOCK_REALISTIC_URL:'http://127.0.0.1:8092',STOCK_REALISTIC_USERS:'20',STOCK_REALISTIC_PATTERN:'mixed',STOCK_REALISTIC_SECONDS:'30',STOCK_REALISTIC_CADENCE_MS:'2000',STOCK_REALISTIC_MODE:'global',STOCK_REALISTIC_INSTRUMENTS:'20',STOCK_REALISTIC_REQUIRE_PASS:'false'}});
      const response=await Promise.race([reader.done,sleep(45000).then(()=>null)]);
      if(!response){reader.child.kill('SIGTERM');await reader.done;throw Object.assign(Error('Reader exceeded bounded diagnostic duration'),{code:'READER_PROCESS_TIMEOUT'});}
      if(response.code!==0)throw Object.assign(Error('Reader failed'),{code:'READER_FAILED'});
      report.reader=JSON.parse(response.stdout.trim());report.readerEndedAt=new Date().toISOString();
      try{const metrics=await fetch('http://127.0.0.1:8093/metrics',{signal:AbortSignal.timeout(5000)});if(!metrics.ok)throw Error();report.server=await metrics.json();}catch{report.metricsUnavailable='METRICS_DEADLINE_OR_HTTP_ERROR';}
      report.tracer=await stopTracer(trace,pid);stopped=true;report.traceEndedAt=new Date().toISOString();
      if(report.tracer.flushed){report.summary=parseStraceSummary(readFileSync(summaryPath,'utf8'));report.available=report.summary.totalCalls>0;if(!report.available)report.unavailable='NO_MATCHING_SYSCALLS_OBSERVED';}else report.unavailable='TRACER_STOP_TIMEOUT';
    }catch(error){report.unavailable=error.code??'DIAGNOSTIC_RUN_FAILED';}
    finally{
      if(trace&&!stopped){try{report.tracer=await stopTracer(trace,pid);}catch{report.cleanupError='TRACER_CLEANUP_FAILED';}}
      if(started){try{docker(['stop','-t','15',name]);docker(['rm',name]);}catch{report.cleanupError='FIXTURE_CLEANUP_FAILED';}}
      results.cases.push(report);save();console.log(JSON.stringify({variant,available:report.available??false,unavailable:report.unavailable??null,syscalls:report.summary??null}));
    }
    if(report.cleanupError)throw Error(report.cleanupError);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
