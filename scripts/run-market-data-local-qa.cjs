'use strict';
// READ-ONLY public-provider local QA. Starts the exact compiled entrypoint
// plus the actual API connector/SSE router. This is not a deployed API.
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {once}=require('node:events');
const net=require('node:net'),fs=require('node:fs'),express=require('express');
const {MarketDataCollectorClient}=require('../dist/services/marketData/live/MarketDataCollectorClient');
const {marketLiveRouter}=require('../dist/api/routes/marketLive');
const {verify}=require('./verify-market-data-staging.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(r=>s.close(r));return n;}
(async()=>{
  const token=randomBytes(32).toString('hex'),collectorPort=await port(),url=`http://127.0.0.1:${collectorPort}`;
  const env={MARKET_DATA_COLLECTOR_TOKEN:token,PORT:String(collectorPort)};
  for(const key of ['PATH','SystemRoot','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  // Windows cannot deliver a POSIX SIGTERM with child.kill(). Exercise the
  // installed handler via IPC instead, and label this distinction in evidence.
  const bridge="process.on('message', m => { if(m==='qa-sigterm'){ process.emit('SIGTERM'); process.disconnect(); } });require('./dist/marketDataCollector.js');";
  const child=spawn(process.execPath,['-e',bridge],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let leaked=false,logBytes=0;for(const output of [child.stdout,child.stderr])output.on('data',chunk=>{logBytes+=chunk.length;if(chunk.toString().includes(token))leaked=true;});
  let server,client;const report={at:new Date().toISOString(),environment:'Local Windows; public Bybit; exact compiled standalone entrypoint; real API connector/SSE. Not Docker or deployed Frankfurt.',docker:'NOT RUN',nativePosixSigterm:'NOT RUN'};
  try {
    const deadline=Date.now()+60000;let ready=false;
    while(Date.now()<deadline){
      if(child.exitCode!==null)throw new Error('Collector exited during startup');
      try{const response=await fetch(`${url}/internal/v1/diagnostics`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2000)});const d=await response.json();if(d.status==='live'&&d.tickerCount>0){ready=true;break;}}catch{}
      await sleep(500);
    }
    if(!ready)throw new Error('Live public provider startup timed out');
    client=new MarketDataCollectorClient(url,token);client.start();const app=express();app.use('/api/v1',marketLiveRouter(client.feed));
    if(process.env.STAGING_QA_BROWSER_PORT){
      // Isolated UI fixtures only for account shell and unavailable catalogue;
      // every displayed ticker is real Bybit data from the child collector.
      app.get('/api/v1/market/assets',(_req,res)=>res.json({available:true,source:'coingecko',fetchedAt:Date.now(),stale:false,value:{assets:[],catalogueTotal:0,tradableCount:0,collisions:[],metadataComplete:false}}));
      app.get('/api/v1/market/snapshot',(_req,res)=>res.json({tickers:{available:false},overview:{available:false},sentiment:{available:false}}));
      app.get('/api/v1/me',(_req,res)=>res.json({id:'qa',displayName:'Local QA',email:'qa@example.invalid',isAdmin:false}));
      app.get('/api/v1/futures/config',(_req,res)=>res.json({symbols:[]}));app.get('/api/v1/market/external/rankings',(_req,res)=>res.json({rankings:[]}));
      app.get('/api/v1/*',(_req,res)=>res.json([]));
      const path=require('node:path'),dist=path.join(__dirname,'../frontend/dist');app.use(express.static(dist,{index:false}));
      app.get('*',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>',`<head><script>localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','en');</script>`)));
    }
    server=app.listen(Number(process.env.STAGING_QA_BROWSER_PORT||0),'127.0.0.1');await once(server,'listening');
    if(process.env.STAGING_QA_BROWSER_PORT)console.log(`Local QA UI http://127.0.0.1:${server.address().port}/markets`);
    const clientDeadline=Date.now()+10000;while(client.feed.status!=='live'&&Date.now()<clientDeadline)await sleep(100);
    report.verifier=await verify({MARKET_DATA_COLLECTOR_URL:url,MARKET_DATA_COLLECTOR_TOKEN:token,
      VOLTEX_API_URL:`http://127.0.0.1:${server.address().port}`,STAGING_OBSERVE_SECONDS:'4',STAGING_SOAK_MINUTES:process.env.STAGING_SOAK_MINUTES||'1'},line=>console.log(line));
    report.collectorRuntime=report.verifier.ok?'PASS':'FAIL';
    const exit=once(child,'exit');child.send('qa-sigterm');
    const deadlineExit=new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Shutdown timed out')),5000);t.unref();});
    const [code]=await Promise.race([exit,deadlineExit]);report.sigtermHandler=code===0?'PASS':'FAIL';
    report.logTokenLeak=leaked;report.collectorLogBytes=logBytes;report.backendConnections=client.counters.connections;
    if(!report.verifier.ok||code!==0||leaked)process.exitCode=1;
  }catch{report.failure='Local runtime verification failed';process.exitCode=1;}
  finally{client?.stop();server?.closeAllConnections();server?.close();if(child.exitCode===null)child.kill();
    if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
})().catch(()=>{console.error('FAIL local runtime QA');process.exitCode=1;});
