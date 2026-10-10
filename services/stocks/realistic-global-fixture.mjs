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

export async function startFixture({port=8092,controlPort=8093,path,profilePath}={}) {
  if(!path)throw Error('Explicit disposable STOCK_REALISTIC_DB path required');
  mkdirSync(dirname(resolve(path)),{recursive:true});
  let fixtureTransportCalls=0,fixtureQuoteCalls=0,sqlCalls=0,sqlReadCalls=0,sqlWriteCalls=0,sqlExecCalls=0,transactionExecCalls=0,sqlWallMs=0,sqlCpuMs=0,identityChecks=0;
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){
    const start=performance.now(),cpu=process.cpuUsage();sqlCalls++;sqlExecCalls++;if(/\b(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))transactionExecCalls++;
    try{return exec.call(this,sql);}finally{const delta=process.cpuUsage(cpu);sqlWallMs+=performance.now()-start;sqlCpuMs+=(delta.user+delta.system)/1000;}
  };
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),mutates=!/^\s*(SELECT|PRAGMA)\b/i.test(sql);
    return new Proxy(statement,{get(target,key){
      if(['all','get','run'].includes(key))return(...args)=>{
        const start=performance.now(),cpu=process.cpuUsage();sqlCalls++;if(mutates)sqlWriteCalls++;else sqlReadCalls++;
        try{return target[key](...args);}finally{const delta=process.cpuUsage(cpu);sqlWallMs+=performance.now()-start;sqlCpuMs+=(delta.user+delta.system)/1000;}
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
  const hub=new MarketHub({fetchImpl:async url=>{
    const u=new URL(url);fixtureTransportCalls++;
    if(!['api.bybit.com','api.binance.com'].includes(u.hostname)||!['/v5/market/kline','/api/v3/klines'].includes(u.pathname))throw Error('FIXTURE_TRANSPORT_DENIED');
    const periods={'1':60000,'5':300000,'15':900000,'30':1800000,'60':3600000,'240':14400000,'D':86400000,'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
    const step=periods[u.searchParams.get('interval')];if(!step)throw Error('Invalid fixture interval');
    const before=Number(u.searchParams.get('end')??u.searchParams.get('endTime')??Date.now());
    const end=Math.floor(before/step)*step;
    const rows=Array.from({length:300},(_,n)=>[String(end-(300-n)*step),'100.12345678','102.87654321','99.01234567','101.56781234','25']);
    const body=u.hostname==='api.bybit.com'?{retCode:0,result:{symbol:u.searchParams.get('symbol'),list:rows.reverse()}}:rows;
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  }});
  // Quote/FX business arithmetic has its own unchanged regression suite. This load fixture
  // exercises actual quote admission, account writes, native candle parsing/cache and HTTP.
  hub.catalogue=async()=>FIXTURE_INSTRUMENTS.map(i=>({...i,exists:true,online:true,display:null}));
  hub.quote=async id=>{
    fixtureQuoteCalls++;const i=FIXTURE_INSTRUMENTS.find(x=>x.id===id);if(!i)throw Error('Fixture instrument missing');const now=Date.now();
    return {instrumentId:id,provider:i.provider,nativeCurrency:i.currency,receivedAt:now,timestamp:now,verified:true,capacity:'1.00000000',multiplier:null,delaySeconds:0,bid:'100.12345678',ask:'100.22345678',last:'100.12345678',eventId:String(now),change24h:0,volume:'25.00000000',marketOpen:true,prices:{USDT:{buy:'100.22345678',sell:'100.12345678'}},fx:{}};
  };
  const app=await createServer({port,accountsPath:path,hub,autoPoll:true,authenticate:async req=>{
    identityChecks++;const match=/^Bearer fixture-user-(\d{1,3})$/.exec(req.headers.authorization??'');
    if(!match||Number(match[1])>=100)throw Error('Fixture identity required');
    return {issuer:'stocks-capacity-fixture',subject:match[1]};
  }});
  let profiler;
  if(profilePath){profiler=new Session();profiler.connect();await post(profiler,'Profiler.enable');await post(profiler,'Profiler.setSamplingInterval',{interval:1000});await post(profiler,'Profiler.start');}
  const lag=monitorEventLoopDelay({resolution:20});lag.enable();
  const snapshot=()=>({at:performance.now(),cpu:process.cpuUsage(),sqlCalls,sqlReadCalls,sqlWriteCalls,sqlExecCalls,transactionExecCalls,sqlWallMs,sqlCpuMs,fixtureTransportCalls,fixtureQuoteCalls,identityChecks,hub:{...hub.metrics},cpuStat:readCgroup('cpu.stat'),ioStat:readCgroup('io.stat')});
  let initial=snapshot(),maxRss=process.memoryUsage().rss,maxHeap=process.memoryUsage().heapUsed;
  const memoryTimer=setInterval(()=>{const m=process.memoryUsage();maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);},250);memoryTimer.unref();
  const metrics=()=>{
    const end=snapshot(),elapsedMs=end.at-initial.at,cpuMs=(end.cpu.user+end.cpu.system-initial.cpu.user-initial.cpu.system)/1000;
    const diff=key=>end[key]-initial[key];let dataBytes=null;try{dataBytes=statSync(path).size;}catch{}
    return {fixture:true,externalApiCalls:0,accountDatabase:true,profileEnabled:!!profiler,elapsedMs,cpuMs,cpuVcpu:cpuMs/elapsedMs,maxRssBytes:maxRss,maxHeapBytes:maxHeap,dataBytes,sqlCalls:diff('sqlCalls'),sqlReadCalls:diff('sqlReadCalls'),sqlWriteCalls:diff('sqlWriteCalls'),sqlExecCalls:diff('sqlExecCalls'),transactionExecCalls:diff('transactionExecCalls'),sqlWallMs:diff('sqlWallMs'),sqlCpuMs:diff('sqlCpuMs'),fixtureProviderHistoryCalls:diff('fixtureTransportCalls'),fixtureQuoteCalls:diff('fixtureQuoteCalls'),identityChecks:diff('identityChecks'),hub:end.hub,hubInitial:initial.hub,eventLoopMaxMs:lag.max/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,cpuMax:readCgroup('cpu.max'),memoryMax:readCgroup('memory.max'),ioMax:readCgroup('io.max'),memoryEvents:readCgroup('memory.events'),initial:{cpuStat:initial.cpuStat,ioStat:initial.ioStat},final:{cpuStat:end.cpuStat,ioStat:end.ioStat},notes:['Only test identities and disposable SQLite; no real authentication endpoint.','0 external requests; provider call counts are injected fixture transport calls.','SQL counters include prepared all/get/run and exec (including BEGIN/COMMIT and synchronous journal work).','Account creation can occur in cold runs; historical candle storage is provider fixtures, not account SQLite.']};
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
