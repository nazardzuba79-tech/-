'use strict';
/** Isolated Render diagnostic entrypoint. Imports only three pure reference
 * modules. No exchange bootstrap, Prisma, account, auth or money operation.
 * Public market observations only; no source acceptance rule is weakened.
 */
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const SAFE_CODES = new Set(['metal_identity','metal_payload','ecb_schema','ecb_date','ecb_rate','eia_identity','eia_week','eia_value','eia_conflict','eia_no_observation','invalid_date','future_date','body_limit','no_body']);
const NETWORK_CODES = new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
function failureCode(error, stage) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout_or_abort';
  const net = error?.cause?.code ?? error?.code;
  if (NETWORK_CODES.has(net)) return net;
  if (stage === 'parse' && error instanceof SyntaxError) return 'invalid_json';
  if (stage === 'decode') return 'invalid_utf8';
  return SAFE_CODES.has(error?.message) ? error.message : 'source_unavailable';
}
/** Same seven fixed destinations/parsers as the actual feed. Instrumented fetch
 * buffers at most the adapter's limit and replays those exact response bytes.
 * It makes NO extra HTTP requests and never records body text or headers. */
function observedFetch(lib, fetchFn = fetch, now = Date.now) {
  const targets = new Map(lib.METALS.map(m => [`https://api.gold-api.com/price/${m}`, {id:`gold:${m}`,limit:16384,metal:true,parse:(text,at)=>lib.parseGoldReference(text,m,at)}]));
  targets.set('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', {id:'ecb',limit:32768,parse:lib.parseEcbReferences});
  for (const [symbol,file] of [['WTIUSD','RWTCD.htm'],['XBRUSD','RBRTED.htm']]) targets.set(`https://www.eia.gov/dnav/pet/hist/${file}`, {id:`eia:${symbol}`,limit:2000000,parse:(text,at)=>lib.parseEiaReference(text,symbol,at)});
  const states = new Map();
  function record(id,event) {
    const old=states.get(id) ?? {attempts:0,failures:0,lastFailure:null};
    states.set(id,{attempts:old.attempts+1,failures:old.failures+(event.outcome==='failed'?1:0),last:event,
      lastFailure:event.outcome==='failed'?event:old.lastFailure});
  }
  return {
    diagnostics:()=>[...states].map(([id,state])=>({id,...JSON.parse(JSON.stringify(state))})),
    fetch:async(url,init)=>{
      const target=targets.get(String(url));
      if(!target)throw new Error('Unapproved reference destination');
      const startedAt=now(),started=performance.now();
      let stage='transport',httpStatus=null,bytes=0,sourceTimestamp=null,httpTimestamp=null;
      const event=(outcome,code=null)=>({startedAt,finishedAt:now(),durationMs:Math.round(performance.now()-started),stage,httpStatus,bytes,
        sourceTimestamp,httpTimestamp,sourceLeadMs:sourceTimestamp===null?null:sourceTimestamp-now(),outcome,code});
      try {
        const response=await fetchFn(url,{...init,redirect:'error'});httpStatus=response.status;stage='http';
        const date=Date.parse(response.headers.get('date') ?? '');httpTimestamp=Number.isFinite(date)?date:null;
        if(!response.ok){record(target.id,event('failed',`http_${response.status}`));return response;}
        stage='body';const reader=response.body?.getReader();if(!reader)throw Error('no_body');const chunks=[];
        try {for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
          if(bytes>target.limit){await reader.cancel();throw Error('body_limit');}chunks.push(part.value);}}
        finally{reader.releaseLock();}
        const data=Buffer.concat(chunks);stage='decode';const text=new TextDecoder('utf-8',{fatal:true}).decode(data);stage='parse';
        if(target.metal){const raw=JSON.parse(text);const at=typeof raw?.updatedAt==='string'?Date.parse(raw.updatedAt):NaN;sourceTimestamp=Number.isFinite(at)?at:null;}
        // Independent diagnostic parsing retains the very same rejection rules.
        target.parse(text,now());stage='accepted';record(target.id,event('parsed'));
        return new Response(data,{status:response.status,headers:response.headers});
      } catch(error) {
        record(target.id,event('failed',failureCode(error,stage)));throw error;
      }
    },
  };
}
function assertReviewEnvironment(env) {
  if(env.VOLTEX_CFD_REFERENCE_REVIEW!=='true')throw Error('Dedicated reference review mode required');
  for(const name of ['DATABASE_URL','DIRECT_URL','JWT_SECRET','API_KEY_ENCRYPTION_SECRET','TWELVE_DATA_API_KEY','TWELVEDATA_API_KEY'])
    if(env[name])throw Error('Exchange/database credentials are forbidden in reference review');
}
const HTML='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOLTEX reference review</title><link rel="stylesheet" href="/review.css"><h1>VOLTEX — CFD reference review</h1><p>Read-only test service. No accounts, database or trading. Daily and indicative observations are not executable prices.</p><p id="state">Loading reference observations…</p><div class="table"><table><thead><tr><th>Instrument</th><th>Reference / last known</th><th>Status</th><th>Source, date and basis</th></tr></thead><tbody id="rows"></tbody></table></div><p>Unavailable remains —. A last-known observation is dated and never labelled live.</p><script src="/review.js" defer></script></html>';
const CSS='body{font:16px/1.5 system-ui,sans-serif;background:#f5f6f8;color:#172130;max-width:1200px;margin:auto;padding:24px}h1{font-size:24px}.table{overflow:auto;background:white;border:1px solid #ccd3de}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #dde2e9}td:nth-child(2){font-variant-numeric:tabular-nums;white-space:nowrap}td:last-child{min-width:260px;font-size:13px}';
const JS="'use strict';async function load(){try{const r=await fetch('/api/v1/cfd/tickers',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();const body=document.getElementById('rows');body.replaceChildren();for(const row of data.tickers){const tr=document.createElement('tr');for(const value of [row.symbol,row.price===null?'—':row.price,row.status,row.referenceLabel??'Unavailable']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}document.getElementById('state').textContent='Read-only • '+data.observedAt+' • revision '+(data.revision??'unknown');}catch{document.getElementById('rows').replaceChildren();document.getElementById('state').textContent='Reference service unavailable — no current prices.';}}load();setInterval(load,60000);";
function createReviewServer({feed,catalog,display,trace,revision=null,now=Date.now}) {
  function payload(){const fallback=new Map(feed.snapshot().map(q=>[q.symbol,q]));return {
    mode:'read-only-reference-review',source:'public-reference-test',configured:true,executionAllowed:false,revision,observedAt:new Date(now()).toISOString(),
    tickers:catalog.map(i=>display({symbol:i.symbol,provider:'none',providerSymbol:i.providerSymbol,last:null,bid:null,ask:null,mid:null,
      status:'unavailable',stale:true,providerTimestamp:null,fetchedAt:null,executionAllowed:false,entitlementVerified:false},i.name,fallback.get(i.symbol),5000,now()))};}
  return http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`});res.end(req.method==='HEAD'?undefined:typeof value==='string'?value:JSON.stringify(value));};
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return send(405,{error:'read_only_review'});}
    try {
      // Only origin-form literal allowlisted paths. Malformed/absolute request
      // targets cannot throw a URL-parser exception or select another host.
      const pathname=typeof req.url==='string'?req.url.split('?',1)[0]:'';
      if(pathname==='/health')return send(200,{ok:true,mode:'read-only-reference-review',revision,databaseUsed:false,executionAllowed:false,observations:feed.snapshot().length});
      if(pathname==='/api/v1/cfd/tickers')return send(200,payload());
      if(pathname==='/diagnostics')return send(200,{mode:'read-only-reference-review',revision,observedAt:new Date(now()).toISOString(),sources:trace.diagnostics(),scheduler:feed.diagnostics()});
      if(pathname==='/')return send(200,HTML,'text/html');
      if(pathname==='/review.js')return send(200,JS,'text/javascript');
      if(pathname==='/review.css')return send(200,CSS,'text/css');
      return send(404,{error:'not_found'});
    }catch{return send(503,{error:'reference_review_unavailable'});}
  });
}
function start() {
  assertReviewEnvironment(process.env);
  const root=path.resolve(__dirname,'../dist/services/marketData/cfd');
  const lib=require(path.join(root,'PublicReferenceFeed.js'));
  const {publicReferenceDisplay}=require(path.join(root,'PublicReferenceDisplay.js'));
  const {CFD_REFERENCE_CATALOG}=require(path.join(root,'catalog.js'));
  const trace=observedFetch(lib);const feed=new lib.PublicReferenceFeed({enabled:true,fetchFn:trace.fetch});
  const raw=process.env.RENDER_GIT_COMMIT;const revision=typeof raw==='string'&&/^[a-f0-9]{40}$/.test(raw)?raw:null;
  const server=createReviewServer({feed,catalog:CFD_REFERENCE_CATALOG,display:publicReferenceDisplay,trace,revision});
  const port=Number(process.env.PORT ?? 10000);if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid review port');
  let stopping=false;
  const refresh=()=>{if(stopping)return;void feed.refreshDue().catch(()=>console.error('reference_review_refresh_failed'));};
  const timer=setInterval(refresh,15000);timer.unref();
  server.requestTimeout=10000;server.headersTimeout=10000;
  server.listen(port,'0.0.0.0',()=>{console.log(JSON.stringify({event:'reference_review_ready',revision,databaseUsed:false,executionAllowed:false}));refresh();});
  function shutdown(){stopping=true;clearInterval(timer);server.close();server.closeIdleConnections();const deadline=setTimeout(()=>process.exit(0),10000);deadline.unref();}
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
module.exports={observedFetch,failureCode,assertReviewEnvironment,createReviewServer};
if(require.main===module)start();
