// Isolated Linux CI fixture only; never imported by production runtime.
import { readFileSync,statSync } from 'node:fs';
import { Store } from './core.mjs';
import { ProviderGateway } from './provider.mjs';
import { createStockServer } from './server.mjs';
import { performance,monitorEventLoopDelay } from 'node:perf_hooks';
const instruments=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))).map(i=>({...i,enabled:true,dataRightsStatus:'confirmed'}));
const now=Date.now(),store=new Store('/tmp/load.sqlite');
const rows=(i,offset=0)=>Array.from({length:500},(_,n)=>({instrumentId:i.instrumentId,interval:'15m',openTimeUtc:now-(500-n+offset)*900000,closeTimeUtc:now-(499-n+offset)*900000,open:'100',high:'102',low:'99',close:'101',volume:null,currency:i.currency,provider:i.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'}));
for(const i of instruments)store.write(rows(i).slice(0,-1),i,now);
const server=createStockServer({store,instruments}),scenario=process.env.STOCK_LOAD_CASE??'B';let timer,stopped=false,index=0,written=0,writeBatches=0,faults=0;
const faultKind=['429','500','timeout'][Number(process.env.STOCK_LOAD_REPEAT??0)];
const gateway=new ProviderGateway({fetchImpl:async(_url,{signal})=>{if(faultKind==='timeout')return new Promise((_ok,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {ok:false,status:Number(faultKind),headers:new Headers(faultKind==='429'?{'retry-after':'120'}:{}),body:null};}});
const lag=monitorEventLoopDelay({resolution:10});lag.enable();const start=performance.now(),cpu=process.cpuUsage();
const step=async()=>{if(stopped)return;
  // One bounded provider-page-equivalent every 30s (1000 candles/minute ceiling).
  if(scenario==='E'){try{await gateway.request('https://isolated.invalid');}catch{faults++;}}else{const i=instruments[index++%250];written+=store.write(scenario==='B'?rows(i).slice(-2):rows(i,500),i,now);writeBatches++;server.stockCache.clear();}
  timer=setTimeout(step,scenario==='B'?2000:30000);
};
server.listen(8091,'0.0.0.0',()=>{timer=setTimeout(step,5000);});
process.on('SIGTERM',()=>{stopped=true;clearTimeout(timer);gateway.close();server.closeAllConnections();server.close(()=>{lag.disable();const elapsedMs=performance.now()-start,u=process.cpuUsage(cpu);console.log(JSON.stringify({scenario,written,writeBatches,faultKind:scenario==='E'?faultKind:null,faults,elapsedMs,cpuVcpu:(u.user+u.system)/1000/elapsedMs,rss:process.memoryUsage().rss,eventLoopMaxMs:lag.max/1e6,dataBytes:statSync('/tmp/load.sqlite').size,ioStat:readFileSync('/sys/fs/cgroup/io.stat','utf8'),memoryEvents:readFileSync('/sys/fs/cgroup/memory.events','utf8')}));store.close();process.exit();});});
