/* Disposable localhost PostgreSQL only. Measures server->client PostgreSQL
 * protocol bytes (not JSON estimates, disk I/O, or Neon's billing counter). */
const net=require('node:net'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),Module=require('node:module'),ts=require('typescript');
const {performance}=require('node:perf_hooks');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {setup,actor,key,outcome}=require('../dist/private-trading/native/testing/liveFixture');
const {NativeDemoService}=require('../dist/private-trading/native/service');
const {PrismaNativeRepository,compact,revisionPayload,commandHash}=require('../dist/private-trading/native/store');
const base=process.env.NATIVE_EGRESS_BASE;
if(!base||!/^[a-f0-9]{40}$/.test(base))throw Error('Set NATIVE_EGRESS_BASE to the fetched main SHA');
const url=new URL(process.env.NATIVE_EGRESS_TEST_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/voltex_native_egress_test')throw Error('Requires isolated localhost voltex_native_egress_test database');
const source=execFileSync('git',['show',`${base}:src/private-trading/native/store.ts`],{encoding:'utf8'});
const baselineModule=new Module(path.resolve('dist/private-trading/native/store.baseline.js'),module);
baselineModule.filename=path.resolve('dist/private-trading/native/store.baseline.js');baselineModule.paths=module.paths;
baselineModule._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,baselineModule.filename);
const BaselineRepository=baselineModule.exports.PrismaNativeRepository;

async function main(){
  let wire=0,queries=[],sockets=new Set();
  const proxy=net.createServer(client=>{
    const upstream=net.connect(Number(url.port),url.hostname);
    for(const s of [client,upstream]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{client.destroy();upstream.destroy();});}
    upstream.on('data',b=>{wire+=b.length;});client.pipe(upstream);upstream.pipe(client);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const via=new URL(url);via.port=String(proxy.address().port);via.searchParams.set('connection_limit','1');via.searchParams.set('sslmode','disable');
  const db=new PrismaClient({datasources:{db:{url:via.toString()}},log:[{emit:'event',level:'query'}]});
  db.$on('query',e=>queries.push(e.query));
  try{
    const f=setup({deposit:'10000000'});await f.service.initialize(actor,key());
    let trades=0;
    while(Buffer.byteLength(JSON.stringify(compact(f.repo.row)))<350_000){
      const v=await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.1',leverage:'10',idempotencyKey:key()});
      f.clock.t+=5001;
      await f.service.command(actor,{kind:'CLOSE',positionId:v.positions[0].id,idempotencyKey:key()});
      f.clock.t+=5001;trades++;
      if(trades>500)throw Error('fixture size cap');
    }
    await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
    const seed=structuredClone(f.repo.row),start=f.clock.t;
    const config=()=>({enabled:true,ownerId:actor.userId});
    async function reset(){
      f.clock.t=start;
      // A new disposable identity per run: immutable evidence is never deleted.
      actor.userId=randomUUID();actor.sessionId=randomUUID();
      await db.user.create({data:{id:actor.userId,email:`${actor.userId}@example.invalid`,referralCode:actor.userId,passwordHash:'LOCAL_FIXTURE_DISABLED',role:'ADMIN'}});
      await db.session.create({data:{id:actor.sessionId,userId:actor.userId}});
      const payload=JSON.parse(JSON.stringify(compact(seed)));
      await db.nativeDemoAccount.upsert({where:{userId:actor.userId},create:{userId:actor.userId,revision:seed.revision,payload},update:{revision:seed.revision,payload}});
      await db.nativeDemoRevision.create({data:{userId:actor.userId,revision:seed.revision,requestKey:'fixture-seed',requestHash:'fixture',payload:JSON.parse(JSON.stringify(compact(revisionPayload(seed))))}});
    }
    const financial=v=>JSON.stringify({account:v.account,positions:v.positions});
    async function measure(name,after,withWorker){
      await reset();
      const Repo=after?PrismaNativeRepository:BaselineRepository;
      const service=new NativeDemoService(new Repo(db,config),f.market,f.clock.now);
      const worker=new NativeDemoService(new Repo(db,config,after),f.market,f.clock.now);
      if(after)await service.live(actor); // Exclude one-time projection recovery from the steady-state workload.
      // Warm connection/authentication outside measurement; no data request excluded.
      const startBytes=wire;queries=[];const times=[],values=[];let responseBytes=0;
      for(let i=0;i<120;i++){
        if(withWorker){for(let j=0;j<3;j++){f.clock.t+=10_000;await worker.command(actor,{kind:'REFRESH',idempotencyKey:`${name}-worker-${i}-${j}`});}}
        else f.clock.t+=30_000;
        const at=performance.now();
        const v=after?await service.live(actor):await service.command(actor,{kind:'REFRESH',idempotencyKey:`${name}-${i}`});
        times.push(performance.now()-at);responseBytes+=Buffer.byteLength(JSON.stringify(v));values.push(financial(v));
      }
      const bytes=wire-startBytes,sql=queries.slice();times.sort((a,b)=>a-b);
      const persisted=await db.nativeDemoAccount.findUnique({where:{userId:actor.userId}});
      return{result:{name,cycles:120,workerCycles:withWorker?360:0,dbWireBytes:bytes,sqlReads:sql.filter(q=>/^\s*(SELECT|WITH)/i.test(q)).length,
        sqlWrites:sql.filter(q=>/^\s*(INSERT|UPDATE|DELETE)/i.test(q)).length,responseBytes,p50Ms:+times[59].toFixed(2),p95Ms:+times[113].toFixed(2)},values,persisted,sql};
    }
    const before=await measure('before',false,false),after=await measure('after',true,false);
    assert.deepEqual(after.values,before.values,'all 120 user-visible account/PnL results');
    assert.equal(after.result.sqlWrites,0,'pure live has no writes');
    assert(!after.sql.some(q=>q.includes('NativeDemoRevision')),'pure live has no revision reads');
    assert(!after.sql.some(q=>q.includes('"NativeDemoAccount"."payload"')),'pure live has no account payload reads');
    assert.deepEqual(after.persisted.payload,JSON.parse(JSON.stringify(compact(seed))),'pure live leaves authority unchanged');
    assert(after.result.dbWireBytes<before.result.dbWireBytes*.1,'at least 90% egress reduction');
    const workerBefore=await measure('before-with-worker',false,true),workerAfter=await measure('after-with-worker',true,true);
    assert.deepEqual(workerAfter.values,workerBefore.values,'executor-inclusive visible PnL equality');
    assert.deepEqual(outcome(workerAfter.persisted.payload.snapshot),outcome(workerBefore.persisted.payload.snapshot),'executor authoritative outcomes');
    assert(workerAfter.result.dbWireBytes<workerBefore.result.dbWireBytes*.1,'executor-inclusive egress reduction');
    const report={base,postgres:'local disposable PostgreSQL, synthetic fixture; not production/Neon billing',fixture:{closedTrades:trades,accountJsonBytes:Buffer.byteLength(JSON.stringify(compact(seed)))},
      measurements:[before.result,after.result,workerBefore.result,workerAfter.result],
      reductionPercent:+(100*(1-after.result.dbWireBytes/before.result.dbWireBytes)).toFixed(3),
      workerInclusiveReductionPercent:+(100*(1-workerAfter.result.dbWireBytes/workerBefore.result.dbWireBytes)).toFixed(3),
      authoritativeResultEquality:true,userVisiblePnlEquality:true};
    fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/native-egress-measurements.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await db.$disconnect();for(const s of sockets)s.destroy();await new Promise(resolve=>proxy.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
