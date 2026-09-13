import fs from 'fs';
import path from 'path';
import ts from 'typescript';
const output:any={};
const source=fs.readFileSync(path.resolve(__dirname,'../futuresCandles.ts'),'utf8').replace('import.meta.env.VITE_API_URL',"'/api/v1'");
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output);
const {getFuturesCandles,parseFuturesCandles}=output;
const frame = (symbol='1000PEPEUSDT') => ({retCode:0,result:{category:'linear',symbol,list:[
  ['1700000900000','0.0034','0.0035','0.0033','0.00345','0'],
  ['1700000000000','0.0033','0.0035','0.0032','0.0034','123'],
]}});
afterEach(()=>jest.restoreAllMocks());
test('preserves exact tiny OHLC, zero volume, and chronological order',()=>{
  const {candles}=parseFuturesCandles(frame(),'1000PEPEUSDT');
  expect(candles.map((c:any)=>c.time)).toEqual([1700000000,1700000900]);
  expect(candles[1]).toEqual({time:1700000900,open:.0034,high:.0035,low:.0033,close:.00345,volume:0});
});
test.each(['PEPEUSDT','BTCUSDT'])('rejects a different contract %s',symbol=>{
  expect(()=>parseFuturesCandles(frame(symbol),'1000PEPEUSDT')).toThrow();
});
test('rejects Spot/category mismatch and provider error',()=>{
  expect(()=>parseFuturesCandles({...frame(),retCode:10001},'1000PEPEUSDT')).toThrow();
  const f=frame();f.result.category='spot';expect(()=>parseFuturesCandles(f,'1000PEPEUSDT')).toThrow();
});
test.each(['0','-1','NaN','Infinity',''])('rejects malformed price %s',price=>{
  const f=frame();f.result.list[0][1]=price;expect(()=>parseFuturesCandles(f,'1000PEPEUSDT')).toThrow();
});
test('rejects inconsistent OHLC and duplicate times',()=>{
  const f=frame();f.result.list[0][2]='0.001';expect(()=>parseFuturesCandles(f,'1000PEPEUSDT')).toThrow();
  const d=frame();d.result.list.push(d.result.list[0]);expect(()=>parseFuturesCandles(d,'1000PEPEUSDT')).toThrow();
});
test('requests linear candles with exact symbol/interval and abort signal, without credentials',async()=>{
  const mocked=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>frame()} as Response);
  const controller=new AbortController();await getFuturesCandles('1000PEPE/USDT','4h',520,controller.signal);
  const [url,options]=mocked.mock.calls[0];const parsed=new URL(String(url),'https://voltextech.net');
  expect(parsed.pathname).toBe('/api/v1/market/futures/candles/1000PEPE-USDT');
  expect(parsed.searchParams.get('interval')).toBe('4h');expect(options).toEqual({signal:controller.signal,credentials:'omit'});
});
test('never falls back on HTTP failure or unsupported input',async()=>{
  const mocked=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:false} as Response);
  await expect(getFuturesCandles('BTC/USDT','15m',520)).rejects.toThrow();expect(mocked).toHaveBeenCalledTimes(1);
  await expect(getFuturesCandles('BTC/USD','15m',520)).rejects.toThrow();expect(mocked).toHaveBeenCalledTimes(1);
});
