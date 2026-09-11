#!/usr/bin/env node
'use strict';
// Read-only staging verification. Secrets enter through env and bearer headers
// only; logs contain fixed check names and allowlisted numeric diagnostics.
const WebSocket = require('ws');
const { randomBytes } = require('node:crypto');
const MAX_BYTES = 16_000_000, MAX_ROWS = 20_000;
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
async function bodyText(response, limit = MAX_BYTES) {
  if (!response.body) return '';
  const reader=response.body.getReader(), chunks=[]; let bytes=0;
  try { while (true) { const {done,value}=await reader.read(); if(done)break;
    bytes+=value.byteLength; if(bytes>limit)throw new Error('Payload limit'); chunks.push(Buffer.from(value));
  } return Buffer.concat(chunks).toString('utf8'); }
  finally { await reader.cancel().catch(()=>{}); }
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
    } catch {this.stats.rejectedFrames++;throw new Error('Stream validation failed');}
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
async function observeSSE(config,tracker,duration,signal) {
  const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)abort.abort();
  let expired=false,rejected=false,timedOut=false;
  const timer=setTimeout(()=>{expired=true;abort.abort();},duration);
  const watchdog=setInterval(()=>{if(tracker.lastAt&&Date.now()-tracker.lastAt>40000){timedOut=true;abort.abort();}},1000);
  let reader;
  try {
    const response=await fetch(`${config.api}/api/v1/market/live`,{redirect:'error',signal:abort.signal,headers:{Accept:'text/event-stream'}});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw new Error('SSE unavailable');
    reader=response.body.getReader();const decoder=new TextDecoder();const parser=new SSEParser((text,event)=>tracker.receive(text,event));
    while(true){const {done,value}=await reader.read();if(done)throw new Error('Unexpected SSE end');parser.push(decoder.decode(value,{stream:true}));}
  } catch { rejected = !expired || timedOut || signal?.aborted; }
  finally {clearTimeout(timer);clearInterval(watchdog);signal?.removeEventListener('abort',cancel);await reader?.cancel().catch(()=>{});abort.abort();}
  if(rejected)throw new Error('Public SSE failed');
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
  const request=async(path,auth)=>{
    const response=await fetch(`${config.collector}${path}`,{redirect:'error',signal:AbortSignal.timeout(10000),headers:auth===undefined?{}:{Authorization:`Bearer ${auth}`}});
    const text=await bodyText(response);if(secretIn(text,config.token))throw new Error('Secret exposed');return {status:response.status,text};
  };
  let diagnostics=null,diagnosticsLast=null;
  try {
    const health=await request('/health');check('collector health',health.status===200&&JSON.parse(health.text).ok===true);
    for(const path of ['/internal/v1/snapshot','/internal/v1/diagnostics'])for(const auth of [undefined,randomBytes(24).toString('hex')]){
      const response=await request(path,auth);check(`${path.endsWith('snapshot')?'snapshot':'diagnostics'} ${auth?'invalid':'missing'} token rejected`,response.status===401);
    }
    for(const auth of [undefined,randomBytes(24).toString('hex')])check(`internal WS ${auth?'invalid':'missing'} token rejected`,await denyWS(config,auth));
    const initial=await request('/internal/v1/snapshot',config.token);const frame=parseFrame(initial.text);
    check('authenticated HTTP snapshot',initial.status===200&&frame.type==='snapshot');
    const diag=await request('/internal/v1/diagnostics',config.token);check('authenticated diagnostics',diag.status===200);
    diagnostics=safeDiagnostics(JSON.parse(diag.text));
  } catch {check('collector HTTP/auth validation',false);}
  const internal=new Tracker(config.token),publicStream=new Tracker(config.token);
  const observe=async(duration)=>{
    const results=await Promise.allSettled([observeWS(config,internal,duration,signal),observeSSE(config,publicStream,duration,signal)]);
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
module.exports={settings,secretIn,bodyText,parseFrame,Tracker,SSEParser,safeDiagnostics,verify};
if(require.main===module){
  const abort=new AbortController();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>abort.abort());
  verify(process.env,console.log,abort.signal).then(result=>{process.exitCode=result.ok?0:1;}).catch(()=>{console.error('FAIL staging verifier');process.exitCode=1;});
}
