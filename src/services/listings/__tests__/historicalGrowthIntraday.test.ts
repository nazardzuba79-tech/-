/**
 * History20 intraday model v2 (SEEDED_BRIDGE_*_V2) against the v1 straight-line
 * baseline. The daily source values are the observed part; every intraday
 * value and all volume are modeled. Synthetic fixtures only (not market data).
 */
import {
  buildHistoricalGrowthProgram, historicalGrowthAlpha, historicalGrowthCap, historicalGrowthDailyModel, historicalGrowthElapsedSeconds,
  historicalGrowthLogAt, historicalGrowthMaxPrice, historicalGrowthObservation, historicalGrowthOpenLogAt, historicalGrowthPrice,
  historicalGrowthTickVolume, validateHistoricalGrowthProgram, type HistoricalGrowthProgram, type HistoricalGrowthSourceRow,
} from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { isHistoricalDemoConfig } from '../simulationContour';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';
import { aggregateCandles, TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';

const DAY = 86_400_000, HOUR = 3_600_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', FROM = Date.parse(LISTING_AT);
const SEED = 'vhxt-20261102-synthetic';

/** A deterministic synthetic walk; OHLC days include the edge cases a daily source has. */
function walk(days: number, ohlc: boolean): HistoricalGrowthSourceRow[] {
  let x = 11, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    // Day 0 opens on the anchor; later days open near (not always on) the previous close: the source's own gap.
    const open = d === 0 ? 100 : price * (1 + (random() - .5) * .006);
    const close = open * Math.exp(Math.log(80) / days + (random() - .5) * .12);
    let high = Math.max(open, close) * (1 + random() * .04), low = Math.min(open, close) * (1 - random() * .04);
    if (d === 3) high = open; // opens on the high
    if (d === 4) low = open; // opens on the low
    if (d === 5) high = close; // closes on the high
    if (d === 6) { high = open; low = close; } // opens on the high, closes on the low
    if (d === 7) high = Math.max(open, close); // high touches the body
    price = close;
    return ohlc ? { date, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close } : { date, close };
  });
}
const REFERENCE_SOURCE = { provider: 'Coin Metrics', asset: 'BTC', quote: 'USD', metric: 'PriceUSD', dataKind: 'daily_reference', timeframe: '1d', sliceSha256: 'a'.repeat(64), license: 'CC-BY-NC-4.0' } as const;
const OHLC_SOURCE = { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } as const;
const REFERENCE_ROWS = walk(41, false), OHLC_ROWS = walk(40, true);
const build = (dataKind: 'reference' | 'ohlc', intrabarVersion: 1 | 2 = 2, rows = dataKind === 'ohlc' ? OHLC_ROWS : REFERENCE_ROWS) => buildHistoricalGrowthProgram({
  scenarioId: dataKind === 'ohlc' ? 'VHX-03-SOL' : 'VHX-01-BTC', source: dataKind === 'ohlc' ? OHLC_SOURCE : REFERENCE_SOURCE,
  targetPeakGrowthPercent: dataKind === 'ohlc' ? '9348' : '11872.45', rows, intrabarVersion });
const PROGRAMS = { 'reference v2': build('reference'), 'ohlc v2': build('ohlc'), 'reference v1': build('reference', 1), 'ohlc v1': build('ohlc', 1) };
const reference = PROGRAMS['reference v2'], ohlc = PROGRAMS['ohlc v2'];

const config = (growth: HistoricalGrowthProgram, seed = SEED): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol: 'VHXT', name: 'VOLTEX History Test', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed, tradable: false,
  simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
});
type Scheduled = Parameters<typeof controlledScenarioHour>[0];
const schedules = new Map<HistoricalGrowthProgram, Map<string, Scheduled>>();
/** The persisted, validated configuration the simulation reads (memoised per program and seed). */
function scheduled(growth: HistoricalGrowthProgram, seed = SEED): Scheduled {
  const bySeed = schedules.get(growth) ?? new Map<string, Scheduled>();
  schedules.set(growth, bySeed);
  if (!bySeed.has(seed)) bySeed.set(seed, listingSimulationConfig(config(growth, seed)).scheduledScenario as Scheduled);
  return bySeed.get(seed)!;
}
const days = (growth: HistoricalGrowthProgram) => historicalGrowthElapsedSeconds(growth) / 86400;
const dayCache = new Map<string, { open: number; ticks: ReturnType<typeof controlledScenarioHour>['ticks'] }>();
/** All ticks of one scenario day, from the simulation's own generator (memoised: the generator is pure). */
function dayTicks(growth: HistoricalGrowthProgram, day: number, seed = SEED) {
  const key = `${Object.keys(PROGRAMS).find(k => PROGRAMS[k as keyof typeof PROGRAMS] === growth) ?? growth.logsSha256 + growth.intrabar}:${seed}:${day}`;
  if (!dayCache.has(key)) {
    const s = scheduled(growth, seed);
    const hours = Array.from({ length: 24 }, (_, h) => controlledScenarioHour(s, seed, day * 24 + h));
    dayCache.set(key, { open: hours[0].open, ticks: hours.flatMap(h => h.ticks) });
  }
  return dayCache.get(key)!;
}
const priceOf = (growth: HistoricalGrowthProgram) => {
  const alpha = historicalGrowthAlpha(growth), cap = historicalGrowthCap('2', growth.targetPeakGrowthPercent);
  return (log: number) => historicalGrowthPrice(growth, 2, cap, log, alpha);
};
const code = (fn: () => unknown) => { try { fn(); return 'ACCEPTED'; } catch (error) { return (error as { code?: string }).code ?? (error as Error).message; } };

describe('model versions', () => {
  test('new programs use v2; v1 stays valid as the baseline; an id is bound to its data kind', () => {
    expect([reference.intrabar, ohlc.intrabar]).toEqual(['SEEDED_BRIDGE_REFERENCE_V2', 'SEEDED_BRIDGE_OHLC_V2']);
    expect([PROGRAMS['reference v1'].intrabar, PROGRAMS['ohlc v1'].intrabar]).toEqual(['LOG_LINEAR_REFERENCE_V1', 'SEEDED_OHLC_PATH_V1']);
    // The model changes nothing that is stored from the source.
    expect(PROGRAMS['ohlc v1'].logs).toEqual(ohlc.logs);
    expect(PROGRAMS['ohlc v1'].logsSha256).toBe(ohlc.logsSha256);
    for (const program of Object.values(PROGRAMS)) expect(code(() => config(program))).toBe('ACCEPTED');
    expect(() => validateHistoricalGrowthProgram({ ...reference, intrabar: 'SEEDED_BRIDGE_OHLC_V2' })).toThrow('Модель внутри суток');
    expect(() => validateHistoricalGrowthProgram({ ...ohlc, intrabar: 'SEEDED_BRIDGE_REFERENCE_V2' })).toThrow('Модель внутри суток');
    expect(code(() => config({ ...ohlc, intrabar: 'SEEDED_BRIDGE_OHLC_V3' as never }))).toBe('INVALID_CONFIG');
  });
});

describe('the inlined generator equals the reference, tick for tick', () => {
  test.each(Object.entries(PROGRAMS))('%s: open, every tick price and the modeled volume, two seeds', (_name, growth) => {
    const price = priceOf(growth), end = days(growth) * 24;
    for (const seed of [SEED, 'another-seed']) {
      const s = scheduled(growth, seed);
      for (const hour of [0, 1, 5, 23, 24, 25, 47, 48, 24 * 6 + 13, 24 * 20, end - 1, end, end + 3]) {
        const generated = controlledScenarioHour(s, seed, hour);
        expect(generated.open).toBe(price(historicalGrowthOpenLogAt(growth, seed, hour * 3600)));
        let previous = generated.open;
        generated.ticks.forEach((tick, i) => {
          const at = hour * 3600 + (i + 1) * 10;
          expect(tick.price).toBe(price(historicalGrowthLogAt(growth, seed, at)));
          expect(tick.quoteVolume).toBe(historicalGrowthTickVolume(growth, seed, at, Math.abs(Math.log(tick.price / previous))));
          previous = tick.price;
        });
      }
    }
  });
});

describe('observed daily values: exact anchors and bounds', () => {
  test('OHLC v2: every 1d candle IS the source bar; its high and low are reached by a tick and never exceeded', () => {
    const model = historicalGrowthDailyModel(ohlc, '2');
    const daily = testMarketCandles(listingSimulationConfig(config(ohlc)), '1d', FROM + days(ohlc) * DAY, 41).slice(0, 40);
    expect(daily).toHaveLength(40);
    daily.forEach((candle, d) => {
      // The served candle is formatted to the asset step (1e-10); the raw ticks below are compared exactly.
      for (const field of ['open', 'high', 'low', 'close'] as const) expect(Math.abs(candle[field] - model[d][field])).toBeLessThanOrEqual(1e-10);
    });
    for (let d = 0; d < 40; d++) {
      const { open, ticks } = dayTicks(ohlc, d), bar = model[d];
      expect(open).toBe(bar.open);
      expect(Math.max(...ticks.map(t => t.high))).toBe(bar.high);
      expect(Math.min(...ticks.map(t => t.low))).toBe(bar.low);
      expect(ticks[ticks.length - 1].price).toBe(bar.close);
      // Reached exactly: by a tick, or by the open itself when the source opened on its extreme.
      expect([open, ...ticks.map(t => t.price)]).toContain(bar.high);
      expect([open, ...ticks.map(t => t.price)]).toContain(bar.low);
    }
  });

  test('reference v2: both daily samples are exact at every boundary; the modeled wicks stay inside the band and under the cap', () => {
    const price = priceOf(reference), cap = historicalGrowthCap('2', reference.targetPeakGrowthPercent), rows = reference.logs;
    let wicked = 0, peak = 0;
    for (let d = 0; d < days(reference); d++) {
      const { open, ticks } = dayTicks(reference, d);
      expect(open).toBe(price(rows[d][0]));
      expect(ticks[ticks.length - 1].price).toBe(price(rows[d + 1][0]));
      const high = Math.max(...ticks.map(t => t.high)), low = Math.min(...ticks.map(t => t.low));
      expect(high).toBeLessThanOrEqual(cap);
      // The band: the two samples ± 1.25 σ of the local daily moves (σ ≤ 6 %), never above the global peak.
      expect(Math.log(high / Math.max(open, ticks[ticks.length - 1].price))).toBeLessThanOrEqual(1.25 * 0.06 * historicalGrowthAlpha(reference) + 1e-9);
      expect(Math.log(Math.min(open, ticks[ticks.length - 1].price) / low)).toBeLessThanOrEqual(1.25 * 0.06 * historicalGrowthAlpha(reference) + 1e-9);
      if (high > Math.max(open, ticks[ticks.length - 1].price) * 1.0001) wicked++;
      peak = Math.max(peak, high);
    }
    // Most days carry a modeled wick (v1 had none); the global peak is still exactly the cap.
    expect(wicked).toBeGreaterThan(days(reference) * 0.6);
    expect(peak).toBe(cap);
  });

  test('every price is positive and finite; no tick of either v2 window breaches the global cap, which is reached', () => {
    for (const growth of [reference, ohlc]) {
      const cap = historicalGrowthCap('2', growth.targetPeakGrowthPercent);
      let top = 0, invalid = 0;
      for (let d = 0; d < days(growth); d++) for (const tick of dayTicks(growth, d).ticks) {
        if (!(Number.isFinite(tick.price) && tick.price > 0 && tick.low > 0 && tick.volume > 0 && tick.quoteVolume > 0)) invalid++;
        top = Math.max(top, tick.high);
      }
      expect(invalid).toBe(0);
      // Reached up to floating point (the peak is P0 · M; only its rounding above the cap is floored).
      expect(top).toBeLessThanOrEqual(cap);
      expect(top / cap).toBeCloseTo(1, 12);
    }
  });
});

describe('synthetic intraday shape (v2) against the straight-line baseline (v1)', () => {
  /** Shape metrics of one day of 5-minute candles. */
  function shape(growth: HistoricalGrowthProgram, day: number) {
    const candles = new TestMarketSimulation(listingSimulationConfig(config(growth))).candles5m(FROM + (day + 1) * DAY - 1, FROM + day * DAY).slice(0, 288);
    const bodies = candles.map(c => Math.abs(Math.log(c.close / c.open)));
    const mean = bodies.reduce((a, b) => a + b, 0) / bodies.length, sd = Math.sqrt(bodies.reduce((a, b) => a + (b - mean) ** 2, 0) / bodies.length);
    let turns = 0;
    for (let i = 2; i < candles.length; i++) if (Math.sign(candles[i].close - candles[i - 1].close) * Math.sign(candles[i - 1].close - candles[i - 2].close) < 0) turns++;
    const wicks = candles.filter(c => c.high > Math.max(c.open, c.close) && c.low < Math.min(c.open, c.close)).length;
    const volumes = candles.map(c => c.quoteVolume), vMean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const vCv = Math.sqrt(volumes.reduce((a, b) => a + (b - vMean) ** 2, 0) / volumes.length) / vMean;
    return { bodyCv: sd / mean, turns, wickShare: wicks / candles.length, volumeCv: vCv };
  }

  test('v2 has micro pullbacks, unequal bodies, two-sided wicks and clustered volume; v1 is straight', () => {
    const report: Record<string, unknown> = {};
    for (const [name, growth] of Object.entries(PROGRAMS)) report[name] = [9, 21, 33].map(day => shape(growth, day));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report));
    for (const metrics of [...(report['reference v2'] as ReturnType<typeof shape>[]), ...(report['ohlc v2'] as ReturnType<typeof shape>[])]) {
      expect(metrics.turns).toBeGreaterThan(60);
      expect(metrics.bodyCv).toBeGreaterThan(0.5);
      expect(metrics.wickShare).toBeGreaterThan(0.5);
      expect(metrics.volumeCv).toBeGreaterThan(0.25);
    }
    for (const metrics of report['reference v1'] as ReturnType<typeof shape>[]) {
      // One straight leg a day: no turn, no two-sided wick.
      expect(metrics.turns).toBe(0);
      expect(metrics.wickShare).toBe(0);
    }
    for (const metrics of report['ohlc v1'] as ReturnType<typeof shape>[]) expect(metrics.turns).toBeLessThanOrEqual(3);
  });

  test('no artificial stall or wrap: every hour of the window moves; ticks never jump except at a source gap', () => {
    for (const growth of [reference, ohlc]) {
      const isOhlc = growth === ohlc, rows = growth.logs;
      for (let d = 0; d < days(growth); d++) {
        const { open, ticks } = dayTicks(growth, d);
        let run = 0, longestRun = 0, largestStep = 0, previous = open;
        for (let i = 0; i < ticks.length; i++) {
          run = ticks[i].price === previous ? run + 1 : 0;
          longestRun = Math.max(longestRun, run);
          largestStep = Math.max(largestStep, Math.abs(Math.log(ticks[i].price / previous)));
          previous = ticks[i].price;
        }
        // A flat run of 5 minutes (30 ticks) would be a stall; a 2 % tick would be a jump.
        expect({ day: d, stalled: longestRun >= 30, jumped: largestStep >= 0.02 }).toEqual({ day: d, stalled: false, jumped: false });
        let quietestHour = Infinity;
        for (let h = 0; h < 24; h++) {
          const hour = ticks.slice(h * 360, (h + 1) * 360).map(t => t.price);
          quietestHour = Math.min(quietestHour, Math.max(...hour) / Math.min(...hour));
        }
        expect(quietestHour).toBeGreaterThan(1.0001);
        if (d > 0) {
          // The only discontinuity is the source's own gap between a close and the next open (OHLC); none for a reference.
          const close = dayTicks(growth, d - 1).ticks.at(-1)!.price;
          if (isOhlc) expect(Math.log(open / close)).toBeCloseTo((rows[d][0] - rows[d - 1][3]) * historicalGrowthAlpha(growth) / 1e8, 9);
          else expect(open).toBe(close);
        }
      }
      // After the window the price stays on the last value: no loop back to the start.
      const end = days(growth) * 24, after = controlledScenarioHour(scheduled(growth), SEED, end + 5);
      expect(after.ticks.every(t => t.price === after.open)).toBe(true);
      expect(after.open).toBe(priceOf(growth)(rows[rows.length - 1][isOhlc ? 3 : 0]));
    }
  });
});

describe('aggregation, reproducibility and no look-ahead', () => {
  test('1m → 5m → 1h → 1d are the same canonical ticks', () => {
    for (const growth of [reference, ohlc]) {
      const asset = listingSimulationConfig(config(growth)), sim = new TestMarketSimulation(asset), dayStart = FROM + 12 * DAY, now = FROM + 13 * DAY;
      const m1 = sim.candles1m(now, dayStart).filter(c => c.openTime < now), m5 = sim.candles5m(now, dayStart).filter(c => c.openTime < now);
      expect([m1.length, m5.length]).toEqual([1440, 288]);
      // aggregateCandles starts from the 5m series; group the 1m candles here.
      const five = Array.from({ length: 288 }, (_, i) => {
        const part = m1.slice(i * 5, i * 5 + 5);
        return [part[0].openTime, part[0].open, Math.max(...part.map(c => c.high)), Math.min(...part.map(c => c.low)), part[4].close];
      });
      expect(five).toEqual(m5.map(c => [c.openTime, c.open, c.high, c.low, c.close]));
      expect(aggregateCandles(m5, HOUR).map(c => [c.open, c.high, c.low, c.close])).toEqual(testMarketCandles(asset, '1h', now, 25).slice(0, 24).map(c => [c.open, c.high, c.low, c.close]));
      const h1 = testMarketCandles(asset, '1h', now, 25).slice(0, 24), d1 = testMarketCandles(asset, '1d', now, 2)[0];
      expect(h1.map(c => [c.open, c.high, c.low, c.close])).toEqual(Array.from({ length: 24 }, (_, h) => {
        const part = m5.slice(h * 12, h * 12 + 12);
        return [part[0].open, Math.max(...part.map(c => c.high)), Math.min(...part.map(c => c.low)), part[11].close];
      }));
      expect([d1.open, d1.high, d1.low, d1.close]).toEqual([m5[0].open, Math.max(...m5.map(c => c.high)), Math.min(...m5.map(c => c.low)), m5[287].close]);
    }
  });

  test('a restart, another timeframe or a split query reproduce the market; the seed changes only the model', () => {
    for (const growth of [reference, ohlc]) {
      const at = FROM + 17 * DAY + 7 * HOUR;
      const a = new TestMarketSimulation(listingSimulationConfig(config(growth))).candles5m(at, at - 3 * DAY);
      expect(new TestMarketSimulation(listingSimulationConfig(config(growth))).candles5m(at, at - 3 * DAY)).toEqual(a);
      const split = [...new TestMarketSimulation(listingSimulationConfig(config(growth))).candles5m(at - DAY, at - 3 * DAY).slice(0, -1),
        ...new TestMarketSimulation(listingSimulationConfig(config(growth))).candles5m(at, at - DAY)];
      expect(split.slice(0, -1)).toEqual(a.slice(0, -1));
      const other = new TestMarketSimulation(listingSimulationConfig(config(growth, 'another-seed'))).candles5m(at, at - 3 * DAY);
      expect(other.map(c => c.close)).not.toEqual(a.map(c => c.close));
      // Daily truths do not depend on the seed.
      const d1 = (seed: string) => testMarketCandles(listingSimulationConfig(config(growth, seed)), '1d', FROM + 30 * DAY, 31).slice(0, 30);
      const [x, y] = [d1(SEED), d1('another-seed')];
      if (growth === ohlc) expect(y.map(c => [c.time, c.open, c.high, c.low, c.close])).toEqual(x.map(c => [c.time, c.open, c.high, c.low, c.close]));
      else expect(y.map(c => [c.time, c.open, c.close])).toEqual(x.map(c => [c.time, c.open, c.close]));
    }
  });

  test('no look-ahead: a day\'s path never depends on a later source day; a bot sees only the past', () => {
    const changeAfter = (rows: HistoricalGrowthSourceRow[], day: number) => rows.map((row, i) => i <= day ? row
      : row.open === undefined ? { ...row, close: row.close * 0.97 } : { ...row, open: row.open * 0.97, high: row.high! * 0.97, low: row.low! * 0.97, close: row.close * 0.97 });
    for (const kind of ['reference', 'ohlc'] as const) {
      const base = build(kind), rows = kind === 'ohlc' ? OHLC_ROWS : REFERENCE_ROWS;
      // Keep the global peak (and so alpha) unchanged: change only days after 12 that stay below it.
      const peakDay = base.logs.reduce((best, row, i) => (kind === 'ohlc' ? row[1] : row[0]) > (kind === 'ohlc' ? base.logs[best][1] : base.logs[best][0]) ? i : best, 0);
      expect(peakDay).toBeGreaterThan(13);
      const changed = buildHistoricalGrowthProgram({ ...{ scenarioId: base.scenarioId, source: kind === 'ohlc' ? OHLC_SOURCE : REFERENCE_SOURCE, targetPeakGrowthPercent: base.targetPeakGrowthPercent },
        rows: changeAfter(rows, 12).map((row, i) => i === peakDay ? rows[i] : row) });
      expect(historicalGrowthAlpha(changed)).toBe(historicalGrowthAlpha(base));
      // Reference day d reads samples d and d + 1; OHLC day d reads its own bar.
      for (let d = 0; d <= (kind === 'ohlc' ? 12 : 11); d++) expect(dayTicks(changed, d).ticks.map(t => t.price)).toEqual(dayTicks(base, d).ticks.map(t => t.price));
      const now = FROM + (kind === 'ohlc' ? 12 : 11) * DAY + 9 * HOUR + 40_000;
      expect(historicalGrowthObservation(changed, '2', SEED, FROM, now)).toEqual(historicalGrowthObservation(base, '2', SEED, FROM, now));
    }
  });

  test('a bot observation is the simulation\'s candles: closed days and the forming day so far', () => {
    for (const growth of [reference, ohlc]) {
      const now = FROM + 8 * DAY + 15 * HOUR + 30_000, seen = historicalGrowthObservation(growth, '2', SEED, FROM, now);
      const asset = listingSimulationConfig(config(growth));
      const d1 = testMarketCandles(asset, '1d', FROM + 8 * DAY, 9).slice(0, 8);
      expect(seen.closed).toHaveLength(8);
      seen.closed.forEach((day, i) => { for (const field of ['open', 'high', 'low', 'close'] as const) expect(Math.abs(day[field] - d1[i][field])).toBeLessThanOrEqual(1e-10); });
      const forming = new TestMarketSimulation(asset).candles5m(now, FROM + 8 * DAY);
      expect(seen.forming!.high / Math.max(...forming.map(c => c.high))).toBeCloseTo(1, 9);
      expect(seen.forming!.low / Math.min(...forming.map(c => c.low))).toBeCloseTo(1, 9);
      expect(seen.price / forming[forming.length - 1].close).toBeCloseTo(1, 9);
    }
  });
});

describe('guards and resources', () => {
  test('publication stays refused (HISTORICAL_RIGHTS_UNVERIFIED) and the listing stays a non-executable demo', () => {
    for (const growth of [reference, ohlc]) {
      const c = config(growth);
      expect(code(() => checkPublishable(c, null, FROM - 30 * DAY))).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
      expect(isHistoricalDemoConfig(c)).toBe(true);
      expect(c.tradable).toBe(false);
      expect(c.ownerAllocation).toBe('0');
    }
  });

  test('bounded cost: O(depth) per tick, no stored path; the whole 40-day window of both v2 programs in seconds', () => {
    const started = Date.now();
    let ticks = 0;
    for (const growth of [reference, ohlc]) {
      const s = scheduled(growth);
      for (let hour = 0; hour < days(growth) * 24; hour++) ticks += controlledScenarioHour(s, SEED, hour).ticks.length;
    }
    const ms = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ticks, ms, microsecondsPerTick: ms * 1000 / ticks }));
    expect(ticks).toBe((40 + 40) * 24 * 360);
    expect(ms).toBeLessThan(15_000);
  });
});
