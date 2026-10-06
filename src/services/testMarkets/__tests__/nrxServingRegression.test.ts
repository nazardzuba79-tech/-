import { NEURIX } from '../neurix';
import { TestMarketSimulation, HOUR_MS, DAY_MS } from '../testMarketSimulation';

const activation = Date.parse('2026-10-06T17:00:00Z');
test('NRX serving release uses a prospective terminal schedule, not expired main or endless baseline', () => {
  expect(NEURIX.scheduledScenario).toMatchObject({ mode: 'range-selloff-range', from: activation });
  const baseline = new TestMarketSimulation({ ...NEURIX, scheduledScenario: undefined });
  const fixed = new TestMarketSimulation(NEURIX);
  expect(fixed.recentTrades(activation, 500)).toEqual(baseline.recentTrades(activation, 500));
  expect(fixed.candles5m(activation, activation - DAY_MS)).toEqual(baseline.candles5m(activation, activation - DAY_MS));
  const anchor = baseline.priceAt(activation)!;
  expect(baseline.priceAt(activation + DAY_MS)!).toBeGreaterThan(anchor * 2);
  expect(fixed.priceAt(activation + .5 * HOUR_MS)).toBeCloseTo(anchor, 3);
  expect(fixed.priceAt(activation + 6.5 * HOUR_MS)).toBeCloseTo(anchor * .4, 3);
  for (const days of [1, 2, 7, 14, 30, 365]) {
    const at = activation + days * DAY_MS;
    const restarted = new TestMarketSimulation(NEURIX);
    const price = fixed.priceAt(at)!;
    expect(price).toBeGreaterThan(anchor * .2);
    expect(price).toBeLessThan(anchor * .65);
    expect(restarted.priceAt(at)).toBe(price);
  }
});
