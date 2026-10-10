import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Store, ByteCache, ReadGate, limits, validateManifest } from './core.mjs';

export function createStockServer({store,instruments,origin='',readGate=new ReadGate(),profile}){
  validateManifest(instruments);const allowed=new Map(instruments.map(i=>[i.instrumentId,i]));
  // Count encoded bytes plus page metadata against the same 16 MiB budget.
  const cache=new ByteCache(undefined,page=>page.body.length+128),gate=readGate;
  // Profiling is opt-in for offline fixtures: no runtime clocks by default.
  const measure=profile?((name,fn)=>profile.measure(name,fn)):((_name,fn)=>fn());
  const encoded=value=>measure('serialization',()=>({body:Buffer.from(JSON.stringify(value))}));
  const respond=(res,page)=>measure('httpWrite',()=>{res.setHeader('Content-Length',page.body.length);res.end(page.body);});
  const cached=key=>measure('cache',()=>cache.peek(key));
  const loadPage=(id,limit,before)=>{
    const page=store.encodedHistory(id,limit,before);
    const metadata=measure('candlePreparation',()=>({instrumentId:id,currency:allowed.get(id).currency,provider:allowed.get(id).provider,adjustmentMode:'unadjusted'}));
    return measure('serialization',()=>({body:Buffer.from(JSON.stringify(metadata).slice(0,-1)+',"candles":'+page.candles+',"next":'+(page.count===limit?page.first:'null')+'}'),latestTime:page.latest??-1}));
  };
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
    if(origin&&req.headers.origin===origin)res.setHeader('Access-Control-Allow-Origin',origin);
    try{
      if(req.method!=='GET'){res.writeHead(405);return res.end('{}');}
      const u=new URL(req.url,'http://localhost');if(req.url.length>1024)throw Error('Invalid request');
      if(u.pathname==='/health'){return res.end(JSON.stringify({status:'ok',module:'stocks',readOnly:true}));}
      if(u.pathname==='/stocks'&&!u.search){return respond(res,await cache.get('catalogue',()=>gate.run(()=>encoded({instruments:instruments.map(i=>({...i,latest:i.enabled&&i.dataRightsStatus==='confirmed'?store.history(i.instrumentId,1).at(-1)??null:null,sessionChange:null}))}))));}
      const id=decodeURIComponent(u.pathname.slice('/stocks/history/'.length));
      if(!u.pathname.startsWith('/stocks/history/')||!allowed.has(id)){res.writeHead(404);return res.end('{}');}
      if([...u.searchParams.keys()].some(k=>!['limit','before'].includes(k))||[...u.searchParams.keys()].length!==new Set(u.searchParams.keys()).size)throw Error('Invalid query');
      const limit=Number(u.searchParams.get('limit')??limits.CHART_DEFAULT_LIMIT),before=Number(u.searchParams.get('before')??Number.MAX_SAFE_INTEGER);
      if(!Number.isSafeInteger(limit)||limit<1||limit>limits.CHART_HARD_LIMIT||!Number.isSafeInteger(before)||before<0)throw Error('Invalid range');
      if(!allowed.get(id).enabled||allowed.get(id).dataRightsStatus!=='confirmed')return res.end('{"candles":[],"next":null}');
      const key=`${id}:${limit}:${before}`;
      // Hits/singleflight followers do not consume scarce database admission.
      // New keys still enter the bounded gate BEFORE growing the pending map.
      const hit=cached(key);
      let page;
      if(hit){profile?.count('cacheHits',1);page=await hit.value;}
      else{
        profile?.count('cacheMisses',1);
        const latestKey=`${id}:${limit}:${Number.MAX_SAFE_INTEGER}`;
        const latestHit=cached(latestKey);
        const latest=await (latestHit?latestHit.value:gate.run(()=>cache.get(latestKey,()=>loadPage(id,limit,Number.MAX_SAFE_INTEGER))));
        // Reuse only a proven equivalent range, never round a client timestamp
        // or assume exchange/session alignment. Historical pagination stays exact.
        page=before>latest.latestTime?latest:await gate.run(()=>cache.get(key,()=>loadPage(id,limit,before)));
      }
      res.setHeader('Cache-Control','public, max-age=60');respond(res,page);
    }catch(e){res.setHeader('Retry-After','15');res.writeHead(e.status??400);res.end('{"error":"unavailable"}');}
  });
  // Transport sockets are not database workers. 32 idle keep-alive sockets
  // previously caused TCP drops at 50/100 readers before ReadGate could run.
  // Keep a bounded transport while retaining 2 DB reads + 8 pending, CPU/RAM,
  // cache bytes, upstream concurrency, response size and every benchmark limit.
  server.maxConnections=128;server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.timeout=10000;
  server.stockCache=cache;
  server.on('timeout',socket=>socket.destroy());server.on('close',()=>gate.close());return server;
}
if(process.argv[1]&&new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1')===process.argv[1].replaceAll('\\','/')){
  if(process.env.STOCKS_ENABLED!=='true')throw Error('Stocks disabled');
  // Existing storage only: GET cannot create database/schema or start a collector.
  const store=new Store(process.env.STOCKS_DB??'/data/stocks.sqlite',{readonly:true});
  const instruments=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
  const server=createStockServer({store,instruments,origin:process.env.STOCKS_FRONTEND_ORIGIN??''});
  server.listen(Number(process.env.PORT??8091),'127.0.0.1');
  const stop=()=>{server.closeAllConnections();server.close(()=>{store.close();process.exit(0);});};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
