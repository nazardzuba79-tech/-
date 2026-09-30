import type { TestAssetConfig } from '../testAssetConfig';
import { accumulationFactor } from '../simulationAccumulation';
import {
  TestMarketSimulation, aggregateCandles, HOUR_MS, DAY_MS, type SimCandle,
} from '../testMarketSimulation';

const L = Date.parse('2026-09-28T15:00:00Z');
const START = L + 40 * HOUR_MS;

const BASE: TestAssetConfig = {
  symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', pair: 'VTA/USDT',
  isTestAsset: true, isTradable: false, listingArmed: true,
  listingAt: L, initialPrice: 0.01, seed: 'voltora-2026-09-27',
  simulationProfile: 'IMPULSE_TREND', realismFrom: L,
};

const PHASE = {
  anchorAt: START,
  flushFraction: 0.25,
  accumulationHours: 7 * 24,
  minBandFraction: 0.15,
  maxBandFraction: 0.30,
};

const withPhase = (extra: Partial<TestAssetConfig> = {}): TestAssetConfig => ({
  ...BASE,
  accumulationPhase: PHASE,
  ...extra,
});

function hour(sim: TestMarketSimulation, start: number): SimCandle {
  const five = sim.candles5m(start + HOUR_MS, start).filter((c) => c.openTime < start + HOUR_MS);
  expect(five).toHaveLength(12);
  return aggregateCandles(five, HOUR_MS)[0];
}

describe('VTA final flush and accumulation lifecycle', () => {
  test('preserves every completed candle before the activation hour', () => {
    const phased = new TestMarketSimulation(withPhase());
    const control = new TestMarketSimulation(BASE);
    const before = START - 1;
    expect(phased.candles5m(before)).toEqual(control.candles5m(before));
    expect(phased.recentTrades(before, 500)).toEqual(control.recentTrades(before, 500));
    expect(phased.priceAt(before)).toBe(control.priceAt(before));
  });

  test('the final flush trades exactly 25% down and fully reclaims the opening price', () => {
    const sim = new TestMarketSimulation(withPhase());
    const candle = hour(sim, START);
    expect(candle.low / candle.open).toBeCloseTo(0.75, 7);
    expect(candle.close).toBe(candle.open);
    expect(candle.high).toBeLessThanOrEqual(candle.open);
    const trades = sim.recentTrades(START + HOUR_MS, 360);
    expect(Math.min(...trades.map((trade) => Number(trade.price)))).toBe(candle.low);
    expect(Number(trades[0].price)).toBe(candle.close);
  });

  test('accumulates for exactly seven days around the reclaimed anchor without a trend runaway', () => {
    const sim = new TestMarketSimulation(withPhase());
    const anchor = hour(sim, START).close;
    const end = START + HOUR_MS + 7 * DAY_MS;
    const candles = aggregateCandles(
      sim.candles5m(end, START + HOUR_MS).filter((c) => c.openTime < end),
      HOUR_MS,
    );
    expect(candles).toHaveLength(7 * 24);
    const closes = candles.map((c) => c.close / anchor);
    expect(Math.max(...closes)).toBeLessThanOrEqual(1.15);
    expect(Math.min(...closes)).toBeGreaterThanOrEqual(0.85);
    // The requested 15%-30% accumulation reads as a broad range, not a flat line.
    expect(Math.max(...closes) - Math.min(...closes)).toBeGreaterThan(0.08);
    expect(candles.every((c, i) => i === 0 || c.open === candles[i - 1].close)).toBe(true);
  });

  test('the accumulation factor is deterministic and bounded for the whole week', () => {
    const values = Array.from({ length: PHASE.accumulationHours + 1 }, (_, h) =>
      accumulationFactor(BASE.seed, PHASE, h));
    expect(values[0]).toBe(1);
    expect(values).toEqual(Array.from({ length: PHASE.accumulationHours + 1 }, (_, h) =>
      accumulationFactor(BASE.seed, PHASE, h)));
    expect(Math.max(...values)).toBeLessThanOrEqual(1.15);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.85);
  });

  test('after the week, final growth resumes from the accumulated price with no absolute-price jump', () => {
    const phased = new TestMarketSimulation(withPhase());
    const control = new TestMarketSimulation(BASE);
    const firstFinal = START + HOUR_MS + 7 * DAY_MS;
    const before = phased.priceAt(firstFinal);
    const first = hour(phased, firstFinal);
    expect(first.open).toBe(before);
    const baseline = hour(control, firstFinal);
    expect(first.close / first.open).toBeCloseTo(baseline.close / baseline.open, 7);
    expect(first.open).not.toBe(baseline.open);
  });

  test('an already configured six-hour cycle is ignored from the new lifecycle boundary onward', () => {
    const cycle = {
      anchorAt: START,
      notBefore: START,
      periodHours: 6,
    };
    const phased = new TestMarketSimulation(withPhase({ cyclicImpulse: cycle }));
    const plain = new TestMarketSimulation(withPhase());
    for (const at of [START + HOUR_MS, START + 6 * HOUR_MS, START + 7 * HOUR_MS, START + 13 * HOUR_MS]) {
      expect(phased.candles5m(at, START)).toEqual(plain.candles5m(at, START));
    }
  });
});
