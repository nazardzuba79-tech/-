import { createHash } from 'crypto';
import { listingSimulationConfig, withStableProfile, type ListingConfig } from '../../listings/listingConfig';
import { VOLTORA, type TestAssetConfig } from '../testAssetConfig';
import { NEURIX } from '../neurix';
import { SIMULATION_PROFILES } from '../simulationRealism';
import { testMarketDepth } from '../testMarketDepth';
import { testMarketCandles } from '../testMarketService';
import {
  TestMarketSimulation, aggregateCandles, getCurrentTestMarketState, simulationFor,
  CANDLE_MS, DAY_MS, HOUR_MS, MINUTE_MS, TICK_MS, type SimCandle,
} from '../testMarketSimulation';

const L = Date.parse('2026-09-28T15:00:00Z');
const ANCHOR = Date.parse('2026-09-29T13:00:00Z');
const REVISION = Date.parse('2026-09-29T14:45:00Z');
const FUTURE_LISTING = Date.parse('2026-09-30T00:00:00Z');
const QUARTER = 15 * MINUTE_MS;

/** The exact deployed d2e98bb scenario, before the explicitly requested range revision. */
const PREVIOUS_VTA: TestAssetConfig = {
  symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', pair: 'VTA/USDT',
  isTestAsset: true, isTradable: false, listingArmed: true,
  listingAt: L, initialPrice: 0.01, seed: 'voltora-2026-09-27',
  simulationProfile: 'IMPULSE_TREND', realismFrom: Date.parse('2026-09-29T14:00:00Z'),
  cyclicImpulse: { anchorAt: ANCHOR, notBefore: Date.parse('2026-09-29T13:55:00Z'), periodHours: 6 },
  wickBoostFrom: Date.parse('2026-09-29T13:55:00Z'),
};
const revisedAsset = (extra: Partial<TestAssetConfig> = {}): TestAssetConfig => ({
  ...PREVIOUS_VTA, naturalWicks: { historicalUntil: REVISION, futureFrom: REVISION }, ...extra,
});
const withoutRanges = ({ naturalWicks: _ranges, ...asset }: TestAssetConfig): TestAssetConfig => asset;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unchanged = (candles: readonly SimCandle[]) => candles.map(({ high: _high, low: _low, ...rest }) => rest);
const ohlc = (candles: readonly SimCandle[]) => candles.map(({ openTime, open, high, low, close }) => ({ openTime, open, high, low, close }));
const changedRange = (candle: SimCandle, previous: SimCandle) => candle.high !== previous.high || candle.low !== previous.low;
const closed = (sim: TestMarketSimulation, now: number, interval = QUARTER, from = L) =>
  aggregateCandles(sim.candles5m(now, from), interval).filter(c => c.openTime + interval <= now);

function expectRangeBounds(after: readonly SimCandle[], before: readonly SimCandle[], maxLogWick: number) {
  expect(after).toHaveLength(before.length);
  after.forEach((c, i) => {
    const old = before[i];
    // Public prices have eight significant figures, including the body endpoints.
    const rounding = Math.max(old.high, c.high) * 2e-7;
    const ceiling = Math.max(old.high, Math.max(c.open, c.close) * Math.exp(maxLogWick));
    const floor = Math.min(old.low, Math.min(c.open, c.close) * Math.exp(-maxLogWick));
    expect(c.high).toBeGreaterThanOrEqual(old.high);
    expect(c.low).toBeLessThanOrEqual(old.low);
    expect(c.high).toBeLessThanOrEqual(ceiling + rounding);
    expect(c.low).toBeGreaterThanOrEqual(floor - rounding);
    expect(c.low).toBeGreaterThan(0);
    expect(Number.isFinite(c.high)).toBe(true);
  });
}

function listing(at: number, ordinal: number): ListingConfig {
  return withStableProfile({
    schemaVersion: 1, symbol: 'NWQ', name: 'Natural wick fixture', logo: null,
    initialPrice: '0.01', listingAt: new Date(at).toISOString(), displayTimeZone: 'UTC',
    ownerAllocation: '0', seedMode: 'manual', seed: 'natural-wick-fixture-20260929', tradable: true,
  }, null, ordinal);
}

describe('the requested VTA historical range revision is explicit and selective', () => {
  test('live VTA opts into only the requested wick policy, retaining its existing scenario identity', () => {
    expect(withoutRanges(VOLTORA)).toEqual({ ...PREVIOUS_VTA, listingArmed: VOLTORA.listingArmed });
    expect(VOLTORA.naturalWicks).toEqual({ historicalUntil: REVISION, futureFrom: REVISION });
    expect(NEURIX.naturalWicks).toBeUndefined();
  });

  test('exactly 44 of the 95 closed 15m bars change, deterministically choosing four of each ordinary eight', () => {
    const before = closed(new TestMarketSimulation(PREVIOUS_VTA), REVISION);
    const after = closed(new TestMarketSimulation(revisedAsset()), REVISION);
    expect(before).toHaveLength(95);
    expect(after).toHaveLength(95);
    const changed = after.map((c, i) => changedRange(c, before[i]));
    expect(changed.filter(Boolean)).toHaveLength(44);
    // The final seven closed quarters belong to the first two-hour impulse.
    // Its existing price extrema are kept. The ordinary 88 have 11 full groups.
    for (let offset = 0; offset < 88; offset += 8) expect(changed.slice(offset, offset + 8).filter(Boolean)).toHaveLength(4);
    expect(changed.slice(88).some(Boolean)).toBe(false);
    expect(closed(new TestMarketSimulation(revisedAsset()), REVISION)).toEqual(after);
    for (let i = 0; i < after.length; i++) {
      expect(after[i].high).toBeGreaterThanOrEqual(before[i].high);
      expect(after[i].low).toBeLessThanOrEqual(before[i].low);
      if (!changed[i]) expect(after[i]).toEqual(before[i]);
    }
  });

  test('only high/low change: every open, close and volume remains exact in past and future candles', () => {
    const before = new TestMarketSimulation(PREVIOUS_VTA);
    const after = new TestMarketSimulation(revisedAsset());
    for (const now of [REVISION, REVISION + 11 * HOUR_MS + 123_456]) {
      expect(unchanged(after.candles1m(now))).toEqual(unchanged(before.candles1m(now)));
      const oldFive = before.candles5m(now), newFive = after.candles5m(now);
      for (const interval of [CANDLE_MS, QUARTER, HOUR_MS, 4 * HOUR_MS, DAY_MS]) {
        expect(unchanged(aggregateCandles(newFive, interval))).toEqual(unchanged(aggregateCandles(oldFive, interval)));
      }
    }
    const start = ANCHOR + 2 * HOUR_MS;
    const end = ANCHOR + 6 * HOUR_MS;
    const oldFuture = closed(before, end, QUARTER, start);
    const future = closed(after, end, QUARTER, start);
    expect(future.some((c, i) => changedRange(c, oldFuture[i]))).toBe(true);
  });

  test('changed bars include upper, lower and unequal two-sided shadows with varied body-to-wick proportions', () => {
    const before = closed(new TestMarketSimulation(PREVIOUS_VTA), REVISION);
    const after = closed(new TestMarketSimulation(revisedAsset()), REVISION);
    const shapes = after.flatMap((c, i) => {
      const old = before[i];
      if (!changedRange(c, old)) return [];
      const upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
      const body = Math.abs(c.close - c.open);
      return [{ upper, lower, upperAdded: c.high - old.high, lowerAdded: old.low - c.low,
        wickToBody: Math.max(upper, lower) / Math.max(body, c.open * 1e-8) }];
    });
    // Broad distribution contracts, not a snapshot of one aesthetic tuning.
    expect(shapes.filter(s => s.upper > s.lower * 1.5).length).toBeGreaterThanOrEqual(10);
    expect(shapes.filter(s => s.lower > s.upper * 1.5).length).toBeGreaterThanOrEqual(10);
    expect(shapes.filter(s => s.upperAdded > 0 && s.lowerAdded === 0).length).toBeGreaterThanOrEqual(5);
    expect(shapes.filter(s => s.lowerAdded > 0 && s.upperAdded === 0).length).toBeGreaterThanOrEqual(5);
    expect(shapes.filter(s => s.upperAdded > 0 && s.lowerAdded > 0 && s.upperAdded !== s.lowerAdded).length).toBeGreaterThanOrEqual(10);
    expect(shapes.filter(s => s.wickToBody < 0.5).length).toBeGreaterThanOrEqual(5);
    expect(shapes.filter(s => s.wickToBody > 1).length).toBeGreaterThanOrEqual(8);
    expect(new Set(shapes.map(s => s.wickToBody.toFixed(2))).size).toBeGreaterThanOrEqual(25);
  });

  test('new ranges obey the profile cap and local 15m scale without shrinking existing extrema', () => {
    const before = new TestMarketSimulation(PREVIOUS_VTA), after = new TestMarketSimulation(revisedAsset());
    const end = L + 7 * DAY_MS;
    // IMPULSE_TREND's existing 0.11 log cap receives the agreed 25% model headroom.
    expectRangeBounds(after.candles5m(end), before.candles5m(end), 0.1375);
    const oldQuarters = closed(before, end), quarters = closed(after, end);
    quarters.forEach((c, i) => {
      const old = oldQuarters[i];
      const rounding = Math.max(c.high, old.high) * 2e-7;
      const maximumAddition = Math.min((old.high - old.low) * 0.75, Math.min(old.open, old.close) * 0.06);
      expect(c.high - old.high).toBeLessThanOrEqual(maximumAddition + rounding);
      expect(old.low - c.low).toBeLessThanOrEqual(maximumAddition + rounding);
    });
  });

  test('every historical executable tick price is preserved, as are future marks, tape and display depth', () => {
    const before = new TestMarketSimulation(PREVIOUS_VTA);
    const after = new TestMarketSimulation(revisedAsset());
    const oldPrices: (number | null)[] = [], prices: (number | null)[] = [];
    for (let now = L; now <= REVISION; now += TICK_MS) {
      oldPrices.push(before.priceAt(now));
      prices.push(after.priceAt(now));
    }
    expect(prices).toEqual(oldPrices);
    // Captured from unmodified d2e98bb before the new range runtime was written.
    // This also catches an accidental change shared by both candidate instances.
    expect(prices).toHaveLength(8551);
    expect(sha(prices)).toBe('acb6bca1cc789d367bf8cc8693d865f89ed78dc58657396fb6b589709c0aa3ac');
    for (const now of [L - 1, L, L + 37_000, L + 6 * HOUR_MS + 12_345, REVISION - 1, REVISION,
      REVISION + 39_123, ANCHOR + 6 * HOUR_MS + 49 * MINUTE_MS, L + 2 * DAY_MS + 123_456]) {
      expect(after.priceAt(now)).toBe(before.priceAt(now));
      expect(after.recentTrades(now, 500)).toEqual(before.recentTrades(now, 500));
      expect(testMarketDepth(after, now)).toEqual(testMarketDepth(before, now));
      const { high24h: _oldHigh, low24h: _oldLow, ...oldState } = getCurrentTestMarketState(before, now);
      const { high24h: _high, low24h: _low, ...state } = getCurrentTestMarketState(after, now);
      expect(state).toEqual(oldState);
    }
  });
});

describe('natural ranges remain one canonical, prefix-safe history', () => {
  test('nonaligned boundaries select only whole 15m buckets, leaving the intervening history unchanged', () => {
    const historicalUntil = L + 2 * HOUR_MS + 7 * MINUTE_MS;
    const futureFrom = L + 5 * HOUR_MS + 7 * MINUTE_MS;
    const asset = revisedAsset({ naturalWicks: { historicalUntil, futureFrom } });
    const before = closed(new TestMarketSimulation(PREVIOUS_VTA), L + 8 * HOUR_MS);
    const after = closed(new TestMarketSimulation(asset), L + 8 * HOUR_MS);
    const pastChanged: number[] = [], futureChanged: number[] = [];
    after.forEach((c, i) => {
      if (c.openTime + QUARTER > historicalUntil && c.openTime < futureFrom) expect(c).toEqual(before[i]);
      else if (changedRange(c, before[i])) (c.openTime < historicalUntil ? pastChanged : futureChanged).push(c.openTime);
    });
    expect(pastChanged).toHaveLength(4);
    expect(futureChanged.length).toBeGreaterThan(0);
    expect(Math.min(...futureChanged)).toBeGreaterThanOrEqual(L + 5 * HOUR_MS + QUARTER);
  });

  test('a future-only opt-in preserves every preceding completed tick and its forming-candle prefix', () => {
    const futureFrom = L + 3 * HOUR_MS + 7 * MINUTE_MS + 12_345;
    const sim = new TestMarketSimulation(revisedAsset({ naturalWicks: { futureFrom } }));
    const before = new TestMarketSimulation(PREVIOUS_VTA);
    const nextQuarter = L + 3 * HOUR_MS + QUARTER;
    for (const now of [futureFrom, nextQuarter - 1, nextQuarter]) {
      expect(sim.candles1m(now)).toEqual(before.candles1m(now));
      expect(sim.candles5m(now)).toEqual(before.candles5m(now));
    }
    sim.candles5m(L + 8 * HOUR_MS);
    expect(sim.candles5m(futureFrom)).toEqual(before.candles5m(futureFrom));
  });

  test('1m, 5m, 15m and 1h OHLC agree, including a partially formed revised candle', () => {
    const asset = revisedAsset();
    const sim = new TestMarketSimulation(asset);
    for (const now of [L + 87_654, L + 3 * HOUR_MS + 22 * MINUTE_MS + 34_567,
      REVISION, ANCHOR + 2 * HOUR_MS + 12 * MINUTE_MS + 34_567, ANCHOR + 7 * HOUR_MS + 34_567]) {
      const from = Math.max(L, Math.floor((now - 2 * HOUR_MS) / HOUR_MS) * HOUR_MS);
      const one = sim.candles1m(now, from), five = sim.candles5m(now, from);
      for (const size of [CANDLE_MS, QUARTER, HOUR_MS]) {
        const fromFive = aggregateCandles(five, size);
        fromFive.forEach(c => {
          const minutes = one.filter(m => m.openTime >= c.openTime && m.openTime < c.openTime + size);
          expect(minutes.length).toBeGreaterThan(0);
          expect([minutes[0].open, Math.max(...minutes.map(m => m.high)), Math.min(...minutes.map(m => m.low)), minutes[minutes.length - 1].close])
            .toEqual([c.open, c.high, c.low, c.close]);
          // Public 1m volumes have independent decimal rounding; it cannot affect OHLC.
          expect(Math.abs(minutes.reduce((total, m) => total + m.volume, 0) - c.volume)).toBeLessThanOrEqual(size / MINUTE_MS * 0.0001);
          expect(Math.abs(minutes.reduce((total, m) => total + m.quoteVolume, 0) - c.quoteVolume)).toBeLessThanOrEqual(size / MINUTE_MS * 0.01);
        });
      }
      for (const [interval, size] of [['5m', CANDLE_MS], ['15m', QUARTER], ['1h', HOUR_MS]] as const) {
        const publicCandles = testMarketCandles(asset, interval, now, 1000).filter(c => c.time * 1000 >= from);
        expect(publicCandles.map(({ time, volume: _volume, ...c }) => ({ openTime: time * 1000, ...c })))
          .toEqual(ohlc(aggregateCandles(five, size)));
      }
      expect(one[one.length - 1].close).toBe(sim.priceAt(now));
    }
  });

  test('a forming candle sees only completed ticks, even after later extremes are cached', () => {
    const asset = revisedAsset();
    const reference = new TestMarketSimulation(asset);
    const old = new TestMarketSimulation(PREVIOUS_VTA);
    const before = closed(old, REVISION);
    const selected = closed(reference, REVISION).filter((c, i) => changedRange(c, before[i])).slice(0, 4);
    expect(selected).toHaveLength(4);
    const cached = new TestMarketSimulation(asset);
    cached.candles5m(REVISION + 3 * DAY_MS);
    for (const quarter of selected) {
      let previous: SimCandle | undefined;
      for (let now = quarter.openTime; now < quarter.openTime + QUARTER; now += TICK_MS) {
        const forming = aggregateCandles(cached.candles5m(now, quarter.openTime), QUARTER)[0];
        const fresh = aggregateCandles(new TestMarketSimulation(asset).candles5m(now, quarter.openTime), QUARTER)[0];
        expect(forming).toEqual(fresh);
        expect(forming.high).toBeLessThanOrEqual(quarter.high);
        expect(forming.low).toBeGreaterThanOrEqual(quarter.low);
        expect(forming.volume).toBeLessThanOrEqual(quarter.volume);
        expect(aggregateCandles(cached.candles5m(now + TICK_MS - 1, quarter.openTime), QUARTER)[0]).toEqual(forming);
        if (previous) {
          expect(forming.high).toBeGreaterThanOrEqual(previous.high);
          expect(forming.low).toBeLessThanOrEqual(previous.low);
          expect(forming.volume).toBeGreaterThanOrEqual(previous.volume);
        } else {
          expect(forming).toMatchObject({ open: quarter.open, high: quarter.open, low: quarter.open, close: quarter.open, volume: 0 });
        }
        previous = forming;
      }
    }
  });

  test('completed revised history does not repaint on reload, later reads or cache eviction', () => {
    const asset = revisedAsset();
    const sim = simulationFor(asset);
    const expected = new TestMarketSimulation(asset).candles5m(REVISION);
    expect(sim.candles5m(REVISION)).toEqual(expected);
    sim.candles5m(REVISION + 3 * DAY_MS);
    expect(sim.candles5m(REVISION)).toEqual(expected);
    expect(new TestMarketSimulation(asset).candles5m(REVISION)).toEqual(expected);
    for (let i = 0; i < 65; i++) simulationFor({ ...asset, seed: `natural-wick-cache-eviction-${i}` });
    expect(simulationFor(asset)).not.toBe(sim);
    expect(simulationFor(asset).candles5m(REVISION)).toEqual(expected);
  });

  test('the cache distinguishes no policy and each historical/future boundary', () => {
    const asset = revisedAsset();
    const current = simulationFor(asset);
    expect(simulationFor(revisedAsset())).toBe(current);
    for (const naturalWicks of [undefined,
      { historicalUntil: REVISION - QUARTER, futureFrom: REVISION },
      { historicalUntil: REVISION, futureFrom: REVISION + QUARTER },
      { futureFrom: REVISION },
    ]) {
      const changed = { ...asset, naturalWicks };
      expect(simulationFor(changed)).not.toBe(current);
      expect(simulationFor(changed).candles5m(REVISION + 4 * HOUR_MS))
        .toEqual(new TestMarketSimulation(changed).candles5m(REVISION + 4 * HOUR_MS));
    }
  });
});

describe('existing impulses and simulations retain their contracts', () => {
  test('all ten two-hour impulse variants keep their exact OHLCV and traded extrema', () => {
    const before = new TestMarketSimulation(PREVIOUS_VTA);
    const after = new TestMarketSimulation(revisedAsset());
    const variants = new Set<string>();
    for (let cycle = 0; cycle < 10; cycle++) {
      const start = ANCHOR + cycle * 6 * HOUR_MS;
      const end = start + 2 * HOUR_MS;
      const old = closed(before, end, HOUR_MS, start), candles = closed(after, end, HOUR_MS, start);
      expect(candles).toEqual(old);
      expect(after.candles1m(end, start).filter(c => c.openTime < end))
        .toEqual(before.candles1m(end, start).filter(c => c.openTime < end));
      const [down, up] = candles;
      expect(up.open).toBe(down.close);
      expect(down.close).toBeLessThan(down.open);
      expect(up.close).toBeGreaterThan(up.open);
      expect(up.high).toBeGreaterThan(up.close);
      expect(Math.min(...after.recentTrades(start + HOUR_MS, 360).map(t => Number(t.price)))).toBe(down.low);
      expect(Math.max(...after.recentTrades(end, 360).map(t => Number(t.price)))).toBe(up.high);
      variants.add(`${(down.low / down.open).toFixed(5)}|${(down.close / down.open).toFixed(5)}|${(up.high / up.close).toFixed(5)}`);
      if (cycle === 0) {
        expect(down.low / down.open).toBeCloseTo(0.60, 6);
        expect(down.close / down.open).toBeCloseTo(0.80, 6);
      }
    }
    expect(variants.size).toBe(10);
    expect(after.priceAt(L + 48 * HOUR_MS)).toBe(5.5234599);
    expect(after.priceAt(L + 168 * HOUR_MS)).toBe(35171.298);
  });

  test('NRX and configuration-off historical VTA keep their original golden histories', () => {
    // Live d2e98bb VTA, including its 13:55 cycle cutoff and forward wick boost.
    // These constants were captured from unchanged source before this revision.
    const deployed = new TestMarketSimulation(PREVIOUS_VTA);
    expect(sha(deployed.candles5m(L + 3 * DAY_MS - 1)))
      .toBe('b84f70475b978de0fe504d6d7f8b42dcfc10d901602efacdeeafd418e3516df7');
    expect(sha(new TestMarketSimulation(revisedAsset()).recentTrades(L + 26 * HOUR_MS + 37_000, 200)))
      .toBe('b65fc0ea7fa5197486d4e2795a55da3d04dcceca04c0f5fb9f82fedd9001461d');
    const nrx = new TestMarketSimulation(NEURIX);
    expect(sha(nrx.candles5m(NEURIX.listingAt + 3 * DAY_MS - 1)))
      .toBe('747a97405c9d23e806e5a340ac9e11f729ab3210db7c882160bbcce6f490bba8');
    expect(sha(nrx.recentTrades(NEURIX.listingAt + 26 * HOUR_MS + 37_000, 200)))
      .toBe('b233d56d5a122e600723630eba98ab596cf0bfc7dd1aee9f70d42fd7f309374f');
    const { simulationProfile: _profile, realismFrom: _from, cyclicImpulse: _cycle, wickBoostFrom: _boost, ...legacy } = PREVIOUS_VTA;
    expect(sha(new TestMarketSimulation(legacy).candles5m(L + 3 * DAY_MS - 1)))
      .toBe('c529c9c00fd48e9589e69c42ab42e43fe54812d5e3acde9039e5ff9d0d632b86');
  });

  test.each(SIMULATION_PROFILES)('new %s listings inherit the range policy without changing their price path', profile => {
    const ordinal = SIMULATION_PROFILES.indexOf(profile);
    const at = FUTURE_LISTING;
    const config = listing(at, ordinal);
    expect(config.simulationProfile).toBe(profile);
    expect(config.wickModel).toBe('NATURAL_V1');
    const asset = listingSimulationConfig(config);
    expect(asset.naturalWicks).toEqual({ futureFrom: at });
    const after = new TestMarketSimulation(asset), before = new TestMarketSimulation(withoutRanges(asset));
    const now = at + DAY_MS;
    const candles = after.candles5m(now), old = before.candles5m(now);
    expect(unchanged(candles)).toEqual(unchanged(old));
    const profileLimits = { CALM_TREND: 0.075, IMPULSE_TREND: 0.1375, PULLBACK_TREND: 0.16, COMPRESSION_BREAKOUT: 0.1125 };
    expectRangeBounds(candles, old, profileLimits[profile]);
    expect(candles.some((c, i) => changedRange(c, old[i]))).toBe(true);
    expect(after.recentTrades(now, 500)).toEqual(before.recentTrades(now, 500));
  });

  test('range behavior requires the persisted model; old profiles and legacy configs do not silently opt in', () => {
    const optedIn = listing(FUTURE_LISTING, 1);
    const { wickModel: _model, ...oldProfile } = optedIn;
    const { simulationProfile: _profile, ...legacy } = oldProfile;
    expect(listingSimulationConfig(oldProfile).naturalWicks).toBeUndefined();
    expect(listingSimulationConfig(legacy).naturalWicks).toBeUndefined();
    expect(listingSimulationConfig({ ...legacy, wickModel: 'NATURAL_V1' }).naturalWicks).toBeUndefined();
    const updated = withStableProfile({ ...oldProfile, wickModel: 'NATURAL_V1' }, oldProfile, 8);
    expect(updated.simulationProfile).toBe(oldProfile.simulationProfile);
    expect(updated.wickModel).toBeUndefined();
    expect(listingSimulationConfig(updated).naturalWicks).toBeUndefined();
    expect(listingSimulationConfig({ ...optedIn, listingAt: new Date(L).toISOString() }).naturalWicks).toEqual({ futureFrom: L });
  });
});
