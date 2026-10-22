import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { listingScenarioPreview, LISTING_PREVIEW_CANDLE_LIMIT } from '../listingPreview';
import * as marketService from '../../testMarkets/testMarketService';
import { simulationFor } from '../../testMarkets/testMarketSimulation';

const config = () => parseListingConfig({
  schemaVersion: 1, symbol: 'QPV', name: 'Preview fixture', logo: null,
  initialPrice: '0.80', listingAt: '2030-01-01T12:00:00Z', displayTimeZone: 'Europe/Kyiv',
  ownerAllocation: '0', seedMode: 'manual', seed: 'preview-fixture-0001', tradable: false,
  simulationProgram: defaultScenarioControls('0.80', 'WAVES'),
});

describe('persisted scenario preview windows', () => {
  test.each(['first24h', 'growth', 'afterGrowth'])('%s uses exactly the published generator and a bounded candle window', (horizon) => {
    const saved = config();
    const result = listingScenarioPreview(saved, '1h', horizon);
    const { from, to } = result.scenarioSummary;
    expect(result.candles).toEqual(marketService.testMarketCandles(listingSimulationConfig(saved), '1h', to, (to - from) / 3_600_000 + 1));
    expect(result.candles.length).toBeLessThanOrEqual(LISTING_PREVIEW_CANDLE_LIMIT);
    expect(result.scenarioSummary).toMatchObject({ horizon, initialPrice: '0.80', first24hPrice: '14.6', maxPrice: '74.776' });
    expect(result.scenarioSummary.observedHigh).toBe(Math.max(...result.candles.map(c => c.high)));
    expect(result.candles.every(c => c.high <= 74.776)).toBe(true);
    expect(simulationFor(listingSimulationConfig(saved)).priceAt(Date.parse(saved.listingAt) + 86_400_000)).toBeCloseTo(14.6, 10);
  });

  test('first-day window starts at launch; after-growth window begins only after all saved stages', () => {
    const saved = config();
    const start = Date.parse(saved.listingAt);
    const first = listingScenarioPreview(saved, '5m', 'first24h');
    expect(first.scenarioSummary).toMatchObject({ from: start, to: start + 86_400_000 });
    expect(first.candles).toHaveLength(289);
    const later = listingScenarioPreview(saved, '1h', 'afterGrowth');
    expect(later.scenarioSummary).toMatchObject({ from: start + 168 * 3_600_000, to: start + 192 * 3_600_000 });
  });

  test('excessive requests fail before candle generation, not after slicing a large history', () => {
    const generate = jest.spyOn(marketService, 'testMarketCandles');
    generate.mockClear();
    expect(() => listingScenarioPreview(config(), '1m', 'growth')).toThrow('более крупный интервал');
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });

  test('unavailable horizon or interval is rejected without changing the configuration', () => {
    const saved = config();
    const before = JSON.stringify(saved);
    expect(() => listingScenarioPreview(saved, '1h', 'forever')).toThrow('период предпросмотра');
    expect(() => listingScenarioPreview(saved, '100h', 'growth')).toThrow();
    expect(JSON.stringify(saved)).toBe(before);
  });
});
