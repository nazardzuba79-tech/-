// Local fixture-only serialization microbenchmark. No network, account database,
// production state, HTTP listener, worker, or trading endpoint is opened.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const root = resolve(process.argv[2]);
const output = dirname(fileURLToPath(import.meta.url));
const sources = ['services/stocks/state-response-serialization.mjs', 'services/stocks-global/engine.mjs', 'services/stocks-global/catalog.mjs', 'services/stocks-simulator/engine.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries(sources.map(f => [f, sha(readFileSync(resolve(root, f)))]));
const { createStateResponseSerializer } = await import(pathToFileURL(resolve(root, sources[0])));
const { createState, applyQuote, submit, snapshot, validate } = await import(pathToFileURL(resolve(root, sources[1])));
const { CATALOG } = await import(pathToFileURL(resolve(root, sources[2])));
const time = 1792062793000, id = 'BYBIT:AAPLXUSDT';
const stamp = new Date().toISOString();
const started = performance.now();
const quote = (price, event) => ({ instrumentId:id, provider:'bybit', nativeCurrency:'USDT', bid:price, ask:price, last:price, timestamp:time, receivedAt:time, verified:true, marketOpen:true, eventId:event, capacity:'1.00000000', prices:{USDT:{buy:price,sell:price},USDC:{buy:price,sell:price}}, fx:{USDC:{rate:'1',timestamp:time,maxAgeMs:180000,source:'BENCHMARK FIXTURE ONLY'}},multiplier:'1.0032690125398187' });
const fresh = createState(time);
const held = createState(time);
applyQuote(held, quote('100.00000000','fixture-buy'), time);
submit(held, {id:'fixture-request-00000000000000000001',instrumentId:id,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.50000000'}, time);
applyQuote(held, quote('102.00000000','fixture-sell'), time);
submit(held, {id:'fixture-request-00000000000000000002',instrumentId:id,currency:'USDT',side:'SELL',type:'MARKET',quantity:'0.10000000'}, time);
submit(held, {id:'fixture-request-00000000000000000003',instrumentId:id,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.10000000',limitPrice:'99.00000000'}, time);
validate(held);
const emptyView = snapshot(fresh,time), heldView=snapshot(held,time);
assert.ok(heldView.orders.length === 3 && heldView.fills.length === 2);

// Preserve engine-created row schema; expanded historical rows are synthetic
// performance fixtures only, not a claim that these ledgers passed trading tests.
function historyShape(orders, fills) {
  const v = structuredClone(heldView);
  v.orders = Array.from({length:orders},(_,i)=>({...heldView.orders[i%heldView.orders.length],id:`fixture-order-${i}`}));
  v.fills = Array.from({length:fills},(_,i)=>({...heldView.fills[i%heldView.fills.length],id:`fixture-fill-${i}`,orderId:`fixture-order-${i%Math.max(1,orders)}`}));
  return v;
}
function totals(value, depth=0, result={objects:0,entries:0,characters:0,maxDepth:0}) {
  if(typeof value==='string') result.characters+=value.length;
  else if(value && typeof value==='object') {
    result.objects++; result.maxDepth=Math.max(result.maxDepth,depth);
    result.entries+=Array.isArray(value)?value.length:Object.keys(value).length;
    for(const [key, val] of Object.entries(value)) {
      result.characters+=key.length;
      if(depth===0 && key==='catalogue') continue;
      totals(val,depth+1,result);
    }
  }
  return result;
}
function body(view, catalogue, variant) {
  // Root/position/quote objects are distinct per account; immutable history arrays
  // are reused between fixture variants to bound benchmark setup memory.
  const value={...view,revision:variant+4,serverTime:time+variant,
    wallets:structuredClone(view.wallets),positions:structuredClone(view.positions),quotes:structuredClone(view.quotes),
    account:{id:variant%2?'bob':'alice',mode:'isolated-paper',quoteView:'volatile',canTrade:variant%2===0},
    catalogue,errors:variant%3===0?{[id]:'RATE_LIMIT'}:{},metrics:{requests:12+variant,accountQuoteCommits:0,accountQuoteObservations:variant,accountQuoteMs:variant/100,historySerializations:2,historySerializeMs:0.01,rssBytes:60000000+variant,cpu:{user:10+variant,system:2},polling:variant%2===0},token:`fixture-token-${variant%2}-${variant}`};
  value.wallets.USDT.cash=variant%2?'2000.00000000':view.wallets.USDT.cash;
  value.wallets.USDT.available=variant%2?'1990.10000000':view.wallets.USDT.available;
  for(const q of Object.values(value.quotes)) {q.ageSeconds=variant; q.status={...q.status,USDT:variant%3===0?'QUOTE_STALE':'READY'};}
  for(const p of Object.values(value.positions)) {p.mark=variant%3===0?null:'103.00000000';p.unrealized=variant%3===0?null:'1.20000000';}
  return value;
}
let cutoff=0;
for(let n=0;n<200;n++) {const t=totals(body(historyShape(3,n),[],1));if(t.entries>512||t.objects>128||t.characters>32768){cutoff=n;break;}}
assert.ok(cutoff>1);
const shapes=[['empty',emptyView],['small-nonempty',heldView],['cutoff-below',historyShape(3,cutoff-1)],['cutoff-above',historyShape(3,cutoff)],['large-ledger',historyShape(10000,50000)]];
const stats = a => {const s=[...a].sort((x,y)=>x-y);return {count:s.length,mean:s.reduce((x,y)=>x+y,0)/s.length,p50:s[Math.floor((s.length-1)*.5)],p95:s[Math.floor((s.length-1)*.95)],p99:s[Math.floor((s.length-1)*.99)],min:s[0],max:s.at(-1)};};
const memory = () => {const m=process.memoryUsage();return {rss:m.rss,heapUsed:m.heapUsed,heapTotal:m.heapTotal,external:m.external};};
const results={schema:1,kind:'LOCAL_SERIALIZER_MICROBENCHMARK_ONLY',balancedOrder:'6 paired rounds AB/BA; baseline and candidate each first in 3 rounds',fixtureOnly:true,capacityAcceptance:'NOT_RUN',externalRequests:0,sqliteOpened:false,sourceHashes,scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))),startedAt:stamp,environment:{platform:process.platform,node:process.version,arch:process.arch,cpuModel:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),cpuQuota:'UNCONTROLLED_WINDOWS_HOST',ioThrottle:'NONE',gcExposed:typeof global.gc==='function'},limitations:['No HTTP/auth/SQLite/account worker timing','No cgroup CPU/RAM/I/O equivalence','No Spot/Futures coexistence test','Synthetic rows are benchmark fixtures only','Batch CPU includes equality checking/harness and is process-wide; per-call wall excludes equality comparison','RSS is process high-water/current observation, not memory attributable exclusively to one serializer','Exact catalogue publication, dynamic snapshots and byte equality are measured; end-to-end workload acceptance is not'],publication:[],cases:[]};
let checked=0;
for(const count of [20,40]) {
  const source=CATALOG.slice(0,count).map(i=>({...i,exists:true,online:i.provider!=='moex',multiplier:i.provider==='bybit'?'1.0032690125398187':null,checkedAt:time,display:i.provider==='moex'?null:{price:'102.00000000',change24h:1.25,timestamp:time,source:'BENCHMARK FIXTURE ONLY'},sourceError:i.provider==='moex'?'MOEX_UNVERIFIED':null}));
  const serializer=createStateResponseSerializer();
  const publicationTimes=[]; const pm=memory(),pc=process.cpuUsage();
  for(let n=0;n<200;n++) {const t=performance.now();const p=serializer.publishCatalogue(source);publicationTimes.push(performance.now()-t);assert.equal(JSON.stringify(p),JSON.stringify(source));checked++;}
  results.publication.push({instruments:count,wallMs:stats(publicationTimes),cpuUs:process.cpuUsage(pc),memoryBefore:pm,memoryAfter:memory()});
  const published=serializer.publishCatalogue(source);
  for(const [name,view] of shapes) {
    if(performance.now()-started>110000)throw Error('BENCHMARK_BOUNDED_TIME_EXCEEDED');
    const big=name==='large-ledger',variants=big?2:8,iterations=big?4:2000;
    const inputs=Array.from({length:variants},(_,i)=>body(view,published,i));
    const references=inputs.map(v=>JSON.stringify(v));
    const inputHashes=references.map(s=>sha(s));
    for(let i=0;i<inputs.length;i++){assert.equal(serializer.stringify(inputs[i]),references[i]);checked++;}
    const item={instruments:count,shape:name,historyOrders:view.orders.length,historyFills:view.fills.length,variants,referenceByteSizes:references.map(s=>Buffer.byteLength(s)),inputSha256:inputHashes,shapeWithoutCatalogue:totals(inputs[1]),runs:[]};
    for(let rep=0;rep<6;rep++) {
      for(const mode of (rep%2===0?['baseline','candidate']:['candidate','baseline'])) {
        const encode=mode==='baseline'?JSON.stringify:v=>serializer.stringify(v);
        for(let n=0;n<(big?1:30);n++){const i=n%variants;assert.equal(encode(inputs[i]),references[i]);checked++;}
        if(global.gc)global.gc();
        const mb=memory(),cpu=process.cpuUsage(),batch=performance.now(),times=[];
        for(let n=0;n<iterations;n++){const i=n%variants,t=performance.now();const encoded=encode(inputs[i]);times.push(performance.now()-t);assert.equal(encoded,references[i]);checked++;}
        const elapsed=performance.now()-batch,used=process.cpuUsage(cpu),ma=memory();
        item.runs.push({repeat:rep+1,mode,iterations,wallMs:stats(times),batchElapsedMs:elapsed,cpuUs:used,cpuUsPerCall:(used.user+used.system)/iterations,memoryBefore:mb,memoryAfter:ma,heapDeltaBytes:ma.heapUsed-mb.heapUsed});
      }
    }
    const b=item.runs.filter(r=>r.mode==='baseline'),c=item.runs.filter(r=>r.mode==='candidate');
    const mean = (rows,key) => rows.reduce((a,r)=>a+key(r),0)/rows.length;
    item.summary={baselineMeanMs:mean(b,r=>r.wallMs.mean),candidateMeanMs:mean(c,r=>r.wallMs.mean),baselineCpuUsPerCall:mean(b,r=>r.cpuUsPerCall),candidateCpuUsPerCall:mean(c,r=>r.cpuUsPerCall)};
    item.summary.wallChangePercent=100*(item.summary.candidateMeanMs/item.summary.baselineMeanMs-1);
    item.summary.cpuChangePercent=100*(item.summary.candidateCpuUsPerCall/item.summary.baselineCpuUsPerCall-1);
    results.cases.push(item);
    console.log(JSON.stringify({instruments:count,shape:name,bytes:item.referenceByteSizes[0],...item.summary}));
  }
}
for(const file of sources)assert.equal(sha(readFileSync(resolve(root,file))),sourceHashes[file],'SOURCE_CHANGED_DURING_BENCHMARK:'+file);
results.exactByteComparisons=checked;results.finishedAt=new Date().toISOString();results.elapsedMs=performance.now()-started;results.sourceUnchanged=true;
writeFileSync(resolve(output,'serializer-benchmark-v2-results.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({status:'PASS_BYTE_EQUIVALENCE',exactByteComparisons:checked,elapsedMs:results.elapsedMs,sourceHashes,resultSha256:sha(readFileSync(resolve(output,'serializer-benchmark-v2-results.json')))}));
