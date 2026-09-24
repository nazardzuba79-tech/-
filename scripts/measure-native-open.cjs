#!/usr/bin/env node
/** Disposable loopback PostgreSQL OPEN profile. Never accepts a remote DATABASE_URL. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {once}=require('node:events');
const {spawnSync,execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const qa=createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));
const {PrismaClient}=require('@prisma/client');
const {NativeDemoService}=require('../dist/private-trading/native/service');
const {PrismaNativeRepository,inflate}=require('../dist/private-trading/native/store');
const {Clock,FakeMarket,setup,actor:fixtureActor,key:fixtureKey}=require('../dist/private-trading/native/testing/liveFixture');
const {compact,revisionPayload}=require('../dist/private-trading/native/store');
const output=path.resolve(process.argv[2]||'output/native-open-profile.json');
const elapsed=(t)=>Math.round((performance.now()-t)*100)/100;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
async function main(){
 const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const bin=qa(process.platform==='win32'?'@embedded-postgres/windows-x64':'@embedded-postgres/linux-x64');
 const tempRoot=process.platform==='win32'?path.join(os.homedir(),'AppData/Local/Temp'):os.tmpdir();
 const dir=path.join(fs.mkdtempSync(path.join(tempRoot,'voltex-native-open-')),'data');
 const init=spawnSync(bin.initdb,['-D',dir,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 const log=path.join(path.dirname(dir),'postgres.log');
 // The daemon must not inherit a captured pipe: pg_ctl would wait forever
 // for the PostgreSQL child to close that handle.
 const start=spawnSync(bin.pg_ctl,['-D',dir,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'start','-w'],{windowsHide:true,stdio:'ignore'});assert.equal(start.status,0,`pg_ctl failed: ${log}`);
 let sql=new(qa('pg').Client)({host:'127.0.0.1',port,user:'postgres',database:'postgres'}),db,proxy;
 const sockets=new Set(),wire={clientToDb:0,dbToClient:0};
 const queries=[],traces=[];let listen=false;const originalInfo=console.info;
 try{
  await sql.connect();await sql.query('CREATE DATABASE voltex_native_egress_test');await sql.end();
  sql=new(qa('pg').Client)({host:'127.0.0.1',port,user:'postgres',database:'voltex_native_egress_test'});await sql.connect();
  for(const migration of fs.readdirSync('prisma/migrations').sort()){
   const file=path.join('prisma/migrations',migration,'migration.sql');if(fs.existsSync(file))await sql.query(fs.readFileSync(file,'utf8'));
  }
  proxy=net.createServer(client=>{
   const upstream=net.connect(port,'127.0.0.1');
   for(const socket of[client,upstream]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{client.destroy();upstream.destroy()})}
   client.on('data',b=>{if(listen)wire.clientToDb+=b.length});
   upstream.on('data',b=>{if(listen)wire.dbToClient+=b.length});
   client.pipe(upstream);upstream.pipe(client);
  }).listen(0,'127.0.0.1');await once(proxy,'listening');
  const url=`postgresql://postgres@127.0.0.1:${proxy.address().port}/voltex_native_egress_test?connection_limit=2&sslmode=disable`;
  db=new PrismaClient({datasources:{db:{url}},log:[{emit:'event',level:'query'}]});
  db.$on('query',e=>{if(listen)queries.push({statement:e.query,durationMs:e.duration})});
  await db.$connect();
  const id=randomUUID(),user=await db.user.create({data:{email:`native-open-${id}@example.test`,passwordHash:'FIXTURE_NO_LOGIN',referralCode:`no${id.replace(/-/g,'')}`,role:'ADMIN'}});
  const session=await db.session.create({data:{userId:user.id,userAgent:'NATIVE_OPEN_LOCAL_PROFILE'}});
  await db.demoBalance.create({data:{userId:user.id,asset:'USDT',available:'10000000'}});
  const actor={userId:user.id,sessionId:session.id,expiresAt:Date.now()+3600000};
  const clock=new Clock(Date.now()),market=new FakeMarket(clock),repo=new PrismaNativeRepository(db,()=>({enabled:true,ownerId:user.id}));
  const service=new NativeDemoService(repo,market,clock.now);
  await service.initialize(actor,`init-${randomUUID()}`);
  let fixtureTrades=0;
  if(process.argv.includes('--large')){
   const fixture=setup({deposit:'10000000',at:Date.now()});
   console.info=()=>{};
   try{
    await fixture.service.initialize(fixtureActor,fixtureKey());
    while(Buffer.byteLength(JSON.stringify(compact(fixture.repo.row)))<350000){
     const opened=await fixture.service.command(fixtureActor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.1',leverage:'10',idempotencyKey:fixtureKey()});
     fixture.clock.t+=5001;
     await fixture.service.command(fixtureActor,{kind:'CLOSE',positionId:opened.positions[0].id,idempotencyKey:fixtureKey()});
     fixture.clock.t+=5001;
     if(++fixtureTrades>500)throw Error('large fixture cap');
    }
   }finally{console.info=originalInfo}
   const seeded=fixture.repo.row;
   await db.nativeDemoAccount.update({where:{userId:user.id},data:{revision:seeded.revision,payload:JSON.parse(JSON.stringify(compact(seeded)))}});
   await db.nativeDemoRevision.create({data:{userId:user.id,revision:seeded.revision,requestKey:'profile-seed',requestHash:'profile-seed',payload:JSON.parse(JSON.stringify(compact(revisionPayload(seeded))))}});
   clock.t=fixture.clock.t;
  }
  const initial=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:user.id}});
  const beforeBytes=Buffer.byteLength(JSON.stringify(initial.payload));
  const sampleAccount=inflate(initial.payload);
  const legacy=()=>{const account=JSON.parse(JSON.stringify(compact(sampleAccount)));const revision=JSON.parse(JSON.stringify(compact(revisionPayload(sampleAccount))));return{account,revision}};
  const prepared=()=>{const account=JSON.parse(JSON.stringify(compact(sampleAccount)));const{checkpoint,checkpointSnapshot,executionSession,executionPending,...revision}=account;return{account,revision}};
  assert.deepEqual(prepared(),legacy(),'receipt must remain byte-for-byte equivalent to the existing stored shape');
  const prepTimes={legacy:[],optimized:[]};for(let i=0;i<25;i++)for(const [name,run] of[['legacy',legacy],['optimized',prepared]]){const t=performance.now();run();prepTimes[name].push(elapsed(t))}
  const times=[],samples=[];let sampledPeakRss=process.memoryUsage().rss;
  const sampler=setInterval(()=>{sampledPeakRss=Math.max(sampledPeakRss,process.memoryUsage().rss)},5);
  console.info=(...a)=>{if(listen&&a[0]==='[native-command]'){try{traces.push(JSON.parse(a[1]))}catch{}}else originalInfo(...a)};
  for(let i=0;i<5;i++){
   if(!fixtureTrades)clock.t=Date.now();else clock.t+=1000;queries.length=0;traces.length=0;wire.clientToDb=0;wire.dbToClient=0;listen=true;
   const startAt=performance.now();
   const response=await service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.001',leverage:'10',idempotencyKey:`profile-${i}-${randomUUID()}`});
   const totalMs=elapsed(startAt);listen=false;times.push(totalMs);
   const commandWire={...wire};
   const sizes=await sql.query(`SELECT octet_length(a."payload"::text) AS account,octet_length(r."payload"::text) AS revision,octet_length(p."payload"::text) AS projection FROM "NativeDemoAccount" a JOIN "NativeDemoRevision" r ON r."userId"=a."userId" AND r."revision"=a."revision" JOIN "NativeDemoLiveProjection" p ON p."userId"=a."userId" WHERE a."userId"=$1`,[user.id]);
   const stages=Object.fromEntries(traces.filter(t=>t.stage.endsWith('.end')).map(t=>[t.stage,t.durationMs]));
   const grouped={};for(const q of queries){const s=q.statement;const table=/"(User|Session|NativeDemoAccount|NativeDemoRevision|NativeDemoLiveProjection|DemoBalance)"/.exec(s)?.[1]||'other';const kind=/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)/i.exec(s)?.[1]?.toUpperCase()||'other';const key=`${kind}:${table}`;grouped[key]=(grouped[key]||0)+1}
   // Context's account/receipt/balance reads run together. All other phases
   // depend on the preceding result: auth reads, lock, receipt, three writes.
   const sequentialDbPhases=(grouped['SELECT:User']||0)+1+1+1+3;
   samples.push({totalMs,sequentialDbPhases,sqlStatements:queries.length,sqlGroups:grouped,sqlDurationMs:Math.round(queries.reduce((sum,q)=>sum+q.durationMs,0)*100)/100,stages,bytes:{account:Number(sizes.rows[0].account),revision:Number(sizes.rows[0].revision),projection:Number(sizes.rows[0].projection),response:Buffer.byteLength(JSON.stringify(response)),...commandWire},revision:response.revision});
  }
  clearInterval(sampler);
  const report={baseSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:'disposable loopback PostgreSQL; fixture market; no production access',sampleCount:times.length,fixtureTrades,initialAccountBytes:beforeBytes,p50FullOpenMs:percentile(times,.5),p95FullOpenMs:percentile(times,.95),payloadPrepareP50Ms:{legacy:percentile(prepTimes.legacy,.5),optimized:percentile(prepTimes.optimized,.5)},sampledPeakRssBytes:sampledPeakRss,samples};
  if(process.argv.includes('--assert-optimized'))for(const s of samples){
   assert.equal(s.sequentialDbPhases,10);assert.equal(s.sqlStatements,14);
   assert.equal(s.sqlGroups['SELECT:User'],4);assert.equal(s.sqlGroups['SELECT:Session']||0,0);
   assert.equal(s.sqlGroups['SELECT:NativeDemoAccount'],2);assert.equal(s.sqlGroups['SELECT:NativeDemoRevision'],2);
   assert.equal(s.sqlGroups['SELECT:DemoBalance'],1);
   assert.equal(s.sqlGroups['UPDATE:NativeDemoAccount'],1);assert.equal(s.sqlGroups['INSERT:NativeDemoRevision'],1);
   assert.equal(s.sqlGroups['INSERT:NativeDemoLiveProjection'],1);
  }
  if(process.argv.includes('--tests')){
   const tests=['nativeDemo.integration','nativeCommandAcceptance.integration','nativeLivePostgres','service.integration'].map(n=>`src/private-trading/__tests__/${n}.test.ts`);
   const result=spawnSync(process.execPath,['node_modules/jest/bin/jest.js','--runInBand','--silent','--runTestsByPath',...tests],{
    env:{...process.env,DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/voltex_native_egress_test?sslmode=disable`,DIRECT_URL:`postgresql://postgres@127.0.0.1:${port}/voltex_native_egress_test?sslmode=disable`,NATIVE_EGRESS_TEST_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/voltex_native_egress_test?sslmode=disable`,PRIVATE_TRADING_DB_TESTS:'1'},windowsHide:true,encoding:'utf8',maxBuffer:30*1024*1024,timeout:180000});
   report.postgresTests={exitCode:result.status,stdout:result.stdout.slice(-12000),stderr:result.stderr.slice(-12000)};
   assert.equal(result.status,0,`PostgreSQL suites failed: ${result.stderr.slice(-12000)}`);
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));originalInfo(JSON.stringify(report,null,2));
 }finally{listen=false;console.info=originalInfo;await db?.$disconnect();for(const socket of sockets)socket.destroy();if(proxy)await new Promise(r=>proxy.close(r));try{await sql.end()}catch{}spawnSync(bin.pg_ctl,['-D',dir,'stop','-m','fast','-w'],{windowsHide:true,stdio:'ignore'});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
