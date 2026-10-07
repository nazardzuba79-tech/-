// Separate load generator, pinned to a CPU outside the measured crypto CPU.
const fs=require('fs');const manifest=JSON.parse(fs.readFileSync(__dirname+'/manifest.json'));
const concurrency=Number(process.argv[2]),cold=process.argv[3]==='cold';let stopped=false,n=0,ok=0,errors=0;
async function loop(){while(!stopped){const id=manifest[n++%250].instrumentId;try{const r=await fetch('http://127.0.0.1:18091/stocks/history/'+id+(cold?'?before='+String(Date.now()-n*900000):''),{signal:AbortSignal.timeout(3000)});await r.arrayBuffer();if(r.ok)ok++;else errors++;}catch{errors++;}await new Promise(r=>setTimeout(r,200));}}
for(let i=0;i<concurrency;i++)void loop();process.on('SIGTERM',()=>{stopped=true;console.log(JSON.stringify({concurrency,cold,ok,errors}));process.exit();});
