const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const base='output/performance-phase2/';
const read=(label,file)=>JSON.parse(fs.readFileSync(base+label+'/'+file,'utf8'));
const before=read('baseline-stable','browser.json'),after=read('candidate','browser.json');
const a=before.stages.find(s=>s.name==='visible-active-60s'),b=after.stages.find(s=>s.name==='visible-active-60s');
assert(a.elapsedMs>=60000&&b.elapsedMs>=60000);
assert(b.counters['candles.setData']<a.counters['candles.setData']*.3,'at least 70% fewer full candle replacements');
assert(b.counters['markers.setMarkers']<a.counters['markers.setMarkers']*.3,'at least 70% fewer marker updates');
assert.equal(after.stages.find(s=>s.name==='hidden-active-60s').counters['candles.setData']??0,0,'no hidden full candle replacement');
for(const report of[before,after]){
 assert(!report.stages.find(s=>s.name==='visible-empty-60s').network['GET /api/v1/private-trading/native/live']);
 const hidden=report.stages.find(s=>s.name==='hidden-active-60s');assert(!hidden.network['GET /api/v1/private-trading/native/live']);assert.equal(hidden.fixtureWsFrames,0);
 assert.equal(report.stages.find(s=>s.name==='visible-active-60s').network['GET /api/v1/private-trading/native/live'].calls,2);
}
assert(after.checks.length>=8&&after.checks.every(c=>c.pass),'existing financial/browser scenarios');
assert(after.acceptance.checks.every(c=>c.passed));assert.deepEqual(after.acceptance.errors,[]);
const dbBefore=read('baseline','database.json'),dbAfter=read('candidate','database.json');
for(let i=0;i<2;i++)for(const field of['dbWireBytes','sqlReads','sqlWrites','responseBytes','maxResponseBytes','marketCalls'])assert.deepEqual(dbAfter.measurements[i][field],dbBefore.measurements[i][field],field);
const financial=[];
for(const file of['live-values.json','executor-values.json']){
 // Independent fixtures allocate random position UUIDs. All other position and
 // account fields (including every exact decimal) are compared without tolerance.
 const canonical=label=>read(label,file).map(v=>({...v,positions:v.positions.map(({id,...p})=>p)}));
 const x=JSON.stringify(canonical('baseline')),y=JSON.stringify(canonical('candidate'));assert(x===y,file+' financial equality');
 financial.push({file,cycles:120,excluded:'random fixture position id only',sha256:createHash('sha256').update(x).digest('hex')});
}
const result={passed:true,financial,chart:{before:a.counters,after:b.counters},backendEgressUnchanged:true,liveCadenceUnchanged:true,emptyAndHiddenLiveIdle:true};
fs.writeFileSync(base+'comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
const number=n=>typeof n==='number'?n.toLocaleString('en-US',{maximumFractionDigits:2}):String(n);
const table=(header,rows)=>['| '+header.join(' | ')+' |','| '+header.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.map(number).join(' | ')+' |')].join('\n');
const rows=[];
for(const name of['visible-empty-60s','visible-active-60s','hidden-active-60s','history-scroll','mobile-workspaces-calculator']){
 const x=before.stages.find(s=>s.name===name),y=after.stages.find(s=>s.name===name);
 for(const metric of['candles.setData','candles.points','markers.setMarkers','candles.createPriceLine','render.PriceChart']){const u=x.counters[metric]??0,v=y.counters[metric]??0;rows.push([name+' / '+metric,u,v,u?((v/u-1)*100).toFixed(1)+'%':'—']);}
}
let md='\n## Measured comparison\n\n'+table(['Metric','Before','After','Delta'],rows)+'\n\n';
md+='Reference run: baseline-stable; candidate run: candidate. Both use the same 200 ms synthetic depth source and real 60-second windows. Parent render counts are intentionally not suppressed. Timings/heap vary with GC, OS scheduling and concurrent test processes; call/byte counts and deterministic regression assertions are the primary evidence.\n\n';
md+=table(['Stage','Before task ms','After task ms','Before elapsed ms','After elapsed ms','Before heap delta','After heap delta'],before.stages.map(x=>{const y=after.stages.find(s=>s.name===x.name);return[x.name,x.taskMs,y.taskMs,x.elapsedMs,y.elapsedMs,x.heapEnd-x.heapStart,y.heapEnd-y.heapStart]}))+'\n\n';
md+='## Network audit: active Futures, 60 seconds\n\n';
md+=table(['Endpoint','Calls/min before→after','Transfer bytes before→after','p50 ms before→after','p95 ms before→after','Required / dedupe / cache / cadence / risk'],Object.entries(a.network).map(([endpoint,x])=>{const y=b.network[endpoint]||{calls:0,bytes:0};let policy='Existing display read; no change. Cache/dedupe requires source-specific freshness evidence.';
 if(endpoint.includes('/native/live'))policy='Required active account; compact + serialized already; no shared account cache; keep 30s; high financial display risk.';
 if(endpoint.includes('/access'))policy='Required security verdict; no cache/cadence change; high access risk.';
 if(endpoint.includes('/candles'))policy='Required chart; existing loader coalesces; incremental response could help but needs separate contract; keep 5s/history correctness.';
 if(endpoint.includes('/mark-price'))policy='Required server mark; two consumers (4s/5s), candidate for coalescing only with proven freshness; unchanged.';
 if(endpoint.includes('/admin/'))policy='Existing navigation badge reads; fixture 403; no conclusion about production payload/DB cost; unchanged.';
 return[endpoint,`${x.calls} → ${y.calls}`,`${x.bytes} → ${y.bytes}`,`${number(x.p50Ms)} → ${number(y.p50Ms)}`,`${number(x.p95Ms)} → ${number(y.p95Ms)}`,policy]}))+'\n\n';
md+='Config/contract/universe are loaded during initialization; full per-stage endpoints, status codes, max latency, byte counts and bundle list are in the JSON evidence. History is absent from idle polling and loaded on demand by the unchanged browser scenarios. No cadence was slowed.\n\n';
md+=table(['Database workload','Wire bytes before→after','Reads before→after','Writes before→after','API JSON bytes before→after','p50 / p95 / max ms after'],dbBefore.measurements.map((x,i)=>{const y=dbAfter.measurements[i];return[x.mode,`${x.dbWireBytes} → ${y.dbWireBytes}`,`${x.sqlReads} → ${y.sqlReads}`,`${x.sqlWrites} → ${y.sqlWrites}`,`${x.responseBytes} → ${y.responseBytes}`,`${number(y.p50Ms)} / ${number(y.p95Ms)} / ${number(y.maxMs)}`]}))+'\n\n';
md+='All 120 account and position financial results match exactly in both workloads, without decimal tolerance. Independent random fixture position IDs are excluded from that comparison. No backend, financial, Prisma schema/migration or authorization source is changed. Exact whole-journal replay equivalence for a changed backend is therefore not claimed or needed; existing replay suites are still run.\n\n';
md+='## Bundle comparison (uninstrumented production output)\n\n';
md+=table(['Chunk','Before raw/gzip bytes','After raw/gzip bytes'],before.bundles.slice(0,10).map(x=>{const stem=x.file.slice(0,-12);const y=after.bundles.find(f=>f.file.slice(0,-12)===stem);return[stem,`${x.raw} / ${x.gzip}`,y?`${y.raw} / ${y.gzip}`:'see full list']}))+'\n';
fs.writeFileSync(base+'comparison.md',md);
