import fs from 'fs';
import path from 'path';
import ts from 'typescript';
const output:any={};let klineCallback:any=null;const originalWindow=(globalThis as any).window;
const source=fs.readFileSync(path.resolve(__dirname,'../futuresCandles.ts'),'utf8').replace('import.meta.env.VITE_API_URL',"'/api/v1'");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('exports','require',compiled)(output,(name:string)=>{
  if(name==='./futuresDepth')return {subscribeFuturesKline:(_pair:string,_interval:string,callback:any)=>{klineCallback=callback;return()=>{klineCallback=null;}}};
  throw new Error(`unexpected require ${name}`);
});
const {getFuturesCandles,parseFuturesCandles}=output;
const productionHost=()=>Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{location:{hostname:'voltextech.net'}}});
const frame = (symbol='1000PEPEUSDT') => ({retCode:0,result:{category:'linear',symbol,list:[
  ['1700000900000','0.0034','0.0035','0.0033','0.00345','0'],
  ['1700000000000','0.0033','0.0035','0.0032','0.0034','123'],
]}});
afterEach(()=>{jest.restoreAllMocks();klineCallback=null;if(originalWindow===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:originalWindow});});
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
test('requests Bybit candles directly with provider interval and no credentials',async()=>{
  productionHost();
  const mocked=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>frame()} as Response);
  const controller=new AbortController();const endTime=1700000900000;
  await getFuturesCandles('1000PEPE/USDT','4h',520,controller.signal,endTime);
  const [url,options]=mocked.mock.calls[0];const parsed=new URL(String(url));
  expect(parsed.hostname).toBe('api.bybit.com');
  expect(parsed.pathname).toBe('/v5/market/kline');
  expect(parsed.searchParams.get('category')).toBe('linear');
  expect(parsed.searchParams.get('symbol')).toBe('1000PEPEUSDT');
  expect(parsed.searchParams.get('interval')).toBe('240');
  expect(parsed.searchParams.get('end')).toBe(String(endTime));
  expect(options).toEqual({signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});
});
test('falls back only to Cloudflare edge when direct public Bybit hosts fail',async()=>{
  productionHost();
  const mocked=jest.spyOn(globalThis,'fetch').mockImplementation(async(url:any)=>{
    const host=new URL(String(url)).hostname;
    if(host==='api.bybit.com'||host==='api.bytick.com')return {ok:false,status:403,json:async()=>({})} as Response;
    if(host==='market.voltextech.net')return {ok:true,json:async()=>frame()} as Response;
    throw new Error('unexpected host');
  });
  await getFuturesCandles('1000PEPE/USDT','1h',320);
  expect(mocked).toHaveBeenCalledTimes(3);
  expect(new URL(String(mocked.mock.calls[2][0])).hostname).toBe('market.voltextech.net');
});
test('unsupported input does not make a network request',async()=>{
  const mocked=jest.spyOn(globalThis,'fetch');
  await expect(getFuturesCandles('BTC/USD','15m',520)).rejects.toThrow();
  await expect(getFuturesCandles('BTC/USDT','15m',520,undefined,-1)).rejects.toThrow();
  expect(mocked).not.toHaveBeenCalled();
});
test('Futures terminal display candles are not coupled to private execution auth',()=>{
  const page=fs.readFileSync(path.resolve(__dirname,'../../pages/FuturesPage.tsx'),'utf8');
  expect(page).not.toContain('candleLoader={nativeExecution?native.loader:undefined}');
  expect(page).toContain('privateTrading={nativeExecution ? native.interaction : undefined}');
});


test('reuses REST history while shared WebSocket updates the live candle',async()=>{
  productionHost();
  const mocked=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>frame()} as Response);
  const first=await getFuturesCandles('1000PEPE/USDT','15m',320);
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(typeof klineCallback).toBe('function');
  klineCallback({symbol:'1000PEPEUSDT',interval:'15m',time:1700003600,open:.00345,high:.0037,low:.0034,close:.0036,volume:55,confirm:false,updatedAt:1700003650000});
  const second=await getFuturesCandles('1000PEPE/USDT','15m',320);
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(second.candles[second.candles.length-1]).toEqual({time:1700003600,open:.00345,high:.0037,low:.0034,close:.0036,volume:55});
  expect(first.candles.length).toBeGreaterThan(0);
});
