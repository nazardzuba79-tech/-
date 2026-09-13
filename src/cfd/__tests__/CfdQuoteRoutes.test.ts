import express from 'express';
import request from 'supertest';
import { cfdRouter } from '../../api/routes/cfd';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { CfdQuoteUnavailable, assertCfdFreshQuote, type CfdQuote } from '../../services/marketData/cfd/CfdQuote';
import { PublicReferenceFeed } from '../../services/marketData/cfd/PublicReferenceFeed';
import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
jest.mock('../../api/middleware/apiKeyAuth',()=>({requireAuthOrApiKey:()=> (req:any,_res:any,next:any)=>{req.userId='test-user';next();},requireTradePermission:(_req:any,_res:any,next:any)=>next()}));
test('unconfigured public catalog keeps all verified instruments visible with null quotes and blocked execution',async()=>{
  const data=new CfdMarketDataService(undefined),app=express().use('/api/v1',cfdRouter({} as any,data,{} as any,new PublicReferenceFeed()));
  const catalog=await request(app).get('/api/v1/cfd/catalog').expect(200);expect(catalog.body.instruments).toHaveLength(13);
  expect(catalog.body.instruments.every((i:any)=>i.providerSupported===true&&i.entitlement==='entitlement_required'&&!i.executionAllowed)).toBe(true);
  const quotes=await request(app).get('/api/v1/cfd/tickers').expect(200);expect(quotes.body.configured).toBe(false);
  expect(quotes.body.tickers.find((q:any)=>q.symbol==='WTIUSD')).toMatchObject({price:null,bid:null,ask:null,status:'unavailable',executionAllowed:false});
});
test('open and close expose explicit 503 temporary-unavailable code and do not turn it into 400',async()=>{
  const unavailable=jest.fn(async()=>{throw new CfdQuoteUnavailable('unavailable_or_stale');});
  const app=express().use(express.json()).use(cfdRouter({} as any,new CfdMarketDataService(undefined),{open:unavailable,close:unavailable} as any,new PublicReferenceFeed()));
  const open=await request(app).post('/cfd/positions').send({symbol:'WTIUSD',side:'BUY',quantity:'1',leverage:10}).expect(503);
  expect(open.body.code).toBe('cfd_quote_temporarily_unavailable');
  const close=await request(app).post('/cfd/positions/test/close').send({}).expect(503);expect(close.body.code).toBe(open.body.code);
});
test('public fallback serves a sourced quote while the underlying financial source stays unavailable',async()=>{
  const at=Date.parse('2026-09-13T12:00:00Z');const clock=jest.spyOn(Date,'now').mockReturnValue(at);
  try {
    const fetchFn=jest.fn(async(url:any)=>String(url).includes('gold-api')
      ?new Response(JSON.stringify({symbol:String(url).split('/').pop(),price:2000,updatedAt:new Date(at).toISOString()}))
      :new Response('',{status:503}));
    const refs=new PublicReferenceFeed({enabled:true,fetchFn,sleep:async()=>undefined});await refs.refreshDue();
    const data=new CfdMarketDataService(undefined);
    const unavailable=jest.fn(async()=>{await data.getFreshQuote('XAUUSD');});
    const app=express().use(express.json()).use(cfdRouter({} as any,data,{open:unavailable,close:unavailable} as any,refs));
    const result=await request(app).get('/cfd/tickers').expect(200);
    const q=result.body.tickers.find((q:any)=>q.symbol==='XAUUSD');
    expect(result.body).toMatchObject({source:'twelvedata+public-reference',configured:true});expect(result.body.tickers).toHaveLength(13);
    expect(q).toMatchObject({price:'2000',last:null,bid:null,ask:null,displayOnly:true,executionAllowed:false,referenceKind:'indicative',provider:'gold-api'});
    expect(q.referenceLabel).toContain('Gold API');expect(()=>assertCfdFreshQuote(q,'XAUUSD',5000,at)).toThrow();
    expect((await data.getQuotes()).find(q=>q.symbol==='XAUUSD')?.last).toBeNull();
    await request(app).post('/cfd/positions').send({symbol:'XAUUSD',side:'BUY',quantity:'1',leverage:10}).expect(503);
    await request(app).post('/cfd/positions/p/close').send({}).expect(503);
    await request(app).get('/cfd/tickers').expect(200);expect(fetchFn).toHaveBeenCalledTimes(7);
  } finally {clock.mockRestore();}
});
test('free live display source can price the terminal while financial open/close remain fail-closed',async()=>{
  const at=Date.parse('2026-09-13T12:00:00Z');const clock=jest.spyOn(Date,'now').mockReturnValue(at);
  try {
    const quote:CfdQuote={provider:'biquote',symbol:'WTIUSD',providerSymbol:'USOIL',bid:90,ask:90.2,mid:90.1,last:90.1,
      providerTimestamp:at,fetchedAt:at,stale:false,status:'entitlement_required',referenceStatus:'available',entitlementVerified:false,executionAllowed:false};
    const display=new CfdDisplayQuoteRouter([{id:'biquote',priority:10,source:{getQuotes:async()=>[quote]}}],{now:()=>at});
    const data=new CfdMarketDataService(undefined);const unavailable=jest.fn(async()=>{await data.getFreshQuote('WTIUSD');});
    const app=express().use(express.json()).use(cfdRouter({} as any,data,{open:unavailable,close:unavailable} as any,new PublicReferenceFeed(),data,undefined,display));
    const result=await request(app).get('/cfd/tickers').expect(200),wti=result.body.tickers.find((q:any)=>q.symbol==='WTIUSD');
    expect(result.body).toMatchObject({source:'twelvedata+public-display',configured:true});expect(result.body.tickers).toHaveLength(13);
    expect(wti).toMatchObject({provider:'biquote',price:'90.1',displayOnly:true,executionAllowed:false,entitlementVerified:false,status:'reference_only'});
    expect(wti.referenceLabel).toContain('BiQuote');expect(()=>assertCfdFreshQuote(wti,'WTIUSD',5000,at)).toThrow();
    await request(app).post('/cfd/positions').send({symbol:'WTIUSD',side:'BUY',quantity:'1',leverage:10}).expect(503);
    await request(app).post('/cfd/positions/p/close').send({}).expect(503);
  } finally {clock.mockRestore();}
});
