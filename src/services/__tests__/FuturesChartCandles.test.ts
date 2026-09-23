import { FuturesChartCandles } from '../FuturesChartCandles';
import requestApp from 'supertest';
import { collectorServer } from '../marketData/live/collectorServer';
import { LiveFeed } from '../marketData/live/contract';
const data={retCode:0,result:{symbol:'BTCUSDT',category:'linear',list:[]}};
const response=(value:unknown=data)=>({ok:true,json:async()=>value} as Response);

test('API candle transport uses authenticated collector only and rejects redirects',async()=>{
  const request=jest.fn().mockResolvedValue(response());
  const service=new FuturesChartCandles(request,Date.now,{url:'https://collector.example',token:'test-token'});
  await service.get('BTC-USDT','4h',520,1700000900000);
  expect(request).toHaveBeenCalledWith('https://collector.example/internal/v1/futures/candles/BTC-USDT?interval=4h&limit=520&endTime=1700000900000',expect.objectContaining({headers:{Authorization:'Bearer test-token'},redirect:'error'}));
  request.mockRejectedValue(new Error('offline'));
  await expect(service.get('BTC-USDT','1h',520)).rejects.toThrow('offline');
  expect(request.mock.calls.every(([url])=>String(url).startsWith('https://collector.example/'))).toBe(true);
});
test.each(['','http://remote.example','https://user:pass@collector.example','https://collector.example/path'])('invalid collector configuration cannot send credentials or fall back: %s',async url=>{
  const request=jest.fn();
  await expect(new FuturesChartCandles(request,Date.now,{url,token:'test-token'}).get('BTC-USDT','15m',520)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
test('collector candle endpoint requires auth and returns exact contract data',async()=>{
  const runtime=collectorServer(new LiveFeed('candles-test'),'test-token',()=>({}));
  const get=jest.spyOn(FuturesChartCandles.prototype,'get').mockResolvedValue(data);
  try {
    await requestApp(runtime.app).get('/internal/v1/futures/candles/BTC-USDT').expect(401);
    expect(get).not.toHaveBeenCalled();
    await requestApp(runtime.app).get('/internal/v1/futures/candles/BTC-USDT?interval=4h&limit=20&endTime=1700000900000').set('Authorization','Bearer test-token').expect(200,data);
    expect(get).toHaveBeenCalledWith('BTC-USDT','4h',20,1700000900000);
  } finally {get.mockRestore();runtime.close();}
});
test('same-key requests coalesce and cache expires without serving stale values',async()=>{
  let now=0;const request=jest.fn().mockResolvedValue(response());const service=new FuturesChartCandles(request,()=>now);
  await Promise.all([service.get('BTC-USDT','15m',520),service.get('BTC-USDT','15m',520)]);
  expect(request).toHaveBeenCalledTimes(1);
  await service.get('BTC-USDT','15m',520);expect(request).toHaveBeenCalledTimes(1);
  now=4001;request.mockRejectedValueOnce(new Error('offline'));
  await expect(service.get('BTC-USDT','15m',520)).rejects.toThrow('offline');
  await service.get('BTC-USDT','15m',520);expect(request).toHaveBeenCalledTimes(3);
});
test.each([['BTC/USD','15m',520],['BTC-USDT','invalid',520],['BTC-USDT','15m',1001],['BTC-USDT','15m',NaN]])('invalid input never reaches provider',async(pair,interval,limit)=>{
  const request=jest.fn();const service=new FuturesChartCandles(request);
  await expect(service.get(String(pair),String(interval),Number(limit))).rejects.toBeInstanceOf(RangeError);expect(request).not.toHaveBeenCalled();
});
test.each([-1,0,NaN,Infinity])('invalid historical boundary never reaches provider: %s',async endTime=>{
  const request=jest.fn();const service=new FuturesChartCandles(request);
  await expect(service.get('BTC-USDT','15m',520,endTime)).rejects.toBeInstanceOf(RangeError);expect(request).not.toHaveBeenCalled();
});
test('requests fixed public linear endpoint and exact symbol/interval',async()=>{
  const request=jest.fn().mockResolvedValue(response());await new FuturesChartCandles(request).get('BTC-USDT','4h',520);
  const [url,options]=request.mock.calls[0];const u=new URL(url);expect(u.hostname).toBe('api.bybit.com');
  expect(u.searchParams.get('symbol')).toBe('BTCUSDT');expect(u.searchParams.get('category')).toBe('linear');expect(u.searchParams.get('interval')).toBe('240');
  expect(options.signal).toBeDefined();expect(options.headers).toBeUndefined();
});
test('historical boundary is part of the cache identity and becomes Bybit end',async()=>{
  const request=jest.fn().mockResolvedValue(response());const service=new FuturesChartCandles(request);
  await service.get('BTC-USDT','1h',20,1700000000000);
  await service.get('BTC-USDT','1h',20,1700000000000);
  await service.get('BTC-USDT','1h',20,1700003600000);
  expect(request).toHaveBeenCalledTimes(2);
  const first=new URL(String(request.mock.calls[0][0])),second=new URL(String(request.mock.calls[1][0]));
  expect(first.searchParams.get('end')).toBe('1700000000000');
  expect(second.searchParams.get('end')).toBe('1700003600000');
});
test('wrong product identity and failed HTTP response are unavailable',async()=>{
  const request=jest.fn().mockResolvedValue(response({...data,result:{...data.result,category:'spot'}}));const service=new FuturesChartCandles(request);
  await expect(service.get('BTC-USDT','15m',520)).rejects.toThrow();
  request.mockResolvedValueOnce({ok:false});await expect(service.get('BTC-USDT','15m',520)).rejects.toThrow();
});
