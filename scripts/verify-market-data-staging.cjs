#!/usr/bin/env node
'use strict';
// Read-only staging verification. Secrets enter through env and bearer headers
// only; logs contain fixed check names and allowlisted numeric diagnostics.
const WebSocket = require('ws');
const { randomBytes } = require('node:crypto');
const MAX_BYTES = 16_000_000, MAX_ROWS = 20_000;
const COLLECTOR_STAGES = new Set([
  'collector_health','snapshot_missing_token','snapshot_invalid_token','diagnostics_missing_token',
  'diagnostics_invalid_token','ws_missing_token','ws_invalid_token','authenticated_snapshot_fetch',
  'authenticated_snapshot_parse','authenticated_diagnostics_fetch','authenticated_diagnostics_parse',
  'request_timeout','secret_leak_check',
]);
const SSE_REASONS = new Set([
  'http_non_200','wrong_content_type','missing_body','unexpected_eof','body_read_error',
  'parser_error','tracker_validation','silence_watchdog','external_abort','intended_duration_complete',
]);
const NUMBERS = ['lastPrice','bidPrice','askPrice','high24h','low24h','volume24h','quoteVolume24h',
  'changePercent24h','indexPrice','markPrice','fundingRate','fundingIntervalMinutes','openInterest','openInterestValue'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function origin(value, api = false) {
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash ||
      !(u.pathname === '/' || (api && ['/api/v1','/api/v1/'].includes(u.pathname)))) throw new Error('Invalid URL');
  if (u.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('TLS required');
  return u.origin;
}
function settings(env) {
  if (!env.MARKET_DATA_COLLECTOR_TOKEN?.trim() || !env.MARKET_DATA_COLLECTOR_URL || !env.VOLTEX_API_URL) throw new Error('Missing configuration');
  const seconds = env.STAGING_OBSERVE_SECONDS === undefined ? 20 : Number(env.STAGING_OBSERVE_SECONDS);
  const minutes = env.STAGING_SOAK_MINUTES === undefined ? 0 : Number(env.STAGING_SOAK_MINUTES);
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 300 || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error('Invalid duration');
  const collector = origin(env.MARKET_DATA_COLLECTOR_URL), api = origin(env.VOLTEX_API_URL, true);
  const token = env.MARKET_DATA_COLLECTOR_TOKEN;
  if ([collector,api].some(url=>url.includes(token))) throw new Error('Secret in URL');
  return {collector,api,token,observeMs:seconds*1000,soakMs:minutes*60000};
}
function secretIn(text, token) {
  return [token,JSON.stringify(token).slice(1,-1),encodeURIComponent(token),Buffer.from(token).toString('base64')].some(value=>text.includes(value));
}
class SafeDiagnosticError extends Error {
  constructor(stage,operation) { super(stage);this.name='SafeDiagnosticError';this.stage=stage;this.operation=operation; }
}
class TrackerValidationError extends Error {
  constructor() { super('tracker_validation');this.name='TrackerValidationError'; }
}
async function collectorStage(stage,operation) {
  try{return await operation();}
  catch(error){
    if(error instanceof SafeDiagnosticError)throw new SafeDiagnosticError(error.stage,stage);
    throw new SafeDiagnosticError(stage);
  }
}
function collectorDiagnostic(error) {
  const stage=error instanceof SafeDiagnosticError&&COLLECTOR_STAGES.has(error.stage)?error.stage:'collector_health';
  const operation=error instanceof SafeDiagnosticError&&COLLECTOR_STAGES.has(error.operation)?error.operation:undefined;
  return {stage,...(operation?{operation}:{})};
}
async function bodyText(response, limit = MAX_BYTES) {
  if (!response.body) return '';
  const reader=response.body.getReader(), chunks=[]; let bytes=0;
  try { while (true) { const {done,value}=await reader.read(); if(done)break;
    bytes+=value.byteLength; if(bytes>limit)throw new Error('Payload limit'); chunks.push(Buffer.from(value));
  } return Buffer.concat(chunks).toString('utf8'); }
  finally { await reader.cancel().catch(()=>{}); }
}
async function requestCollector(config,path,auth,fetchFn=fetch,timeoutMs=10000) {
  const timeout=AbortSignal.timeout(timeoutMs);let response,text;
  try{
    response=await fetchFn(`${config.collector}${path}`,{redirect:'error',signal:timeout,headers:auth===undefined?{}:{Authorization:`Bearer ${auth}`}});
    text=await bodyText(response);
  }catch(error){if(timeout.aborted)throw new SafeDiagnosticError('request_timeout');throw error;}
  let leaked=false;try{leaked=secretIn(text,config.token);}catch{throw new SafeDiagnosticError('secret_leak_check');}
  if(leaked)throw new SafeDiagnosticError('secret_leak_check');return {status:response.status,text};
}
function parseFrame(text) {
  if (Buffer.byteLength(text)>MAX_BYTES) throw new Error('Payload limit');
  const frame=JSON.parse(text);
  if (frame.version!==1 || !['snapshot','delta','state'].includes(frame.type) ||
      !['live','stale','connecting'].includes(frame.status) || typeof frame.epoch!=='string' || !frame.epoch ||
      !Number.isSafeInteger(frame.revision) || frame.revision<0 || !Number.isFinite(frame.sentAt) ||
      !Array.isArray(frame.rows) || frame.rows.length>MAX_ROWS || (frame.type==='state' && frame.rows.length)) throw new Error('Invalid frame');
  const ids=new Set();
  for(const row of frame.rows) {
    if (!row || typeof row.id!=='string' || row.id!==`${row.marketType}:${row.providerSymbol}` ||
        !['spot','linear_perpetual','linear_futures'].includes(row.marketType) || row.provider!=='bybit' ||
        typeof row.providerSymbol!=='string' || !row.providerSymbol || (row.settleAsset!==null&&typeof row.settleAsset!=='string') ||
        typeof row.baseAsset!=='string' || !row.baseAsset || typeof row.quoteAsset!=='string' || !row.quoteAsset ||
        row.pair!==`${row.baseAsset}/${row.quoteAsset}` || row.symbol!==row.pair || typeof row.stale!=='boolean' ||
        !Number.isFinite(row.receivedAt) || !Number.isFinite(row.fetchedAt) ||
        (row.providerEventAt!==null&&!Number.isFinite(row.providerEventAt)) || (row.sequence!==null&&!Number.isFinite(row.sequence)) ||
        NUMBERS.some(k=>row[k]!==null&&(typeof row[k]!=='number'||!Number.isFinite(row[k]))) || ids.has(row.id)) throw new Error('Invalid ticker');
    ids.add(row.id);
  }
  return frame;
}
class Tracker {
  constructor(token) {
    this.token=token; this.rows=new Map(); this.epoch=null; this.revision=-1; this.initialized=false; this.lastAt=0;
    this.stats={frames:0,snapshots:0,deltas:0,states:0,reconnects:0,revisionGaps:0,rejectedFrames:0,
      minTickers:null,maxTickers:0,maxStaleRows:0,largestFrameBytes:0,deltaRows:0,maxSilenceMs:0,nullObservations:0,zeroObservations:0};
  }
  reconnect(){this.initialized=false;this.stats.reconnects++;}
  receive(text, eventType) {
    try {
      if(secretIn(text,this.token))throw new Error('Secret exposed');
      const frame=parseFrame(text);
      if (eventType && frame.type!==eventType)throw new Error('SSE event mismatch');
      if ((!this.initialized && frame.type!=='snapshot') ||
          (frame.epoch===this.epoch && frame.revision<this.revision) ||
          (this.initialized && (frame.epoch!==this.epoch || (frame.type==='delta'&&frame.revision!==this.revision+1)))) {
        this.stats.revisionGaps++; throw new Error('Revision discontinuity');
      }
      const rows=frame.type==='snapshot'?new Map():new Map(this.rows);
      for(const row of frame.rows) {
        const old=this.rows.get(row.id);
        if(old&&(row.providerEventAt??row.fetchedAt)<(old.providerEventAt??old.fetchedAt))throw new Error('Ticker rollback');
        for(const key of NUMBERS) { if(row[key]===null)this.stats.nullObservations++;if(row[key]===0)this.stats.zeroObservations++; }
        rows.set(row.id,row);
      }
      if(rows.size>MAX_ROWS)throw new Error('Unbounded universe');
      this.rows=rows;this.initialized=true;this.epoch=frame.epoch;this.revision=frame.revision;
      const now=Date.now();if(this.lastAt)this.stats.maxSilenceMs=Math.max(this.stats.maxSilenceMs,now-this.lastAt);this.lastAt=now;
      this.stats.frames++;this.stats[frame.type==='state'?'states':`${frame.type}s`]++;
      if(frame.type==='delta')this.stats.deltaRows+=frame.rows.length;
      this.stats.minTickers=Math.min(this.stats.minTickers??rows.size,rows.size);this.stats.maxTickers=Math.max(this.stats.maxTickers,rows.size);
      this.stats.maxStaleRows=Math.max(this.stats.maxStaleRows,[...rows.values()].filter(r=>r.stale).length);
      this.stats.largestFrameBytes=Math.max(this.stats.largestFrameBytes,Buffer.byteLength(text));
      return frame;
    } catch {this.stats.rejectedFrames++;throw new TrackerValidationError();}
  }
  report() {
    const rows=[...this.rows.values()];
    return {...this.stats,tickers:rows.length,assets:new Set(rows.map(r=>r.baseAsset)).size,
      spot:rows.filter(r=>r.marketType==='spot').length,linear:rows.filter(r=>r.marketType.startsWith('linear')).length,
      stale:rows.filter(r=>r.stale).length,averageDeltaRows:this.stats.deltas?this.stats.deltaRows/this.stats.deltas:0};
  }
}
class SSEParser {
  constructor(receive){this.receive=receive;this.buffer='';}
  push(text){
    this.buffer+=text;
    // Bound even an unterminated event, including a malicious endless line.
    if(Buffer.byteLength(this.buffer)>MAX_BYTES+65536)throw new Error('SSE buffer limit');
    let match;
    while((match=/\r?\n\r?\n/.exec(this.buffer))) {
      const block=this.buffer.slice(0,match.index);this.buffer=this.buffer.slice(match.index+match[0].length);
      let type='message';const data=[];
      for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
      if(data.length)this.receive(data.join('\n'),type);
    }
  }
}
async function observeWS(config, tracker, duration, signal) {
  return new Promise((resolve,reject)=>{
    let ended=false;
    const ws=new WebSocket(`${config.collector.replace(/^http/,'ws')}/internal/v1/stream`,{
      headers:{Authorization:`Bearer ${config.token}`},followRedirects:false,handshakeTimeout:10000,maxPayload:MAX_BYTES,perMessageDeflate:false});
    const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);clearInterval(watchdog);signal?.removeEventListener('abort',aborted);ws.terminate();error?reject(new Error('Internal WS failed')):resolve();};
    const aborted=()=>finish(true);
    const timer=setTimeout(()=>finish(),duration),watchdog=setInterval(()=>{if(tracker.lastAt&&Date.now()-tracker.lastAt>40000)finish(true);},1000);
    signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted){finish(true);return;}
    ws.on('message',raw=>{try{tracker.receive(raw.toString());}catch{finish(true);}});
    ws.on('error',()=>finish(true));ws.on('close',()=>{if(!ended)finish(true);});
  });
}
async function observeSSE(config,tracker,duration,signal,onDiagnostic=()=>{},dependencies={}) {
  const fetchFn=dependencies.fetchFn??fetch;
  const parserFactory=dependencies.parserFactory??(receive=>new SSEParser(receive));
  const startedAt=Date.now();
  const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)abort.abort();
  let expired=false,timedOut=false,reason='intended_duration_complete';
  const timer=setTimeout(()=>{expired=true;abort.abort();},duration);
  const watchdog=setInterval(()=>{if(tracker.lastAt&&Date.now()-tracker.lastAt>40000){timedOut=true;abort.abort();}},1000);
  let reader;
  try {
    let response;
    try{response=await fetchFn(`${config.api}/api/v1/market/live`,{redirect:'error',signal:abort.signal,headers:{Accept:'text/event-stream'}});}
    catch{throw new SafeDiagnosticError('body_read_error');}
    if(!response.ok)throw new SafeDiagnosticError('http_non_200');
    if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new SafeDiagnosticError('wrong_content_type');
    if(!response.body)throw new SafeDiagnosticError('missing_body');
    reader=response.body.getReader();const decoder=new TextDecoder();const parser=parserFactory((text,event)=>tracker.receive(text,event));
    while(true){
      let chunk;
      try{chunk=await reader.read();}catch{throw new SafeDiagnosticError('body_read_error');}
      if(chunk.done)throw new SafeDiagnosticError('unexpected_eof');
      try{parser.push(decoder.decode(chunk.value,{stream:true}));}
      catch(error){throw new SafeDiagnosticError(error instanceof TrackerValidationError?'tracker_validation':'parser_error');}
    }
  } catch(error) {
    reason=timedOut?'silence_watchdog':signal?.aborted?'external_abort':expired?'intended_duration_complete':
      error instanceof SafeDiagnosticError&&SSE_REASONS.has(error.stage)?error.stage:'body_read_error';
  }
  finally {clearTimeout(timer);clearInterval(watchdog);signal?.removeEventListener('abort',cancel);await reader?.cancel().catch(()=>{});abort.abort();}
  const diagnostic={reason,elapsedMs:Math.max(0,Date.now()-startedAt)};try{onDiagnostic(diagnostic);}catch{}
  if(reason!=='intended_duration_complete'){const error=new Error(`Public SSE failed: ${reason}`);error.reason=reason;throw error;}
  return diagnostic;
}
async function denyWS(config,token) {
  return new Promise(resolve=>{
    let done=false;const ws=new WebSocket(`${config.collector.replace(/^http/,'ws')}/internal/v1/stream`,{
      ...(token?{headers:{Authorization:`Bearer ${token}`}}:{}),followRedirects:false,handshakeTimeout:5000});
    const finish=ok=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();resolve(ok);};
    const timer=setTimeout(()=>finish(false),6000);
    ws.on('unexpected-response',(_req,res)=>{res.resume();finish(res.statusCode===401);});
    ws.on('open',()=>finish(false));ws.on('error',()=>{if(!done)finish(false);});
  });
}
function safeDiagnostics(d) {
  const out={};
  for(const key of ['activeInstruments','activeAssets','tickerCount','restRequests','reconnects','malformed','rejectedTimestamp','rejectedSequence','lastProviderActivityAt','lastTickerActivityAt','listeners'])if(Number.isFinite(d[key]))out[key]=d[key];
  if(['live','stale','connecting'].includes(d.status))out.status=d.status;
  if(d.memory)out.memory=Object.fromEntries(['rss','heapUsed','heapTotal','external','arrayBuffers'].filter(k=>Number.isFinite(d.memory[k])).map(k=>[k,d.memory[k]]));
  if(Array.isArray(d.connections))out.connections=d.connections.slice(0,100).map(c=>({category:['spot','linear'].includes(c.category)?c.category:'unknown',state:['live','connecting','backoff'].includes(c.state)?c.state:'unknown',topics:Number.isFinite(c.topics)?c.topics:null}));
  return out;
}
async function verify(env=process.env, log=console.log, signal) {
  const checks=[];let config;
  const check=(name,pass)=>{checks.push({name,status:pass?'PASS':'FAIL'});log(`${pass?'PASS':'FAIL'} ${name}`);};
  try{config=settings(env);}catch{check('environment configuration',false);return {ok:false,checks};}
  const request=(path,auth)=>requestCollector(config,path,auth);
  let diagnostics=null,diagnosticsLast=null;
  try {
    const health=await collectorStage('collector_health',async()=>{const response=await request('/health');return {response,json:JSON.parse(response.text)};});
    check('collector health',health.response.status===200&&health.json.ok===true);
    const deniedHttp=[
      ['snapshot_missing_token','/internal/v1/snapshot',undefined,'snapshot missing token rejected'],
      ['snapshot_invalid_token','/internal/v1/snapshot',randomBytes(24).toString('hex'),'snapshot invalid token rejected'],
      ['diagnostics_missing_token','/internal/v1/diagnostics',undefined,'diagnostics missing token rejected'],
      ['diagnostics_invalid_token','/internal/v1/diagnostics',randomBytes(24).toString('hex'),'diagnostics invalid token rejected'],
    ];
    for(const [stage,path,auth,name] of deniedHttp){const response=await collectorStage(stage,()=>request(path,auth));check(name,response.status===401);}
    check('internal WS missing token rejected',await collectorStage('ws_missing_token',()=>denyWS(config,undefined)));
    check('internal WS invalid token rejected',await collectorStage('ws_invalid_token',()=>denyWS(config,randomBytes(24).toString('hex'))));
    const initial=await collectorStage('authenticated_snapshot_fetch',()=>request('/internal/v1/snapshot',config.token));
    const frame=await collectorStage('authenticated_snapshot_parse',()=>parseFrame(initial.text));
    check('authenticated HTTP snapshot',initial.status===200&&frame.type==='snapshot');
    const diag=await collectorStage('authenticated_diagnostics_fetch',()=>request('/internal/v1/diagnostics',config.token));check('authenticated diagnostics',diag.status===200);
    diagnostics=await collectorStage('authenticated_diagnostics_parse',()=>safeDiagnostics(JSON.parse(diag.text)));
  } catch(error) {log(`DIAGNOSTIC collector_http_auth ${JSON.stringify(collectorDiagnostic(error))}`);check('collector HTTP/auth validation',false);}
  const internal=new Tracker(config.token),publicStream=new Tracker(config.token);
  const observe=async(duration)=>{
    const results=await Promise.allSettled([observeWS(config,internal,duration,signal),observeSSE(config,publicStream,duration,signal,event=>log(`DIAGNOSTIC public_sse ${JSON.stringify(event)}`))]);
    results.forEach((r,i)=>check(i?'public SSE observation':'internal WS observation',r.status==='fulfilled'));
  };
  await observe(config.observeMs);
  if(signal?.aborted)throw new Error('Interrupted');
  // Close and reopen our own two read-only clients; never restart remote services.
  internal.reconnect();publicStream.reconnect();await sleep(200);await observe(config.observeMs);
  if(signal?.aborted)throw new Error('Interrupted');
  if(config.soakMs){internal.reconnect();publicStream.reconnect();await observe(config.soakMs);}
  for(const [name,tracker] of [['internal WS',internal],['public SSE',publicStream]]){
    const s=tracker.report();check(`${name} snapshots and incremental updates`,s.snapshots>=2&&s.deltas>0);
    check(`${name} populated spot and linear universe`,s.tickers>0&&s.assets>0&&s.spot>0&&s.linear>0);
    check(`${name} continuity and bounded frames`,s.rejectedFrames===0&&s.revisionGaps===0&&s.largestFrameBytes<=MAX_BYTES);
    check(`${name} null observations`,s.nullObservations>0);
    if(s.zeroObservations)check(`${name} natural numeric zero preserved`,true);else{checks.push({name:`${name} natural zero not observed`,status:'NOT RUN'});log(`NOT RUN ${name} natural zero not observed`);}
    log(`${name} ${JSON.stringify(s)}`);
  }
  // Compare immutable normalized identity and naturally null-only spot
  // derivative fields across actual transports; prices may change in flight.
  const common=[...internal.rows.values()].filter(row=>publicStream.rows.has(row.id));
  check('collector to API normalized identity',common.length>0&&common.every(row=>{const other=publicStream.rows.get(row.id);return row.baseAsset===other.baseAsset&&row.quoteAsset===other.quoteAsset&&row.marketType===other.marketType;}));
  const nullFields=['fundingRate','indexPrice','markPrice','openInterest'];
  const nulls=common.filter(row=>row.marketType==='spot').flatMap(row=>nullFields.filter(k=>row[k]===null).map(k=>publicStream.rows.get(row.id)[k]===null));
  check('spot derivative nulls preserved across transports',nulls.length>0&&nulls.every(Boolean));
  try{const result=await request('/internal/v1/diagnostics',config.token);diagnosticsLast=safeDiagnostics(JSON.parse(result.text));}catch{check('final diagnostics',false);}
  log(`diagnostics ${JSON.stringify({before:diagnostics,after:diagnosticsLast})}`);
  const ok=checks.every(c=>c.status!=='FAIL');log(`${ok?'PASS':'FAIL'} staging verification (read-only; not production readiness)`);
  return {ok,checks,internal:internal.report(),public:publicStream.report(),diagnosticsBefore:diagnostics,diagnosticsAfter:diagnosticsLast};
}
module.exports={settings,secretIn,bodyText,requestCollector,parseFrame,Tracker,SSEParser,safeDiagnostics,collectorStage,collectorDiagnostic,observeSSE,verify};
if(require.main===module){
  const abort=new AbortController();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>abort.abort());
  verify(process.env,console.log,abort.signal).then(result=>{process.exitCode=result.ok?0:1;}).catch(()=>{console.error('FAIL staging verifier');process.exitCode=1;});
}
