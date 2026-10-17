/**
 * Admin → Listings, historical continuation in the movement editor:
 * switching in and safely back out, the plan the admin sees before saving,
 * and the label the list and the reuse picker show. Synthetic data only.
 */
import { importHistoricalCsv } from '../../pages/admin/listingHistoricalImport';
import {
  defaultHistoricalPullback, historicalModelLabel, historicalPlan, historicalPlanCandles, newListingMovement, validateListingMovement,
  withHistoricalContinuation, withoutHistoricalContinuation,
} from '../../pages/admin/listingMovementModel';

function csv(hours: number, start: string, step: (i: number) => number): string {
  let price = 100;
  return Array.from({ length: hours }, (_, i) => {
    const open = price, close = open * (1 + step(i));
    price = close;
    return [Date.parse(start) / 1000 + i * 3600, open, Math.max(open, close) * 1.004, Math.min(open, close) * .996, close].join(',');
  }).join('\n');
}
const rising = importHistoricalCsv(csv(48, '2018-01-01T00:00:00Z', () => .01), 'BTC/USDT');
const falling = importHistoricalCsv(csv(24, '2021-04-01T00:00:00Z', () => -.005), 'ETH/USDT');

describe('historical continuation in the movement editor', () => {
  test('choosing it appends the default fall once; the stages before it stay as they were', () => {
    const base = newListingMovement('2');
    const next = withHistoricalContinuation(base);
    expect(next.afterGrowth).toBe('historical');
    expect(next.historical).toEqual({ version: 1, clips: [] });
    expect(next.stages.slice(0, -1)).toEqual(base.stages);
    expect(next.stages[next.stages.length - 1]).toEqual(defaultHistoricalPullback(base.stages[base.stages.length - 1].targetPrice));
    // A program that already ends on a fall keeps it, and no second one is added.
    expect(withHistoricalContinuation(next).stages).toEqual(next.stages);
  });

  test('the safe return removes the fragments and the default fall, and the result validates as before', () => {
    const base = newListingMovement('2');
    const historical = { ...withHistoricalContinuation(base), historical: { version: 1 as const, clips: [rising] } };
    const { movement, removedDefaultFall } = withoutHistoricalContinuation(historical);
    expect(removedDefaultFall).toBe(true);
    expect(movement).toEqual(base);
    expect('historical' in movement).toBe(false);
    expect(validateListingMovement('2', movement)).toBeNull();
  });

  test('a fall the admin changed stays after the return; only the fragments go', () => {
    const chosen = withHistoricalContinuation(newListingMovement('2'));
    const edited = { ...chosen, stages: chosen.stages.map((stage, i, all) => i === all.length - 1 ? { ...stage, durationHours: 48 } : stage) };
    const { movement, removedDefaultFall } = withoutHistoricalContinuation(edited);
    expect(removedDefaultFall).toBe(false);
    expect(movement.stages).toEqual(edited.stages);
    expect(movement.afterGrowth).toBe('range');
  });

  test('the plan compounds each fragment from the fall target, without a jump between fragments', () => {
    const chosen = withHistoricalContinuation(newListingMovement('2'));
    const program = { ...chosen, historical: { version: 1 as const, clips: [rising, falling] } };
    const plan = historicalPlan(program)!;
    const anchor = Number(chosen.stages[chosen.stages.length - 1].targetPrice);
    expect(plan.startPrice).toBe(anchor);
    expect(plan.hours).toBe(72);
    expect(plan.fragments[0].startPrice).toBe(anchor);
    expect(plan.fragments[0].changePercent).toBeCloseTo((1.01 ** 48 - 1) * 100, 3);
    expect(plan.fragments[1].startPrice).toBe(plan.fragments[0].endPrice);
    expect(plan.fragments[1].changePercent).toBeCloseTo((.995 ** 24 - 1) * 100, 3);
    expect(plan.endPrice).toBeCloseTo(anchor * 1.01 ** 48 * .995 ** 24, 6);
    expect(plan.highPrice).toBeGreaterThanOrEqual(plan.fragments[0].endPrice);
    expect(plan.withinMaxPrice).toBe(true);
    // The same rule the save applies: over the maximum is flagged before saving.
    // A steeper source would cross the listing's maximum: flagged in the plan and refused by the same rule the save applies.
    const steep = importHistoricalCsv(csv(48, '2022-01-01T00:00:00Z', () => .03), 'SOL/USDT');
    const over = { ...program, historical: { version: 1 as const, clips: [steep] } };
    expect(historicalPlan(over)!.withinMaxPrice).toBe(false);
    expect(validateListingMovement('2', over)).toMatch(/лимит цены/);
    expect(historicalPlan(chosen)).toBeNull();
  });

  test('the label names each fragment by asset, start date and length — never a price', () => {
    const program = { ...withHistoricalContinuation(newListingMovement('2')), historical: { version: 1 as const, clips: [rising, falling] } };
    expect(historicalModelLabel(program)).toBe('BTC с 2018-01-01, 2 дн. → ETH с 2021-04-01, 1 дн.');
    expect(historicalModelLabel(newListingMovement('2'))).toBeNull();
    expect(historicalModelLabel(null)).toBeNull();
  });

  test('the whole replay is drawn as daily candles from its moves: same open/close chain as the plan, nothing invented', () => {
    const program = { ...withHistoricalContinuation(newListingMovement('2')), historical: { version: 1 as const, clips: [rising, falling] } };
    const start = Date.parse('2026-11-08T00:00:00Z');
    const candles = historicalPlanCandles(program, start);
    const plan = historicalPlan(program)!;
    expect(candles).toHaveLength(3);
    expect(candles.map(c => c.time)).toEqual([0, 1, 2].map(day => (start + day * 86_400_000) / 1000));
    expect(candles[0].open).toBe(plan.startPrice);
    candles.slice(1).forEach((candle, i) => expect(candle.open).toBeCloseTo(candles[i].close, 9));
    expect(candles[2].close).toBeCloseTo(plan.endPrice, 9);
    expect(Math.max(...candles.map(c => c.high))).toBeCloseTo(plan.highPrice, 9);
    expect(Math.min(...candles.map(c => c.low))).toBeCloseTo(plan.lowPrice, 9);
    expect(candles.every(c => c.volume === 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))).toBe(true);
    expect(historicalPlanCandles(newListingMovement('2'), start)).toEqual([]);
  });
});
