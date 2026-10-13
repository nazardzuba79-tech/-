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
import { MarketHub } from './market.mjs';
import { CATALOG, instrument } from './catalog.mjs';
import { check, SimError, snapshot } from './engine.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url))),API='/__stocks_global/';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
export async function createServer({port=4437,dataPath,dist=resolve(ROOT,'frontend/dist-stocks-global'),hub=new MarketHub(),now=Date.now,autoPoll=true,authenticate,accountsPath,accountDiagnostics=false,accountWorkerOptions={},ownerOnlyMode=false,tradeOwnerSubject=undefined}={}){
  check(Boolean(authenticate)===Boolean(accountsPath),'AUTH_CONFIG_INVALID');
  check(!ownerOnlyMode || (accountsPath && typeof tradeOwnerSubject === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(tradeOwnerSubject)),'AUTH_CONFIG_INVALID');
  check(accountsPath||dataPath,'LOCAL_LEDGER_PATH_REQUIRED');
  const accounts=accountsPath?await openAccountWorker(accountsPath,{...accountWorkerOptions,now,diagnostics:accountDiagnostics}):null;
  const legacy=accounts?null:await openStore(dataPath,{now});
  const contexts=new Map(),contextFlights=new Map(),refreshTasks=new Set(),backgroundFlights=new WeakMap(),flights=new Map(),recent=new Map(),historyWire=new WeakMap();
  Object.assign(hub.metrics,{accountQuoteCommits:0,accountQuoteObservations:0,accountQuoteMs:0,historySerializations:0,historySerializeMs:0});
  let address,closing=false,cursor=0,catalogueTask=null,lastCatalogue=0;
  const context=(store,id)=>({store,id,selected:'BYBIT:AAPLXUSDT',lease:0,demandEpoch:0,demandSince:0,demandView:null,demandAbort:new AbortController(),accessed:now(),errors:{},observed:new Set(),ownerMayTrade:!ownerOnlyMode,token:randomBytes(32).toString('hex')});
  if(legacy)contexts.set('legacy',context({read:()=>legacy.read(),execute:(command,input)=>command==='interests'?Promise.resolve(executeAccountCommand(legacy.read(),command,input,now())):legacy.transact((s,t)=>executeAccountCommand(s,command,input,t))},'legacy'));
  const sourceAllowed=id=>{check(instrument(id),'INVALID_PAIR');check(instrument(id).provider!=='moex','MOEX_UNVERIFIED');};
  const blockedCatalogue=list=>list.map(i=>i.provider==='moex'?{...i,online:false,display:null,sourceError:'MOEX_UNVERIFIED'}:i);
  let catalogue=blockedCatalogue(CATALOG.map(i=>({...i,exists:null,online:false})));
  const status=async(ctx,committed,signal)=>({... (committed??await(accounts?ctx.store.execute('readView',undefined,{signal}):ctx.store.read())),...(accounts?{account:{id:ctx.id,mode:'isolated-paper',quoteView:'volatile',canTrade:ctx.ownerMayTrade===true}}:{}),catalogue,errors:{...ctx.errors},metrics:{...hub.metrics,rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(),polling:now()-ctx.lease<12000}});
  const loadCatalogue=()=>catalogueTask??=hub.catalogue().then(list=>{catalogue=blockedCatalogue(list);lastCatalogue=now();}).finally(()=>{catalogueTask=null;});
  const getContext=async req=>{
    if(!accounts)return contexts.get('legacy');
    const principal=await authenticate(req),id=accountId(principal);
    if(!contexts.has(id)&&!contextFlights.has(id)){
      // Bound active sessions; durable ledgers and pending orders are never evicted.
      for(const[key,ctx]of contexts)if(now()-ctx.accessed>60000)contexts.delete(key);
      check(contexts.size+contextFlights.size<512,'ACCOUNT_CAPACITY');
      // Publish a single initialization promise before awaiting disk. Concurrent
      // first requests for one principal must share the same CSRF context.
      const pending=accounts.forPrincipal(principal).then(store=>{const ctx=context(store,id);contexts.set(id,ctx);return ctx;}).finally(()=>contextFlights.delete(id));
      contextFlights.set(id,pending);
    }
    const ctx=contexts.get(id)??await contextFlights.get(id);ctx.accessed=now();
    // Every request rechecks the trusted identity. Client-provided roles never authorize trade.
    ctx.ownerMayTrade = !ownerOnlyMode || principal.subject === tradeOwnerSubject;
    return ctx;
  };
  const quote=(id,{includeUsdc=true}={})=>{
    sourceAllowed(id);
    // A full observation may serve Wallet, but a USDT-only response must never
    // satisfy a state/engine read without independently checked USDC conversion.
    const cached=recent.get(id),fresh=cached&&now()-cached.at<2000;
    if(fresh&&(!includeUsdc||cached.includeUsdc))return Promise.resolve(cached.value);
    let flight=flights.get(id);
    if(flight){if(!includeUsdc)return flight.native??flight.full;if(flight.full)return flight.full;}
    else{check(flights.size<2,'SOURCE_BUSY');flight={native:null,full:null};}
    const native=includeUsdc?(flight.native??(fresh?Promise.resolve(cached.value):null)):null;
    let nativeAt;
    const fetched=native&&typeof hub.withUsdcPrices==='function'?native.then(value=>{nativeAt=recent.get(id)?.at??now();return hub.withUsdcPrices(value);}):hub.quote(id,{includeUsdc});
    const pending=fetched.then(value=>{recent.set(id,{at:nativeAt??now(),value,includeUsdc});while(recent.size>80)recent.delete(recent.keys().next().value);return value;}).finally(()=>{
      // Native and FX continuations share one instrument admission. An upgrade
      // keeps that slot until the full observation settles, including failure.
      if(flights.get(id)===flight&&(!flight.full||flight.full===pending))flights.delete(id);
    });
    if(includeUsdc)flight.full=pending;else flight.native=pending;
    flights.set(id,flight);return pending;
  };
  const demand=(ctx,id,view)=>{
    view??='legacy-http';check(typeof view==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(view),'INVALID_REQUEST');
    if(ctx.demandView!==view||ctx.selected!==id||now()-ctx.lease>=12000||ctx.lease===0){ctx.demandAbort.abort();ctx.demandAbort=new AbortController();ctx.demandEpoch++;ctx.demandSince=now();ctx.observed.clear();}
    ctx.selected=id;ctx.lease=now();ctx.demandView=view;
  };
  const release=ctx=>{ctx.demandAbort.abort();ctx.demandEpoch++;ctx.lease=0;ctx.observed.clear();};
  // Wallet marks are response-only: never feed the order matcher.
  async function portfolio(ctx,signal){
    const view=accounts?await ctx.store.execute('portfolioView',undefined,{signal}):null;check(view,'AUTH_REQUIRED');
    const errors={};
    const ids=[...new Set(Object.values(view.positions).map(p=>p.instrumentId))];
    let next=0;
    // Two shared quote flights at most; the request budget bounds long portfolios.
    const read=async()=>{while(next<ids.length){const id=ids[next++];try{
      check(!signal.aborted,'SOURCE_BUSY');sourceAllowed(id);
      let abort;
      try{view.quotes[id]=await Promise.race([quote(id,{includeUsdc:false}),new Promise((_,reject)=>{
        abort=()=>reject(new SimError('SOURCE_BUSY'));
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      })]);}finally{if(abort)signal.removeEventListener('abort',abort);}
    }catch(e){delete view.quotes[id];errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';}}};
    await Promise.all([read(),read()]);
    const projected=snapshot({wallets:{USDT:{cash:'0',reserved:'0'},USDC:{cash:'0',reserved:'0'}},positions:view.positions,quotes:view.quotes,orders:[]},now());
    return {...view,serverTime:projected.serverTime,positions:projected.positions,quotes:projected.quotes,account:{id:ctx.id,mode:'isolated-paper',canTrade:ctx.ownerMayTrade===true},catalogue,errors};
  }
  async function refreshContext(ctx,id=ctx.selected,background=false,signal){
    if(closing)return;
    const epoch=ctx.demandEpoch;
    if(ownerOnlyMode)signal=AbortSignal.any([ctx.demandAbort.signal,...(signal?[signal]:[])]);
    try{const q=await quote(id);if(ownerOnlyMode){if(signal?.aborted||epoch!==ctx.demandEpoch||ctx.selected!==id||!ctx.ownerMayTrade||now()-ctx.lease>=12000)return;check(q.timestamp>=ctx.demandSince,'QUOTE_STALE');}const started=performance.now();const committed=await ctx.store.execute(accounts?(background?'observeBackground':'observe'):'quote',q,ownerOnlyMode?{signal}:undefined);if(committed.observation?.durable===false)hub.metrics.accountQuoteObservations++;else hub.metrics.accountQuoteCommits++;hub.metrics.accountQuoteMs+=performance.now()-started;if(ownerOnlyMode&&(signal?.aborted||epoch!==ctx.demandEpoch||ctx.selected!==id||ctx.lease===0||now()-ctx.lease>=12000))return;ctx.observed.add(id);delete ctx.errors[id];return committed.snapshot;}
    catch(e){if(signal?.aborted||ownerOnlyMode&&epoch!==ctx.demandEpoch)return;ctx.observed.delete(id);ctx.errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';if(e.code?.startsWith('ACCOUNT_'))throw e;await ctx.store.execute(accounts?(background?'observeFailedBackground':'observeFailed'):'quoteFailed',{id});}
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
  const server=http.createServer(async(req,res)=>{try{
    check(req.headers.host==='127.0.0.1:'+address.port,'HOST_FORBIDDEN');check(!req.headers.origin||req.headers.origin==='http://127.0.0.1:'+address.port,'ORIGIN_FORBIDDEN');check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'ORIGIN_FORBIDDEN');
    const u=new URL(req.url,'http://127.0.0.1:'+address.port);
    if(u.pathname.startsWith(API)){
      if(req.method==='GET'&&u.pathname===API+'health'){const ok=!accounts||accounts.metrics().workerAlive===1;send(res,ok?200:503,{ok,isolated:true,version:2,accounts:!!accounts});return;}
      const ctx=await getContext(req);if(res.destroyed)return;
      check(![...u.searchParams.keys()].some(k=>!['id','interval','before'].includes(k)),'ACCOUNT_SELECTOR_FORBIDDEN');
      if(req.method==='GET'&&u.pathname===API+'state'){
        if(res.destroyed)return;
        const readAbort=new AbortController();let demandEpoch;const onClose=()=>{if(!res.writableFinished){readAbort.abort();if(ownerOnlyMode&&demandEpoch===ctx.demandEpoch)release(ctx);}};
        res.once('close',onClose);
        try{
          let observedView;const id=u.searchParams.get('id');if(id){check(instrument(id),'INVALID_PAIR');const changed=id!==ctx.selected;if(ctx.ownerMayTrade){if(ownerOnlyMode){demand(ctx,id,req.headers['x-stocks-view']);demandEpoch=ctx.demandEpoch;}else{ctx.selected=id;ctx.lease=now();}}else ctx.selected=id;if(instrument(id).provider==='moex')ctx.errors[id]='MOEX_UNVERIFIED';if(autoPoll&&ctx.ownerMayTrade){if(ownerOnlyMode)observedView=await refreshContext(ctx,id,false,readAbort.signal);else if(changed)refreshInBackground(ctx);}}
          let view=await status(ctx,observedView,readAbort.signal);
          // Read-only users share market data, never the owner matcher or ledger.
          if(ownerOnlyMode&&!ctx.ownerMayTrade&&id){
            try{const q=await quote(id);if(readAbort.signal.aborted)return;
              view=snapshot({...view,quotes:{...view.quotes,[id]:q}},now());delete view.errors[id];
            }catch(e){if(readAbort.signal.aborted)return;delete view.quotes[id];view.errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';}
          }
          if(!res.destroyed)send(res,200,{...view,token:ctx.token});return;
        }finally{res.off('close',onClose);}
      }
      if(req.method==='GET'&&u.pathname===API+'portfolio'){
        const abort=new AbortController(),onClose=()=>{if(!res.writableFinished)abort.abort();};
        res.once('close',onClose);const timer=setTimeout(()=>abort.abort(),2500);
        try{const view=await portfolio(ctx,abort.signal);if(!res.destroyed)send(res,200,view);}
        finally{clearTimeout(timer);res.off('close',onClose);}return;
      }
      if(req.method==='DELETE'&&u.pathname===API+'lease'){check(req.headers['x-stocks-token']===ctx.token,'TOKEN_REQUIRED');if(u.searchParams.get('id')===ctx.selected&&(req.headers['x-stocks-view']??'legacy-http')===ctx.demandView)release(ctx);send(res,200,{released:true});return;}
      if(req.method==='GET'&&u.pathname===API+'history'){sourceAllowed(u.searchParams.get('id'));const page=await hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before'));let body=historyWire.get(page);if(!body){const started=performance.now();body=Buffer.from(JSON.stringify(page));historyWire.set(page,body);hub.metrics.historySerializations++;hub.metrics.historySerializeMs+=performance.now()-started;}res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);return;}
      if(req.method==='GET'&&u.pathname===API+'catalogue'){await loadCatalogue();send(res,200,{catalogue});return;}
      check(req.method==='POST','METHOD_NOT_ALLOWED');
      if(accounts && ownerOnlyMode && [API+'orders',API+'cancel',API+'balances',API+'refresh'].includes(u.pathname)) check(ctx.ownerMayTrade === true,'AUTH_REQUIRED');
      const supplied=req.headers['x-stocks-token'];check(typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(ctx.token)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(ctx.token)),'TOKEN_REQUIRED');check(req.headers['content-type']?.startsWith('application/json'),'JSON_REQUIRED');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=8192,'BODY_TOO_LARGE');chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SimError('INVALID_JSON');}
      check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_JSON');
      check(!['userId','accountId','owner','subject','issuer','account','user'].some(k=>k in input),'ACCOUNT_SELECTOR_FORBIDDEN');
      let committed,result;if(u.pathname===API+'orders'){if(accounts && ownerOnlyMode)check(input.currency==='USDT','INVALID_ORDER');sourceAllowed(input.instrumentId);committed=await ctx.store.execute(accounts?'submitObserved':'submit',accounts?{order:input,sourceBlocked:!ctx.observed.has(input.instrumentId)||!!ctx.errors[input.instrumentId]||(ownerOnlyMode&&(ctx.selected!==input.instrumentId||ctx.lease===0||now()-ctx.lease>=12000))}:input);result=committed.result;}
      else if(u.pathname===API+'cancel'){committed=await ctx.store.execute('cancel',{id:input.id});result=committed.result;}
      else if(u.pathname===API+'balances')committed=await ctx.store.execute('balances',input);
      else if(u.pathname===API+'refresh'){
        sourceAllowed(input.id);if(ownerOnlyMode)demand(ctx,input.id,req.headers['x-stocks-view']);else{ctx.selected=input.id;ctx.lease=now();}
        const epoch=ctx.demandEpoch,abort=new AbortController(),onClose=()=>{if(!res.writableFinished){abort.abort();if(ownerOnlyMode&&epoch===ctx.demandEpoch)release(ctx);}};
        res.once('close',onClose);
        try{committed={snapshot:await refreshContext(ctx,ctx.selected,false,abort.signal)};if(res.destroyed)return;}
        finally{res.off('close',onClose);}
      }
      else throw new SimError('ROUTE_NOT_FOUND');send(res,200,{...await status(ctx,committed?.snapshot),result});return;
    }
    check(req.method==='GET'&&!/^\/(api|v1|v2|admin|__stocks_simulator)(\/|$)/.test(u.pathname),'ROUTE_NOT_FOUND');
    let relative;try{relative=decodeURIComponent(u.pathname);}catch{throw new SimError('ROUTE_NOT_FOUND');}let path=resolve(dist,'.'+relative);check(path.startsWith(dist+sep)||path===dist,'ROUTE_NOT_FOUND');if(!extname(path))path=resolve(dist,'index.html');check((await stat(path)).isFile(),'ROUTE_NOT_FOUND');res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(path));
  }catch(e){if(res.destroyed)return;if(!res.headersSent){
    // Advisory minimum wait for a manual read probe, never permission to replay
    // a trade. Unknown mutation outcomes deliberately have no retry hint.
    const retryAfterMs=e instanceof SimError?(e.code==='RATE_LIMIT'?60000:['SOURCE_BUSY','ACCOUNT_BUSY'].includes(e.code)?3000:null):null;
    send(res,e.code==='AUTH_REQUIRED'?401:['AUTH_UNAVAILABLE','ACCOUNT_CAPACITY','SOURCE_BUSY','ACCOUNT_BUSY','ACCOUNT_UNAVAILABLE','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN'].includes(e.code)?503:e.code==='ENOENT'||e.code==='ROUTE_NOT_FOUND'?404:e instanceof SimError?422:500,{error:e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR',...(retryAfterMs===null?{}:{retryAfterMs})},retryAfterMs===null?{}:{'Retry-After':String(retryAfterMs/1000)});
  }else res.end();}});
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.maxConnections=128;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);}).catch(async e=>{await accounts?.close();await legacy?.close();throw e;});address=server.address();
  let tick=null;
  const timer=autoPoll&&!ownerOnlyMode?setInterval(()=>{
    if(tick||closing)return;const interested=[...contexts.values()].filter(ctx=>now()-ctx.lease<12000);if(!interested.length)return;
    if(now()-lastCatalogue>60000)void loadCatalogue().catch(()=>{});
    tick=(async()=>{
      const subscriptions=await Promise.all(interested.map(async ctx=>({ctx,ids:new Set(await ctx.store.execute('interests',{selected:ctx.selected}))})));
      const ids=[...new Set(subscriptions.flatMap(s=>[...s.ids]))].filter(id=>instrument(id)?.provider!=='moex');
      if(!ids.length)return;const id=ids[cursor++%ids.length];await Promise.all(subscriptions.filter(s=>s.ids.has(id)).map(s=>refreshInBackground(s.ctx,id)));
    })().catch(e=>{for(const ctx of interested)ctx.errors[ctx.selected]=e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR';}).finally(()=>{tick=null;});
    return tick;
  },3000):null;
  return{server,store:legacy,port:address.port,accountMetrics:()=>accounts?.metrics()??null,refresh:async id=>{check(legacy,'AUTH_REQUIRED');await refreshContext(contexts.get('legacy'),id);},async close(){closing=true;if(timer)clearInterval(timer);server.closeIdleConnections();await new Promise(ok=>server.close(ok));await tick;await Promise.allSettled([...refreshTasks,...contextFlights.values(),...[...flights.values()].flatMap(flight=>[flight.native,flight.full]),catalogueTask].filter(Boolean));await accounts?.close();await legacy?.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const accountsPath=process.env.STOCKS_ACCOUNTS_DATA;check(accountsPath||process.env.STOCKS_GLOBAL_DATA?.endsWith('.json'),'LOCAL_LEDGER_PATH_REQUIRED');
  check(accountsPath||process.env.STOCKS_LEGACY_SINGLE_OWNER_REVIEW==='true','AUTH_CONFIG_INVALID');
  const authenticate=accountsPath?identityResolver({endpoint:process.env.STOCKS_IDENTITY_ENDPOINT,issuer:process.env.STOCKS_IDENTITY_ISSUER}):undefined;
  const app=await createServer({port:Number(process.env.STOCKS_GLOBAL_PORT||4437),dataPath:process.env.STOCKS_GLOBAL_DATA?resolve(process.env.STOCKS_GLOBAL_DATA):undefined,accountsPath:accountsPath?resolve(accountsPath):undefined,authenticate,ownerOnlyMode:Boolean(accountsPath),tradeOwnerSubject:accountsPath?(process.env.STOCKS_TRADE_OWNER_SUBJECT || null):undefined,dist:process.env.STOCKS_GLOBAL_DIST?resolve(process.env.STOCKS_GLOBAL_DIST):undefined});
  console.log('Stocks local preview http://127.0.0.1:'+app.port+'/stocks/BYBIT%3AAAPLXUSDT');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

