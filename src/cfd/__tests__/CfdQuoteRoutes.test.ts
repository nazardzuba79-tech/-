import express from 'express';
import request from 'supertest';
import { cfdRouter } from '../../api/routes/cfd';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { CfdQuoteUnavailable } from '../../services/marketData/cfd/CfdQuote';
jest.mock('../../api/middleware/apiKeyAuth',()=>({requireAuthOrApiKey:()=> (req:any,_res:any,next:any)=>{req.userId='test-user';next();},requireTradePermission:(_req:any,_res:any,next:any)=>next()}));
test('unconfigured public catalog keeps all verified instruments visible with null quotes and blocked execution',async()=>{
  const data=new CfdMarketDataService(undefined),app=express().use('/api/v1',cfdRouter({} as any,data,{} as any));
  const catalog=await request(app).get('/api/v1/cfd/catalog').expect(200);expect(catalog.body.instruments).toHaveLength(13);
  expect(catalog.body.instruments.every((i:any)=>i.providerSupported===true&&i.entitlement==='entitlement_required'&&!i.executionAllowed)).toBe(true);
  const quotes=await request(app).get('/api/v1/cfd/tickers').expect(200);expect(quotes.body.configured).toBe(false);
  expect(quotes.body.tickers.find((q:any)=>q.symbol==='WTIUSD')).toMatchObject({price:null,bid:null,ask:null,status:'unavailable',referenceStatus:'unavailable',executionAllowed:false});
});
test('open and close expose explicit 503 temporary-unavailable code and do not turn it into 400',async()=>{
  const unavailable=jest.fn(async()=>{throw new CfdQuoteUnavailable('unavailable_or_stale');});
  const app=express().use(express.json()).use(cfdRouter({} as any,new CfdMarketDataService(undefined),{open:unavailable,close:unavailable} as any));
  const open=await request(app).post('/cfd/positions').send({symbol:'WTIUSD',side:'BUY',quantity:'1',leverage:10}).expect(503);
  expect(open.body.code).toBe('cfd_quote_temporarily_unavailable');
  const close=await request(app).post('/cfd/positions/test/close').send({}).expect(503);expect(close.body.code).toBe(open.body.code);
});
