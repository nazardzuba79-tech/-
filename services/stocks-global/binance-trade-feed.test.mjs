import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { BinanceTradeFeed } from './binance-trade-feed.mjs';
import { BinanceStreamMarketHub } from './binance-stream-market.mjs';
import { MarketHub } from './market.mjs';
import { quoteStatus } from './engine.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<180;n++){if(fn())return;await pause(10);}assert.fail('bounded synthetic condition timed out');}
async function fixture(t){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
  const clients=[],controls=[];server.on('connection',s=>{clients.push(s);s.on('message',bytes=>{const row=JSON.parse(bytes);controls.push(row);s.send(JSON.stringify({id:row.id,result:null}));});});
  let now=Date.now(),mono=0;const feed=new BinanceTradeFeed({url:'ws://127.0.0.1:'+server.address().port+'/stream',synthetic:true,now:()=>now,monotonicNow:()=>mono});
  t.after(async()=>{feed.close();for(const s of clients)s.terminate();await new Promise(r=>server.close(r));});
  const send=(symbol='AAPLBUSDT',id=1,time=now,extra={})=>clients.at(-1).send(JSON.stringify({stream:symbol.toLowerCase()+'@trade',data:{e:'trade',E:time,s:symbol,t:id,p:'100.00000000',T:time,...extra}}));
  const ready=async()=>{await until(()=>feed.subscribed.has('AAPLBUSDT'));};
  return{feed,clients,controls,send,ready,now:()=>now,advance:n=>{now+=n;mono+=n;}};
}
test('silent half-open after ACK is disconnected by monotonic inbound watchdog',async t=>{const f=await fixture(t);f.feed.demand('a',{pinned:['AAPLBUSDT']});await f.ready();f.advance(45001);f.feed.sync();await pause(20);assert.notEqual(f.feed.socket?.readyState,1);assert.equal(f.feed.metrics.heartbeatTimeouts,1);assert.equal(f.feed.ticks.size,0);});
test('active heartbeat without trades keeps transport alive without refreshing native price or arrival',async t=>{const f=await fixture(t);f.feed.demand('a',{pinned:['AAPLBUSDT']});await f.ready();f.send();await until(()=>f.feed.metrics.accepted===1);const tick=f.feed.read('AAPLBUSDT');for(let n=1;n<=4;n++){f.advance(20000);f.clients[0].ping();await until(()=>f.feed.metrics.heartbeats===n);f.feed.sync();assert.equal(f.feed.socket.readyState,1);}assert.deepEqual(f.feed.read('AAPLBUSDT'),tick);assert.equal(f.feed.metrics.heartbeatTimeouts,0);assert.equal(f.feed.metrics.accepted,1);f.feed.close();assert.equal(f.feed.socket,null);assert.equal(f.feed.timer,null);assert.equal(f.feed.sweep,null);assert.equal(f.feed.waiters.size,0);});
test('response-only portfolio demand abort and timeout release the last subscription and all waiters',async t=>{const f=await fixture(t),id='BINANCE:AAPLBUSDT',hub=new BinanceStreamMarketHub({enabled:true,now:f.now});hub.feed.close();hub.feed=f.feed;hub.verified.set(id,{exists:true,online:true,checkedAt:f.now()});const controller=new AbortController();let reads=0;const pending=hub.withPortfolioDemand(id,()=>{reads++;},{signal:controller.signal});await f.ready();controller.abort();await assert.rejects(pending);assert.equal(reads,0);assert.equal(f.feed.waiters.size,0);assert.equal(f.feed.owners.size,0);assert.equal(f.feed.socket,null);const timeout=hub.withPortfolioDemand(id,()=>{reads++;});await assert.rejects(timeout);assert.equal(reads,0);assert.equal(f.feed.waiters.size,0);assert.equal(f.feed.owners.size,0);assert.equal(f.feed.timer,null);assert.equal(f.feed.sweep,null);});
test('shared subscription retains original trade time/id/arrival across reads and duplicate frames',async t=>{
  const f=await fixture(t);f.feed.demand('a',{selected:'AAPLBUSDT'});f.feed.demand('b',{selected:'AAPLBUSDT'});await f.ready();f.send();await until(()=>f.feed.metrics.accepted===1);const first=f.feed.read('AAPLBUSDT');assert.equal(f.feed.generationAbort.signal.aborted,false);f.advance(900);assert.deepEqual(f.feed.read('AAPLBUSDT'),first);f.send();f.send('AAPLBUSDT',0,f.now()-2000);await until(()=>f.feed.metrics.duplicates===2);assert.deepEqual(f.feed.read('AAPLBUSDT'),first);assert.equal(f.clients.length,1);assert.equal(f.controls.length,1);
});
test('disconnect clears executable cache and replay after reconnect cannot freshen old event',async t=>{
  const f=await fixture(t);f.feed.demand('a',{selected:'AAPLBUSDT'});await f.ready();f.send();await until(()=>f.feed.metrics.accepted===1);const lifetime=f.feed.generationAbort.signal;f.clients[0].terminate();await until(()=>!f.feed.socket);assert.equal(lifetime.aborted,true);assert.throws(()=>f.feed.read('AAPLBUSDT'),/QUOTE_UNAVAILABLE/);await until(()=>f.clients.length===2);await f.ready();assert.notEqual(f.feed.generationAbort.signal,lifetime);assert.equal(f.feed.generationAbort.signal.aborted,false);f.advance(500);f.send('AAPLBUSDT',1,f.now()-500);await until(()=>f.feed.metrics.duplicates===1);assert.throws(()=>f.feed.read('AAPLBUSDT'),/QUOTE_UNAVAILABLE/);f.send('AAPLBUSDT',2);await until(()=>f.feed.metrics.accepted===2);assert.equal(f.feed.read('AAPLBUSDT').id,2);
});
test('selection release keeps open-order demand; unpin/expiry/shutdown remove subscriptions and timers',async t=>{
  const f=await fixture(t);f.feed.demand('trader',{selected:'AAPLBUSDT',pinned:['MSFTBUSDT']});await f.ready();f.feed.release('trader');assert.deepEqual([...f.feed.desired],['MSFTBUSDT']);f.feed.demand('trader',{});assert.equal(f.feed.desired.size,0);assert.equal(f.feed.socket,null);f.feed.demand('viewer',{selected:'AAPLBUSDT'});f.advance(12000);f.feed.sync();assert.equal(f.feed.owners.size,0);assert.equal(f.feed.timer,null);assert.equal(f.feed.sweep,null);f.feed.close();assert.throws(()=>f.feed.demand('later',{selected:'AAPLBUSDT'}),/INVALID_REQUEST/);
});
test('unknown symbol, unsafe numeric IDs, future time and invalid frames fail closed',async t=>{
  const f=await fixture(t);assert.throws(()=>f.feed.demand('bad',{selected:'BTCUSDT'}),/INVALID_PAIR/);f.feed.demand('a',{selected:'AAPLBUSDT'});await f.ready();f.send('AAPLBUSDT',Number.MAX_SAFE_INTEGER+1);await until(()=>f.feed.metrics.invalid===1);assert.equal(f.feed.ticks.size,0);assert.throws(()=>f.feed.read('AAPLBUSDT'),/QUOTE_UNAVAILABLE/);
  assert.throws(()=>new BinanceTradeFeed({url:'ws://example.invalid/stream',synthetic:true}),/SOURCE_FORBIDDEN/);
});
test('future native time and malformed JSON invalidate the socket without a REST retry',async t=>{
  const f=await fixture(t);f.feed.demand('a',{selected:'AAPLBUSDT'});await f.ready();f.send('AAPLBUSDT',1,f.now()+2001);await until(()=>f.feed.metrics.invalid===1);assert.equal(f.feed.ticks.size,0);await until(()=>f.clients.length===2);await f.ready();f.clients.at(-1).send('{');await until(()=>f.feed.metrics.invalid===2);assert.equal(f.feed.ticks.size,0);
});
test('actual reconnect attempts stop at four in the same rolling minute',async t=>{
  const f=await fixture(t);f.feed.demand('a',{selected:'AAPLBUSDT'});for(let n=1;n<=4;n++){await until(()=>f.clients.length===n);await f.ready();f.clients.at(-1).terminate();await until(()=>!f.feed.socket);}await pause(650);assert.equal(f.clients.length,4);assert.equal(f.feed.metrics.connections,4);assert.equal(f.feed.starts.length,4);assert.ok(f.feed.timer);assert.throws(()=>f.feed.read('AAPLBUSDT'),/QUOTE_UNAVAILABLE/);
});
test('owner bound, subscription churn and overload remain bounded',async t=>{
  const f=await fixture(t);for(let n=0;n<512;n++)f.feed.demand('owner'+n,{selected:'AAPLBUSDT'});assert.throws(()=>f.feed.demand('overflow',{selected:'AAPLBUSDT'}),/SOURCE_BUSY/);await f.ready();for(let n=0;n<1000;n++)f.feed.demand('owner0',{selected:n%2?'MSFTBUSDT':'AAPLBUSDT'});assert.equal(f.feed.owners.size,512);assert.ok(f.feed.desired.size<=2);assert.equal(f.clients.length,1);const bytes=Buffer.from('{}');f.feed.frameSecond=Math.floor(f.now()/1000);f.feed.frameCount=2000;assert.throws(()=>f.feed.message(bytes,false),/SOURCE_BUSY/);f.clients[0].send('x'.repeat(65537));await until(()=>!f.feed.socket);assert.equal(f.feed.ticks.size,0);
});
test('opt-in quote seam preserves native T, arrival, event ID, capacity and pre-demand stale guards',async t=>{
  const f=await fixture(t),id='BINANCE:AAPLBUSDT';const hub=new BinanceStreamMarketHub({enabled:true,now:f.now});hub.feed.close();hub.feed=f.feed;hub.verified.set(id,{exists:true,online:true,checkedAt:f.now(),multiplier:null});hub.request=async()=>({symbol:'AAPLBUSDT',priceChangePercent:'1.25',volume:'20'});hub.setStockDemand('a',id);await f.ready();f.send();await until(()=>f.feed.metrics.accepted===1);const a=await hub.quote(id,{includeUsdc:false});f.advance(2100);const b=await hub.quote(id,{includeUsdc:false});assert.equal(b.timestamp,a.timestamp);assert.equal(b.receivedAt,a.receivedAt);assert.equal(b.eventId,a.eventId);assert.equal(b.capacity,'1.00000000');assert.equal(b.change24h,1.25);assert.ok(b.timestamp<f.now(),'a pre-demand observation retains its earlier native timestamp');assert.equal(quoteStatus(b,f.now()+30000),'QUOTE_STALE');hub.releaseStockDemand('a');assert.equal(f.feed.desired.size,0);
});
test('disabled hub does not create WS feed or share metadata and default REST native shape is unchanged',async()=>{
  const hub=new BinanceStreamMarketHub(),rest=new MarketHub();assert.equal(hub.feed,null);let called=0;hub.fetch=async()=>{called++;return new Response('[{"id":1,"time":123,"price":"100"}]');};const value=await hub.binanceNative('AAPLBUSDT');assert.deepEqual(value,{rows:[{id:1,time:123,price:'100'}]});assert.equal(called,1);assert.equal(rest.binanceNative,MarketHub.prototype.binanceNative);
});
