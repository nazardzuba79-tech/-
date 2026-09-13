'use strict';
/** Real public/no-key technical coverage probe. No VOLTEX account/DB/trade
 * access. Passing proves only reachable live/reference data, not commercial
 * display or execution rights. */
const fs=require('node:fs'),path=require('node:path');
const symbols={XAUUSD:'XAUUSD',XAGUSD:'XAGUSD',XPTUSD:'XPTUSD',XPDUSD:'XPDUSD',WTIUSD:'USOIL',XBRUSD:'UKOIL',EURUSD:'EURUSD',GBPUSD:'GBPUSD',USDJPY:'USDJPY',AUDUSD:'AUDUSD',USDCAD:'USDCAD',USDCHF:'USDCHF',NZDUSD:'NZDUSD'};
const OUT=path.resolve('docs/qa/cfd-multi-provider/biquote-public-probe.json');fs.mkdirSync(path.dirname(OUT),{recursive:true});
const report={checkedAt:new Date().toISOString(),provider:'biquote',baseUrl:'https://biquote.io',publicNoAuth:true,executionAllowed:false,rightsAdmitted:false,results:{},errors:[]};
(async()=>{
 for(const [voltex,provider] of Object.entries(symbols)){
  try{
   const r=await fetch(`https://biquote.io/api/${provider}`,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!r.ok){report.results[voltex]={providerSymbol:provider,http:r.status,ok:false};report.errors.push(`${voltex}:http_${r.status}`);continue;}
   const q=await r.json();const bid=Number(q?.bid),ask=Number(q?.ask),mid=Number(q?.mid),at=Date.parse(q?.timestamp);
   const identity=q?.symbol===provider,prices=[bid,ask,mid].every(Number.isFinite)&&bid>0&&ask>0&&mid>0&&bid<=mid&&mid<=ask;
   const timestamp=Number.isFinite(at)&&at>0&&at<=Date.now()+1000;
   const ok=identity&&prices&&timestamp&&typeof q?.marketState==='string'&&typeof q?.stale==='boolean';
   report.results[voltex]={providerSymbol:provider,ok,marketState:q?.marketState??null,stale:q?.stale??null,timestamp:q?.timestamp??null,source:typeof q?.source==='string'?q.source:null};
   if(!ok)report.errors.push(`${voltex}:invalid_payload`);
  }catch{report.results[voltex]={providerSymbol:provider,ok:false};report.errors.push(`${voltex}:network`);}
 }
 fs.writeFileSync(OUT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(Object.keys(report.results).length!==13||report.errors.length)process.exitCode=1;
})().catch(()=>{report.errors.push('probe_failed');fs.writeFileSync(OUT,JSON.stringify(report,null,2));process.exitCode=1;});
