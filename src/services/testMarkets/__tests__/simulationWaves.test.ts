import { NEURIX as CONFIGURED_NEURIX } from '../neurix';
import { VOLTORA } from '../testAssetConfig';
import { DAY_MS, HOUR_MS, TestMarketSimulation, aggregateCandles, simulationFor, type SimCandle } from '../testMarketSimulation';
import { pauseInsideHour, waveHours, type WaveHour } from '../simulationWaves';

/**
 * NRX POST-LISTING WAVE STRUCTURE (owner, 2026-10-03): a live market on 15m,
 * 1h and 4h — price discovery, impulse legs, corrections with flushes that
 * are bought back, accumulation ranges, breakouts — over ONE canonical 5m
 * series, with the base engine's block and day anchors unchanged.
 */

// Preserve the original wave algorithm's contract independently of the later
// forward scenario, which intentionally replaces future absolute anchors.
const NEURIX = { ...CONFIGURED_NEURIX, scheduledScenario: undefined };
const L = NEURIX.listingAt;
const M15 = 15 * 60_000;
const { marketStructure: _waves, ...NRX_BASE } = NEURIX;
const nrx = () => new TestMarketSimulation(NEURIX);
const base = () => new TestMarketSimulation(NRX_BASE);
const closed = (simulation: TestMarketSimulation, hours: number) =>
  simulation.candles5m(L + hours * HOUR_MS).filter((candle) => candle.openTime + 300_000 <= L + hours * HOUR_MS);
const waves = (simulation: TestMarketSimulation) => (simulation as unknown as { waves: Map<number, WaveHour> }).waves;

const green = (candle: SimCandle) => candle.close >= candle.open;
function longestGreenRun(candles: SimCandle[]): number {
  let run = 0, best = 0;
  for (const candle of candles) { run = green(candle) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
/** Swing pullbacks on closes (zigzag, 5% reversal threshold): their depths. */
function swings(candles: SimCandle[]): number[] {
  const out: number[] = [];
  let high = candles[0].close, low = high, falling = false;
  for (const { close } of candles) {
    if (!falling) { if (close > high) high = close; else if (close < high * 0.95) { falling = true; low = close; } }
    else if (close < low) low = close;
    else if (close > low * 1.05) { out.push(1 - low / high); falling = false; high = close; }
  }
  if (falling) out.push(1 - low / high);
  return out;
}
const quantile = (values: number[], q: number) => values.slice().sort((a, b) => a - b)[Math.floor(q * (values.length - 1))];
const wickShares = (candles: SimCandle[]) => candles.map((c) => {
  const range = c.high - c.low || 1;
  return { upper: (c.high - Math.max(c.open, c.close)) / range, lower: (Math.min(c.open, c.close) - c.low) / range,
    body: Math.abs(c.close - c.open) / range };
});

describe('waveHours re-arranges a block without moving its total', () => {
  test.each([
    ['launch block', 'neurix-2026-10-03', 0, 0, 48, Math.log(552.35)],
    ['mid-block activation', 'neurix-2026-10-03', 0, 5, 43, 5.4],
    ['a fast day', 'nrx-alt-1', 1, 0, 24, 2.67],
    ['a slow day', 'nrx-alt-2', 9, 0, 24, 0.12],
    ['a flat day', 'nrx-alt-3', 14, 0, 24, -0.05],
  ])('%s: exact total, deterministic, finite', (_name, seed, block, start, length, total) => {
    const hours = waveHours(seed, block, start, length, total);
    expect(hours).toHaveLength(length);
    expect(hours.every((hour) => Number.isFinite(hour.logReturn))).toBe(true);
    expect(Math.abs(hours.reduce((sum, hour) => sum + hour.logReturn, 0) - total)).toBeLessThan(1e-9);
    expect(waveHours(seed, block, start, length, total)).toEqual(hours);
  });

  test('a 15m pause keeps the hour total and only applies when 15m candles align with the hour', () => {
    const wave = waveHours(NEURIX.seed, 0, 0, 48, Math.log(552.35)).find((hour) => hour.regime === 'impulse')!;
    const steps = Array.from({ length: 12 }, (_, k) => 0.02 + 0.001 * k);
    const paused = pauseInsideHour(NEURIX.seed, 7, wave, steps, true);
    expect(Math.abs(paused.reduce((a, b) => a + b, 0) - steps.reduce((a, b) => a + b, 0))).toBeLessThan(1e-12);
    const buckets = [0, 1, 2, 3].map((b) => paused.slice(3 * b, 3 * b + 3).reduce((a, x) => a + x, 0));
    expect(Math.min(...buckets.slice(1))).toBeLessThan(0.2 * Math.max(...buckets));
    expect(pauseInsideHour(NEURIX.seed, 7, wave, steps, false)).toEqual(steps);
  });
});

describe('NRX keeps every anchor of its base engine', () => {
  test('the listing, 48h and the end of every day for ten days are identical, bit for bit', () => {
    const a = nrx(), b = base();
    for (const hours of [0, 48, ...Array.from({ length: 8 }, (_, d) => 72 + 24 * d)]) {
      expect(a.priceAt(L + hours * HOUR_MS)).toBe(b.priceAt(L + hours * HOUR_MS));
    }
  });

  test('NRX is configured from its listing, and the structure is opt-in for NRX only', () => {
    expect(NEURIX.marketStructure).toEqual({ from: L });
    expect(VOLTORA.marketStructure).toBeUndefined();
    expect(simulationFor(NEURIX)).not.toBe(simulationFor(NRX_BASE));
  });

  test('a later activation never rewrites an hour that was already shown', () => {
    const from = L + 5 * HOUR_MS + 17 * 60_000; // rounds up to hour 6
    const late = new TestMarketSimulation({ ...NEURIX, marketStructure: { from } });
    const reference = base();
    expect(late.candles5m(L + 6 * HOUR_MS - 1)).toEqual(reference.candles5m(L + 6 * HOUR_MS - 1));
    expect(late.recentTrades(L + 6 * HOUR_MS, 300)).toEqual(reference.recentTrades(L + 6 * HOUR_MS, 300));
    for (const hours of [48, 72, 96]) expect(late.priceAt(L + hours * HOUR_MS)).toBe(reference.priceAt(L + hours * HOUR_MS));
    expect(waves(late).has(5)).toBe(false);
    expect(waves(late).has(6)).toBe(true);
  });
});

describe('one price stream: 15m, 1h and 4h agree', () => {
  test('1h from 15m and 4h from 1h equal the same timeframes from the canonical 5m series', () => {
    const c5 = closed(nrx(), 72);
    const c15 = aggregateCandles(c5, M15);
    const ohlc = (c: SimCandle) => [c.openTime, c.open, c.high, c.low, c.close];
    expect(aggregateCandles(c15, HOUR_MS).map(ohlc)).toEqual(aggregateCandles(c5, HOUR_MS).map(ohlc));
    expect(aggregateCandles(aggregateCandles(c5, HOUR_MS), 4 * HOUR_MS).map(ohlc)).toEqual(aggregateCandles(c5, 4 * HOUR_MS).map(ohlc));
    const volume = (candles: SimCandle[]) => candles.map((c) => c.quoteVolume);
    aggregateCandles(c15, HOUR_MS).forEach((candle, i) => {
      expect(Math.abs(candle.quoteVolume - volume(aggregateCandles(c5, HOUR_MS))[i])).toBeLessThan(0.05);
    });
  });
});

describe('NRX reads like a live post-listing market (first 72 hours)', () => {
  const simulation = nrx();
  const c5 = closed(simulation, 72);
  const m15 = aggregateCandles(c5, M15);
  const h1 = aggregateCandles(c5, HOUR_MS);
  const h4 = aggregateCandles(c5, 4 * HOUR_MS);
  const phases = waves(simulation);
  const phaseOf = (candle: SimCandle) => phases.get(Math.floor((candle.openTime - L) / HOUR_MS))!.phase;

  test('the market moves through its phases, opening on price discovery', () => {
    const seen = new Set([...Array(72).keys()].map((h) => phases.get(h)!.phase));
    for (const phase of ['launch', 'impulse', 'breakout', 'correction', 'accumulation'] as const) expect(seen.has(phase)).toBe(true);
    expect(seen.has('dip') || seen.has('bounce')).toBe(true);
    expect([0, 1, 2].map((h) => phases.get(h)!.phase)).toEqual(['launch', 'launch', 'launch']);
    // No fixed rhythm: the three days are not the same sequence of phases.
    const day = (d: number) => [...Array(24).keys()].map((h) => phases.get(24 * d + h)!.phase).join();
    expect(new Set([day(0), day(1), day(2)]).size).toBe(3);
  });

  test('15m: detailed and noisy — rising phases mostly green, never a long ladder, varied wicks and dojis', () => {
    const rising = m15.filter((c) => ['impulse', 'breakout', 'launch'].includes(phaseOf(c)));
    const share = rising.filter(green).length / rising.length;
    expect(share).toBeGreaterThanOrEqual(0.55);
    expect(share).toBeLessThanOrEqual(0.78);
    expect(longestGreenRun(m15)).toBeLessThanOrEqual(8);
    const correction = m15.filter((c) => phaseOf(c) === 'correction');
    expect(correction.filter(green).length / correction.length).toBeGreaterThan(0.2); // relief candles inside pullbacks
    const wicks = wickShares(m15);
    expect(quantile(wicks.map((w) => w.upper), 0.9)).toBeGreaterThan(0.4);
    expect(quantile(wicks.map((w) => w.lower), 0.9)).toBeGreaterThan(0.4);
    expect(wicks.filter((w) => w.body < 0.15).length).toBeGreaterThan(10); // dojis / small bodies
    expect(swings(m15).length).toBeGreaterThanOrEqual(15);
  });

  test('1h: impulse waves with pullbacks between them and consolidations before breakouts', () => {
    expect(longestGreenRun(h1)).toBeLessThanOrEqual(7);
    const pullbacks = swings(h1);
    expect(pullbacks.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...pullbacks)).toBeLessThanOrEqual(0.46); // profit taking, not a collapse
    const share = h1.filter(green).length / h1.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.7);
    // Bodies are not repeated candle to candle.
    const bodies = h1.map((c) => Math.log(c.close / c.open));
    expect(bodies.filter((b, i) => i > 0 && Math.abs(Math.abs(b) - Math.abs(bodies[i - 1])) < 1e-4).length).toBeLessThanOrEqual(1);
  });

  test('4h: a strong start, pauses and fresh impulses — green-led but with red candles and long shadows', () => {
    const share = h4.filter(green).length / h4.length;
    expect(share).toBeGreaterThanOrEqual(0.55);
    expect(share).toBeLessThanOrEqual(0.82);
    expect(h4.filter((c) => !green(c)).length).toBeGreaterThanOrEqual(3);
    expect(longestGreenRun(h4)).toBeLessThanOrEqual(7);
    const wicks = wickShares(h4);
    expect(Math.max(...wicks.map((w) => w.upper))).toBeGreaterThan(0.3); // exhaustion after aggressive buying
    expect(Math.max(...wicks.map((w) => w.lower))).toBeGreaterThan(0.3); // flushes that were bought back
  });

  test('volume is highest on breakouts and impulses and lowest in accumulation', () => {
    const relative = (phase: string) => {
      const values = h1.map((candle, i) => {
        const window = h1.slice(Math.max(0, i - 6), i + 7).map((c) => c.quoteVolume);
        return { phase: phaseOf(candle), value: candle.quoteVolume / quantile(window, 0.5) };
      }).filter((entry) => entry.phase === phase).map((entry) => entry.value);
      return quantile(values, 0.5);
    };
    expect(relative('impulse')).toBeGreaterThan(1.5 * relative('accumulation'));
    expect(relative('breakout')).toBeGreaterThan(1.5 * relative('accumulation'));
    expect(relative('launch')).toBeGreaterThan(relative('accumulation'));
  });
});

describe('rallies stay rallies even when a later day falls', () => {
  test('over 30 days at least 97% of impulse and breakout hours rise (the base engine turns slightly negative from about day 18)', () => {
    const simulation = nrx();
    let rallies = 0, rising = 0;
    for (let hour = 0; hour < 30 * 24; hour++) {
      const plan = simulation.hourPlan(hour);
      const phase = waves(simulation).get(hour)!.phase;
      if (phase !== 'impulse' && phase !== 'breakout') continue;
      rallies++;
      if (plan.logReturn >= 0) rising++;
    }
    expect(rising / rallies).toBeGreaterThanOrEqual(0.97);
  });
});

describe('later days stay alive without a fixed rhythm', () => {
  test('days 4–10: red 4h candles and 1h pullbacks keep appearing; every hour is finite', () => {
    const c5 = closed(nrx(), 240).filter((c) => c.openTime >= L + 3 * DAY_MS);
    expect(c5.every((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.low > 0)).toBe(true);
    const h4 = aggregateCandles(c5, 4 * HOUR_MS);
    expect(h4.filter((c) => !green(c)).length).toBeGreaterThanOrEqual(6);
    expect(swings(aggregateCandles(c5, HOUR_MS)).length).toBeGreaterThanOrEqual(15);
  });
});
