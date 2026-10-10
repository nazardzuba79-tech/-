// Isolated reader generator; same concurrency, URLs, timeout and cadence as before.
const fs=require('fs');const manifest=JSON.parse(fs.readFileSync(__dirname+'/manifest.json'));
const concurrency=Number(process.argv[2]),cold=process.argv[3]==='cold';
let stopped=false,n=0,ok=0,errors=0;const statuses={},failures={};
const count=(map,key)=>map[key]=(map[key]??0)+1;
async function loop(){while(!stopped){const id=manifest[n++%250].instrumentId;try{
  const r=await fetch('http://127.0.0.1:18091/stocks/history/'+id+(cold?'?before='+String(Date.now()-(n%500)*1000):''),{signal:AbortSignal.timeout(3000)});
  await r.arrayBuffer();count(statuses,String(r.status));if(r.ok)ok++;else errors++;
}catch(e){errors++;count(failures,e.cause?.code??e.name);}if(!stopped)await new Promise(r=>setTimeout(r,200));}}
const jobs=Array.from({length:concurrency},()=>loop());
process.on('SIGTERM',async()=>{if(stopped)return;stopped=true;await Promise.allSettled(jobs);
  console.log(JSON.stringify({concurrency,cold,ok,errors,statuses,failures,drained:true}));process.exit();});
