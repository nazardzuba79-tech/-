'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(values,p)=>{const a=[...values].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.ceil(p*a.length)-1)]:null;};
// Moving block bootstrap: preserve bursts/autocorrelation rather than pretend every HTTP sample is independent.
function compare(a,b){
  const point=percentile(b.map(x=>x.ms),.95)/percentile(a.map(x=>x.ms),.95);
  if(a.length<80||b.length<80)return{result:'INCONCLUSIVE',reason:'fewer than 80 observations per endpoint per phase',ratio:point};
  const blocks=rows=>{const origin=rows[0].at,groups=new Map();for(const row of rows){const id=Math.floor((row.at-origin)/10000);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row.ms);}return [...groups.values()];};
  const aa=blocks(a),bb=blocks(b);let seed=613,ratios=[];const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const draw=groups=>Array.from({length:groups.length},()=>groups[Math.floor(random()*groups.length)]).flat();
  for(let i=0;i<2000;i++)ratios.push(percentile(draw(bb),.95)/percentile(draw(aa),.95));
  const lower=percentile(ratios,.025),upper=percentile(ratios,.975);
  return{result:point>1.05?'FAIL':upper<=1.05?'PASS':'INCONCLUSIVE',ratio:point,ci95:[lower,upper],blocks:[aa.length,bb.length],criterion:'p95 <= baseline * 1.05 per endpoint; PASS requires upper 95% moving-block confidence bound <= 1.05'};
}
async function run({OUT,tokens,startReaders,proxy,docker,api,gateway,pg}){
  const endpoints=['me','balances','orders/me','futures/positions'];
  const manifest={phaseMs:180000,cryptoIntervalMs:2000,endpoints,cryptoClients:['127.0.0.2','127.0.0.3'],source:'actual TCP peer -> Nginx $remote_addr; no spoofed forwarding header',readers:2,stockPolling:'unchanged real frontend: state every 3000ms/history every 15000ms; hidden tabs stop',providers:false,financial:false,authorityMaxPerRollingMinute:60,threshold:1.05,resourceLimits:{apiAndCollector:{cpu:0.5,ramMiB:1536},gateway:{cpu:0.25,ramMiB:256},pg:{cpu:0.25,ramMiB:512}},statistics:'predeclared 10s blocks, 2000 resamples, fixed seed, >=80 samples/endpoint/phase; insufficient confidence INCONCLUSIVE'};
  fs.writeFileSync(path.join(OUT,'benchmark-manifest.json'),JSON.stringify(manifest,null,2));
  const phases=[];
  for(const name of ['crypto-only','crypto-plus-two-stocks']){
    let stopReaders;const began=Date.now();
    if(name==='crypto-plus-two-stocks')stopReaders=await startReaders();
    const start=Date.now(),rows=[],resources=[];let sampling=false;
    const metric=()=>{if(sampling)return;sampling=true;try{const data=docker(['stats','--no-stream','--format','{{json .}}',api,gateway,pg]).split('\n').filter(Boolean).map(x=>JSON.parse(x));const connections=Number(docker(['exec',pg,'psql','-U','neondb_owner','-d','voltex_stage','-Atc','SELECT count(*) FROM pg_stat_activity']));resources.push({at:Date.now()-start,containers:data,connections});}finally{sampling=false;}};
    const timer=setInterval(metric,10000);
    try{
      await Promise.all(endpoints.map(async(endpoint,index)=>{
        let next=start;
        while(next<start+manifest.phaseMs){await pause(Math.max(0,next-Date.now()));const at=Date.now()-start,t0=performance.now();let status,error;
          try{const r=await proxy.requestFrom(new Request('https://api.example.invalid/api/v1/'+endpoint,{headers:{authorization:'Bearer '+tokens[index%2]},signal:AbortSignal.timeout(3000)}),manifest.cryptoClients[index%2]);status=r.status;await r.arrayBuffer();}catch(e){status=0;error=e.code||e.name;}
          rows.push({endpoint,at,ms:performance.now()-t0,status,...(error?{error}:{})});next+=manifest.cryptoIntervalMs;
        }
      }));
      await pause(Math.max(0,start+manifest.phaseMs-Date.now()));
    }finally{clearInterval(timer);if(stopReaders)await stopReaders();}
    const phase={name,start,end:Date.now(),setupStarted:began,rows,resources};phases.push(phase);fs.writeFileSync(path.join(OUT,'benchmark-'+name+'.json'),JSON.stringify(phase,null,2));
  }
  const [base,combined]=phases,summary={result:'PASS',manifest,endpoints:{}};
  for(const endpoint of endpoints){const a=base.rows.filter(x=>x.endpoint===endpoint),b=combined.rows.filter(x=>x.endpoint===endpoint);const stats=rows=>({n:rows.length,p50:percentile(rows.map(x=>x.ms),.5),p95:percentile(rows.map(x=>x.ms),.95),p99:percentile(rows.map(x=>x.ms),.99),errors:rows.filter(x=>x.status!==200).length,timeouts:rows.filter(x=>x.status===0).length});const result=compare(a,b);if(a.some(x=>x.status!==200)||b.some(x=>x.status!==200))result.result='FAIL',result.reason='HTTP error/timeout';summary.endpoints[endpoint]={baseline:stats(a),combined:stats(b),...result};}
  const cp=require('node:child_process'),logs=cp.spawnSync('docker',['logs',api],{encoding:'utf8',maxBuffer:48*1024*1024});assert.equal(logs.status,0);
  const requests=(logs.stdout+'\n'+logs.stderr).split('\n').filter(l=>l.startsWith('STAGE_A_AUTHORITY_REQUEST ')).map(l=>JSON.parse(l.slice('STAGE_A_AUTHORITY_REQUEST '.length))).filter(x=>x.at>=combined.setupStarted&&x.at<=combined.end);
  let peak=0;for(const r of requests)peak=Math.max(peak,requests.filter(x=>x.at>=r.at&&x.at<r.at+60000).length);
  summary.authority={requests:requests.length,peakPerRollingMinute:peak,errors:requests.filter(x=>x.status!==200).length,source:'observed actual compiled API response-finish events, no identities/headers'};
  if(peak>60||summary.authority.errors)summary.result='FAIL';
  else if(Object.values(summary.endpoints).some(x=>x.result==='FAIL'))summary.result='FAIL';
  else if(Object.values(summary.endpoints).some(x=>x.result==='INCONCLUSIVE'))summary.result='INCONCLUSIVE';
  summary.limitations=['one isolated synthetic small-dataset comparison; not production capacity','collector egress is denied, not a real market-feed workload','no inference about 50+2 or production minimum resources'];
  fs.writeFileSync(path.join(OUT,'benchmark-summary.json'),JSON.stringify(summary,null,2));return summary;
}
module.exports={run,compare,percentile};
