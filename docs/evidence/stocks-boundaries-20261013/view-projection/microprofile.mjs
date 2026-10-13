import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const output=resolve(process.argv[2]??(tmpdir()+'/voltex-projection-profile-'+Date.now()));
const {createState,applyQuote,submit,validate,snapshot}=await import(pathToFileURL(repo+'/services/stocks-global/engine.mjs'));
const {CATALOG}=await import(pathToFileURL(repo+'/services/stocks-global/catalog.mjs'));
const sourceFiles=['server.mjs','engine.mjs','catalog.mjs','viewer-projection.mjs','../stocks-simulator/engine.mjs'];
const {projectViewerQuote}=await import(pathToFileURL(repo+'/services/stocks-global/viewer-projection.mjs'));
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
// HEAD is provenance; normalized source guards survive later documentation commits.
const expectedSourceHashes={"engine.mjs":"eaa4fada1be661d3e29a4102e5573c70bfa8f15a30f0da75aab8812dfe1cfa8c","catalog.mjs":"47e873004c8c1b29f8b82a4a474420470cece65c1add074e6016ab794e835e1a","viewer-projection.mjs":"3f987e647a0539ed11154919de5972060c297a2517ab2b4ec24aaba23466fd2b","../stocks-simulator/engine.mjs":"b7125711b5ea91ee99124df2d9bf541a8cea5388d56f0978aa595f74ac4bc2b8"};
for(const [file,hash] of Object.entries(expectedSourceHashes))assert.equal(createHash('sha256').update(readFileSync(repo+'/services/stocks-global/'+file,'utf8').replace(/\r\n/g,'\n')).digest('hex'),hash,'measured source changed: '+file);
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(repo+'/services/stocks-global/'+file)).digest('hex')]));
if(process.argv.includes('--check-source')){console.log(JSON.stringify({sha,sourceHashes,sourceGuards:'PASS'}));process.exit(0);}
const instruments=CATALOG.filter(i=>i.kind==='token').slice(0,20);
assert.equal(instruments.length,20);
const baseTime=1791569400000;
let serial=0;
const quote=(i,t,price='100')=>({instrumentId:i.id,provider:i.provider,nativeCurrency:i.currency,bid:price,ask:price,last:price,timestamp:t,receivedAt:t,verified:true,marketOpen:true,eventId:'micro-fixture-'+(++serial),capacity:'1.00000000',prices:{USDT:{buy:price,sell:price},USDC:{buy:price,sell:price}},fx:{USDC:{rate:'1',timestamp:t,maxAgeMs:180000,source:'OFFLINE FIXTURE ONLY'}}});
function fixture(historyOrders,catalogueSize){
 const s=createState(baseTime);let time=baseTime;
 for(let index=0;index<historyOrders;index++){
  const i=instruments[Math.floor(index/2)%instruments.length];time++;
  applyQuote(s,quote(i,time),time);
  submit(s,{id:'micro-order-'+String(++serial).padStart(20,'0'),instrumentId:i.id,currency:Math.floor(index/2)%2?'USDC':'USDT',side:index%2?'SELL':'BUY',type:'MARKET',quantity:'0.1'},time);
 }
 if(historyOrders){
  for(const [index,i] of instruments.entries()){
   time++;applyQuote(s,quote(i,time),time);
   submit(s,{id:'micro-order-'+String(++serial).padStart(20,'0'),instrumentId:i.id,currency:index%2?'USDC':'USDT',side:'BUY',type:'MARKET',quantity:'0.1'},time);
   submit(s,{id:'micro-order-'+String(++serial).padStart(20,'0'),instrumentId:i.id,currency:index%2?'USDC':'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'90'},time);
  }
 }
 validate(s);const now=time+10, id=instruments[0].id;
 const catalogue=Array.from({length:catalogueSize},(_,index)=>({...CATALOG[index%CATALOG.length],...(index>=CATALOG.length?{id:'OFFLINE-CATALOGUE-FIXTURE:'+index}:{}),exists:true,online:true}));
 const view={...snapshot(s,now),account:{id:'offline-user',mode:'isolated-paper',quoteView:'volatile',canTrade:false},catalogue,errors:{[id]:'SOURCE_UNAVAILABLE',unrelated:'RATE_LIMIT'},metrics:{requests:100,failures:0,historySerializations:20,historySerializeMs:3.2,accountQuoteCommits:0,accountQuoteObservations:0,accountQuoteMs:0,rssBytes:70000000,cpu:{user:1111,system:222},polling:false}};
 const q=quote(instruments[0],now,'101');
 return{view,q,now,id,historyOrders:s.orders.length,fills:s.fills.length,positions:Object.keys(s.positions).length,catalogueSize};
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
function baseline(view,q,now){const result=snapshot({...view,quotes:{...view.quotes,[q.instrumentId]:q}},now);delete result.errors[q.instrumentId];return result;}
function catalogueOnly(view,q,now){const {catalogue,...ledger}=view;const result={...snapshot({...ledger,quotes:{...ledger.quotes,[q.instrumentId]:q}},now),catalogue};delete result.errors[q.instrumentId];return result;}
const transportMetadata=(view,q,now)=>{const result=projectViewerQuote(view,q.instrumentId,q,now);delete result.errors[q.instrumentId];return result;};
const variants={baseline,transportMetadata};
const fixtures=[];for(const size of[20,CATALOG.length,250])for(const history of[0,200])fixtures.push(fixture(history,size));
let assertions=0;
for(const f of fixtures){
 const before=structuredClone(f);freeze(f);
 for(const delta of[0,30001,61001])for(const patch of[{}, {failed:true}, {verified:false}]){
  const q=freeze({...f.q,...patch});const expected=baseline(f.view,q,f.now+delta);
  for(const fn of[catalogueOnly,transportMetadata]){const actual=fn(f.view,q,f.now+delta);assert.deepEqual(actual,expected);assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));assertions+=2;}
 }
 for(const shape of['absent','undefined','null']){const view={...f.view};if(shape==='absent')delete view.account;else view.account=shape==='null'?null:undefined;freeze(view);assert.deepEqual(transportMetadata(view,f.q,f.now),baseline(view,f.q,f.now));assertions++;}
 assert.deepEqual(f,before);assertions++;
}
// Count clone input bytes separately from timed loops; count is a JSON-size proxy,
// not the V8 serializer's actual allocation or retained heap size.
const cloneMetrics=[];
const nativeClone=globalThis.structuredClone;
for(const f of fixtures)for(const [variant,fn] of Object.entries(variants)){
 let count=0,jsonInputBytes=0;globalThis.structuredClone=function(value){count++;jsonInputBytes+=Buffer.byteLength(JSON.stringify(value));return nativeClone(value);};
 try{fn(f.view,f.q,f.now);}finally{globalThis.structuredClone=nativeClone;}
 cloneMetrics.push({catalogue:f.catalogueSize,orders:f.historyOrders,fills:f.fills,positions:f.positions,variant,count,jsonInputBytes});
}
const rows=[];let sink=0;
for(const f of fixtures){
 const iterations=f.historyOrders===0?20000:f.historyOrders<=60?2000:1000;
 for(const fn of Object.values(variants))for(let i=0;i<150;i++)sink+=fn(f.view,f.q,f.now).orders.length;
 const schedules=[['baseline','transportMetadata'],['transportMetadata','baseline'],['baseline','transportMetadata']];
 for(let repeat=0;repeat<3;repeat++)for(const variant of schedules[repeat]){
  globalThis.gc?.();const heapBefore=process.memoryUsage().heapUsed;
  const cpuBefore=process.cpuUsage(),threadBefore=process.threadCpuUsage(),wallBefore=performance.now();
  for(let i=0;i<iterations;i++)sink+=variants[variant](f.view,f.q,f.now).orders.length;
  const wallMs=performance.now()-wallBefore,cpu=process.cpuUsage(cpuBefore),thread=process.threadCpuUsage(threadBefore),heapAfter=process.memoryUsage().heapUsed;
  globalThis.gc?.();const heapAfterGc=process.memoryUsage().heapUsed;
  rows.push({catalogue:f.catalogueSize,orders:f.historyOrders,fills:f.fills,positions:f.positions,repeat:repeat+1,variant,iterations,wallMs,processCpuMs:(cpu.user+cpu.system)/1000,threadCpuMs:(thread.user+thread.system)/1000,heapUncollectedDeltaBytes:heapAfter-heapBefore,heapPostGcDeltaBytes:heapAfterGc-heapBefore});
 }
}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const comparisons=[];for(const f of fixtures)for(const variant of['transportMetadata']){
 const old=rows.filter(r=>r.catalogue===f.catalogueSize&&r.orders===f.historyOrders&&r.variant==='baseline'),next=rows.filter(r=>r.catalogue===f.catalogueSize&&r.orders===f.historyOrders&&r.variant===variant);
 const baselineCpu=median(old.map(x=>x.threadCpuMs)),candidateCpu=median(next.map(x=>x.threadCpuMs));
 comparisons.push({catalogue:f.catalogueSize,orders:f.historyOrders,variant,baselineMedianThreadCpuMs:baselineCpu,candidateMedianThreadCpuMs:candidateCpu,threadCpuReductionPercent:(1-candidateCpu/baselineCpu)*100,baselineMedianWallMs:median(old.map(x=>x.wallMs)),candidateMedianWallMs:median(next.map(x=>x.wallMs))});
}
const result={schema:1,provenance:{sha,sourceHashes,node:process.version,platform:process.platform,scope:'OFFLINE FIXTURES ONLY; no external market calls, no HTTP or SQLite measurements',fixturePrices:'synthetic deterministic engine-test fixtures only',runtimeChangesDuringMeasurement:false,guardedEmptyOnly:true,sourceState:'Exact normalized source guards plus raw hashes; current Git HEAD recorded',originalLoadMatrixRerun:false},method:{iterationsByOrders:{0:20000,60:2000,240:1000},repeats:3,counterbalanced:true,warmupPerVariant:150,forcedGc:typeof globalThis.gc==='function',cloneInputBytes:'JSON encoded input proxy, not actual clone allocation',heapDelta:'GC-sensitive endpoint deltas, not total allocation; not acceptance criterion'},assertions,sink,cloneMetrics,rows,comparisons};
mkdirSync(output,{recursive:true});writeFileSync(output+'/result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sha,assertions,rows:rows.length,comparisons},null,2));
