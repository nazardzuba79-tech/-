import { LiveMarketStore } from '../liveMarketStore';
import { joinReferenceAssets, referenceValues } from '../referenceAssets';
import type { LiveQuote } from '../liveMarketTypes';
import type { CanonicalAsset } from '../api';

class Source {
  events = new Map<string, (e:any)=>void>(); onerror: any = null; closed = false;
  addEventListener(name:string, callback:any) { this.events.set(name,callback); }
  close() { this.closed=true; }
  send(type:string, rows:any[], revision=1, status='live') { this.events.get(type)?.({data:JSON.stringify({version:1,type,rows,revision,status,epoch:'test'})}); }
}
const quote = (index=0): LiveQuote => ({id:`spot:A${index}USDT`,pair:`A${index}/USDT`,symbol:`A${index}/USDT`,providerSymbol:`A${index}USDT`,provider:'bybit',marketType:'spot',
  baseAsset:`A${index}`,quoteAsset:'USDT',settleAsset:null,lastPrice:10,bidPrice:null,askPrice:null,high24h:null,low24h:null,volume24h:null,quoteVolume24h:0,
  changePercent24h:0,indexPrice:null,markPrice:null,fundingRate:null,fundingIntervalMinutes:null,openInterest:null,openInterestValue:null,
  providerEventAt:1,sequence:1,receivedAt:1,fetchedAt:1,stale:false});
const asset = (id='cg:one'): CanonicalAsset => ({ id,symbol:'A0',name:'Canonical One',logoUrl:'https://example.invalid/one.png',providers:{coingecko:'one'},tradingPairs:['A0/USD'],tradable:true,
  metadataSource:'coingecko',rank:1,ambiguous:false,collidingIds:[],market:{priceUsd:7,marketCapUsd:100,volume24hUsd:90,changePercent24h:2,circulatingSupply:10} });

describe('shared live reference store',()=>{
  beforeEach(()=>jest.useFakeTimers()); afterEach(()=>jest.useRealTimers());
  test('100 subscribers share one connection, 650 O(1) lookups create no requests; last unsubscribe cleans up',()=>{
    const source=new Source(), create=jest.fn(()=>source as any), store=new LiveMarketStore(create);
    const unsubs=Array.from({length:100},()=>store.subscribe(()=>{}));
    source.send('snapshot',Array.from({length:650},(_,i)=>quote(i)));
    for(let i=0;i<650;i++) expect(store.getState().rows.get(`spot:A${i}USDT`)?.lastPrice).toBe(10);
    expect(create).toHaveBeenCalledTimes(1); expect(store.getState().rows.size).toBe(650);
    source.send('delta',[{...quote(),lastPrice:0}],2); expect(store.getState().rows.get(quote().id)?.lastPrice).toBe(0);
    expect(store.getState().rows.get(quote(1).id)?.lastPrice).toBe(10);
    unsubs.forEach(fn=>fn()); expect(source.closed).toBe(true); expect(jest.getTimerCount()).toBe(0);
  });
  test('disconnect retains stale last-good; reconnect replaces snapshot and rejects stream gaps',()=>{
    const sources:Source[]=[];const store=new LiveMarketStore(()=>{const s=new Source();sources.push(s);return s as any;});const off=store.subscribe(()=>{});
    sources[0].send('snapshot',[quote()]);sources[0].onerror();
    expect(store.getState().rows.get(quote().id)).toMatchObject({lastPrice:10,stale:true});
    jest.advanceTimersByTime(1000);expect(sources).toHaveLength(2);
    sources[1].send('snapshot',[quote(1)],20);expect(store.getState().rows.has(quote().id)).toBe(false);
    sources[1].send('delta',[quote(2)],22);expect(sources[1].closed).toBe(true);expect(store.getState().rows.has(quote(2).id)).toBe(false);off();
  });
  test('disabled integration makes no repeated immediate connections and retains fallback eligibility',()=>{
    const s=new Source(), create=jest.fn(()=>s as any), store=new LiveMarketStore(create);const off=store.subscribe(()=>{});
    s.send('state',[],1,'disabled');expect(store.getState().status).toBe('disabled');
    jest.advanceTimersByTime(59_000);expect(create).toHaveBeenCalledTimes(1);off();expect(jest.getTimerCount()).toBe(0);
  });
  test('malformed numbers cannot become zero or contaminate last-good data',()=>{
    const s=new Source(),store=new LiveMarketStore(()=>s as any),off=store.subscribe(()=>{});s.send('snapshot',[quote()]);
    s.send('delta',[{...quote(),lastPrice:'bad'}],2);expect(store.getState().rows.get(quote().id)?.lastPrice).toBe(10);off();
  });
  test('reconnect cannot rewind same-epoch revision or provider timestamp; repeated failures clean up',()=>{
    const sources:Source[]=[];const store=new LiveMarketStore(()=>{const s=new Source();sources.push(s);return s as any;});const off=store.subscribe(()=>{});
    sources[0].send('snapshot',[{...quote(),providerEventAt:20}],10);sources[0].onerror();jest.advanceTimersByTime(1000);
    sources[1].send('snapshot',[quote()],9);expect(sources[1].closed).toBe(true);expect(store.getState().rows.get(quote().id)?.providerEventAt).toBe(20);
    jest.advanceTimersByTime(2000);sources[2].send('snapshot',[quote()],11);
    expect(store.getState().rows.get(quote().id)).toMatchObject({providerEventAt:20,stale:true});
    sources[2].send('delta',[{...quote(),providerEventAt:21,lastPrice:0}],12);
    expect(store.getState().rows.get(quote().id)).toMatchObject({providerEventAt:21,lastPrice:0,stale:false});
    for(let i=0;i<12;i++){sources.at(-1)!.onerror();jest.advanceTimersByTime(30000);expect(sources.filter(s=>!s.closed)).toHaveLength(1);}
    off();expect(sources.every(s=>s.closed)).toBe(true);expect(jest.getTimerCount()).toBe(0);
  });
});
describe('safe reference identity and financial separation',()=>{
  test('unique metadata joins, venue values remain separate, execution pairs and market cap stay unchanged',()=>{
    const original=asset(),joined=joinReferenceAssets([original],new Map([[quote().id,quote()]]))[0];
    expect(joined.id).toBe(original.id);expect(joined.market).toBe(original.market);expect(joined.tradingPairs).toBe(original.tradingPairs);
    expect(joined.tradable).toBe(true);expect(referenceValues(joined)).toMatchObject({price:10,change:0,volume:0,priceQuote:'USDT'});
    expect(joined.market?.marketCapUsd).toBe(100);
  });
  test.each(['duplicate','ambiguous','collidingIds'])('%s identity never acquires a guessed icon/name or execution permission',mode=>{
    const a=asset(); if(mode==='ambiguous')a.ambiguous=true;if(mode==='collidingIds')a.collidingIds=['cg:other'];
    const input=mode==='duplicate'?[a,asset('cg:other')]:[a];
    const rows=joinReferenceAssets(input,new Map([[quote().id,quote()]]));
    const provider=rows.find(a=>a.id==='bybit:A0')!;
    expect(provider).toMatchObject({name:'A0',logoUrl:null,market:null,rank:null,tradable:false,tradingPairs:[]});
    expect(rows.find(a=>a.id===input[0].id)?.liveQuote).toBeUndefined();
  });
  test('provider-only asset is honest; stale/null live fields fall back without fake zero',()=>{
    const rows=joinReferenceAssets([],new Map([[quote().id,quote()]]));expect(rows[0]).toMatchObject({name:'A0',logoUrl:null,market:null,tradable:false});
    const q={...quote(),stale:true}; const joined=joinReferenceAssets([asset()],new Map([[q.id,q]]))[0];
    expect(referenceValues(joined)).toMatchObject({price:7,change:2,volume:90,priceQuote:'USD'});
    expect(referenceValues({...rows[0],liveQuote:undefined})).toMatchObject({price:null,change:null,volume:null});
  });
});
