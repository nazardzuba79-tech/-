import express from 'express';
import request from 'supertest';
import { BybitMarketDataService } from '../BybitMarketDataService';
import { BybitOptions, normalizeOptionInstrument, normalizeOptionTicker, optionQuerySchema } from '../BybitOptions';
import { collectorServer } from '../../live/collectorServer';
import { LiveFeed } from '../../live/contract';
import { MarketDataCollectorClient } from '../../live/MarketDataCollectorClient';
import { marketOptionsRouter } from '../../../../api/routes/marketOptions';

const at = Date.UTC(2026,8,12);
const instrument = (base='BTC', type='Call', strike=70000) => ({ symbol:`${base}-27MAR27-${strike}-${type==='Call'?'C':'P'}-USDT`,
  baseCoin:base,quoteCoin:'USDT',settleCoin:'USDT',status:'Trading',optionsType:type,deliveryTime:String(Date.UTC(2027,2,27,8)),
  priceFilter:{tickSize:'0.1'},lotSizeFilter:{minOrderQty:'0.01',maxOrderQty:'500',qtyStep:'0.01'} });
function fixture() {
  let now=at, fail=false, eventAt:number|null=null;
  const contracts=[instrument(),instrument('BTC','Put'),instrument('ETH','Call',4000)];
  const fetchFn=jest.fn(async (input:any) => {
    if(fail)throw Error('offline');
    const u=new URL(String(input)), isUniverse=u.pathname.endsWith('instruments-info');
    const list=isUniverse ? (u.searchParams.has('cursor')?contracts.slice(1):contracts.slice(0,1))
      : contracts.filter(i=>i.baseCoin===u.searchParams.get('baseCoin')).map(i=>({symbol:i.symbol,lastPrice:'5',bid1Price:'',ask1Price:'7',delta:'0',theta:'-0.3'}));
    return {ok:true,status:200,json:async()=>({retCode:0,time:eventAt??now,result:{list,nextPageCursor:isUniverse&&!u.searchParams.has('cursor')?'next':''}})} as Response;
  });
  const rest=new BybitMarketDataService({fetchFn,now:()=>now,sleep:async()=>{}});
  return {service:new BybitOptions(rest,()=>now),fetchFn,rest,advance:(n:number)=>now+=n,fail:()=>fail=true,rollback:()=>eventAt=at-1};
}
const query=(q:unknown={})=>optionQuerySchema.parse(q);
test.each(['Call','Put'])('normalizes %s, metadata currencies, expiry, strike and constraints',type=>{
  expect(normalizeOptionInstrument(instrument('BTC',type))).toMatchObject({optionType:type,expiry:'2027-03-27',strike:70000,
    baseAsset:'BTC',quoteAsset:'USDT',settleAsset:'USDT',marketType:'option',executable:false,launchTime:null,
    filters:{tickSize:.1,minPrice:null,maxPrice:null,qtyStep:.01}});
});
test.each(['BTC-X-70000-C','BTC-30FEB27-70000-C-USDT','BTC-27MAR27-NaN-C-USDT','BTC-27MAR27-70000-P-USDT'])('rejects malformed or contradictory option symbol %s',symbol=>{
  expect(normalizeOptionInstrument({...instrument(),symbol})).toBeNull();
});
test('normalizes actual REST names, negative Greeks and real zero; missing values remain null',()=>{
  expect(normalizeOptionTicker({symbol:instrument().symbol,bid1Price:'',ask1Price:'8',delta:'0',theta:'-2',markIv:'0.4',volume24h:'0',gamma:true},at))
    .toMatchObject({bid:null,ask:8,delta:0,theta:-2,markIv:.4,volume24h:0,gamma:null,last:null,mark:null,index:null,openInterest:null,providerEventAt:at});
});
test('all-base universe exhausts cursor, deduplicates concurrent loads and locally filters/pages',async()=>{
  const f=fixture(); const pages=await Promise.all(Array.from({length:20},()=>f.service.instruments(query({baseCoin:'BTC',limit:1}))));
  expect(f.fetchFn).toHaveBeenCalledTimes(2);
  for(const [url] of f.fetchFn.mock.calls){const u=new URL(url);expect(u.searchParams.get('category')).toBe('option');expect(u.searchParams.get('baseCoin')).toBe('All');expect(u.searchParams.get('limit')).toBe('1000');}
  const first=pages[0];expect(first.total).toBe(2);expect(first.items).toHaveLength(1);
  const second=await f.service.instruments(query({baseCoin:'BTC',limit:1,cursor:first.nextCursor}));
  expect(second.items[0].providerSymbol).not.toBe(first.items[0].providerSymbol);expect(second.nextCursor).toBeNull();
  await expect(f.service.instruments(query({baseCoin:'ETH',cursor:first.nextCursor}))).rejects.toMatchObject({status:409});
  f.advance(900001);await expect(f.service.instruments(query({baseCoin:'BTC',cursor:first.nextCursor}))).rejects.toMatchObject({status:409});
});
test('ticker cache shares a whole base across expiry/pages and never subscribes globally',async()=>{
  const f=fixture();const first=await f.service.quotes(query({baseCoin:'BTC',expiry:'2027-03-27',limit:1}));
  await Promise.all(Array.from({length:30},()=>f.service.quotes(query({baseCoin:'BTC'}))));
  expect(f.fetchFn).toHaveBeenCalledTimes(3);expect(first.total).toBe(2);
  expect(f.service.diagnostics()).toMatchObject({contracts:3,bases:2,globalSubscriptions:0,tickerCacheKeys:1});
  await expect(f.service.quotes(query())).rejects.toMatchObject({status:400});
  await expect(f.service.quotes(query({baseCoin:'UNKNOWN'}))).rejects.toMatchObject({status:400});
});
test('options rollback preserves stale last-good; out-of-budget data becomes unavailable',async()=>{
  const f=fixture();await f.service.quotes(query({baseCoin:'BTC'}));f.advance(5001);f.rollback();
  const stale=await f.service.quotes(query({baseCoin:'BTC'}));expect(stale.stale).toBe(true);expect(stale.fetchedAt).toBe(at);
  f.advance(30001);await expect(f.service.quotes(query({baseCoin:'BTC'}))).rejects.toThrow();
});
test('universe failure retains the complete prior universe, never a partial replacement',async()=>{
  const f=fixture();await f.service.instruments(query());f.advance(900001);f.fail();
  expect(await f.service.instruments(query())).toMatchObject({total:3,stale:true,fetchedAt:at});
});
test('repeated pagination and malformed instruments fail closed',async()=>{
  for(const list of [[instrument()], [{...instrument(),symbol:'bad'}]]){
    const rest={optionInstrumentsPage:jest.fn(async()=>({list,nextPageCursor:'loop'}))} as any;
    await expect(new BybitOptions(rest).loadUniverse()).rejects.toThrow();expect(rest.optionInstrumentsPage.mock.calls.length).toBeLessThanOrEqual(2);
  }
});
test('internal auth, collector-only proxy, public validation and secret containment',async()=>{
  const f=fixture(), feed=new LiveFeed('test');const internal=collectorServer(feed,'test-secret',()=>({}),f.service);
  await request(internal.app).get('/internal/v1/options/instruments').expect(401);
  await request(internal.app).get('/internal/v1/options/tickers?baseCoin=BTC').set('Authorization','Bearer wrong').expect(401);
  const fetchFn=jest.fn(async (url:any,init:any)=>{
    expect(String(url).startsWith('https://collector.example/internal/v1/options/')).toBe(true);
    expect(init.redirect).toBe('error');expect(init.headers.Authorization).toBe('Bearer test-secret');
    const u=new URL(url); const res=await request(internal.app).get(u.pathname+u.search).set('Authorization',init.headers.Authorization);
    return {ok:res.status<400,status:res.status,json:async()=>({...res.body,token:'must-be-stripped'})} as Response;
  });
  const client=new MarketDataCollectorClient('https://collector.example','test-secret',fetchFn);
  const app=express().use('/api/v1',marketOptionsRouter(client));
  const res=await request(app).get('/api/v1/market/options/instruments?baseCoin=BTC&limit=1').expect(200);
  expect(res.body.total).toBe(2);expect(JSON.stringify(res.body)).not.toMatch(/secret|token|must-be-stripped/);
  await request(app).get('/api/v1/market/options/tickers?baseCoin=BTC').expect(200);
  for(const q of ['limit=10000','baseCoin=../../x','expiry=bad','unexpected=1','baseCoin=BTC&baseCoin=ETH']) await request(app).get('/api/v1/market/options/instruments?'+q).expect(400);
  await request(app).get('/api/v1/market/options/tickers').expect(400);
  await request(app).get('/api/v1/market/options/tickers?baseCoin=UNKNOWN').expect(400);
  const down=express().use(marketOptionsRouter(null));await request(down).get('/market/options/instruments').expect(503);
  expect(feed.snapshot().rows).toEqual([]);internal.close();
});
