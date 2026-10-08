// Run only inside the disposable review container, never on production.
import { readFileSync,writeFileSync,statfsSync,rmSync,mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance,monitorEventLoopDelay } from 'node:perf_hooks';
import { Store } from './core.mjs';
const read=p=>readFileSync('/sys/fs/cgroup/'+p,'utf8').trim();
const [quota,period]=read('cpu.max').split(' ').map(Number);
assert.ok(Number.isFinite(quota)&&quota/period<=.2);
assert.ok(Number(read('memory.max'))<=256*1048576);
assert.equal(Number(read('memory.swap.max')),0);
const result={cpuMax:read('cpu.max'),memoryMax:read('memory.max'),swapMax:read('memory.swap.max'),node:process.version,scope:'stocks only; not crypto A/B; no I/O throttling claim',repeats:[]};
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))),i=manifest[0];
for(let repeat=0;repeat<3;repeat++){
 const path='/tmp/proof.sqlite';rmSync(path,{force:true});const store=new Store(path),now=Date.now();const lag=monitorEventLoopDelay({resolution:10});lag.enable();const cpu=process.cpuUsage(),start=performance.now();
 for(let n=0;n<2000;n+=250){const rows=Array.from({length:250},(_,k)=>({instrumentId:i.instrumentId,interval:'15m',openTimeUtc:now-(2000-n-k)*900000,closeTimeUtc:now-(1999-n-k)*900000,open:'100',high:'102',low:'99',close:'101',volume:null,currency:i.currency,provider:i.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'}));store.write(rows,i,now);await new Promise(r=>setTimeout(r,20));}
 const latencies=[];for(let r=0;r<100;r++){const s=performance.now();store.history(i.instrumentId,500);latencies.push(performance.now()-s);await new Promise(r=>setImmediate(r));}
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-start;latencies.sort((a,b)=>a-b);lag.disable();result.repeats.push({elapsedMs,cpuVcpu:(used.user+used.system)/1000/elapsedMs,rss:process.memoryUsage().rss,p95:latencies[94],p99:latencies[98],eventLoopMaxMs:lag.max/1e6,rows:2000});store.close();rmSync(path);
}
// A dedicated bounded tmpfs only; never fill /tmp, a host disk, or a DB volume.
assert.equal(statfsSync('/testdisk').type,0x01021994);const size=statfsSync('/testdisk');assert.ok(size.blocks*size.bsize<=8*1048576);
let full=false;try{for(let n=0;n<20;n++)writeFileSync('/testdisk/chunk-'+n,Buffer.alloc(1048576));}catch(e){assert.equal(e.code,'ENOSPC');full=true;}assert.ok(full);result.dedicatedTmpfsFull=true;
result.memoryEvents=read('memory.events');result.ioStat=read('io.stat');result.memoryPeak=read('memory.peak');assert.ok(!/oom_kill [1-9]/.test(result.memoryEvents));
console.log(JSON.stringify(result,null,2));
