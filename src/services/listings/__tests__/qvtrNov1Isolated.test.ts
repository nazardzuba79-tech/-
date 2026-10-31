import snapshot from '../../../../config/isolated/qvtr-source-20261031-refresh.json';
import { listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { buildQvtrNov1Isolated, previewQvtrNov1Price, NOV1_PEAK_AT, NOV1_CORRECTION_END, NOV1_REJOIN_AT } from '../qvtrNov1Isolated';

const source = parseListingConfig(snapshot.config);
const original = new TestMarketSimulation(listingSimulationConfig(source));
const t0 = Date.parse(snapshot.publicObservedAt);
const observed = {
  listingId: snapshot.listingId, version: snapshot.activeVersion, countdown: 'running' as const,
  source: 'simulation' as const, isTradable: false as const, serverTime: t0,
  lastPrice: snapshot.lastPrice,
};
const make = () => buildQvtrNov1Isolated(source, observed, t0 + 100);
test('1 November 08:00 Kyiv is 06:00 UTC: +3745% from listing, not anchor', () => {
  const r = make();
  expect(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(NOV1_PEAK_AT)).toBe('08:00');
  expect(.014 * (1 + 3745 / 100)).toBeCloseTo(.5383, 10);
  expect(previewQvtrNov1Price(r, NOV1_PEAK_AT)).toBe(.5383);
  expect(previewQvtrNov1Price(r, t0)).toBe(snapshot.lastPrice);
  expect(r.effectiveAt).toBeGreaterThan(t0);
  expect(r.effectiveAt % 10000).toBe(0);
  expect(previewQvtrNov1Price(r,r.effectiveAt)).toBe(r.modeledFutureAnchor);
  expect(r.modeledFutureAnchor).toBe(original.priceAt(r.effectiveAt));
  expect(r.scope).toBe('ISOLATED_QVTR_REVIEW_ONLY');
  expect(r.promotionAllowed).toBe(false);
});
test('40% correction after peak, then original WAVES 108h return and later endpoints', () => {
  const r = make();
  expect(.53830 * .60).toBeCloseTo(.32298, 10);
  expect(r.correctionStart).toBe(NOV1_PEAK_AT);
  expect(previewQvtrNov1Price(r, NOV1_CORRECTION_END)).toBe(.32298);
  expect(previewQvtrNov1Price(r, NOV1_REJOIN_AT)).toBe(.352);
  const listing = Date.parse(source.listingAt);
  for (const [h,price] of [[132,.352],[204,.685],[228,.51],[300,.818]]) {
    expect(previewQvtrNov1Price(r,listing+h*3600000)).toBe(price);
  }
});
test('past price history is entirely unchanged, never a rewind', () => {
  const r=make();
  for(let time=t0-6*3600000;time<=r.effectiveAt;time+=60000)
    expect(previewQvtrNov1Price(r,time)).toBe(original.priceAt(time));
  for(let time=t0+60000;time<=NOV1_CORRECTION_END;time+=300000) {
    const price=previewQvtrNov1Price(r,time);
    expect(price).not.toBeNull();
    expect(price!).toBeGreaterThan(0);
    expect(price!).toBeLessThanOrEqual(.88858);
  }
});
test('rejects stale, drift, after-deadline, trading or forged observations',()=>{
  expect(()=>buildQvtrNov1Isolated(source,observed,t0+5001)).toThrow('FRESH_OBSERVATION_REQUIRED');
  expect(()=>buildQvtrNov1Isolated(source,{...observed,serverTime:t0+2001},t0)).toThrow('FRESH_OBSERVATION_REQUIRED');
  expect(()=>buildQvtrNov1Isolated(source,{...observed,lastPrice:0.4},t0+100)).toThrow('SOURCE_PRICE_CHANGED');
  expect(()=>buildQvtrNov1Isolated(source,{...observed,version:2},t0+100)).toThrow('SOURCE_VERSION_DRIFT');
  expect(()=>buildQvtrNov1Isolated(source,{...observed,isTradable:true} as any,t0+100)).toThrow('SOURCE_VERSION_DRIFT');
  expect(()=>buildQvtrNov1Isolated(source,{...observed,serverTime:NOV1_PEAK_AT,lastPrice:.2},NOV1_PEAK_AT)).toThrow('TARGET_EXPIRED');
});
