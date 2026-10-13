// Opt-in diagnostic. It never substitutes for uninstrumented acceptance.
import { spawn,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,chmodSync,realpathSync,statSync,existsSync } from 'node:fs';
import { resolve,join,dirname,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createSocketServer } from 'node:net';
import { instrument,SOURCE_REVISION } from './instrument.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
export const WORKLOAD=Object.freeze({users:50,pattern:'mixed',seconds:30,deadlineMs:3000,cadenceMs:2000,instruments:20});
export function schedule(){return [['pristine','off','on'],['off','on','pristine'],['on','pristine','off']].flatMap((modes,repeat)=>modes.map(mode=>({repeat,mode,on:mode==='on'}))).map((entry,index)=>({...entry,index}));}
export function validateBounds(v){if(v.cpuMax.trim()!=='5000 100000'||Number(v.memoryMax)!==268435456||!v.ioMax.split('\n').some(l=>/rbps=1048576/.test(l)&&/wbps=131072/.test(l)))throw Error('DIAGNOSTIC_ORIGINAL_LIMITS_UNVERIFIED');}
export function validateDeviceAncestry(mountedMajorMinor,rows,ancestors,configured){const backing=rows.find(([,number])=>number===mountedMajorMinor)?.[0];if(!backing||!ancestors.includes(backing)||!ancestors.includes(configured))throw Error('BLOCK_DEVICE_MISMATCH');return backing;}
const json=(p,value)=>writeFileSync(p,JSON.stringify(value,null,2)+'\n');
const cleanEnv=()=>Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
function command(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:cleanEnv(),...options});if(r.status!==0||r.error)throw Error('DIAGNOSTIC_TOOL_FAILED '+bin+' '+args[0]+' '+(r.error?.code??r.status)+' '+String(r.stderr).slice(-2000));return r.stdout.trim();}
const docker=args=>command('docker',args);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cgroupPath(pid){if(!Number.isSafeInteger(pid)||pid<=0)throw Error('DIAGNOSTIC_CONTAINER_PID_INVALID');const membership=readFileSync('/proc/'+pid+'/cgroup','utf8').split('\n').find(line=>line.startsWith('0::'))?.slice(3);if(!membership?.startsWith('/'))throw Error('DIAGNOSTIC_CGROUP_V2_UNAVAILABLE');const path=resolve('/sys/fs/cgroup','.'+membership);if(!path.startsWith('/sys/fs/cgroup/'))throw Error('DIAGNOSTIC_CGROUP_PATH_INVALID');return path;}
async function portsFree(){for(const port of [8092,8093])await new Promise((ok,fail)=>{const server=createSocketServer();server.once('error',()=>fail(Error('DIAGNOSTIC_PORT_OCCUPIED '+port)));server.listen(port,'127.0.0.1',()=>server.close(ok));});}
async function ready(){for(let n=0;n<120;n++){try{const r=await fetch('http://127.0.0.1:8093/metrics',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await sleep(250);}throw Error('DIAGNOSTIC_START_FAILED');}
async function readMetrics(){const r=await fetch('http://127.0.0.1:8093/metrics',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('DIAGNOSTIC_METRICS_FAILED');return r.json();}
function reader(cpu,source){return new Promise((ok,fail)=>{const child=spawn('taskset',['-c',cpu,process.execPath,join(source,'services/stocks/realistic-readers.mjs')],{env:{...cleanEnv(),STOCK_REALISTIC_URL:'http://127.0.0.1:8092',STOCK_REALISTIC_USERS:'50',STOCK_REALISTIC_PATTERN:'mixed',STOCK_REALISTIC_SECONDS:'30'},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');fail(Error('DIAGNOSTIC_READER_WATCHDOG'));},90000);child.stdout.on('data',b=>{out+=b;if(out.length>1048576)child.kill('SIGKILL');});child.stderr.on('data',b=>{err+=b;if(err.length>1048576)child.kill('SIGKILL');});child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);if(code!==0)return fail(Error('DIAGNOSTIC_READER_FAILED '+code+' '+err.slice(-2000)));try{ok({value:JSON.parse(out),stderr:err});}catch(e){fail(e);}});});}
export async function main(){
 if(process.platform!=='linux'||process.version!=='v24.21.0'||process.env.STOCKS_PHASE_512_APPROVED!=='true')throw Error('DISPOSABLE_LINUX_NODE24_21_DIAGNOSTIC_APPROVAL_REQUIRED');
 const disk=process.env.STOCK_REALISTIC_DISK,device=process.env.STOCK_BENCH_DEVICE,cpu=process.env.BENCH_CPU,client=process.env.LOAD_CPU;
 if(!disk||!device||!/^\d+$/.test(cpu??'')||!/^\d+$/.test(client??'')||cpu===client)throw Error('VERIFIED_DISK_AND_SEPARATE_CLIENT_CPU_REQUIRED');
 if(!isAbsolute(disk)||!isAbsolute(device))throw Error('ABSOLUTE_DISK_AND_DEVICE_REQUIRED');
 const diskPath=realpathSync(disk);if(diskPath==='/'||!statSync(diskPath).isDirectory())throw Error('DISPOSABLE_DISK_REQUIRED');
 if(!statSync(device).isBlockDevice())throw Error('BLOCK_DEVICE_REQUIRED');
 const mounted=command('findmnt',['-n','-o','MAJ:MIN','-T',diskPath]);
 const rows=command('lsblk',['-nrpo','NAME,MAJ:MIN']).split('\n').map(line=>line.trim().split(/\s+/));
 const backing=rows.find(([,number])=>number===mounted)?.[0];if(!backing)throw Error('MOUNT_BLOCK_DEVICE_UNAVAILABLE');
 const ancestors=command('lsblk',['-snrpo','NAME',backing]).split('\n').map(path=>realpathSync(path.trim()));
 validateDeviceAncestry(mounted,rows.map(([path,number])=>[realpathSync(path),number]),ancestors,realpathSync(device));
 command('taskset',['-pc',client,String(process.pid)]);
 const output=resolve(process.env.STOCKS_PHASE_512_OUT??join(root,'output/phase-trace-512'));if(existsSync(join(output,'results.json')))throw Error('DIAGNOSTIC_OUTPUT_ALREADY_EXISTS');mkdirSync(output,{recursive:true});
 const base=mkdtempSync(join(diskPath,'phase512-')),source=join(base,'source'),shadow=join(base,'shadow');mkdirSync(source);
 command('git',['archive','--format=tar','--output='+join(base,'source.tar'),SOURCE_REVISION,'services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});
 command('tar',['-xf',join(base,'source.tar'),'-C',source]);const manifest=instrument(source,shadow);json(join(output,'source-manifest.json'),manifest);
 const image='stocks-phase512-'+process.pid,pristineImage=image+'-pristine';
 for(const [label,directory,tag] of [['shadow',shadow,image],['pristine',source,pristineImage]])writeFileSync(join(output,'build-'+label+'.log'),docker(['build','--network','none','-f',join(directory,'services/stocks/realistic.Dockerfile'),'-t',tag,directory])+'\n');
 const bounded=dir=>['--cpus','.05','--cpuset-cpus',cpu,'--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--device-read-bps',device+':1048576','--device-write-bps',device+':131072','--mount','type=bind,src='+dir+',dst=/data'];
 const probe=join(base,'io-proof');mkdirSync(probe);chmodSync(probe,0o777);
 const proof=JSON.parse(docker(['run','--rm',...bounded(probe),'--network','none',image,'node','io-proof.mjs']));validateBounds(proof);json(join(output,'io-proof.json'),proof);
 const report={sourceRevision:SOURCE_REVISION,diagnosticOnly:true,acceptance:false,workload:WORKLOAD,limits:{cpu:'.05',memoryBytes:268435456,readBps:1048576,writeBps:131072},clientPlacement:{cpu:client,separateFromServiceCpu:true,quota:'unthrottled load generator outside service cgroup'},schedule:schedule(),runs:[],notes:['Pristine controls execute the exact unmodified06a archive. OFF/ON share the same transformed archive.','Pristine→OFF measures wrapper overhead; OFF→ON recorder overhead; pristine→ON total instrumentation overhead.','Sampled thread CPU is not process CPU and nested phases overlap. Do not sum phases or subtract sampled worker wall from unmatched roundtrip totals.','Existing server CPU covers worker thread. Do not add worker CPU again.','Response latency success-only and all-attempt values are retained separately.','Cgroup memory.peak is read by the host without entering the service cgroup; maxRssBytes is 250ms sampled process RSS.','Disk I/O counts are kernel cgroup counters; exact fsync syscalls/latencies remain N/A.']};
 report.deviceProof={mountedMajorMinor:mounted,backingDevice:backing,configuredDevice:realpathSync(device),ancestors};
 report.runs=schedule().map(entry=>({...entry,status:'INCOMPLETE',completed:false,reason:'Not started'}));report.complete=false;json(join(output,'results.json'),report);
 let active;
 try{for(const entry of schedule()){
  const dir=join(base,'r'+entry.index);mkdirSync(dir);chmodSync(dir,0o777);active='stocks-phase512-'+process.pid+'-'+entry.index;
  const row=report.runs[entry.index];row.status='RUNNING';delete row.reason;json(join(output,'results.json'),report);
  try{
   await portsFree();
   docker(['run','-d','--name',active,...bounded(dir),'--network','host','-e','STOCK_REALISTIC_DB=/data/accounts.sqlite','-e','STOCKS_PHASE_512='+Number(entry.on),'-e','STOCKS_PHASE_512_FIXTURE=isolated-issue505',entry.mode==='pristine'?pristineImage:image]);await ready();
   const group=cgroupPath(Number(docker(['inspect','--format','{{.State.Pid}}',active])));
   const initial=await readMetrics();validateBounds(initial);row.initial=initial;
   const reset=await fetch('http://127.0.0.1:8093/reset',{method:'POST',signal:AbortSignal.timeout(5000)});if(!reset.ok)throw Error('DIAGNOSTIC_RESET_FAILED');
   const measured=await reader(client,source);row.reader=measured.value;row.readerStderr=measured.stderr;row.server=await readMetrics();
   if(row.reader.externalApiCalls!==0||row.server.externalApiCalls!==0)throw Error('EXTERNAL_CALL_IN_DIAGNOSTIC');
   validateBounds(row.server);
   row.cgroup={memoryPeak:Number(readFileSync(join(group,'memory.peak'),'utf8')),memoryEvents:readFileSync(join(group,'memory.events'),'utf8')};
   if(!Number.isFinite(row.cgroup.memoryPeak)||row.cgroup.memoryPeak<=0)throw Error('DIAGNOSTIC_MEMORY_PEAK_UNAVAILABLE');
   row.completed=true;row.status='COMPLETE';
  }catch(error){row.completed=false;row.status='INCOMPLETE';row.error=String(error.message);throw error;}
  finally{if(active){try{row.containerLogs=docker(['logs',active]);}catch(e){row.logCollectionError=String(e.message);}try{docker(['rm','-f',active]);active=undefined;}catch(e){row.cleanupError=String(e.message);}}json(join(output,'r'+entry.index+'.json'),row);json(join(output,'results.json'),report);}
  console.log(JSON.stringify({repeat:entry.repeat,mode:entry.mode,errors:row.reader.errors,cpuMs:row.server.cpuMs,requests:row.reader.requests}));
  if(active)throw Error('DIAGNOSTIC_CONTAINER_CLEANUP_FAILED');
 }}catch(error){report.error=String(error.stack??error);}
 finally{if(active){try{docker(['rm','-f',active]);active=undefined;}catch(error){report.finalCleanupError=String(error.message);}}json(join(output,'results.json'),report);}
 if(report.error||report.finalCleanupError)throw Error(report.error??report.finalCleanupError);
 report.complete=report.runs.every(row=>row.completed);
 report.overhead=Array.from({length:3},(_,repeat)=>[['pristine','off'],['off','on'],['pristine','on']].map(([from,to])=>{const a=report.runs.find(r=>r.repeat===repeat&&r.mode===from),b=report.runs.find(r=>r.repeat===repeat&&r.mode===to),pct=(x,y)=>x?100*(y/x-1):null;return {repeat,from,to,beforeErrors:a.reader.errors,afterErrors:b.reader.errors,cpuPerAttemptPct:pct(a.server.cpuMs/a.reader.requests,b.server.cpuMs/b.reader.requests),throughputPct:pct(a.reader.requestsPerSecond,b.reader.requestsPerSecond),successP95Pct:pct(a.reader.latencyMs.p95,b.reader.latencyMs.p95),allAttemptP95Pct:pct(a.reader.allAttemptLatencyMs.p95,b.reader.allAttemptLatencyMs.p95),memoryPeakPct:pct(a.cgroup.memoryPeak,b.cgroup.memoryPeak)};})).flat();
 json(join(output,'results.json'),report);json(join(output,'receipt.json'),{resultsSha256:createHash('sha256').update(readFileSync(join(output,'results.json'))).digest('hex'),sourceRevision:SOURCE_REVISION});
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
