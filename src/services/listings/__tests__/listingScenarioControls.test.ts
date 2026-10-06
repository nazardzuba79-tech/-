import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { defaultScenarioControls, exactGainFromPrice, exactPriceFromGain, LISTING_SCENARIOS, type ScenarioControlsProgram } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, withStableProfile } from '../listingConfig';
import { aggregateCandles, DAY_MS, HOUR_MS, SIM_INTERVALS, simulationFor, TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { VOLTORA } from '../../testMarkets/testAssetConfig';
import { NEURIX } from '../../testMarkets/neurix';

const make = (program = defaultScenarioControls('0.80', 'WAVES')) => parseListingConfig({
  schemaVersion: 1, symbol: 'QADEMO', name: 'Проверка сценария', logo: null,
  initialPrice: '0.80', listingAt: '2027-01-11T15:00:00Z', displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: 'listing-controls-qa-v2', tradable: false,
  simulationProfile: 'COMPRESSION_BREAKOUT', wickModel: 'NATURAL_V1', simulationProgram: program,
});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value: ScenarioControlsProgram): ScenarioControlsProgram => JSON.parse(JSON.stringify(value));

describe('persisted version 2 controls use the existing canonical market pipeline', () => {
  test('decimal math uses the launch price, accepts comma, and never rounds a cap up', () => {
    expect(exactPriceFromGain('0,80', '1725')).toBe('14.6');
    expect(exactPriceFromGain('0.80', '9247')).toBe('74.776');
    expect(exactGainFromPrice('0.80', '74,776')).toBe('9247');
    expect(exactPriceFromGain('0.0000000001', '1725')).toBe('0.0000000018');
    expect(exactPriceFromGain('0.80', '9247.000000001')).toBe('74.776');
    expect(parseListingConfig({ ...make(), initialPrice: '0,80' }).initialPrice).toBe('0.80');
  });

  test('all ten paths differ with identical goals and identical fine controls', () => {
    const signatures = LISTING_SCENARIOS.map(scenario => {
      const program = defaultScenarioControls('0.80', 'WAVES'); program.scenario = scenario;
      const asset = listingSimulationConfig(make(program)), sim = new TestMarketSimulation(asset);
      expect(sim.priceAt(asset.listingAt + DAY_MS)).toBe(14.6);
      return hash(sim.candles5m(asset.listingAt + DAY_MS));
    });
    expect(new Set(signatures).size).toBe(10);
  });

  test('all preset defaults include both green and red candles, including calm growth', () => {
    for (const scenario of LISTING_SCENARIOS) {
      const asset = listingSimulationConfig(make(defaultScenarioControls('0.80', scenario)));
      const candles = new TestMarketSimulation(asset).candles5m(asset.listingAt + DAY_MS);
      expect(candles.some(c => c.close < c.open)).toBe(true);
      expect(candles.some(c => c.close > c.open)).toBe(true);
    }
  });

  test('canonical OHLC and tape never exceed exact cap, also after growth and after restart', () => {
    const asset = listingSimulationConfig(make()), sim = new TestMarketSimulation(asset), at = asset.listingAt;
    const candles = sim.candles5m(at + 14 * DAY_MS);
    expect(sim.priceAt(at)).toBe(.8);
    expect(sim.priceAt(at + DAY_MS)).toBe(14.6);
    expect(sim.priceAt(at + 2 * DAY_MS)).not.toBeCloseTo(14.6 * 18.25);
    for (const candle of candles) {
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.high).toBeLessThanOrEqual(74.776);
    }
    expect(candles.filter(c => c.close < c.open).length).toBeGreaterThan(100);
    expect(candles.filter(c => c.close > c.open).length).toBeGreaterThan(100);
    expect(candles.filter(c => c.high > Math.max(c.open, c.close) && c.low < Math.min(c.open, c.close)).length).toBeGreaterThan(1000);
    expect(candles.filter(c => c.high === 74.776)).toHaveLength(0);
    for (const interval of Object.values(SIM_INTERVALS).filter(ms => ms >= 300000)) {
      expect(aggregateCandles(candles, interval).every(c => c.high <= 74.776)).toBe(true);
    }
    for (const days of [7, 14, 365, 1000, 10000]) {
      const now = at + days * DAY_MS;
      const price = sim.priceAt(now)!;
      expect(price).toBeLessThan(74.776);
      expect(price).toBeGreaterThan(74.776 * .65);
      expect(new TestMarketSimulation(asset).priceAt(now)).toBe(price);
      expect(Number(sim.recentTrades(now, 1)[0].price)).toBe(price);
    }
  });

  test('one-minute and five-minute candles share extrema, body endpoints, and stream', () => {
    const asset = listingSimulationConfig(make()), sim = new TestMarketSimulation(asset), start = asset.listingAt;
    const minute = sim.candles1m(start + 6 * HOUR_MS - 1);
    const five = sim.candles5m(start + 6 * HOUR_MS - 1);
    // aggregateCandles intentionally accepts canonical 5m input; don't use its
    // 5m identity fast path on one-minute inputs when checking this invariant.
    const grouped = Array.from({ length: five.length }, (_, i) => {
      const members = minute.slice(i * 5, i * 5 + 5);
      return { openTime: members[0].openTime, open: members[0].open, close: members[members.length - 1].close,
        high: Math.max(...members.map(c => c.high)), low: Math.min(...members.map(c => c.low)) };
    });
    expect(grouped.map(({ openTime, open, close, high, low }) => ({ openTime, open, close, high, low })))
      .toEqual(five.map(({ openTime, open, close, high, low }) => ({ openTime, open, close, high, low })));
  });

  test('each advanced control changes generated data rather than remaining decorative', () => {
    const original = defaultScenarioControls('0.80', 'WAVES');
    const variants = [
      (p: ScenarioControlsProgram) => { p.pullbacks.frequency = 'rare'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.minDepthPercent = '4'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.maxDepthPercent = '14'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.durationMinutes = 90; },
      (p: ScenarioControlsProgram) => { p.candles.intensity = 'high'; },
      (p: ScenarioControlsProgram) => { p.candles.diversity = .1; },
      (p: ScenarioControlsProgram) => { p.candles.pauseFrequency = 'often'; },
      (p: ScenarioControlsProgram) => { p.wicks.length = 'pronounced'; },
      (p: ScenarioControlsProgram) => { p.wicks.longFrequency = 'often'; },
    ];
    const signature = (program: ScenarioControlsProgram) => {
      const asset = listingSimulationConfig(make(program));
      return hash(new TestMarketSimulation(asset).candles5m(asset.listingAt + DAY_MS));
    };
    const baseline = signature(original);
    for (const modify of variants) { const changed = clone(original); modify(changed); expect(signature(changed)).not.toBe(baseline); }
  });

  test('explicit growth, range, drawdown and recovery stages hit configured endpoints', () => {
    const program = defaultScenarioControls('0.8');
    program.stages = [{ type: 'growth', durationHours: 24, targetPrice: '14.6' }, { type: 'range', durationHours: 8, targetPrice: '14.6' }, { type: 'pullback', durationHours: 4, targetPrice: '10' }, { type: 'recovery', durationHours: 12, targetPrice: '30' }];
    const asset = listingSimulationConfig(make(program)), sim = new TestMarketSimulation(asset);
    let elapsed = 0;
    for (const stage of program.stages) { elapsed += stage.durationHours; expect(sim.priceAt(asset.listingAt + elapsed * HOUR_MS)).toBe(Number(stage.targetPrice)); }
  });

  test('a 24h-only growth stage ends in a permanent range', () => {
    const program = defaultScenarioControls('0.8', 'CALM', '1725', '74.776', 24);
    const asset = listingSimulationConfig(make(program)), sim = new TestMarketSimulation(asset);
    expect(program.stages).toHaveLength(1);
    expect(sim.priceAt(asset.listingAt + DAY_MS)).toBe(14.6);
    expect(sim.priceAt(asset.listingAt + 500 * DAY_MS)).toBeLessThan(16);
  });

  test('a ten-decimal maximum remains precise at every public price boundary', () => {
    const program = defaultScenarioControls('0.0008', 'LONG_WICKS', '1725', '0.0747760001', 48);
    const config = parseListingConfig({ ...make(), initialPrice: '0.0008', simulationProgram: program });
    const asset = listingSimulationConfig(config), sim = new TestMarketSimulation(asset);
    const candles = sim.candles5m(asset.listingAt + 4 * DAY_MS);
    expect(candles.every(c => c.high <= .0747760001)).toBe(true);
    expect(sim.priceAt(asset.listingAt + DAY_MS)).toBe(.0146);
  });

  test('invalid values, contradictory day-one targets and insufficient precision are rejected', () => {
    const invalid = [
      (p: ScenarioControlsProgram) => { p.maxPrice = '14'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.minDepthPercent = '9'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.maxDepthPercent = '61'; },
      (p: ScenarioControlsProgram) => { p.pullbacks.durationMinutes = 0; },
      (p: ScenarioControlsProgram) => { p.stages[0].durationHours = 25; },
      (p: ScenarioControlsProgram) => { p.stages[0].targetPrice = '15'; },
      (p: ScenarioControlsProgram) => { p.stages[1].targetPrice = '74.775'; },
      (p: ScenarioControlsProgram) => { p.stages[1].type = 'pullback'; },
      (p: ScenarioControlsProgram) => { p.stages[1].durationHours = 720; },
      (p: ScenarioControlsProgram) => { p.maxPrice = '999999999.1234567891'; },
      (p: ScenarioControlsProgram) => { p.candles.diversity = NaN; },
    ];
    for (const modify of invalid) { const program = defaultScenarioControls('0.8'); modify(program); expect(() => make(program)).toThrow(); }
    expect(() => parseListingConfig({ ...make(), initialPrice: '0.0000000001', simulationProgram: defaultScenarioControls('0.0000000001') })).toThrow('точность');
    expect(() => parseListingConfig({ ...make(), listingAt: '2027-01-11T15:00:01Z' })).toThrow('10 секунд');
    expect(() => parseListingConfig({ ...make(), tradable: true })).toThrow();
  });

  test('automatic choice pins deterministically, draft edits apply, published history remains immutable', () => {
    const original = make(defaultScenarioControls('0.8', 'AUTO'));
    const first = withStableProfile(original, null, 0);
    expect(first.simulationProgram?.kind).toBe('scenario-controls-v2');
    if (first.simulationProgram?.kind !== 'scenario-controls-v2') throw new Error('wrong program');
    expect(first.simulationProgram.scenario).not.toBe('AUTO');
    expect(withStableProfile(original, null, 0)).toEqual(first);
    const changed = clone(first.simulationProgram); changed.scenario = 'DEEP_RECOVERY';
    const draft = withStableProfile(make(changed), first, null);
    expect(draft.simulationProgram).toEqual(changed);
    expect(() => checkPublishable(draft, first, Date.parse(first.listingAt) + HOUR_MS)).toThrow();
    expect(() => withStableProfile({ ...first, simulationProgram: undefined }, first, null)).toThrow();
    expect(simulationFor(listingSimulationConfig(first))).not.toBe(simulationFor(listingSimulationConfig(draft)));
  });
});

test('legacy VTA, NRX and bounded AITH golden histories remain byte-identical to main 12388249', () => {
  const aith = parseListingConfig(JSON.parse(readFileSync(join(__dirname, '../../../../config/test-markets/aith.draft.json'), 'utf8')));
  const expected: Record<string, string> = { VTA: '2b09f7addfb5efddc24b504ce488b3789370dbbc3625a3e3b7a893187b9560c7', NRX: 'a98d2d120c3a671efb4dcd1e8a200ee5fa8fac50de8f5344d22884ece25c82b2', AITH: '1f0b0221e7f25ce8ce913c9c800e654bb31038079ebe41ff95a68132fd4303c0' };
  for (const asset of [VOLTORA, NEURIX, listingSimulationConfig(aith)]) {
    const sim = new TestMarketSimulation(asset);
    const values = [0, 1, 23, 24, 48, 72, 80, 168, 336].map(h => ({ h, c: sim.candles5m(asset.listingAt + h * HOUR_MS, asset.listingAt + h * HOUR_MS - HOUR_MS), p: sim.priceAt(asset.listingAt + h * HOUR_MS), t: sim.recentTrades(asset.listingAt + h * HOUR_MS, 2) }));
    expect(hash(values)).toBe(expected[asset.symbol]);
  }
});
