import { nativeHistoryFixture } from './realistic-provider-fixture.mjs';
// Local/CI capacity fixture. Never imported by the application or deployed.
// Every provider response and identity below is synthetic test data; external I/O is impossible.
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { createServer } from '../stocks-global/server.mjs';
import { MarketHub } from '../stocks-global/market.mjs';
import { CATALOG } from '../stocks-global/catalog.mjs';

export const FIXTURE_INSTRUMENTS = CATALOG.filter(i=>i.provider!=='moex').slice(0,20);
const readCgroup = file => {try{return readFileSync('/sys/fs/cgroup/'+file,'utf8');}catch{return null;}};
const post = (session,method,params={})=>new Promise((ok,fail)=>session.post(method,params,(error,value)=>error?fail(error):ok(value)));

export async function startFixture({port=8092,controlPort=8093,path,profilePath,historyFixtureDelayMs=0}={}) {
  if(!path)throw Error('Explicit disposable STOCK_REALISTIC_DB path required');
  if(!Number.isSafeInteger(historyFixtureDelayMs)||historyFixtureDelayMs<0||historyFixtureDelayMs>1000)throw Error('Invalid explicit fixture delay');
  mkdirSync(dirname(resolve(path)),{recursive:true});
  let fixtureTransportCalls=0,fixtureQuoteCalls=0,sqlCalls=0,sqlReadCalls=0,sqlWriteCalls=0,sqlExecCalls=0,transactionExecCalls=0,sqlWallMs=0,sqlCpuMs=0,identityChecks=0;
  const sqlStages={};
  const recordSql=(stage,start,cpu)=>{const delta=cpu?process.threadCpuUsage(cpu):null,wallMs=performance.now()-start,cpuMs=delta?(delta.user+delta.system)/1000:0;sqlWallMs+=wallMs;sqlCpuMs+=cpuMs;const record=sqlStages[stage]??={calls:0,wallMs:0,cpuMs:0};record.calls++;record.wallMs+=wallMs;record.cpuMs+=cpuMs;};
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){
    const start=performance.now(),cpu=process.threadCpuUsage?.();sqlCalls++;sqlExecCalls++;if(/\b(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))transactionExecCalls++;
    const stage=/^\s*BEGIN\b/i.test(sql)?'begin':/^\s*COMMIT\b/i.test(sql)?'commit':/^\s*ROLLBACK\b/i.test(sql)?'rollback':'otherExec';
    try{return exec.call(this,sql);}finally{recordSql(stage,start,cpu);}
  };
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),mutates=!/^\s*(SELECT|PRAGMA)\b/i.test(sql);
    return new Proxy(statement,{get(target,key){
      if(['all','get','run'].includes(key))return(...args)=>{
        const start=performance.now(),cpu=process.threadCpuUsage?.();sqlCalls++;if(mutates)sqlWriteCalls++;else sqlReadCalls++;
        try{return target[key](...args);}finally{recordSql(mutates?'write':'read',start,cpu);}
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
  const hub=new MarketHub({fetchImpl:async url=>{
    const u=new URL(url);fixtureTransportCalls++;
    if(!['api.bybit.com','api.binance.com'].includes(u.hostname)||!['/v5/market/kline','/api/v3/klines'].includes(u.pathname))throw Error('FIXTURE_TRANSPORT_DENIED');
    // Opt-in fault diagnosis only; all ordinary benchmark runs retain zero transport delay.
    if(historyFixtureDelayMs)await new Promise(ok=>setTimeout(ok,historyFixtureDelayMs));
    const body=nativeHistoryFixture(u);
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  }});
  // Quote/FX business arithmetic has its own unchanged regression suite. This load fixture
  // exercises actual quote admission, account writes, native candle parsing/cache and HTTP.
  hub.catalogue=async()=>FIXTURE_INSTRUMENTS.map(i=>({...i,exists:true,online:true,display:null}));
  hub.quote=async id=>{
    fixtureQuoteCalls++;const i=FIXTURE_INSTRUMENTS.find(x=>x.id===id);if(!i)throw Error('Fixture instrument missing');const now=Date.now();
    return {instrumentId:id,provider:i.provider,nativeCurrency:i.currency,receivedAt:now,timestamp:now,verified:true,capacity:'1.00000000',multiplier:null,delaySeconds:0,bid:'100.12345678',ask:'100.22345678',last:'100.12345678',eventId:String(now),change24h:0,volume:'25.00000000',marketOpen:true,prices:{USDT:{buy:'100.22345678',sell:'100.12345678'}},fx:{}};
  };
  const app=await createServer({port,accountsPath:path,hub,autoPoll:true,accountDiagnostics:true,authenticate:async req=>{
    identityChecks++;const match=/^Bearer fixture-user-(\d{1,3})$/.exec(req.headers.authorization??'');
    if(!match||Number(match[1])>=100)throw Error('Fixture identity required');
    return {issuer:'stocks-capacity-fixture',subject:match[1]};
  }});
  let profiler;
  if(profilePath){profiler=new Session();profiler.connect();await post(profiler,'Profiler.enable');await post(profiler,'Profiler.setSamplingInterval',{interval:1000});await post(profiler,'Profiler.start');}
  const lag=monitorEventLoopDelay({resolution:20});lag.enable();
  const snapshot=()=>{
    const worker=app.accountMetrics?.();
    const sql=worker??{sqlCalls,sqlReadCalls,sqlWriteCalls,sqlExecCalls,transactionExecCalls,sqlWallMs,sqlCpuMs,sqlStages,sqlThreadCpuAvailable:Number(typeof process.threadCpuUsage==='function')};
    const numeric=keys=>Object.fromEntries(keys.map(key=>[key,Number.isFinite(sql[key])?sql[key]:0]));
    return {at:performance.now(),cpu:process.cpuUsage(),...numeric(['sqlCalls','sqlReadCalls','sqlWriteCalls','sqlExecCalls','transactionExecCalls','sqlWallMs','sqlCpuMs','sqlThreadCpuAvailable','observationsVolatile','observationsDurable','observationEvictions','observationBytes','observationMaxBytes','observationOwners','observationSlots']),observationMetricsAvailable:Number.isFinite(worker?.observationMaxBytes),sqlStages:structuredClone(sql.sqlStages??{}),accountStorage:worker?'worker':'main-thread',accountQueue:worker?{...worker.queue}:null,accountMetricsAgeMs:worker?.metricsAgeMs??0,accountObservedAt:worker?.observedAt??null,accountWorkerAlive:worker?.workerAlive??null,fixtureTransportCalls,fixtureQuoteCalls,identityChecks,hub:{...hub.metrics},eventLoopUtilization:performance.eventLoopUtilization(),cpuStat:readCgroup('cpu.stat'),ioStat:readCgroup('io.stat')};
  };
  let initial=snapshot(),maxRss=process.memoryUsage().rss,maxHeap=process.memoryUsage().heapUsed;
  const memoryTimer=setInterval(()=>{const m=process.memoryUsage();maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);},250);memoryTimer.unref();
  const metrics=()=>{
    const end=snapshot(),elapsedMs=end.at-initial.at,cpuMs=(end.cpu.user+end.cpu.system-initial.cpu.user-initial.cpu.system)/1000;
    const diff=key=>end[key]-initial[key];let dataBytes=null;try{dataBytes=statSync(path).size;}catch{}
    const stageDeltas=Object.fromEntries(Object.entries(end.sqlStages).map(([stage,values])=>[stage,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value-(initial.sqlStages[stage]?.[key]??0)]))]));
    const queueDelta=end.accountQueue?Object.fromEntries(['accepted','dispatched','completed','rejected','timedOut','waitMs','workMs'].map(key=>[key,end.accountQueue[key]-(initial.accountQueue?.[key]??0)])):null;
    const observationMetrics={available:end.observationMetricsAvailable,...Object.fromEntries(['observationsVolatile','observationsDurable','observationEvictions'].map(key=>[key,diff(key)])),...Object.fromEntries(['observationBytes','observationMaxBytes','observationOwners','observationSlots'].map(key=>[key,end[key]]))};
    return {fixture:true,externalApiCalls:0,accountDatabase:true,observationMetrics,accountStorage:end.accountStorage,accountQueue:end.accountQueue,accountQueueDelta:queueDelta,accountMetricsAgeMs:end.accountMetricsAgeMs,accountObservedAt:end.accountObservedAt,accountWorkerAlive:end.accountWorkerAlive,sqlThreadCpuAvailable:end.sqlThreadCpuAvailable===1,historyFixtureDelayMs,profileEnabled:!!profiler,profileScope:'main-thread V8 profile; SQL thread CPU is recorded separately',elapsedMs,cpuMs,cpuVcpu:cpuMs/elapsedMs,maxRssBytes:maxRss,maxHeapBytes:maxHeap,dataBytes,sqlCalls:diff('sqlCalls'),sqlReadCalls:diff('sqlReadCalls'),sqlWriteCalls:diff('sqlWriteCalls'),sqlExecCalls:diff('sqlExecCalls'),transactionExecCalls:diff('transactionExecCalls'),sqlWallMs:diff('sqlWallMs'),sqlCpuMs:diff('sqlCpuMs'),sqlStages:stageDeltas,fixtureProviderHistoryCalls:diff('fixtureTransportCalls'),fixtureQuoteCalls:diff('fixtureQuoteCalls'),identityChecks:diff('identityChecks'),hub:end.hub,hubInitial:initial.hub,eventLoopUtilization:performance.eventLoopUtilization(end.eventLoopUtilization,initial.eventLoopUtilization),eventLoopMaxMs:lag.max/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,cpuMax:readCgroup('cpu.max'),memoryMax:readCgroup('memory.max'),ioMax:readCgroup('io.max'),ioPressure:readCgroup('io.pressure'),memoryEvents:readCgroup('memory.events'),initial:{cpuStat:initial.cpuStat,ioStat:initial.ioStat},final:{cpuStat:end.cpuStat,ioStat:end.ioStat},notes:['Only test identities and disposable SQLite; no real authentication endpoint.','0 external requests; provider call counts are injected fixture transport calls.','SQL counters include prepared all/get/run and exec (including BEGIN/COMMIT and synchronous journal work). Commit wall time includes fsync/I/O waits; it is not a direct fsync syscall timer.','Worker metrics are cached completed-operation snapshots; pending/active work and snapshot age are included rather than adding a measurement-only SQL request.','Account creation can occur in cold runs; historical candle storage is provider fixtures, not account SQLite.']};
  };
  const control=createHttpServer((req,res)=>{
    if(req.headers.host!==`127.0.0.1:${control.address().port}`){res.writeHead(403);return res.end();}
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST'&&req.url==='/reset'){initial=snapshot();maxRss=process.memoryUsage().rss;maxHeap=process.memoryUsage().heapUsed;lag.reset();return res.end('{"ok":true}');}
    if(req.method==='GET'&&req.url==='/metrics')return res.end(JSON.stringify(metrics()));
    res.writeHead(404);res.end('{}');
  });
  await new Promise(ok=>control.listen(controlPort,'127.0.0.1',ok));
  return {app,port:app.port,controlPort:control.address().port,metrics,async close(){
    clearInterval(memoryTimer);lag.disable();await app.close();await new Promise(ok=>control.close(ok));
    if(profiler){const {profile}=await post(profiler,'Profiler.stop');writeFileSync(profilePath,JSON.stringify(profile));profiler.disconnect();}
    DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;
  }};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.STOCK_REALISTIC_FIXTURE!=='true')throw Error('STOCK_REALISTIC_FIXTURE=true required');
  const fixture=await startFixture({port:Number(process.env.STOCK_REALISTIC_PORT??8092),controlPort:Number(process.env.STOCK_REALISTIC_CONTROL_PORT??8093),path:process.env.STOCK_REALISTIC_DB,profilePath:process.env.STOCK_REALISTIC_PROFILE});
  console.log(JSON.stringify({ready:true,port:fixture.port,controlPort:fixture.controlPort,fixture:true,instruments:20}));
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;console.log(JSON.stringify(fixture.metrics()));await fixture.close();process.exit();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
