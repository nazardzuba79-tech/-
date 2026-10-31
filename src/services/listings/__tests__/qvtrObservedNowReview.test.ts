import snapshot from '../../../../config/isolated/qvtr-source-20261031-refresh.json';
import { admitQvtrNowReview, reviewQvtrNow, type QvtrObservation } from '../qvtrObservedNowReview';
import { listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { TestMarketSimulation, aggregateCandles, SIM_INTERVALS } from '../../testMarkets/testMarketSimulation';
import { QVTR_PEAK_AT, QVTR_CORRECTION_START, QVTR_CORRECTION_END } from '../qvtrIsolatedCandidate';
jest.setTimeout(120000);
const source=parseListingConfig(snapshot.config),t0=Date.parse(snapshot.publicObservedAt);
const observation:QvtrObservation={serverTime:t0,lastPrice:snapshot.lastPrice,listingId:snapshot.listingId,version:1,source:'simulation',isTradable:false};
const admin={id:'isolated-review-admin',role:'ADMIN' as const};
const record=admitQvtrNowReview(source,observation,admin,t0+1);
test('start is the actual admission instant and observed price, with no scheduled 18:30 Kyiv wait',()=>{
  expect(record.startAt).toBe(t0);expect(record.startAt).toBe(record.observation.serverTime);expect(record.admittedAt).toBe(t0+1);
  expect(record.candidate.anchor).toBe(observation.lastPrice);expect(record.startAt).not.toBe(Date.parse('2026-10-31T16:30Z'));
  expect(record.scope).toBe('OBSERVED_NOW_REVIEW_ONLY');expect(record.promotionAllowed).toBe(false);
});
test('authorization, stale/future/changed observation, missed deadline and tampered review fail closed',()=>{
  expect(()=>admitQvtrNowReview(source,observation,{id:'user',role:'USER'},t0)).toThrow('ADMIN_REQUIRED');
  expect(()=>admitQvtrNowReview(source,observation,admin,t0+5001)).toThrow('FRESH_OBSERVATION_REQUIRED');
  expect(()=>admitQvtrNowReview(source,{...observation,serverTime:t0+2001},admin,t0)).toThrow('FRESH_OBSERVATION_REQUIRED');
  expect(()=>admitQvtrNowReview(source,{...observation,lastPrice:.5},admin,t0)).toThrow('OBSERVATION_CHANGED_RETRY');
  expect(()=>admitQvtrNowReview(source,observation,admin,QVTR_PEAK_AT)).toThrow('TARGET_EXPIRED');
  expect(()=>reviewQvtrNow({...record,promotionAllowed:true} as any,t0,t0,'1m')).toThrow('REVIEW_NOT_PROMOTABLE');
  expect(()=>reviewQvtrNow({...record,sourceConfigSha256:'0'.repeat(64)},t0,t0,'1m')).toThrow('REVIEW_TAMPERED');
});
test('all completed history and every past-time forming query remain exact on four intervals',()=>{
  const base=new TestMarketSimulation(listingSimulationConfig(source));
  for(const interval of ['1m','5m','15m','1h'] as const){
    const first=Math.floor((t0-2*3600000)/SIM_INTERVALS[interval])*SIM_INTERVALS[interval];
    const original=interval==='1m'?base.candles1m(t0,first):aggregateCandles(base.candles5m(t0,first),SIM_INTERVALS[interval]);
    expect(reviewQvtrNow(record,t0,first,interval).candles).toEqual(original);
    const future=reviewQvtrNow(record,t0+600000,first,interval).candles;
    expect(future.filter(c=>c.openTime+SIM_INTERVALS[interval]<=t0)).toEqual(original.filter(c=>c.openTime+SIM_INTERVALS[interval]<=t0));
  }
  const first=Math.floor(t0/60000)*60000,old=base.candles1m(t0,first)[0],mixed=reviewQvtrNow(record,first+60000,first,'1m').candles[0];
  expect(mixed.open).toBe(old.open);expect(mixed.high).toBeGreaterThanOrEqual(old.high);expect(mixed.low).toBeLessThanOrEqual(old.low);
});
test('exact target/checkpoints, canonical intervals, cap and serialized reload',()=>{
  const first=Math.floor(t0/3600000)*3600000;
  const minutes=reviewQvtrNow(record,QVTR_CORRECTION_END,first,'1m').candles;
  for(const [at,price] of [[QVTR_PEAK_AT,.5383],[QVTR_CORRECTION_START,.5383],[QVTR_CORRECTION_END,.32298]])expect(minutes.find(c=>c.openTime===at)!.open).toBe(price);
  for(const c of minutes){expect(c.low).toBeGreaterThan(0);expect(c.high).toBeLessThanOrEqual(.88858);expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));}
  for(const interval of ['5m','15m','1h'] as const){
    const result=reviewQvtrNow(record,QVTR_CORRECTION_END,first,interval);
    const expected=interval==='5m'?minutes.filter((_,i)=>i%5===0).map((c,i)=>{const a=minutes.slice(i*5,i*5+5);return {...c,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a[a.length-1].close};}):aggregateCandles(minutes,SIM_INTERVALS[interval]);
    expect(result.candles.map(c=>[c.openTime,c.open,c.high,c.low,c.close])).toEqual(expected.map(c=>[c.openTime,c.open,c.high,c.low,c.close]));
  }
  expect(reviewQvtrNow(JSON.parse(JSON.stringify(record)),t0+600000,first,'1m')).toEqual(reviewQvtrNow(record,t0+600000,first,'1m'));
});
