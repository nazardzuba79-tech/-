import { createHash } from 'crypto';
import { VOLTORA } from '../testAssetConfig';
import { NEURIX } from '../neurix';
import { PROFILES, SIMULATION_PROFILES, profileForListingOrdinal, resolveCandleRealism, type SimulationProfile } from '../candleRealism';
import {
  TestMarketSimulation, aggregateCandles, getCurrentTestMarketState, CANDLE_MS, DAY_MS, HOUR_MS, TICK_MS, type SimCandle,
} from '../testMarketSimulation';
import type { TestAssetConfig } from '../testAssetConfig';

const L = VOLTORA.listingAt;
const base: TestAssetConfig = { ...VOLTORA, simulationProfile: undefined, candleRealism: undefined };
const plain = () => new TestMarketSimulation({ ...base, candleRealism: false });
const withProfile = (profile: SimulationProfile, asset: TestAssetConfig = base) => new TestMarketSimulation({ ...asset, simulationProfile: profile });
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('the model itself is untouched', () => {
  // Fingerprints of main (e17aa533) before this layer existed: 7 days of 5m candles and a 500-trade tape.
  test.each([
    [VOLTORA, '6bf8c26fe4397d6f13e53a37608a5cfb53d0c9fdf0110b82d5391f952cbd1bfe', '0a7fe44ad3bd51df9577a9040b16d25c3ab4a48f5a026f55f13f2e9c0cc1f001'],
    [NEURIX, '58841ae88fa158a69133c0d93a1b8b93e7ed4688b7f5609300de981aa7c26ec8', 'bdb01efcb5ff4493a5a3da3a7de75f1f75fb345d7b3d3cf68d43fcae9c288f38'],
  ])('with realism off, %s is byte-for-byte the previous model', (asset, candles, trades) => {
    const sim = new TestMarketSimulation({ ...asset, candleRealism: false });
    expect(sha(sim.candles5m(asset.listingAt + 7 * DAY_MS - 1))).toBe(candles);
    expect(sha(sim.recentTrades(asset.listingAt + 30 * HOUR_MS + 55_000, 500))).toBe(trades);
  });
});

describe.each(SIMULATION_PROFILES)('%s keeps the mathematics of the model', (profile) => {
  const reference = plain();
  const sim = withProfile(profile);

  test('every hour: same regime, same return, same open and close (7 days)', () => {
    for (let hour = 0; hour < 7 * 24; hour++) {
      const a = reference.hourPlan(hour), b = sim.hourPlan(hour);
      expect([b.regime, b.logReturn, b.open, b.boundaries[12]]).toEqual([a.regime, a.logReturn, a.open, a.boundaries[12]]);
      expect(sim.priceAt(L + hour * HOUR_MS)).toBe(reference.priceAt(L + hour * HOUR_MS));
    }
  });

  test('P48 and the price after a week are the model\'s; every closed hourly, 4h and daily open/close too', () => {
    const anchor = 0.01 * Math.pow(1.3, 25) * Math.pow(0.96, 6);
    expect(Math.abs((sim.priceAt(L + 48 * HOUR_MS) as number) / anchor - 1)).toBeLessThan(1e-6);
    expect(sim.priceAt(L + 7 * DAY_MS)).toBe(reference.priceAt(L + 7 * DAY_MS));
    const now = L + 7 * DAY_MS;
    for (const interval of [HOUR_MS, 4 * HOUR_MS, DAY_MS]) {
      const mine = aggregateCandles(sim.candles5m(now), interval).slice(0, -1);
      const theirs = aggregateCandles(reference.candles5m(now), interval).slice(0, -1);
      expect(mine.map((c) => [c.openTime, c.open, c.close])).toEqual(theirs.map((c) => [c.openTime, c.open, c.close]));
    }
  });

  test('24h change at whole hours is the model\'s; high/low are read off the drawn candles', () => {
    for (const hours of [12, 24, 36, 48, 75, 120]) {
      const at = L + hours * HOUR_MS;
      const mine = getCurrentTestMarketState(withProfile(profile), at), theirs = getCurrentTestMarketState(plain(), at);
      expect([mine.lastPrice, mine.openPrice24h, mine.change24hPercent]).toEqual([theirs.lastPrice, theirs.openPrice24h, theirs.change24hPercent]);
      const window = withProfile(profile).candles5m(at, at - DAY_MS);
      expect(mine.high24h).toBe(Math.max(...window.map((c) => c.high)));
      expect(mine.low24h).toBe(Math.min(...window.map((c) => c.low)));
    }
  });

  test('deterministic: the same seed and profile always draw the same candles; shown history never changes', () => {
    const now = L + 30 * HOUR_MS + 123_456;
    expect(withProfile(profile).candles5m(now)).toEqual(sim.candles5m(now));
    const early = withProfile(profile).candles5m(L + 5 * HOUR_MS);
    expect(withProfile(profile).candles5m(L + 9 * HOUR_MS).slice(0, early.length - 1)).toEqual(early.slice(0, -1));
  });

  test('every candle is possible and continuous; the tape stays inside its candle', () => {
    const candles = sim.candles5m(L + 7 * DAY_MS - 1);
    candles.forEach((c, i) => {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.low).toBeGreaterThan(0);
      if (i) expect(c.open).toBe(candles[i - 1].close);
    });
    const at = L + 30 * HOUR_MS + 55_000;
    const trades = sim.recentTrades(at, 300);
    expect(Number(trades[0].price)).toBe(sim.priceAt(at));
    for (const trade of trades) {
      const openTime = L + Math.floor((trade.timestamp - 1 - L) / CANDLE_MS) * CANDLE_MS;
      const candle = sim.candles5m(openTime + CANDLE_MS, openTime)[0];
      expect(Number(trade.price)).toBeGreaterThanOrEqual(candle.low);
      expect(Number(trade.price)).toBeLessThanOrEqual(candle.high);
    }
  });
});

describe('no future leaks: a long shadow appears only once its tick has passed', () => {
  test('every forming candle of 24 hours is a prefix of the final one', () => {
    const sim = withProfile('PULLBACK_TREND');
    for (let slot = 0; slot < 24 * 12; slot += 7) {
      const openTime = L + 10 * HOUR_MS + slot * CANDLE_MS;
      const final = sim.candles5m(openTime + CANDLE_MS, openTime)[0];
      let previous: SimCandle | null = null;
      for (let t = openTime; t < openTime + CANDLE_MS; t += TICK_MS) {
        const forming = sim.candles5m(t, openTime)[0];
        expect(forming.high).toBeLessThanOrEqual(final.high);
        expect(forming.low).toBeGreaterThanOrEqual(final.low);
        if (previous) { expect(forming.high).toBeGreaterThanOrEqual(previous.high); expect(forming.low).toBeLessThanOrEqual(previous.low); }
        previous = forming;
      }
    }
  });
});

describe('each profile has its own character (first 48h, bodies in units of the hour\'s model volatility)', () => {
  const stats = (sim: TestMarketSimulation) => {
    const reference = plain();
    const rows = sim.candles5m(L + 48 * HOUR_MS - 1).map((c, i) => {
      const plan = reference.hourPlan(Math.floor(i / 12));
      const top = Math.max(c.open, c.close), bottom = Math.min(c.open, c.close);
      return { regime: plan.regime, body: Math.abs(Math.log(c.close / c.open)) / plan.sigma, range: Math.log(c.high / c.low) / plan.sigma,
        upper: Math.log(c.high / top) / plan.sigma, lower: Math.log(bottom / c.low) / plan.sigma, up: c.close > c.open };
    });
    const pct = (f: (r: typeof rows[number]) => boolean, list = rows) => list.filter(f).length / list.length;
    const impulseHours = rows.filter((r) => r.regime === 'impulse');
    return {
      impulse: pct((r) => r.body > 3), quiet: pct((r) => r.range < 0.9),
      upperWick: pct((r) => r.upper > 1.5 && r.upper > 2 * r.body), lowerWick: pct((r) => r.lower > 1.5 && r.lower > 2 * r.body),
      counter: pct((r) => !r.up, impulseHours),
    };
  };
  const model = stats(plain());
  const by = Object.fromEntries(SIMULATION_PROFILES.map((p) => [p, stats(withProfile(p))])) as Record<SimulationProfile, ReturnType<typeof stats>>;

  test('every profile is livelier than the plain model: more quiet bars and more long shadows on both sides', () => {
    for (const p of SIMULATION_PROFILES) {
      expect(by[p].quiet).toBeGreaterThan(model.quiet * 3);
      expect(by[p].upperWick).toBeGreaterThan(model.upperWick);
      expect(by[p].lowerWick).toBeGreaterThan(model.lowerWick);
    }
  });
  test('CALM has the fewest impulses and shadows; IMPULSE and COMPRESSION have far more impulses', () => {
    for (const p of ['IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT'] as const) {
      expect(by.CALM_TREND.impulse).toBeLessThan(by[p].impulse);
      expect(by.CALM_TREND.upperWick + by.CALM_TREND.lowerWick).toBeLessThan(by[p].upperWick + by[p].lowerWick);
    }
    expect(by.IMPULSE_TREND.impulse).toBeGreaterThan(2.5 * model.impulse);
    expect(by.COMPRESSION_BREAKOUT.impulse).toBeGreaterThan(2.5 * model.impulse);
  });
  test('COMPRESSION_BREAKOUT has the most quiet bars; PULLBACK_TREND the most counter-trend bars and long shadows', () => {
    for (const p of ['CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND'] as const) expect(by.COMPRESSION_BREAKOUT.quiet).toBeGreaterThan(by[p].quiet);
    for (const p of ['CALM_TREND', 'IMPULSE_TREND', 'COMPRESSION_BREAKOUT'] as const) {
      expect(by.PULLBACK_TREND.counter).toBeGreaterThan(by[p].counter);
      expect(by.PULLBACK_TREND.upperWick + by.PULLBACK_TREND.lowerWick).toBeGreaterThan(by[p].upperWick + by[p].lowerWick);
    }
  });
});

describe('profiles are stable configuration, not a roll of the dice', () => {
  test('the N-th listing takes the N-th profile in a fixed cycle, however many listings there are', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(profileForListingOrdinal)).toEqual([
      'CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT',
      'CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT', 'CALM_TREND']);
    expect(profileForListingOrdinal(50)).toBe('IMPULSE_TREND');
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => profileForListingOrdinal(bad)).toThrow();
  });
  test('VTA is IMPULSE_TREND and NRX CALM_TREND, stored in their configuration; omitted → CALM_TREND; false → the plain model', () => {
    expect(VOLTORA.simulationProfile).toBe('IMPULSE_TREND');
    expect(NEURIX.simulationProfile).toBe('CALM_TREND');
    expect(resolveCandleRealism(undefined, undefined)).toEqual(PROFILES.CALM_TREND);
    expect(resolveCandleRealism('PULLBACK_TREND', { overrides: { wickSizeFactor: 1 } })).toEqual({ ...PROFILES.PULLBACK_TREND, wickSizeFactor: 1 });
    expect(resolveCandleRealism('IMPULSE_TREND', false)).toBeNull();
  });
  test('a different realism offset changes only the look, never an anchor', () => {
    const a = withProfile('IMPULSE_TREND');
    const b = new TestMarketSimulation({ ...base, simulationProfile: 'IMPULSE_TREND', candleRealism: { overrides: { realismSeedOffset: 'other' } } });
    expect(b.candles5m(L + 6 * HOUR_MS - 1)).not.toEqual(a.candles5m(L + 6 * HOUR_MS - 1));
    for (let h = 0; h <= 48; h++) expect(b.priceAt(L + h * HOUR_MS)).toBe(a.priceAt(L + h * HOUR_MS));
  });
});
