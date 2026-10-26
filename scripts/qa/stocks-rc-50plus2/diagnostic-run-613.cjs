'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),net=require('node:net'),crypto=require('node:crypto');
// #613 candidate pins: policy-613.cjs is the reviewed head before the session-read
// optimization, --after selects policy-613-after.cjs.
const AFTER=process.argv.includes('--after');
const {RC,sha,args,environment,cleanEnv,comparison,database}=require(AFTER?'./policy-613-after.cjs':'./policy-613.cjs'),{PLAN,traceSha,window,invariants}=require('./driver.cjs');
// --cpu-prof: V8 CPU profile of each measured API worker. Profiler overhead
// applies to both arms; such a run locates hotspots and is never a p95 verdict.
const PROFILE=process.argv.includes('--cpu-prof');
// --spans: the existing server-side spans (spans.cjs) in BOTH measured arms, so
// auth, Prisma/transaction, authority queue, GC and event-loop time can be told
// apart. Instrumentation overhead applies to both arms; never a p95 verdict.
const SPANS=process.argv.includes('--spans');
const a=args(process.argv.slice(2).filter(x=>x!=='--cpu-prof'&&x!=='--after'&&x!=='--spans'));
let cfg,started=false,data,active,controller=new AbortController(),timer;
const report={startedAt:new Date().toISOString(),runtimeSourceSha:RC,status:'ADMISSION',scope:a.scope,targetAcceptance:false,fullWorkloadRuns:0,newProductionChanges:0,containersStarted:0,ownPids:[],failures:[]};
const json=(name,value)=>fs.writeFileSync(path.join(cfg.out,name),JSON.stringify(value,null,2));
function pg(name,argv,label){
 const r=cp.spawnSync(cfg.executable(name),argv,{encoding:'utf8',windowsHide:true,timeout:20000,env:cleanEnv(),maxBuffer:1024*1024});
 fs.writeFileSync(path.join(cfg.out,label+'.log'),(r.stdout||'')+(r.stderr||''));
 if(r.status!==0)throw Error(label+'_FAILED_'+r.status);
 return(r.stdout||'').trim();
}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});}
function startWorker(arm,viewerCount,generatedClient){
 const dbName='stocks_disposable_rc50_'+report.nonce+'_'+arm,dbUrl='postgresql://stocks_fixture@127.0.0.1:'+report.pgPort+'/'+dbName+'?connection_limit=8&pool_timeout=3';
 database(dbUrl,dbName);
 const stdout=fs.openSync(path.join(cfg.out,arm+'-worker.stdout.log'),'w'),stderr=fs.openSync(path.join(cfg.out,arm+'-worker.stderr.log'),'w');
 const child=cp.fork(path.join(__dirname,'api-worker.cjs'),[],{cwd:cfg.root,env:cleanEnv({RC50_RUN_ROOT:cfg.out,NODE_PATH:path.join(cfg.root,'node_modules')}),execArgv:['--max-old-space-size=384','--require',path.join(__dirname,'network-guard.cjs'),...(PROFILE&&arm!=='qualification'?['--cpu-prof','--cpu-prof-dir',path.join(cfg.out,'profiles',arm)]:[])],windowsHide:true,detached:process.platform!=='win32',stdio:['ignore',stdout,stderr,'ipc']});
 fs.closeSync(stdout);fs.closeSync(stderr);report.ownPids.push({role:arm+'-api',pid:child.pid});
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
 return{child,rpc,close,init:()=>rpc('init',{root:cfg.root,runRoot:cfg.out,generatedClient,dbName,dbUrl,viewerCount,diagnostics:SPANS&&arm!=='qualification'})};
}
function provenance(){
 const selected=['prisma/schema.prisma','package-lock.json','services/stocks-global/server.mjs','services/stocks-global/postgres-authority.mjs','services/stocks-global/engine.mjs','services/stocks-global/testing/disposable-postgres.cjs','services/stocks-global/testing/synthetic-public-market.mjs','src/services/DemoTradingService.ts','src/api/routes/demoTrading.ts','src/api/routes/stocksTestCash.ts'];
 report.runtimeFiles=selected.map(file=>({file,sha256:sha(fs.readFileSync(path.join(cfg.root,file)))}));
 report.harnessFiles=fs.readdirSync(__dirname).filter(n=>/\.(cjs|sh|json)$/.test(n)).sort().map(file=>({file,sha256:sha(fs.readFileSync(path.join(__dirname,file)))}));
 report.runtimeAndHarnessManifestSha=sha(JSON.stringify({runtime:report.runtimeFiles,harness:report.harnessFiles,node:cfg.nodeSha256,plan:PLAN,traceSha}));
}
(async()=>{
 try{
  if(SPANS&&PROFILE)throw Error('ONE_INSTRUMENTATION_PER_RUN');
  cfg=environment(a);fs.mkdirSync(cfg.out);report.nonce=crypto.randomBytes(6).toString('hex');
  report.admission={scope:cfg.scope,platform:cfg.platform,node:cfg.node,nodeSha256:cfg.nodeSha256,harnessHead:cfg.harnessHead,dependencyVersions:cfg.versions,physicalFocusUsed:false,productionAccess:false,externalNetworkAllowed:false,heapLimitMb:384,resources:'Same sequential worker shape and PostgreSQL cluster/settings; Windows shared host is unpinned and not CX23 acceptance'};
  report.profiled=PROFILE;report.spans=SPANS;report.plan=PLAN;report.cryptoTraceSha=traceSha;provenance();json('admission.json',report);
  if(a['prepare-only']){report.status='PREPARED_NOT_RUN';return;}
  if(!a['run-local'])throw Error('EXPLICIT_RUN_LOCAL_FLAG_REQUIRED');
  timer=setTimeout(()=>controller.abort(Error('HARD_DEADLINE_180S')),180000);
  const privateDir=path.join(cfg.out,'private');fs.mkdirSync(privateDir);data=path.join(privateDir,'pgdata');
  fs.writeFileSync(path.join(privateDir,'owner.json'),JSON.stringify({nonce:report.nonce,runtimeSha:RC,syntheticOnly:true}));
  report.postgresBinarySha256=sha(fs.readFileSync(cfg.executable('postgres')));
  report.postgresVersion=pg('postgres',['--version'],'pg-version');
  report.pgPort=await port();pg('initdb',['-D',data,'-U','stocks_fixture','-A','trust','--encoding=UTF8','--no-locale'],'pg-init');
  const options='-h 127.0.0.1 -p '+report.pgPort+' -c fsync=on -c full_page_writes=on -c synchronous_commit=on -c shared_buffers=32MB -c max_connections=64 -c statement_timeout=5000';
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
   const before=await active.rpc('snapshot'),metricsBefore=await active.rpc('metrics');
   if(SPANS)await active.rpc('spans-start');
   const result=await window(info,{arm:name,mixed:name==='mixed',signal:controller.signal});
   if(SPANS)json(name+'-spans.json',await active.rpc('spans-stop'));
   const after=await active.rpc('snapshot'),metricsAfter=await active.rpc('metrics');
   const financial=invariants(before,after,result.expected);Object.assign(result,financial);
   result.initialLogicalStateSha=info.initial.logicalStateSha;result.metrics={before:metricsBefore,after:metricsAfter};result.application=info.implementation;
   if(metricsAfter.network?.blocked)throw Error('EGRESS_ATTEMPT_DETECTED');
   json(name+'-result.json',result);json(name+'-financial.json',{before,after,invariants:financial});arms[name]=result;
   await active.close();active=null;
   if(result.timeouts||result.unexpectedErrors||result.missedJobs||result.orderLoss||result.doubleSpend||result.viewerMutations)throw Error('ARM_INVARIANT_FAILED_'+name);
  }
  if(arms.baseline.initialLogicalStateSha!==arms.mixed.initialLogicalStateSha)throw Error('UNMATCHED_INITIAL_LOGICAL_DATA');
  report.comparison=comparison(arms.baseline,arms.mixed);report.status=report.comparison.status;
  if(PROFILE){report.comparison.profiled=true;report.status='PROFILE_ONLY_NOT_A_P95_VERDICT';}
  if(SPANS){report.comparison.spans=true;report.status='SPANS_ONLY_NOT_A_P95_VERDICT';}
  json('comparison.json',report.comparison);
  if(report.status!=='PASS_LOCAL_DIAGNOSTIC'&&!PROFILE&&!SPANS)process.exitCode=1;
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
  report.allRecordedPidsStopped=report.ownPids.every(x=>{try{process.kill(x.pid,0);return false;}catch{return true;}});
  report.finishedAt=new Date().toISOString();report.targetAcceptance=false;report.productionReadiness='NOT_VERIFIED';
  if(cfg&&fs.existsSync(cfg.out))json('result.json',report);
  console.log(JSON.stringify({status:report.status,fullWorkloadRuns:report.fullWorkloadRuns,comparison:report.comparison,failures:report.failures,allRecordedPidsStopped:report.allRecordedPidsStopped,targetAcceptance:false}));
 }
})();
