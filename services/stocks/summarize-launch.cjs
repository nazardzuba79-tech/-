// Evidence reporting only: completing this job is NOT a launch approval.
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]??'.ci-output/stock-launch');
const percentile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length*p)]??null;};
const summary={acceptance:false,reason:'Requires all gates, licensing and comparable deployment topology',variants:{}};
for(const variant of ['before','after','separated']){
  const dir=path.join(root,variant),file=path.join(dir,'comparison.json');
  if(!fs.existsSync(file)){summary.variants[variant]={incomplete:true};continue;}
  const data=JSON.parse(fs.readFileSync(file));const result={metadata:{cryptoCpu:data.cryptoCpu,stockCpu:data.stockCpu,diskDevice:data.diskDevice},cases:{}};
  for(const kind of [...new Set(data.results.map(r=>r.kind))]){
    const rows=data.results.filter(r=>r.kind===kind),samples=rows.flatMap(r=>Object.values(r.rawTimings).flat());
    const readers=rows.map(r=>{const p=path.join(dir,kind+'-'+r.repeat+'-readers.log');try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return {incomplete:true};}});
    const stock=rows.map(r=>{try{return JSON.parse(r.stock);}catch{return null;}}).filter(Boolean);
    result.cases[kind]={repeats:rows.length,calls:samples.length,p95:percentile(samples,.95),p99:percentile(samples,.99),max:Math.max(...samples),cryptoErrors:rows.flatMap(r=>r.errors).length,readers,stock};
  }
  const base=result.cases.A;
  for(const row of Object.values(result.cases))row.p95ChangePercent=base?100*(row.p95/base.p95-1):null;
  summary.variants[variant]=result;
}
fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary.variants).map(([variant,result])=>[variant,result.cases?Object.fromEntries(Object.entries(result.cases).map(([kind,r])=>[kind,{p95:r.p95,p95ChangePercent:r.p95ChangePercent,cryptoErrors:r.cryptoErrors,readerErrors:r.readers.reduce((n,x)=>n+(x.errors??0),0),socketDrops:r.stock.reduce((n,x)=>n+x.droppedConnections,0)}])):result])),null,2));
