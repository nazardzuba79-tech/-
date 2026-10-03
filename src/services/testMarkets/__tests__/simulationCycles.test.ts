import { createHash } from 'crypto';
import type { TestAssetConfig } from '../testAssetConfig';
import { NEURIX } from '../neurix';
import {
  TestMarketSimulation, aggregateCandles, getCurrentTestMarketState, simulationFor,
  CANDLE_MS, DAY_MS, HOUR_MS, MINUTE_MS, TICK_MS, type SimCandle,
} from '../testMarketSimulation';

const L = Date.parse('2026-09-28T15:00:00Z');
const ANCHOR = Date.parse('2026-09-29T13:00:00Z');
const CUTOFF = ANCHOR + 50 * MINUTE_MS;

/** Explicit pre-change fixture: changing the live VTA rollout must not redefine historical expectations. */
const BEFORE: TestAssetConfig = {
  symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', pair: 'VTA/USDT',
  isTestAsset: true, isTradable: false, listingArmed: true,
  listingAt: L, initialPrice: 0.01, seed: 'voltora-2026-09-27',
  simulationProfile: 'IMPULSE_TREND', realismFrom: Date.parse('2026-10-01T00:00:00Z'),
};

const withCycles = (extra: Partial<TestAssetConfig> = {}): TestAssetConfig => ({
  ...BEFORE,
  realismFrom: ANCHOR + HOUR_MS,
  cyclicImpulse: { anchorAt: ANCHOR, notBefore: CUTOFF, periodHours: 6 },
  wickBoostFrom: CUTOFF,
  ...extra,
});

/** Same intra-hour profile, with the new cycle and shadow layers disabled. */
const controlAsset = (): TestAssetConfig => ({
  ...withCycles(), cyclicImpulse: undefined, wickBoostFrom: undefined,
});

function hourCandle(sim: TestMarketSimulation, start: number): SimCandle {
  const five = sim.candles5m(start + HOUR_MS, start).filter((c) => c.openTime < start + HOUR_MS);
  expect(five).toHaveLength(12);
  return aggregateCandles(five, HOUR_MS)[0];
}

const ohlc = (candles: readonly SimCandle[]) => candles.map((c) => [c.openTime, c.open, c.high, c.low, c.close]);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('six-hour VTA impulse cycles', () => {
  test('the current hour falls 40% from its open and buys back half of that fall', () => {
    const sim = new TestMarketSimulation(withCycles());
    const before = new TestMarketSimulation(BEFORE);
    const down = hourCandle(sim, ANCHOR);
    expect(down.open).toBe(before.priceAt(ANCHOR));
    // Percentages are measured from the original hourly open, not the price at deployment.
    expect(down.low / down.open).toBeCloseTo(0.60, 6);
    expect(down.close / down.open).toBeCloseTo(0.80, 6);
    expect((down.close - down.low) / (down.open - down.low)).toBeCloseTo(0.50, 6);
    expect(down.close).toBeLessThan(down.open);
  });

  test('the next hour opens continuously, rises with an upper shadow and rejoins the baseline', () => {
    const sim = new TestMarketSimulation(withCycles());
    const control = new TestMarketSimulation(controlAsset());
    const down = hourCandle(sim, ANCHOR);
    const up = hourCandle(sim, ANCHOR + HOUR_MS);
    expect(up.open).toBe(down.close);
    expect(up.close).toBeGreaterThan(up.open);
    expect(up.high).toBeGreaterThan(up.close * 1.01);
    expect(up.close).toBe(control.priceAt(ANCHOR + 2 * HOUR_MS));
    expect(sim.priceAt(ANCHOR + 2 * HOUR_MS)).toBe(up.close);
    expect(sim.candles5m(ANCHOR + 2 * HOUR_MS, ANCHOR + 2 * HOUR_MS)[0].open).toBe(up.close);
  });

  test('ten consecutive cycles have different drops, recoveries and timings, with a positive recovery hour', () => {
    const sim = new TestMarketSimulation(withCycles());
    const control = new TestMarketSimulation(controlAsset());
    const shapes: string[] = [];
    const drops: string[] = [];
    const recoveries: string[] = [];
    const lowTimes = new Set<number>();
    const peakTimes = new Set<number>();
    for (let cycle = 0; cycle < 10; cycle++) {
      const start = ANCHOR + cycle * 6 * HOUR_MS;
      const down = hourCandle(sim, start);
      const up = hourCandle(sim, start + HOUR_MS);
      const drop = (1 - down.low / down.open).toFixed(4);
      const recovery = ((down.close - down.low) / (down.open - down.low)).toFixed(4);
      shapes.push(`${drop}|${recovery}|${(up.high / up.close).toFixed(4)}`);
      drops.push(drop);
      recoveries.push(recovery);
      expect(down.close).toBeLessThan(down.open);
      expect(down.low).toBeLessThan(down.close);
      expect(up.open).toBe(down.close);
      expect(up.close).toBeGreaterThan(up.open);
      expect(up.high).toBeGreaterThan(up.close * 1.01);
      expect(up.close).toBe(control.priceAt(start + 2 * HOUR_MS));
      const downTape = sim.recentTrades(start + HOUR_MS, 360);
      const upTape = sim.recentTrades(start + 2 * HOUR_MS, 360);
      const lowTrade = downTape.reduce((a, b) => Number(a.price) < Number(b.price) ? a : b);
      const highTrade = upTape.reduce((a, b) => Number(a.price) > Number(b.price) ? a : b);
      lowTimes.add(lowTrade.timestamp - start);
      peakTimes.add(highTrade.timestamp - start - HOUR_MS);
    }
    expect(new Set(shapes).size).toBe(10);
    expect(new Set(drops).size).toBeGreaterThanOrEqual(6);
    expect(new Set(recoveries).size).toBeGreaterThanOrEqual(6);
    expect(lowTimes.size).toBeGreaterThanOrEqual(4);
    expect(peakTimes.size).toBeGreaterThanOrEqual(4);
  });

  test('cycles start every six hours, repeat the ten variants, and leave the four intervening hours on their baseline', () => {
    const sim = new TestMarketSimulation(withCycles());
    const control = new TestMarketSimulation(controlAsset());
    for (let cycle = 0; cycle <= 10; cycle++) {
      const start = ANCHOR + cycle * 6 * HOUR_MS;
      for (const hour of [2, 3, 4, 5]) {
        for (const minute of [0, 7, 23, 49, 59]) {
          const now = start + hour * HOUR_MS + minute * MINUTE_MS + 12_345;
          expect(sim.priceAt(now)).toBe(control.priceAt(now));
        }
      }
    }
    const first = hourCandle(sim, ANCHOR);
    const repeat = hourCandle(sim, ANCHOR + 60 * HOUR_MS);
    expect(repeat.low / repeat.open).toBeCloseTo(first.low / first.open, 6);
    expect(repeat.close / repeat.open).toBeCloseTo(first.close / first.open, 6);
  });
});

describe('forward-only activation', () => {
  test('every pre-cutoff candle, tick price, trade and ticker is unchanged, including the cutoff itself', () => {
    const sim = new TestMarketSimulation(withCycles());
    const before = new TestMarketSimulation(BEFORE);
    expect(sim.candles5m(CUTOFF)).toEqual(before.candles5m(CUTOFF));
    expect(sim.candles1m(CUTOFF, ANCHOR - HOUR_MS)).toEqual(before.candles1m(CUTOFF, ANCHOR - HOUR_MS));
    for (let now = ANCHOR; now <= CUTOFF; now += TICK_MS) {
      expect(sim.priceAt(now)).toBe(before.priceAt(now));
    }
    for (const now of [L + 123_456, ANCHOR - 1, CUTOFF - 1, CUTOFF]) {
      expect(sim.recentTrades(now, 500)).toEqual(before.recentTrades(now, 500));
      expect(getCurrentTestMarketState(sim, now)).toEqual(getCurrentTestMarketState(before, now));
    }
  });

  test('a cutoff inside a forming 5m candle preserves its complete observed prefix, even after later candles are cached', () => {
    const cutoff = ANCHOR + 47 * MINUTE_MS + 23_456;
    const sim = new TestMarketSimulation(withCycles({
      cyclicImpulse: { anchorAt: ANCHOR, notBefore: cutoff, periodHours: 6 },
      wickBoostFrom: cutoff,
    }));
    const before = new TestMarketSimulation(BEFORE);
    const prefix = before.candles5m(cutoff, ANCHOR);
    expect(sim.candles5m(cutoff, ANCHOR)).toEqual(prefix);
    expect(sim.candles1m(cutoff, ANCHOR)).toEqual(before.candles1m(cutoff, ANCHOR));
    const nextTick = L + (Math.floor((cutoff - L) / TICK_MS) + 1) * TICK_MS;
    expect(sim.priceAt(nextTick - 1)).toBe(before.priceAt(nextTick - 1));
    sim.candles5m(ANCHOR + 8 * HOUR_MS, ANCHOR);
    expect(sim.candles5m(cutoff, ANCHOR)).toEqual(prefix);
    expect(sim.recentTrades(cutoff, 360)).toEqual(before.recentTrades(cutoff, 360));
    const later = sim.candles5m(ANCHOR + 2 * HOUR_MS, ANCHOR);
    expect(later.filter((c) => c.openTime + CANDLE_MS <= cutoff))
      .toEqual(prefix.filter((c) => c.openTime + CANDLE_MS <= cutoff));
  });

  test('a cutoff too late for the first shock does not invent its recovery or rewrite that hour', () => {
    const asset = withCycles({
      cyclicImpulse: { anchorAt: ANCHOR, notBefore: ANCHOR + HOUR_MS - 50_000, periodHours: 6 },
      wickBoostFrom: undefined,
    });
    const sim = new TestMarketSimulation(asset);
    const control = new TestMarketSimulation({ ...asset, cyclicImpulse: undefined });
    expect(sim.candles5m(ANCHOR + 2 * HOUR_MS, ANCHOR))
      .toEqual(control.candles5m(ANCHOR + 2 * HOUR_MS, ANCHOR));
    // The fixed six-hour schedule is retained; a later complete event can still run.
    const down = hourCandle(sim, ANCHOR + 6 * HOUR_MS);
    const up = hourCandle(sim, ANCHOR + 7 * HOUR_MS);
    expect(down.low).toBeLessThan(down.close);
    expect(down.close).toBeLessThan(down.open);
    expect(up.open).toBe(down.close);
    expect(up.close).toBe(control.priceAt(ANCHOR + 8 * HOUR_MS));
  });

  test('completed cycle candles do not repaint and a forming candle cannot reveal later extremes', () => {
    const sim = new TestMarketSimulation(withCycles());
    const earlyNow = CUTOFF + 3 * MINUTE_MS + 12_345;
    const early = sim.candles5m(earlyNow, ANCHOR);
    const later = new TestMarketSimulation(withCycles()).candles5m(ANCHOR + 8 * HOUR_MS, ANCHOR);
    expect(later.filter((c) => c.openTime + CANDLE_MS <= earlyNow))
      .toEqual(early.filter((c) => c.openTime + CANDLE_MS <= earlyNow));
    for (const start of [CUTOFF, ANCHOR + HOUR_MS + 10 * MINUTE_MS, ANCHOR + HOUR_MS + 45 * MINUTE_MS]) {
      const closed = sim.candles5m(start + CANDLE_MS, start)[0];
      let previous: SimCandle | undefined;
      for (let now = start; now < start + CANDLE_MS; now += TICK_MS) {
        const forming = sim.candles5m(now, start)[0];
        expect(forming.high).toBeLessThanOrEqual(closed.high);
        expect(forming.low).toBeGreaterThanOrEqual(closed.low);
        expect(forming.volume).toBeLessThanOrEqual(closed.volume);
        expect(sim.candles5m(now + TICK_MS - 1, start)[0]).toEqual(forming);
        if (previous) {
          expect(forming.high).toBeGreaterThanOrEqual(previous.high);
          expect(forming.low).toBeLessThanOrEqual(previous.low);
          expect(forming.volume).toBeGreaterThanOrEqual(previous.volume);
        }
        previous = forming;
      }
    }
  });
});

describe('one canonical path for charts, quotes and tape', () => {
  test('1m candles aggregate to 5m and 1h OHLC across the first shock, recovery, and partial next cycle', () => {
    const sim = new TestMarketSimulation(withCycles());
    for (const now of [CUTOFF + 23_456, ANCHOR + 2 * HOUR_MS, ANCHOR + 7 * HOUR_MS + 2 * MINUTE_MS + 25_000]) {
      const one = sim.candles1m(now, ANCHOR);
      const five = sim.candles5m(now, ANCHOR);
      const groups = new Map<number, SimCandle[]>();
      for (const candle of one) {
        const bucket = Math.floor(candle.openTime / CANDLE_MS) * CANDLE_MS;
        groups.set(bucket, [...(groups.get(bucket) ?? []), candle]);
      }
      expect([...groups.keys()]).toEqual(five.map((c) => c.openTime));
      for (const candle of five) {
        const members = groups.get(candle.openTime) as SimCandle[];
        expect([members[0].open, Math.max(...members.map((c) => c.high)), Math.min(...members.map((c) => c.low)), members[members.length - 1].close])
          .toEqual([candle.open, candle.high, candle.low, candle.close]);
        // Each public 1m volume is rounded independently; OHLC must agree exactly.
        expect(members.reduce((sum, c) => sum + c.volume, 0)).toBeCloseTo(candle.volume, 2);
        expect(Math.abs(members.reduce((sum, c) => sum + c.quoteVolume, 0) - candle.quoteVolume)).toBeLessThanOrEqual(0.031);
      }
      expect(ohlc(aggregateCandles(one, HOUR_MS))).toEqual(ohlc(aggregateCandles(five, HOUR_MS)));
      for (let i = 1; i < one.length; i++) expect(one[i].open).toBe(one[i - 1].close);
      expect(one[one.length - 1].close).toBe(sim.priceAt(now));
    }
  });

  test('the shock low and recovery high are traded prices, and every latest trade agrees with the ticker and chart', () => {
    const sim = new TestMarketSimulation(withCycles());
    const down = hourCandle(sim, ANCHOR);
    const up = hourCandle(sim, ANCHOR + HOUR_MS);
    expect(Math.min(...sim.recentTrades(ANCHOR + HOUR_MS, 360).map((t) => Number(t.price)))).toBe(down.low);
    expect(Math.max(...sim.recentTrades(ANCHOR + 2 * HOUR_MS, 360).map((t) => Number(t.price)))).toBe(up.high);
    for (const now of [CUTOFF, CUTOFF + TICK_MS, ANCHOR + HOUR_MS - TICK_MS, ANCHOR + HOUR_MS, ANCHOR + HOUR_MS + 37 * MINUTE_MS + 1234, ANCHOR + 2 * HOUR_MS]) {
      const lastPrice = sim.priceAt(now);
      const trades = sim.recentTrades(now, 80);
      expect(Number(trades[0].price)).toBe(lastPrice);
      expect(trades.every((trade) => trade.timestamp <= now)).toBe(true);
      expect(getCurrentTestMarketState(sim, now).lastPrice).toBe(lastPrice);
      expect(sim.candles1m(now, now).slice(-1)[0].close).toBe(lastPrice);
      expect(sim.candles5m(now, now).slice(-1)[0].close).toBe(lastPrice);
    }
  });

  test('fresh instances, request order and shared caches all reproduce identical history', () => {
    const asset = withCycles();
    const now = ANCHOR + 62 * HOUR_MS + 23_456;
    const sequential = new TestMarketSimulation(asset);
    for (const hour of [0, 1, 2, 6, 7, 12, 61]) sequential.candles5m(ANCHOR + hour * HOUR_MS, ANCHOR);
    const expected = new TestMarketSimulation(asset).candles5m(now, ANCHOR);
    expect(sequential.candles5m(now, ANCHOR)).toEqual(expected);
    expect(sequential.candles5m(now, ANCHOR)).toEqual(expected);
    expect(simulationFor(asset).candles5m(now, ANCHOR)).toEqual(expected);
    expect(new TestMarketSimulation(asset).recentTrades(now, 500)).toEqual(sequential.recentTrades(now, 500));
  });

  test('cache identity includes activation, anchor, cadence and the ordinary wick cutoff', () => {
    const asset = withCycles();
    const cached = simulationFor(asset);
    expect(simulationFor(withCycles())).toBe(cached);
    for (const changed of [
      withCycles({ cyclicImpulse: undefined }),
      withCycles({ cyclicImpulse: { ...asset.cyclicImpulse!, notBefore: CUTOFF + TICK_MS } }),
      withCycles({ cyclicImpulse: { ...asset.cyclicImpulse!, anchorAt: ANCHOR + HOUR_MS } }),
      withCycles({ cyclicImpulse: { ...asset.cyclicImpulse!, periodHours: 7 } }),
      withCycles({ wickBoostFrom: CUTOFF + TICK_MS }),
    ]) {
      expect(simulationFor(changed)).not.toBe(cached);
      expect(simulationFor(changed).candles5m(ANCHOR + 8 * HOUR_MS, ANCHOR))
        .toEqual(new TestMarketSimulation(changed).candles5m(ANCHOR + 8 * HOUR_MS, ANCHOR));
    }
  });
});

describe('ordinary shadows and unaffected simulations', () => {
  test('ordinary future candles gain shadows while their opens, closes and volumes remain unchanged', () => {
    const sim = new TestMarketSimulation(withCycles());
    const control = new TestMarketSimulation(controlAsset());
    const start = ANCHOR + 2 * HOUR_MS;
    const end = ANCHOR + 6 * HOUR_MS;
    const after = sim.candles5m(end, start).filter((c) => c.openTime < end);
    const before = control.candles5m(end, start).filter((c) => c.openTime < end);
    let larger = 0;
    after.forEach((candle, i) => {
      const old = before[i];
      expect([candle.openTime, candle.open, candle.close, candle.volume, candle.quoteVolume])
        .toEqual([old.openTime, old.open, old.close, old.volume, old.quoteVolume]);
      expect(candle.high).toBeGreaterThanOrEqual(old.high);
      expect(candle.low).toBeLessThanOrEqual(old.low);
      if (candle.high > old.high || candle.low < old.low) larger++;
    });
    expect(larger).toBeGreaterThan(after.length / 2);
  });

  test('without the new configuration, pre-change VTA and NRX retain their exact main digests', () => {
    // Recorded before this change from main 9c746c6, not generated from an expected path in this test.
    const vta = new TestMarketSimulation(BEFORE);
    expect(sha(vta.candles5m(L + 3 * DAY_MS - 1)))
      .toBe('d585455517e1d27e6c0c8a5be1f331ceb9406d5f90d60a44ddf4bac0f573c80c');
    expect(sha(vta.recentTrades(L + 26 * HOUR_MS + 37_000, 200)))
      .toBe('68a2cb3d3daac12a65878336dcc11996411f3af0c040dbb896d7bd98d20478af');
    expect(NEURIX.cyclicImpulse).toBeUndefined();
    expect(NEURIX.wickBoostFrom).toBeUndefined();
    // NRX's base engine; its post-listing wave structure is pinned in simulationWaves.test.ts.
    const { marketStructure: _waves, scheduledScenario: _schedule, ...nrxBase } = NEURIX;
    const nrx = new TestMarketSimulation(nrxBase);
    expect(sha(nrx.candles5m(NEURIX.listingAt + 3 * DAY_MS - 1)))
      .toBe('747a97405c9d23e806e5a340ac9e11f729ab3210db7c882160bbcce6f490bba8');
    expect(sha(nrx.recentTrades(NEURIX.listingAt + 26 * HOUR_MS + 37_000, 200)))
      .toBe('b233d56d5a122e600723630eba98ab596cf0bfc7dd1aee9f70d42fd7f309374f');
  });
});
