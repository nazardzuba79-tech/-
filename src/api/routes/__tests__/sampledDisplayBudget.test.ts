// @ts-nocheck
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publicDisplayCache, SLOW_DISPLAY_REFRESH_MS } from '../../middleware/publicDisplayCache';
import { displaySnapshotsRouter } from '../displaySnapshots';
import { LiveFeed } from '../../../services/marketData/live/contract';
const code=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const snap=(extra:any={},ttl=60_000,now=Date.now())=>({...extra,_display:{mode:'snapshot',capturedAt:now,refreshMs:ttl}});
function response(value:any,seconds=60,age=0){return new Response(JSON.stringify(value),{status:200,headers:{'Cache-Control':`public,max-age=${seconds}`,'Age':String(age)}});}
const browserModule=()=>require(resolve(process.cwd(),'frontend/src/lib/displaySnapshotCache.ts'));

describe('public display HTTP cache',()=>{
 test('shared snapshot preserves provider time and expires on cadence',async()=>{
  let clock=1_700_000_000_000,calls=0;const app=express();
  app.get('/data',publicDisplayCache(60_000,b=>b.price>0,()=>clock),(_q,r)=>{calls++;r.json({price:100,providerTimestamp:clock-5000});});
  const a=await request(app).get('/data').expect(200);clock+=30_000;
  const b=await request(app).get('/data').expect(200);expect(calls).toBe(1);expect(b.body).toEqual(a.body);expect(b.headers['cache-control']).toContain('max-age=30');
  clock+=30_001;await request(app).get('/data').expect(200);expect(calls).toBe(2);
 });
 test('gzip decodes to identical snapshot and varies on encoding',async()=>{
  const app=express();app.get('/data',publicDisplayCache(60_000,()=>true),(_q,r)=>r.json({rows:Array(50).fill({price:100})}));
  const a=await request(app).get('/data').set('Accept-Encoding','identity').expect(200);
  const b=await request(app).get('/data').set('Accept-Encoding','gzip').expect(200);
  expect(b.headers['content-encoding']).toBe('gzip');expect(b.headers.vary).toContain('Accept-Encoding');expect(b.body).toEqual(a.body);
 });
 test('coalesces simultaneous readers',async()=>{
  let calls=0;const app=express();app.get('/data',publicDisplayCache(60_000,()=>true),async(_q,r)=>{calls++;await new Promise(done=>setTimeout(done,30));r.json({price:7});});
  const results=await Promise.all(Array.from({length:8},()=>request(app).get('/data')));
  expect(calls).toBe(1);expect(results.every(r=>r.status===200&&r.body.price===7)).toBe(true);
 });
 test('failure is not cached as success and has retry backoff',async()=>{
  let calls=0;const app=express();app.get('/data',publicDisplayCache(60_000,b=>b.available),(_q,r)=>{calls++;r.status(503).json({error:'down'});});
  await request(app).get('/data').expect(503);await request(app).get('/data').expect(503);expect(calls).toBe(1);
 });
 test('public alias reuses handler without caching the original',async()=>{
  let calls=0;const app=express();app.get('/display',publicDisplayCache(60_000,()=>true),(q,_r,next)=>{q.url='/original';next();});
  app.get('/original',(_q,r)=>r.json({calls:++calls}));
  const first=await request(app).get('/display').expect(200);const second=await request(app).get('/display').expect(200);
  const uncached=await request(app).get('/original').expect(200);
  expect(first.body).toEqual(second.body);expect(uncached.body.calls).toBe(2);expect(uncached.body._display).toBeUndefined();
 });
 test('six-hour cache is shared between visitors',async()=>{
  let clock=1000000,calls=0;const app=express();app.get('/data',publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,()=>true,()=>clock),(_q,r)=>r.json({price:++calls}));
  await request(app).get('/data');clock+=SLOW_DISPLAY_REFRESH_MS-1;await request(app).get('/data');expect(calls).toBe(1);
  clock+=1;await request(app).get('/data');expect(calls).toBe(2);
 });
 test('all tickers remain available; unlisted or wrong-contract depth is refused',async()=>{
  const feed=new LiveFeed('fixture');feed.status='live';feed.publish('snapshot',Array.from({length:1450},(_,i)=>({id:String(i),lastPrice:i+1})) as any);
  const provider={getOrderBook:jest.fn().mockResolvedValue({fetchedAt:1000,stale:false,value:{symbol:'ETHUSDT',bids:[],asks:[],updateId:1,providerTime:1000}})};
  const universe={perpetualCandidates:()=>[{providerSymbol:'BTCUSDT'}],provider};const app=express();
  app.use(displaySnapshotsRouter(feed,{getOrderBookWithMeta:jest.fn()} as any,universe as any,{get:jest.fn()} as any));
  const all=await request(app).get('/market/display').expect(200);expect(all.body.rows).toHaveLength(1450);
  await request(app).get('/market/display/futures-book/NOTLISTEDUSDT').expect(404);expect(provider.getOrderBook).not.toHaveBeenCalled();
  await request(app).get('/market/display/futures-book/BTCUSDT').expect(503);
 });
});

describe('browser snapshot budget',()=>{
 let fetchBefore:any,documentBefore:any,storageBefore:any;
 beforeEach(()=>{
  jest.resetModules();jest.useFakeTimers();jest.setSystemTime(1_700_000_000_000);
  fetchBefore=global.fetch;documentBefore=global.document;storageBefore=global.localStorage;
  const doc=new EventTarget();Object.defineProperty(doc,'hidden',{value:false,writable:true});global.document=doc;
  const values=new Map();global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 });
 afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();global.fetch=fetchBefore;global.document=documentBefore;global.localStorage=storageBefore;});
 test('GET/minute despite multiple consumers, cloned answers, no auth headers',async()=>{
  global.fetch=jest.fn(async()=>response(snap({price:'100'})));const{readDisplayJson}=browserModule();const url='/api/v1/market/display';
  const [a,b]=await Promise.all([readDisplayJson(url,60_000),readDisplayJson(url,60_000)]);
  a.price='changed';expect(b.price).toBe('100');expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(59_999);await readDisplayJson(url,60_000);expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);await readDisplayJson(url,60_000);expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',headers:{Accept:'application/json'}});
 });
 test('does not cache private paths or malformed snapshot envelopes',async()=>{
  global.fetch=jest.fn(async()=>response({price:123}));const{readDisplayJson}=browserModule();
  await expect(readDisplayJson('/api/v1/private-trading/state',60_000)).rejects.toThrow('Not a public display route');expect(fetch).not.toHaveBeenCalled();
  await expect(readDisplayJson('/api/v1/market/display',60_000)).rejects.toThrow('Invalid display snapshot');
 });
 test('server cache age cannot extend a six-hour quote by another six hours',async()=>{
  const ttl=21_600_000,url='/api/v1/cfd/display/tickers';
  global.fetch=jest.fn(async()=>response(snap({tickers:[]},ttl),10,5));const{readDisplayJson}=browserModule();
  await readDisplayJson(url,ttl);await jest.advanceTimersByTimeAsync(4999);await readDisplayJson(url,ttl);expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);await readDisplayJson(url,ttl);expect(fetch).toHaveBeenCalledTimes(2);
 });
 test('persisted six-hour snapshot survives module reload without a new request',async()=>{
  const ttl=21_600_000,url='/api/v1/cfd/display/tickers';global.fetch=jest.fn(async()=>response(snap({tickers:[]},ttl),21600));
  await browserModule().readDisplayJson(url,ttl);expect(fetch).toHaveBeenCalledTimes(1);
  jest.resetModules();global.fetch=jest.fn(async()=>response(snap({tickers:[]},ttl),21600));
  await browserModule().readDisplayJson(url,ttl);expect(fetch).not.toHaveBeenCalled();
 });
 test('remaining cache lifetime survives remount rather than resetting a six-hour timer',async()=>{
  const ttl=21_600_000,url='/api/v1/cfd/display/candles/XAUUSD?interval=1h';
  global.fetch=jest.fn(async()=>response(snap({bars:[]},ttl),1800));const {readDisplayJson,displayRefreshDelay}=browserModule();
  await readDisplayJson(url,ttl);expect(displayRefreshDelay(url,ttl)).toBe(1_800_000);
  await jest.advanceTimersByTimeAsync(1_200_000);await readDisplayJson(url,ttl);
  expect(fetch).toHaveBeenCalledTimes(1);expect(displayRefreshDelay(url,ttl)).toBe(600_000);
 });
 test('one subscriber cancellation does not abort another subscriber',async()=>{
  let finish:any;global.fetch=jest.fn((_u,options)=>new Promise(resolve=>{finish=()=>resolve(response(snap({price:5})));}));
  const {readDisplayJson}=browserModule(),a=new AbortController(),b=new AbortController();
  const one=readDisplayJson('/api/v1/market/display',60000,a.signal).catch(e=>e.name);
  const two=readDisplayJson('/api/v1/market/display',60000,b.signal);a.abort();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);finish();expect(await one).toBe('AbortError');expect((await two).price).toBe(5);
 });
 test('a cancelled request does not poison an immediate remount',async()=>{
  global.fetch=jest.fn((_u,{signal})=>new Promise((resolve,reject)=>{if(fetch.mock.calls.length===1)signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));else resolve(response(snap({price:9})));}));
  const{readDisplayJson}=browserModule(),a=new AbortController();const old=readDisplayJson('/api/v1/market/display',60000,a.signal).catch(e=>e.name);a.abort();
  const next=await readDisplayJson('/api/v1/market/display',60000);expect(next.price).toBe(9);expect(await old).toBe('AbortError');expect(fetch).toHaveBeenCalledTimes(2);
 });
 test('sampled source makes 3 reads at 0/60/120 seconds, no SSE; close removes timers',async()=>{
  global.fetch=jest.fn(async()=>response(snap({version:1,type:'snapshot',rows:[]})));const{SampledMarketSource}=browserModule();
  const source=new SampledMarketSource('/api/v1/market/display'),seen=jest.fn();source.addEventListener('snapshot',seen);await flush();
  expect(fetch).toHaveBeenCalledTimes(1);await jest.advanceTimersByTimeAsync(120_010);expect(fetch).toHaveBeenCalledTimes(3);expect(seen).toHaveBeenCalledTimes(3);
  source.close();await jest.advanceTimersByTimeAsync(120_000);expect(fetch).toHaveBeenCalledTimes(3);expect(jest.getTimerCount()).toBe(0);
 });
 test('hidden page sends no display traffic and resumes from cache',async()=>{
  global.document.hidden=true;global.fetch=jest.fn(async()=>response(snap({rows:[]})));const{SampledMarketSource}=browserModule();
  const source=new SampledMarketSource('/api/v1/market/display');await flush();await jest.advanceTimersByTimeAsync(600_000);expect(fetch).not.toHaveBeenCalled();
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await jest.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(1);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await jest.advanceTimersByTimeAsync(600_000);expect(fetch).toHaveBeenCalledTimes(1);source.close();
 });
 test('hiding then immediately restoring an in-flight page does not wait another minute',async()=>{
  let calls=0;global.fetch=jest.fn((_url,{signal})=>{
    if(++calls===1)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    return Promise.resolve(response(snap({rows:[]})));
  });
  const {SampledMarketSource}=browserModule(),source=new SampledMarketSource('/api/v1/market/display'),seen=jest.fn();
  source.addEventListener('snapshot',seen);await flush();expect(fetch).toHaveBeenCalledTimes(1);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  await flush();await jest.advanceTimersByTimeAsync(1);await flush();
  expect(fetch).toHaveBeenCalledTimes(2);expect(seen).toHaveBeenCalledTimes(1);source.close();
 });
 test('depth parser rejects identity swaps, crossed books and malformed amounts',()=>{
  const{parseSampledBook}=require(resolve(process.cwd(),'frontend/src/lib/sampledDepth.ts'));
  const book={available:true,symbol:'BTCUSDT',providerTime:Date.now(),bids:[{price:'99.50',quantity:'1.00'}],asks:[{price:'100.00',quantity:'2.00'}]};
  const parsed=parseSampledBook(book,'BTCUSDT',true);expect(parsed.status).toBe('sampled');expect(parsed.bids).toEqual(book.bids);expect(parsed.asOf).toBe(book.providerTime);
  expect(()=>parseSampledBook(book,'ETHUSDT',true)).toThrow();expect(()=>parseSampledBook({...book,asks:book.bids},'BTCUSDT',true)).toThrow();
  expect(()=>parseSampledBook({...book,bids:[{price:'99',quantity:'Infinity'}]},'BTCUSDT',true)).toThrow();
 });
});

describe('sampled display invariants',()=>{
 test('homepage no longer attaches a real-time socket and still uses received six-hour snapshots',()=>{
  const hero=code('frontend/src/pages/home/useHeroStream.ts');expect(hero).not.toMatch(/startHeroStream|krakenSocket|WebSocket|EventSource/);
  expect(hero).toContain('return market');expect(code('frontend/src/pages/home/useHomeMarket.ts')).toContain('6 * 60 * 60 * 1000');
 });
 test('CFD chart uses the six-hour public cache, preserves candles, no direct racing endpoint',()=>{
  const c=code('frontend/src/components/CfdChart.tsx');expect(c).toContain('/cfd/display/candles/');expect(c).toContain('SLOW_DISPLAY_REFRESH_MS');
  expect(c).not.toContain('https://biquote.io');expect(c).toContain('normalizeBars');expect(c).toContain('SampledDataNote');
 });
 test('visual motion cannot invent prices, volume, fills or depth widths',()=>{
  const css=code('frontend/src/pages/trade-terminal/SampledDisplay.css');const frames=css.slice(css.indexOf('@keyframes'),css.indexOf('html[data-sampled-motion'));
  expect(frames).toContain('opacity');expect(frames).not.toMatch(/width|scale|height|content|counter/);
  expect(css).toContain('prefers-reduced-motion');expect(css).toContain('animation-play-state: paused');
 });
 test('sampled display never imports a financial writer',()=>{
  for(const path of ['src/api/middleware/publicDisplayCache.ts','src/api/routes/displaySnapshots.ts','frontend/src/lib/displaySnapshotCache.ts','frontend/src/lib/sampledDepth.ts'])
   expect(code(path)).not.toMatch(/from ['"].*(?:PositionService|native\/engine|prisma|cfdPaperStore|marginMath)/);
 });
});
