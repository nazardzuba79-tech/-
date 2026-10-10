// Separate-process, fixture-only reader workload. It never submits an order.
import { get } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { CATALOG } from '../stocks-global/catalog.mjs';

export const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:null;
// Retain diagnostic codes, never arbitrary server strings, bodies, headers or identities.
const PUBLIC_ERROR_CODES=new Set(['SOURCE_BUSY','SOURCE_UNAVAILABLE','SOURCE_DNS_UNAVAILABLE','SOURCE_FORBIDDEN','RATE_LIMIT','RESPONSE_TOO_LARGE','INVALID_CANDLES','INVALID_DATA','INVALID_PAIR','INVALID_RANGE','UNSUPPORTED_TIMEFRAME','INSTRUMENT_UNVERIFIED','MARKET_CLOSED','QUOTE_UNAVAILABLE','FX_STALE','FX_UNAVAILABLE','MOEX_UNVERIFIED','AUTH_REQUIRED','AUTH_UNAVAILABLE','ACCOUNT_CAPACITY','ACCOUNT_NOT_FOUND','ACCOUNT_SELECTOR_FORBIDDEN','ACCOUNT_BUSY','ACCOUNT_QUEUE_FULL','ACCOUNT_QUEUE_TIMEOUT','ACCOUNT_UNAVAILABLE','ACCOUNT_WORKER_UNAVAILABLE','ACCOUNT_WORKER_TIMEOUT','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN','ACCOUNT_COMMAND_INVALID','ACCOUNT_CONFIG_INVALID','HOST_FORBIDDEN','ORIGIN_FORBIDDEN','METHOD_NOT_ALLOWED','TOKEN_REQUIRED','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON','ROUTE_NOT_FOUND','LOCAL_SERVICE_ERROR']);
export function safeHttpErrorCode(body){
  if(!Buffer.isBuffer(body)||body.length>8192)return 'UNRECORDED';
  try{const value=JSON.parse(body.toString('utf8'))?.error;return PUBLIC_ERROR_CODES.has(value)?value:'UNRECORDED';}catch{return 'UNRECORDED';}
}
export function request(url,{headers={},timeoutMs=3000}={}){
  return new Promise((ok,fail)=>{
    let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(deadline);error?fail(error):ok(value);};
    const req=get(url,{headers},res=>{const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(Error('Response exceeds fixture bound'));return;}chunks.push(chunk);});res.on('end',()=>finish(null,{status:res.statusCode,body:Buffer.concat(chunks),bytes}));res.on('error',finish);});
    const deadline=setTimeout(()=>{const error=Error('Request deadline exceeded');error.code='DEADLINE_3000MS';req.destroy(error);finish(error);},timeoutMs);
    req.on('error',finish);
  });
}
export async function runReaders({base,users=5,pattern='mixed',mode='global',seconds=30,cadenceMs=2000,cold=false,instrumentsCount=20}={}){
  const address=new URL(base);if(address.hostname!=='127.0.0.1'||address.protocol!=='http:')throw Error('Fixture reader requires explicit loopback HTTP');
  if(![5,20,50,100].includes(users)||!['mixed','shared'].includes(pattern)||!['global','history'].includes(mode)||seconds<1||seconds>300||cadenceMs<100||instrumentsCount<10||instrumentsCount>250)throw Error('Invalid benchmark configuration');
  const ids=mode==='global'?CATALOG.filter(i=>i.provider!=='moex').slice(0,instrumentsCount).map(i=>i.id):JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))).slice(0,instrumentsCount).map(i=>i.instrumentId);
  const latencies=[],allLatencies=[],byOperation={},statuses={},failures={},httpErrorCodes={};let ok=0,errors=0,bytes=0,requests=0;
  const started=performance.now(),end=started+seconds*1000;
  const count=(map,key)=>map[key]=(map[key]??0)+1;
  async function perform(path,operation,user,expectedId,expectedInterval){
    const start=performance.now();requests++;
    const record=byOperation[operation]??={ok:0,errors:0,latencies:[],failures:{},httpErrorCodes:{}};
    try{
      const response=await request(new URL(path,address),{headers:mode==='global'?{authorization:`Bearer fixture-user-${user}`}:{}});
      count(statuses,String(response.status));bytes+=response.bytes;
      if(response.status!==200){const code=safeHttpErrorCode(response.body),key=`HTTP_${response.status}:${code}`;count(httpErrorCodes,key);count(record.httpErrorCodes,key);throw Object.assign(Error(`HTTP ${response.status}`),{code:`HTTP_${response.status}`});}
      const body=JSON.parse(response.body);if(expectedId&&body.instrumentId!==expectedId)throw Object.assign(Error('Instrument identity mismatch'),{code:'IDENTITY_MISMATCH'});
      if(expectedInterval&&body.interval!==expectedInterval)throw Object.assign(Error('Timeframe mismatch'),{code:'TIMEFRAME_MISMATCH'});
      if(operation!=='state'&&!Array.isArray(body.candles))throw Object.assign(Error('Missing candles'),{code:'INVALID_CANDLES'});
      const elapsed=performance.now()-start;latencies.push(elapsed);record.latencies.push(elapsed);record.ok++;ok++;
    }catch(error){errors++;record.errors++;count(failures,error.code??error.name);count(record.failures,error.code??error.name);}
    finally{allLatencies.push(performance.now()-start);}
  }
  await Promise.all(Array.from({length:users},async(_,user)=>{
    let turn=0;
    while(performance.now()<end){
      const tick=performance.now(),id=ids[pattern==='shared'?0:(user+Math.floor(turn/3))%ids.length];
      const interval=['15m','1h','1D'][Math.floor(turn/3)%3];
      if(mode==='global'){
        // Actual Stocks state refresh cadence is modelled separately from navigation.
        await perform('/__stocks_global/state?id='+encodeURIComponent(id),'state',user);
        // New chart/interval at 6s; page older data in the next 2s, then one state-only tick.
        if(turn%3<2){const before=turn%3===1?`&before=${Math.floor(Date.now()/86400000)*86400000-86400000}`:'';await perform(`/__stocks_global/history?id=${encodeURIComponent(id)}&interval=${interval}${before}`,before?'history-page':'chart',user,id,interval);}
      }else{
        const before=cold||turn%3===1?`?before=${Math.floor(Date.now()/86400000)*86400000-(turn%3===1?301*900000:0)}`:'';
        await perform('/stocks/history/'+encodeURIComponent(id)+before,before?'history-page':'chart',user,id);
      }
      turn++;const delay=cadenceMs-(performance.now()-tick);if(delay>0&&performance.now()<end)await new Promise(ok=>setTimeout(ok,Math.min(delay,Math.max(0,end-performance.now()))));
    }
  }));
  const elapsedMs=performance.now()-started;
  const summary=values=>({p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:values.length?Math.max(...values):null});
  for(const record of Object.values(byOperation)){record.latencyMs=summary(record.latencies);delete record.latencies;}
  return {fixture:true,mode,pattern,users,instruments:ids.length,seconds,cadenceMs,deadlineMs:3000,cold,elapsedMs,requests,ok,errors,statuses,failures,httpErrorCodes,responseBytes:bytes,requestsPerSecond:requests/(elapsedMs/1000),requestsPerReaderPerSecond:requests/users/(elapsedMs/1000),latencyMs:summary(latencies),allAttemptLatencyMs:summary(allLatencies),byOperation,intervals:mode==='global'?['15m','1h','1D']:['15m'],externalApiCalls:0,notes:mode==='history'?['Read-only storage API only supports 15m; this test makes no timeframe-switch claim.']:['Fixture users/accounts are separate; no order/transfer/deposit endpoint is called.','Two-second state refresh and six-second chart/timeframe switch are explicit stress assumptions, not a prediction of production traffic.','Provider responses are synthetic capacity fixtures; zero external provider calls.','HTTP error details retain only an allowlisted public code; no response body, token, identity or arbitrary string is logged.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runReaders({base:process.env.STOCK_REALISTIC_URL,users:Number(process.env.STOCK_REALISTIC_USERS??5),pattern:process.env.STOCK_REALISTIC_PATTERN??'mixed',mode:process.env.STOCK_REALISTIC_MODE??'global',seconds:Number(process.env.STOCK_REALISTIC_SECONDS??30),cadenceMs:Number(process.env.STOCK_REALISTIC_CADENCE_MS??2000),cold:process.env.STOCK_REALISTIC_COLD==='true',instrumentsCount:Number(process.env.STOCK_REALISTIC_INSTRUMENTS??20)});
  console.log(JSON.stringify(result));
  // Do not turn an overload result into a green acceptance claim. Evidence collection
  // remains possible; the caller must evaluate this explicit unchanged deadline gate.
  if(process.env.STOCK_REALISTIC_REQUIRE_PASS==='true'&&result.errors)process.exitCode=1;
}
