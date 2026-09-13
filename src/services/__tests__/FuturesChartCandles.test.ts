import { FuturesChartCandles } from '../FuturesChartCandles';
const data={retCode:0,result:{symbol:'BTCUSDT',category:'linear',list:[]}};
const response=(value:unknown=data)=>({ok:true,json:async()=>value} as Response);
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
test('requests fixed public linear endpoint and exact symbol/interval',async()=>{
  const request=jest.fn().mockResolvedValue(response());await new FuturesChartCandles(request).get('BTC-USDT','4h',520);
  const [url,options]=request.mock.calls[0];const u=new URL(url);expect(u.hostname).toBe('api.bybit.com');
  expect(u.searchParams.get('symbol')).toBe('BTCUSDT');expect(u.searchParams.get('category')).toBe('linear');expect(u.searchParams.get('interval')).toBe('240');
  expect(options.signal).toBeDefined();expect(options.headers).toBeUndefined();
});
test('wrong product identity and failed HTTP response are unavailable',async()=>{
  const request=jest.fn().mockResolvedValue(response({...data,result:{...data.result,category:'spot'}}));const service=new FuturesChartCandles(request);
  await expect(service.get('BTC-USDT','15m',520)).rejects.toThrow();
  request.mockResolvedValueOnce({ok:false});await expect(service.get('BTC-USDT','15m',520)).rejects.toThrow();
});
