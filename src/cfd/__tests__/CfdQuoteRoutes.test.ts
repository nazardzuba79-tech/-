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
  expect(quotes.body.tickers.find((q:any)=>q.symbol==='WTIUSD')).toMatchObject({price:null,status:'unavailable',entitlementVerified:false,executionAllowed:false});
});
test('open and close expose explicit 503 temporary-unavailable code and do not turn it into 400',async()=>{
  const unavailable=jest.fn(async()=>{throw new CfdQuoteUnavailable('unavailable_or_stale');});
  const app=express().use(express.json()).use(cfdRouter({} as any,new CfdMarketDataService(undefined),{open:unavailable,close:unavailable} as any));
  const open=await request(app).post('/cfd/positions').send({symbol:'WTIUSD',side:'BUY',quantity:'1',leverage:10}).expect(503);
  expect(open.body.code).toBe('cfd_quote_temporarily_unavailable');
  const close=await request(app).post('/cfd/positions/test/close').send({}).expect(503);expect(close.body.code).toBe(open.body.code);
});
// 2026-10-15 (CFD stats bar): the provider's own bid and ask reach the ticker row only as a sane pair.
test('tickers carry the provider bid and ask only when both are positive and ask is not below bid',async()=>{
  const at=Date.now(),quote=(symbol:string,providerSymbol:string,bid:number|null,ask:number|null)=>({provider:'test',symbol,providerSymbol,bid,ask,mid:null,last:2000,providerTimestamp:at,fetchedAt:at,stale:false,status:'live',referenceStatus:'live',entitlementVerified:false,executionAllowed:false});
  const data=Object.assign(new CfdMarketDataService(undefined),{getQuotes:async()=>[quote('XAUUSD','XAU/USD',1999.5,2000.5),quote('EURUSD','EUR/USD',1.2,1.1),quote('GBPUSD','GBP/USD',1.3,null),quote('USDJPY','USD/JPY',0,150)]});
  const app=express().use('/api/v1',cfdRouter({} as any,data as any,{} as any,null));
  const rows=(await request(app).get('/api/v1/cfd/tickers').expect(200)).body.tickers;
  const row=(s:string)=>rows.find((r:any)=>r.symbol===s);
  expect(row('XAUUSD')).toMatchObject({bid:'1999.5',ask:'2000.5',price:'2000'});
  for(const s of ['EURUSD','GBPUSD','USDJPY']){expect(row(s).bid).toBeUndefined();expect(row(s).ask).toBeUndefined();}
});
