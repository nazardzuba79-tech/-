import { setManagedListingAssets } from '../managedSnapshot';
import { listingSimulationConfig, type ListingConfig, type PublishedListing } from '../listingConfig';
import { ManagedListingRegistry, REFRESH_MS } from '../registry';
import { UnconfiguredListingStore, type ListingStore } from '../store';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol, testAssetForSymbol } from '../../testMarkets/testAssetConfig';
import { collateralMarket } from '../../../private-trading/native/service';
import { simulationFor } from '../../testMarkets/testMarketSimulation';

const listingAt = Date.parse('2026-10-01T12:00:00Z');
const config = (extra: Partial<ListingConfig> = {}): ListingConfig => ({
  schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt: '2026-10-01T12:00:00Z',
  displayTimeZone: 'Europe/Kyiv', ownerAllocation: '1000', seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true, ...extra,
});
const published = (cfg = config()): PublishedListing => ({ id: 'qax-1', version: 1, publishedAt: '2026-10-01T10:00:00Z', config: cfg });

afterEach(() => setManagedListingAssets([]));

describe('published managed listings in the trading paths', () => {
  test('unknown before Render learns it; then a restricted test asset everywhere except Spot', () => {
    expect(isTestAssetPairOrSymbol('QAX')).toBe(false);
    setManagedListingAssets([listingSimulationConfig(config())]);
    expect(isTestAssetPairOrSymbol('QAX')).toBe(true);
    expect(isTestAssetPairOrSymbol('QAX/USDT')).toBe(true);
    // Never valued through a colliding venue symbol as Futures collateral.
    expect(collateralMarket('QAX')).toBeNull();
    expect(testAssetForSymbol('QAX')!.seed).toBe('qax-20261001-synthetic');
  });

  test('Spot gate: refused before listing, open after for a tradable listing, always refused when not tradable', () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    expect(() => assertSpotListing('QAX/USDT', listingAt - 1)).toThrow('Trading has not started yet');
    expect(() => assertSpotListing('QAX/USDT', listingAt)).not.toThrow();
    setManagedListingAssets([listingSimulationConfig(config({ tradable: false }))]);
    expect(() => assertSpotListing('QAX/USDT', listingAt + 60_000)).toThrow('QA Example is not available for trading.');
    // VTA/NRX and ordinary pairs keep their exact behaviour.
    expect(() => assertSpotListing('VTA/USDT', listingAt)).toThrow('not available');
    expect(() => assertSpotListing('BTC/USDT', listingAt)).not.toThrow();
  });

  test('conditional orders use the canonical simulation price, never the venue', async () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    const venue = { getTicker: jest.fn(async () => ({ lastPrice: '999' })) };
    const at = listingAt + 3_600_000;
    const ticker = await spotPriceSource(venue, () => at).getTicker('QAX/USDT');
    expect(ticker).toEqual({ lastPrice: String(simulationFor(listingSimulationConfig(config())).priceAt(at)) });
    expect(await spotPriceSource(venue, () => listingAt - 1).getTicker('QAX/USDT')).toBeNull();
    expect(venue.getTicker).not.toHaveBeenCalled();
    await spotPriceSource(venue, () => at).getTicker('BTC/USDT');
    expect(venue.getTicker).toHaveBeenCalledWith('BTC/USDT');
  });
});

describe('Render registry budget', () => {
  const storeWith = (published: () => Promise<{ revision: string; listings: PublishedListing[] }>): ListingStore =>
    ({ published: jest.fn(published), list: jest.fn(), saveDraft: jest.fn(), publish: jest.fn() } as unknown as ListingStore);

  test('unconfigured: never a request, snapshot stays empty', async () => {
    const registry = new ManagedListingRegistry(new UnconfiguredListingStore());
    await registry.ensureFresh();
    expect(registry.snapshot()).toEqual([]);
  });

  test('at most one read per REFRESH_MS; concurrent callers share it; a publish invalidates', async () => {
    let now = 0;
    const store = storeWith(async () => ({ revision: '1', listings: [published()] }));
    const registry = new ManagedListingRegistry(store, () => now);
    await Promise.all([registry.ensureFresh(), registry.ensureFresh(), registry.ensureFresh()]);
    expect(store.published).toHaveBeenCalledTimes(1);
    expect(isTestAssetPairOrSymbol('QAX')).toBe(true);
    now = REFRESH_MS - 1;
    await registry.ensureFresh();
    expect(store.published).toHaveBeenCalledTimes(1);
    registry.invalidate();
    await registry.ensureFresh();
    expect(store.published).toHaveBeenCalledTimes(2);
  });

  test('a failed read keeps the last good snapshot and is not retried before REFRESH_MS', async () => {
    let now = 0, fail = false;
    const store = storeWith(async () => { if (fail) throw new Error('down'); return { revision: '1', listings: [published()] }; });
    const registry = new ManagedListingRegistry(store, () => now);
    await registry.ensureFresh();
    fail = true; now = REFRESH_MS;
    await registry.ensureFresh();
    expect(registry.snapshot()).toHaveLength(1);
    now = REFRESH_MS + 10;
    await registry.ensureFresh();
    expect(store.published).toHaveBeenCalledTimes(2);
  });

  test('a caller waits at most waitMs for a slow store', async () => {
    const store = storeWith(() => new Promise(() => {}));
    const registry = new ManagedListingRegistry(store);
    const started = Date.now();
    await registry.ensureFresh(50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
