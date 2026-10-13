// Evidence reporting only: completing this job is NOT a launch approval.
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]??'.ci-output/stock-launch');
const percentile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length*p)]??null;};
const summary={acceptance:false,incomplete:false,reason:'Requires all gates, licensing and comparable deployment topology',variants:{}};
const validCounter=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keysEqual=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const total=counts=>Object.values(counts).reduce((n,value)=>n+value,0);
const counters=value=>object(value)&&Object.values(value).every(validCounter);
// These are the existing launch-resource-comparison workflow sets, not a new workload.
const expectedCases={before:['A','B','C','D10','D50','D100','E','F'],
  after:['A','B','C','D10','D50','D100','E','F'],separated:['A','C','D100','F']};
// crypto-comparison.cjs: 80 measured cycles after 3 warmups, 14 operations/cycle.
// Alternating cycles close explicitly; remaining cycles split equally between SL and TP.
const operationCounts=Object.fromEntries(['spotCreate','spotCancel','spotMaker','spotFill',
  'futuresCreate','futuresCancel','futuresMaker','futuresOpen','tpslSet','tpslState',
  'tpslSweep','stateRead'].map(key=>[key,80]));
Object.assign(operationCounts,{futuresCloseMaker:40,futuresClose:40,
  protectionLiquidity:40,stopLossTrigger:20,takeProfitTrigger:20});
const statistics=values=>({n:values.length,p50:percentile(values,.5),p95:percentile(values,.95),
  p99:percentile(values,.99),max:values.length?Math.max(...values):null});
const matchingStats=(reported,values)=>object(reported)&&Object.entries(statistics(values)).every(([key,value])=>reported[key]===value);
const expectedConcurrency=kind=>kind.startsWith('D')?Number(kind.slice(1)):kind==='F'?100:kind==='E'?10:0;
function metadataValid(data,variant){
  return data.transport==='real service calls; NOT HTTP/E2E'
    &&['cryptoCpu','loadCpu','stockCpu'].every(key=>typeof data[key]==='string'&&/^\d+$/.test(data[key]))
    &&data.cryptoCpu!==data.loadCpu&&data.stockCpu===(variant==='separated'?data.loadCpu:data.cryptoCpu)
    &&data.stockImage===(variant==='before'?'voltex-stock-before':'voltex-stock-after')
    &&(data.diskDevice===null||typeof data.diskDevice==='string'&&data.diskDevice.startsWith('/dev/'))
    &&Array.isArray(data.limitations)&&data.limitations.every(value=>typeof value==='string');
}
function cryptoValid(row){
  if(!keysEqual(row.rawTimings,Object.keys(operationCounts))
    ||!Object.entries(operationCounts).every(([key,n])=>Array.isArray(row.rawTimings[key])
      &&row.rawTimings[key].length===n&&row.rawTimings[key].every(finite))
    ||!Array.isArray(row.rawScheduling)||row.rawScheduling.length!==80||!row.rawScheduling.every(finite)
    ||!finite(row.elapsedMs)||row.elapsedMs===0||!finite(row.eventLoopMaxMs)
    ||!Array.isArray(row.errors)||!row.errors.every(error=>object(error)
      &&Object.hasOwn(operationCounts,error.name)&&typeof error.error==='string'))return false;
  return matchingStats(row.latency,Object.values(row.rawTimings).flat())
    &&keysEqual(row.perOperation,Object.keys(operationCounts))
    &&Object.keys(operationCounts).every(key=>matchingStats(row.perOperation[key],row.rawTimings[key]))
    &&matchingStats(row.scheduling,row.rawScheduling);
}
function readerValid(reader,kind){
  if(!object(reader)||reader.drained!==true||reader.incomplete
    ||reader.concurrency!==expectedConcurrency(kind)||reader.cold!==(kind==='F')
    ||!validCounter(reader.ok)||!validCounter(reader.errors)||reader.ok+reader.errors===0
    ||!counters(reader.statuses)||!counters(reader.failures)
    ||!Object.keys(reader.statuses).every(key=>/^[1-5]\d{2}$/.test(key)))return false;
  const successes=Object.entries(reader.statuses).reduce((n,[key,value])=>n+(Number(key)>=200&&Number(key)<300?value:0),0);
  return successes===reader.ok&&total(reader.statuses)-successes+total(reader.failures)===reader.errors;
}
function stockValid(stock,row,data){
  if(row.kind==='A')return row.stock===null;
  if(!object(stock)||stock.scenario!==row.kind
    ||stock.faultKind!==(row.kind==='E'?['429','500','timeout'][row.repeat]:null))return false;
  if(!['written','writeBatches','faults','historyReads','cacheBytes','cacheEntries',
    'maxConnections','rss','dataBytes','droppedConnections','cachePending'].every(key=>validCounter(stock[key]))
    ||!['historyReadMs','elapsedMs','cpuVcpu','eventLoopMaxMs'].every(key=>finite(stock[key]))
    ||stock.elapsedMs===0||stock.rss===0||stock.dataBytes===0||stock.maxConnections===0)return false;
  const recorded=value=>typeof value==='string'&&!value.startsWith('UNAVAILABLE:');
  return object(stock.initial)&&recorded(stock.initial.cpu)&&/\busage_usec \d+/.test(stock.initial.cpu)
    &&recorded(stock.initial.io)&&['cpuMax','cpuStat','ioMax','ioStat','ioPressure','memoryEvents'].every(key=>recorded(stock[key]))
    &&/^(?:\d+|max) \d+\s*$/.test(stock.cpuMax)&&/\busage_usec \d+/.test(stock.cpuStat)
    &&(data.diskDevice===null||stock.ioMax.trim().length>0)
    &&/\boom \d+/.test(stock.memoryEvents)&&/\boom_kill \d+/.test(stock.memoryEvents)
    &&stock.ioPressure.includes('some ')&&stock.ioPressure.includes('full ');
}
for(const [variant,kinds] of Object.entries(expectedCases)){
  const dir=path.join(root,variant),file=path.join(dir,'comparison.json'),issues=[];
  let data;
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{issues.push('COMPARISON_MISSING_OR_INVALID_JSON');}
  if(!object(data)){issues.push('COMPARISON_INVALID');data={};}
  if(!metadataValid(data,variant))issues.push('COMPARISON_PROVENANCE_INVALID');
  if(!Array.isArray(data.results))issues.push('COMPARISON_RESULTS_INVALID');
  const sourceRows=Array.isArray(data.results)?data.results:[];
  if(sourceRows.some(row=>!object(row)||!kinds.includes(row.kind)))issues.push('UNEXPECTED_CASE_OR_INVALID_ROW');
  const result={incomplete:issues.length>0,issues,expectedCases:kinds,
    metadata:{cryptoCpu:data.cryptoCpu,stockCpu:data.stockCpu,diskDevice:data.diskDevice,
      loadCpu:data.loadCpu,stockImage:data.stockImage,transport:data.transport},cases:{}};
  for(const kind of kinds){
    const rows=sourceRows.filter(row=>object(row)&&row.kind===kind);
    const repeatsComplete=rows.length===3&&[0,1,2].every(repeat=>rows.some(row=>row.repeat===repeat));
    // A/B/C have zero reader loops and can exit before SIGTERM without emitting a log.
    const readers=rows.map(row=>{
      if(expectedConcurrency(kind)===0)return {notApplicable:true,concurrency:0,ok:0,errors:0};
      // Invalid repeat IDs must not become filesystem selectors.
      if(![0,1,2].includes(row.repeat))return {incomplete:true};
      try{const reader=JSON.parse(fs.readFileSync(path.join(dir,kind+'-'+row.repeat+'-readers.log'),'utf8'));
        return readerValid(reader,kind)?reader:{...(object(reader)?reader:{}),incomplete:true};
      }catch{return {incomplete:true};}
    });
    const incompleteReaderRepeats=rows.filter((_,i)=>readers[i].incomplete).map(row=>row.repeat);
    const incompleteCryptoRepeats=rows.filter(row=>!cryptoValid(row)).map(row=>row.repeat);
    const stock=rows.map(row=>{try{return JSON.parse(row.stock);}catch{return null;}});
    const incompleteStockRepeats=rows.filter((row,i)=>!stockValid(stock[i],row,data)).map(row=>row.repeat);
    const cryptoComplete=repeatsComplete&&incompleteCryptoRepeats.length===0;
    const samples=cryptoComplete?rows.flatMap(row=>Object.values(row.rawTimings).flat()):[];
    const readerErrorsKnown=readers.reduce((n,reader)=>n+(validCounter(reader.errors)?reader.errors:0),0);
    const cryptoErrorsKnown=rows.reduce((n,row)=>n+(Array.isArray(row.errors)?row.errors.length:0),0);
    const socketDropsKnown=stock.reduce((n,value)=>n+(validCounter(value?.droppedConnections)?value.droppedConnections:0),0);
    const incomplete=issues.length>0||!repeatsComplete||incompleteReaderRepeats.length>0
      ||incompleteCryptoRepeats.length>0||incompleteStockRepeats.length>0;
    result.cases[kind]={incomplete,repeatsComplete,incompleteReaderRepeats,incompleteCryptoRepeats,incompleteStockRepeats,
      readerErrors:incomplete?null:readerErrorsKnown,readerErrorsKnown,repeats:rows.length,
      calls:cryptoComplete?samples.length:null,p95:percentile(samples,.95),p99:percentile(samples,.99),
      max:samples.length?Math.max(...samples):null,cryptoErrors:cryptoComplete?cryptoErrorsKnown:null,cryptoErrorsKnown,
      socketDrops:incomplete?null:socketDropsKnown,socketDropsKnown,readers,stock:stock.filter(object)};
    result.incomplete ||= incomplete;
  }
  const base=result.cases.A;
  for(const row of Object.values(result.cases))row.p95ChangePercent=finite(row.p95)&&finite(base.p95)&&base.p95>0?100*(row.p95/base.p95-1):null;
  summary.variants[variant]=result;summary.incomplete ||= result.incomplete;
}
fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary.variants).map(([variant,result])=>[variant,
  Object.fromEntries(Object.entries(result.cases).map(([kind,row])=>[kind,{incomplete:row.incomplete,
    p95:row.p95,p95ChangePercent:row.p95ChangePercent,cryptoErrors:row.cryptoErrors,
    readerErrors:row.readerErrors,readerErrorsKnown:row.readerErrorsKnown,socketDrops:row.socketDrops}]))])),null,2));
// Missing groups, raw samples, provenance or shutdown evidence cannot be green.
if(summary.incomplete)process.exitCode=1;
