import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openStore } from './store.mjs';
import { openAccounts, accountId } from './accounts.mjs';
import { identityResolver } from './identity.mjs';
import { MarketHub } from './market.mjs';
import { CATALOG, instrument } from './catalog.mjs';
import { check, SimError, submit, cancel, setBalances, applyQuote, active } from './engine.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url))),API='/__stocks_global/';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
export async function createServer({port=4437,dataPath,dist=resolve(ROOT,'frontend/dist-stocks-global'),hub=new MarketHub(),now=Date.now,autoPoll=true,authenticate,accountsPath}={}){
  check(Boolean(authenticate)===Boolean(accountsPath),'AUTH_CONFIG_INVALID');
  check(accountsPath||dataPath,'LOCAL_LEDGER_PATH_REQUIRED');
  const accounts=accountsPath?openAccounts(accountsPath,{now}):null;
  const legacy=accounts?null:await openStore(dataPath,{now});
  const contexts=new Map(),flights=new Map(),recent=new Map();
  let address,closing=false,cursor=0,catalogueTask=null,lastCatalogue=0;
  const context=(store,id)=>({store,id,selected:'BYBIT:AAPLXUSDT',lease:0,accessed:now(),errors:{},token:randomBytes(32).toString('hex')});
  if(legacy)contexts.set('legacy',context(legacy,'legacy'));
  const sourceAllowed=id=>{check(instrument(id),'INVALID_PAIR');check(instrument(id).provider!=='moex','MOEX_UNVERIFIED');};
  const blockedCatalogue=list=>list.map(i=>i.provider==='moex'?{...i,online:false,display:null,sourceError:'MOEX_UNVERIFIED'}:i);
  let catalogue=blockedCatalogue(CATALOG.map(i=>({...i,exists:null,online:false})));
  const status=ctx=>({...ctx.store.read(),...(accounts?{account:{id:ctx.id,mode:'isolated-paper'}}:{}),catalogue,errors:{...ctx.errors},metrics:{...hub.metrics,rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(),polling:now()-ctx.lease<12000}});
  const loadCatalogue=()=>catalogueTask??=hub.catalogue().then(list=>{catalogue=blockedCatalogue(list);lastCatalogue=now();}).finally(()=>{catalogueTask=null;});
  const getContext=async req=>{
    if(!accounts)return contexts.get('legacy');
    const principal=await authenticate(req),id=accountId(principal);
    if(!contexts.has(id)){
      // Bound active sessions; durable ledgers and pending orders are never evicted.
      for(const[key,ctx]of contexts)if(now()-ctx.accessed>60000)contexts.delete(key);
      check(contexts.size<512,'ACCOUNT_CAPACITY');
      contexts.set(id,context(accounts.forPrincipal(principal),id));
    }
    const ctx=contexts.get(id);ctx.accessed=now();return ctx;
  };
  const quote=id=>{
    sourceAllowed(id);
    const cached=recent.get(id);if(cached&&now()-cached.at<2000)return Promise.resolve(cached.value);
    if(flights.has(id))return flights.get(id);
    check(flights.size<2,'SOURCE_BUSY');
    const pending=hub.quote(id).then(value=>{recent.set(id,{at:now(),value});while(recent.size>80)recent.delete(recent.keys().next().value);return value;}).finally(()=>flights.delete(id));
    flights.set(id,pending);return pending;
  };
  async function refreshContext(ctx,id=ctx.selected){
    if(closing)return;
    try{const q=await quote(id);await ctx.store.transact((s,t)=>applyQuote(s,q,t));delete ctx.errors[id];}
    catch(e){ctx.errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';await ctx.store.transact(s=>{if(s.quotes[id])s.quotes[id].failed=true;}).catch(()=>{});}
  }
  const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const server=http.createServer(async(req,res)=>{try{
    check(req.headers.host==='127.0.0.1:'+address.port,'HOST_FORBIDDEN');check(!req.headers.origin||req.headers.origin==='http://127.0.0.1:'+address.port,'ORIGIN_FORBIDDEN');check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'ORIGIN_FORBIDDEN');
    const u=new URL(req.url,'http://127.0.0.1:'+address.port);
    if(u.pathname.startsWith(API)){
      if(req.method==='GET'&&u.pathname===API+'health'){send(res,200,{ok:true,isolated:true,version:2,accounts:!!accounts});return;}
      const ctx=await getContext(req);
      check(![...u.searchParams.keys()].some(k=>!['id','interval','before'].includes(k)),'ACCOUNT_SELECTOR_FORBIDDEN');
      if(req.method==='GET'&&u.pathname===API+'state'){
        const id=u.searchParams.get('id');if(id){check(instrument(id),'INVALID_PAIR');const changed=id!==ctx.selected;ctx.selected=id;ctx.lease=now();if(instrument(id).provider==='moex')ctx.errors[id]='MOEX_UNVERIFIED';if(autoPoll&&changed)void refreshContext(ctx);}
        send(res,200,{...status(ctx),token:ctx.token});return;
      }
      if(req.method==='GET'&&u.pathname===API+'history'){sourceAllowed(u.searchParams.get('id'));send(res,200,await hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before')));return;}
      if(req.method==='GET'&&u.pathname===API+'catalogue'){await loadCatalogue();send(res,200,{catalogue});return;}
      check(req.method==='POST','METHOD_NOT_ALLOWED');const supplied=req.headers['x-stocks-token'];check(typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(ctx.token)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(ctx.token)),'TOKEN_REQUIRED');check(req.headers['content-type']?.startsWith('application/json'),'JSON_REQUIRED');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=8192,'BODY_TOO_LARGE');chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SimError('INVALID_JSON');}
      check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_JSON');
      check(!['userId','accountId','owner','subject','issuer','account','user'].some(k=>k in input),'ACCOUNT_SELECTOR_FORBIDDEN');
      let result;if(u.pathname===API+'orders'){sourceAllowed(input.instrumentId);result=(await ctx.store.transact((s,t)=>submit(s,input,t))).result;}
      else if(u.pathname===API+'cancel')result=(await ctx.store.transact((s,t)=>cancel(s,input.id,t))).result;
      else if(u.pathname===API+'balances')await ctx.store.transact((s,t)=>setBalances(s,input,t));
      else if(u.pathname===API+'refresh'){sourceAllowed(input.id);ctx.selected=input.id;ctx.lease=now();await refreshContext(ctx);}
      else throw new SimError('ROUTE_NOT_FOUND');send(res,200,{...status(ctx),result});return;
    }
    check(req.method==='GET'&&!/^\/(api|v1|v2|admin|__stocks_simulator)(\/|$)/.test(u.pathname),'ROUTE_NOT_FOUND');
    let relative;try{relative=decodeURIComponent(u.pathname);}catch{throw new SimError('ROUTE_NOT_FOUND');}let path=resolve(dist,'.'+relative);check(path.startsWith(dist+sep)||path===dist,'ROUTE_NOT_FOUND');if(!extname(path))path=resolve(dist,'index.html');check((await stat(path)).isFile(),'ROUTE_NOT_FOUND');res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(path));
  }catch(e){if(!res.headersSent)send(res,e.code==='AUTH_REQUIRED'?401:e.code==='AUTH_UNAVAILABLE'||e.code==='ACCOUNT_CAPACITY'?503:e.code==='ENOENT'||e.code==='ROUTE_NOT_FOUND'?404:e instanceof SimError?422:500,{error:e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR'});else res.end();}});
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.maxConnections=128;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);}).catch(async e=>{accounts?.close();await legacy?.close();throw e;});address=server.address();
  let tick=null;
  const timer=autoPoll?setInterval(()=>{
    if(tick||closing)return;const interested=[...contexts.values()].filter(ctx=>now()-ctx.lease<12000);if(!interested.length)return;
    if(now()-lastCatalogue>60000)void loadCatalogue().catch(()=>{});
    const ids=[...new Set(interested.flatMap(ctx=>{const s=ctx.store.read();return[ctx.selected,...s.orders.filter(active).map(o=>o.instrumentId),...Object.values(s.positions).filter(p=>Number(p.quantity)>0).map(p=>p.instrumentId)];}))].filter(id=>instrument(id)?.provider!=='moex');
    if(!ids.length)return;const id=ids[cursor++%ids.length];tick=Promise.all(interested.map(ctx=>refreshContext(ctx,id))).finally(()=>{tick=null;});
  },3000):null;
  if(autoPoll)void loadCatalogue().catch(()=>{});
  return{server,store:legacy,port:address.port,refresh:async id=>{check(legacy,'AUTH_REQUIRED');await refreshContext(contexts.get('legacy'),id);},async close(){closing=true;if(timer)clearInterval(timer);server.closeIdleConnections();await new Promise(ok=>server.close(ok));await tick;await Promise.allSettled([...flights.values(),catalogueTask].filter(Boolean));accounts?.close();await legacy?.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const accountsPath=process.env.STOCKS_ACCOUNTS_DATA;check(accountsPath||process.env.STOCKS_GLOBAL_DATA?.endsWith('.json'),'LOCAL_LEDGER_PATH_REQUIRED');
  check(accountsPath||process.env.STOCKS_LEGACY_SINGLE_OWNER_REVIEW==='true','AUTH_CONFIG_INVALID');
  const authenticate=accountsPath?identityResolver({endpoint:process.env.STOCKS_IDENTITY_ENDPOINT,issuer:process.env.STOCKS_IDENTITY_ISSUER}):undefined;
  const app=await createServer({port:Number(process.env.STOCKS_GLOBAL_PORT||4437),dataPath:process.env.STOCKS_GLOBAL_DATA?resolve(process.env.STOCKS_GLOBAL_DATA):undefined,accountsPath:accountsPath?resolve(accountsPath):undefined,authenticate,dist:process.env.STOCKS_GLOBAL_DIST?resolve(process.env.STOCKS_GLOBAL_DIST):undefined});
  console.log('Stocks local preview http://127.0.0.1:'+app.port+'/stocks/BYBIT%3AAAPLXUSDT');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

