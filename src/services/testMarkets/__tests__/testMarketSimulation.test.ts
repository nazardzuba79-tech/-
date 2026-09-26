import { VOLTORA, testAssetForPair, testAssetForSymbol, isTestAssetPairOrSymbol } from '../testAssetConfig';
import { publicTestAsset, testMarketCandles } from '../testMarketService';
import {
  TestMarketSimulation, aggregateCandles, blockCounts, blockSchedule, getCurrentTestMarketState,
  impulseRate, CANDLE_MS, DAY_MS, HOUR_MS, SIM_INTERVALS, TICK_MS, type SimCandle,
} from '../testMarketSimulation';

const L = VOLTORA.listingAt;
const fresh = () => new TestMarketSimulation(VOLTORA);

describe('VOLTORA is a test asset, recognised however the pair is spelled', () => {
  test('config', () => {
    expect(VOLTORA).toMatchObject({ symbol: 'VTA', name: 'VOLTORA', pair: 'VTA/USDT', isTestAsset: true, isTradable: false, initialPrice: 0.01 });
    expect(new Date(VOLTORA.listingAt).toISOString()).toBe('2026-09-27T16:00:00.000Z');
  });
  test.each(['VTA/USDT', 'VTAUSDT', 'vta-usdt', ' vta_usdt '])('%s', (pair) => {
    expect(testAssetForPair(pair)).toBe(VOLTORA);
    expect(isTestAssetPairOrSymbol(pair)).toBe(true);
  });
  test('real pairs and symbols are not test assets', () => {
    for (const value of ['BTC/USDT', 'ETH/USDT', 'BTCUSDT', 'USDT', 'BTC', '', null, undefined]) expect(isTestAssetPairOrSymbol(value)).toBe(false);
    expect(testAssetForSymbol('vta')).toBe(VOLTORA);
  });
  test('an unarmed production-style asset stays pre-listing even after its nominal time', () => {
    const frozen = { ...VOLTORA, listingArmed: false };
    const after = L + 48 * HOUR_MS;
    expect(publicTestAsset(frozen, after)).toMatchObject({ listingArmed: false, state: { phase: 'pre-listing', lastPrice: null } });
    expect(testMarketCandles(frozen, '5m', after)).toEqual([]);
  });
});

describe('before the listing there is nothing to show', () => {
  test.each([L - DAY_MS, L - 1])('no candles and no price at %s', (now) => {
    const sim = fresh();
    expect(sim.candles5m(now)).toEqual([]);
    expect(sim.priceAt(now)).toBeNull();
    const state = getCurrentTestMarketState(sim, now);
    expect(state).toMatchObject({ phase: 'pre-listing', lastPrice: null, change24hPercent: null, high24h: null, low24h: null, volume24h: null, isTradable: false });
    expect(state.serverTime).toBe(now);
  });

  test('the first candle appears at the listing instant, at the listing price', () => {
    for (const now of [L, L + 1, L + TICK_MS - 1]) {
      const candles = fresh().candles5m(now);
      expect(candles).toHaveLength(1);
      expect(candles[0]).toMatchObject({ openTime: L, open: 0.01, high: 0.01, low: 0.01, close: 0.01, volume: 0 });
    }
    const afterFirstTick = fresh().candles5m(L + TICK_MS);
    expect(afterFirstTick).toHaveLength(1);
    expect(afterFirstTick[0].volume).toBeGreaterThan(0);
    expect(getCurrentTestMarketState(fresh(), L).phase).toBe('live');
  });
});

describe('determinism', () => {
  test('two independent simulations, and a refresh, give the same history', () => {
    const now = L + 30 * HOUR_MS + 123_456;
    const a = fresh().candles5m(now);
    const second = fresh();
    const b = second.candles5m(now);
    expect(b).toEqual(a);
    expect(second.candles5m(now)).toEqual(a);
  });

  test('history already shown never changes as time passes', () => {
    const sim = fresh();
    const early = sim.candles5m(L + 5 * HOUR_MS);
    const later = fresh().candles5m(L + 9 * HOUR_MS);
    // Every closed candle of the earlier view is identical later.
    expect(later.slice(0, early.length - 1)).toEqual(early.slice(0, -1));
  });

  test('a different seed is a different market', () => {
    const other = new TestMarketSimulation({ ...VOLTORA, seed: 'another-seed' });
    expect(other.candles5m(L + 2 * HOUR_MS)).not.toEqual(fresh().candles5m(L + 2 * HOUR_MS));
  });
});

describe('no future leaks into what is served', () => {
  test('no candle opens after now, and the forming candle only knows completed ticks', () => {
    const sim = fresh();
    const candleOpen = L + 7 * HOUR_MS + 2 * CANDLE_MS;
    const final = fresh().candles5m(candleOpen + CANDLE_MS, candleOpen)[0];
    let previous: SimCandle | null = null;
    for (let t = candleOpen; t < candleOpen + CANDLE_MS; t += 7_000) {
      const candles = sim.candles5m(t);
      expect(candles.every((c) => c.openTime <= t)).toBe(true);
      const forming = candles[candles.length - 1];
      expect(forming.openTime).toBe(candleOpen);
      // A prefix of the final candle: its range only grows toward the final one.
      expect(forming.high).toBeLessThanOrEqual(final.high);
      expect(forming.low).toBeGreaterThanOrEqual(final.low);
      expect(forming.volume).toBeLessThanOrEqual(final.volume);
      if (previous) {
        expect(forming.high).toBeGreaterThanOrEqual(previous.high);
        expect(forming.low).toBeLessThanOrEqual(previous.low);
      }
      // Within one 10s tick nothing moves: the tick still in progress is unknown.
      const sameTick = sim.candles5m(Math.floor((t - candleOpen) / TICK_MS) * TICK_MS + candleOpen + TICK_MS - 1);
      expect(sameTick[sameTick.length - 1]).toEqual(forming);
      previous = forming;
    }
  });
});

describe('OHLCV invariants over the first week', () => {
  const candles = fresh().candles5m(L + 7 * DAY_MS - 1);
  test('every candle is possible and continues the previous close', () => {
    expect(candles).toHaveLength(7 * 288);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      expect(c.openTime).toBe(L + i * CANDLE_MS);
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.low).toBeGreaterThan(0);
      expect(Number.isFinite(c.high) && Number.isFinite(c.volume)).toBe(true);
      if (i > 0) expect(c.open).toBe(candles[i - 1].close);
      if (i < candles.length - 1) expect(c.volume).toBeGreaterThan(0);
    }
  });
});

describe('the first 48 hours', () => {
  test('25 impulse, 17 consolidation, 6 pullback hours, mixed, opening on an impulse', () => {
    const schedule = blockSchedule(VOLTORA.seed, 0);
    expect(schedule).toHaveLength(48);
    expect(schedule.filter((r) => r === 'impulse')).toHaveLength(25);
    expect(schedule.filter((r) => r === 'consolidation')).toHaveLength(17);
    expect(schedule.filter((r) => r === 'pullback')).toHaveLength(6);
    expect(schedule[0]).toBe('impulse');
    let run = 1;
    for (let i = 1; i < schedule.length; i++) {
      run = schedule[i] === schedule[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(schedule[i] === 'impulse' ? 4 : schedule[i] === 'consolidation' ? 3 : 2);
    }
  });

  test('P48 = P0 × 1.30^25 × 0.96^6 ≈ 5.5235 (+55,135%)', () => {
    const anchor = 0.01 * Math.pow(1.3, 25) * Math.pow(0.96, 6);
    expect(anchor).toBeCloseTo(5.5235, 3);
    const p48 = fresh().priceAt(L + 48 * HOUR_MS) as number;
    expect(Math.abs(p48 / anchor - 1)).toBeLessThan(1e-6);
  });

  test('each hour stays in its regime band', () => {
    const sim = fresh();
    for (let hour = 0; hour < 48; hour++) {
      const plan = sim.hourPlan(hour);
      const r = Math.exp(plan.logReturn) - 1;
      if (plan.regime === 'impulse') { expect(r).toBeGreaterThan(0.18); expect(r).toBeLessThan(0.45); }
      if (plan.regime === 'pullback') { expect(r).toBeLessThan(0); expect(r).toBeGreaterThan(-0.09); }
      if (plan.regime === 'consolidation') expect(Math.abs(r)).toBeLessThanOrEqual(0.0091);
    }
  });

  test('a liquid market, not a staircase: red candles in impulses, green in pullbacks, volume with the move', () => {
    const sim = fresh();
    const candles = sim.candles5m(L + 48 * HOUR_MS - 1);
    const by = { impulse: [] as SimCandle[], consolidation: [] as SimCandle[], pullback: [] as SimCandle[] };
    candles.forEach((c, i) => by[sim.hourPlan(Math.floor(i / 12)).regime].push(c));
    const share = (list: SimCandle[], up: boolean) => list.filter((c) => (up ? c.close > c.open : c.close < c.open)).length / list.length;
    expect(share(by.impulse, false)).toBeGreaterThan(0.08);
    expect(share(by.pullback, true)).toBeGreaterThan(0.15);
    const avg = (list: SimCandle[], f: (c: SimCandle) => number) => list.reduce((s, c) => s + f(c), 0) / list.length;
    const body = (c: SimCandle) => Math.abs(c.close / c.open - 1);
    expect(avg(by.impulse, body)).toBeGreaterThan(3 * avg(by.consolidation, body));
    expect(avg(by.impulse, (c) => c.quoteVolume)).toBeGreaterThan(2 * avg(by.consolidation, (c) => c.quoteVolume));
    expect(avg(by.pullback, (c) => c.quoteVolume)).toBeGreaterThan(avg(by.consolidation, (c) => c.quoteVolume));
    // Volume is never flat.
    expect(new Set(candles.map((c) => c.volume)).size).toBe(candles.length);
  });
});

describe('after 48 hours the impulse decays by 20% a day', () => {
  test('R(day)', () => {
    const expected = [0.3, 0.3, 0.24, 0.192, 0.1536, 0.12288, 0.098304, 0.0786432, 0.06291456, 0.050331648];
    expected.forEach((value, i) => expect(impulseRate(i + 1)).toBeCloseTo(value, 12));
  });

  test.each([3, 4, 5, 9])('day %i closes exactly on its anchor', (day) => {
    const counts = blockCounts(day - 2);
    expect(counts.impulse + counts.consolidation + counts.pullback).toBe(24);
    const sim = fresh();
    const start = sim.priceAt(L + (day - 1) * DAY_MS) as number;
    const end = sim.priceAt(L + day * DAY_MS) as number;
    const anchor = Math.pow(1 + impulseRate(day), counts.impulse) * Math.pow(0.96, counts.pullback);
    expect(Math.abs(end / start / anchor - 1)).toBeLessThan(1e-6);
  });
});

describe('every timeframe is the same history', () => {
  const five = fresh().candles5m(L + 3 * DAY_MS + 17 * CANDLE_MS + 23_000);
  test.each(['15m', '1h', '4h', '1d'])('%s aggregates the canonical 5m candles', (interval) => {
    const size = SIM_INTERVALS[interval];
    const out = aggregateCandles(five, size);
    const groups = new Map<number, SimCandle[]>();
    for (const c of five) {
      const bucket = Math.floor(c.openTime / size) * size;
      groups.set(bucket, [...(groups.get(bucket) ?? []), c]);
    }
    expect(out.map((c) => c.openTime)).toEqual([...groups.keys()]);
    for (const c of out) {
      const members = groups.get(c.openTime) as SimCandle[];
      expect(c.openTime % size).toBe(0);
      expect(c.open).toBe(members[0].open);
      expect(c.close).toBe(members[members.length - 1].close);
      expect(c.high).toBe(Math.max(...members.map((m) => m.high)));
      expect(c.low).toBe(Math.min(...members.map((m) => m.low)));
      expect(c.volume).toBeCloseTo(members.reduce((s, m) => s + m.volume, 0), 3);
    }
    expect(out[out.length - 1].close).toBe(five[five.length - 1].close);
  });
  test('the daily candle of the listing day starts at 00:00 UTC and opens at the listing price', () => {
    const daily = aggregateCandles(five, SIM_INTERVALS['1d']);
    expect(new Date(daily[0].openTime).toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(daily[0].open).toBe(0.01);
  });
});

describe('24h statistics come from the candles', () => {
  test.each([0.5, 12, 24, 30.25, 48, 75])('+%sh', (hours) => {
    const sim = fresh();
    const now = L + hours * HOUR_MS + 4_321;
    const state = getCurrentTestMarketState(sim, now);
    const window = fresh().candles5m(now, now - DAY_MS);
    const last = window[window.length - 1].close;
    const reference = now - DAY_MS <= L ? 0.01 : (fresh().priceAt(now - DAY_MS) as number);
    expect(state.phase).toBe('live');
    expect(state.lastPrice).toBe(last);
    expect(state.lastPrice).toBe(sim.priceAt(now));
    expect(state.openPrice24h).toBe(reference);
    expect(state.change24hPercent).toBeCloseTo((last / reference - 1) * 100, 9);
    expect(state.high24h).toBe(Math.max(...window.map((c) => c.high)));
    expect(state.low24h).toBe(Math.min(...window.map((c) => c.low)));
    expect(state.volume24h).toBeCloseTo(window.reduce((s, c) => s + c.volume, 0), 3);
    expect(state.isTradable).toBe(false);
  });
});
