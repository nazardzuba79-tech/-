import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from './market.mjs';
import { CATALOG } from './catalog.mjs';
const A='BYBIT:AAPLXUSDT', B='BINANCE:AAPLBUSDT', now=1800000000000;
const row=(time=now-900000,close='10.5')=>[String(time),'10','11','9',close,'100'];
const fixture=(url,rows)=>url.includes('bybit')?{retCode:0,result:{symbol:new URL(url).searchParams.get('symbol'),list:rows}}:rows;

test('100 simultaneous readers share one provider read, normalization and immutable page; quotes use separate cache',async()=>{
  let calls=0;const hub=new MarketHub({now:()=>now,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(fixture(url,Array.from({length:300},(_,n)=>row(now-n*900000)))));}});
  const pages=await Promise.all(Array.from({length:100},()=>hub.history(A,'15m')));
  assert.equal(calls,1);assert.equal(hub.metrics.historyParses,1);assert.equal(hub.metrics.historyCoalesced,99);
  assert.equal(new Set(pages).size,1);assert.equal(new Set(pages.map(p=>p.candles)).size,1);
  assert.throws(()=>{pages[0].candles[0].close=999;},TypeError);
  assert.equal(await hub.history(A,'15m'),pages[0]);assert.equal(hub.metrics.historyCacheHits,1);
  assert.equal(hub.cache.size,0,'no duplicate raw kline cache');
  await hub.request('https://api.binance.com/api/v3/time',1000);assert.equal(hub.cache.size,1);
});

test('history cache preserves exact provider/timeframe/cursor identities, TTL and corrected OHLC',async()=>{
  let time=now,calls=0,close='10.5';const hub=new MarketHub({now:()=>time,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(fixture(url,[row(now-1800000,close),row(now-900000,close),row(now,close)])));}});
  const latest=await hub.history(A,'15m'),older=await hub.history(A,'15m',now-900000);
  assert.deepEqual(older.candles.map(c=>c.time),[(now-1800000)/1000]);
  assert.notEqual(await hub.history(A,'1h'),latest);assert.notEqual(await hub.history(B,'15m'),latest);
  time+=9999;assert.equal(await hub.history(A,'15m'),latest);close='10.75';time++;
  const corrected=await hub.history(A,'15m');assert.equal(corrected.candles[0].close,10.75);assert.equal(latest.candles[0].close,10.5);
  assert.equal(await hub.history(A,'15m',now-900000),older);time=now+300001;
  assert.equal((await hub.history(A,'15m',now-900000)).candles[0].close,10.75);
  assert.equal(calls,6);
});

test('history queue is bounded at two upstream readers plus eight waiters, duplicates share admission, failures are retryable',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});let active=0,max=0;
  const hub=new MarketHub({now:()=>now,fetchImpl:async url=>{active++;max=Math.max(max,active);await wait;active--;return new Response(JSON.stringify(fixture(url,[row(now-20000)])));}});
  const requests=Array.from({length:10},(_,n)=>hub.history(A,'15m',now-n-1));
  const duplicate=hub.history(A,'15m',now-1);
  await assert.rejects(hub.history(A,'15m',now-999),/SOURCE_BUSY/);
  assert.equal(hub.historyActive,2);assert.equal(hub.historyQueue.length,8);release();
  await Promise.all([...requests,duplicate]);assert.equal(max,2);assert.equal(hub.historyActive,0);assert.equal(hub.historyFlights.size,0);
  await hub.history(A,'15m',now-999);assert.equal(hub.metrics.historyParses,11);
  const broken=new MarketHub({now:()=>now,fetchImpl:async()=>new Response('broken')});
  await assert.rejects(broken.history(A),/SOURCE_UNAVAILABLE/);await assert.rejects(broken.history(A),/SOURCE_UNAVAILABLE/);
  assert.equal(broken.historyFlights.size,0);assert.equal(broken.historyCache.size,0);
});

test('normalized history retains bounded pages and bytes',async()=>{
  const hub=new MarketHub({now:()=>now,fetchImpl:async url=>new Response(JSON.stringify(fixture(url,Array.from({length:1000},(_,n)=>row(now-n*900000)))))});
  for(let n=0;n<90;n++)await hub.history(A,'15m',now-n-1);
  assert.ok(hub.historyCache.size<=80);assert.ok(hub.metrics.historyCacheBytes<=8*1048576);
});

test('expired recent pages are removed before live historical pages face byte-pressure eviction',async()=>{
  let time=now,calls=0;
  const hub=new MarketHub({now:()=>time,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(fixture(url,Array.from({length:1000},(_,n)=>row(now-(n+1)*900000)))));}});
  const historical=await hub.history(A,'15m',now-1);
  const opened=CATALOG.filter(i=>i.provider!=='moex').slice(0,20).flatMap(i=>['15m','1h'].map(interval=>[i.id,interval]));
  for(const [id,interval] of opened.slice(0,31))await hub.history(id,interval);
  assert.equal(hub.historyCache.size,32);assert.equal(hub.metrics.historyCacheEvictions,0);
  time+=10000;
  await hub.history(B,'15m',now-2);
  assert.equal(hub.historyCache.size,2);assert.equal(hub.metrics.historyCacheExpired,31);
  assert.equal(hub.metrics.historyCacheEvictions,0);
  assert.equal(await hub.history(A,'15m',now-1),historical,'unexpired historical OHLC and page identity survive');
  assert.equal(calls,33);assert.equal(hub.metrics.historyCacheBytes,2*(1000*256+1024));
});

test('unexpired byte-pressure victims remain least-recently-used and sparse pages retain an entry bound',async()=>{
  const large=new MarketHub({now:()=>now,fetchImpl:async url=>new Response(JSON.stringify(fixture(url,Array.from({length:1000},(_,n)=>row(now-(n+1)*900000)))))});
  const oldest=await large.history(A,'15m',now-1);
  for(let n=2;n<=32;n++)await large.history(A,'15m',now-n);
  assert.equal(await large.history(A,'15m',now-1),oldest);
  await large.history(A,'15m',now-33);
  assert.equal(large.historyCache.size,32);assert.equal(large.metrics.historyCacheEvictions,1);
  assert.equal(large.metrics.historyCacheExpired,0);assert.ok(large.metrics.historyCacheBytes<=8*1048576);
  assert.ok(large.historyCache.has(JSON.stringify([A,'15m',now-1])));
  assert.ok(!large.historyCache.has(JSON.stringify([A,'15m',now-2])));
  const sparse=new MarketHub({now:()=>now,fetchImpl:async url=>new Response(JSON.stringify(fixture(url,[])))});
  for(let n=0;n<140;n++)await sparse.history(n%2?A:B,'15m',now-n-1);
  assert.equal(sparse.historyCache.size,128);assert.equal(sparse.metrics.historyCacheBytes,128*1024);
  assert.equal(sparse.metrics.historyCacheEvictions,12);assert.equal(sparse.metrics.historyCacheExpired,0);
});

test('TTL-boundary concurrent refresh still fetches and normalizes once without extending history freshness',async()=>{
  let time=now,calls=0,close='10.5';
  const hub=new MarketHub({now:()=>time,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(fixture(url,[row(now-900000,close)])));}});
  const original=await hub.history(A),historical=await hub.history(A,'15m',now-1);
  time+=10000;close='10.75';
  const refreshed=await Promise.all(Array.from({length:100},()=>hub.history(A)));
  assert.equal(calls,3);assert.equal(hub.metrics.historyParses,3);assert.equal(hub.metrics.historyCoalesced,99);
  assert.equal(new Set(refreshed).size,1);assert.equal(refreshed[0].candles[0].close,10.75);
  assert.equal(original.candles[0].close,10.5);assert.equal(await hub.history(A,'15m',now-1),historical);
  assert.equal(hub.metrics.historyCacheExpired,1);
  time=now+299999;assert.equal(await hub.history(A,'15m',now-1),historical);
  time++;const ended=await Promise.all(Array.from({length:100},()=>hub.history(A,'15m',now-1)));
  assert.equal(calls,4);assert.equal(new Set(ended).size,1);assert.notEqual(ended[0],historical);
  assert.equal(ended[0].candles[0].close,10.75);assert.equal(hub.metrics.historyCoalesced,198);
  assert.equal(hub.metrics.historyCacheExpired,3);assert.equal(hub.metrics.historyCacheEvictions,0);
});

test('exact 20-reader mixed fixture reuses all 40 older-page revisits but keeps the unchanged Binance rate-budget failure visible',async()=>{
  const base=Date.parse('2026-10-10T12:00:00Z');let time=base,maxPages=0,maxBytes=0;
  const ids=CATALOG.filter(i=>i.provider!=='moex').slice(0,20),calls={bybit:0,binance:0},errors={};
  assert.deepEqual(Object.fromEntries(['bybit','binance'].map(provider=>[provider,ids.filter(i=>i.provider===provider).length])),{bybit:7,binance:13});
  const periods={'15':900000,'60':3600000,D:86400000,'15m':900000,'1h':3600000,'1d':86400000};
  const hub=new MarketHub({now:()=>time,fetchImpl:async url=>{
    const u=new URL(url),provider=u.hostname==='api.bybit.com'?'bybit':'binance';
    assert.ok(['api.bybit.com','api.binance.com'].includes(u.hostname));assert.ok(['/v5/market/kline','/api/v3/klines'].includes(u.pathname));
    calls[provider]++;const step=periods[u.searchParams.get('interval')];assert.ok(step);
    const before=Number(u.searchParams.get('end')??u.searchParams.get('endTime')??time),end=Math.floor(before/step)*step;
    const rows=Array.from({length:300},(_,n)=>row(end-(300-n)*step));
    return new Response(JSON.stringify(fixture(url,provider==='bybit'?rows.reverse():rows)));
  }});
  // Serial virtual phases isolate cache and admission from HTTP/SQLite/CPU capacity.
  // This uses synthetic provider responses only; no external market call is made.
  for(let turn=0;turn<15;turn++){
    time=base+turn*2000;if(turn%3===2)continue;
    const interval=['15m','1h','1D'][Math.floor(turn/3)%3],before=turn%3===1?Math.floor(time/86400000)*86400000-86400000:null;
    for(let user=0;user<20;user++){
      try{await hub.history(ids[(user+Math.floor(turn/3))%ids.length].id,interval,before);}
      catch(error){const code=error.code||error.message;errors[code]=(errors[code]||0)+1;}
      maxPages=Math.max(maxPages,hub.historyCache.size);maxBytes=Math.max(maxBytes,hub.metrics.historyCacheBytes);
    }
  }
  assert.deepEqual(calls,{bybit:56,binance:100});assert.deepEqual(errors,{RATE_LIMIT:4});
  assert.equal(hub.metrics.historyCacheHits,40);assert.equal(hub.metrics.historyParses,156);
  assert.equal(hub.metrics.historyCacheExpired,60);assert.equal(hub.metrics.historyCacheEvictions,0);
  assert.equal(maxPages,100);assert.equal(maxBytes,100*(300*256+1024));assert.ok(maxBytes<=8*1048576);
  assert.equal(hub.cache.size,0,'no duplicate raw provider history bodies');
});
