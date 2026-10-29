'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),net=require('node:net'),crypto=require('node:crypto');
// #613 pins: both policies pin the same runtime; policy-613.cjs runs it as one process (crypto API, Stocks
// authority, gateway and synthetic market together), --after selects policy-613-after.cjs, the separated
// release layout (crypto API alone; Stocks authority and gateway in their own processes, same taskset).
const AFTER=process.argv.includes('--after');
// --revised-8s: the order cycle every 8 s instead of the original 4 s (driver.cjs WORKLOAD), labelled as a diagnostic.
if(process.argv.includes('--revised-8s'))process.env.RC50_REVISED_8S='1';
const {RC,TOPOLOGY,STOCKS_NICE=0,STOCKS_SCHED='',sha,args,environment,cleanEnv,comparison,database}=require(AFTER?'./policy-613-after.cjs':'./policy-613.cjs'),{PLAN,WORKLOAD,traceSha,window,invariants}=require('./driver.cjs');
// --cpu-prof: V8 CPU profile of each measured API worker. Profiler overhead
// applies to both arms; such a run locates hotspots and is never a p95 verdict.
const PROFILE=process.argv.includes('--cpu-prof');
// --spans: the existing server-side spans (spans.cjs) in BOTH measured arms, so
// auth, Prisma/transaction, authority queue, GC and event-loop time can be told
// apart. Instrumentation overhead applies to both arms; never a p95 verdict.
const SPANS=process.argv.includes('--spans');
// --pg-profile (separated pin only): PostgreSQL logs every lock wait over 1 ms with its holder, every statement
// over 2 ms, connections (each process names its connections: rc50_crypto_api, rc50_stocks_authority),
// checkpoints and autovacuum; WAL/IO timing is on and pg_stat_wal/pg_stat_database are read around each measured
// window. pg-profile-613.cjs then says what overlapped the slow crypto requests. Logging costs both arms; never a
// p95 verdict.
const PG_PROFILE=process.argv.includes('--pg-profile');
const PG_PROFILE_OPTIONS=" -c log_lock_waits=on -c deadlock_timeout=1ms -c log_min_duration_statement=2 -c log_parameter_max_length=0 -c log_connections=on -c log_checkpoints=on -c log_autovacuum_min_duration=0 -c track_wal_io_timing=on -c track_io_timing=on -c log_line_prefix='%m [%p] %a '";
// --driver-apart (experiment, report only): the server side (PostgreSQL, the crypto API and the Stocks processes)
// on CPUs 0,1 and this process, the load driver standing in for the 50 viewers' and 2 traders' own devices, on two
// other CPUs (the workflow starts it under taskset -c 2,3). Same plan otherwise; it measures how much of the mixed
// arm's p95 comes from the clients sharing the server's two vCPUs, which production clients do not.
const DRIVER_APART=process.argv.includes('--driver-apart'),SERVER_CPUS='0,1';
// --stocks-apart (separated pin only; experiment, report only, never a verdict): both Stocks processes on CPUs 2,3,
// apart from the crypto API, PostgreSQL and the driver on 0,1, to show how much of the mixed arm's p95 is the Stocks
// processes' CPU on the crypto API's core. With --driver-apart as well, only the crypto API and PostgreSQL stay on 0,1
// (the driver and both Stocks processes share 2,3). Not run by the workflow since R7; R6's results are in the docs.
const STOCKS_APART=process.argv.includes('--stocks-apart'),STOCKS_CPUS='2,3',SCHED=STOCKS_SCHED;
const a=args(process.argv.slice(2).filter(x=>x!=='--cpu-prof'&&x!=='--after'&&x!=='--spans'&&x!=='--pg-profile'&&x!=='--driver-apart'&&x!=='--revised-8s'&&x!=='--stocks-apart'));
let cfg,started=false,data,active,controller=new AbortController(),timer;
const report={startedAt:new Date().toISOString(),runtimeSourceSha:RC,topology:TOPOLOGY,stocksNice:STOCKS_NICE,stocksSched:SCHED,status:'ADMISSION',scope:a.scope,targetAcceptance:false,fullWorkloadRuns:0,newProductionChanges:0,containersStarted:0,ownPids:[],failures:[]};
const json=(name,value)=>fs.writeFileSync(path.join(cfg.out,name),JSON.stringify(value,null,2));
function pg(name,argv,label){
 // --driver-apart: the server (postmaster, and so every backend it forks) is pinned to the server CPUs.
 const [file,list]=DRIVER_APART&&name==='pg_ctl'&&argv[0]==='start'?['taskset',['-c',SERVER_CPUS,cfg.executable(name),...argv]]:[cfg.executable(name),argv];
 const r=cp.spawnSync(file,list,{encoding:'utf8',windowsHide:true,timeout:20000,env:cleanEnv(),maxBuffer:1024*1024});
 fs.writeFileSync(path.join(cfg.out,label+'.log'),(r.stdout||'')+(r.stderr||''));
 if(r.status!==0)throw Error(label+'_FAILED_'+r.status);
 return(r.stdout||'').trim();
}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});}
function startWorker(arm,viewerCount,generatedClient){
 const dbName='stocks_disposable_rc50_'+report.nonce+'_'+arm,dbUrl='postgresql://stocks_fixture@127.0.0.1:'+report.pgPort+'/'+dbName+'?connection_limit=8&pool_timeout=3'+(PG_PROFILE?'&application_name=rc50_crypto_api':'');
 database(dbUrl,dbName);
 const stdout=fs.openSync(path.join(cfg.out,arm+'-worker.stdout.log'),'w'),stderr=fs.openSync(path.join(cfg.out,arm+'-worker.stderr.log'),'w');
 const child=cp.fork(path.join(__dirname,'api-worker.cjs'),[],{cwd:cfg.root,env:cleanEnv({RC50_RUN_ROOT:cfg.out,NODE_PATH:path.join(cfg.root,'node_modules')}),execArgv:['--max-old-space-size=384','--require',path.join(__dirname,'network-guard.cjs'),...(PROFILE&&arm!=='qualification'?['--cpu-prof','--cpu-prof-dir',path.join(cfg.out,'profiles',arm)]:[])],windowsHide:true,detached:process.platform!=='win32',stdio:['ignore',stdout,stderr,'ipc']});
 fs.closeSync(stdout);fs.closeSync(stderr);report.ownPids.push({role:arm+'-api',pid:child.pid});
 // --driver-apart: the API worker (all its threads) on the server CPUs before init; the Stocks processes it forks inherit them.
 if(DRIVER_APART)cp.execFileSync('taskset',['-a','-p','-c',SERVER_CPUS,String(child.pid)],{stdio:'ignore'});
 let next=0;const waiting=new Map();
 child.on('message',m=>{const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.value);});
 child.on('exit',code=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('API_WORKER_EXIT_'+code));}waiting.clear();});
 const rpc=(command,value)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{waiting.delete(id);reject(Error('API_WORKER_RPC_TIMEOUT_'+command));},command==='init'?60000:15000);waiting.set(id,{resolve,reject,timer});child.send({id,command,value},error=>{if(error){clearTimeout(timer);waiting.delete(id);reject(error);}});});
 const close=async()=>{
  if(child.exitCode===null){
   try{await rpc('close');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timeout=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});}catch{}
   if(child.exitCode===null){if(process.platform==='win32')cp.spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else try{process.kill(-child.pid,'SIGTERM');}catch{}}
  }
 };
 const init=async()=>{
  const info=await rpc('init',{root:cfg.root,runRoot:cfg.out,generatedClient,dbName,dbUrl,viewerCount,diagnostics:SPANS&&arm!=='qualification',topology:TOPOLOGY,stocksNice:STOCKS_NICE,stocksSched:SCHED,...(STOCKS_APART?{stocksCpus:STOCKS_CPUS}:{}),arm});
  // Every process of the topology is recorded (cleanup must confirm each) and must be the one the pin names.
  const p=info.processes??{},pids=Object.values(p);
  for(const [role,pid] of Object.entries(p))if(role!=='api')report.ownPids.push({role:arm+'-'+role,pid});
  if(info.topology!==TOPOLOGY||p.api!==child.pid||new Set(pids).size!==pids.length||pids.length!==(TOPOLOGY==='separated'?3:1))throw Error('TOPOLOGY_MISMATCH_'+arm);
  return info;
 };
 return{child,rpc,close,init};
}
// Report only, never a gate: CPU of this process (the load driver: crypto, viewer and trader clients) and of
// the whole PostgreSQL cluster (postmaster, live backends, reaped children), read around each measured window
// like the workers' 'metrics'. /proc on Linux; postgres is null elsewhere.
const {performance:perf,monitorEventLoopDelay}=require('node:perf_hooks'),driverDelay=monitorEventLoopDelay({resolution:10});driverDelay.enable();
let clockTicks;
function hostMetrics(){
 const sched=require('./sched.cjs');
 const ms=x=>x/1e6,driver={cpu:process.cpuUsage(),memory:process.memoryUsage(),elu:perf.eventLoopUtilization(),delay:{p50Ms:ms(driverDelay.percentile(50)),p99Ms:ms(driverDelay.percentile(99)),maxMs:ms(driverDelay.max)},sched:sched.read()};driverDelay.reset();
 let postgres=null;const master=report.ownPids.find(p=>p.role==='postgres')?.pid;
 if(process.platform==='linux'&&master)try{
  clockTicks??=Number(cp.execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim())||100;
  // Fields after the command name: [1] ppid, [11..14] utime, stime, cutime, cstime in clock ticks.
  const stat=pid=>{const t=fs.readFileSync('/proc/'+pid+'/stat','utf8');return t.slice(t.lastIndexOf(')')+2).split(' ');};
  const own=stat(master);let ticks=+own[11]+ +own[12]+ +own[13]+ +own[14],processes=1;
  // Per backend: CPU and runnable-but-waiting time (schedstat), so a profile can tell the crypto API's backends
  // from the Stocks authority's (pg-profile-613.cjs maps the pids through the connection log).
  const backends={[master]:sched.read(master)};
  for(const name of fs.readdirSync('/proc'))if(/^\d+$/.test(name)&&+name!==master)try{const f=stat(name);if(+f[1]===master){ticks+=+f[11]+ +f[12];processes++;backends[name]=sched.read(name);}}catch{}
  postgres={cpuMs:ticks*1000/clockTicks,processes,backends};
 }catch{postgres=null;}
 return{driver,postgres};
}
// --pg-profile only: cluster WAL counters (incl. sync time) and this arm's database counters, read with psql.
function pgStats(arm){
 const db='stocks_disposable_rc50_'+report.nonce+'_'+arm;
 const q="SELECT json_build_object('at',clock_timestamp(),'wal',(SELECT row_to_json(w) FROM pg_stat_wal w),'database',(SELECT row_to_json(d) FROM (SELECT xact_commit,xact_rollback,blks_read,blks_hit,blk_read_time,blk_write_time,deadlocks,conflicts FROM pg_stat_database WHERE datname='"+db+"') d),'bgwriter',(SELECT row_to_json(b) FROM pg_stat_bgwriter b))";
 return JSON.parse(pg('psql',['-X','-A','-t','-h','127.0.0.1','-p',String(report.pgPort),'-U','stocks_fixture','-d','postgres','-v','ON_ERROR_STOP=1','-c',q],'pg-stats-'+arm));
}
function provenance(){
 const selected=['prisma/schema.prisma','package-lock.json','src/stocksAuthority.ts','services/stocks-global/server.mjs','services/stocks-global/postgres-authority.mjs','services/stocks-global/engine.mjs','services/stocks-global/testing/disposable-postgres.cjs','services/stocks-global/testing/synthetic-public-market.mjs','src/services/DemoTradingService.ts','src/api/routes/demoTrading.ts','src/api/routes/stocksTestCash.ts'];
 report.runtimeFiles=selected.map(file=>({file,sha256:sha(fs.readFileSync(path.join(cfg.root,file)))}));
 report.harnessFiles=fs.readdirSync(__dirname).filter(n=>/\.(cjs|sh|json)$/.test(n)).sort().map(file=>({file,sha256:sha(fs.readFileSync(path.join(__dirname,file)))}));
 report.runtimeAndHarnessManifestSha=sha(JSON.stringify({runtime:report.runtimeFiles,harness:report.harnessFiles,node:cfg.nodeSha256,plan:PLAN,traceSha}));
}
(async()=>{
 try{
  if([SPANS,PROFILE,PG_PROFILE,DRIVER_APART||STOCKS_APART].filter(Boolean).length>1)throw Error('ONE_INSTRUMENTATION_PER_RUN');
  if(STOCKS_APART&&TOPOLOGY!=='separated')throw Error('STOCKS_EXPERIMENT_NEEDS_SEPARATED_PROCESSES');
  if(STOCKS_APART&&require('node:os').cpus().length<4)throw Error('STOCKS_APART_NEEDS_4_CPUS');
  if(DRIVER_APART){
   const own=(fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\S+)/m)||[])[1]??'';
   if(own.split(',').flatMap(r=>{const [x,y=x]=r.split('-').map(Number);return Array.from({length:y-x+1},(_,i)=>x+i);}).some(n=>SERVER_CPUS.split(',').map(Number).includes(n)))throw Error('DRIVER_MUST_RUN_APART_FROM_SERVER_CPUS');
  }
  if(PG_PROFILE&&TOPOLOGY!=='separated')throw Error('PG_PROFILE_NEEDS_SEPARATED_PROCESSES');
  cfg=environment(a);fs.mkdirSync(cfg.out);report.nonce=crypto.randomBytes(6).toString('hex');
  report.admission={scope:cfg.scope,platform:cfg.platform,node:cfg.node,nodeSha256:cfg.nodeSha256,harnessHead:cfg.harnessHead,dependencyVersions:cfg.versions,physicalFocusUsed:false,productionAccess:false,externalNetworkAllowed:false,heapLimitMb:384,resources:'Same sequential worker shape and PostgreSQL cluster/settings; Windows shared host is unpinned and not CX23 acceptance'};
  // Report only: the CPUs this process tree may use, their SMT siblings and the model (Linux sysfs/procfs).
  if(process.platform==='linux')try{
   const allowed=(fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\S+)/m)||[])[1]??'';
   const cpus=allowed.split(',').filter(Boolean).flatMap(range=>{const [a,b=a]=range.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i);});
   report.cpu={allowed,siblings:Object.fromEntries(cpus.map(n=>[n,fs.readFileSync('/sys/devices/system/cpu/cpu'+n+'/topology/thread_siblings_list','utf8').trim()])),model:(fs.readFileSync('/proc/cpuinfo','utf8').match(/^model name\s*:\s*(.+)$/m)||[])[1]??null};
  }catch{report.cpu=null;}
  report.workload=WORKLOAD;report.profiled=PROFILE;report.spans=SPANS;report.pgProfile=PG_PROFILE;report.driverApart=DRIVER_APART?{serverCpus:SERVER_CPUS,driverCpus:report.cpu?.allowed??null,hostCpus:require('node:os').cpus().length}:false;report.stocksApart=STOCKS_APART?{stocksCpus:STOCKS_CPUS,driverCpus:report.cpu?.allowed??null,hostCpus:require('node:os').cpus().length}:false;report.plan=PLAN;report.cryptoTraceSha=traceSha;provenance();json('admission.json',report);
  if(a['prepare-only']){report.status='PREPARED_NOT_RUN';return;}
  if(!a['run-local'])throw Error('EXPLICIT_RUN_LOCAL_FLAG_REQUIRED');
  timer=setTimeout(()=>controller.abort(Error('HARD_DEADLINE_180S')),180000);
  const privateDir=path.join(cfg.out,'private');fs.mkdirSync(privateDir);data=path.join(privateDir,'pgdata');
  fs.writeFileSync(path.join(privateDir,'owner.json'),JSON.stringify({nonce:report.nonce,runtimeSha:RC,syntheticOnly:true}));
  report.postgresBinarySha256=sha(fs.readFileSync(cfg.executable('postgres')));
  report.postgresVersion=pg('postgres',['--version'],'pg-version');
  report.pgPort=await port();pg('initdb',['-D',data,'-U','stocks_fixture','-A','trust','--encoding=UTF8','--no-locale'],'pg-init');
  const options='-h 127.0.0.1 -p '+report.pgPort+' -c fsync=on -c full_page_writes=on -c synchronous_commit=on -c shared_buffers=32MB -c max_connections=64 -c statement_timeout=5000'+(PG_PROFILE?PG_PROFILE_OPTIONS:'');
  pg('pg_ctl',['start','-w','-t','15','-D',data,'-l',path.join(privateDir,'postgres.log'),'-o',options],'pg-start');started=true;
  report.ownPids.push({role:'postgres',pid:Number(fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split('\n')[0])});
  const durability=pg('psql',['-X','-A','-t','-h','127.0.0.1','-p',String(report.pgPort),'-U','stocks_fixture','-d','postgres','-v','ON_ERROR_STOP=1','-c',"SELECT current_setting('fsync'),current_setting('full_page_writes'),current_setting('synchronous_commit')"],'pg-durability');
  if(durability!=='on|on|on')throw Error('DURABILITY_MUST_REMAIN_ON');report.postgresDurability=durability;
  for(const arm of ['qualification','baseline','mixed'])pg('createdb',['-h','127.0.0.1','-p',String(report.pgPort),'-U','stocks_fixture','stocks_disposable_rc50_'+report.nonce+'_'+arm],'pg-create-'+arm);
  const gen=path.join(privateDir,'generated-client'),schema=path.join(privateDir,'schema.prisma');
  const raw=fs.readFileSync(path.join(cfg.root,'prisma/schema.prisma'),'utf8');
  const rewritten=raw.replace(/generator client\s*\{/, 'generator client {\n  output = '+JSON.stringify(gen.replaceAll('\\','/')));
  if(rewritten===raw)throw Error('GENERATOR_OUTPUT_REWRITE_FAILED');
  fs.writeFileSync(schema,rewritten);
  const generate=cp.spawnSync(process.execPath,['--require',path.join(__dirname,'network-guard.cjs'),path.join(cfg.root,'node_modules/prisma/build/index.js'),'generate','--schema',schema],{cwd:cfg.root,env:cleanEnv({RC50_RUN_ROOT:cfg.out,NODE_PATH:path.join(cfg.root,'node_modules')}),windowsHide:true,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(cfg.out,'client-generation.log'),(generate.stdout||'')+(generate.stderr||''));
  if(generate.status!==0)throw Error('OWN_CLIENT_GENERATION_FAILED');
  report.generatedClient={sourceSchemaSha256:sha(Buffer.from(raw)),generatedSchemaSha256:sha(fs.readFileSync(path.join(gen,'schema.prisma'))),files:fs.readdirSync(gen).filter(n=>/index\.js$|\.node$/.test(n)).map(file=>({file,sha256:sha(fs.readFileSync(path.join(gen,file)))}))};
  report.status='QUALIFICATION';
  active=startWorker('qualification',1,gen);await active.init();report.qualification=await active.rpc('qualify');await active.close();active=null;json('qualification.json',report.qualification);
  if(controller.signal.aborted)throw Error('DEADLINE_BEFORE_WORKLOAD');
  // This persistent claim is created only AFTER actual-API wiring qualification.
  const claim=path.join(path.dirname(cfg.out),'FINAL-50PLUS2-RUN-CLAIM.json');
  fs.writeFileSync(claim,JSON.stringify({at:new Date().toISOString(),nonce:report.nonce,runtimeSha:RC,manifestSha:report.runtimeAndHarnessManifestSha,cryptoTraceSha:traceSha,scope:cfg.scope}),{flag:'wx'});
  report.fullWorkloadRuns=1;report.status='WORKLOAD_STARTED';json('run-progress.json',report);
  const arms={};
  for(const name of ['baseline','mixed']){
   active=startWorker(name,50,gen);const info=await active.init();
   const warmup=await window(info,{arm:name,warmup:true,signal:controller.signal});json(name+'-warmup.json',warmup);
   if(warmup.timeouts||warmup.unexpectedErrors||warmup.missedJobs)throw Error('WARMUP_FAILED_'+name);
   await active.rpc('timings');
   const before=await active.rpc('snapshot'),metricsBefore=await active.rpc('metrics'),hostBefore=hostMetrics();
   if(SPANS)await active.rpc('spans-start');
   const pgBefore=PG_PROFILE?pgStats(name):null;
   const result=await window(info,{arm:name,mixed:name==='mixed',signal:controller.signal});
   if(SPANS)json(name+'-spans.json',await active.rpc('spans-stop'));
   // Backends publish their statistics within about a second; read after that, still before any other work.
   if(PG_PROFILE){await new Promise(resolve=>setTimeout(resolve,1500));json(name+'-pg-stats.json',{before:pgBefore,after:pgStats(name),windowStartedAt:result.startedAt,windowFinishedAt:result.finishedAt});}
   const hostAfter=hostMetrics(),after=await active.rpc('snapshot'),metricsAfter=await active.rpc('metrics'),serverTimings=await active.rpc('timings');
   const financial=invariants(before,after,result.expected);Object.assign(result,financial);
   result.initialLogicalStateSha=info.initial.logicalStateSha;result.metrics={before:metricsBefore,after:metricsAfter,host:{before:hostBefore,after:hostAfter}};result.serverTimings=serverTimings;result.application=info.implementation;
   if(metricsAfter.network?.blocked)throw Error('EGRESS_ATTEMPT_DETECTED');
   json(name+'-result.json',result);json(name+'-financial.json',{before,after,invariants:financial});arms[name]=result;
   await active.close();active=null;
   if(result.timeouts||result.unexpectedErrors||result.missedJobs||result.orderLoss||result.doubleSpend||result.viewerMutations)throw Error('ARM_INVARIANT_FAILED_'+name);
  }
  if(arms.baseline.initialLogicalStateSha!==arms.mixed.initialLogicalStateSha)throw Error('UNMATCHED_INITIAL_LOGICAL_DATA');
  report.comparison=comparison(arms.baseline,arms.mixed);report.status=report.comparison.status;
  if(PROFILE){report.comparison.profiled=true;report.status='PROFILE_ONLY_NOT_A_P95_VERDICT';}
  if(SPANS){report.comparison.spans=true;report.status='SPANS_ONLY_NOT_A_P95_VERDICT';}
  if(PG_PROFILE){report.comparison.pgProfile=true;report.status='PG_PROFILE_ONLY_NOT_A_P95_VERDICT';}
  json('comparison.json',report.comparison);
  if(report.status!=='PASS_LOCAL_DIAGNOSTIC'&&!PROFILE&&!SPANS&&!PG_PROFILE)process.exitCode=1;
 }catch(e){
  report.status=report.fullWorkloadRuns?'FAIL_OR_INCOMPLETE_LOCAL_DIAGNOSTIC':'QUALIFICATION_OR_ADMISSION_FAILED_NOT_RUN';
  report.failures.push(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[synthetic-database]'));process.exitCode=1;
 }finally{
  if(timer)clearTimeout(timer);
  if(active)await active.close();
  if(cfg&&data&&fs.existsSync(path.join(data,'postmaster.pid'))){
   try{pg('pg_ctl',['stop','-w','-t','10','-m','fast','-D',data],'pg-final-stop');started=false;report.postgresStopped=true;}catch(e){report.cleanupError=e.message;process.exitCode=1;}
  }
  if(cfg&&data){const s=cp.spawnSync(cfg.executable('pg_ctl'),['status','-D',data],{encoding:'utf8',windowsHide:true,timeout:10000,env:cleanEnv()});report.postgresStatusExit=s.status;}
  // The server log only (synthetic statements without parameters); never the data directory.
  if(PG_PROFILE&&cfg&&data)try{fs.copyFileSync(path.join(path.dirname(data),'postgres.log'),path.join(cfg.out,'postgres-profile.log'));}catch(e){report.pgProfileLogError=e.code??'COPY_FAILED';}
  report.allRecordedPidsStopped=report.ownPids.every(x=>{try{process.kill(x.pid,0);return false;}catch{return true;}});
  report.finishedAt=new Date().toISOString();report.targetAcceptance=false;report.productionReadiness='NOT_VERIFIED';
  if(cfg&&fs.existsSync(cfg.out))json('result.json',report);
  console.log(JSON.stringify({status:report.status,fullWorkloadRuns:report.fullWorkloadRuns,comparison:report.comparison,failures:report.failures,allRecordedPidsStopped:report.allRecordedPidsStopped,targetAcceptance:false}));
 }
})();
