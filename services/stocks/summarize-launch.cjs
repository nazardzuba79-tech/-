// Evidence reporting only: completing this job is NOT a launch approval.
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]??'.ci-output/stock-launch');
const percentile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length*p)]??null;};
const summary={acceptance:false,incomplete:false,reason:'Requires all gates, licensing and comparable deployment topology',variants:{}};
const validCounter=value=>Number.isSafeInteger(value)&&value>=0;
for(const variant of ['before','after','separated']){
  const dir=path.join(root,variant),file=path.join(dir,'comparison.json');
  if(!fs.existsSync(file)){summary.variants[variant]={incomplete:true};summary.incomplete=true;continue;}
  const data=JSON.parse(fs.readFileSync(file));const result={incomplete:data.results.length===0,metadata:{cryptoCpu:data.cryptoCpu,stockCpu:data.stockCpu,diskDevice:data.diskDevice},cases:{}};
  for(const kind of [...new Set(data.results.map(r=>r.kind))]){
    const rows=data.results.filter(r=>r.kind===kind),samples=rows.flatMap(r=>Object.values(r.rawTimings).flat());
    // A/B/C deliberately start zero reader loops; Node exits before SIGTERM and leaves an empty log.
    // Do not confuse that documented no-reader control with lost evidence from an active workload.
    const readers=rows.map(r=>{if(['A','B','C'].includes(kind))return {notApplicable:true,concurrency:0,ok:0,errors:0};const p=path.join(dir,kind+'-'+r.repeat+'-readers.log');try{const reader=JSON.parse(fs.readFileSync(p,'utf8'));return reader&&reader.drained===true&&validCounter(reader.ok)&&validCounter(reader.errors)&&!reader.incomplete?reader:{...reader,incomplete:true};}catch{return {incomplete:true};}});
    const incompleteReaderRepeats=rows.filter((_,i)=>readers[i].incomplete).map(r=>r.repeat);
    const readerErrorsKnown=readers.reduce((n,r)=>n+(validCounter(r.errors)?r.errors:0),0);
    const repeatsComplete=rows.length===3&&[0,1,2].every(repeat=>rows.some(r=>r.repeat===repeat));
    const incomplete=incompleteReaderRepeats.length>0||!repeatsComplete;
    const stock=rows.map(r=>{try{return JSON.parse(r.stock);}catch{return null;}}).filter(Boolean);
    result.cases[kind]={incomplete,repeatsComplete,incompleteReaderRepeats,readerErrors:incomplete?null:readerErrorsKnown,readerErrorsKnown,repeats:rows.length,calls:samples.length,p95:percentile(samples,.95),p99:percentile(samples,.99),max:Math.max(...samples),cryptoErrors:rows.flatMap(r=>r.errors).length,readers,stock};
    result.incomplete ||= incomplete;
  }
  const base=result.cases.A;
  for(const row of Object.values(result.cases))row.p95ChangePercent=base?100*(row.p95/base.p95-1):null;
  summary.variants[variant]=result;
  summary.incomplete ||= result.incomplete;
}
fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary.variants).map(([variant,result])=>[variant,result.cases&&Object.keys(result.cases).length?Object.fromEntries(Object.entries(result.cases).map(([kind,r])=>[kind,{incomplete:r.incomplete,p95:r.p95,p95ChangePercent:r.p95ChangePercent,cryptoErrors:r.cryptoErrors,readerErrors:r.readerErrors,readerErrorsKnown:r.readerErrorsKnown,socketDrops:r.stock.reduce((n,x)=>n+x.droppedConnections,0)}])):result])),null,2));
// Evidence jobs must retain their artifacts, but a missing/undrained reader cannot be green.
if(summary.incomplete)process.exitCode=1;
