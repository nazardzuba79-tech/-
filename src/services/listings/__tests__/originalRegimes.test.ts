import { ORIGINAL_MODEL_VERSION, ORIGINAL_REGIMES, ORIGINAL_PROVENANCE } from '../../../shared/originalSimulationRegimes';
import { originalModelHour } from '../../testMarkets/originalSimulation';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { checkPublishable, listingSimulationConfig, parseListingConfig, withStableProfile, type ListingConfig, type PublishedListing } from '../listingConfig';
import { managedListingResponse } from '../listingPublic';
import { setManagedListingAssets } from '../managedSnapshot';
import { isHistoricalDemoAsset, isHistoricalDemoConfig } from '../simulationContour';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';
import { collateralMarket } from '../../../private-trading/native/service';
import { allocateListingOwner } from '../ownerAllocation';
import { WalletPortfolioService } from '../../WalletPortfolioService';

const HOUR = 3600000;
const FROM = Date.UTC(2030, 0, 1);
const model = (id: typeof ORIGINAL_REGIMES[number]['id'] = 'G01') => ({
  id, version: ORIGINAL_MODEL_VERSION, disclosure: 'SIMULATED_ORIGINAL_MODEL' as const,
});
const config = (extra: Partial<ListingConfig> = {}) => parseListingConfig({
  schemaVersion: 1, symbol: 'OGX', name: 'Original simulation', logo: null,
  initialPrice: '2', listingAt: new Date(FROM).toISOString(), displayTimeZone: 'UTC',
  seedMode: 'manual', seed: 'original-qa-seed', tradable: false, ownerAllocation: '0',
  originalRegime: model(), ...extra,
});
afterEach(() => setManagedListingAssets([]));

describe('20 original models, no historical source dependency', () => {
  test.each(ORIGINAL_REGIMES)('$id deterministic path, varied morphology, volume and restart continuity', regime => {
    const cfg = config({ originalRegime: model(regime.id) });
    const asset = listingSimulationConfig(cfg);
    const now = FROM + regime.hours * HOUR - 1;
    const bars = testMarketCandles(asset, '5m', now, 1000);
    const hourly = testMarketCandles(asset, '1h', now, 1000);
    expect(hourly.filter(bar => bar.close > bar.open).length).toBeGreaterThan(5);
    expect(hourly.filter(bar => bar.close < bar.open).length).toBeGreaterThan(5);
    const fresh = new TestMarketSimulation(asset);
    const bodies = bars.map(bar => Math.abs(bar.close - bar.open) / (bar.high - bar.low));
    expect(bars.length).toBeGreaterThan(500);
    expect(bars.some(bar => bar.close > bar.open)).toBe(true);
    expect(bars.some(bar => bar.close < bar.open)).toBe(true);
    expect(bodies.filter(value => value < .25).length).toBeGreaterThan(10);
    expect(bodies.filter(value => value > .7).length).toBeGreaterThan(10);
    expect(new Set(bars.map(bar => bar.volume)).size).toBeGreaterThan(400);
    expect(bars.some(bar => bar.high - Math.max(bar.open, bar.close) > Math.abs(bar.close - bar.open))).toBe(true);
    expect(bars.some(bar => Math.min(bar.open, bar.close) - bar.low > Math.abs(bar.close - bar.open))).toBe(true);
    for (const bar of bars) {
      expect(bar.low).toBeGreaterThan(0);
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.volume).toBeGreaterThan(0);
    }
    for (const hour of [regime.hours, regime.hours - 1, 0, 3, 97]) {
      const plan = originalModelHour(model(regime.id), asset.seed, 2, hour);
      expect(fresh.hourPlan(hour)).toEqual(plan);
      const next = originalModelHour(model(regime.id), asset.seed, 2, hour + 1);
      expect(plan.boundaries[12]).toBe(next.open);
      for (const tick of plan.cycleTicks) {
        expect(tick.quoteVolume / tick.volume).toBeGreaterThanOrEqual(tick.low * (1 - 1e-12));
        expect(tick.quoteVolume / tick.volume).toBeLessThanOrEqual(tick.high * (1 + 1e-12));
      }
    }
    expect(fresh.hourPlan(0).open).toBe(2);
    expect(originalModelHour(model(regime.id), 'other-seed', 2, 2)).not.toEqual(fresh.hourPlan(2));
    // Cache eviction and later requests cannot rewrite an already formed hour.
    const old = fresh.hourPlan(0);
    for (let hour = 100; hour < 205; hour++) fresh.hourPlan(hour);
    expect(fresh.hourPlan(0)).toEqual(old);
  });

  test('20 paths are distinct; UTC aggregates match the same minute observations', () => {
    const signatures = ORIGINAL_REGIMES.map(regime => JSON.stringify(originalModelHour(model(regime.id), 'same-seed', 2, 7)));
    expect(new Set(signatures).size).toBe(20);
    const asset = listingSimulationConfig(config());
    const now = FROM + HOUR - 1;
    const minutes = testMarketCandles(asset, '1m', now, 60);
    const hour = testMarketCandles(asset, '1h', now, 1)[0];
    expect(hour.open).toBe(minutes[0].open);
    expect(hour.close).toBe(minutes[59].close);
    expect(hour.high).toBe(Math.max(...minutes.map(bar => bar.high)));
    expect(hour.low).toBe(Math.min(...minutes.map(bar => bar.low)));
    expect(hour.volume / minutes.reduce((sum, bar) => sum + bar.volume, 0)).toBeCloseTo(1, 6);
    const frozen = testMarketCandles(asset, '1m', FROM + 59 * 60000 - 1, 59);
    // The final minute is still forming at :58.999; compare only completed minutes.
    expect(minutes.slice(0, 58)).toEqual(frozen.slice(0, 58));
    for (const interval of ['1m', '5m', '15m', '1h', '4h', '1d']) {
      const partial = testMarketCandles(asset, interval, FROM + 17000, 10);
      expect(partial.length).toBe(1);
      expect(partial[0].close).toBeCloseTo(new TestMarketSimulation(asset).priceAt(FROM + 17000)!, 7);
    }
  });
});

describe('future-only opt-in and immutable history', () => {
  test('a non-hour five-minute start preserves UTC minute/hour aggregation', () => {
    const asset = listingSimulationConfig(config({ listingAt: new Date(FROM + 35 * 60000).toISOString() }));
    const now = FROM + 2 * HOUR - 1;
    const minutes = testMarketCandles(asset, '1m', now, 60);
    const hour = testMarketCandles(asset, '1h', now, 1)[0];
    expect(hour.open).toBe(minutes[0].open);
    expect(hour.close).toBe(minutes[59].close);
    expect(hour.high).toBe(Math.max(...minutes.map(bar => bar.high)));
    expect(hour.low).toBe(Math.min(...minutes.map(bar => bar.low)));
    expect(hour.volume / minutes.reduce((sum, bar) => sum + bar.volume, 0)).toBeCloseTo(1, 6);
    expect(() => config({ listingAt: new Date(FROM + 61000).toISOString() })).toThrow();
  });
  test('automatic assignment covers all 20 modes and is fixed on later saves', () => {
    const auto = config({ originalRegime: { ...model(), id: 'AUTO' } });
    for (let ordinal = 0; ordinal < 40; ordinal++) {
      const assigned = withStableProfile(auto, null, ordinal);
      expect(assigned.originalRegime?.id).toBe(ORIGINAL_REGIMES[ordinal % 20].id);
      expect(withStableProfile({ ...assigned, originalRegime: undefined }, assigned, null).originalRegime).toEqual(assigned.originalRegime);
      const other = ORIGINAL_REGIMES[(ordinal + 1) % 20].id;
      expect(() => withStableProfile(config({ originalRegime: model(other) }), assigned, null)).toThrow();
    }
    expect(() => checkPublishable(auto, null, FROM - HOUR)).toThrow();
  });
  test('existing listings cannot adopt this mode; historical rights gate stays closed', () => {
    const legacy = config({ originalRegime: undefined });
    expect(() => withStableProfile(config(), legacy, null)).toThrow();
    expect(() => checkPublishable(config(), legacy, FROM - HOUR)).toThrow();
    expect(() => checkPublishable(config(), null, FROM + 1)).toThrow();
    expect(() => checkPublishable(config(), null, FROM - HOUR)).not.toThrow();
    expect(() => checkPublishable(config({ history20Regime: { version: 2, id: 'AUTO' }, originalRegime: undefined }), null, FROM - HOUR))
      .toThrow(expect.objectContaining({ code: 'HISTORICAL_RIGHTS_UNVERIFIED' }));
    const current = config();
    for (const change of [{ seed: 'changed-seed' }, { initialPrice: '3' }, { originalRegime: model('G02') }, { originalRegime: undefined }])
      expect(() => checkPublishable(config(change), current, FROM + HOUR)).toThrow();
  });
});

describe('disclosed public data, isolated from execution and money', () => {
  test('rejects inventory, execution, private funding and mixed model configurations', () => {
    for (const change of [{ tradable: true }, { ownerAllocation: '1' }, { history20Regime: { version: 2, id: 'AUTO' } },
      { privateTest: { settlement: 'SIMUSDT', funding: { base: '1', quote: '1' } } }])
      expect(() => config(change as Partial<ListingConfig>)).toThrow();
  });
  test('real trading, collateral and price-trigger paths refuse the model', async () => {
    const cfg = config(), asset = listingSimulationConfig(cfg);
    setManagedListingAssets([asset]);
    expect(isHistoricalDemoConfig(cfg)).toBe(true);
    expect(isHistoricalDemoAsset(asset)).toBe(true);
    expect(isTestAssetPairOrSymbol('OGX')).toBe(true);
    expect(collateralMarket('OGX')).toBeNull();
    expect(() => assertSpotListing('OGX/USDT', FROM + HOUR)).toThrow();
    const venue = { getTicker: jest.fn() };
    expect(await spotPriceSource(venue, () => FROM + HOUR).getTicker('OGX/USDT')).toBeNull();
    expect(venue.getTicker).not.toHaveBeenCalled();
    const listing: PublishedListing = { id: 'original-qa', version: 1, publishedAt: new Date(FROM - HOUR).toISOString(), config: cfg };
    await expect(allocateListingOwner({} as never, listing, 'owner')).rejects.toThrow();
  });
  test('model price never values a wallet, including a colliding venue symbol', async () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    const marketData = { getTickers: jest.fn(async () => [
      { pair: 'OGX/USDT', lastPrice: '777' }, { pair: 'BTC/USDT', lastPrice: '100000' },
    ]) } as any;
    const wallet = new WalletPortfolioService({} as any, marketData, { isConfigured: () => false } as any);
    const prices = await wallet.pricesFor(['OGX', 'BTC', 'USDT']);
    expect(prices.get('OGX')).toBeNull();
    expect(prices.get('BTC')).toBe(100000);
    expect(prices.get('USDT')).toBe(1);
  });
  test('public catalogue and every market endpoint carry original simulated provenance; paused stays frozen', async () => {
    const listing: PublishedListing = { id: 'original-qa', version: 1, publishedAt: new Date(FROM - HOUR).toISOString(), config: config() };
    for (const route of ['/market/test-assets/OGX-USDT', '/market/test-assets/OGX-USDT/candles', '/market/ticker/OGX-USDT', '/market/display/spot-book/OGX-USDT', '/market/display/spot-trades/OGX-USDT']) {
      const response = managedListingResponse(new Request('https://local.invalid' + route), [listing], FROM + HOUR, '1')!;
      expect(response.status).toBe(200);
      expect((await response.json() as any).provenance).toEqual(ORIGINAL_PROVENANCE);
    }
    const paused = { ...listing, countdown: { state: 'paused' as const, updatedAt: FROM - HOUR, updatedBy: 'fixture' } };
    const response = managedListingResponse(new Request('https://local.invalid/market/test-assets/OGX-USDT/candles'), [paused], FROM + HOUR, '1')!;
    expect((await response.json() as any).candles).toEqual([]);
  });
});
