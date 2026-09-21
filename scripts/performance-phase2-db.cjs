/** Current compact-read baseline. Disposable loopback PostgreSQL ONLY. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process'),{once}=require('node:events'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client'),{performance}=require('node:perf_hooks');
const qa=createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));
const {setup,actor,key}=require('../dist/private-trading/native/testing/liveFixture');
const {NativeDemoService}=require('../dist/private-trading/native/service');
const {PrismaNativeRepository,compact,revisionPayload}=require('../dist/private-trading/native/store');
const label=process.argv[2]||'baseline',out=path.resolve('output/performance-phase2',label);fs.mkdirSync(out,{recursive:true});
async function main(){
 const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const bin=qa(process.platform==='win32'?'@embedded-postgres/windows-x64':'@embedded-postgres/linux-x64');
 const tmp=process.platform==='win32'?path.join(os.homedir(),'AppData/Local/Temp'):os.tmpdir();
 const dir=path.join(fs.mkdtempSync(path.join(tmp,'voltex-perf-')),'data');
 const init=spawnSync(bin.initdb,['-D',dir,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 const fd=fs.openSync(path.join(out,'pg-control.log'),'w');let start;
 try{start=spawnSync(bin.pg_ctl,['-D',dir,'-l',path.join(out,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'start','-w'],{windowsHide:true,stdio:['ignore',fd,fd]})}finally{fs.closeSync(fd)}assert.equal(start.status,0);
 const client=new(qa('pg').Client)({host:'127.0.0.1',port,user:'postgres',database:'postgres'});let db,proxy,wire=0,queries=[],sockets=new Set();
 try{
  await client.connect();for(const d of fs.readdirSync('prisma/migrations').sort()){const f=path.join('prisma/migrations',d,'migration.sql');if(fs.existsSync(f))await client.query(fs.readFileSync(f,'utf8'))}
  proxy=net.createServer(c=>{const u=net.connect(port,'127.0.0.1');for(const s of[c,u]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{c.destroy();u.destroy()})}u.on('data',b=>wire+=b.length);c.pipe(u);u.pipe(c)}).listen(0,'127.0.0.1');await once(proxy,'listening');
  db=new PrismaClient({datasources:{db:{url:`postgresql://postgres@127.0.0.1:${proxy.address().port}/postgres?connection_limit=1&sslmode=disable`}},log:[{emit:'event',level:'query'}]});db.$on('query',e=>queries.push(e.query));
  const f=setup({deposit:'10000000'});await f.service.initialize(actor,key());let trades=0;
  while(Buffer.byteLength(JSON.stringify(compact(f.repo.row)))<350000){const v=await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.1',leverage:'10',idempotencyKey:key()});f.clock.t+=5001;await f.service.command(actor,{kind:'CLOSE',positionId:v.positions[0].id,idempotencyKey:key()});f.clock.t+=5001;if(++trades>500)throw Error('fixture cap')}
  await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
  const seed=structuredClone(f.repo.row),at=f.clock.t,measurements=[];
  for(const workerEnabled of[false,true]){
   f.clock.t=at;actor.userId=randomUUID();actor.sessionId=randomUUID();
   await db.user.create({data:{id:actor.userId,email:actor.userId+'@perf.invalid',referralCode:actor.userId,passwordHash:'FIXTURE_ONLY',role:'ADMIN'}});await db.session.create({data:{id:actor.sessionId,userId:actor.userId}});
   const payload=JSON.parse(JSON.stringify(compact(seed)));
   await db.nativeDemoAccount.create({data:{userId:actor.userId,revision:seed.revision,payload}});
   await db.nativeDemoRevision.create({data:{userId:actor.userId,revision:seed.revision,requestKey:'fixture',requestHash:'fixture',payload:JSON.parse(JSON.stringify(compact(revisionPayload(seed))))}});
   const config=()=>({enabled:true,ownerId:actor.userId});const service=new NativeDemoService(new PrismaNativeRepository(db,config),f.market,f.clock.now),worker=new NativeDemoService(new PrismaNativeRepository(db,config,true),f.market,f.clock.now);
   await service.live(actor);const begin=wire,cpu=process.cpuUsage(),times=[],responses=[],values=[];let bytes=0;queries=[];f.market.calls={quote:0,history:0,marks:0};
   for(let i=0;i<120;i++){
    if(workerEnabled)for(let j=0;j<3;j++){f.clock.t+=10000;await worker.command(actor,{kind:'REFRESH',idempotencyKey:`worker-${i}-${j}`})}else f.clock.t+=30000;
    const start=performance.now(),v=await service.live(actor);times.push(performance.now()-start);const b=Buffer.byteLength(JSON.stringify(v));bytes+=b;responses.push(b);values.push({account:v.account,positions:v.positions});
   }
   const used=process.cpuUsage(cpu),dbBytes=wire-begin,sql=queries.slice();times.sort((a,b)=>a-b);
   if(!workerEnabled){assert(!sql.some(q=>q.includes('NativeDemoRevision')||q.includes('"NativeDemoAccount"."payload"')));assert(!sql.some(q=>/^\s*(INSERT|UPDATE|DELETE)/i.test(q)));assert.deepEqual((await db.nativeDemoAccount.findUnique({where:{userId:actor.userId}})).payload,payload);}
   assert(Math.max(...responses)<50000,'compact response budget');
   measurements.push({mode:workerEnabled?'120 live + 360 executor':'120 pure live',dbWireBytes:dbBytes,sqlReads:sql.filter(q=>/^\s*(SELECT|WITH)/i.test(q)).length,sqlWrites:sql.filter(q=>/^\s*(INSERT|UPDATE|DELETE)/i.test(q)).length,responseBytes:bytes,maxResponseBytes:Math.max(...responses),p50Ms:times[59],p95Ms:times[113],maxMs:times.at(-1),cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,marketCalls:{...f.market.calls}});
   fs.writeFileSync(path.join(out,workerEnabled?'executor-values.json':'live-values.json'),JSON.stringify(values));
  }
  const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'PostgreSQL protocol server-to-client bytes; local synthetic 350KB account; service + repository, HTTP auth excluded. No Neon billing claim.',fixtureBytes:Buffer.byteLength(JSON.stringify(compact(seed))),closedTrades:trades,measurements};fs.writeFileSync(path.join(out,'database.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await db?.$disconnect();for(const s of sockets)s.destroy();if(proxy)await new Promise(r=>proxy.close(r));await client.end();spawnSync(bin.pg_ctl,['-D',dir,'stop','-m','fast','-w'],{windowsHide:true,stdio:'ignore'});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
