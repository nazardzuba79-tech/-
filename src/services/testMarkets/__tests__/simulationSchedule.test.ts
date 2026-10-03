import { NRX_TWO_WEEK_SCENARIO as config } from '../neurix';
import { assertScheduledScenarioRelease, scheduledScenarioHour, validateScheduledScenario } from '../simulationSchedule';
import type { RealismTick } from '../simulationRealism';

const HOUR = 3_600_000;
const TICK = 10_000;
const listing = Date.parse('2026-10-03T13:00:00Z');
const source = Array.from({ length: 360 }, (_, i): RealismTick => ({
  price: 1.9 + i / 3600, high: 2.1, low: 1.8, volume: 5, quoteVolume: 10,
}));
const hourAt = (hour: number, seed = 'nrx-schedule-test', c = config) =>
  scheduledScenarioHour(c, seed, listing, .8, hour, 2, 1.9, source);
function tickAt(at: number) {
  const tick = (at - listing) / TICK - 1;
  return hourAt(Math.floor(tick / 360)).ticks[tick % 360];
}

describe('NRX owner schedule math and chronology', () => {
  test('uses exact Kyiv instants, a two-day range and fourteen-day horizon', () => {
    const kyiv = (at: number) => new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short',
    }).format(at);
    expect(kyiv(config.breakoutAt)).toBe('05/10/2026, 08:00');
    expect(kyiv(config.secondTargetAt)).toBe('05/10/2026, 14:30');
    expect(config.firstTargetAt - config.from).toBeLessThanOrEqual(3 * HOUR);
    expect(config.rangeEndAt - config.secondTargetAt).toBe(48 * HOUR);
    expect(config.endAt - config.from).toBe(14 * 24 * HOUR);
  });

  test.each([
    [config.firstTargetAt, 10.776], [config.breakoutAt, 10.776],
    [config.secondTargetAt, 58.536], [config.rangeEndAt, 58.536],
    [config.selloffEndAt, 23.4144], [config.endAt, 23.4144],
  ])('hits the listing-relative target at %s', (at, expected) => {
    expect(tickAt(at).price).toBeCloseTo(expected, 11);
  });

  test('does not resume the previous exponential model after two weeks', () => {
    for (const offset of [TICK, HOUR, 48 * HOUR, 300 * HOUR]) {
      const last = tickAt(config.endAt + offset);
      expect(last.low).toBeGreaterThan(23.4144 * .5);
      expect(last.high).toBeLessThan(23.4144 * 1.6);
      expect(last.volume).toBeGreaterThan(0);
      expect(last.quoteVolume).toBeGreaterThan(0);
    }
  });

  test('refuses elapsed release activation and invalid schedule parameters', () => {
    expect(() => assertScheduledScenarioRelease(config, config.from - 600_000)).not.toThrow();
    for (const now of [config.from - 300_000, config.from, config.from + HOUR, NaN]) {
      expect(() => assertScheduledScenarioRelease(config, now)).toThrow(/future/);
    }
    for (const change of [
      { from: config.from + 1 }, { from: listing - TICK },
      { secondTargetAt: config.breakoutAt }, { rangeFraction: 1 }, { rangeFraction: -.2 },
      { selloffFraction: 1 }, { selloffFraction: NaN }, { firstGainPercent: Infinity },
      { secondGainPercent: 100 }, { version: 1.2 },
    ]) expect(() => validateScheduledScenario({ ...config, ...change }, listing)).toThrow(RangeError);
  });
});

describe('canonical scheduled ticks', () => {
  test('preserves all five tick fields up to a partial-hour cutoff', () => {
    const c = { ...config, from: config.from + 1_230_000 };
    const hour = (config.from - listing) / HOUR;
    const result = hourAt(hour, 'nrx-schedule-test', c);
    expect(result.open).toBe(1.9);
    expect(result.ticks.slice(0, 123)).toEqual(source.slice(0, 123));
    expect(result.ticks[123].price).not.toBe(source[123].price);
  });

  test('order of requests, cache eviction and seed changes are deterministic', () => {
    const before = hourAt(37);
    hourAt(4); hourAt(20);
    for (let i = 0; i < 35; i++) hourAt(3, 'evict-' + i);
    expect(hourAt(37)).toEqual(before);
    expect(hourAt(37, 'another-seed').ticks).not.toEqual(before.ticks);
  });

  test('sideways ranges vary, permit temporary excursions and recover without clipping wicks', () => {
    const ranges = [
      [config.firstTargetAt, config.breakoutAt, 10.776],
      [config.secondTargetAt, config.rangeEndAt, 58.536],
      [config.selloffEndAt, config.endAt, 23.4144],
    ];
    let checked = 0, totalOutside = 0, wickExcursions = 0, recovered = 0;
    for (const [from, to, reference] of ranges) {
      let rangeTicks = 0, outside = 0, run = 0, maxRun = 0;
      for (let hour = Math.floor((from - listing) / HOUR); hour < Math.ceil((to - listing) / HOUR); hour++) {
        const plan = hourAt(hour);
        for (let i = 0; i < plan.ticks.length; i++) {
          const at = listing + hour * HOUR + (i + 1) * TICK;
          if (at <= from || at > to) continue;
          const tick = plan.ticks[i];
          if (!Object.values(tick).every(Number.isFinite) || tick.low <= 0 || tick.high < tick.price || tick.low > tick.price)
            throw new Error(`Invalid range tick at ${new Date(at).toISOString()}: ${JSON.stringify(tick)}`);
          if (Math.abs(tick.price / reference - 1) > .20) { outside++; run++; maxRun = Math.max(maxRun, run); }
          else { if (run) recovered++; run = 0; }
          if (tick.low < reference * .8 || tick.high > reference * 1.2) wickExcursions++;
          // No repeated flat rail at the old clipping prices.
          if (tick.low === reference * .8 || tick.high === reference * 1.2)
            throw new Error('Wick clipped to the nominal 20% guide');
          rangeTicks++;
          checked++;
        }
      }
      expect(outside / rangeTicks).toBeLessThan(.05);
      expect(maxRun * TICK).toBeLessThanOrEqual(20 * 60_000);
      expect(run).toBe(0);
      totalOutside += outside;
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(totalOutside).toBeGreaterThan(0);
    expect(wickExcursions).toBeGreaterThan(0);
    expect(recovered).toBeGreaterThan(0);
  });

  test('finite coherent OHLC/volume, varied candles and genuine intratick flush/recovery', () => {
    let up = 0, down = 0, flushes = 0;
    const lowerWicks: number[] = [];
    for (let hour = 17; hour < 65; hour++) {
      const plan = hourAt(hour);
      let previous = plan.open;
      for (let start = 0; start < 360; start += 30) {
        const ticks = plan.ticks.slice(start, start + 30);
        const open = previous;
        for (const tick of ticks) {
          if (!Object.values(tick).every(Number.isFinite) || tick.low <= 0
            || tick.low > Math.min(previous, tick.price) || tick.high < Math.max(previous, tick.price)
            || tick.volume <= 0 || tick.quoteVolume <= 0) throw new Error('Incoherent tick ' + JSON.stringify(tick));
          expect(tick.volume * ((previous + tick.price) / 2)).toBeCloseTo(tick.quoteVolume, 8);
          previous = tick.price;
        }
        const close = previous;
        if (close > open) up++; else if (close < open) down++;
        const low = Math.min(open, ...ticks.map(t => t.price));
        const wick = (Math.min(open, close) - low) / open;
        lowerWicks.push(wick);
        if (wick > .015) flushes++;
      }
    }
    expect(up).toBeGreaterThan(30);
    expect(down).toBeGreaterThan(30);
    expect(new Set(lowerWicks.map(w => w.toFixed(5))).size).toBeGreaterThan(80);
    expect(flushes).toBeGreaterThan(0);
  });
});
