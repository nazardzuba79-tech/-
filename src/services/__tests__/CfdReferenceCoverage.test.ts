import { CfdMarketDataService, CFD_INSTRUMENTS } from '../CfdMarketDataService';
import { CFD_REFERENCE_CATALOG } from '../marketData/cfd/catalog';
import { assertCfdOpenQuote } from '../marketData/cfd/CfdQuote';
import { CFD_DISPLAY_CATALOG } from '../../../frontend/src/lib/cfdPresentation';

const symbols = ['XAUUSD','XAGUSD','XPTUSD','XPDUSD','WTIUSD','XBRUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'];
function harness(options: Record<string, unknown> = {}) {
  let now = Date.UTC(2026,8,12), outage = false;
  const bad = new Map<string, unknown>();
  const calls: {at:number; symbols:string[]}[] = [];
  const fetchFn = jest.fn(async (url: any) => {
    const requested = new URL(String(url)).searchParams.get('symbol')!.split(',');
    calls.push({at:now,symbols:requested});
    if (outage) throw Error('upstream secret body must not escape');
    return {ok:true,status:200,json:async()=>Object.fromEntries(requested.map(s=>[s,
      bad.has(s) ? bad.get(s) : {symbol:s,close:'123.456789',timestamp:now/1000,is_market_open:true}]))} as Response;
  });
  const service = new CfdMarketDataService('test-secret',fetchFn,undefined,{retries:0},{now:()=>now,...options});
  return {service,calls,bad,advance:(ms:number)=>{now+=ms;},fail:()=>{outage=true;}};
}
beforeEach(()=>jest.spyOn(console,'warn').mockImplementation(()=>{}));
afterEach(()=>jest.restoreAllMocks());

test('all 13 verified identities exist without key, entitlement or execution approval', async()=>{
  expect(CFD_INSTRUMENTS.map(i=>i.symbol)).toEqual(symbols);
  expect(CFD_REFERENCE_CATALOG.map(i=>i.symbol)).toEqual(symbols);
  expect(CFD_DISPLAY_CATALOG.map(i=>i.symbol)).toEqual(symbols);
  const rows = await new CfdMarketDataService(undefined).getQuotes();
  expect(rows.map(q=>q.symbol)).toEqual(symbols);
  expect(rows.every(q=>q.last===null && q.referenceStatus==='unavailable' && !q.executionAllowed)).toBe(true);
});
test('rotation fills all 13 in two cycles, uses 8 credits/minute and deduplicates callers',async()=>{
  const h=harness();
  await Promise.all(Array.from({length:50},()=>h.service.getQuotes()));
  expect(h.calls).toHaveLength(1);expect(h.calls[0].symbols).toHaveLength(8);
  h.advance(59999);await h.service.getQuotes();expect(h.calls).toHaveLength(1);
  h.advance(1);const rows=await h.service.getQuotes();
  expect(rows).toHaveLength(13);expect(rows.every(q=>q.last===123.456789 && !q.executionAllowed)).toBe(true);
  for(const q of rows) expect(()=>assertCfdOpenQuote(q,q.symbol,5000)).toThrow();
  for(let n=0;n<20;n++) {h.advance(60000);await h.service.getQuotes();}
  for(const call of h.calls) expect(h.calls.filter(c=>c.at<=call.at && call.at-c.at<60000).reduce((n,c)=>n+c.symbols.length,0)).toBeLessThanOrEqual(8);
  expect(new Set(h.calls.slice(0,2).flatMap(c=>c.symbols))).toHaveProperty('size',13);
});
test.each([null,{}, {status:'error',message:'secret-body'}, {close:'0'}, {close:'NaN'}, {close:'-1'}, {close:true}, {close:'0x10'}])('bad symbol %p stays visible and cannot fabricate a price',async raw=>{
  const h=harness();h.bad.set('XAG/USD',raw);
  const rows=await h.service.getQuotes();
  expect(rows.find(q=>q.symbol==='XAGUSD')).toMatchObject({last:null,referenceStatus:'unavailable',executionAllowed:false});
  expect(rows.find(q=>q.symbol==='XAUUSD')!.last).toBe(123.456789);
  expect(JSON.stringify(rows)).not.toMatch(/test-secret|secret-body/);
  expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toMatch(/test-secret|secret-body/);
});
test('per-symbol last-good remains with original timestamps and stale state on later failure',async()=>{
  const h=harness();const gold=(await h.service.getQuotes())[0];
  h.advance(60000);h.bad.set('XAU/USD',{status:'error'});
  const rows=await h.service.getQuotes();
  expect(rows[0]).toMatchObject({last:gold.last,fetchedAt:gold.fetchedAt,referenceStatus:'stale'});
  expect(rows.find(q=>q.symbol==='USDCHF')).toMatchObject({referenceStatus:'available'});
  h.advance(180000);h.fail();
  expect((await h.service.getQuotes()).every(q=>q.last!==null && q.referenceStatus==='stale')).toBe(true);
});
test('daily cap prevents HTTP, keeps stale last-good, then resumes after rolling day',async()=>{
  const h=harness({creditsPerDay:13});await h.service.getQuotes();h.advance(60000);await h.service.getQuotes();
  expect(h.calls.map(c=>c.symbols.length)).toEqual([8,5]);
  h.advance(180000);const rows=await h.service.getQuotes();expect(h.calls).toHaveLength(2);
  expect(rows.every(q=>q.referenceStatus==='stale')).toBe(true);
  h.advance(86400000);await h.service.getQuotes();expect(h.calls).toHaveLength(3);
});
test('execution uses independent single-symbol requests and cannot exceed shared quota or expand whitelist',async()=>{
  const h=harness({entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD']});
  await Promise.all(Array.from({length:20},()=>h.service.getFreshQuote('XAUUSD')));
  expect(h.calls.map(c=>c.symbols.length)).toEqual([1]);
  await h.service.getQuotes();expect(h.calls.map(c=>c.symbols.length)).toEqual([1,7]);
  h.advance(6000);await expect(h.service.getFreshQuote('XAUUSD')).rejects.toThrow();
  await expect(h.service.getFreshQuote('XAGUSD')).rejects.toThrow();
  expect(h.calls).toHaveLength(2);
  expect(h.service.catalog().filter(q=>q.executionAllowed).map(q=>q.symbol)).toEqual(['XAUUSD']);
});
test('retries are metered before HTTP and configuration cannot raise the free-plan ceilings',async()=>{
  const calls=jest.fn(async()=>{throw Error('secret-header-body');});
  const service=new CfdMarketDataService('secret',calls,undefined,{sleep:async()=>{}},{creditsPerMinute:100,creditsPerDay:10000});
  await expect(service.getTickers()).rejects.toThrow('Failed to reach Twelve Data');
  expect(calls).toHaveBeenCalledTimes(1);
  expect((await service.diagnostics()).credits).toMatchObject({perMinute:8,perDay:800,minuteUsed:8});
});

test('JSON parse failures never expose provider body or key fragments',async()=>{
  const service=new CfdMarketDataService('hidden-key',jest.fn(async()=>({ok:true,status:200,json:async()=>{throw Error('hidden-key Authorization cookie private-body');}}) as unknown as Response),undefined,{retries:0});
  await expect(service.getTickers()).rejects.toThrow(/^CFD provider unavailable$/);
  const output=JSON.stringify(await service.diagnostics());
  expect(output).not.toMatch(/hidden-key|Authorization|cookie|private-body/);
  expect((await service.getQuotes()).every(q=>q.last===null)).toBe(true);
});
