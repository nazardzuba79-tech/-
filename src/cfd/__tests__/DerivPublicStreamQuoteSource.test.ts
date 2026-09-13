import { EventEmitter } from 'events';
import { DerivPublicStreamQuoteSource, discoverDerivSymbols, derivEpochMs } from '../../services/marketData/cfd/DerivPublicStreamQuoteSource';
import { CfdQuoteUnavailable } from '../../services/marketData/cfd/CfdQuote';
const NOW=Date.UTC(2026,8,14,12,0,0);
const active=()=>[
  ['frxEURUSD','EUR/USD','forex'],['frxGBPUSD','GBP/USD','forex'],['frxUSDJPY','USD/JPY','forex'],['frxAUDUSD','AUD/USD','forex'],['frxUSDCAD','USD/CAD','forex'],['frxUSDCHF','USD/CHF','forex'],['frxNZDUSD','NZD/USD','forex'],
  ['frxXAUUSD','Gold/USD','commodities'],['frxXAGUSD','Silver/USD','commodities'],['frxXPTUSD','Platinum/USD','commodities'],['frxXPDUSD','Palladium/USD','commodities'],
  ['provider-wti','US Oil','commodities'],['provider-brent','UK Brent Oil','commodities'],
].map(([underlying_symbol,underlying_symbol_name,market])=>({underlying_symbol,underlying_symbol_name,market,exchange_is_open:1}));
class FakeSocket extends EventEmitter{readyState=1;sent:string[]=[];send(v:string){this.sent.push(v);}close(){this.emit('close');}terminate(){this.emit('close');}removeAllListeners(){super.removeAllListeners();return this;}}

describe('Deriv public stream discovery',()=>{
  test('maps all 13 exact contracts without guessing oil identity',()=>{
    const d=discoverDerivSymbols(active());expect(d.mapped).toHaveLength(13);expect(d.missing).toEqual([]);expect(d.ambiguous).toEqual([]);
    expect(d.mapped.find(x=>x.voltexSymbol==='WTIUSD')).toMatchObject({providerSymbol:'provider-wti',providerName:'US Oil'});
    expect(d.mapped.find(x=>x.voltexSymbol==='XBRUSD')).toMatchObject({providerSymbol:'provider-brent',providerName:'UK Brent Oil'});
  });
  test('generic Oil/USD is not silently assigned to WTI or Brent',()=>{
    const rows=active().filter((x:any)=>!['provider-wti','provider-brent'].includes(x.underlying_symbol));rows.push({underlying_symbol:'oil-generic',underlying_symbol_name:'Oil/USD',market:'commodities',exchange_is_open:1});
    const d=discoverDerivSymbols(rows);expect(d.missing).toEqual(expect.arrayContaining(['WTIUSD','XBRUSD']));expect(d.mapped.find(x=>x.providerSymbol==='oil-generic')).toBeUndefined();
  });
  test('ambiguous names fail closed instead of picking one',()=>{
    const rows=active();rows.push({underlying_symbol:'second-wti',underlying_symbol_name:'US Oil',market:'commodities',exchange_is_open:1});
    const d=discoverDerivSymbols(rows);expect(d.ambiguous.find(x=>x.symbol==='WTIUSD')?.candidates).toEqual(['provider-wti','second-wti']);expect(d.mapped.find(x=>x.voltexSymbol==='WTIUSD')).toBeUndefined();
  });
  test('epoch seconds and milliseconds normalize, invalid values reject',()=>{expect(derivEpochMs(NOW/1000)).toBe(NOW);expect(derivEpochMs(NOW)).toBe(NOW);expect(derivEpochMs('bad')).toBeNull();});
});

describe('Deriv quote gating',()=>{
  test('shadow discovery never grants financial configuration or execution',async()=>{
    const socket=new FakeSocket(),source=new DerivPublicStreamQuoteSource({now:()=>NOW,shadow:true,socketFactory:()=>socket as any,reconnectBaseMs:99999});
    source.start();socket.emit('open');source.handleMessage(JSON.stringify({msg_type:'active_symbols',active_symbols:active()}));
    source.handleMessage(JSON.stringify({msg_type:'tick',tick:{symbol:'frxXAUUSD',quote:2000,bid:1999.9,ask:2000.1,epoch:NOW/1000}}));
    expect(source.isConfigured()).toBe(false);expect((await source.getQuotes()).find(q=>q.symbol==='XAUUSD')).toMatchObject({provider:'deriv',status:'entitlement_required',executionAllowed:false});
    await expect(source.getFreshQuote('XAUUSD')).rejects.toBeInstanceOf(CfdQuoteUnavailable);source.stop();
  });
  test('written-use evidence plus explicit entitlement makes a fresh discovered tick executable',async()=>{
    const socket=new FakeSocket(),source=new DerivPublicStreamQuoteSource({now:()=>NOW,financialUseEvidence:'permission-ticket-1',entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD'],socketFactory:()=>socket as any,reconnectBaseMs:99999});
    source.start();socket.emit('open');source.handleMessage(JSON.stringify({msg_type:'active_symbols',active_symbols:active()}));
    source.handleMessage(JSON.stringify({msg_type:'tick',tick:{symbol:'frxXAUUSD',quote:2000,bid:1999.9,ask:2000.1,epoch:NOW/1000}}));
    await expect(source.getFreshQuote('XAUUSD')).resolves.toMatchObject({provider:'deriv',last:2000,bid:1999.9,ask:2000.1,status:'live',entitlementVerified:true,executionAllowed:true});source.stop();
  });
  test('stale/future ticks fail closed',async()=>{
    for(const epoch of [(NOW-6000)/1000,(NOW+5000)/1000]){const socket=new FakeSocket(),source=new DerivPublicStreamQuoteSource({now:()=>NOW,financialUseEvidence:'p',entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD'],socketFactory:()=>socket as any,firstQuoteWaitMs:100,reconnectBaseMs:99999});source.start();socket.emit('open');source.handleMessage(JSON.stringify({msg_type:'active_symbols',active_symbols:active()}));source.handleMessage(JSON.stringify({msg_type:'tick',tick:{symbol:'frxXAUUSD',quote:2000,epoch}}));await expect(source.getFreshQuote('XAUUSD')).rejects.toBeInstanceOf(CfdQuoteUnavailable);source.stop();}
  });
  test('closed-market discovery never becomes executable even if a final tick is fresh',async()=>{
    const rows=active().map((r:any)=>r.underlying_symbol==='frxXAUUSD'?{...r,exchange_is_open:0}:r),socket=new FakeSocket();
    const source=new DerivPublicStreamQuoteSource({now:()=>NOW,financialUseEvidence:'p',entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD'],socketFactory:()=>socket as any,reconnectBaseMs:99999});source.start();socket.emit('open');source.handleMessage(JSON.stringify({msg_type:'active_symbols',active_symbols:rows}));source.handleMessage(JSON.stringify({msg_type:'tick',tick:{symbol:'frxXAUUSD',quote:2000,epoch:NOW/1000}}));expect((await source.getQuotes()).find(q=>q.symbol==='XAUUSD')).toMatchObject({status:'market_closed',executionAllowed:false});await expect(source.getFreshQuote('XAUUSD')).rejects.toBeInstanceOf(CfdQuoteUnavailable);source.stop();
  });
});
