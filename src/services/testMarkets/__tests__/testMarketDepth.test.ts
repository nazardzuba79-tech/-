import BigNumber from 'bignumber.js';
import { VOLTORA } from '../testAssetConfig';
import { TestMarketSimulation, TICK_MS, CANDLE_MS } from '../testMarketSimulation';
import { testMarketDepth } from '../testMarketDepth';

const L = VOLTORA.listingAt;
test('before listing there is no depth or completed tape', () => {
  const sim = new TestMarketSimulation(VOLTORA);
  expect(testMarketDepth(sim, L - 1)).toMatchObject({ available: false, bids: [], asks: [] });
  expect(sim.recentTrades(L - 1)).toEqual([]);
  expect(sim.recentTrades(L + TICK_MS - 1)).toEqual([]);
  expect(sim.recentTrades(L + TICK_MS)).toHaveLength(1);
});

test.each([0, 10_000, 300_000, 3_600_000, 172_800_000])('deterministic uncrossed 25-level depth at %dms', elapsed => {
  const sim = new TestMarketSimulation(VOLTORA), now = L + elapsed;
  const book = testMarketDepth(sim, now);
  expect(book).toEqual(testMarketDepth(new TestMarketSimulation(VOLTORA), now + 999));
  expect(book.available).toBe(true);
  expect(book.bids).toHaveLength(25); expect(book.asks).toHaveLength(25);
  expect(new BigNumber(book.bids[0].price).eq(new BigNumber(sim.priceAt(now)!).decimalPlaces(10, BigNumber.ROUND_DOWN))).toBe(true);
  const spread = Number(book.asks[0].price) - Number(book.bids[0].price);
  expect(spread).toBeGreaterThan(0); expect(spread / Number(book.bids[0].price)).toBeLessThan(0.001);
  for (const [levels, direction] of [[book.bids, -1], [book.asks, 1]] as const) {
    expect(new Set(levels.map(l => l.quantity)).size).toBeGreaterThan(20);
    expect(Number(levels[24].quantity)).toBeGreaterThan(Number(levels[0].quantity));
    levels.forEach((level, index) => {
      expect(Number(level.price)).toBeGreaterThan(0); expect(Number(level.quantity)).toBeGreaterThan(0);
      if (index) expect((Number(level.price) - Number(levels[index - 1].price)) * direction).toBeGreaterThan(0);
    });
  }
  expect(testMarketDepth(sim, now + TICK_MS)).not.toEqual(book);
});

test('tape is canonical completed ticks, not separate invented volume or future prices', () => {
  const sim = new TestMarketSimulation(VOLTORA), now = L + CANDLE_MS;
  const tape = sim.recentTrades(now);
  expect(tape).toHaveLength(30);
  expect(tape).toEqual(new TestMarketSimulation(VOLTORA).recentTrades(now + 999));
  expect(tape[0].timestamp).toBe(now);
  for (const [i, tick] of tape.entries()) {
    expect(tick.timestamp).toBeLessThanOrEqual(now);
    if (i) expect(tick.timestamp).toBeLessThan(tape[i - 1].timestamp);
    expect(Number(tick.price)).toBe(sim.priceAt(tick.timestamp));
    expect(['BUY', 'SELL']).toContain(tick.side);
    expect(Number(tick.quantity)).toBeGreaterThan(0);
  }
  const candle = sim.candles5m(now)[0];
  expect(tape.reduce((sum,t) => sum + Number(t.quantity), 0)).toBeCloseTo(candle.volume, 3);
  expect(tape.reduce((sum,t) => sum + Number(t.quoteVolume), 0)).toBeCloseTo(candle.quoteVolume, 1);
  expect(sim.recentTrades(now, 5)).toEqual(tape.slice(0, 5));
  const later = sim.recentTrades(now + TICK_MS);
  expect(later.slice(1)).toEqual(tape);
});
