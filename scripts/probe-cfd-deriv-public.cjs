'use strict';
/** Public/no-auth Deriv coverage probe. It does not submit trades, accounts,
 * credentials or VOLTEX financial state. It validates the provider's actual
 * active-symbol discovery only. The current Options public endpoint rejects
 * ticks_history; streaming tick parsing/reconnect/freshness are covered by
 * deterministic adapter tests instead. Deriv currently maps 11/13 VOLTEX
 * symbols; WTI/Brent are explicit recorded gaps. No rights are admitted. */
const fs=require('node:fs'),path=require('node:path'),WebSocket=require('ws');
const {discoverDerivSymbols,DERIV_PUBLIC_WS_URL}=require('../dist/services/marketData/cfd/DerivPublicStreamQuoteSource');
const OUT=path.resolve('docs/qa/cfd-multi-provider/deriv-public-probe.json');fs.mkdirSync(path.dirname(OUT),{recursive:true});
const EXPECTED_MISSING=['WTIUSD','XBRUSD'];
const report={checkedAt:new Date().toISOString(),endpoint:DERIV_PUBLIC_WS_URL,publicNoAuth:true,executionAllowed:false,rightsAdmitted:false,
  verification:'active_symbols discovery only',expectedCoverage:{mapped:11,missing:EXPECTED_MISSING},discovery:null,errors:[]};
let socket,timer,finished=false;
function finish(code=0){if(finished)return;finished=true;clearTimeout(timer);try{socket?.close();}catch{}fs.writeFileSync(OUT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=code;}
try{
 socket=new WebSocket(DERIV_PUBLIC_WS_URL,{handshakeTimeout:8000});
 timer=setTimeout(()=>{report.errors.push('probe_timeout');finish(1);},10000);
 socket.on('open',()=>socket.send(JSON.stringify({active_symbols:'brief',req_id:1})));
 socket.on('error',()=>{if(!finished){report.errors.push('socket_error');finish(1);}});
 socket.on('message',data=>{
  let raw;try{raw=JSON.parse(data.toString());}catch{return;}
  if(raw?.error){report.errors.push(typeof raw.error.code==='string'?raw.error.code:'provider_error');return finish(1);}
  if(raw?.msg_type!=='active_symbols')return;
  const d=discoverDerivSymbols(raw.active_symbols);report.discovery=d;
  const missing=[...d.missing].sort(), expected=[...EXPECTED_MISSING].sort();
  if(d.mapped.length!==11||d.ambiguous.length||JSON.stringify(missing)!==JSON.stringify(expected))report.errors.push('coverage_changed');
  finish(report.errors.length?1:0);
 });
 socket.on('close',()=>{if(!finished){report.errors.push('socket_closed_early');finish(1);}});
}catch{report.errors.push('probe_init');finish(1);}
