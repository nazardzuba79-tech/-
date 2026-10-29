'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{sha,loopback}=require('./policy.cjs');
// Normal load (#613, 28.10): a trader reads its state every 4 s and runs the order cycle (limit, cancel, market buy,
// its exact replay, market sell, its exact replay) on every second read, every 8 s. At the old every-4 s cycle two
// traders alone made 210 private authority requests a minute, plus 60-90 identity batches for the viewers: about
// 300 against the release ingress's reviewed 240/min ceiling (docs/STOCKS_PRIVATE_AUTHORITY_QUOTA_20261020.md).
// Going over that ceiling on purpose is a separate scenario (services/stocks-global/identity-load.pg.test.cjs).
// The acceptance load is the original one: each trader reads its state and runs the order cycle every 4 s.
// RC50_REVISED_8S=1 (diagnostic-run-613.cjs --revised-8s) runs the cycle on every second read, every 8 s:
// a separately labelled diagnostic, never the acceptance verdict.
// RC50_TERMINAL_3S=1 (diagnostic-run-613.cjs --terminal-3s, #613 R9): the viewers read their state every 3 s, as the real
// terminal polls (GlobalStocks.tsx startVisibleStockPolling(..., 3000)); the traders keep the original 4 s cycle. Also
// a separately labelled diagnostic: the acceptance load keeps the viewers at 1 s.
const REVISED_8S=process.env.RC50_REVISED_8S==='1',TERMINAL_3S=process.env.RC50_TERMINAL_3S==='1',PUSH_VIEWERS=process.env.RC50_PUSH_VIEWERS==='1';
assert.ok(!(REVISED_8S&&TERMINAL_3S||PUSH_VIEWERS&&(REVISED_8S||TERMINAL_3S)),'RC50_ONE_DIAGNOSTIC_WORKLOAD');
const WORKLOAD=PUSH_VIEWERS?'push-viewers-diagnostic':REVISED_8S?'revised-8s-diagnostic':TERMINAL_3S?'terminal-3s-diagnostic':'original-4s';
const PLAN=Object.freeze({warmupMs:5000,measureMs:20000,cryptoPeriodMs:250,viewerPeriodMs:TERMINAL_3S?3000:1000,traderPeriodMs:4000,traderOrderEvery:REVISED_8S?2:1,timeoutMs:3000,maxJitterMs:250,maxInflight:80,viewers:50,traders:2});
const traderOrders=cycle=>cycle%PLAN.traderOrderEvery===PLAN.traderOrderEvery-1;
// #613 R8 sustained load (diagnostic-run-613.cjs --sustained, report only, never the p95 verdict): the same arrivals
// for SUSTAINED.measureMs instead of 20 s, to see the private quota over whole minutes. A 429 with Retry-After is
// answered as the terminal does (GlobalStocks.tsx pauses on an overload code for its retryAfterMs): a viewer skips its
// polls until then; a trader waits and sends the same request again (same intent id, so the authority's idempotency
// keeps it exactly-once) and skips the cycles that fall into that wait. A viewer or trader read that finds its quote
// not live (after such a pause its instrument's stream has to start again) is counted, and a trader places no order
// in that cycle. A trader order step refused with QUOTE_STALE / QUOTE_UNAVAILABLE (the authority rolls such a command
// back: no order, no receipt) is counted, the trader reads its state again and sends the same intent after 1 s, as a
// user would, for at most SUSTAINED.maxTraderWaitMs. A GET that fails before any answer (an idle keep-alive socket
// the server closed during such a pause) is sent once more, as a browser does for an idempotent read (counted); a
// viewer read that fails again (e.g. the gateway refusing connections over its maxConnections) is counted as a refused
// connection and that viewer polls again next second. Any other refusal a viewer gets (e.g. 503 AUTH_UNAVAILABLE when
// its identity check outlived its deadline, or since #613 R9 the gateway's explicit 503 SOURCE_BUSY with Retry-After
// near its connection bound) is counted by status and code, honouring a retryAfterMs if one is given.
// A trader's failed connection or any other trader status still fails the run. A job that starts late because the driver
// stalled is counted and still runs (the client headroom check of the window stays). Every 429 is counted; any other
// status still fails the run, and so does a crypto 429. The request bound scales with the window.
const SUSTAINED=Object.freeze({measureMs:180000,viewerTimeoutMs:5000,maxInflight:200,minRetryMs:1000,maxRetryMs:60000,maxTraderWaitMs:90000});
const trace=Array.from({length:PLAN.measureMs/PLAN.cryptoPeriodMs},(_,i)=>({at:i*PLAN.cryptoPeriodMs,cycle:i,operations:['POST demo/orders LIMIT BTC/USDT BUY 0.01 @100','GET demo/orders/open','DELETE exact created order','GET demo/balances']}));
const traceSha=sha(JSON.stringify(trace));
const decimal=s=>{const m=String(s).match(/^(-?)(\d+)(?:\.(\d{1,18}))?$/);if(!m)throw Error('INVALID_DECIMAL');return BigInt(m[1]+m[2])*10n**18n+BigInt((m[1]||'')+(m[3]||'').padEnd(18,'0'));};
function invariants(before,after,expected){
 let orderLoss=0,doubleSpend=0,viewerMutations=0;
 for(let i=0;i<2;i++){
  if(decimal(after.cash[i].available)+decimal(after.cash[i].locked)!==decimal(before.cash[i].available)+decimal(before.cash[i].locked)||decimal(after.cash[i].locked)!==0n)doubleSpend++;
  if(after.accounts[i].positions.some(p=>decimal(p.quantity)!==0n||decimal(p.reserved)!==0n||decimal(p.cost)!==0n))orderLoss++;
  const actual=after.accounts[i].orders,ids=actual.map(o=>o.id),wanted=[...before.accounts[i].orders.map(o=>o.id),...expected.stock[i].map(o=>o.id)];
  if(new Set(ids).size!==ids.length)doubleSpend++;
  if(ids.length!==wanted.length||wanted.some(id=>!ids.includes(id))||ids.some(id=>!wanted.includes(id)))orderLoss++;
  for(const o of expected.stock[i])if(actual.find(a=>a.id===o.id)?.status!==o.status)orderLoss++;
 }
 const receipts=after.receipts.map(r=>r.principalHash+'|'+r.intentId);if(new Set(receipts).size!==receipts.length)doubleSpend++;
 const beforeIds=new Set(before.cryptoOrders.map(o=>o.id)),actual=after.cryptoOrders.filter(o=>!beforeIds.has(o.id));
 if(actual.length!==expected.crypto.length||expected.crypto.some(id=>!actual.some(o=>o.id===id&&o.status==='CANCELLED'))||actual.some(o=>o.status!=='CANCELLED'))orderLoss++;
 if(after.viewerBalances!==0||after.accountCount!==2)viewerMutations++;
 if(after.network?.blocked)throw Error('EGRESS_FENCE_TRIGGERED');
 return{orderLoss,doubleSpend,viewerMutations,cryptoOrders:actual.length,stockOrders:after.accounts.map(a=>a.orders.length),receiptCount:receipts.length,viewerBalanceRows:after.viewerBalances,financialAccounts:after.accountCount};
}
async function window(info,{mixed=false,warmup=false,arm,signal,sustained=false,sustainedMs=SUSTAINED.measureMs}={}){
 loopback(info.apiOrigin);loopback(info.stocksOrigin);
 const duration=warmup?PLAN.warmupMs:sustained?sustainedMs:PLAN.measureMs,maxRequests=2500*Math.ceil(duration/PLAN.measureMs),maxInflight=sustained?SUSTAINED.maxInflight:PLAN.maxInflight;
 const r={arm,warmup,startedAt:new Date().toISOString(),cryptoJobs:0,cryptoLatencies:[],traceSha,viewerCount:mixed?50:0,traderCount:mixed?2:0,timeouts:0,unexpectedErrors:0,missedJobs:0,orderLoss:0,doubleSpend:0,viewerMutations:0,viewerDenials:0,requests:0,maxInflight:0,maxStartJitterMs:0,errors:[],samples:[],expected:{crypto:[],stock:[[],[]]},...(sustained?{sustained:true,durationMs:duration,viewerRateLimited:0,viewerRateLimitedWithoutRetryAfter:0,viewerPollsDeferred:0,traderRateLimited:0,traderRateLimitedWithoutRetryAfter:0,traderCyclesSkipped:0,traderQuoteNotLive:{},viewerQuoteNotLive:{},traderQuoteRefusals:{},networkRetries:0,viewerConnectionsRefused:0,viewerOtherRefusals:{},lateJobs:0}:{})};
 const viewerPausedUntil=new Map(),traderBusy=new Set();
 let stopped=false,inflight=0;const start=performance.now(),jobs=[],pending=[];
 const problem=(label,error)=>{r.unexpectedErrors++;if(r.errors.length<15)r.errors.push({label,error:String(error.message??error).slice(0,240)});stopped=true;};
 async function request(origin,route,{method='GET',body,token,csrf,view,expected=200,kind,op,index=null,retry={}}){
  if(signal?.aborted)throw Error('RUN_ABORTED');
  if(++r.requests>maxRequests)throw Error('HTTP_BUDGET_EXCEEDED');
  const requestId=arm+'-'+(warmup?'warm':'measure')+'-'+r.requests;
  const limited=sustained&&(kind==='viewer'||kind==='trader');
  const at=performance.now(),response=await fetch(origin+route,{method,headers:{'x-rc50-request':requestId,authorization:'Bearer '+token,...(view?{'x-stocks-view':view}:{}),...(body===undefined?{}:{'content-type':'application/json','x-stocks-token':csrf??''})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(limited?SUSTAINED.viewerTimeoutMs:PLAN.timeoutMs)}).catch(e=>{if(e.name==='TimeoutError'||e.name==='AbortError'){r.timeouts++;throw e;}
   if(limited&&method==='GET'&&!retry.network){r.networkRetries++;return null;}
   if(limited&&kind==='viewer'){r.viewerConnectionsRefused++;(r.connectionErrors??=[]).length<20&&r.connectionErrors.push({at:at-start,op,cause:String(e.cause?.code??e.cause?.message??e.message)});return undefined;}
   e.message+=e.cause?' ('+(e.cause.code??e.cause.message)+')':'';throw e;});
  if(response===undefined)return null;
  if(response===null)return request(origin,route,{method,body,token,csrf,view,expected,kind,op,index,retry:{...retry,network:true}});
  const text=await response.text().catch(e=>{if(e.name==='TimeoutError'||e.name==='AbortError')r.timeouts++;throw e;}),value=text?JSON.parse(text):null,ms=performance.now()-at;
  const sample={requestId,kind,op,index,status:response.status,ms,at:at-start};r.samples.push(sample);if(kind==='crypto')r.cryptoLatencies.push(ms);
  if(limited&&response.status===429){
   sample.retryAfter=response.headers.get('retry-after');sample.error=value?.error??null;
   const header=/^\d+$/.test(sample.retryAfter??''),waitMs=Math.min(SUSTAINED.maxRetryMs,Math.max(SUSTAINED.minRetryMs,header?Number(sample.retryAfter)*1000:0,Number.isFinite(value?.retryAfterMs)?value.retryAfterMs:0));
   if(kind==='viewer'){r.viewerRateLimited++;if(!header)r.viewerRateLimitedWithoutRetryAfter++;viewerPausedUntil.set(index,performance.now()+waitMs);return null;}
   r.traderRateLimited++;if(!header)r.traderRateLimitedWithoutRetryAfter++;
   if((retry.waitedMs??0)+waitMs>SUSTAINED.maxTraderWaitMs)throw Error('TRADER_RATE_LIMITED_BEYOND_'+SUSTAINED.maxTraderWaitMs+'MS_'+op);
   await new Promise(resolve=>setTimeout(resolve,waitMs));
   return request(origin,route,{method,body,token,csrf,view,expected,kind,op,index,retry:{waitedMs:(retry.waitedMs??0)+waitMs}});
  }
  if(sustained&&kind==='viewer'&&response.status!==expected){
   sample.retryAfter=response.headers.get('retry-after');sample.error=value?.error??null;
   const k=response.status+':'+(value?.error??'');r.viewerOtherRefusals[k]=(r.viewerOtherRefusals[k]??0)+1;
   if(Number.isFinite(value?.retryAfterMs))viewerPausedUntil.set(index,performance.now()+Math.min(SUSTAINED.maxRetryMs,Math.max(SUSTAINED.minRetryMs,value.retryAfterMs)));
   return null;
  }
  if(response.status!==expected){const e=Error('HTTP_'+response.status+'_'+op+'_'+JSON.stringify(value?.error??null));if(sustained&&kind==='trader'&&method==='POST'&&/^QUOTE_(STALE|UNAVAILABLE)$/.test(value?.error??''))e.quoteRefusal=value.error;throw e;}
  return value;
 }
 const cryptoJob=async cycle=>{
  r.cryptoJobs++;const common={token:info.traderTokens[0],kind:'crypto'};
  const placed=await request(info.apiOrigin,'/api/v1/demo/orders',{...common,method:'POST',body:{pair:'BTC/USDT',side:'BUY',type:'LIMIT',price:'100',quantity:'0.01'},expected:201,op:'place-limit'});
  assert.equal(placed.order.status,'OPEN');r.expected.crypto.push(placed.order.id);
  const open=await request(info.apiOrigin,'/api/v1/demo/orders/open',{...common,op:'open'});assert.ok(open.some(o=>o.id===placed.order.id));
  await request(info.apiOrigin,'/api/v1/demo/orders/'+encodeURIComponent(placed.order.id),{...common,method:'DELETE',expected:204,op:'cancel'});
  await request(info.apiOrigin,'/api/v1/demo/balances',{...common,op:'balances'});
 };
 // As the terminal (GlobalStocks.tsx, catalogueVersion.ts): a client's first state read gets the full catalogue;
 // every later read names the version it holds and the gateway leaves the unchanged catalogue out.
 const held={viewer:new Map(),trader:new Map()};
 const stateRoute=(kind,index,id)=>'/__stocks_global/state?id='+encodeURIComponent(id)+(held[kind].has(index)?'&catalogue='+held[kind].get(index):'');
 const keep=(kind,index,state)=>{if(Array.isArray(state.catalogue)&&/^[a-f0-9]{16}$/.test(state.catalogueVersion??''))held[kind].set(index,state.catalogueVersion);else if(!Array.isArray(state.catalogue)&&state.catalogueVersion!==held[kind].get(index))throw Error('CATALOGUE_VERSION_LOST');};
 const viewerJob=async(index,cycle)=>{
  if(sustained&&(viewerPausedUntil.get(index)??0)>performance.now()){r.viewerPollsDeferred++;return;}
  const token=info.viewerTokens[index],view='diag-viewer-'+index,id=info.instruments[index%info.instruments.length];
  const state=await request(info.stocksOrigin,stateRoute('viewer',index,id),{token,view,kind:'viewer',op:'state',index});if(state===null)return;keep('viewer',index,state);
  assert.equal(state.account.canTrade,false);
  if(state.errors?.[id]){if(!sustained)throw Error('VIEWER_QUOTE_'+state.errors[id]);r.viewerQuoteNotLive[state.errors[id]]=(r.viewerQuoteNotLive[state.errors[id]]??0)+1;}
  if(cycle===0){
   const result=await request(info.stocksOrigin,'/__stocks_global/orders',{method:'POST',token,view,csrf:state.token,body:{id:'rc50-viewer-deny-'+index,instrumentId:id,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.01'},expected:401,kind:'viewer',op:'deny-order',index});
   if(result===null)return;assert.equal(result.error,'AUTH_REQUIRED');r.viewerDenials++;
  }
 };
 const traderJob=async(index,cycle)=>{
  // --sustained: a trader still waiting out a 429 does not start another cycle (the terminal sends one order at a time).
  if(sustained){if(traderBusy.has(index)){r.traderCyclesSkipped++;return;}traderBusy.add(index);try{return await traderCycle(index,cycle);}finally{traderBusy.delete(index);}}
  return traderCycle(index,cycle);
 };
 const traderCycle=async(index,cycle)=>{
  const token=info.traderTokens[index],view='diag-trader-'+index,id=info.stockId;
  const state=await request(info.stocksOrigin,stateRoute('trader',index,id),{token,view,kind:'trader',op:'state',index});keep('trader',index,state);
  assert.equal(state.account.canTrade,true);
  if(state.errors?.[id]){if(!sustained)throw Error('TRADER_QUOTE_'+state.errors[id]);r.traderQuoteNotLive[state.errors[id]]=(r.traderQuoteNotLive[state.errors[id]]??0)+1;return;}
  if(!traderOrders(cycle))return;
  const common={token,view,csrf:state.token,kind:'trader',method:'POST',index};
  const prefix='rc50-'+arm+'-'+index+'-'+cycle;
  // --sustained only: a step refused because the quote is not live is sent again (same intent) after a fresh read.
  const send=async(route,options)=>{
   for(let waited=0;;waited+=1000){
    try{return await request(info.stocksOrigin,route,options);}
    catch(e){
     if(!e.quoteRefusal||waited+1000>SUSTAINED.maxTraderWaitMs)throw e;
     r.traderQuoteRefusals[e.quoteRefusal]=(r.traderQuoteRefusals[e.quoteRefusal]??0)+1;
     await new Promise(resolve=>setTimeout(resolve,1000));
     keep('trader',index,await request(info.stocksOrigin,stateRoute('trader',index,id),{token,view,kind:'trader',op:'state-refresh',index}));
    }
   }
  };
  const submit=async(suffix,side,type,extra={})=>{
   const order={id:prefix+'-'+suffix,instrumentId:id,currency:'USDT',side,type,quantity:'0.01',...extra};
   await send('/__stocks_global/orders',{...common,body:order,op:'submit-'+suffix});
   r.expected.stock[index].push({id:order.id,status:type==='LIMIT'?'CANCELLED':'FILLED'});
   return order;
  };
  const limit=await submit('limit','BUY','LIMIT',{limitPrice:'98'});
  await send('/__stocks_global/cancel',{...common,body:{id:limit.id},op:'cancel-limit'});
  const buy=await submit('buy','BUY','MARKET');
  await send('/__stocks_global/orders',{...common,body:buy,op:'retry-buy'});
  const sell=await submit('sell','SELL','MARKET');
  await send('/__stocks_global/orders',{...common,body:sell,op:'retry-sell'});
 };
 for(let at=0,cycle=0;at<duration;at+=PLAN.cryptoPeriodMs,cycle++)jobs.push({at,label:'crypto-'+cycle,fn:()=>cryptoJob(cycle)});
 if(mixed&&!warmup){
  // Push viewers hold one SSE connection. Their initial state + denied trade are
  // checked once; subsequent repeated GET /state polling is intentionally absent.
  for(let i=0;i<50;i++)for(let at=i*20,cycle=0;at<duration;at+=PLAN.viewerPeriodMs,cycle++){
   if(PUSH_VIEWERS&&cycle>0)break;
   jobs.push({at,label:'viewer-'+i+'-'+cycle,fn:()=>viewerJob(i,cycle)});
  }
  for(let i=0;i<2;i++)for(let at=500+i*2000,cycle=0;at<duration;at+=4000,cycle++)jobs.push({at,label:'trader-'+i+'-'+cycle,fn:()=>traderJob(i,cycle)});
 }
 await Promise.all(jobs.map(job=>new Promise(resolve=>{
  setTimeout(()=>{
   const jitter=performance.now()-start-job.at;r.maxStartJitterMs=Math.max(r.maxStartJitterMs,jitter);
   const late=jitter>PLAN.maxJitterMs&&!sustained;if(sustained&&jitter>PLAN.maxJitterMs)r.lateJobs++;
   if(stopped||signal?.aborted||late||inflight>=maxInflight){r.missedJobs++;if(late||inflight>=maxInflight)problem(job.label,Error('SCHEDULE_OR_INFLIGHT_BOUND'));resolve();return;}
   inflight++;r.maxInflight=Math.max(r.maxInflight,inflight);
   const p=job.fn().catch(e=>problem(job.label,e)).finally(()=>{inflight--;resolve();});pending.push(p);
  },Math.max(0,job.at-(performance.now()-start)));
 })));
 const remaining=duration-(performance.now()-start);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
 await Promise.allSettled(pending);r.finishedAt=new Date().toISOString();r.elapsedMs=performance.now()-start;r.scheduledJobs=jobs.length;
 // Every viewer's forged order is refused once (401); under --sustained a refusal may be the gateway's 429 instead,
 // never an acceptance.
 if(mixed&&!warmup&&r.viewerDenials+(sustained?r.samples.filter(x=>x.op==='deny-order'&&x.status===429).length:0)!==50)r.viewerMutations++;
 return r;
}
module.exports={PLAN,SUSTAINED,WORKLOAD,trace,traceSha,window,invariants,decimal,traderOrders};
