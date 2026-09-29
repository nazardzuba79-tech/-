import { createHash } from 'crypto';
import { VOLTORA, type TestAssetConfig } from '../testAssetConfig';
import { NEURIX } from '../neurix';
import { testMarketCandles } from '../testMarketService';
import { testMarketDepth } from '../testMarketDepth';
import {
  TestMarketSimulation, aggregateCandles, getCurrentTestMarketState, impulseRate, simulationFor,
  CANDLE_MS, DAY_MS, HOUR_MS, MINUTE_MS, TICK_MS, type SimCandle,
} from '../testMarketSimulation';
import {
  REALISM_PROFILES, SIMULATION_PROFILES, isSimulationProfile, profileForOrdinal, realisticHour, type SimulationProfile,
} from '../simulationRealism';

const L = VOLTORA.listingAt;
/** VTA's original scenario, without the later profile, cycle or wick overlays. */
const {
  simulationProfile: _vtaProfile, realismFrom: _vtaFrom,
  cyclicImpulse: _vtaCycle, wickBoostFrom: _vtaWicks, naturalWicks: _vtaNaturalWicks, ...BASE
} = VOLTORA;
const withProfile = (profile: SimulationProfile, extra: Partial<TestAssetConfig> = {}): TestAssetConfig => ({ ...BASE, simulationProfile: profile, ...extra });
/** Preserve the original Oct 1 profile-only activation contract independently of live VTA's new cycles. */
const ORIGINAL_PROFILE_VTA = withProfile('IMPULSE_TREND', { realismFrom: Date.parse('2026-10-01T00:00:00Z') });
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const anchors = (asset: TestAssetConfig, hours: number) =>
  Array.from({ length: hours + 1 }, (_, h) => new TestMarketSimulation(asset).priceAt(asset.listingAt + h * HOUR_MS) as number);

/**
 * Digests of the simulation BEFORE the realism layer existed, computed on
 * main 1e6d61db from the unmodified testMarketSimulation.ts:
 *   candles = sha256(JSON(candles5m(listing + 3d − 1)))
 *   anchors = sha256(JSON([priceAt(listing + h·1h) for h = 0…168]))  — each from a fresh simulation
 *   tape    = sha256(JSON(recentTrades(listing + 26h + 37s, 200)))
 */
const MAIN = {
  VTA: {
    candles: 'c529c9c00fd48e9589e69c42ab42e43fe54812d5e3acde9039e5ff9d0d632b86',
    anchors: '104cbf765ac8070cbe0a8cc5adf5ca7d11a7df75e3f7dc30c5c4d2db5ed46381',
    tape: '68a2cb3d3daac12a65878336dcc11996411f3af0c040dbb896d7bd98d20478af',
  },
  NRX: {
    candles: '747a97405c9d23e806e5a340ac9e11f729ab3210db7c882160bbcce6f490bba8',
    anchors: '332b421c524e7f5bcd5451799ad11da07ad737e6b0a49ac0c6eed81afe5f406b',
    tape: 'b233d56d5a122e600723630eba98ab596cf0bfc7dd1aee9f70d42fd7f309374f',
  },
};

describe('live VTA keeps its identity and opts into the owner\'s new cycle and wick behavior', () => {
  test('pair, seed, listing time and initial price are unchanged; the new controls are explicit', () => {
    expect(VOLTORA).toMatchObject({ pair: 'VTA/USDT', seed: 'voltora-2026-09-27', initialPrice: 0.01, simulationProfile: 'IMPULSE_TREND' });
    expect(new Date(VOLTORA.listingAt).toISOString()).toBe('2026-09-28T15:00:00.000Z');
    expect(VOLTORA.cyclicImpulse).toBeDefined();
    const cycle = VOLTORA.cyclicImpulse!;
    expect(cycle).toMatchObject({ anchorAt: Date.parse('2026-09-29T13:00:00Z'), periodHours: 6 });
    expect(Number.isFinite(cycle.notBefore)).toBe(true);
    expect(cycle.notBefore).toBeGreaterThanOrEqual(cycle.anchorAt);
    expect(cycle.notBefore).toBeLessThan(cycle.anchorAt + HOUR_MS);
    expect((cycle.notBefore - L) % TICK_MS).toBe(0);
    expect(Number.isFinite(VOLTORA.wickBoostFrom)).toBe(true);
    expect(Number.isFinite(VOLTORA.realismFrom)).toBe(true);
    expect(VOLTORA.wickBoostFrom).toBe(cycle.notBefore);
    expect(VOLTORA.realismFrom as number).toBeGreaterThanOrEqual(VOLTORA.wickBoostFrom as number);
    expect(((VOLTORA.realismFrom as number) - L) % HOUR_MS).toBe(0);
    expect(NEURIX.simulationProfile).toBeUndefined();
    expect(NEURIX.cyclicImpulse).toBeUndefined();
    expect(NEURIX.wickBoostFrom).toBeUndefined();
  });
});

describe('the original profile-only activation contract remains unchanged', () => {
  const B = ORIGINAL_PROFILE_VTA.realismFrom as number;
  const legacy = () => new TestMarketSimulation(BASE);
  const vta = () => new TestMarketSimulation(ORIGINAL_PROFILE_VTA);
  const fullProfile = () => new TestMarketSimulation(withProfile('IMPULSE_TREND'));

  test('the boundary is an hour anchor of the base simulation (listing + 57h)', () => {
    expect((B - L) / HOUR_MS).toBe(57);
    expect(vta().priceAt(B)).toBe(legacy().priceAt(B));
  });

  test('before it: every 5m and 1m candle, the tape, the book, the ticker state and the executable price are main\'s', () => {
    expect(vta().candles5m(B - 1)).toEqual(legacy().candles5m(B - 1));
    expect(vta().candles1m(B - 1, B - 6 * HOUR_MS)).toEqual(legacy().candles1m(B - 1, B - 6 * HOUR_MS));
    const a = vta(), b = legacy();
    // Every 37 s from the listing to the boundary: the price a private sale executes at (state.lastPrice).
    for (let t = L; t < B; t += 37_000) expect(a.priceAt(t)).toBe(b.priceAt(t));
    for (const t of [L + 3_600_123, L + 26 * HOUR_MS + 37_000, B - 1]) {
      expect(a.recentTrades(t, 200)).toEqual(b.recentTrades(t, 200));
      expect(testMarketDepth(a, t)).toEqual(testMarketDepth(b, t));
      expect(getCurrentTestMarketState(a, t)).toEqual(getCurrentTestMarketState(b, t));
    }
  });

  test('from it: the IMPULSE_TREND candles, with a seamless join', () => {
    const now = B + 9 * HOUR_MS + 123_456;
    expect(vta().candles5m(now, B)).toEqual(fullProfile().candles5m(now, B));
    expect(vta().candles5m(now, B)).not.toEqual(legacy().candles5m(now, B));
    const around = vta().candles5m(B + CANDLE_MS, B - CANDLE_MS);
    expect(around[0].close).toBe(around[1].open);
    expect(around[1].open).toBe(legacy().priceAt(B));
    // A 24h window across the boundary: its reference price is still main's.
    const state = getCurrentTestMarketState(vta(), B + 6 * HOUR_MS);
    expect(state.openPrice24h).toBe(legacy().priceAt(B - 18 * HOUR_MS));
    expect(state.high24h).toBeGreaterThanOrEqual(Math.max(state.lastPrice as number, state.openPrice24h as number));
  });

  test('a boundary inside an hour starts at the next hour; one before the listing means from the listing', () => {
    const mid = new TestMarketSimulation(withProfile('PULLBACK_TREND', { realismFrom: L + 10.5 * HOUR_MS }));
    const from = new TestMarketSimulation(withProfile('PULLBACK_TREND'));
    expect(mid.candles5m(L + 11 * HOUR_MS - 1, L + 10 * HOUR_MS)).toEqual(legacy().candles5m(L + 11 * HOUR_MS - 1, L + 10 * HOUR_MS));
    expect(mid.candles5m(L + 12 * HOUR_MS - 1, L + 11 * HOUR_MS)).toEqual(from.candles5m(L + 12 * HOUR_MS - 1, L + 11 * HOUR_MS));
    const early = new TestMarketSimulation(withProfile('PULLBACK_TREND', { realismFrom: L - DAY_MS }));
    expect(early.candles5m(L + 3 * HOUR_MS)).toEqual(from.candles5m(L + 3 * HOUR_MS));
  });
});

describe('without a profile the simulation is byte-identical to main', () => {
  test.each([['VTA', BASE, MAIN.VTA], ['NRX', NEURIX, MAIN.NRX]] as const)('%s: candles, hour anchors and tape', (_name, asset, expected) => {
    const sim = new TestMarketSimulation(asset);
    expect(sha(sim.candles5m(asset.listingAt + 3 * DAY_MS - 1))).toBe(expected.candles);
    expect(sha(anchors(asset, 168))).toBe(expected.anchors);
    expect(sha(sim.recentTrades(asset.listingAt + 26 * HOUR_MS + 37_000, 200))).toBe(expected.tape);
  });
});

describe('an isolated profile never moves the base trajectory', () => {
  test.each(SIMULATION_PROFILES)('%s: every hour anchor for 7 days is main\'s, bit for bit', (profile) => {
    expect(sha(anchors(withProfile(profile), 168))).toBe(MAIN.VTA.anchors);
  });

  test('P48 = 5.5234599 and P168 = 35171.298 for live VTA, every isolated profile and the original baseline', () => {
    for (const asset of [VOLTORA, BASE, ...SIMULATION_PROFILES.map((p) => withProfile(p))]) {
      const sim = new TestMarketSimulation(asset);
      expect(sim.priceAt(L + 48 * HOUR_MS)).toBe(5.5234599);
      expect(sim.priceAt(L + 168 * HOUR_MS)).toBe(35171.298);
    }
  });

  test('the regime schedule and every hour\'s return are the base simulation\'s', () => {
    const base = new TestMarketSimulation(BASE);
    for (const profile of SIMULATION_PROFILES) {
      const sim = new TestMarketSimulation(withProfile(profile));
      for (let hour = 0; hour < 168; hour++) {
        const a = sim.hourPlan(hour), b = base.hourPlan(hour);
        expect([a.regime, a.logReturn, a.open, a.boundaries[0], a.boundaries[12]]).toEqual([b.regime, b.logReturn, b.open, b.boundaries[0], b.boundaries[12]]);
      }
    }
  });

  test('on every hour boundary the price, the 24h reference and the 24h change agree across profiles', () => {
    const states = (asset: TestAssetConfig) => [24, 25, 36, 48, 60, 72, 100, 167].map((h) => getCurrentTestMarketState(new TestMarketSimulation(asset), L + h * HOUR_MS));
    const base = states(BASE);
    for (const profile of SIMULATION_PROFILES) {
      states(withProfile(profile)).forEach((state, i) => {
        expect(state.lastPrice).toBe(base[i].lastPrice);
        expect(state.openPrice24h).toBe(base[i].openPrice24h);
        expect(state.change24hPercent).toBe(base[i].change24hPercent);
      });
    }
  });

  test('1h, 4h and 1d candles open and close on the same prices; only their high/low may differ', () => {
    const now = L + 5 * DAY_MS;
    for (const interval of ['1h', '4h', '1d']) {
      const base = testMarketCandles(BASE, interval, now, 200);
      for (const profile of SIMULATION_PROFILES) {
        const candles = testMarketCandles(withProfile(profile), interval, now, 200);
        expect(candles.map((c) => [c.time, c.open, c.close])).toEqual(base.map((c) => [c.time, c.open, c.close]));
      }
    }
  });
});

describe('what a profile does change: the inside of each hour', () => {
  test('every profile draws different 5m candles from the original and from each other', () => {
    const now = L + 12 * HOUR_MS;
    const digests = [BASE, ...SIMULATION_PROFILES.map((p) => withProfile(p))].map((asset) => sha(new TestMarketSimulation(asset).candles5m(now)));
    expect(new Set(digests).size).toBe(5);
  });

  test('realismSeedOffset re-rolls the look and keeps the anchors', () => {
    const shifted = withProfile('IMPULSE_TREND', { realismSeedOffset: 1 });
    expect(sha(new TestMarketSimulation(shifted).candles5m(L + 6 * HOUR_MS))).not.toBe(sha(new TestMarketSimulation(withProfile('IMPULSE_TREND')).candles5m(L + 6 * HOUR_MS)));
    expect(sha(anchors(shifted, 72))).toBe(sha(anchors(BASE, 72)));
  });
});

describe('determinism: pair + seed + profile + time → the same candles, always', () => {
  test.each(SIMULATION_PROFILES)('%s: fresh instances, a refresh and the shared cache agree', (profile) => {
    const now = L + 30 * HOUR_MS + 123_456;
    const a = new TestMarketSimulation(withProfile(profile));
    const first = a.candles5m(now);
    expect(new TestMarketSimulation(withProfile(profile)).candles5m(now)).toEqual(first);
    expect(a.candles5m(now)).toEqual(first);
    expect(simulationFor(withProfile(profile)).candles5m(now)).toEqual(first);
    expect(new TestMarketSimulation(withProfile(profile)).candles1m(now, now - 3 * HOUR_MS))
      .toEqual(new TestMarketSimulation(withProfile(profile)).candles1m(now, now - 3 * HOUR_MS));
  });

  test('a restarted process (fresh module state) gives the same history', () => {
    const now = (VOLTORA.realismFrom as number) + 5 * HOUR_MS + 55_000;
    const here = new TestMarketSimulation(VOLTORA).candles5m(now);
    let restarted: SimCandle[] = [];
    jest.isolateModules(() => {
      const fresh = require('../testMarketSimulation') as typeof import('../testMarketSimulation');
      const config = require('../testAssetConfig') as typeof import('../testAssetConfig');
      restarted = new fresh.TestMarketSimulation(config.VOLTORA).candles5m(now);
    });
    expect(restarted).toEqual(here);
  });

  test('history already shown never changes as time passes, and the forming candle never knows its future', () => {
    const asset = withProfile('IMPULSE_TREND');
    const sim = new TestMarketSimulation(asset);
    const early = sim.candles5m(L + 5 * HOUR_MS + 7_000);
    const later = new TestMarketSimulation(asset).candles5m(L + 9 * HOUR_MS);
    expect(later.slice(0, early.length - 1)).toEqual(early.slice(0, -1));
    const open = L + 7 * HOUR_MS + 4 * CANDLE_MS;
    const final = new TestMarketSimulation(asset).candles5m(open + CANDLE_MS, open)[0];
    for (let t = open; t < open + CANDLE_MS; t += 9_000) {
      const forming = sim.candles5m(t, open)[0];
      expect(forming.high).toBeLessThanOrEqual(final.high);
      expect(forming.low).toBeGreaterThanOrEqual(final.low);
      expect(sim.candles5m(Math.floor((t - open) / TICK_MS) * TICK_MS + open + TICK_MS - 1, open)[0]).toEqual(forming);
    }
  });
});

describe('every candle is possible, continuous and near its anchor line', () => {
  const seeds = ['voltora-2026-09-27', 'qax-20261001-synthetic', 'another-seed-000001'];
  test.each(SIMULATION_PROFILES)('%s over 7 days on three seeds', (profile) => {
    for (const seed of seeds) {
      const asset = withProfile(profile, { seed });
      const sim = new TestMarketSimulation(asset);
      const candles = sim.candles5m(L + 7 * DAY_MS - 1);
      expect(candles).toHaveLength(7 * 288);
      const maxWick = REALISM_PROFILES[profile].maxWick;
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        expect(c.openTime).toBe(L + i * CANDLE_MS);
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
        expect(c.low).toBeGreaterThan(0);
        expect([c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)).toBe(true);
        if (i > 0) expect(c.open).toBe(candles[i - 1].close);
        if (i < candles.length - 1) expect(c.volume).toBeGreaterThan(0);
        // No wick beyond the profile's limit (1e-6 for 8-digit rounding).
        expect(Math.log(c.high / Math.max(c.open, c.close))).toBeLessThanOrEqual(maxWick + 1e-6);
        expect(Math.log(Math.min(c.open, c.close) / c.low)).toBeLessThanOrEqual(maxWick + 1e-6);
      }
      // Inside an hour every close stays within max(|R|, 2.5 impulse steps) × 1.25 of the straight anchor line.
      for (let hour = 0; hour < 168; hour++) {
        const plan = sim.hourPlan(hour);
        const step = Math.log(1 + impulseRate(Math.floor(hour / 24) + 1)) / 12;
        const band = 1.25 * Math.max(Math.abs(plan.logReturn), 2.5 * step);
        for (let k = 0; k < 12; k++) {
          const linear = Math.log(plan.open) + (plan.logReturn * (k + 1)) / 12;
          expect(Math.abs(Math.log(candles[hour * 12 + k].close) - linear)).toBeLessThanOrEqual(band);
        }
      }
    }
  });
});

describe('every timeframe tells the same history under a profile', () => {
  test.each(SIMULATION_PROFILES)('%s: five 1m candles are exactly their 5m candle; 15m and 1h aggregate 5m', (profile) => {
    const now = L + 26 * HOUR_MS + 2 * MINUTE_MS + 25_000;
    const sim = new TestMarketSimulation(withProfile(profile));
    const five = sim.candles5m(now, L + 20 * HOUR_MS);
    const one = sim.candles1m(now, L + 20 * HOUR_MS);
    expect(one[0].openTime).toBe(L + 20 * HOUR_MS);
    for (let i = 1; i < one.length; i++) expect(one[i].open).toBe(one[i - 1].close);
    const groups = new Map<number, SimCandle[]>();
    for (const c of one) {
      const bucket = L + Math.floor((c.openTime - L) / CANDLE_MS) * CANDLE_MS;
      groups.set(bucket, [...(groups.get(bucket) ?? []), c]);
    }
    expect([...groups.keys()]).toEqual(five.map((c) => c.openTime));
    for (const c of five) {
      const members = groups.get(c.openTime) as SimCandle[];
      expect(members[0].open).toBe(c.open);
      expect(members[members.length - 1].close).toBe(c.close);
      expect(Math.max(...members.map((m) => m.high))).toBe(c.high);
      expect(Math.min(...members.map((m) => m.low))).toBe(c.low);
      expect(members.reduce((s, m) => s + m.volume, 0)).toBeCloseTo(c.volume, 2);
    }
    expect(one[one.length - 1].close).toBe(sim.priceAt(now));
    for (const interval of ['15m', '1h']) {
      const served = testMarketCandles(withProfile(profile), interval, now, 1000);
      const expected = aggregateCandles(new TestMarketSimulation(withProfile(profile)).candles5m(now), interval === '15m' ? 15 * MINUTE_MS : HOUR_MS);
      expect(served.map((c) => [c.time * 1000, c.open, c.high, c.low, c.close])).toEqual(
        expected.slice(-served.length).map((c) => [c.openTime, c.open, c.high, c.low, c.close]));
    }
  });
});

/** Character statistics over the first `hours` (log units, `step` = the day's impulse step per 5m candle). */
function character(asset: TestAssetConfig, hours = 168) {
  const sim = new TestMarketSimulation(asset);
  const candles = sim.candles5m(asset.listingAt + hours * HOUR_MS - 1);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  let impulseHours = 0, bigCandleHours = 0, longWicks = 0, redPairs = 0;
  const wickToBody: number[] = [], rangeRange: number[] = [];
  for (let hour = 0; hour < hours; hour++) {
    const plan = sim.hourPlan(hour);
    const step = Math.log(1 + impulseRate(Math.floor(hour / 24) + 1)) / 12;
    const hourCandles = candles.slice(hour * 12, hour * 12 + 12);
    const bodies = hourCandles.map((c) => Math.abs(Math.log(c.close / c.open)));
    if (plan.regime === 'impulse') {
      impulseHours++;
      if (Math.max(...bodies) >= 0.3 * Math.abs(plan.logReturn)) bigCandleHours++;
      let run = 0;
      for (const c of hourCandles) { run = c.close < c.open ? run + 1 : 0; if (run === 2) redPairs++; }
    }
    hourCandles.forEach((c, k) => {
      const wick = Math.max(Math.log(c.high / Math.max(c.open, c.close)), Math.log(Math.min(c.open, c.close) / c.low));
      wickToBody.push(wick / Math.max(bodies[k], 1e-9));
      if (wick >= Math.max(1.5 * bodies[k], 0.35 * step)) longWicks++;
      if (plan.regime === 'consolidation') rangeRange.push(Math.log(c.high / c.low) / step);
    });
  }
  return {
    /** Impulse hours whose largest candle carries ≥ 30% of the hour. */
    impulses: bigCandleHours / impulseHours,
    longWicks: longWicks / candles.length,
    wickToBody: median(wickToBody),
    /** Median candle range inside consolidation hours, in impulse steps. */
    rangeWidth: median(rangeRange),
    /** Two or more red candles in a row inside impulse hours: short pullbacks. */
    pullbacks: redPairs,
  };
}

describe('each profile has its own character (same base scenario, three seeds)', () => {
  const seeds = ['voltora-2026-09-27', 'qax-20261001-synthetic', 'another-seed-000001'];
  test.each(seeds)('seed %s', (seed) => {
    const [calm, impulse, pullback, compression] = SIMULATION_PROFILES.map((p) => character(withProfile(p, { seed })));
    // CALM_TREND: rare impulses, short shadows.
    expect(calm.impulses).toBeLessThan(0.35);
    expect(calm.wickToBody).toBeLessThan(Math.min(impulse.wickToBody, pullback.wickToBody, compression.wickToBody));
    expect(calm.longWicks).toBeLessThan(0.2);
    // IMPULSE_TREND: most trending hours carry a big impulse candle; long wicks appear.
    expect(impulse.impulses).toBeGreaterThan(0.75);
    expect(impulse.impulses).toBeGreaterThan(2.5 * calm.impulses);
    expect(impulse.longWicks).toBeGreaterThan(1.8 * calm.longWicks);
    // PULLBACK_TREND: the most counter-trend runs and long shadows.
    expect(pullback.pullbacks).toBeGreaterThan(Math.max(calm.pullbacks, compression.pullbacks));
    expect(pullback.longWicks).toBeGreaterThan(Math.max(calm.longWicks, impulse.longWicks, compression.longWicks));
    // COMPRESSION_BREAKOUT: the narrowest ranges and strong breakouts.
    expect(compression.rangeWidth).toBeLessThan(0.75 * Math.min(calm.rangeWidth, impulse.rangeWidth, pullback.rangeWidth));
    expect(compression.impulses).toBeGreaterThan(0.75);
  });

  test('VTA\'s profile on VTA\'s base scenario against the original candles: more impulses, more long wicks, more short pullbacks', () => {
    const before = character(BASE), after = character(withProfile('IMPULSE_TREND'));
    expect(after.impulses).toBeGreaterThan(2 * before.impulses);
    expect(after.longWicks).toBeGreaterThan(1.5 * before.longWicks);
    expect(after.pullbacks).toBeGreaterThan(before.pullbacks);
  });
});

describe('the realism layer on its own', () => {
  test('an hour\'s twelve steps always sum to its return; every wick starts and ends inside its candle', () => {
    for (const profile of SIMULATION_PROFILES) {
      for (let hour = 0; hour < 300; hour++) {
        const regime = (['impulse', 'consolidation', 'pullback'] as const)[hour % 3];
        const logReturn = regime === 'impulse' ? 0.1 + (hour % 7) * 0.03 : regime === 'pullback' ? -0.04 : 0.004 * ((hour % 5) - 2);
        const ctx = {
          seed: `ctx-${hour}`, offset: 0, hour, regime, logReturn, sigma: 0.004 + (hour % 4) * 0.004, trendStep: 0.0219,
          previousRegime: (['consolidation', 'impulse', 'pullback'] as const)[hour % 3], nextRegime: 'impulse' as const,
          params: REALISM_PROFILES[profile],
        };
        const hourShape = realisticHour(ctx);
        expect(hourShape.steps).toHaveLength(12);
        expect(Math.abs(hourShape.steps.reduce((a, b) => a + b, 0) - logReturn)).toBeLessThan(1e-12);
        for (const shape of hourShape.shapes) {
          for (const e of shape.excursions) {
            expect(e.peak - e.rise).toBeGreaterThanOrEqual(0);
            expect(e.peak + e.fall).toBeLessThanOrEqual(29);
            expect(e.height).toBeGreaterThan(0);
            expect(e.height).toBeLessThanOrEqual(REALISM_PROFILES[profile].maxWick);
          }
        }
        expect(realisticHour(ctx)).toEqual(hourShape);
      }
    }
  });
});

describe('profiles for future simulated listings rotate by creation order', () => {
  test('#1 CALM_TREND, #2 IMPULSE_TREND, #3 PULLBACK_TREND, #4 COMPRESSION_BREAKOUT, #5 CALM_TREND…', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(profileForOrdinal)).toEqual([
      'CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT', 'CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT',
    ]);
  });
  test.each([20, 50, 100])('%i listings: the cycle just continues', (count) => {
    const tally = new Map<string, number>();
    for (let n = 0; n < count; n++) tally.set(profileForOrdinal(n), (tally.get(profileForOrdinal(n)) ?? 0) + 1);
    expect(SIMULATION_PROFILES.map((p) => tally.get(p))).toEqual(SIMULATION_PROFILES.map((_, i) => Math.floor(count / 4) + (i < count % 4 ? 1 : 0)));
  });
  test('only the four names are profiles; an ordinal must be a non-negative integer', () => {
    for (const p of SIMULATION_PROFILES) expect(isSimulationProfile(p)).toBe(true);
    for (const v of ['calm_trend', 'RANDOM', '', null, undefined, 3]) expect(isSimulationProfile(v)).toBe(false);
    for (const n of [-1, 1.5, Number.NaN]) expect(() => profileForOrdinal(n)).toThrow(RangeError);
  });
});
