import express from 'express';
import request from 'supertest';
import { publicDisplayCache, SLOW_DISPLAY_REFRESH_MS } from '../../middleware/publicDisplayCache';

describe('six-hour display cache provider warmup',()=>{
 test('one shared retry for a partial cold snapshot, without hiding known prices',async()=>{
  let clock=1_700_000_000_000,calls=0;const app=express();
  app.get('/data',publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,()=>true,()=>clock),(_q,r)=>{
    calls++;r.json({tickers:[{symbol:'XAUUSD',price:calls===1?null:'4300'},{symbol:'EURUSD',price:'1.14'}]});
  });
  const cold=await request(app).get('/data').expect(200);
  expect(cold.headers['cache-control']).toContain('max-age=30');expect(cold.body.tickers[1].price).toBe('1.14');
  clock+=29_999;await request(app).get('/data');expect(calls).toBe(1);
  clock+=1;const warm=await request(app).get('/data');expect(calls).toBe(2);
  expect(warm.body.tickers[0].price).toBe('4300');expect(warm.headers['cache-control']).toContain('max-age=21600');
  clock+=60_000;await request(app).get('/data');expect(calls).toBe(2);
 });
 test('persistent partial data cannot trigger an endless 30-second poll',async()=>{
  let clock=1_700_000_000_000,calls=0;const app=express();
  app.get('/data',publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,()=>true,()=>clock),(_q,r)=>{
    calls++;r.json({tickers:[{symbol:'XAUUSD',price:null},{symbol:'EURUSD',price:'1.14'}]});
  });
  await request(app).get('/data');clock+=30_000;const second=await request(app).get('/data');
  expect(second.headers['cache-control']).toContain('max-age=21600');clock+=60_000;await request(app).get('/data');expect(calls).toBe(2);
 });
});
