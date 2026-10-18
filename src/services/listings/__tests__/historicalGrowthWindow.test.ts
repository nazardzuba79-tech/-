/**
 * Historical GROWTH WINDOW (voltex.historical-growth.v1, owner pack History20):
 * the growth follows a scaled historical window INSTEAD of the stages.
 * Synthetic fixtures only (not market data); no database, no network.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildHistoricalGrowthProgram, historicalGrowthAlpha, historicalGrowthCap, historicalGrowthDailyModel, historicalGrowthElapsedSeconds,
  historicalGrowthFold, historicalGrowthLogAt, historicalGrowthMaxPrice, historicalGrowthObservation, historicalGrowthPrice, sha256HexUtf8,
  validateHistoricalGrowthProgram, type HistoricalGrowthProgram, type HistoricalGrowthSourceRow,
} from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls, type ScenarioControlsProgram } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { listingScenarioPreview } from '../listingPreview';
import { setManagedListingAssets } from '../managedSnapshot';
import { HISTORICAL_DEMO_MESSAGE, isHistoricalDemoAsset, isHistoricalDemoConfig } from '../simulationContour';
import { assertSpotListing } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';
import { simulationFor, TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';
import { collateralMarket } from '../../../private-trading/native/service';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const LISTING_AT = '2026-11-02T00:00:00.000Z';
const FROM = Date.parse(LISTING_AT);
const SEED = 'vhxt-20261102-synthetic';

/** A deterministic synthetic walk (+~80× with ±6% shocks); not market data. */
function walk(days: number, ohlc: boolean, salt = 7): HistoricalGrowthSourceRow[] {
  let x = salt, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = price * (1 + (random() - .5) * .002);
    const close = open * Math.exp(Math.log(80) / days + (random() - .5) * .12);
    price = close;
    return ohlc ? { date, open, high: Math.max(open, close) * (1 + random() * .03), low: Math.min(open, close) * (1 - random() * .03), close } : { date, close };
  });
}
const REFERENCE_SOURCE = { provider: 'Coin Metrics', asset: 'BTC', quote: 'USD', metric: 'PriceUSD', dataKind: 'daily_reference', timeframe: '1d', sliceSha256: 'a'.repeat(64), license: 'CC-BY-NC-4.0' } as const;
const OHLC_SOURCE = { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } as const;
const REFERENCE_ROWS = walk(41, false), OHLC_ROWS = walk(40, true);
const reference = buildHistoricalGrowthProgram({ scenarioId: 'VHX-01-BTC', source: REFERENCE_SOURCE, targetPeakGrowthPercent: '11872.45', rows: REFERENCE_ROWS });
const ohlc = buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', source: OHLC_SOURCE, targetPeakGrowthPercent: '9348', rows: OHLC_ROWS });

function windowProgram(growth: HistoricalGrowthProgram, initialPrice = '2', patch: Partial<ScenarioControlsProgram> = {}): ScenarioControlsProgram {
  const base = defaultScenarioControls(initialPrice, 'CALM');
  return { ...base, stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window', historicalGrowth: growth,
    maxPrice: historicalGrowthMaxPrice(initialPrice, growth.targetPeakGrowthPercent), ...patch };
}
const config = (growth: HistoricalGrowthProgram = reference, extra: Partial<ListingConfig> = {}, patch: Partial<ScenarioControlsProgram> = {}): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol: 'VHXT', name: 'BotLab synthetic', logo: null, initialPrice: '2', listingAt: LISTING_AT,
  displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: SEED, tradable: false,
  simulationProgram: windowProgram(growth, String(extra.initialPrice ?? '2'), patch), ...extra,
});
const code = (fn: () => unknown) => { try { fn(); return 'ACCEPTED'; } catch (error) { return (error as { code?: string }).code ?? (error as Error).message; } };

afterEach(() => { setManagedListingAssets([]); jest.restoreAllMocks(); });

describe('format and source refusals', () => {
  test('only ln(P/A) is stored, the anchor is zero and the checksum covers the stored values', () => {
    expect(reference.logs[0]).toEqual([0]);
    expect(ohlc.logs[0][0]).toBe(0);
    expect(JSON.stringify(reference)).not.toContain(String(REFERENCE_ROWS[5].close).slice(0, 8));
    expect(reference.logsSha256).toBe(sha256HexUtf8(JSON.stringify(reference.logs)));
    expect(reference.clock).toEqual({ mode: 'REAL_TIME', sourceStepSeconds: 86400, scenarioStepSeconds: 86400 });
    expect(reference.source).toMatchObject({ asset: 'BTC', quote: 'USD', metric: 'PriceUSD', dataKind: 'daily_reference', timeframe: '1d', firstDate: '2020-01-01', lastDate: '2020-02-10' });
    expect(reference.rights).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
  });

  test('the dependency-free SHA-256 equals the platform one', () => {
    const { createHash } = require('crypto');
    for (const text of ['', 'abc', 'é'.repeat(70), JSON.stringify(ohlc.logs)]) expect(sha256HexUtf8(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });

  test.each([
    ['a gap', (rows: HistoricalGrowthSourceRow[]) => rows.filter((_, i) => i !== 10)],
    ['a duplicate date', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 11 ? { ...r, date: rows[10].date } : r)],
    ['NaN', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 3 ? { ...r, close: NaN } : r)],
    ['Infinity', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 3 ? { ...r, high: Infinity } : r)],
    ['a non-positive price', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 3 ? { ...r, low: 0 } : r)],
    ['invalid OHLC', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 4 ? { ...r, high: r.low! / 2 } : r)],
    ['H <= A', (rows: HistoricalGrowthSourceRow[]) => rows.map((r, i) => i === 0 ? { date: r.date, open: 100, high: 100, low: 90, close: 95 } : { date: r.date, open: 50, high: 50, low: 40, close: 45 })],
    ['too few days', (rows: HistoricalGrowthSourceRow[]) => rows.slice(0, 29)],
  ])('refuses %s', (_label, mutate) => {
    expect(() => buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', source: OHLC_SOURCE, targetPeakGrowthPercent: '9348', rows: mutate(OHLC_ROWS) })).toThrow(RangeError);
  });

  test('a stored value, the checksum, the anchor or the clock cannot be changed', () => {
    const tampered = { ...reference, logs: reference.logs.map((row, i) => i === 7 ? [row[0] + 1] : row) };
    expect(() => validateHistoricalGrowthProgram(tampered)).toThrow('Контрольная сумма');
    const shifted = { ...reference, logs: reference.logs.map(row => [row[0] + 5]) };
    expect(() => validateHistoricalGrowthProgram({ ...shifted, logsSha256: sha256HexUtf8(JSON.stringify(shifted.logs)) })).toThrow('опорной ценой');
    expect(() => validateHistoricalGrowthProgram({ ...reference, clock: { ...reference.clock, scenarioStepSeconds: 3600 as 86400 } })).toThrow('реальном времени');
    expect(() => validateHistoricalGrowthProgram({ ...reference, source: { ...reference.source, quote: 'USDT' } })).toThrow('Источник');
    expect(() => validateHistoricalGrowthProgram({ ...reference, source: { ...reference.source, lastDate: '2020-02-11' } })).toThrow('пропуски');
  });
});

describe('the mathematical contract', () => {
  const p0 = 2, cap = historicalGrowthCap('2', reference.targetPeakGrowthPercent);

  test('alpha = ln(M)/ln(H/A); the model reproduces exp(alpha·ln(P/A)) from the raw source', () => {
    const A = REFERENCE_ROWS[0].close, H = Math.max(...REFERENCE_ROWS.map(r => r.close)), M = 1 + 11872.45 / 100;
    // ln(P/A) is stored at 1e-8: alpha and every model value stay within 1e-8 / 2e-8 of the exact formula.
    expect(Math.abs(historicalGrowthAlpha(reference) / (Math.log(M) / Math.log(H / A)) - 1)).toBeLessThan(1e-8);
    REFERENCE_ROWS.forEach((row, i) => {
      const exact = p0 * Math.exp(Math.log(M) / Math.log(H / A) * Math.log(row.close / A));
      const model = historicalGrowthPrice(reference, p0, cap, reference.logs[i][0]);
      expect(Math.abs(model / exact - 1)).toBeLessThan(2e-8);
    });
  });

  test('the first value is P0, the global peak is P0·M = the cap, inclusive of every high', () => {
    for (const growth of [reference, ohlc]) {
      const model = historicalGrowthDailyModel(growth, '2');
      const peak = Math.max(...model.map(d => d.high));
      expect(model[0].open).toBe(2);
      expect(peak).toBeLessThanOrEqual(Number(historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent)));
      expect(peak / (2 * (1 + Number(growth.targetPeakGrowthPercent) / 100))).toBeCloseTo(1, 10);
    }
  });

  test('every turn and the sign of every move are kept (alpha > 0)', () => {
    const model = historicalGrowthDailyModel(reference, '2');
    REFERENCE_ROWS.slice(1).forEach((row, d) => {
      expect(Math.sign(model[d].close - model[d].open)).toBe(Math.sign(row.close - REFERENCE_ROWS[d].close));
    });
    const sourcePeak = REFERENCE_ROWS.reduce((best, row, i) => row.close > REFERENCE_ROWS[best].close ? i : best, 0);
    const modelPeak = model.reduce((best, day, i) => day.close > model[best].close ? i : best, 0);
    expect(modelPeak + 1).toBe(sourcePeak);
  });

  test('the inclusive peak range is +7248% … +15324%; outside it is refused', () => {
    const at = (target: string) => code(() => config(buildHistoricalGrowthProgram({ scenarioId: 'VHX-01-BTC', source: REFERENCE_SOURCE, targetPeakGrowthPercent: target, rows: REFERENCE_ROWS })));
    expect(at('7248')).toBe('ACCEPTED');
    expect(at('15324')).toBe('ACCEPTED');
    expect(() => buildHistoricalGrowthProgram({ scenarioId: 'VHX-01-BTC', source: REFERENCE_SOURCE, targetPeakGrowthPercent: '7247.99', rows: REFERENCE_ROWS })).toThrow('7248');
    expect(() => buildHistoricalGrowthProgram({ scenarioId: 'VHX-01-BTC', source: REFERENCE_SOURCE, targetPeakGrowthPercent: '15324.01', rows: REFERENCE_ROWS })).toThrow('15324');
  });
});

describe('a listing configuration', () => {
  test('the window replaces the stages: no stages, no hourly continuation, no day-one target, an exact cap', () => {
    expect(config().simulationProgram).toMatchObject({ growth: 'historical-window', stages: [], afterGrowth: 'range', maxPrice: '239.449' });
    const clip = { source: 'BTC/USDT' as const, sourceStart: '2018-01-01T00:00:00.000Z', resolution: '1h' as const, provenance: 'USER_SUPPLIED_UNVERIFIED' as const, bars: Array.from({ length: 24 }, () => [100, -100, 0] as [number, number, number]) };
    expect(code(() => config(reference, {}, { stages: defaultScenarioControls('2').stages }))).toBe('INVALID_SCENARIO');
    expect(code(() => config(reference, {}, { afterGrowth: 'historical', historical: { version: 1, clips: [clip] } }))).toBe('INVALID_SCENARIO');
    expect(code(() => config(reference, {}, { first24hGainPercent: '1725' }))).toBe('INVALID_SCENARIO');
    expect(code(() => config(reference, {}, { maxPrice: '239.45' }))).toBe('INVALID_SCENARIO');
    expect(code(() => config(reference, {}, { growth: undefined }))).toBe('INVALID_SCENARIO');
    // Legacy stages without a window are unchanged, and still need their day-one stage.
    expect(code(() => parseListingConfig({ ...config(), simulationProgram: { ...defaultScenarioControls('2'), stages: [] } }))).toBe('INVALID_SCENARIO');
    expect(code(() => parseListingConfig({ ...config(), simulationProgram: defaultScenarioControls('2') }))).toBe('ACCEPTED');
  });

  test('a stored window whose logs no longer match their checksum is refused on save', () => {
    const tampered = { ...reference, logs: reference.logs.map((row, i) => i === 3 ? [row[0] + 1] : row) };
    expect(code(() => config(tampered))).toBe('INVALID_SCENARIO');
  });

  test('the draft fits the existing 80 KB budget; a larger one is refused before the store', () => {
    expect(code(() => config(ohlc))).toBe('ACCEPTED');
    // 1500 OHLC days of ten-digit values: inside the format, outside the listing's 80 KB budget.
    const huge = { ...ohlc, logs: Array.from({ length: 1500 }, (_, i) => [1_000_000_000 + i, 1_900_000_000 + i, -1_000_000_000 - i, 1_500_000_000 + i]) };
    huge.logs[0] = [0, 1_900_000_000, -1_000_000_000, 1_500_000_000];
    const sized = { ...huge, source: { ...huge.source, lastDate: new Date(Date.parse(huge.source.firstDate + 'T00:00:00Z') + 1499 * DAY).toISOString().slice(0, 10) }, logsSha256: sha256HexUtf8(JSON.stringify(huge.logs)) };
    // The budget counts the whole listing, logo included (the same rule as the hourly continuation).
    const logo = 'data:image/png;base64,' + 'A'.repeat(16_000);
    expect(code(() => config(ohlc, { logo }))).toBe('ACCEPTED');
    expect(code(() => config(sized, { logo }))).toBe('HISTORICAL_DATA_TOO_LARGE');
  });
});

describe('isolation and the publication gate', () => {
  test('a window is a historical demo: never published, never tradable, nothing allocated', () => {
    expect(isHistoricalDemoConfig(config())).toBe(true);
    expect(isHistoricalDemoAsset(listingSimulationConfig(config()))).toBe(true);
    expect(code(() => checkPublishable(config(), null, FROM - 7 * DAY))).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
    expect(code(() => config(reference, { ownerAllocation: '5' }))).toBe('HISTORICAL_DEMO_NO_LEDGER');
    expect(code(() => config(reference, { tradable: true }))).toBe('DEMO_ONLY');
  });

  test('if it ever reached the catalogue, the real-money paths still refuse it', () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    expect(isTestAssetPairOrSymbol('VHXT/USDT')).toBe(true);
    expect(collateralMarket('VHXT')).toBeNull();
    for (const at of [FROM - HOUR, FROM, FROM + 10 * DAY, FROM + 400 * DAY]) expect(() => assertSpotListing('VHXT/USDT', at)).toThrow(HISTORICAL_DEMO_MESSAGE);
  });
});

describe('the simulation: REAL_TIME, one canonical path', () => {
  const asset = () => listingSimulationConfig(config(ohlc));
  const growth = ohlc;
  const alpha = historicalGrowthAlpha(growth), cap = historicalGrowthCap('2', growth.targetPeakGrowthPercent);

  test('the inlined generator equals the reference path, tick for tick', () => {
    const scheduled = asset().scheduledScenario as Parameters<typeof controlledScenarioHour>[0];
    for (const hour of [0, 1, 7, 8, 15, 16, 23, 24, 25, 200, 40 * 24 - 1, 40 * 24, 40 * 24 + 5]) {
      const generated = controlledScenarioHour(scheduled, SEED, hour);
      expect(generated.open).toBe(historicalGrowthPrice(growth, 2, cap, historicalGrowthLogAt(growth, SEED, hour * 3600), alpha));
      generated.ticks.forEach((tick, i) => expect(tick.price).toBe(historicalGrowthPrice(growth, 2, cap, historicalGrowthLogAt(growth, SEED, hour * 3600 + (i + 1) * 10), alpha)));
    }
  });

  test('the first tick opens at P0; every candle high of the whole window stays at or below the cap, which is reached', () => {
    const sim = new TestMarketSimulation(asset());
    const end = FROM + historicalGrowthElapsedSeconds(growth) * 1000;
    const candles = sim.candles5m(end, FROM);
    expect(candles[0].open).toBe(2);
    const top = Math.max(...candles.map(c => c.high));
    expect(top).toBeLessThanOrEqual(cap);
    expect(top / cap).toBeCloseTo(1, 9);
  });

  test('one source day is 24 scenario hours: each day ends on the model close', () => {
    const sim = simulationFor(asset());
    const model = historicalGrowthDailyModel(growth, '2');
    for (const day of [0, 1, 9, 20, 39]) expect(sim.priceAt(FROM + (day + 1) * DAY)! / model[day].close).toBeCloseTo(1, 9);
  });

  test('restart and query continuity: a fresh process and a split query see the same market', () => {
    const at = FROM + 12 * DAY + 5 * HOUR;
    const a = new TestMarketSimulation(asset()).candles5m(at, at - 2 * DAY);
    const b = new TestMarketSimulation(asset()).candles5m(at, at - 2 * DAY);
    expect(b).toEqual(a);
    // The candle forming at the split instant is dropped from the first half and comes whole from the second.
    const split = [...new TestMarketSimulation(asset()).candles5m(at - DAY, at - 2 * DAY).slice(0, -1), ...new TestMarketSimulation(asset()).candles5m(at, at - DAY)];
    expect(split.map(c => c.openTime)).toEqual(a.map(c => c.openTime));
    expect(split.slice(0, -1)).toEqual(a.slice(0, -1));
  });

  test('after the last source value the price stops: no automatic tail', () => {
    const sim = simulationFor(asset());
    const end = FROM + historicalGrowthElapsedSeconds(growth) * 1000;
    const last = sim.priceAt(end)!;
    for (const h of [1, 24, 24 * 30]) expect(sim.priceAt(end + h * HOUR)).toBe(last);
  });

  test('a daily reference has no invented wick: every tick moves along its log-linear line', () => {
    const scheduled = listingSimulationConfig(config(reference)).scheduledScenario as Parameters<typeof controlledScenarioHour>[0];
    const hour = controlledScenarioHour(scheduled, SEED, 30);
    hour.ticks.forEach((tick, i) => {
      const previous = i ? hour.ticks[i - 1].price : hour.open;
      expect(tick.high).toBe(Math.max(previous, tick.price));
      expect(tick.low).toBe(Math.min(previous, tick.price));
    });
  });
});

describe('what a bot may observe', () => {
  const now = FROM + 10 * DAY + 13 * HOUR + 25_000;
  const seen = historicalGrowthObservation(ohlc, '2', SEED, FROM, now);

  test('only closed days and the forming day up to now; no peak, target, alpha or scenario id', () => {
    expect(seen.closed).toHaveLength(10);
    expect(seen.asOf).toBe(FROM + 10 * DAY + 13 * HOUR + 20_000);
    const text = JSON.stringify(seen);
    for (const leak of ['targetPeakGrowthPercent', 'alpha', 'scenarioId', 'VHX', 'maxPrice', 'logs', ohlc.targetPeakGrowthPercent]) expect(text).not.toContain(leak);
    expect(seen.finished).toBe(false);
  });

  test('its values are the simulation\'s, and the forming day never shows its final high or low', () => {
    const sim = simulationFor(listingSimulationConfig(config(ohlc)));
    expect(seen.price / sim.priceAt(seen.asOf)!).toBeCloseTo(1, 9);
    const day10 = historicalGrowthDailyModel(ohlc, '2')[10];
    expect(seen.forming!.high).toBeLessThanOrEqual(day10.high);
    expect(seen.forming!.low).toBeGreaterThanOrEqual(day10.low);
    // A closed day as the simulation draws it: it opens on the previous close (the canonical
    // tick stream is continuous), then reaches the source day's high, low and close.
    const later = historicalGrowthObservation(ohlc, '2', SEED, FROM, FROM + 11 * DAY);
    const day9 = historicalGrowthDailyModel(ohlc, '2')[9];
    expect(later.closed[10]).toEqual({ openTime: FROM + 10 * DAY, open: day9.close, high: Math.max(day9.close, day10.high), low: Math.min(day9.close, day10.low), close: day10.close });
    const ticks = sim.candles5m(FROM + 11 * DAY - 1, FROM + 10 * DAY);
    expect(Math.max(...ticks.map(c => c.high)) / later.closed[10].high).toBeCloseTo(1, 9);
    expect(Math.min(...ticks.map(c => c.low)) / later.closed[10].low).toBeCloseTo(1, 9);
    expect(historicalGrowthObservation(ohlc, '2', SEED, FROM, FROM + 400 * DAY).finished).toBe(true);
  });

  test('folds are by source asset, never by candle', () => {
    expect(historicalGrowthFold('BTC')).toBe(historicalGrowthFold('BTC'));
    expect(new Set(['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'DOGE', 'LINK', 'AVAX', 'MATIC', 'DOT', 'LTC', 'XRP', 'XLM', 'ETC', 'XMR', 'TRX', 'UNI', 'AAVE', 'ATOM', 'NEAR'].map(historicalGrowthFold)).size).toBeGreaterThan(1);
  });
});

describe('the private preview stays bounded', () => {
  test('first day and ≤ 30-day fragments from a chosen day; the full window is never generated server-side', () => {
    const first = listingScenarioPreview(config(ohlc), '5m', 'first24h');
    expect(first.candles.length).toBeLessThanOrEqual(289);
    expect((first.scenarioSummary as { historicalGrowth?: unknown }).historicalGrowth).toMatchObject({ scenarioId: 'VHX-03-SOL', unit: 'SIMUSDT', clock: 'REAL_TIME', fromDay: 0, toDay: 1, windowDays: 40 });
    const fragment = listingScenarioPreview(config(ohlc), '4h', 'window', { fromDay: 15 });
    expect(fragment.scenarioSummary).toMatchObject({ from: FROM + 15 * DAY, to: FROM + 40 * DAY });
    expect(fragment.scenarioSummary.observedHigh).toBeLessThanOrEqual(Number(fragment.scenarioSummary.maxPrice));
    expect(code(() => listingScenarioPreview(config(ohlc), '5m', 'window', { fromDay: 0 }))).toBe('PREVIEW_INTERVAL_TOO_FINE');
    expect(code(() => listingScenarioPreview(config(ohlc), '4h', 'window', { fromDay: 40 }))).toBe('INVALID_PREVIEW_HORIZON');
    expect(code(() => listingScenarioPreview(config(ohlc), '4h', 'history'))).toBe('INVALID_PREVIEW_HORIZON');
  });
});

test('no new provider polling, network or clock in the window code', () => {
  for (const file of ['../../../shared/listingHistoricalGrowth.ts', '../../../shared/listingScenarioControls.ts', '../../testMarkets/simulationScenarioControls.ts',
    '../../../../frontend/src/pages/admin/historicalGrowthModel.ts', '../../../../frontend/src/pages/admin/historicalGrowthPack.ts']) {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    expect({ file, network: /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|setInterval\(|Date\.now\(|Math\.random\(/.test(source) }).toEqual({ file, network: false });
  }
});
