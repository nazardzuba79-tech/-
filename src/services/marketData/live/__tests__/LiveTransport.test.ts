import { once, EventEmitter } from 'events';
import WebSocket from 'ws';
import request from 'supertest';
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { LiveFeed } from '../contract';
import { collectorServer, writeCollectorStream } from '../collectorServer';
import { MarketDataCollectorClient, collectorFromEnv } from '../MarketDataCollectorClient';
import { writeLiveStream, marketLiveRouter, type SseTerminationReason } from '../../../../api/routes/marketLive';
import express from 'express';
import { BybitTickerBook } from '../../bybit/BybitTickerBook';
import type { NormalizedInstrument, NormalizedTicker } from '../../bybit/types';

function row() {
  const book = new BybitTickerBook();
  book.setUniverse([{provider:'bybit',providerSymbol:'BTCUSDT',symbol:'BTC/USDT',marketType:'spot',baseAsset:'BTC',quoteAsset:'USDT',settleAsset:null,status:'Trading',fundingIntervalMinutes:null} as NormalizedInstrument]);
  book.bootstrap('spot',{ fetchedAt:Date.now(),stale:false,value:[{providerSymbol:'BTCUSDT',lastPrice:1,bidPrice:null,askPrice:null,high24h:null,low24h:null,volume24h:0,quoteVolume24h:null,changePercent24h:0,indexPrice:null,markPrice:null,fundingRate:null,openInterest:null} as NormalizedTicker] });
  return [...book.rows.values()][0];
}
async function until(predicate:()=>boolean) {
  const end=Date.now()+6000;
  while(!predicate()) { if(Date.now()>end)throw new Error('Timed out'); await new Promise(r=>setTimeout(r,20)); }
}
describe('collector internal transport and public fanout',()=>{
  test('internal HTTP/WS require bearer auth; health is public and contains no secret',async()=>{
    const feed=new LiveFeed('auth-test'),token=randomBytes(24).toString('hex'),runtime=collectorServer(feed,token,()=>({tickerCount:0}));
    runtime.server.listen(0,'127.0.0.1');await once(runtime.server,'listening');
    const port=(runtime.server.address() as AddressInfo).port;
    try {
      await request(runtime.app).get('/health').expect(200).then(res=>expect(JSON.stringify(res.body)).not.toContain(token));
      await request(runtime.app).get('/internal/v1/snapshot').expect(401);
      await request(runtime.app).get('/internal/v1/snapshot').set('Authorization','Bearer wrong').expect(401);
      await request(runtime.app).get('/internal/v1/snapshot').set('Authorization',`Bearer ${token}`).expect(200);
      await request(runtime.app).get('/internal/v1/diagnostics').expect(401);
      await request(runtime.app).get('/internal/v1/diagnostics').set('Authorization','Bearer wrong').expect(401);
      const denied=new WebSocket(`ws://127.0.0.1:${port}/internal/v1/stream`); denied.on('error',()=>{});
      const [err]=await once(denied,'error');expect(String(err)).toContain('401');denied.terminate();
      const allowed=new WebSocket(`ws://127.0.0.1:${port}/internal/v1/stream`,{headers:{Authorization:`Bearer ${token}`}});
      const [raw]=await once(allowed,'message');expect(JSON.parse(raw.toString()).type).toBe('snapshot');allowed.terminate();
    } finally { runtime.close(); }
  });
  test('one backend connector restores a fresh snapshot after reconnect; 100 downstream readers do not add sockets',async()=>{
    const feed=new LiveFeed('backend-test');feed.status='live';feed.publish('snapshot',[row()]);
    const token=randomBytes(24).toString('hex'),runtime=collectorServer(feed,token,()=>({}));
    runtime.server.listen(0,'127.0.0.1');await once(runtime.server,'listening');const port=(runtime.server.address() as AddressInfo).port;
    const client=new MarketDataCollectorClient(`http://127.0.0.1:${port}`,token);
    const unsubscribers=Array.from({length:100},()=>client.feed.subscribe(()=>{}));
    try {
      client.start();client.start();await until(()=>client.counters.frames>=2);
      expect(client.counters.connections).toBe(1);expect(client.feed.rows.size).toBe(1);
      feed.publish('delta',[{...row(),lastPrice:0}]);await until(()=>client.feed.rows.get(row().id)?.lastPrice===0);
      // Exercise the same close path as a remote network disconnect.
      (client as any).socket.terminate();await until(()=>client.feed.status==='stale');
      expect(client.feed.rows.get(row().id)).toMatchObject({lastPrice:0,stale:true});
      await until(()=>client.counters.connections===2 && client.feed.status==='live');
      expect(client.feed.rows.get(row().id)?.lastPrice).toBe(0);
      expect(client.counters.reconnects).toBe(1);
    } finally { unsubscribers.forEach(fn=>fn());client.stop();runtime.close(); }
  },10000);
  test.each([{}, {MARKET_DATA_COLLECTOR_URL:'http://localhost:1'}, {MARKET_DATA_COLLECTOR_TOKEN:'x'}])('missing config disables all collector IO: %j',env=>{
    expect(collectorFromEnv(env)).toBeNull();
  });
  test('unconfigured public stream reports disabled without an empty fake snapshot',async()=>{
    const log=jest.fn(),secret=randomBytes(24).toString('hex');const app=express();app.use(marketLiveRouter(null,log));
    const res=await request(app).get(`/market/live?secret=${secret}`).set('CF-Ray','0123456789abcdef-FRA')
      .set('Authorization',`Bearer ${secret}`).set('Cookie',`session=${secret}`).set('X-Body-Preview',secret).expect(200);
    expect(res.text).toContain('"status":"disabled"');expect(res.text).not.toContain('event: snapshot');
    expect(log).toHaveBeenCalledTimes(1);expect(log.mock.calls[0][0]).toMatchObject({event:'market_sse_terminated',reason:'response_finish',
      blockedMs:0,backpressureActive:false,correlationId:'0123456789abcdef-FRA'});
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
  test.each(['peer_close','response_finish','response_error','server_cleanup'] as SseTerminationReason[])('SSE cleanup reports safe terminal reason %s once',reason=>{
    const feed=new LiveFeed(`reason-${reason}`);feed.publish('snapshot',[row()]);const log=jest.fn();
    const response=Object.assign(new EventEmitter(),{write:jest.fn(()=>true),destroy:jest.fn()});
    const cleanup=writeLiveStream(response as any,feed,log);cleanup(reason);cleanup('server_cleanup');
    expect(log).toHaveBeenCalledTimes(1);expect(log.mock.calls[0][0]).toMatchObject({event:'market_sse_terminated',reason,
      blockedMs:0,backpressureActive:false});expect(feed.subscriberCount).toBe(0);
  });
  test('backpressure drops superseded deltas and sends one latest snapshot on drain; cleanup removes listener',()=>{
    jest.useFakeTimers();
    const feed=new LiveFeed('slow-test');feed.publish('snapshot',[row()]);
    const response=Object.assign(new EventEmitter(),{write:jest.fn((_text: string)=>false),destroy:jest.fn()});
    const cleanup=writeLiveStream(response as any,feed);
    for(let i=0;i<1000;i++)feed.publish('delta',[{...row(),lastPrice:i}]);
    expect(response.write).toHaveBeenCalledTimes(1);
    response.write.mockReturnValue(true);response.emit('drain');expect(response.write).toHaveBeenCalledTimes(2);
    expect(response.write.mock.calls[1][0]).toContain('"lastPrice":999');
    expect(response.write.mock.calls[1][0]).toContain('event: snapshot');
    cleanup();expect(feed.subscriberCount).toBe(0);expect(jest.getTimerCount()).toBe(0);jest.useRealTimers();
  });
});

describe('staging readiness boundaries',()=>{
  test.each(['http://example.invalid','https://user:pass@example.invalid','https://example.invalid/?token=x','https://example.invalid/#secret','https://example.invalid/private'])('unsafe collector origin is refused: %s',url=>{
    expect(()=>new MarketDataCollectorClient(url,'test')).toThrow();
  });
  test('HTTP bootstrap uses bearer header, refuses redirects and never puts the token in the URL',async()=>{
    const token=randomBytes(24).toString('hex'),fetchFn=jest.fn(async()=>({ok:false,status:302,headers:new Headers({location:'https://other.invalid'})} as Response));
    const client=new MarketDataCollectorClient('https://collector.invalid',token,fetchFn);
    client.start();await until(()=>fetchFn.mock.calls.length===1);client.stop();
    const [url,options]=(fetchFn.mock.calls as any)[0];expect(url).not.toContain(token);
    expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe(`Bearer ${token}`);
  });
  test('same-epoch reconnect cannot rewind revision; new epoch cannot rewind retained prices',()=>{
    const c=new MarketDataCollectorClient('http://localhost:1','test') as any;
    const current={...row(),providerEventAt:200,lastPrice:20};
    const f=(epoch:string,revision:number,rows:any[])=>({version:1,type:'snapshot',epoch,revision,rows,status:'live',sentAt:Date.now()});
    c.apply(f('one',10,[current]),true);
    expect(()=>c.apply(f('one',9,[{...current,lastPrice:9}]),true)).toThrow();
    c.apply(f('two',1,[{...current,lastPrice:1,providerEventAt:100}]),true);
    expect(c.feed.rows.get(current.id)).toMatchObject({lastPrice:20,providerEventAt:200,stale:true});
    c.apply(f('two',2,[{...current,lastPrice:21,providerEventAt:201}]),false);
    expect(c.feed.rows.get(current.id)).toMatchObject({lastPrice:21,stale:false});c.stop();
  });
  test('internal WS slow writer drops deltas, resynchronizes once and disconnects permanent blockage',()=>{
    jest.useFakeTimers();
    try {
      const feed=new LiveFeed('slow-ws');feed.publish('snapshot',[row()]);
      const socket=Object.assign(new EventEmitter(),{readyState:WebSocket.OPEN,bufferedAmount:2_000_001,send:jest.fn(),ping:jest.fn(),terminate:jest.fn()});
      socket.ping.mockImplementation(()=>socket.emit('pong'));socket.terminate.mockImplementation(()=>{socket.readyState=WebSocket.CLOSED as any;socket.emit('close');});
      writeCollectorStream(socket as any,feed);
      for(let i=0;i<5000;i++)feed.publish('delta',[{...row(),lastPrice:i}]);
      expect(socket.send).not.toHaveBeenCalled();expect(feed.subscriberCount).toBe(1);
      socket.bufferedAmount=0;jest.advanceTimersByTime(250);expect(socket.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({type:'snapshot',rows:[{lastPrice:4999}]});
      socket.bufferedAmount=2_000_001;feed.publish('state');jest.advanceTimersByTime(31000);
      expect(socket.terminate).toHaveBeenCalledTimes(1);expect(feed.subscriberCount).toBe(0);expect(jest.getTimerCount()).toBe(0);
    }finally{jest.useRealTimers();}
  });
  test('permanently blocked SSE is destroyed and close removes timers/listeners',()=>{
    jest.useFakeTimers();
    try {
      const feed=new LiveFeed('blocked');feed.publish('snapshot',[row()]);
      const res=Object.assign(new EventEmitter(),{write:jest.fn(()=>false),destroy:jest.fn()}),log=jest.fn();
      const cleanup=writeLiveStream(res as any,feed,log);res.once('close',cleanup);res.destroy.mockImplementation(()=>res.emit('close'));
      jest.advanceTimersByTime(45000);expect(res.destroy).toHaveBeenCalledTimes(1);expect(feed.subscriberCount).toBe(0);expect(jest.getTimerCount()).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);expect(log.mock.calls[0][0]).toMatchObject({event:'market_sse_terminated',reason:'backpressure_destroy',
        elapsedMs:45000,blockedMs:45000,backpressureActive:true});
    }finally{jest.useRealTimers();}
  });
  test('repeated real internal connections and SSE disconnects release long-lived feed listeners',async()=>{
    const feed=new LiveFeed('cleanup'),token=randomBytes(24).toString('hex'),runtime=collectorServer(feed,token,()=>({}));feed.status='live';feed.publish('snapshot',[row()]);
    runtime.server.listen(0,'127.0.0.1');await once(runtime.server,'listening');const url=`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const terminations:any[]=[];const api=express();api.use(marketLiveRouter(feed,event=>terminations.push(event)));
    const server=api.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      for(let i=0;i<10;i++){
        const client=new MarketDataCollectorClient(url,token);client.start();await until(()=>client.counters.frames>=2);expect(feed.subscriberCount).toBe(1);
        client.stop();await until(()=>feed.subscriberCount===0);
        const abort=new AbortController();const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/market/live`,{signal:abort.signal});
        await response.body!.getReader().read();expect(feed.subscriberCount).toBe(1);abort.abort();await until(()=>feed.subscriberCount===0);
      }
      expect(terminations).toHaveLength(10);expect(terminations.every(event=>event.reason==='peer_close')).toBe(true);
    }finally{runtime.close();server.closeAllConnections();server.close();}
  },15000);
});
