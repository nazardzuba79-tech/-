import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openStore } from './store.mjs';
import { accountId } from './accounts.mjs';
import { openAccountWorker } from './account-worker.mjs';
import { executeAccountCommand } from './account-commands.mjs';
import { identityResolver } from './identity.mjs';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { isReleaseAuthority } from './release-authority.mjs';
import { MarketHub } from './market.mjs';
import { createStocksRuntimeMarket } from './runtime-market.mjs';
import { CATALOG, instrument } from './catalog.mjs';
import { check, SimError, snapshot } from './engine.mjs';
import { projectViewerQuote } from './viewer-projection.mjs';
import { preDemandReadiness } from './quote-readiness.mjs';
import { twoTraderPolicy, configuredTraders, marketOnlyState } from './trader-policy.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url))),API='/__stocks_global/';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
// Instrument admission, not transport concurrency: MarketHub retains its own
// request coalescing, six-second transport deadlines and per-host rate limits.
export function createQuoteReader({hub,now=Date.now,sourceAllowed=()=>{},monotonicNow=()=>performance.now(),schedule=setTimeout,cancelTimer=clearTimeout}){
  const recent=new Map(),flights=new Map(),queue=[];
  const counters={maxActive:0,maxQueued:0,coalesced:0,cancelled:0,expired:0,rejected:0,started:0};
  let active=0,waiters=0,closed=false;
  const busy=()=>new SimError('SOURCE_BUSY');
  const fresh=(id,minimumTimestamp)=>{const cached=recent.get(id);return cached&&hub.quoteValid?.(cached.value,id)!==false&&now()-cached.at<2000&&(minimumTimestamp===undefined||cached.value.timestamp>=minimumTimestamp)?cached:null;};
  const removeQueued=(flight,error)=>{
    if(flight.state!=='queued')return;
    const index=queue.indexOf(flight);if(index!==-1)queue.splice(index,1);
    cancelTimer(flight.timer);flight.state='cancelled';
    if(flights.get(flight.id)===flight)flights.delete(flight.id);
    flight.reject(error);
  };
  const pump=()=>{
    while(!closed&&active<2&&queue.length){
      const flight=queue[0];
      if(monotonicNow()>=flight.deadline){counters.expired++;removeQueued(flight,busy());continue;}
      if(!flight.waiters.size){removeQueued(flight,busy());continue;}
      queue.shift();cancelTimer(flight.timer);flight.state='active';active++;
      counters.maxActive=Math.max(counters.maxActive,active);counters.started++;flight.resolve();
    }
  };
  const finish=flight=>{
    flight.outstanding--;
    if(flight.outstanding)return;
    if(flights.get(flight.id)===flight)flights.delete(flight.id);
    if(flight.state==='active')active--;
    flight.state='finished';pump();
  };
  const reader=(flight,pending,signal)=>new Promise((resolve,reject)=>{
    let done=false;
    const entry={pending};
    const settle=(error,value)=>{
      if(done)return;done=true;signal?.removeEventListener('abort',abort);
      flight.waiters.delete(entry);waiters--;
      if(!flight.waiters.size)removeQueued(flight,busy());
      if(!error&&hub.quoteValid?.(value,flight.id)===false)error=new SimError('QUOTE_UNAVAILABLE');error?reject(error):resolve(value);
    };
    const abort=()=>{counters.cancelled++;settle(busy());};
    flight.waiters.add(entry);waiters++;
    signal?.addEventListener('abort',abort,{once:true});
    pending.then(value=>settle(null,value),error=>settle(error));
    if(signal?.aborted)abort();
  });
  const quote=(id,{includeUsdc=true,signal,minimumTimestamp}={})=>{
    check(!closed&&!signal?.aborted,'SOURCE_BUSY');sourceAllowed(id);
    check(minimumTimestamp===undefined||Number.isSafeInteger(minimumTimestamp)&&minimumTimestamp>=0,'INVALID_REQUEST');
    const cached=fresh(id,minimumTimestamp);
    if(cached&&(!includeUsdc||cached.includeUsdc))return Promise.resolve(cached.value);
    if(waiters>=256){counters.rejected++;throw busy();}
    let flight=flights.get(id),created=false;
    if(!flight){
      if(active>=2&&queue.length>=32){counters.rejected++;throw busy();}
      flight={id,state:'queued',deadline:monotonicNow()+2000,waiters:new Set(),outstanding:0,native:null,full:null};
      flight.ready=new Promise((resolve,reject)=>{flight.resolve=resolve;flight.reject=reject;});
      flights.set(id,flight);created=true;
    }else counters.coalesced++;
    let pending=includeUsdc?flight.full:(flight.native??flight.full);
    if(!pending){
      // Promotion joins the original native observation and holds its permit
      // through FX settlement. Queue residence never renews the native TTL.
      const native=includeUsdc?flight.native:null;
      let unusedPromotion=false;
      const requirePromotionReader=()=>{
        if(native&&![...flight.waiters].some(entry=>entry.pending===pending)){
          unusedPromotion=true;throw busy();
        }
      };
      flight.outstanding++;
      pending=(async()=>{
        await flight.ready;
        check(flight.waiters.size>0,'SOURCE_BUSY');
        if(!flight.started){check(monotonicNow()<flight.deadline,'SOURCE_BUSY');flight.started=true;}
        sourceAllowed(id);
        requirePromotionReader();
        const atDispatch=fresh(id,minimumTimestamp);
        if(!native&&atDispatch&&(!includeUsdc||atDispatch.includeUsdc))return atDispatch.value;
        let nativeAt,value;
        if(includeUsdc&&typeof hub.withUsdcPrices==='function'&&(native||atDispatch)){
          const observation=native?await native:atDispatch.value;
          check(flight.waiters.size>0,'SOURCE_BUSY');
          requirePromotionReader();
          nativeAt=native?(recent.get(id)?.at??now()):atDispatch.at;
          value=await hub.withUsdcPrices(observation);
        }else value=await hub.quote(id,{includeUsdc});
        check(hub.quoteValid?.(value,id)!==false,'QUOTE_UNAVAILABLE');
        recent.set(id,{at:nativeAt??now(),value,includeUsdc});
        while(recent.size>80)recent.delete(recent.keys().next().value);
        return value;
      })().finally(()=>{
        if(unusedPromotion&&flight.full===pending)flight.full=null;
        finish(flight);
      });
      if(includeUsdc)flight.full=pending;else flight.native=pending;
    }
    const result=reader(flight,pending,signal);
    if(created&&flight.state==='queued'){
      queue.push(flight);counters.maxQueued=Math.max(counters.maxQueued,Math.max(0,queue.length-Math.max(0,2-active)));
      flight.timer=schedule(()=>{counters.expired++;removeQueued(flight,busy());pump();},2000);
      pump();
    }
    return result;
  };
  quote.metrics=()=>({...counters,active,queued:queue.length,waiters,flights:flights.size});
  quote.close=async()=>{
    closed=true;
    const pending=[...flights.values()].flatMap(flight=>[flight.native,flight.full]).filter(Boolean);
    for(const flight of [...queue])removeQueued(flight,busy());
    await Promise.allSettled(pending);
  };
  return quote;
}
export async function createServer({financialEnabled=false,port=4437,dataPath,dist=resolve(ROOT,'frontend/dist-stocks-global'),hub=new MarketHub(),now=Date.now,autoPoll=true,authenticate,accountsPath,accountAuthority,accountDiagnostics=false,accountWorkerOptions={},ownerOnlyMode=false,tradeOwnerSubject=undefined,tradePrincipals=undefined}={}){
  // Separate from visibility/principal admission; no environment truthiness or
  // legacy canTrade metadata can activate matching. Explicit isolated tests opt in.
  check(typeof financialEnabled==='boolean','AUTH_CONFIG_INVALID');
  check(process.env.NODE_ENV !== 'production' ||
    (isReleaseAuthority(accountAuthority) && !accountsPath && !dataPath && !authenticate),
  'STOCKS_RELEASE_PG_AUTHORITY_REQUIRED');
  const twoTraderMode=tradePrincipals!==undefined;
  const mayTrade=twoTraderMode?twoTraderPolicy(tradePrincipals):null;
  if(twoTraderMode)ownerOnlyMode=true;
  check(!accountAuthority || !accountsPath && !dataPath && twoTraderMode, 'AUTH_CONFIG_INVALID');
  authenticate??=accountAuthority?.authenticate;
  check(Boolean(authenticate)===Boolean(accountsPath||accountAuthority),'AUTH_CONFIG_INVALID');
  check(!ownerOnlyMode || ((accountsPath||accountAuthority) && (twoTraderMode || typeof tradeOwnerSubject === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(tradeOwnerSubject))),'AUTH_CONFIG_INVALID');
  check(accountsPath||accountAuthority||dataPath,'LOCAL_LEDGER_PATH_REQUIRED');
  const accounts=accountAuthority??(accountsPath?await openAccountWorker(accountsPath,{...accountWorkerOptions,now,diagnostics:accountDiagnostics}):null);
  const legacy=accounts||!financialEnabled?null:await openStore(dataPath,{now});
  const contexts=new Map(),contextFlights=new Map(),refreshTasks=new Set(),backgroundFlights=new WeakMap(),historyWire=new WeakMap();
  Object.assign(hub.metrics,{accountQuoteCommits:0,accountQuoteObservations:0,accountQuoteMs:0,historySerializations:0,historySerializeMs:0});
  let address,closing=false,cursor=0,catalogueTask=null,lastCatalogue=0;
  const context=(store,id)=>({store,id,selected:'BYBIT:AAPLXUSDT',lease:0,demandEpoch:0,demandSince:0,demandView:null,demandAbort:new AbortController(),accessed:now(),errors:{},readiness:{},observed:new Set(),observedQuotes:new Map(),ownerMayTrade:financialEnabled&&!ownerOnlyMode,token:randomBytes(32).toString('hex')});
  if(legacy)contexts.set('legacy',context({read:()=>legacy.read(),execute:(command,input)=>command==='interests'?Promise.resolve(executeAccountCommand(legacy.read(),command,input,now())):legacy.transact((s,t)=>executeAccountCommand(s,command,input,t))},'legacy'));
  else if(!accounts)contexts.set('legacy',context(null,'legacy'));
  const sourceAllowed=id=>{check(instrument(id),'INVALID_PAIR');check(instrument(id).provider!=='moex','MOEX_UNVERIFIED');};
  const blockedCatalogue=list=>list.map(i=>i.provider==='moex'?{...i,online:false,display:null,sourceError:'MOEX_UNVERIFIED'}:i);
  let catalogue=blockedCatalogue(CATALOG.map(i=>({...i,exists:null,online:false})));
  const accountView=ctx=>({id:ctx.id,mode:ctx.ownerMayTrade?'isolated-paper':'viewer',quoteView:'volatile',canTrade:ctx.ownerMayTrade===true,...(twoTraderMode?{fundingMode:'existing-only'}:{})});
  const readinessView=ctx=>{
    const at=now(),readiness={};
    if(ownerOnlyMode&&ctx.ownerMayTrade&&ctx.lease!==0&&at-ctx.lease<12000){
      for(const[id,entry]of Object.entries(ctx.readiness)){
        if(id!==ctx.selected||entry.epoch!==ctx.demandEpoch||ctx.errors[id]!=='QUOTE_STALE')continue;
        const hint=preDemandReadiness(entry.quote,at,ctx.demandSince);
        if(hint)readiness[id]=hint;
      }
    }
    return Object.keys(readiness).length?{readiness}:{};
  };
  const status=async(ctx,committed,signal)=>{const snapshot=committed??(!financialEnabled||accounts&&ownerOnlyMode&&!ctx.ownerMayTrade?marketOnlyState(now()):await(accounts?ctx.store.execute('readView',undefined,{signal}):ctx.store.read()));hub.setStockOrders?.(ctx.id,snapshot.orders??[]);const invalid={};if(hub.quoteValid){snapshot.quotes={...snapshot.quotes};for(const[id,q]of Object.entries(snapshot.quotes))if(!hub.quoteValid(q,id)){delete snapshot.quotes[id];invalid[id]='QUOTE_UNAVAILABLE';}}return{...snapshot,...(accounts?{account:accountView(ctx)}:{}),catalogue,errors:{...ctx.errors,...invalid},...readinessView(ctx),metrics:{...hub.metrics,rssBytes:process.memoryUsage.rss(),cpu:process.cpuUsage(),polling:now()-ctx.lease<12000}};};
  const loadCatalogue=()=>catalogueTask??=hub.catalogue().then(list=>{catalogue=blockedCatalogue(list);lastCatalogue=now();}).finally(()=>{catalogueTask=null;});
  const getContext=async(req,signal)=>{
    if(!accounts)return contexts.get('legacy');
    const principal=await authenticate(req,{signal});
    check(!signal.aborted,'AUTH_UNAVAILABLE');
    const id=accountId(principal);
    if(!contexts.has(id)){
      // Bound active sessions; durable ledgers and pending orders are never evicted.
      for(const[key,ctx]of contexts)if(now()-ctx.accessed>60000)contexts.delete(key);
      check(contexts.size+contextFlights.size<512,'ACCOUNT_CAPACITY');
      // Market access authenticates without registering a financial ledger.
      contexts.set(id,context(null,id));
    }
    const ctx=contexts.get(id);ctx.accessed=now();ctx.principal=principal;
    // Every request rechecks the trusted identity. Client-provided roles never authorize trade.
    ctx.ownerMayTrade = financialEnabled && (twoTraderMode?mayTrade(principal):!ownerOnlyMode || principal.subject === tradeOwnerSubject);
    return ctx;
  };
  const requireAccount=async ctx=>{
    if(!accounts||ctx.store)return;
    check(ctx.ownerMayTrade,'AUTH_REQUIRED');
    if(!contextFlights.has(ctx.id)){
      const pending=accounts.forPrincipal(ctx.principal,{existingOnly:twoTraderMode}).then(store=>{ctx.store=store;}).finally(()=>contextFlights.delete(ctx.id));
      contextFlights.set(ctx.id,pending);
    }
    await contextFlights.get(ctx.id);
  };
  const quote=createQuoteReader({hub,now,sourceAllowed});
  // The local SQLite worker cannot see a revocation in its own transaction, so
  // it re-runs the request's authorization at its pre-COMMIT fence. The
  // PostgreSQL authority already re-reads the session row inside its transaction.
  const commitFence=authorize=>authorize&&accounts&&!accountAuthority?{fence:authorize}:{};
  const demand=(ctx,id,view)=>{
    view??='legacy-http';check(typeof view==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(view),'INVALID_REQUEST');
    if(ctx.demandView!==view||ctx.selected!==id||now()-ctx.lease>=12000||ctx.lease===0){ctx.demandAbort.abort();ctx.demandAbort=new AbortController();ctx.demandEpoch++;ctx.demandSince=now();ctx.readiness={};ctx.observed.clear();ctx.observedQuotes.clear();}
    ctx.selected=id;ctx.lease=now();ctx.demandView=view;hub.setStockDemand?.(ctx.id,id);
  };
  const release=ctx=>{hub.releaseStockDemand?.(ctx.id);ctx.demandAbort.abort();ctx.demandEpoch++;ctx.lease=0;ctx.readiness={};ctx.observed.clear();};
  // Wallet marks are response-only: never feed the order matcher.
  async function portfolio(ctx,signal){
    const viewer=!financialEnabled||accounts&&ownerOnlyMode&&!ctx.ownerMayTrade;
    const view=viewer?{schema:2,revision:0,serverTime:now(),positions:{},quotes:{}}:accounts?await ctx.store.execute('portfolioView',undefined,{signal}):null;check(view,'AUTH_REQUIRED');
    const errors={};
    const ids=[...new Set(Object.values(view.positions).map(p=>p.instrumentId))];
    let next=0;
    // Two shared quote flights at most; the request budget bounds long portfolios.
    const read=async()=>{while(next<ids.length){const id=ids[next++];try{
      check(!signal.aborted,'SOURCE_BUSY');sourceAllowed(id);
      let abort;
      const readQuote=()=>quote(id,{includeUsdc:false,signal});
      try{view.quotes[id]=await Promise.race([hub.withPortfolioDemand?hub.withPortfolioDemand(id,readQuote,{signal}):readQuote(),new Promise((_,reject)=>{
        abort=()=>reject(new SimError('SOURCE_BUSY'));
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      })]);}finally{if(abort)signal.removeEventListener('abort',abort);}
    }catch(e){delete view.quotes[id];errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';}}};
    await Promise.all([read(),read()]);
    const projected=snapshot({wallets:{USDT:{cash:'0',reserved:'0'},USDC:{cash:'0',reserved:'0'}},positions:view.positions,quotes:view.quotes,orders:[]},now());
    return {...view,serverTime:projected.serverTime,positions:projected.positions,quotes:projected.quotes,account:accountView(ctx),catalogue,errors};
  }
  async function refreshContext(ctx,id=ctx.selected,background=false,signal,authorize){
    if(closing)return;
    const epoch=ctx.demandEpoch;
    let observedQuote,generationSignal;
    if(ownerOnlyMode)signal=AbortSignal.any([ctx.demandAbort.signal,...(signal?[signal]:[])]);
    try{const q=await quote(id,{signal,...(accountAuthority&&ownerOnlyMode?{minimumTimestamp:ctx.demandSince}:{})});observedQuote=q;if(authorize)await authorize();check(hub.quoteValid?.(q,id)!==false,'QUOTE_UNAVAILABLE');if(ownerOnlyMode){if(signal?.aborted||epoch!==ctx.demandEpoch||ctx.selected!==id||!ctx.ownerMayTrade||now()-ctx.lease>=12000)return;check(q.timestamp>=ctx.demandSince,'QUOTE_STALE');}generationSignal=background?undefined:hub.observationSignal?.(q,id);const observationSignal=generationSignal?AbortSignal.any([generationSignal,...(signal?[signal]:[])]):signal;const started=performance.now();const committed=await ctx.store.execute(accounts?(background?'observeBackground':'observe'):'quote',q,{...(ownerOnlyMode||generationSignal?{signal:observationSignal}:{}),...commitFence(authorize)});if(committed.observation?.durable===false)hub.metrics.accountQuoteObservations++;else hub.metrics.accountQuoteCommits++;hub.metrics.accountQuoteMs+=performance.now()-started;if(ownerOnlyMode&&(signal?.aborted||epoch!==ctx.demandEpoch||ctx.selected!==id||ctx.lease===0||now()-ctx.lease>=12000))return;check(hub.quoteValid?.(q,id)!==false,'QUOTE_UNAVAILABLE');ctx.observed.add(id);ctx.observedQuotes.set(id,q);delete ctx.errors[id];delete ctx.readiness[id];return committed.snapshot;}
    catch(e){if(signal?.aborted||ownerOnlyMode&&epoch!==ctx.demandEpoch)return;if(e.code?.startsWith('AUTH_'))throw e;if(generationSignal?.aborted){ctx.observed.delete(id);ctx.observedQuotes.delete(id);ctx.errors[id]='QUOTE_UNAVAILABLE';delete ctx.readiness[id];return;}ctx.observed.delete(id);ctx.observedQuotes.delete(id);ctx.errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';delete ctx.readiness[id];if(ownerOnlyMode&&e.code==='QUOTE_STALE'&&preDemandReadiness(observedQuote,now(),ctx.demandSince))ctx.readiness[id]={quote:observedQuote,epoch};if(e.code?.startsWith('ACCOUNT_'))throw e;if(authorize)await authorize();await ctx.store.execute(accounts?(background?'observeFailedBackground':'observeFailed'):'quoteFailed',{id},commitFence(authorize));}
  }
  const refreshInBackground=(ctx,id=ctx.selected)=>{
    let work=backgroundFlights.get(ctx);if(!work){work=new Map();backgroundFlights.set(ctx,work);}
    // Only background observations share in-flight work. Explicit refreshes and
    // financial commands retain their own ordered execution and acknowledgements.
    if(work.has(id)){hub.metrics.accountQuoteCoalesced=(hub.metrics.accountQuoteCoalesced||0)+1;return work.get(id);}
    const pending=refreshContext(ctx,id,true).catch(e=>{ctx.errors[id]=e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR';}).finally(()=>{work.delete(id);refreshTasks.delete(pending);});
    work.set(id,pending);refreshTasks.add(pending);return pending;
  };
  const send=(res,code,body,headers={})=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
  const handle=async(req,res)=>{let cleanupRequest;try{
    check(req.headers.host==='127.0.0.1:'+address.port,'HOST_FORBIDDEN');check(!req.headers.origin||req.headers.origin==='http://127.0.0.1:'+address.port,'ORIGIN_FORBIDDEN');check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'ORIGIN_FORBIDDEN');
    const u=new URL(req.url,'http://127.0.0.1:'+address.port);
    if(u.pathname.startsWith(API)){
      if(req.method==='GET'&&u.pathname===API+'health'){const ok=!accounts||accounts.metrics().workerAlive===1;send(res,ok?200:503,{ok,isolated:true,version:2,accounts:!!accounts});return;}
      // Authentication must observe disconnects before any route-specific work.
      // Do not use req.close: a fully received live request can emit it normally.
      const requestAbort=new AbortController(),onAborted=()=>requestAbort.abort(),onRequestClose=()=>{if(!res.writableFinished)onAborted();};
      req.once('aborted',onAborted);res.once('close',onRequestClose);
      cleanupRequest=()=>{req.off('aborted',onAborted);res.off('close',onRequestClose);};
      if(req.aborted||res.destroyed)onAborted();
      const ctx=await getContext(req,requestAbort.signal);if(res.destroyed)return;
      // Bind revalidation to this request's initial trusted identity, never a
      // mutable context or a second allowed identity returned for the same
      // credential. The request-start auth wait stays outside the serialized
      // financial queue; on the SQLite worker the pre-COMMIT fence (commitFence)
      // runs authorize() inside it, holding the queue and the writer lock for up
      // to 2.5 s. The PostgreSQL authority path has no such wait.
      const requestPrincipalId=ctx.id;
      const authorize=twoTraderMode?async()=>{
        const principal=await authenticate(req,{signal:requestAbort.signal});
        check(!requestAbort.signal.aborted,'AUTH_UNAVAILABLE');
        check(accountId(principal)===requestPrincipalId&&mayTrade(principal),'AUTH_REQUIRED');
      }:undefined;
      // The PostgreSQL authority re-checks the live session, block, binding, token expiry and
      // trade policy inside every command's own transaction, so a network re-identity just
      // before a command only repeats it. The local SQLite worker cannot, and keeps it.
      const beforeCommand=accountAuthority?undefined:authorize;
      check(![...u.searchParams.keys()].some(k=>!['id','interval','before'].includes(k)),'ACCOUNT_SELECTOR_FORBIDDEN');
      if(req.method==='GET'&&u.pathname===API+'state'){
        if(res.destroyed)return;
        if(ctx.ownerMayTrade)await requireAccount(ctx);
        if(res.destroyed)return;
        if(beforeCommand&&ctx.ownerMayTrade&&(!autoPoll||!u.searchParams.get('id')))await beforeCommand();
        const readAbort=new AbortController();let demandEpoch;const onClose=()=>{if(!res.writableFinished){readAbort.abort();if(ownerOnlyMode&&demandEpoch===ctx.demandEpoch)release(ctx);}};
        res.once('close',onClose);
        try{
          let observedView;const id=u.searchParams.get('id');if(id){check(instrument(id),'INVALID_PAIR');if(hub.setStockDemand&&!lastCatalogue)await loadCatalogue();hub.setStockDemand?.(ctx.id,id);const changed=id!==ctx.selected;if(ctx.ownerMayTrade){if(ownerOnlyMode){demand(ctx,id,req.headers['x-stocks-view']);demandEpoch=ctx.demandEpoch;}else{ctx.selected=id;ctx.lease=now();}}else{ctx.selected=id;ctx.demandView=req.headers['x-stocks-view']??'legacy-http';}if(instrument(id).provider==='moex')ctx.errors[id]='MOEX_UNVERIFIED';if(autoPoll&&ctx.ownerMayTrade){if(ownerOnlyMode)observedView=await refreshContext(ctx,id,false,readAbort.signal,beforeCommand);else if(changed)refreshInBackground(ctx);}}
          let view=await status(ctx,observedView,readAbort.signal);
          // Read-only users share market data, never the owner matcher or ledger.
          if(!ctx.ownerMayTrade&&id){
            try{const q=await quote(id,{signal:readAbort.signal});if(readAbort.signal.aborted)return;
              view=projectViewerQuote(view,id,q,now());delete view.errors[id];
            }catch(e){if(readAbort.signal.aborted)return;delete view.quotes[id];view.errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';}
          }
          if(!res.destroyed)send(res,200,{...view,token:ctx.token});return;
        }finally{res.off('close',onClose);}
      }
      if(req.method==='GET'&&u.pathname===API+'portfolio'){
        if(ctx.ownerMayTrade)await requireAccount(ctx);
        if(res.destroyed)return;
        const abort=new AbortController(),onClose=()=>{if(!res.writableFinished)abort.abort();};
        res.once('close',onClose);const timer=setTimeout(()=>abort.abort(),2500);
        try{const view=await portfolio(ctx,abort.signal);if(authorize&&ctx.ownerMayTrade)await authorize();if(!res.destroyed)send(res,200,view);}
        finally{clearTimeout(timer);res.off('close',onClose);}return;
      }
      if(req.method==='DELETE'&&u.pathname===API+'lease'){check(req.headers['x-stocks-token']===ctx.token,'TOKEN_REQUIRED');if(u.searchParams.get('id')===ctx.selected&&(req.headers['x-stocks-view']??'legacy-http')===ctx.demandView)release(ctx);send(res,200,{released:true});return;}
      if(req.method==='GET'&&u.pathname===API+'history'){
        sourceAllowed(u.searchParams.get('id'));
        const abort=new AbortController(),onClose=()=>{if(!res.writableFinished)abort.abort();};
        res.once('close',onClose);if(res.destroyed)abort.abort();
        try{
          const page=await hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before'),{signal:abort.signal});
          if(abort.signal.aborted||res.destroyed)return;
          let body=historyWire.get(page);if(!body){const started=performance.now();body=Buffer.from(JSON.stringify(page));historyWire.set(page,body);hub.metrics.historySerializations++;hub.metrics.historySerializeMs+=performance.now()-started;}
          res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
        }finally{res.off('close',onClose);}return;
      }
      if(req.method==='GET'&&u.pathname===API+'catalogue'){await loadCatalogue();send(res,200,{catalogue});return;}
      check(req.method==='POST','METHOD_NOT_ALLOWED');
      // Refuse every financial/observation command before body, CSRF token,
      // account binding or authority work; enforced even for both trusted traders.
      check(financialEnabled,'ACCOUNT_TRADING_DISABLED');
      if(accounts && ownerOnlyMode && [API+'orders',API+'cancel',API+'balances',API+'refresh'].includes(u.pathname)) check(ctx.ownerMayTrade === true,'AUTH_REQUIRED');
      if(twoTraderMode&&u.pathname===API+'balances')throw new SimError('BALANCE_EDIT_DISABLED');
      const supplied=req.headers['x-stocks-token'];check(typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(ctx.token)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(ctx.token)),'TOKEN_REQUIRED');check(req.headers['content-type']?.startsWith('application/json'),'JSON_REQUIRED');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=8192,'BODY_TOO_LARGE');chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SimError('INVALID_JSON');}
      check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_JSON');
      check(!['userId','accountId','owner','subject','issuer','account','user'].some(k=>k in input),'ACCOUNT_SELECTOR_FORBIDDEN');
      await requireAccount(ctx);
      if(beforeCommand)await beforeCommand();
      if(res.destroyed)return;
      let committed,result;if(u.pathname===API+'orders'){if(accounts && ownerOnlyMode)check(input.currency==='USDT','INVALID_ORDER');sourceAllowed(input.instrumentId);committed=await ctx.store.execute(accounts?'submitObserved':'submit',accounts?{order:input,sourceBlocked:hub.quoteValid?.(ctx.observedQuotes.get(input.instrumentId),input.instrumentId)===false||!ctx.observed.has(input.instrumentId)||!!ctx.errors[input.instrumentId]||(ownerOnlyMode&&(ctx.selected!==input.instrumentId||ctx.lease===0||now()-ctx.lease>=12000))}:input,commitFence(authorize));result=committed.result;}
      else if(u.pathname===API+'cancel'){committed=await ctx.store.execute('cancel',{id:input.id},commitFence(authorize));result=committed.result;}
      else if(u.pathname===API+'balances')committed=await ctx.store.execute('balances',input);
      else if(u.pathname===API+'refresh'){
        sourceAllowed(input.id);if(ownerOnlyMode)demand(ctx,input.id,req.headers['x-stocks-view']);else{ctx.selected=input.id;ctx.lease=now();}
        const epoch=ctx.demandEpoch,abort=new AbortController(),onClose=()=>{if(!res.writableFinished){abort.abort();if(ownerOnlyMode&&epoch===ctx.demandEpoch)release(ctx);}};
        res.once('close',onClose);
        try{committed={snapshot:await refreshContext(ctx,ctx.selected,false,abort.signal,beforeCommand)};if(res.destroyed)return;}
        finally{res.off('close',onClose);}
      }
      else throw new SimError('ROUTE_NOT_FOUND');send(res,200,{...await status(ctx,committed?.snapshot),result});return;
    }
    check(req.method==='GET'&&!/^\/(api|v1|v2|admin|__stocks_simulator)(\/|$)/.test(u.pathname),'ROUTE_NOT_FOUND');
    let relative;try{relative=decodeURIComponent(u.pathname);}catch{throw new SimError('ROUTE_NOT_FOUND');}let path=resolve(dist,'.'+relative);check(path.startsWith(dist+sep)||path===dist,'ROUTE_NOT_FOUND');if(!extname(path))path=resolve(dist,'index.html');check((await stat(path)).isFile(),'ROUTE_NOT_FOUND');res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(path));
  }catch(e){if(res.destroyed)return;if(!res.headersSent){
    // Advisory minimum wait for a manual read probe, never permission to replay
    // a trade. Unknown mutation outcomes deliberately have no retry hint.
    const retryAfterMs=e instanceof SimError?(e.code==='AUTH_RATE_LIMIT'?(Number.isInteger(e.retryAfterMs)?Math.max(1000,Math.min(60000,e.retryAfterMs)):60000):e.code==='RATE_LIMIT'?60000:['SOURCE_BUSY','ACCOUNT_BUSY'].includes(e.code)?3000:null):null;
    send(res,e.code==='ACCOUNT_TRADING_DISABLED'?403:e.code==='AUTH_RATE_LIMIT'?429:e.code==='AUTH_REQUIRED'?401:['AUTH_UNAVAILABLE','ACCOUNT_CAPACITY','SOURCE_BUSY','ACCOUNT_BUSY','ACCOUNT_UNAVAILABLE','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN'].includes(e.code)?503:e.code==='ENOENT'||e.code==='ROUTE_NOT_FOUND'?404:e instanceof SimError?422:500,{error:e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR',...(retryAfterMs===null?{}:{retryAfterMs})},retryAfterMs===null?{}:{'Retry-After':String(retryAfterMs/1000)});
  }else res.end();}finally{cleanupRequest?.();}};
  const server=http.createServer((req,res)=>accountAuthority?accountAuthority.runWithRequest(req,()=>handle(req,res)):handle(req,res));
  // Node 22 native fetch subtracts a 2000 ms keep-alive safety margin. Advertising
  // exactly 2 s makes every response non-reusable. Keep the normal 5 s HTTP idle
  // window; request deadlines, admission bounds and per-request auth stay intact.
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxConnections=128;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);}).catch(async e=>{await accounts?.close();await legacy?.close();throw e;});address=server.address();
  let tick=null;
  const timer=financialEnabled&&autoPoll&&!ownerOnlyMode?setInterval(()=>{
    if(tick||closing)return;const interested=[...contexts.values()].filter(ctx=>now()-ctx.lease<12000);if(!interested.length)return;
    if(now()-lastCatalogue>60000)void loadCatalogue().catch(()=>{});
    tick=(async()=>{
      const subscriptions=await Promise.all(interested.map(async ctx=>({ctx,ids:new Set(await ctx.store.execute('interests',{selected:ctx.selected}))})));
      const ids=[...new Set(subscriptions.flatMap(s=>[...s.ids]))].filter(id=>instrument(id)?.provider!=='moex');
      if(!ids.length)return;const id=ids[cursor++%ids.length];await Promise.all(subscriptions.filter(s=>s.ids.has(id)).map(s=>refreshInBackground(s.ctx,id)));
    })().catch(e=>{for(const ctx of interested)ctx.errors[ctx.selected]=e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR';}).finally(()=>{tick=null;});
    return tick;
  },3000):null;
  return{server,store:legacy,port:address.port,accountMetrics:()=>accounts?.metrics()??null,quoteMetrics:()=>quote.metrics(),refresh:async id=>{check(legacy,'AUTH_REQUIRED');await refreshContext(contexts.get('legacy'),id);},async close(){closing=true;hub.close?.();const quoteClosed=quote.close();if(timer)clearInterval(timer);server.closeIdleConnections();await new Promise(ok=>server.close(ok));await tick;await quoteClosed;await Promise.allSettled([...refreshTasks,...contextFlights.values(),catalogueTask].filter(Boolean));await accounts?.close();await legacy?.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  check(process.env.NODE_ENV!=='production','STOCKS_RELEASE_ENTRYPOINT_REQUIRED');
  const accountsPath=process.env.STOCKS_ACCOUNTS_DATA;
  const authority=process.env.STOCKS_TEST_CASH_AUTHORITY_URL?createAuthorityAdapter({endpoint:process.env.STOCKS_TEST_CASH_AUTHORITY_URL,issuer:process.env.STOCKS_IDENTITY_ISSUER,gatewayKey:process.env.STOCKS_TEST_CASH_GATEWAY_KEY}):undefined;
  check(accountsPath||authority||process.env.STOCKS_GLOBAL_DATA?.endsWith('.json'),'LOCAL_LEDGER_PATH_REQUIRED');
  check(accountsPath||authority||process.env.STOCKS_LEGACY_SINGLE_OWNER_REVIEW==='true','AUTH_CONFIG_INVALID');
  const authenticate=accountsPath?identityResolver({endpoint:process.env.STOCKS_IDENTITY_ENDPOINT,issuer:process.env.STOCKS_IDENTITY_ISSUER}):undefined;
  const app=await createServer({financialEnabled:process.env.STOCKS_ORDER_EXECUTION_ENABLED==='true',port:Number(process.env.STOCKS_GLOBAL_PORT||4437),hub:createStocksRuntimeMarket({enabled:process.env.STOCKS_BINANCE_WS_ENABLED ?? 'false',authorityMode:Boolean(authority)}),dataPath:process.env.STOCKS_GLOBAL_DATA?resolve(process.env.STOCKS_GLOBAL_DATA):undefined,accountsPath:accountsPath?resolve(accountsPath):undefined,accountAuthority:authority,authenticate,tradePrincipals:accountsPath||authority?configuredTraders(process.env.STOCKS_TRADE_PRINCIPALS):undefined,dist:process.env.STOCKS_GLOBAL_DIST?resolve(process.env.STOCKS_GLOBAL_DIST):undefined});
  console.log('Stocks local preview http://127.0.0.1:'+app.port+'/stocks/BYBIT%3AAAPLXUSDT');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

