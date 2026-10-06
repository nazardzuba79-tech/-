import { parseListingConfig, listingSimulationConfig, checkPublishable, withStableProfile } from '../listingConfig';
import { TestMarketSimulation, HOUR_MS, DAY_MS, simulationFor } from '../../testMarkets/testMarketSimulation';

const config = {
  schemaVersion: 1, symbol: 'AITH', name: 'Aitheron AI', logo: null,
  initialPrice: '0.80', listingAt: '2026-10-11T15:00:00Z', displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: 'aitheron-ai-20261011-v1', tradable: false,
  simulationProfile: 'COMPRESSION_BREAKOUT', wickModel: 'NATURAL_V1',
  simulationProgram: { kind: 'capped-growth-range-v1', first24hGainPercent: 1725, maxGainPercent: 9247, peakAfterHours: 168, rangeFraction: .12 },
};
test('published demo uses the bounded program and rejects real Spot execution', () => {
  const parsed = parseListingConfig(config);
  expect(listingSimulationConfig(parsed).scheduledScenario?.mode).toBe('capped-growth-range');
  expect(()=>parseListingConfig({...config,tradable:true})).toThrow();
});
test('AITH canonical OHLC, tape and restart stay bounded, varied, and hit the day-one target', () => {
  const asset=listingSimulationConfig(parseListingConfig(config));
  const sim=new TestMarketSimulation(asset), start=asset.listingAt, cap=74.776;
  expect(sim.priceAt(start)).toBe(.8);
  expect(sim.priceAt(start+DAY_MS)).toBeCloseTo(14.6,7);
  const candles=sim.candles5m(start+14*DAY_MS);
  expect(candles.length).toBeGreaterThan(4000);
  for(const c of candles){
    expect(c.high).toBeLessThanOrEqual(cap);
    expect(c.low).toBeGreaterThan(0);
    expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));
    expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));
  }
  expect(candles.filter(c=>c.close<c.open).length/candles.length).toBeGreaterThan(.25);
  expect(new Set(candles.map(c=>c.volume)).size).toBeGreaterThan(1000);
  expect(candles.filter(c=>c.high>Math.max(c.open,c.close)&&c.low<Math.min(c.open,c.close)).length).toBeGreaterThan(1000);
  for(const days of [7,14,30,365,1000]){
    const at=start+days*DAY_MS;
    expect(sim.priceAt(at)!).toBeLessThanOrEqual(cap);
    expect(sim.priceAt(at)!).toBeGreaterThan(cap*.5);
    expect(new TestMarketSimulation(asset).priceAt(at)).toBe(sim.priceAt(at));
    expect(Number(sim.recentTrades(at,1)[0].price)).toBe(sim.priceAt(at));
  }
  const changed=listingSimulationConfig(parseListingConfig({...config,simulationProgram:{...config.simulationProgram,maxGainPercent:9500}}));
  expect(simulationFor(asset)).not.toBe(simulationFor(changed));
});
test('program cannot silently change after publication and earlier listings retain their original program',()=>{
  const parsed=parseListingConfig(config);
  const changed=parseListingConfig({...config,simulationProgram:{...config.simulationProgram,maxGainPercent:9500}});
  expect(()=>checkPublishable(changed,parsed,Date.parse(config.listingAt)+HOUR_MS)).toThrow();
  const {simulationProgram,...legacy}=config;
  expect(listingSimulationConfig(parseListingConfig(legacy)).scheduledScenario).toBeUndefined();
  expect(withStableProfile(parseListingConfig(legacy),parsed,null).simulationProgram).toEqual(parsed.simulationProgram);
  expect(()=>withStableProfile(parseListingConfig({...legacy,tradable:true}),parsed,null)).toThrow('real trading');
});
