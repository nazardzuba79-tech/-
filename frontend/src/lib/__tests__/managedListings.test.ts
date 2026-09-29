import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function mount() {
  const registry = new Map();
  const transport = jest.fn();
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../managedListings.ts'),'utf8')
    .replace('import.meta.env.VITE_MANAGED_LISTINGS_URL',JSON.stringify('https://fixture.invalid')),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports:any = {};
  new Function('require','exports','fetch','AbortSignal',code)(()=>({
    isManagedPair:(pair:string)=>registry.has(pair),
    rememberManaged:(pair:string,logo:string,name:string)=>registry.set(pair,{logo,name}),
  }),exports,transport,AbortSignal);
  return {api:exports,transport,registry};
}
const asset=(symbol:string)=>({symbol,pair:`${symbol}/USDT`,name:symbol,logo:'data:image/png;base64,fixture',
  isManagedListing:true,isTradable:false,listingAt:'2027-01-01T00:00:00Z'});
const response=(assets:unknown[])=>({ok:true,json:async()=>({serverTime:1000,assets})});

test('coalesces simultaneous readers but a later route discovers newly published identities',async()=>{
  const {api,transport,registry}=mount();
  transport.mockResolvedValueOnce(response([asset('QAONE')]));
  await Promise.all([api.ensureManagedDirectory(),api.ensureManagedDirectory()]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(registry.has('QAONE/USDT')).toBe(true);
  transport.mockResolvedValueOnce(response([asset('QAONE'),asset('QATWO')]));
  await api.ensureManagedDirectory();
  expect(transport).toHaveBeenCalledTimes(2);
  expect(registry.has('QATWO/USDT')).toBe(true);
});
test('failed bootstrap can retry; public reads omit account credentials and have a deadline',async()=>{
  const {api,transport}=mount();
  transport.mockRejectedValueOnce(new Error('offline'));
  await expect(api.ensureManagedDirectory()).rejects.toThrow('offline');
  transport.mockResolvedValueOnce(response([]));
  await api.ensureManagedDirectory();
  const [url,options]=transport.mock.calls[1];
  expect(url).toBe('https://fixture.invalid/market/managed-listings');
  expect(options.credentials).toBe('omit');expect(options.headers.Authorization).toBeUndefined();
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
test('malformed or legacy identities cannot be registered as factory assets',()=>{
  const {api,registry}=mount();
  expect(()=>api.registerManagedAssets({serverTime:1000,assets:[asset('QAONE'),asset('VTA')]})).toThrow();
  expect(registry.size).toBe(0);
});

test('factory discovers new listings before the earliest launch; fixed legacy listings remain quiet',async()=>{
  jest.useFakeTimers();
  try {
    const fetchPublic=jest.fn().mockResolvedValue({serverTime:Date.now(),assets:[{
      listingArmed:true,listingAt:new Date(Date.now()+86400_000).toISOString(),state:{phase:'pre-listing'},
    }]});
    const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../testMarketStore.ts'),'utf8')
      .replace('class TestMarketStore','export class TestMarketStore').replaceAll("import.meta.env.VITE_SIMULATION_PREVIEW",JSON.stringify('0')),
      {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports:any={};
    const documentFixture={hidden:false,addEventListener:jest.fn(),removeEventListener:jest.fn()};
    new Function('require','exports','document',code)((name:string)=>{
      if(name==='react')return {};
      if(name==='./api')return {API_BASE:'/api/v1'};
      if(name==='./managedListings')return {MANAGED_LISTINGS_BASE:'https://fixture.invalid',fetchManagedPublic:fetchPublic};
      if(name==='./nrxMarket')return {NRX_EDGE_BASE:'https://nrx.invalid'};
      if(name==='./testMarkets')return {parseTestMarkets:(body:unknown)=>body};
      throw Error(name);
    },exports,documentFixture);
    const dynamic=new exports.TestMarketStore('/market/managed-listings',true);
    const fixed=new exports.TestMarketStore('/market/managed-listings');
    const stopDynamic=dynamic.subscribe(()=>{},60000),stopFixed=fixed.subscribe(()=>{},60000);
    await Promise.all([dynamic.refresh(),fixed.refresh()]);expect(fetchPublic).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60001);expect(fetchPublic).toHaveBeenCalledTimes(3);
    stopDynamic();stopFixed();
    await jest.advanceTimersByTimeAsync(120000);expect(fetchPublic).toHaveBeenCalledTimes(3);
    fetchPublic.mockResolvedValue({serverTime:Date.now(),assets:[]});
    const empty=new exports.TestMarketStore('/market/managed-listings',true);
    const stopEmpty=empty.subscribe(()=>{},60000);
    await empty.refresh();expect(fetchPublic).toHaveBeenCalledTimes(4);
    documentFixture.hidden=true;
    await jest.advanceTimersByTimeAsync(60001);expect(fetchPublic).toHaveBeenCalledTimes(4);
    documentFixture.hidden=false;
    empty.onVisibility();await empty.refresh();expect(fetchPublic).toHaveBeenCalledTimes(5);
    stopEmpty();
  } finally {jest.useRealTimers();}
});
