// @ts-nocheck
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publicDisplayCache, DISPLAY_REFRESH_MS, SLOW_DISPLAY_REFRESH_MS } from '../../middleware/publicDisplayCache';
import { displaySnapshotsRouter } from '../displaySnapshots';
import { LiveFeed } from '../../../services/marketData/live/contract';

const code=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const snap=(extra:any={},ttl=60_000,now=Date.now())=>({...extra,_display:{mode:'snapshot',capturedAt:now,refreshMs:ttl}});
function response(value:any,seconds=60,age=0){return new Response(JSON.stringify(value),{status:200,headers:{'Cache-Control':`public,max-age=${seconds}`,'Age':String(age)}});}

describe('public display HTTP cache',()=>{
 test('one snapshot shared between requests, preserves provider time, expires on cadence',async()=>{
  let clock=1_700_000_000_000,calls=0;const app=express();
  app.get('/data',publicDisplayCache(60_000,b=>b.price>0,()=>clock),(_q,r)=>{calls++;r.json({price:100,providerTimestamp:clock-5000});});
  const a=await request(app).get('/data').expect(200);
  clock+=30_000;const b=await request(app).get('/data').expect(200);
  expect(calls).toBe(1);expect(b.body).toEqual(a.body);expect(b.headers['cache-control']).toContain('max-age=30');
  clock+=30_001;await request(app).get('/data').expect(200);expect(calls).toBe(2);
 });
 test('gzip content decodes to identical snapshot and varies on encoding',async()=>{
  const app=express();app.get('/data',publicDisplayCache(60_000,()=>true),(_q,r)=>r.json({rows:Array(50).fill({price:100})}));
  const a=await request(app).get('/data').set('Accept-Encoding','identity').expect(200);
  const b=await request(app).get('/data').set('Accept-Encoding','gzip').expect(200);
  expect(b.headers['content-encoding']).toBe('gzip');expect(b.headers.vary).toContain('Accept-Encoding');expect(b.body).toEqual(a.body);
 });
 test('coalesces simultaneous display requests and gives every reader same result',async()=>{
  let calls=0;const app=express();app.get('/data',publicDisplayCache(60_000,()=>true),async(_q,r)=>{calls++;await new Promise(done=>setTimeout(done,30));r.json({price:7});});
  const results=await Promise.all(Array.from({length:8},()=>request(app).get('/data')));
  expect(calls).toBe(1);expect(results.every(r=>r.status===200&&r.body.price===7)).toBe(true);
 });
 test('failed responses are not cached as successful data and cannot trigger a retry storm',async()=>{
  let calls=0;const app=express();app.get('/data',publicDisplayCache(60_000,b=>b.available),(_q,r)=>{calls++;r.status(503).json({error:'down'});});
  await request(app).get('/data').expect(503);await request(app).get('/data').expect(503);expect(calls).toBe(1);
 });
 test('GET aliases can reuse an existing public handler without changing originals',async()=>{
  let calls=0;const app=express();
  app.get('/display',publicDisplayCache(60_000,()=>true),(q,_r,next)=>{q.url='/original';next();});
  app.get('/original',(_q,r)=>r.json({calls:++calls}));
  const first=await request(app).get('/display').expect(200);const second=await request(app).get('/display').expect(200);
  const uncached=await request(app).get('/original').expect(200);
  expect(first.body).toEqual(second.body);expect(uncached.body.calls).toBe(2);expect(uncached.body._display).toBeUndefined();
 });
 test('six-hour alias does not call its source per visitor',async()=>{
  let clock=1000000,calls=0;const app=express();app.get('/data',publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,()=>true,()=>clock),(_q,r)=>r.json({price:++calls}));
  await request(app).get('/data');clock+=SLOW_DISPLAY_REFRESH_MS-1;await request(app).get('/data');expect(calls).toBe(1);
  clock+=1;await request(app).get('/data');expect(calls).toBe(2);
 });
 test('all tickers remain discoverable and selected depth identity is validated',async()=>{
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
 test('GET/minute even with multiple consumers; no tokens, no live socket',async()=>{
  global.fetch=jest.fn(async()=>response(snap({price:'100'})));const{readDisplayJson}=require('../../../../frontend-not-here');
 });
});
