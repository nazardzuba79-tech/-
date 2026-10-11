// Extra observational run; never replaces or relaxes the existing paired strict gate.
import { spawn,spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,copyFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=resolve(fileURLToPath(new URL('.',import.meta.url))),out=resolve(process.env.STOCK_STRICT_OUTPUT??'.ci-output/stock-strict-profile');
const disk=process.env.STOCK_REALISTIC_DISK,device=process.env.STOCK_BENCH_DEVICE,cpu=process.env.BENCH_CPU,clientCpu=process.env.LOAD_CPU,images=JSON.parse(process.env.STOCK_STRICT_IMAGES??'{}');
const seconds=Number(process.env.STOCK_REALISTIC_SECONDS??30),repeats=Number(process.env.STOCK_REALISTIC_REPEATS??3),now=String(Date.now());
if(process.platform!=='linux'||!disk||!device||cpu===undefined||clientCpu===undefined||!images.before||!images.after)throw Error('Verified Linux fixture configuration required');
mkdirSync(out,{recursive:true});const seed=join(resolve(disk),'strict-seed');mkdirSync(seed,{recursive:true,mode:0o777});spawnSync('chmod',['777',seed]);
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:300000});if(r.status!==0)throw Error(`docker ${args[0]} failed: ${r.stderr}`);return r.stdout.trim();};
// Fixture population is explicitly outside measurement, like the original harness.
docker(['run','--rm','--network','none','--cpus','.05','--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,src=${seed},dst=/data`,'-e','STOCK_LOAD_DB=/data/load.sqlite','-e','STOCK_LOAD_SEED_ONLY=true','-e',`STOCK_FIXTURE_NOW=${now}`,images.after,'node','load-fixture.mjs']);
const summaries=[];
for(const variant of ['before','after'])for(let repeat=0;repeat<repeats;repeat++)for(const readers of [50,100])for(const cold of [false,true]){
  const label=`${variant}-${readers}-${cold?'cold':'warm'}-${repeat}`,dir=join(resolve(disk),label),name=`stocks-strict-profile-${process.pid}`;mkdirSync(dir,{recursive:true,mode:0o777});spawnSync('chmod',['777',dir]);copyFileSync(join(seed,'load.sqlite'),join(dir,'load.sqlite'));spawnSync('chmod',['666',join(dir,'load.sqlite')]);let started=false,reader;
  try{
    docker(['run','-d','--name',name,'--cpus','.05','--cpuset-cpus',String(cpu),'--memory','256m','--memory-swap','256m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--device-read-bps',`${device}:1048576`,'--device-write-bps',`${device}:131072`,'-p','127.0.0.1:18091:8091','-p','127.0.0.1:18094:8094','--mount',`type=bind,src=${dir},dst=/data`,'-e','STOCK_LOAD_DB=/data/load.sqlite','-e','STOCK_PROFILE_CONTROL=true','-e',`STOCK_FIXTURE_NOW=${now}`,'-e',`STOCK_LOAD_CASE=${cold?'F':'D'+readers}`,'-e',`STOCK_LOAD_REPEAT=${repeat}`,images[variant],'node','load-fixture.mjs']);started=true;
    let ready=false;for(let n=0;n<240;n++){try{if((await fetch('http://127.0.0.1:18091/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await new Promise(ok=>setTimeout(ok,250));}if(!ready)throw Error('Strict fixture failed to start: '+docker(['logs',name]));
    if(!cold){
      // Let the first unchanged fixture write/invalidation happen before warming.
      await new Promise(ok=>setTimeout(ok,6000));
      const manifest=JSON.parse((await import('node:fs')).readFileSync(join(here,'manifest.json')));
      for(const instrument of manifest){const r=await fetch('http://127.0.0.1:18091/stocks/history/'+instrument.instrumentId,{signal:AbortSignal.timeout(3000)});await r.arrayBuffer();if(!r.ok)throw Error('Warm-up failed');}
    }
    const reset=await fetch('http://127.0.0.1:18094/reset',{method:'POST'});if(!reset.ok)throw Error('Strict metrics reset failed');
    const measuredReader=await new Promise((ok,fail)=>{const child=spawn('taskset',['-c',String(clientCpu),process.execPath,join(here,'profile-strict-readers.cjs'),String(readers),...(cold?['cold']:[])],{env:{...process.env,STOCK_PROFILE_SECONDS:String(seconds)},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',fail);child.on('close',code=>{if(code!==0)return fail(Error(stderr));try{ok(JSON.parse(stdout.trim()));}catch(error){fail(Error(`Invalid reader JSON ${error.message}: ${stdout}`));}});});
    const metrics=await fetch('http://127.0.0.1:18094/metrics');if(!metrics.ok)throw Error('Strict metrics missing');reader={...measuredReader,serverMetrics:await metrics.json()};
  }finally{if(started){docker(['stop','-t','30',name]);const log=docker(['logs',name]);writeFileSync(join(out,label+'.log'),log);docker(['rm',name]);if(reader){const {serverMetrics:server,...readerMetrics}=reader,result={label,variant,repeat,reader:readerMetrics,server,cacheAtStart:cold?'cold':'250 latest pages prewarmed after first writer invalidation',perReader:{cpuVcpu:server.cpuVcpu/readers,rssBytesAmortized:server.rss/readers,historyReads:server.historyReads/readers},externalApiCalls:0,acceptance:reader.errors===0&&reader.ok>0&&reader.successLatencyMs.max<=3000,scope:'Observational exact reader mirror; original paired crypto interference test remains authoritative. Warm-up excluded from metric counters; unchanged periodic writer may invalidate cache during measurement.'};writeFileSync(join(out,label+'.json'),JSON.stringify(result,null,2));summaries.push(result);console.log(JSON.stringify({label,ok:reader.ok,errors:reader.errors,p95:reader.successLatencyMs.p95,cpu:server.cpuVcpu,sql:server.historyReads,pass:result.acceptance}));}}}
}
writeFileSync(join(out,'results.json'),JSON.stringify({fixture:true,images,seconds,repeats,deadlineMs:3000,limits:{cpuVcpu:.05,memoryBytes:268435456,readBps:1048576,writeBps:131072},results:summaries,acceptance:summaries.every(x=>x.acceptance)},null,2));
