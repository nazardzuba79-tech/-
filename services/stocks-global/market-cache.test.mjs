import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from './market.mjs';
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
