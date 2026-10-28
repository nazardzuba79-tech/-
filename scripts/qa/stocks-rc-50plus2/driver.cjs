'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{sha,loopback}=require('./policy.cjs');
// Normal load (#613, 28.10): a trader reads its state every 4 s and runs the order cycle (limit, cancel, market buy,
// its exact replay, market sell, its exact replay) on every second read, every 8 s. At the old every-4 s cycle two
// traders alone made 210 private authority requests a minute, plus 60-90 identity batches for the viewers: about
// 300 against the release ingress's reviewed 240/min ceiling (docs/STOCKS_PRIVATE_AUTHORITY_QUOTA_20261020.md).
// Going over that ceiling on purpose is a separate scenario (services/stocks-global/identity-load.pg.test.cjs).
const PLAN=Object.freeze({warmupMs:5000,measureMs:20000,cryptoPeriodMs:250,viewerPeriodMs:1000,traderPeriodMs:4000,traderOrderEvery:2,timeoutMs:3000,maxJitterMs:250,maxInflight:80,viewers:50,traders:2});
const traderOrders=cycle=>cycle%PLAN.traderOrderEvery===PLAN.traderOrderEvery-1;
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
async function window(info,{mixed=false,warmup=false,arm,signal}={}){
 loopback(info.apiOrigin);loopback(info.stocksOrigin);
 const duration=warmup?PLAN.warmupMs:PLAN.measureMs,r={arm,warmup,startedAt:new Date().toISOString(),cryptoJobs:0,cryptoLatencies:[],traceSha,viewerCount:mixed?50:0,traderCount:mixed?2:0,timeouts:0,unexpectedErrors:0,missedJobs:0,orderLoss:0,doubleSpend:0,viewerMutations:0,viewerDenials:0,requests:0,maxInflight:0,maxStartJitterMs:0,errors:[],samples:[],expected:{crypto:[],stock:[[],[]]}};
 let stopped=false,inflight=0;const start=performance.now(),jobs=[],pending=[];
 const problem=(label,error)=>{r.unexpectedErrors++;if(r.errors.length<15)r.errors.push({label,error:String(error.message??error).slice(0,240)});stopped=true;};
 async function request(origin,route,{method='GET',body,token,csrf,view,expected=200,kind,op,index=null}){
  if(signal?.aborted)throw Error('RUN_ABORTED');
  if(++r.requests>2500)throw Error('HTTP_BUDGET_EXCEEDED');
  const requestId=arm+'-'+(warmup?'warm':'measure')+'-'+r.requests;
  const at=performance.now(),response=await fetch(origin+route,{method,headers:{'x-rc50-request':requestId,authorization:'Bearer '+token,...(view?{'x-stocks-view':view}:{}),...(body===undefined?{}:{'content-type':'application/json','x-stocks-token':csrf??''})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(PLAN.timeoutMs)}).catch(e=>{if(e.name==='TimeoutError'||e.name==='AbortError')r.timeouts++;throw e;});
  const text=await response.text().catch(e=>{if(e.name==='TimeoutError'||e.name==='AbortError')r.timeouts++;throw e;}),value=text?JSON.parse(text):null,ms=performance.now()-at;
  r.samples.push({requestId,kind,op,index,status:response.status,ms,at:at-start});if(kind==='crypto')r.cryptoLatencies.push(ms);
  if(response.status!==expected)throw Error('HTTP_'+response.status+'_'+op+'_'+JSON.stringify(value?.error??null));
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
  const token=info.viewerTokens[index],view='diag-viewer-'+index,id=info.instruments[index%info.instruments.length];
  const state=await request(info.stocksOrigin,stateRoute('viewer',index,id),{token,view,kind:'viewer',op:'state',index});keep('viewer',index,state);
  assert.equal(state.account.canTrade,false);
  if(state.errors?.[id])throw Error('VIEWER_QUOTE_'+state.errors[id]);
  if(cycle===0){
   const result=await request(info.stocksOrigin,'/__stocks_global/orders',{method:'POST',token,view,csrf:state.token,body:{id:'rc50-viewer-deny-'+index,instrumentId:id,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.01'},expected:401,kind:'viewer',op:'deny-order',index});
   assert.equal(result.error,'AUTH_REQUIRED');r.viewerDenials++;
  }
 };
 const traderJob=async(index,cycle)=>{
  const token=info.traderTokens[index],view='diag-trader-'+index,id=info.stockId;
  const state=await request(info.stocksOrigin,stateRoute('trader',index,id),{token,view,kind:'trader',op:'state',index});keep('trader',index,state);
  assert.equal(state.account.canTrade,true);if(state.errors?.[id])throw Error('TRADER_QUOTE_'+state.errors[id]);
  if(!traderOrders(cycle))return;
  const common={token,view,csrf:state.token,kind:'trader',method:'POST',index};
  const prefix='rc50-'+arm+'-'+index+'-'+cycle;
  const submit=async(suffix,side,type,extra={})=>{
   const order={id:prefix+'-'+suffix,instrumentId:id,currency:'USDT',side,type,quantity:'0.01',...extra};
   await request(info.stocksOrigin,'/__stocks_global/orders',{...common,body:order,op:'submit-'+suffix});
   r.expected.stock[index].push({id:order.id,status:type==='LIMIT'?'CANCELLED':'FILLED'});
   return order;
  };
  const limit=await submit('limit','BUY','LIMIT',{limitPrice:'98'});
  await request(info.stocksOrigin,'/__stocks_global/cancel',{...common,body:{id:limit.id},op:'cancel-limit'});
  const buy=await submit('buy','BUY','MARKET');
  await request(info.stocksOrigin,'/__stocks_global/orders',{...common,body:buy,op:'retry-buy'});
  const sell=await submit('sell','SELL','MARKET');
  await request(info.stocksOrigin,'/__stocks_global/orders',{...common,body:sell,op:'retry-sell'});
 };
 for(let at=0,cycle=0;at<duration;at+=PLAN.cryptoPeriodMs,cycle++)jobs.push({at,label:'crypto-'+cycle,fn:()=>cryptoJob(cycle)});
 if(mixed&&!warmup){
  for(let i=0;i<50;i++)for(let at=i*20,cycle=0;at<duration;at+=1000,cycle++)jobs.push({at,label:'viewer-'+i+'-'+cycle,fn:()=>viewerJob(i,cycle)});
  for(let i=0;i<2;i++)for(let at=500+i*2000,cycle=0;at<duration;at+=4000,cycle++)jobs.push({at,label:'trader-'+i+'-'+cycle,fn:()=>traderJob(i,cycle)});
 }
 await Promise.all(jobs.map(job=>new Promise(resolve=>{
  setTimeout(()=>{
   const jitter=performance.now()-start-job.at;r.maxStartJitterMs=Math.max(r.maxStartJitterMs,jitter);
   if(stopped||signal?.aborted||jitter>PLAN.maxJitterMs||inflight>=PLAN.maxInflight){r.missedJobs++;if(jitter>PLAN.maxJitterMs||inflight>=PLAN.maxInflight)problem(job.label,Error('SCHEDULE_OR_INFLIGHT_BOUND'));resolve();return;}
   inflight++;r.maxInflight=Math.max(r.maxInflight,inflight);
   const p=job.fn().catch(e=>problem(job.label,e)).finally(()=>{inflight--;resolve();});pending.push(p);
  },Math.max(0,job.at-(performance.now()-start)));
 })));
 const remaining=duration-(performance.now()-start);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
 await Promise.allSettled(pending);r.finishedAt=new Date().toISOString();r.elapsedMs=performance.now()-start;r.scheduledJobs=jobs.length;
 if(mixed&&!warmup&&r.viewerDenials!==50)r.viewerMutations++;
 return r;
}
module.exports={PLAN,trace,traceSha,window,invariants,decimal,traderOrders};
