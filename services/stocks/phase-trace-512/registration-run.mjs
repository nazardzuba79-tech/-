// Six matched baseline/candidate diagnostics. Original acceptance remains unchanged.
import { spawn,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,chmodSync,realpathSync,statSync,existsSync,readdirSync } from 'node:fs';
import { resolve,join,dirname,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createSocketServer } from 'node:net';
import { install,SOURCE_REVISION } from './timeline-install.mjs';
import { reconcile } from './timeline-analysis.mjs';
import { prepareCandidate } from './registration-source.mjs';
import { WORKLOAD,validateBounds,validateDeviceAncestry } from './run.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
export function schedule(){return [['baseline','candidate'],['candidate','baseline'],['baseline','candidate']].flatMap((modes,repeat)=>modes.map(mode=>({repeat,mode}))).map((entry,index)=>({...entry,index}));}
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const cleanEnv=()=>Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
function command(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:cleanEnv(),...options});if(r.status!==0||r.error)throw Error('TIMELINE_TOOL_FAILED '+bin+' '+args[0]+' '+(r.error?.code??r.status)+' '+String(r.stderr).slice(-2000));return r.stdout.trim();}
const docker=args=>command('docker',args);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
function cgroupPath(pid){if(!Number.isSafeInteger(pid)||pid<=0)throw Error('TIMELINE_CONTAINER_PID_INVALID');const membership=readFileSync('/proc/'+pid+'/cgroup','utf8').split('\n').find(line=>line.startsWith('0::'))?.slice(3);if(!membership?.startsWith('/'))throw Error('TIMELINE_CGROUP_V2_UNAVAILABLE');const path=resolve('/sys/fs/cgroup','.'+membership);if(!path.startsWith('/sys/fs/cgroup/'))throw Error('TIMELINE_CGROUP_PATH_INVALID');return path;}
async function portsFree(){for(const port of [8092,8093])await new Promise((done,fail)=>{const server=createSocketServer();server.once('error',()=>fail(Error('TIMELINE_PORT_OCCUPIED '+port)));server.listen(port,'127.0.0.1',()=>server.close(done));});}
async function ready(){for(let n=0;n<120;n++){try{const r=await fetch('http://127.0.0.1:8093/metrics',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await sleep(250);}throw Error('TIMELINE_START_FAILED');}
async function readMetrics(){const r=await fetch('http://127.0.0.1:8093/metrics',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('TIMELINE_METRICS_FAILED');return r.json();}
function reader(cpu,clientSource){return new Promise((done,fail)=>{
 const child=spawn('taskset',['-c',cpu,process.execPath,join(clientSource,'services/stocks/realistic-readers.mjs')],{env:{...cleanEnv(),STOCK_REALISTIC_URL:'http://127.0.0.1:8092',STOCK_REALISTIC_USERS:'50',STOCK_REALISTIC_PATTERN:'mixed',STOCK_REALISTIC_SECONDS:'30',STOCKS_TIMELINE_512:'1',STOCKS_TIMELINE_512_FIXTURE:'isolated-issue505'},stdio:['ignore','pipe','pipe']});
 let out='',err='',settled=false;const reject=error=>{if(settled)return;settled=true;clearTimeout(timer);fail(error);};
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('TIMELINE_READER_WATCHDOG'));},90000);
 child.stdout.on('data',b=>{out+=b;if(out.length>1048576){child.kill('SIGKILL');reject(Error('TIMELINE_READER_OUTPUT_BOUND'));}});
 child.stderr.on('data',b=>{err+=b;if(err.length>1048576){child.kill('SIGKILL');reject(Error('TIMELINE_READER_STDERR_BOUND'));}});
 child.once('error',reject);child.once('close',code=>{if(settled)return;if(code!==0)return reject(Error('TIMELINE_READER_FAILED '+code+' '+err.slice(-2000)));try{const value=JSON.parse(out);settled=true;clearTimeout(timer);done({value,stderr:err});}catch(error){reject(error);}});
 });}
export async function main(){
 if(process.platform!=='linux'||process.version!=='v24.21.0'||process.env.STOCKS_REGISTRATION_512_APPROVED!=='true')throw Error('DISPOSABLE_LINUX_NODE24_21_TIMELINE_APPROVAL_REQUIRED');
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
 const output=resolve(process.env.STOCKS_REGISTRATION_512_OUT??join(root,'output/registration-512'));if(existsSync(output)&&readdirSync(output).length)throw Error('TIMELINE_OUTPUT_NOT_EMPTY');mkdirSync(output,{recursive:true});
 const candidateRevision=process.env.STOCKS_REGISTRATION_CANDIDATE_SHA;
 if(!/^[a-f0-9]{40}$/.test(candidateRevision??'')||command('git',['rev-parse','HEAD'],{cwd:root})!==candidateRevision)throw Error('REGISTRATION_EXACT_CHECKED_OUT_CANDIDATE_REQUIRED');
 const base=mkdtempSync(join(diskPath,'registration512-')),source=join(base,'source'),clientSource=join(base,'client'),candidateTree=join(base,'candidate-tree'),candidateSource=join(base,'candidate-service');mkdirSync(source);mkdirSync(candidateTree);
 command('git',['archive','--format=tar','--output='+join(base,'source.tar'),SOURCE_REVISION,'services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});
 command('tar',['-xf',join(base,'source.tar'),'-C',source]);
 const manifest=install(source,clientSource);json(join(output,'client-source-manifest.json'),manifest);
 command('git',['archive','--format=tar','--output='+join(base,'candidate.tar'),candidateRevision,'services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});
 command('tar',['-xf',join(base,'candidate.tar'),'-C',candidateTree]);
 const candidateManifest=prepareCandidate(source,candidateTree,candidateSource,candidateRevision);json(join(output,'candidate-source-manifest.json'),candidateManifest);
 const image='stocks-registration512-'+process.pid+'-baseline',candidateImage='stocks-registration512-'+process.pid+'-candidate';
 // Neither service image includes the instrumented client or added diagnostics.
 for(const [label,directory,tag] of [['baseline',source,image],['candidate',candidateSource,candidateImage]])writeFileSync(join(output,'build-'+label+'.log'),docker(['build','--network','none','-f',join(directory,'services/stocks/realistic.Dockerfile'),'-t',tag,directory])+'\n');
 const bounded=dir=>['--cpus','.05','--cpuset-cpus',cpu,'--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--device-read-bps',device+':1048576','--device-write-bps',device+':131072','--mount','type=bind,src='+dir+',dst=/data'];
 const probe=join(base,'io-proof');mkdirSync(probe);chmodSync(probe,0o777);
 const proof=JSON.parse(docker(['run','--rm',...bounded(probe),'--network','none',image,'node','io-proof.mjs']));validateBounds(proof);json(join(output,'io-proof.json'),proof);
 const report={sourceRevision:SOURCE_REVISION,candidateRevision,diagnosticOnly:true,acceptance:false,serviceSources:{baseline:'exact06a',candidate:'exact06a plus one reviewed account-worker.mjs replacement'},workload:WORKLOAD,limits:{cpu:'.05',memoryBytes:268435456,readBps:1048576,writeBps:131072},clientPlacement:{cpu:client,separateFromServiceCpu:true,quota:'unthrottled load generator outside service cgroup'},schedule:schedule(),deviceProof:{mountedMajorMinor:mounted,backingDevice:backing,configuredDevice:realpathSync(device),ancestors},notes:['Baseline service uses exact06a; candidate changes one reviewed runtime file only. Both use the same bounded client capture.','Original financial code, deadlines, limits, provider budgets and acceptance remain unchanged. No phase wrappers or recorder run in either service cgroup.','Timeline capture is bounded and every row must reconcile with the unchanged original aggregate counters; overflow/incomplete capture is FAIL.','Client capture overhead is unmeasured; placement outside the service cgroup does not imply zero observer effect.','Start and end bins establish temporal distribution, not registration/SQL causality.','Workload errors are retained as FAIL independently of diagnostic collection completeness. Existing nine-run and three-run timeline artifacts are not replaced.','Cgroup memory.peak is host-read; sampled process RSS is a different metric. SQL COMMIT wall is not actual fsync latency.']};
 report.runs=schedule().map(entry=>({...entry,status:'INCOMPLETE',completed:false,reason:'Not started'}));report.complete=false;report.captureComplete=false;json(join(output,'results.json'),report);
 let active;
 try{for(const entry of schedule()){
  const dir=join(base,'r'+entry.index);mkdirSync(dir);chmodSync(dir,0o777);active='stocks-registration512-'+process.pid+'-'+entry.index;
  const row=report.runs[entry.index];row.status='RUNNING';delete row.reason;json(join(output,'results.json'),report);
  try{
   await portsFree();
   docker(['run','-d','--name',active,...bounded(dir),'--network','host','-e','STOCK_REALISTIC_DB=/data/accounts.sqlite',entry.mode==='baseline'?image:candidateImage]);await ready();
   const group=cgroupPath(Number(docker(['inspect','--format','{{.State.Pid}}',active])));
   const initial=await readMetrics();validateBounds(initial);row.initial=initial;
   const reset=await fetch('http://127.0.0.1:8093/reset',{method:'POST',signal:AbortSignal.timeout(5000)});if(!reset.ok)throw Error('TIMELINE_RESET_FAILED');
   const measured=await reader(client,clientSource);row.reader=measured.value;row.readerStderr=measured.stderr;row.server=await readMetrics();
   if(row.reader.externalApiCalls!==0||row.server.externalApiCalls!==0)throw Error('EXTERNAL_CALL_IN_DIAGNOSTIC');
   validateBounds(row.server);row.reconciliation=reconcile(row.reader);
   row.cgroup={memoryPeak:Number(readFileSync(join(group,'memory.peak'),'utf8')),memoryEvents:readFileSync(join(group,'memory.events'),'utf8')};
   if(!Number.isFinite(row.cgroup.memoryPeak)||row.cgroup.memoryPeak<=0)throw Error('TIMELINE_MEMORY_PEAK_UNAVAILABLE');
   row.codeRevision=entry.mode==='baseline'?SOURCE_REVISION:candidateRevision;row.workloadAcceptance=row.reader.errors===0?'PASS':'FAIL';row.completed=true;row.status=row.reconciliation.pass?'COMPLETE':'CAPTURE_FAIL';
  }catch(error){row.completed=false;row.status='INCOMPLETE';row.error=String(error.message);throw error;}
  finally{if(active){try{row.containerLogs=docker(['logs',active]);}catch(error){row.logCollectionError=String(error.message);}try{docker(['rm','-f',active]);active=undefined;}catch(error){row.cleanupError=String(error.message);}}json(join(output,'r'+entry.index+'.json'),row);json(join(output,'results.json'),report);}
  console.log(JSON.stringify({repeat:entry.repeat,status:row.status,workloadAcceptance:row.workloadAcceptance,errors:row.reader.errors,cpuMs:row.server.cpuMs,requests:row.reader.requests}));
  if(active)throw Error('TIMELINE_CONTAINER_CLEANUP_FAILED');
 }}catch(error){report.error=String(error.stack??error);}
 finally{if(active){try{docker(['rm','-f',active]);active=undefined;}catch(error){report.finalCleanupError=String(error.message);}}json(join(output,'results.json'),report);}
 report.complete=report.runs.every(row=>row.completed);report.captureComplete=report.complete&&report.runs.every(row=>row.reconciliation?.pass);report.workloadAcceptance=report.complete&&report.runs.every(row=>row.workloadAcceptance==='PASS')?'PASS':'FAIL';
 if(report.complete)report.pairs=Array.from({length:3},(_,repeat)=>{const modes=Object.fromEntries(['baseline','candidate'].map(mode=>{const row=report.runs.find(r=>r.repeat===repeat&&r.mode===mode),t=row.reader.requestTimeline.rows;return[mode,{requests:row.reader.requests,errors:row.reader.errors,first50Errors:t.slice(0,50).filter(r=>r[5]===2).length,laterErrors:t.slice(50).filter(r=>r[5]===2).length,startedAfter3sErrors:t.filter(r=>r[1]>=3000&&r[5]===2).length,cpuMs:row.server.cpuMs,memoryPeak:row.cgroup.memoryPeak,latencyMs:row.reader.latencyMs,allAttemptLatencyMs:row.reader.allAttemptLatencyMs,explicitCommitCalls:row.server.sqlStages.commit?.calls??0,registrationGroups:row.server.accountQueue.registrationGroups,groupedRegistrations:row.server.accountQueue.groupedRegistrations,sqlWriteCalls:row.server.sqlWriteCalls,ioInitial:row.server.initial.ioStat,ioFinal:row.server.final.ioStat,workloadAcceptance:row.workloadAcceptance}];}));return{repeat,...modes};});
 json(join(output,'results.json'),report);json(join(output,'receipt.json'),{resultsSha256:createHash('sha256').update(readFileSync(join(output,'results.json'))).digest('hex'),sourceRevision:SOURCE_REVISION,candidateRevision});
 if(report.error||report.finalCleanupError)throw Error(report.error??report.finalCleanupError);
 if(!report.captureComplete)throw Error('TIMELINE_CAPTURE_FAIL');
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
