'use strict';
// One owner-authorized isolated Stage-A run. No production inputs, remote Docker or feeds.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {BASE,APP,OVERLAY,git,verify}=require('./provenance.cjs');
const {createDiagnostics}=require('../stocks-pg-tls-98c577d4/diagnostics.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.resolve(process.env.STAGE_A_OUT||'output/stocks-stage-a');
fs.mkdirSync(OUT,{recursive:true});
const secrets=[],owned=[],cleanups=[],report={result:'NOT_RUN',production:false,stages:[],images:{},performance:'NOT_RUN'};
const diagnostic=createDiagnostics({secrets,write:line=>{fs.appendFileSync(path.join(OUT,'diagnostics.jsonl'),line+'\n');console.log(line);}});
const {docker,command,waitFor,redact}=diagnostic;
const NODE='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const PG='postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let work,network,transport,bridge,api,gateway,pg;
const stage=(name,data={})=>{report.stages.push({name,result:'PASS',...data});console.log(JSON.stringify({stage:name,result:'PASS',...data}));};
function runContainer(name,args){owned.push(name);return docker(['run','-d','--name',name,...args]);}
function envFile(name,data){const f=path.join(work,name+'.env');fs.writeFileSync(f,Object.entries(data).map(([k,v])=>{assert.ok(!/[\r\n]/.test(String(v)));return k+'='+v;}).join('\n')+'\n',{mode:0o600});return f;}
function fixture(mode){return JSON.parse(docker(['run','--rm','--network',network,'--mount','type=bind,src='+work+',dst=/fixture,readonly','--entrypoint','node',report.images.api.tag,'/fixture/fixture.cjs',mode],{timeout:120000}));}
function processCount(){return require('./process-count.cjs').count(docker(['top',api,'-eo','pid,args']));}
async function main(){
  assert.equal(process.platform,'linux');assert.equal(process.versions.node,'22.23.3');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.ImageOS,'ubuntu24');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
  assert.ok(!process.env.DOCKER_HOST&&!process.env.DOCKER_CONTEXT);assert.equal(docker(['context','show']),'default');
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  assert.equal(event.action,'labeled');assert.equal(event.label.name,'stocks-stage-a-20261024-checked');assert.equal(event.repository.private,false);
  assert.equal(event.pull_request.number,613);assert.equal(event.pull_request.draft,true);assert.equal(event.pull_request.head.repo.full_name,'nazardzuba79-tech/-');assert.equal(event.pull_request.head.ref,'claude/voltex-mobile-audit-7rpjni-stocks-consolidated');
  const head=git(ROOT,'rev-parse','HEAD').toString().trim();assert.equal(head,event.pull_request.head.sha);report.head=head;
  report.provenance=verify(ROOT);report.runner={node:process.version,cpu:os.cpus().length,ramBytes:os.totalmem(),freeBytes:os.freemem(),docker:docker(['version','--format','{{.Server.Version}}'])};
  assert.ok(os.freemem()>3*1024**3,'INSUFFICIENT_FREE_RUNNER_RAM');
  stage('exact-head-overlay-source-integrity');
  work=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-stage-a-'));fs.chmodSync(work,0o755);
  const source=path.join(work,'approved-app');command('git',['clone','--shared','--no-checkout',ROOT,source]);command('git',['-c','core.autocrlf=false','checkout','--detach',APP],{cwd:source});
  const prepared=path.join(work,'prepared');const receipt=require('../../scripts/qa/stocks-build-only-prepare.cjs').prepare(source,prepared,APP);report.sql={historical:receipt.rows.length,pending:receipt.pending.length,executed:false,strictGate:receipt.packageResult.status};
  const overlay=path.join(work,'overlay');command('git',['clone','--shared','--no-checkout',ROOT,overlay]);command('git',['-c','core.autocrlf=false','checkout','--detach',OVERLAY],{cwd:overlay});
  fs.cpSync(path.join(prepared,'context/stocks-release-migrations'),path.join(overlay,'stocks-release-migrations'),{recursive:true});
  const context=path.join(work,'context');require('../stocks-private-pg-tls/image-context.cjs').stage(overlay,context);
  fs.mkdirSync(path.join(context,'scripts'),{recursive:true});fs.writeFileSync(path.join(context,'scripts/start-render-single-service.cjs'),git(ROOT,'show',BASE+':scripts/start-render-single-service.cjs'));
  fs.copyFileSync(path.join(__dirname,'runtime-bootstrap.cjs'),path.join(context,'fixture-bootstrap.cjs'));
  const recipe=fs.readFileSync(path.join(context,'services/stocks-global/Dockerfile.release'),'utf8')
    .replace('USER node','COPY scripts/start-render-single-service.cjs ./scripts/start-render-single-service.cjs\nCOPY fixture-bootstrap.cjs /opt/operations/runtime-bootstrap.cjs\nUSER node')
    .replace('CMD ["node", "dist/index.js"]','ENTRYPOINT ["node", "/opt/operations/runtime-bootstrap.cjs"]');
  fs.writeFileSync(path.join(context,'Dockerfile.stage-a'),recipe);fs.writeFileSync(path.join(OUT,'Dockerfile.stage-a'),recipe);
  const id=process.env.GITHUB_RUN_ID;assert.match(id,/^\d+$/);
  // Reuse completed green image builds; a harness-only correction must not rebuild the application.
  const archive=path.resolve('output/stocks-stage-a-build/candidate-images.tar.gz');
  const archiveHash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(archive))archiveHash.update(bytes);
  assert.equal(archiveHash.digest('hex'),'1dd9c1fa44d6b7e63e8065e68a1f67219895db3d76c60423a53f405aafc64d6b');
  docker(['load','-i',archive],{timeout:180000});
  const imageIds={api:'sha256:8feb54c5466d073e368d53f0ea3d536240dadaa90f4e4a40a6b59698edf57357',gateway:'sha256:0bd2bb8ce10a38a6dc26ba5041351317552cd06c3d1625054a157980b4c59da0'};
  for(const target of ['api','gateway']){
    const tag='stocks-stage-a-'+target+':40090062852';
    const inspect=JSON.parse(docker(['image','inspect',tag]))[0];report.images[target]={tag,id:inspect.Id,repoDigests:inspect.RepoDigests,source:OVERLAY,stocksSource:APP};
    assert.equal(inspect.Id,imageIds[target]);
    assert.equal(inspect.Config.Labels['org.opencontainers.image.revision'],OVERLAY);
    fs.writeFileSync(path.join(OUT,'image-'+target+'.json'),JSON.stringify({Id:inspect.Id,RepoDigests:inspect.RepoDigests,Architecture:inspect.Architecture,Os:inspect.Os,source:inspect.Config.Labels['org.opencontainers.image.revision']},null,2));
  }
  // Images contain code only; all random fixture credentials are mounted later.
  fs.copyFileSync(archive,path.join(OUT,'candidate-images.tar.gz'));
  stage('verified-immutable-images-reused-no-rebuild',{...report.images,buildRun:40090062852,archiveSha256:'1dd9c1fa44d6b7e63e8065e68a1f67219895db3d76c60423a53f405aafc64d6b'});
  const password=crypto.randomBytes(24).toString('hex'),jwt=crypto.randomBytes(32).toString('hex'),key=crypto.randomBytes(32).toString('hex');secrets.push(password,jwt,key);
  const users=['stage_a_alpha','stage_a_beta'],principals=users.map(subject=>({issuer:'stage-a-isolated',subject}));
  const url='postgresql://neondb_owner:'+password+'@db:5432/voltex_stage?schema=public';secrets.push(url);
  const cfg={fixture:'stocks-stage-a-disposable',runId:id,url,password,users};fs.writeFileSync(path.join(work,'config.json'),JSON.stringify(cfg));
  fs.copyFileSync(path.join(__dirname,'fixture.cjs'),path.join(work,'fixture.cjs'));fs.copyFileSync(path.join(__dirname,'net-boundary.cjs'),path.join(work,'net-boundary.cjs'));
  const configuration={JWT_SECRET:jwt,API_KEY_ENCRYPTION_SECRET:crypto.randomBytes(32).toString('hex'),EMAIL_VERIFICATION_SECRET:crypto.randomBytes(32).toString('hex'),REGISTRATION_OPEN:'false',DEPOSIT_WATCHER_SCHEDULE:'off',ALLOWED_ORIGINS:'https://app.example.invalid',STOCKS_CATALOGUE_ENABLED:'true',STOCKS_TEST_CASH_ENABLED:'false',STOCKS_ORDER_EXECUTION_ENABLED:'false',STOCKS_IDENTITY_ISSUER:'stage-a-isolated',STOCKS_TEST_CASH_GATEWAY_KEY:key,STOCKS_TRADE_PRINCIPALS:JSON.stringify(principals)};
  secrets.push(configuration.API_KEY_ENCRYPTION_SECRET,configuration.EMAIL_VERIFICATION_SECRET);
  fs.writeFileSync(path.join(work,'production_config'),JSON.stringify(configuration));fs.writeFileSync(path.join(work,'database_password'),password);fs.writeFileSync(path.join(work,'cutover-marker'),'isolated fixture only');
  // Mounted secrets are generated HERE, never from environment/repository/production.
  for(const f of ['config.json','production_config','database_password','cutover-marker','net-boundary.cjs','fixture.cjs'])fs.chmodSync(path.join(work,f),0o644);
  network='stocks-stage-a-'+id;docker(['network','create','--internal',network]);
  // Mirror production's database + API transport split. The transport bridge
  // permits host-loopback publishing, with all container forwarding denied.
  transport=network+'-transport';docker(['network','create',transport]);
  const transportInfo=JSON.parse(docker(['network','inspect',transport]))[0];bridge='br-'+transportInfo.Id.slice(0,12);
  command('sudo',['iptables','-I','DOCKER-USER','-i',bridge,'-j','DROP']);
  pg='stocks-stage-a-pg-'+id;api='stocks-stage-a-api-'+id;gateway='stocks-stage-a-gateway-'+id;
  runContainer(pg,['--network',network,'--network-alias','db','--cpus','0.25','--memory','512m','--env-file',envFile('pg',{POSTGRES_USER:'neondb_owner',POSTGRES_PASSWORD:password,POSTGRES_DB:'voltex_stage'}),PG]);
  await waitFor(pg,()=>require('./pg-ready.cjs').ready(docker,pg));
  const before=fixture('setup');report.before=before;
  const pgIP=JSON.parse(docker(['inspect',pg]))[0].NetworkSettings.Networks[network].IPAddress;
  const apiEnv=envFile('api',{VOLTEX_RUNTIME_MODE:'production',VOLTEX_RELEASE_SHA:OVERLAY,NODE_OPTIONS:'--require /fixture/net-boundary.cjs',STAGE_A_PG_IP:pgIP});
  stage('isolation-attested-before-start',{databaseNetworkInternal:true,transportBridgeEgressDrop:true,ephemeralPgOnly:true,fixtureUsers:2,productionSecrets:false,paidResources:false,externalEgress:'owned Docker bridge DOCKER-USER DROP + inherited Node socket/DNS fence',dbName:'voltex_stage (fresh fixture, fixed by actual bootstrap)',runtimeMode:'production inside isolated CI only'});
  owned.push(api);
  docker(['create','--name',api,'--network',transport,'--cpus','0.50','--memory','1536m','--pids-limit','128','-p','127.0.0.1:13020:3000','--env-file',apiEnv,'--mount','type=bind,src='+work+',dst=/fixture,readonly','--mount','type=bind,src='+path.join(work,'production_config')+',dst=/run/secrets/production_config,readonly','--mount','type=bind,src='+path.join(work,'database_password')+',dst=/run/secrets/database_password,readonly','--mount','type=bind,src='+path.join(work,'cutover-marker')+',dst=/run/voltex-cutover-authorized,readonly',report.images.api.tag]);
  docker(['network','connect',network,api]);docker(['start',api]);
  const actual=JSON.parse(docker(['inspect',api]))[0];
  report.isolatedTopology={ports:actual.NetworkSettings.Ports,networks:Object.keys(actual.NetworkSettings.Networks),outboundDropBridge:bridge};
  assert.deepEqual(actual.NetworkSettings.Ports['3000/tcp'],[{HostIp:'127.0.0.1',HostPort:'13020'}]);
  try{await waitFor(api,()=>{try{const r=command('curl',['--silent','--show-error','--max-time','3','--fail','http://127.0.0.1:13020/health']);report.health=JSON.parse(r);return true;}catch{return false;}},90000);}catch(e){
    const inside=cp.spawnSync('docker',['exec',api,'node','-e',"fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(3000)}).then(async r=>console.log(r.status,await r.text())).catch(e=>{console.error(e.code||e.name);process.exitCode=1;})"],{encoding:'utf8',timeout:10000});
    report.internalHealthDiagnostic={status:inside.status,stdout:redact(inside.stdout),stderr:redact(inside.stderr)};throw e;
  }
  assert.equal(JSON.stringify(report.health).includes(OVERLAY),true,'actual bootstrap release identity');
  report.processes=processCount();stage('actual-production-bootstrap-and-unchanged-launcher',report.processes);
  const gatewayEnv=envFile('gateway',{NODE_ENV:'production',STOCKS_TEST_CASH_AUTHORITY_URL:'http://127.0.0.1:13020/api/v1/stocks-test-cash',STOCKS_IDENTITY_ISSUER:configuration.STOCKS_IDENTITY_ISSUER,STOCKS_TEST_CASH_GATEWAY_KEY:key,STOCKS_TRADE_PRINCIPALS:JSON.stringify(principals),STOCKS_GLOBAL_PORT:'4437',STOCKS_PUBLIC_ORIGIN:'https://app.example.invalid',STOCKS_PAGES_INGRESS_ENABLED:'true',STOCKS_API_INGRESS_ORIGIN:'https://api.example.invalid',STOCKS_EDGE_TRANSPORT_KEY:'ab'.repeat(32),STOCKS_MARKET_DATA_ENABLED:'false',STOCKS_WS_ENABLED:'false',STOCKS_ORDER_EXECUTION_ENABLED:'false'});
  runContainer(gateway,['--network','host','--cpus','0.25','--memory','256m','--pids-limit','64','--env-file',gatewayEnv,report.images.gateway.tag]);
  await waitFor(gateway,()=>{try{return command('curl',['--silent','--fail','http://127.0.0.1:4437/__stocks_global/health']).length>0;}catch{return false;}});
  const acceptance=require('./acceptance.cjs');
  const result=await acceptance.run({OUT,cleanups,users,password,fixture,apiOrigin:'http://127.0.0.1:13020',docker,api,gateway,pg,NODE});
  report.acceptance=result;stage('pages-workerd-nginx-tls-browser-and-financial-fences',result.checks);
  // Exactly one predeclared 180s + 180s comparison. No retry or adaptive workload.
  report.performance=await require('./benchmark.cjs').run({OUT,tokens:result.tokens,startReaders:result.startReaders,proxy:result.proxy,docker,api,gateway,pg});
  report.after=fixture('snapshot');assert.deepEqual(report.after.fingerprint,before.fingerprint,'all non-identity financial/history rows unchanged');
  docker(['stop','--time','12',api]);assert.equal(JSON.parse(docker(['inspect',api]))[0].State.Running,false);
  docker(['start',api]);await waitFor(api,()=>{try{return command('curl',['--silent','--fail','http://127.0.0.1:13020/health']).includes(OVERLAY);}catch{return false;}});processCount();stage('same-immutable-image-stop-restart-smoke',{productionPreviousImageRollback:'NOT_EXECUTED; existing live digest/config retained, no production operation'});
  report.result=report.performance.result==='PASS'?'PASS':report.performance.result;
}
main().catch(e=>{report.result='FAIL';report.error=redact(e.stack||e.message);console.error(report.error);}).finally(async()=>{
  for(const fn of cleanups.reverse())try{await fn();}catch(e){report.cleanupError=redact(e.message);}
  for(const name of owned.reverse()){try{diagnostic.captureContainer(name,'final-before-cleanup');const log=cp.spawnSync('docker',['logs',name],{encoding:'utf8',maxBuffer:48*1024*1024});fs.writeFileSync(path.join(OUT,name+'.log'),redact((log.stdout||'')+'\n'+(log.stderr||'')));}catch{}try{docker(['rm','-f',name]);}catch{}}
  if(network)try{docker(['network','rm',network]);}catch{}
  if(bridge)try{command('sudo',['iptables','-D','DOCKER-USER','-i',bridge,'-j','DROP']);}catch{}
  if(transport)try{docker(['network','rm',transport]);}catch{}
  // Live auth objects are never an artifact.
  if(report.acceptance)delete report.acceptance.tokens,delete report.acceptance.mf,delete report.acceptance.proxy,delete report.acceptance.startReaders;
  fs.writeFileSync(path.join(OUT,'result.json'),redact(JSON.stringify(report,null,2))+'\n');
  console.log(JSON.stringify({result:report.result,head:report.head,images:report.images,performance:report.performance?.result||report.performance}));
  if(report.result!=='PASS')process.exitCode=1;
});
