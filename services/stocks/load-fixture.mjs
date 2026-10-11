// Isolated Linux CI fixture only; never imported by production runtime.
import { readFileSync,statSync } from 'node:fs';
import { Store } from './core.mjs';
import { ProviderGateway } from './provider.mjs';
import { createStockServer } from './server.mjs';
import { performance,monitorEventLoopDelay } from 'node:perf_hooks';
import { createServer as createControlServer } from 'node:http';
const instruments=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))).map(i=>({...i,enabled:true,dataRightsStatus:'confirmed'}));
const dbPath=process.env.STOCK_LOAD_DB??'/tmp/load.sqlite';
const now=Number(process.env.STOCK_FIXTURE_NOW??Date.now()),store=new Store(dbPath);
const rows=(i,offset=0)=>Array.from({length:500},(_,n)=>({instrumentId:i.instrumentId,interval:'15m',openTimeUtc:now-(500-n+offset)*900000,closeTimeUtc:now-(499-n+offset)*900000,open:'100',high:'102',low:'99',close:'101',volume:null,currency:i.currency,provider:i.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'}));
for(const i of instruments)store.write(rows(i).slice(0,-1),i,now);
if(process.env.STOCK_LOAD_SEED_ONLY==='true'){store.close();process.exit(0);}
// Identical observational instrumentation is copied into both benchmark images.
let historyReads=0,historyReadMs=0;
for(const name of ['history','encodedHistory'])if(typeof store[name]==='function'){
  const original=store[name].bind(store);
  store[name]=(...args)=>{const start=performance.now();try{historyReads++;return original(...args);}finally{historyReadMs+=performance.now()-start;}};
}
const server=createStockServer({store,instruments}),scenario=process.env.STOCK_LOAD_CASE??'B';let timer,stopped=false,index=0,written=0,writeBatches=0,faults=0;
const faultKind=['429','500','timeout'][Number(process.env.STOCK_LOAD_REPEAT??0)];
const gateway=new ProviderGateway({fetchImpl:async(_url,{signal})=>{if(faultKind==='timeout')return new Promise((_ok,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {ok:false,status:Number(faultKind),headers:new Headers(faultKind==='429'?{'retry-after':'120'}:{}),body:null};}});
let droppedConnections=0;server.on('drop',()=>droppedConnections++);
const cgroup=name=>{try{return readFileSync('/sys/fs/cgroup/'+name,'utf8');}catch(e){return 'UNAVAILABLE: '+e.code;}};
let initial={cpu:cgroup('cpu.stat'),io:cgroup('io.stat')};
const lag=monitorEventLoopDelay({resolution:10});lag.enable();let start=performance.now(),cpu=process.cpuUsage();
const snapshot=()=>{const elapsedMs=performance.now()-start,u=process.cpuUsage(cpu);return{scenario,written,writeBatches,faultKind:scenario==='E'?faultKind:null,faults,historyReads,historyReadMs,cacheBytes:server.stockCache.bytes,cacheEntries:server.stockCache.entries.size,maxConnections:server.maxConnections,elapsedMs,cpuVcpu:(u.user+u.system)/1000/elapsedMs,rss:process.memoryUsage().rss,eventLoopMaxMs:lag.max/1e6,dataBytes:statSync(dbPath).size,droppedConnections,cachePending:server.stockCache.pending.size,initial,cpuMax:cgroup('cpu.max'),cpuStat:cgroup('cpu.stat'),ioMax:cgroup('io.max'),ioStat:cgroup('io.stat'),ioPressure:cgroup('io.pressure'),memoryEvents:cgroup('memory.events')};};
// Only the separate observational harness enables this loopback-published
// control port. Reset counters, never storage, cache, collector timing or load.
const control=process.env.STOCK_PROFILE_CONTROL==='true'?createControlServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'&&req.url==='/reset'){
    historyReads=0;historyReadMs=0;droppedConnections=0;written=0;writeBatches=0;faults=0;lag.reset();
    initial={cpu:cgroup('cpu.stat'),io:cgroup('io.stat')};start=performance.now();cpu=process.cpuUsage();res.end('{"ok":true}');
  }else if(req.method==='GET'&&req.url==='/metrics')res.end(JSON.stringify(snapshot()));
  else{res.writeHead(404);res.end('{}');}
}):null;
control?.listen(8094,'0.0.0.0');
const step=async()=>{if(stopped)return;
  // One bounded provider-page-equivalent every 30s (1000 candles/minute ceiling).
  if(scenario==='E'){try{await gateway.request('https://isolated.invalid');}catch{faults++;}}else{const i=instruments[index++%250];written+=store.write(scenario==='B'?rows(i).slice(-2):rows(i,500),i,now);writeBatches++;server.stockCache.clear();}
  timer=setTimeout(step,scenario==='B'?2000:30000);
};
server.listen(8091,'0.0.0.0',()=>{timer=setTimeout(step,5000);});
process.on('SIGTERM',()=>{stopped=true;clearTimeout(timer);gateway.close();control?.closeAllConnections();control?.close();server.closeAllConnections();server.close(()=>{lag.disable();console.log(JSON.stringify(snapshot()));store.close();process.exit();});});
