'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),os=require('node:os');
// Same runtime as policy-613.cjs; this pin runs the separated release layout: the crypto API alone, the
// Stocks authority (src/stocksAuthority.ts) and the gateway in their own processes, under the same taskset.
// STOCKS_NICE: the release's scheduling control, a lower CPU weight for both Stocks processes than for the
// crypto API (cpu_shares in deploy/stocks-pages-gateway.compose.yaml.example); it adds no CPU to the budget.
// R6 also ran the gateway in Linux's idle scheduling class (STOCKS_SCHED 'gateway-idle'); run 40838996816 showed no
// measurable p95 effect, so the release control is nice 10 / cpu_shares only again (docs/STOCKS_613_PROCESS_ISOLATION.md).
const PUSH_RC='7942c59ddfbf902a6183c397f766bcc8aca8c039';
const RC=process.env.RC50_PUSH_VIEWERS==='1'?PUSH_RC:'47f5d04d70dc0f9d978bd5af31d1a96484c59df2',TOPOLOGY='separated',STOCKS_NICE=10;
// Only --push-viewers sets this env before import. The legacy 50×1s accepted
// runtime source and workload remain pinned to 47f5d0 unchanged.
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=message=>{throw Error(message);};
function loopback(address,protocols=['http:']){
 const u=new URL(address);
 if(!protocols.includes(u.protocol)||u.hostname!=='127.0.0.1'||u.username||u.password||!u.port||Number(u.port)<1024)fail('EXPLICIT_EPHEMERAL_LOOPBACK_REQUIRED');
 return u;
}
function database(address,name){
 const u=new URL(address);
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.password||u.username!=='stocks_fixture'||Number(u.port)<1024||u.pathname!=='/'+name||!/^stocks_disposable_rc50_[a-f0-9]{12}_(qualification|baseline|mixed)$/.test(name))fail('OWN_FRESH_SYNTHETIC_DATABASE_REQUIRED');
 return u;
}
function args(argv){
 const allowed=new Set(['root','pg-bin','out','scope','ack','attestation','run-local','prepare-only']);
 const r={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))fail('UNKNOWN_ARGUMENT');const k=argv[i].slice(2);if(!allowed.has(k)||k in r)fail('UNKNOWN_OR_DUPLICATE_ARGUMENT');r[k]=['run-local','prepare-only'].includes(k)?true:argv[++i];}
 return r;
}
function git(root,...a){return cp.execFileSync('git',['-C',root,...a],{encoding:'utf8',windowsHide:true}).trim();}
function environment(a){
 if(a.ack!=='SYNTHETIC_LOCAL_ONLY')fail('EXPLICIT_SYNTHETIC_ACK_REQUIRED');
 if(!a.root||!a['pg-bin']||!a.out)fail('EXPLICIT_PATHS_REQUIRED');
 if(process.env.DATABASE_URL||process.env.DIRECT_URL||process.env.SHADOW_DATABASE_URL||process.env.STOCKS_DISPOSABLE_PG_URL||process.env.NODE_OPTIONS)fail('AMBIENT_DATABASE_OR_NODE_OPTIONS_DENIED');
 const root=fs.realpathSync(a.root),out=path.join(fs.realpathSync(path.dirname(path.resolve(a.out))),path.basename(a.out)),pgBin=fs.realpathSync(a['pg-bin']);
 if(git(root,'rev-parse',RC)!==RC)fail('RC_OBJECT_MISSING');
 git(root,'merge-base','--is-ancestor',RC,'HEAD');
 const changed=git(root,'diff','--name-only',RC).split(/\r?\n/).filter(Boolean);
 if(changed.some(f=>!f.startsWith('scripts/qa/stocks-rc-50plus2/')&&f!=='docs/AI_HANDOFF.md'))fail('RUNTIME_SOURCE_CHANGED');
 const untracked=git(root,'ls-files','--others','--exclude-standard').split(/\r?\n/).filter(Boolean);
 if(untracked.some(f=>!f.startsWith('scripts/qa/stocks-rc-50plus2/')))fail('UNREVIEWED_UNTRACKED_RUNTIME_FILE');
 if(['.env','prisma/.env'].some(p=>fs.existsSync(path.join(root,p))))fail('PRIVATE_ENV_FILE_PRESENT');
 if(out===root||!out.startsWith(path.dirname(root)+path.sep)||fs.existsSync(out))fail('FRESH_OWNED_OUTPUT_REQUIRED');
 if(a.scope==='local-diagnostic'){if(process.platform!=='win32')fail('WINDOWS_LOCAL_SCOPE_ONLY_USE_LINUX_ATTESTATION');}
 // GitHub-hosted runner, own PostgreSQL and synthetic data: a diagnostic, never acceptance.
 else if(a.scope==='ci-diagnostic'){if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')fail('GITHUB_HOSTED_CI_DIAGNOSTIC_ONLY');}
 else if(a.scope==='isolated-linux'){
  if(process.platform!=='linux'||!a.attestation)fail('EXPLICIT_ISOLATED_LINUX_ATTESTATION_REQUIRED');
  const proof=JSON.parse(fs.readFileSync(a.attestation,'utf8')),cgroup=fs.readFileSync('/proc/self/cgroup','utf8').trim();
  if(proof.approvedIsolatedHost!==true||proof.production!==false||proof.runtimeSha!==RC||proof.hostHash!==sha(os.hostname())||proof.cgroup!==cgroup||proof.resourceIsolationVerified!==true||(!Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=Date.now()||Date.parse(proof.expiresAt)>Date.now()+86400000))fail('LINUX_ISOLATION_NOT_VERIFIED');
   const match=cgroup.match(/^0::(.+)$/m);if(!match||match[1]==='/'||process.getuid?.()===0)fail('OWNED_NONROOT_CGROUP_REQUIRED');
  const cg=path.join('/sys/fs/cgroup',match[1]);
  const cpu=fs.readFileSync(path.join(cg,'cpu.max'),'utf8').trim().split(/\s+/),memory=fs.readFileSync(path.join(cg,'memory.max'),'utf8').trim(),pids=fs.readFileSync(path.join(cg,'pids.max'),'utf8').trim();
  if(cpu[0]==='max'||!(Number(cpu[0])>0)||Number(cpu[0])>2*Number(cpu[1])||!/^\d+$/.test(memory)||Number(memory)>2147483648||!/^\d+$/.test(pids)||Number(pids)>128)fail('FINITE_OWNED_RESOURCES_REQUIRED');
 }else fail('EXPLICIT_NONPRODUCTION_SCOPE_REQUIRED');
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')),versions={};
 for(const n of ['prisma','@prisma/client','ts-node','typescript','express','ws','jsonwebtoken','bignumber.js']){
  const pkg=require(require.resolve(n+'/package.json',{paths:[root]}));versions[n]=pkg.version;
  if(lock.packages['node_modules/'+n]?.version!==pkg.version)fail('LOCKED_DEPENDENCY_MISMATCH_'+n);
 }
 const executable=n=>path.join(pgBin,n+(process.platform==='win32'?'.exe':''));
 for(const n of ['postgres','initdb','pg_ctl','createdb','psql'])if(!fs.statSync(executable(n)).isFile())fail('EXISTING_PORTABLE_PG_REQUIRED');
 const free=fs.statfsSync(path.dirname(out));if(Number(free.bavail)*Number(free.bsize)<1024**3)fail('INSUFFICIENT_LOCAL_DISK_HEADROOM');
 return{root,out,pgBin,executable,versions,scope:a.scope,rc:RC,harnessHead:git(root,'rev-parse','HEAD'),changed,platform:process.platform,node:process.version,nodeSha256:sha(fs.readFileSync(process.execPath)),physicalFocusUsed:false,targetAcceptance:false};
}
function cleanEnv(extra={}){
 const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP','HOME','LANG'])if(process.env[k])env[k]=process.env[k];
 return Object.assign(env,{PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1',TS_NODE_CACHE:'false'},extra);
}
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
function comparison(base,mixed){
 const p95a=percentile(base.cryptoLatencies,.95),p95b=percentile(mixed.cryptoLatencies,.95),delta=p95a>0?(p95b-p95a)/p95a*100:null,failed=[];
 for(const [name,r]of [['baseline',base],['mixed',mixed]]){
  for(const k of ['timeouts','unexpectedErrors','missedJobs','orderLoss','doubleSpend','viewerMutations'])if(r[k]!==0)failed.push(name+':'+k);
  if(r.cryptoLatencies.length<200)failed.push(name+':insufficient_crypto_samples');
 }
 if(base.cryptoJobs!==mixed.cryptoJobs||base.traceSha!==mixed.traceSha)failed.push('UNMATCHED_CRYPTO_TRACE');
 if(mixed.viewerCount!==50||mixed.traderCount!==2)failed.push('POPULATION_MISMATCH');
 if(delta===null||delta>5)failed.push('CRYPTO_P95_OVER_5_PERCENT');
 return{status:failed.length?'FAIL_LOCAL_DIAGNOSTIC':'PASS_LOCAL_DIAGNOSTIC',baselineCryptoP95Ms:p95a,mixedCryptoP95Ms:p95b,cryptoP95ChangePercent:delta,thresholdPercent:5,failures:failed,targetAcceptance:false};
}
module.exports={RC,PUSH_RC,TOPOLOGY,STOCKS_NICE,sha,loopback,database,args,git,environment,cleanEnv,percentile,comparison,fail};
