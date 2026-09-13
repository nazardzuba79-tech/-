'use strict';
/** Public/no-auth Deriv coverage probe. It does not submit trades, accounts,
 * credentials or VOLTEX financial state. It validates the provider's actual
 * current coverage and asks for one latest history point per mapped symbol.
 * Deriv Options currently covers 11/13 VOLTEX symbols; WTI/Brent are an
 * explicit recorded gap, not a hidden test failure. This does NOT grant
 * commercial/display/execution rights. */
const fs=require('node:fs'),path=require('node:path'),WebSocket=require('ws');
const {discoverDerivSymbols,DERIV_PUBLIC_WS_URL}=require('../dist/services/marketData/cfd/DerivPublicStreamQuoteSource');
const OUT=path.resolve('docs/qa/cfd-multi-provider/deriv-public-probe.json');fs.mkdirSync(path.dirname(OUT),{recursive:true});
const EXPECTED_MISSING=['WTIUSD','XBRUSD'];
const report={checkedAt:new Date().toISOString(),endpoint:DERIV_PUBLIC_WS_URL,publicNoAuth:true,executionAllowed:false,rightsAdmitted:false,
  expectedCoverage:{mapped:11,missing:EXPECTED_MISSING},discovery:null,history:{},errors:[]};
let socket,timer,finished=false;
function finish(code=0){if(finished)return;finished=true;clearTimeout(timer);try{socket?.close();}catch{}fs.writeFileSync(OUT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=code;}
try{
 socket=new WebSocket(DERIV_PUBLIC_WS_URL,{handshakeTimeout:8000});
 timer=setTimeout(()=>{report.errors.push('probe_timeout');finish(1);},20000);
 socket.on('open',()=>socket.send(JSON.stringify({active_symbols:'brief',req_id:1})));
 socket.on('error',()=>{report.errors.push('socket_error');});
 socket.on('message',data=>{
  let raw;try{raw=JSON.parse(data.toString());}catch{return;}
  if(raw?.error){report.errors.push(typeof raw.error.code==='string'?raw.error.code:'provider_error');return;}
  if(raw?.msg_type==='active_symbols'){
    const d=discoverDerivSymbols(raw.active_symbols);report.discovery=d;
    const missing=[...d.missing].sort(), expected=[...EXPECTED_MISSING].sort();
    if(d.mapped.length!==11||d.ambiguous.length||JSON.stringify(missing)!==JSON.stringify(expected)){
      report.errors.push('coverage_changed');return finish(1);
    }
    for(const row of d.mapped)socket.send(JSON.stringify({ticks_history:row.providerSymbol,count:1,end:'latest',style:'ticks',req_id:`hist:${row.voltexSymbol}`}));
    return;
  }
  if(raw?.msg_type==='history'&&typeof raw?.echo_req?.req_id==='string'&&raw.echo_req.req_id.startsWith('hist:')){
    const symbol=raw.echo_req.req_id.slice(5),prices=raw?.history?.prices,times=raw?.history?.times;
    const price=Array.isArray(prices)&&prices.length?Number(prices[prices.length-1]):NaN,epoch=Array.isArray(times)&&times.length?Number(times[times.length-1]):NaN;
    report.history[symbol]={ok:Number.isFinite(price)&&price>0&&Number.isFinite(epoch)&&epoch>0,epoch:Number.isFinite(epoch)?epoch:null};
    if(report.discovery&&Object.keys(report.history).length===11){if(Object.values(report.history).some(x=>!x.ok))report.errors.push('history_missing');finish(report.errors.length?1:0);}
  }
 });
 socket.on('close',()=>{if(!finished&&(!report.discovery||Object.keys(report.history).length<11)){report.errors.push('socket_closed_early');finish(1);}});
}catch{report.errors.push('probe_init');finish(1);}
