import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openStore } from './store.mjs';
import { MarketHub } from './market.mjs';
import { CATALOG, instrument } from './catalog.mjs';
import { check, SimError, submit, cancel, setBalances, applyQuote, active } from './engine.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url))),API='/__stocks_global/';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
export async function createServer({port=4437,dataPath,dist=resolve(ROOT,'frontend/dist-stocks-global'),hub=new MarketHub(),now=Date.now,autoPoll=true}={}){
  check(dataPath,'LOCAL_LEDGER_PATH_REQUIRED');const store=await openStore(dataPath,{now});let address,selected='BYBIT:AAPLXUSDT',lease=0,refreshing=false,lastStart=0,cursor=0,closing=false;
  let catalogue=CATALOG.map(i=>({...i,exists:null,online:false}));const errors={},token=randomBytes(32).toString('hex');
  const status=()=>({...store.read(),catalogue,errors:{...errors},metrics:{...hub.metrics,rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(),polling:now()-lease<12000}});
  let catalogueTask=null,lastCatalogue=0;
  const loadCatalogue=()=>catalogueTask??=(hub.catalogue().then(list=>{catalogue=list;lastCatalogue=now();}).finally(()=>{catalogueTask=null;}));
  async function refresh(id=selected){if(refreshing||closing||now()-lastStart<2000)return;refreshing=true;lastStart=now();try{const q=await hub.quote(id);await store.transact((s,t)=>applyQuote(s,q,t));delete errors[id];}catch(e){errors[id]=e instanceof SimError?e.code:'SOURCE_UNAVAILABLE';await store.transact(s=>{if(s.quotes[id])s.quotes[id].failed=true;}).catch(()=>{});}finally{refreshing=false;}}
  const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const server=http.createServer(async(req,res)=>{try{
    check(req.headers.host===`127.0.0.1:${address.port}`,'HOST_FORBIDDEN');check(!req.headers.origin||req.headers.origin===`http://127.0.0.1:${address.port}`,'ORIGIN_FORBIDDEN');check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'ORIGIN_FORBIDDEN');
    const u=new URL(req.url,`http://127.0.0.1:${address.port}`);
    if(u.pathname.startsWith(API)){
      if(req.method==='GET'&&u.pathname===API+'health'){send(res,200,{ok:true,isolated:true,version:2});return;}
      if(req.method==='GET'&&u.pathname===API+'state'){const id=u.searchParams.get('id');if(id){check(instrument(id),'INVALID_PAIR');const changed=id!==selected;selected=id;lease=now();if(autoPoll&&changed)void refresh();}send(res,200,{...status(),token});return;}
      if(req.method==='GET'&&u.pathname===API+'history'){send(res,200,await hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before')));return;}
      if(req.method==='GET'&&u.pathname===API+'catalogue'){await loadCatalogue();send(res,200,{catalogue});return;}
      check(req.method==='POST','METHOD_NOT_ALLOWED');const supplied=req.headers['x-stocks-token'];check(typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(token)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(token)),'TOKEN_REQUIRED');check(req.headers['content-type']?.startsWith('application/json'),'JSON_REQUIRED');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=8192,'BODY_TOO_LARGE');chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SimError('INVALID_JSON');}
      let result;if(u.pathname===API+'orders')result=(await store.transact((s,t)=>submit(s,input,t))).result;
      else if(u.pathname===API+'cancel')result=(await store.transact((s,t)=>cancel(s,input.id,t))).result;
      else if(u.pathname===API+'balances')await store.transact((s,t)=>setBalances(s,input,t));
      else if(u.pathname===API+'refresh'){check(instrument(input.id),'INVALID_PAIR');selected=input.id;lease=now();await refresh();}
      else throw new SimError('ROUTE_NOT_FOUND');send(res,200,{...status(),result});return;
    }
    check(req.method==='GET'&&!/^\/(api|v1|v2|admin|__stocks_simulator)(\/|$)/.test(u.pathname),'ROUTE_NOT_FOUND');
    let relative;try{relative=decodeURIComponent(u.pathname);}catch{throw new SimError('ROUTE_NOT_FOUND');}let path=resolve(dist,'.'+relative);check(path.startsWith(dist+sep)||path===dist,'ROUTE_NOT_FOUND');if(!extname(path))path=resolve(dist,'index.html');check((await stat(path)).isFile(),'ROUTE_NOT_FOUND');res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(path));
  }catch(e){if(!res.headersSent)send(res,e.code==='ENOENT'||e.code==='ROUTE_NOT_FOUND'?404:e instanceof SimError?422:500,{error:e instanceof SimError?e.code:'LOCAL_SERVICE_ERROR'});else res.end();}});
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);}).catch(async e=>{await store.close();throw e;});address=server.address();
  const timer=autoPoll?setInterval(()=>{if(now()-lease>12000)return;if(now()-lastCatalogue>60000)void loadCatalogue();const s=store.read();const ids=[...new Set([selected,...s.orders.filter(active).map(o=>o.instrumentId),...Object.values(s.positions).filter(p=>Number(p.quantity)>0).map(p=>p.instrumentId)])];void refresh(ids[cursor++%ids.length]);},3000):null;
  if(autoPoll)void loadCatalogue();
  return {server,store,port:address.port,refresh,async close(){closing=true;if(timer)clearInterval(timer);await new Promise(ok=>server.close(ok));while(refreshing||catalogueTask)await new Promise(ok=>setTimeout(ok,20));await store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  check(process.env.STOCKS_GLOBAL_DATA?.endsWith('.json'),'LOCAL_LEDGER_PATH_REQUIRED');const app=await createServer({port:Number(process.env.STOCKS_GLOBAL_PORT||4437),dataPath:resolve(process.env.STOCKS_GLOBAL_DATA)});console.log(`Stocks US/RU local preview http://127.0.0.1:${app.port}/stocks/BYBIT%3AAAPLXUSDT`);let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
