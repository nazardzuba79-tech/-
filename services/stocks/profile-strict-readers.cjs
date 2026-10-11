// Observational mirror of read-load.cjs. Original workload/acceptance file is untouched.
// Same fetch/full-body drain, 250-ID rotation, before cursor, 3s timeout, 200ms post-request cadence.
const fs=require('fs'),{performance}=require('perf_hooks');
const manifest=JSON.parse(fs.readFileSync(__dirname+'/manifest.json'));
const concurrency=Number(process.argv[2]),cold=process.argv[3]==='cold';
if(![50,100].includes(concurrency))throw Error('Expected 50 or 100 readers');
let stopped=false,n=0,ok=0,errors=0;const statuses={},failures={},latencies=[],allLatencies=[];
const count=(map,key)=>map[key]=(map[key]??0)+1;
const percentile=(v,p)=>v.length?[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.ceil(v.length*p)-1)]:null;
async function loop(){while(!stopped){const id=manifest[n++%250].instrumentId,start=performance.now();try{
  const r=await fetch('http://127.0.0.1:18091/stocks/history/'+id+(cold?'?before='+String(Date.now()-(n%500)*1000):''),{signal:AbortSignal.timeout(3000)});
  await r.arrayBuffer();count(statuses,String(r.status));if(r.ok){ok++;latencies.push(performance.now()-start);}else errors++;
}catch(e){errors++;count(failures,e.cause?.code??e.name);}finally{allLatencies.push(performance.now()-start);}if(!stopped)await new Promise(r=>setTimeout(r,200));}}
const jobs=Array.from({length:concurrency},()=>loop());
process.on('SIGTERM',async()=>{if(stopped)return;stopped=true;await Promise.allSettled(jobs);
  const summary=v=>({p50:percentile(v,.5),p95:percentile(v,.95),p99:percentile(v,.99),max:v.length?Math.max(...v):null});
  console.log(JSON.stringify({fixture:true,observationalMirror:true,concurrency,cold,ok,errors,statuses,failures,successLatencyMs:summary(latencies),allAttemptLatencyMs:summary(allLatencies),deadlineMs:3000,timeoutSamplesCensored:true,notes:'Successful latency excludes timed-out attempts; all-attempt elapsed includes timeout detection/drain overhead. Original read-load.cjs remains the acceptance workload.',drained:true}));process.exit();});
if(process.env.STOCK_PROFILE_SECONDS)setTimeout(()=>process.emit('SIGTERM'),Number(process.env.STOCK_PROFILE_SECONDS)*1000).unref();
