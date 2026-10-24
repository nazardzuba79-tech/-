import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { decodeFrame, subscriptions, FRAME_LIMIT } from './live-protocols.mjs';
import { decodeMexcPublic } from './mexc-public-protobuf.mjs';
import { LiveEquityFeed } from './live-feed.mjs';
import { LiveMarketHub } from './live-market.mjs';
import { confirmLiveInstrument, LIVE_REST_ADAPTERS } from './live-rest.mjs';
import { parseCandles, MarketHub } from './market.mjs';
import { instrument } from './catalog.mjs';
import { LIVE_PROVIDERS, UNSUPPORTED_LIVE_PRODUCTS } from './live-catalog.mjs';
import { createReleaseMarket } from './release-market.mjs';
const wire=JSON.parse(readFileSync(new URL('./fixtures/live-public-20261024/wire.json',import.meta.url)));
const metadata=JSON.parse(readFileSync(new URL('./fixtures/live-public-20261024/metadata.json',import.meta.url)));
const histories=JSON.parse(readFileSync(new URL('./fixtures/live-public-20261024/history.json',import.meta.url)));
const ids=['BINANCE:AAPLBUSDT','BYBIT:AAPLXUSDT','GATE:AAPLX_USDT','MEXC:AAPLXUSDT','OKX:XAAPL-USDT','KUCOIN:AAPLX-USDT','KRAKEN:AAPLxUSD','BINGX:AAPLX-USDT','BITGET:RAAPLUSDT'];

for(const venue of LIVE_PROVIDERS)test(`${venue}: authentic public wire data decodes; acknowledgements are not prices`,()=>{
  const frames=wire.filter(f=>f.venue===venue),events=frames.flatMap(f=>decodeFrame(venue,Buffer.from(f.base64,'base64'),f.binary));
  assert.ok(frames.length);assert.ok(events.some(e=>e.type==='quote'),venue);
  if(!['binance','bitget'].includes(venue))assert.ok(events.some(e=>e.type==='candle'),venue);
  for(const e of events.filter(e=>e.type!=='reply'))assert.ok(e.symbol&&e.timestamp>0);
});
for(const id of ids)test(`${id}: exact metadata and quote currency; wrong token rejected`,()=>{
  const i=instrument(id),j=metadata[i.provider];assert.equal(confirmLiveInstrument(j,i,1).online,true);
  assert.equal(confirmLiveInstrument(j,{...i,asset:i.asset+'WRONG'},1).exists,false);
  assert.equal(confirmLiveInstrument(j,{...i,currency:i.currency==='USD'?'USDT':'USD'},1).exists,false);
});
for(const venue of Object.keys(LIVE_REST_ADAPTERS))test(`${venue}: genuine REST OHLCV mapping, native base volume and ascending chronology`,()=>{
  const id=ids.find(id=>instrument(id).provider===venue),i=instrument(id),rows=LIVE_REST_ADAPTERS[venue].parseHistory(histories[venue],i,300),candles=parseCandles(rows,venue,1792856000000);
  assert.equal(candles.length,6);assert.ok(candles.every((c,n)=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0&&(!n||c.time>candles[n-1].time)));
  assert.equal(LIVE_REST_ADAPTERS[venue].hosts.some(h=>new URL(LIVE_REST_ADAPTERS[venue].historyUrl(i,'15m',300)).hostname===h),true);
  if(venue==='kraken'){assert.equal(i.currency,'USD');assert.equal(candles.at(-1).volume,Number(histories.kraken.result.AAPLxUSD.at(-1)[6]));}
});
test('MEXC binary public schema matches captured BBO and refuses truncation/private oneofs',()=>{
  const f=wire.find(f=>f.venue==='mexc'&&f.binary&&f.topic.includes('bookTicker')),b=Buffer.from(f.base64,'base64'),d=decodeMexcPublic(b);
  assert.equal(d.symbol,'AAPLXUSDT');assert.ok(Number(d.data.bid)>0&&Number(d.data.ask)>=Number(d.data.bid));
  assert.throws(()=>decodeMexcPublic(b.subarray(0,-1)),/PROTO/);assert.throws(()=>decodeMexcPublic(Buffer.from([0x0a,0x01,0x78])),/PROTO_PUBLIC_BODY/);
});
test('gzip and binary/frame/decompression bounds fail closed',()=>{
  assert.deepEqual(decodeFrame('bingx',gzipSync('Ping'),true),[{type:'reply',value:'Pong'}]);
  assert.throws(()=>decodeFrame('bingx',gzipSync('x'.repeat(FRAME_LIMIT+1)),true));
  assert.throws(()=>decodeFrame('binance',Buffer.alloc(FRAME_LIMIT+1)),/FRAME_TOO_LARGE/);
});
test('all subscriptions are public spot; no private/order topic or mislabelled derivatives',()=>{
  for(const id of ids){const i=instrument(id),s=JSON.stringify(subscriptions(i.provider,[i]));assert.doesNotMatch(s,/privateChannel":true|order\.|account\.|linear|perpetual|RFQ/);}
  assert.equal(instrument('KRAKEN:AAPLxUSD').currency,'USD');assert.equal(instrument('KRAKEN:AAPLxUSDT'),undefined);
  assert.equal(instrument('BITGET:RAAPLUSDT').productType,'unified-share-equivalent');assert.ok(UNSUPPORTED_LIVE_PRODUCTS.backpack);
});
const source=(generation=1)=>({venue:'binance',items:[instrument(ids[0])],intervals:new Set(['15m']),generation,role:'public'});
const bbo=(timestamp,extra={})=>({type:'quote',symbol:'AAPLBUSDT',timestamp,bid:'100.10',ask:'100.20',last:'100.15',volume:'20',...extra});
test('missing BBO, stale data, source future, wrong symbol, crossed book and ordering are rejected',()=>{
  let now=100000;const f=new LiveEquityFeed({now:()=>now});try{
    f.admit(source(),bbo(now,{bid:undefined,ask:undefined}));assert.throws(()=>f.read(ids[0]),/QUOTE_UNAVAILABLE/);
    f.admit(source(),bbo(now));assert.equal(f.read(ids[0]).ask,'100.20');
    assert.throws(()=>f.admit(source(),bbo(now,{symbol:'TSLABUSDT'})),/SYMBOL_MISMATCH/);
    assert.throws(()=>f.admit(source(),bbo(now,{bid:'101'})),/INVALID_BBO/);
    assert.throws(()=>f.admit(source(),bbo(now-1)),/OUT_OF_ORDER/);
    assert.throws(()=>f.admit(source(),bbo(now+2001)),/SOURCE_TIME_INVALID/);
    now+=5001;assert.throws(()=>f.read(ids[0]),/QUOTE_STALE/);assert.equal(f.valid(ids[0],1),false);
  }finally{f.close();}
});
test('older statistics cannot replace a newer trade or retimestamp the book',()=>{
  const f=new LiveEquityFeed({now:()=>100000});try{f.admit(source(),bbo(100000));f.admit(source(),{type:'quote',symbol:'AAPLBUSDT',timestamp:99000,stats:true,last:'90',volume:'21'});const q=f.read(ids[0]);assert.equal(q.last,'100.15');assert.equal(q.timestamp,100000);assert.equal(q.volume,'21');}finally{f.close();}
});
test('independent ticker stream cannot overwrite a newer BBO snapshot',()=>{
  const f=new LiveEquityFeed({now:()=>100000});try{f.admit(source(),bbo(99000));f.admit(source(),bbo(100000,{book:true,bid:'100.30',ask:'100.40',last:undefined}));f.admit(source(),bbo(99500));assert.equal(f.read(ids[0]).bid,'100.30');assert.equal(f.read(ids[0]).timestamp,100000);}finally{f.close();}
});
test('topic symbol binding rejects a frame even when its different symbol is also subscribed',()=>{
  assert.throws(()=>decodeFrame('bybit',JSON.stringify({topic:'tickers.AAPLXUSDT',ts:1,data:{symbol:'TSLAXUSDT'}})),/SYMBOL_MISMATCH/);
  assert.throws(()=>decodeFrame('okx',JSON.stringify({arg:{channel:'tickers',instId:'XAAPL-USDT'},data:[{instId:'XTSLA-USDT'}]})),/SYMBOL_MISMATCH/);
  assert.throws(()=>decodeFrame('bingx',JSON.stringify({dataType:'AAPLX-USDT@ticker',data:{s:'TSLAX-USDT'}})),/SYMBOL_MISMATCH/);
});
test('a MEXC symbol may not silently change from xStocks backing to another token',()=>{
  const j=structuredClone(metadata.mexc),i=instrument('MEXC:AAPLXUSDT');j.symbols.find(r=>r.symbol===i.sourceSymbol).contractAddress='different-token';assert.equal(confirmLiveInstrument(j,i,1).exists,false);
  assert.notEqual(instrument('MEXC:AAPLXUSDT').issuer,instrument('MEXC:AAPLONUSDT').issuer);
});
test('Bybit batches respect its 10-argument subscription request ceiling',()=>{
  const messages=subscriptions('bybit',Array.from({length:7},()=>instrument('BYBIT:AAPLXUSDT')),['1m','5m','15m']);assert.ok(messages.length>1);for(const m of messages)assert.ok(m.args.length<=10);
});
test('sequence reset invalidates observations immediately, before another frame',()=>{
  const f=new LiveEquityFeed({now:()=>100000});try{f.admit(source(),bbo(99999,{sequence:'10'}));assert.throws(()=>f.admit(source(),bbo(100000,{sequence:'9'})),/STREAM_RESET/);assert.equal(f.valid(ids[0],1),false);assert.equal(f.quotes.size,0);}finally{f.close();}
});
test('native Kraken USD never obtains a made-up USDT or RUB conversion',async()=>{
  const now=100000,id='KRAKEN:AAPLxUSD',h=new LiveMarketHub({liveVenues:['kraken'],now:()=>now,fetchImpl:()=>{throw Error('UNEXPECTED_NETWORK');}});
  try{h.catalogueAt=now;h.verified.set(id,{exists:true,online:true});h.feed.owners.set('test-reader',{id,until:now+12000});h.feed.quotes.set(id,{bid:'100',ask:'101',last:'100.5',timestamp:now,receivedAt:now,generation:1});const q=await h.quote(id);assert.equal(q.nativeCurrency,'USD');assert.deepEqual(q.prices,{});assert.deepEqual(q.fx,{});}finally{h.close();}
});
test('concurrent readers reuse one immutable REST+WS page and never mutate backfill',async t=>{
  const now=100000,id='BYBIT:AAPLXUSDT',base={candles:Object.freeze([Object.freeze({time:90,open:1,high:2,low:1,close:2,volume:3})])};
  t.mock.method(MarketHub.prototype,'history',async()=>base);const h=new LiveMarketHub({liveVenues:['bybit'],now:()=>now});
  try{t.mock.method(h.feed,'history',()=>{});h.catalogueAt=now;h.verified.set(id,{exists:true,online:true});h.feed.candles.set(id+'|15m',{time:90,open:1,high:3,low:1,close:3,volume:4,receivedAt:now});const a=await h.history(id),b=await h.history(id);assert.equal(a,b);assert.equal(a.candles[0].close,3);assert.equal(base.candles[0].close,2);assert.ok(Object.isFrozen(a.candles));}finally{h.close();}
});
class FakeSocket extends EventEmitter {static created=[];constructor(url){super();this.url=url;this.sent=[];FakeSocket.created.push(this);}send(x){this.sent.push(x);}ping(){}terminate(){this.terminated=true;}}
test('two readers share one connection, demand expiry/release closes it and clears generation',async()=>{
  FakeSocket.created=[];let now=100000;const f=new LiveEquityFeed({now:()=>now,WebSocketImpl:FakeSocket});
  try{f.demand('alice',ids[0]);f.demand('bob',ids[0]);await Promise.resolve();assert.equal(FakeSocket.created.length,1);const ws=FakeSocket.created[0];ws.emit('open');assert.equal(ws.sent.length,1);
    const c=f.connections.values().next().value;f.admit(c,bbo(now));assert.ok(f.valid(ids[0],c.generation));f.release('alice');assert.equal(ws.terminated,undefined);now+=12001;f.reconcile();assert.equal(ws.terminated,true);assert.equal(f.connections.size,0);assert.equal(f.quotes.size,0);
  }finally{f.close();}
});
test('reconnect invalidates cached observations before reconnect scheduling',async()=>{
  FakeSocket.created=[];const f=new LiveEquityFeed({now:()=>100000,WebSocketImpl:FakeSocket});try{f.demand('alice',ids[0]);await Promise.resolve();const c=f.connections.values().next().value,ws=FakeSocket.created[0];ws.emit('open');f.admit(c,bbo(100000));ws.emit('close');assert.equal(f.valid(ids[0],1),false);assert.equal(f.quotes.size,0);assert.equal(f.metrics.reconnects,1);}finally{f.close();}
});
test('all release feeds remain OFF without explicit separate rights; sockets remain lazy',()=>{
  const off=createReleaseMarket({});assert.equal(off.metrics.dataEnabled,false);
  assert.throws(()=>createReleaseMarket({STOCKS_LIVE_WS_VENUES:'bybit'}),/DATA_RIGHTS_UNVERIFIED/);
  assert.throws(()=>createReleaseMarket({STOCKS_MARKET_DATA_ENABLED:'true',STOCKS_LIVE_WS_VENUES:'bybit'}),/DATA_RIGHTS_UNVERIFIED/);
  assert.throws(()=>createReleaseMarket({STOCKS_LIVE_WS_VENUES:'backpack',STOCKS_VENUE_RIGHTS_CONFIRMED:'backpack'}),/VENUE_UNKNOWN/);
  const hub=createReleaseMarket({STOCKS_MARKET_DATA_ENABLED:'true',STOCKS_LIVE_WS_VENUES:'bybit',STOCKS_VENUE_RIGHTS_CONFIRMED:'bybit'});try{assert.equal(hub.feed.connections.size,0);}finally{hub.close();}
});
test('metadata is shared and failed/nonexistent sources do not substitute; history remains same venue',async()=>{
  let calls=0;const h=new LiveMarketHub({liveVenues:['bybit'],fetchImpl:async()=>{calls++;return new Response(JSON.stringify(metadata.bybit));}});try{
    const [a,b]=await Promise.all([h.catalogue(),h.catalogue()]);assert.equal(calls,1);assert.equal(a[0].id,b[0].id);assert.ok(a.some(i=>i.id==='BYBIT:AAPLXUSDT'&&i.online));assert.ok(!a.some(i=>i.provider!=='bybit'));assert.equal(h.feed.connections.size,0);
    await assert.rejects(h.quote('BINANCE:AAPLBUSDT'),/SOURCE_UNAVAILABLE/);
  }finally{h.close();}
});
