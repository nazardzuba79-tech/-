import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
import type { CfdQuote } from '../../services/marketData/cfd/CfdQuote';

const NOW=Date.UTC(2026,8,13,12,0,0);
const q=(provider:string,symbol='XAUUSD',over:Partial<CfdQuote>={}):CfdQuote=>({provider,symbol,providerSymbol:symbol,bid:100,ask:101,mid:100.5,last:100.5,
  providerTimestamp:NOW,fetchedAt:NOW,stale:false,status:'entitlement_required',referenceStatus:'available',entitlementVerified:false,executionAllowed:false,...over});
const src=(rows:CfdQuote[])=>({getQuotes:async()=>rows});
beforeEach(()=>jest.useFakeTimers().setSystemTime(NOW));afterEach(()=>jest.useRealTimers());

test('fresh public quote keeps display alive but cannot gain financial permissions',async()=>{
  const router=new CfdDisplayQuoteRouter([{id:'biquote',priority:10,source:src([q('biquote')])}],{now:()=>NOW});
  const row=(await router.getQuotes()).find(x=>x.symbol==='XAUUSD')!;
  expect(row).toMatchObject({provider:'biquote',last:100.5,status:'reference_only',stale:false,entitlementVerified:false,executionAllowed:false});
});

test('lower-priority reserve takes over display when first provider is absent',async()=>{
  const router=new CfdDisplayQuoteRouter([
    {id:'biquote',priority:10,source:src([])},
    {id:'deriv',priority:20,source:src([q('deriv')])},
  ],{now:()=>NOW});
  expect((await router.getQuotes()).find(x=>x.symbol==='XAUUSD')).toMatchObject({provider:'deriv',status:'reference_only'});
});

test('fresh financial primary always beats public display quote',async()=>{
  const router=new CfdDisplayQuoteRouter([{id:'biquote',priority:10,source:src([q('biquote')])}],{now:()=>NOW});
  const alternative=(await router.getQuotes()).find(x=>x.symbol==='XAUUSD')!;
  const primary=q('twelvedata','XAUUSD',{status:'live',entitlementVerified:true,executionAllowed:true});
  expect(router.choose(primary,alternative)).toBe(primary);
});

test('fresh public display replaces stale financial primary without changing the financial object',async()=>{
  const router=new CfdDisplayQuoteRouter([{id:'biquote',priority:10,source:src([q('biquote')])}],{now:()=>NOW});
  const alternative=(await router.getQuotes()).find(x=>x.symbol==='XAUUSD')!;
  const primary=q('twelvedata','XAUUSD',{providerTimestamp:NOW-180_000,fetchedAt:NOW-180_000,stale:true,status:'stale'});
  const chosen=router.choose(primary,alternative);
  expect(chosen.provider).toBe('biquote');expect(chosen.executionAllowed).toBe(false);expect(primary.provider).toBe('twelvedata');
});

test('older public history never overwrites newer primary history',()=>{
  const router=new CfdDisplayQuoteRouter([{id:'biquote',priority:10,source:src([])}],{now:()=>NOW});
  const primary=q('twelvedata','XAUUSD',{providerTimestamp:NOW-130_000,fetchedAt:NOW-130_000,stale:true,status:'stale'});
  const old=q('biquote','XAUUSD',{providerTimestamp:NOW-200_000,fetchedAt:NOW-200_000,stale:true,status:'stale'});
  expect(router.choose(primary,old)).toBe(primary);
});

test('wrong-symbol and future public rows are ignored',async()=>{
  const router=new CfdDisplayQuoteRouter([{id:'bad',priority:10,source:src([
    q('bad','EURUSD',{providerTimestamp:NOW+5000}),q('bad','XAUUSD',{providerTimestamp:NOW+5000})
  ])}],{now:()=>NOW});
  expect((await router.getQuotes()).find(x=>x.symbol==='XAUUSD')).toMatchObject({provider:'display-router',last:null,executionAllowed:false});
});
