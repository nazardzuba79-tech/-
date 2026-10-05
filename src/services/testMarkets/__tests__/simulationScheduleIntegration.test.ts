import { NEURIX } from '../neurix';
import { VOLTORA } from '../testAssetConfig';
import { aggregateCandles, CANDLE_MS, DAY_MS, HOUR_MS, MINUTE_MS, simulationFor, TestMarketSimulation, TICK_MS } from '../testMarketSimulation';
import { testMarketCandles } from '../testMarketService';
import { nrxPublicResponse } from '../nrxPublic';
import { spotPriceSource } from '../nrxSpot';
import { scheduledScenarioHour } from '../simulationSchedule';

const L = NEURIX.listingAt;
const scenario = {
  version: 3, from: L + 3 * HOUR_MS + 17 * MINUTE_MS + 2 * TICK_MS,
  firstTargetAt: L + 6 * HOUR_MS + 17 * MINUTE_MS + 2 * TICK_MS,
  breakoutAt: Date.parse('2026-10-04T05:00:00Z'), secondTargetAt: Date.parse('2026-10-04T09:00:00Z'),
  thirdTargetAt: Date.parse('2026-10-04T13:00:00Z'),
  rangeEndAt: Date.parse('2026-10-06T13:00:00Z'), selloffEndAt: Date.parse('2026-10-06T19:00:00Z'),
  endAt: Date.parse('2026-10-17T18:00:00Z'), firstGainPercent: 840, secondGainPercent: 1745, thirdGainPercent: 7217,
  rangeFraction: .2, selloffFraction: .6,
};
const asset = { ...NEURIX, scheduledScenario: scenario };
const originalAsset = { ...NEURIX, scheduledScenario: undefined };
const ohlc = (c: { openTime: number; open: number; high: number; low: number; close: number }) => [c.openTime, c.open, c.high, c.low, c.close];

test('scheduled listing-relative targets replace future growth without moving listing or seed', () => {
  const market = new TestMarketSimulation(asset);
  expect(market.priceAt(L)).toBe(.8);
  expect(market.priceAt(scenario.firstTargetAt)).toBe(7.52);
  expect(market.priceAt(scenario.secondTargetAt)).toBe(14.76);
  expect(market.priceAt(scenario.thirdTargetAt)).toBe(58.536);
  expect(asset.listingAt).toBe(NEURIX.listingAt); expect(asset.seed).toBe(NEURIX.seed);
});

test('partial-hour cutoff preserves every displayed candle, completed trade and price through activation', () => {
  const market = new TestMarketSimulation(asset), original = new TestMarketSimulation(originalAsset);
  for (const at of [L, scenario.from - TICK_MS, scenario.from - 1, scenario.from]) {
    expect(market.candles5m(at)).toEqual(original.candles5m(at));
    expect(market.candles1m(at)).toEqual(original.candles1m(at));
    expect(market.recentTrades(at, 500)).toEqual(original.recentTrades(at, 500));
    expect(market.priceAt(at)).toBe(original.priceAt(at));
  }
});

test('scenario joins the raw canonical cutoff price without rounding its anchor', () => {
  const config = { ...scenario, from: L + 3 * HOUR_MS + 15 * MINUTE_MS };
  const original = new TestMarketSimulation(originalAsset), market = new TestMarketSimulation({ ...asset, scheduledScenario: config });
  const rawAnchor = original.hourPlan(3).boundaries[3];
  expect(rawAnchor).not.toBe(original.priceAt(config.from));
  const source = Array.from({ length: 360 }, () => ({ price: 1, high: 1, low: 1, volume: 1, quoteVolume: 1 }));
  const expected = scheduledScenarioHour(config, asset.seed, L, asset.initialPrice, 4, rawAnchor, original.hourPlan(4).open, source);
  expect(market.hourPlan(4).open).toBe(expected.open);
  expect(market.hourPlan(4).cycleTicks).toEqual(expected.ticks);
});

test('later requests cannot rewrite past history or leak uncompleted ticks', () => {
  const market = new TestMarketSimulation(asset), pastAt = scenario.from + 17 * MINUTE_MS + 1;
  const candles = market.candles5m(pastAt), trades = market.recentTrades(pastAt, 500);
  market.priceAt(scenario.endAt); market.candles5m(scenario.secondTargetAt, scenario.firstTargetAt);
  expect(market.candles5m(pastAt)).toEqual(candles);
  expect(market.recentTrades(pastAt, 500)).toEqual(trades);
  expect(trades.every(trade => trade.timestamp <= pastAt)).toBe(true);
  expect(new TestMarketSimulation(asset).candles5m(pastAt)).toEqual(candles);
});

test('schedule fields isolate simulator cache from baseline and other schedules', () => {
  const market = simulationFor(asset);
  const same = { ...asset, scheduledScenario: { ...scenario } };
  expect(simulationFor(same)).toBe(market);
  expect(simulationFor(originalAsset)).not.toBe(market);
  for (const field of Object.keys(scenario) as (keyof typeof scenario)[]) {
    const changed = { ...asset, scheduledScenario: { ...scenario, [field]: scenario[field] + 1 } };
    expect(simulationFor(changed)).not.toBe(market);
  }
});

test.each([scenario.from + 43 * MINUTE_MS + 17_000, scenario.firstTargetAt, scenario.secondTargetAt, scenario.thirdTargetAt, scenario.selloffEndAt])('1m, 5m and higher OHLC stay one canonical stream at %i', at => {
  const market = new TestMarketSimulation(asset), from = at - 3 * HOUR_MS;
  const start = L + Math.floor((from - L) / CANDLE_MS) * CANDLE_MS;
  const minutes = market.candles1m(at, start), fives = market.candles5m(at, start);
  // aggregateCandles intentionally accepts canonical 5m input; derive the
  // independent five-minute OHLC here to verify the separate minute reader.
  const rolled = [];
  for (let i = 0; i < minutes.length; i += 5) {
    const group = minutes.slice(i, i + 5);
    rolled.push([group[0].openTime, group[0].open, Math.max(...group.map(c => c.high)), Math.min(...group.map(c => c.low)), group[group.length - 1].close]);
  }
  expect(rolled).toEqual(fives.map(ohlc));
  const c15 = aggregateCandles(fives, 15 * MINUTE_MS);
  expect(aggregateCandles(c15, HOUR_MS).map(ohlc)).toEqual(aggregateCandles(fives, HOUR_MS).map(ohlc));
  for (const candle of fives) {
    expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
    expect(candle.low).toBeGreaterThan(0);
    expect([candle.open, candle.high, candle.low, candle.close, candle.volume, candle.quoteVolume].every(Number.isFinite)).toBe(true);
  }
  const latest = market.recentTrades(at, 1)[0];
  expect(Number(latest.price)).toBe(market.priceAt(at));
});

test('NRX-only schedule cannot alter VTA candles, trade prices or volumes', () => {
  const foreign = { ...VOLTORA, scheduledScenario: scenario };
  const original = new TestMarketSimulation(VOLTORA), unrelated = new TestMarketSimulation(foreign);
  const at = scenario.thirdTargetAt;
  expect(unrelated.candles5m(at, at - 2 * HOUR_MS)).toEqual(original.candles5m(at, at - 2 * HOUR_MS));
  expect(unrelated.recentTrades(at)).toEqual(original.recentTrades(at));
});

test.each([scenario.endAt + TICK_MS, scenario.endAt + HOUR_MS])('after the two-week window trading continues in terminal range at %i', at => {
  const market = new TestMarketSimulation(asset), reference = .8 * (1 + 7217 / 100) * (1 - .6);
  const trade = market.recentTrades(at, 1)[0];
  expect(Number(trade.quantity)).toBeGreaterThan(0); expect(Number(trade.quoteVolume)).toBeGreaterThan(0);
  expect(trade.timestamp).toBe(at);
  expect(market.priceAt(at)).toBeGreaterThanOrEqual(reference * .8);
  expect(market.priceAt(at)).toBeLessThanOrEqual(reference * 1.2);
  expect(market.candles5m(at - 1, at - CANDLE_MS)[0].volume).toBeGreaterThan(0);
});

test('far future remains finite in terminal range without computing obsolete legacy growth', () => {
  const observed: number[] = [];
  const original = TestMarketSimulation.prototype.hourPlan;
  const spy = jest.spyOn(TestMarketSimulation.prototype, 'hourPlan').mockImplementation(function (this: TestMarketSimulation, hour) {
    if (!this.asset.scheduledScenario) observed.push(hour);
    return original.call(this, hour);
  });
  try {
    const market = new TestMarketSimulation(asset), at = scenario.endAt + 1000 * DAY_MS;
    const price = market.priceAt(at)!;
    expect(Number.isFinite(price)).toBe(true); expect(price).toBeGreaterThan(18); expect(price).toBeLessThan(29);
    expect(market.recentTrades(at, 1)[0].quantity).not.toBe('0.00000000');
    expect(observed.every(hour => hour <= Math.floor((scenario.from - L) / HOUR_MS))).toBe(true);
  } finally { spy.mockRestore(); }
});

test('public edge ticker/trades/candles and backend Spot price use the same future NRX simulation', async () => {
  const at = scenario.thirdTargetAt, source = { getTicker: jest.fn() };
  const request = async (path: string) => nrxPublicResponse(new Request(`https://market.voltextech.net${path}`), () => at)!.json();
  const ticker = await request('/market/ticker/NRX-USDT');
  const trades = await request('/market/external/trades/NRX-USDT');
  const candles = await request('/market/test-assets/NRX-USDT/candles?interval=1m');
  // NEURIX carries no scheduled plan since 2026-10-05; parity is with whatever it runs.
  expect(Number(ticker.ticker.lastPrice)).toBe(simulationFor(NEURIX).priceAt(at));
  expect(Number(trades.trades[0].price)).toBe(Number(ticker.ticker.lastPrice));
  expect(candles.candles).toEqual(testMarketCandles(NEURIX, '1m', at));
  expect((await spotPriceSource(source, () => at).getTicker(NEURIX.pair))?.lastPrice).toBe(ticker.ticker.lastPrice);
  expect(source.getTicker).not.toHaveBeenCalled();
});
