import { once, EventEmitter } from 'events';
import WebSocket from 'ws';
import request from 'supertest';
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { LiveFeed } from '../contract';
import { collectorServer } from '../collectorServer';
import { MarketDataCollectorClient, collectorFromEnv } from '../MarketDataCollectorClient';
import { writeLiveStream, marketLiveRouter } from '../../../../api/routes/marketLive';
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
    const app=express();app.use(marketLiveRouter(null));
    const res=await request(app).get('/market/live').expect(200);
    expect(res.text).toContain('"status":"disabled"');expect(res.text).not.toContain('event: snapshot');
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
