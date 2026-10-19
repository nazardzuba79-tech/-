/**
 * History20 private test listings (owner decision 2026-10-19): configuration,
 * publication rules, the SIMUSDT pair and the public read model. Pure: no IO.
 * Synthetic growth windows only.
 */
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import {
  checkPublishable, listingPair, listingSimulationConfig, listingSlug, MAX_PRIVATE_TEST_FUNDING, parseListingConfig, type ListingConfig, type PublishedListing,
} from '../listingConfig';
import { managedListingResponse, PUBLIC_CATALOGUE_PATH } from '../listingPublic';

const DAY = 86_400_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', START = Date.parse(LISTING_AT);
function walk(days: number, seed: number): HistoricalGrowthSourceRow[] {
  let x = seed, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
const growthFor = (n: number) => buildHistoricalGrowthProgram({ scenarioId: `VHX-${String(n).padStart(2, '0')}-SOL`, targetPeakGrowthPercent: '9348', rows: walk(40, n + 7),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });

const raw = (n = 1, extra: Record<string, unknown> = {}) => {
  const growth = growthFor(n);
  return {
    schemaVersion: 1, symbol: `PVX${String(n).padStart(2, '0')}`, name: `Private window ${n}`, logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
    ownerAllocation: '0', seedMode: 'manual', seed: `pvx-private-synthetic-${n}`, tradable: false,
    simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
      historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
    privateTest: { settlement: 'SIMUSDT', funding: { base: '100', quote: '1000' } },
    ...extra,
  };
};
const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as { code?: string }).code ?? 'NO_CODE'; } };

describe('History20 private test listing: configuration', () => {
  test('a private History20 window parses; its pair and slug are quoted in SIMUSDT', () => {
    const config = parseListingConfig(raw());
    const asset = listingSimulationConfig(config);
    expect(asset).toMatchObject({ symbol: 'PVX01', quote: 'SIMUSDT', pair: 'PVX01/SIMUSDT', privateTest: true, isTradable: false });
    expect(listingPair('PVX01', 'SIMUSDT')).toBe('PVX01/SIMUSDT');
    expect(listingSlug('PVX01', 'SIMUSDT')).toBe('PVX01-SIMUSDT');
  });

  test('only a History20 window may be private; it is funded only by its bounded test funding', () => {
    const { simulationProgram: _p, ...plain } = raw();
    expect(code(() => parseListingConfig({ ...plain }))).toBe('PRIVATE_TEST_HISTORY20_ONLY');
    expect(code(() => parseListingConfig(raw(1, { ownerAllocation: '5' })))).toBe('PRIVATE_TEST_FUNDING_ONLY');
    expect(code(() => parseListingConfig(raw(1, { privateTest: { settlement: 'SIMUSDT', funding: { base: String(MAX_PRIVATE_TEST_FUNDING + 1), quote: '0' } } })))).toBe('PRIVATE_TEST_FUNDING_BOUND');
    expect(code(() => parseListingConfig(raw(1, { privateTest: { settlement: 'SIMUSDT', funding: { base: '0', quote: '0' } } })))).toBe('PRIVATE_TEST_FUNDING_BOUND');
    // The settlement is SIMUSDT and nothing else: never USDT.
    expect(code(() => parseListingConfig(raw(1, { privateTest: { settlement: 'USDT', funding: { base: '1', quote: '1' } } })))).toBe('INVALID_CONFIG');
    expect(code(() => parseListingConfig(raw(1, { privateTest: { settlement: 'SIMUSDT', funding: { base: '1', quote: '1' }, withdrawable: true } })))).toBe('INVALID_CONFIG');
    // Still a non-executable demo for everyone else (DEMO_ONLY stays).
    expect(code(() => parseListingConfig(raw(1, { tradable: true })))).toBe('DEMO_ONLY');
    // No listing may take the settlement unit as its ticker.
    expect(code(() => parseListingConfig(raw(1, { symbol: 'SIMUSDT' })))).toBe('RESERVED_TICKER');
  });

  test('publication: private may publish; the same window in public stays HISTORICAL_RIGHTS_UNVERIFIED; the mode never flips', () => {
    const priv = parseListingConfig(raw());
    expect(code(() => checkPublishable(priv, null, START - DAY))).toBeNull();
    const { privateTest: _t, ...publicWindow } = raw();
    expect(code(() => checkPublishable(parseListingConfig(publicWindow), null, START - DAY))).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
    // Neither direction once published.
    expect(code(() => checkPublishable(parseListingConfig(publicWindow), priv, START - DAY))).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
    const moreFunding = parseListingConfig(raw(1, { privateTest: { settlement: 'SIMUSDT', funding: { base: '100', quote: '5000' } } }));
    expect(code(() => checkPublishable(moreFunding, priv, START - DAY))).toBe('HISTORY_LOCKED');
    // Versioned history: the window itself cannot be rewritten either.
    const other = parseListingConfig(raw(2, { symbol: 'PVX01', seed: 'pvx-private-synthetic-1' }));
    expect(code(() => checkPublishable(other, priv, START - DAY))).toBe('HISTORY_LOCKED');
  });

  test('a replay window (afterGrowth historical) stays refused even as private', () => {
    const config = raw();
    const program = { ...config.simulationProgram, afterGrowth: 'historical' };
    expect(code(() => checkPublishable(parseListingConfig({ ...config, simulationProgram: program }), null, START - DAY))).not.toBeNull();
  });

  test('20-case rotation: twenty private windows, twenty distinct SIMUSDT pairs, none public', () => {
    const configs = Array.from({ length: 20 }, (_, i) => parseListingConfig(raw(i + 1)));
    const assets = configs.map(listingSimulationConfig);
    expect(new Set(assets.map((a) => a.pair)).size).toBe(20);
    expect(assets.every((a) => a.quote === 'SIMUSDT' && a.pair.endsWith('/SIMUSDT') && a.privateTest)).toBe(true);
    expect(new Set(configs.map((c) => c.simulationProgram?.kind === 'scenario-controls-v2' ? c.simulationProgram.historicalGrowth?.scenarioId : null)).size).toBe(20);
    for (const config of configs) expect(code(() => checkPublishable(config, null, START - DAY))).toBeNull();
  });
});

describe('History20 private test listing: never public data', () => {
  const legacy: ListingConfig = parseListingConfig({
    schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt: LISTING_AT, displayTimeZone: 'UTC',
    ownerAllocation: '1000', seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true,
  });
  const published = (id: string, config: ListingConfig): PublishedListing => ({ id, version: 1, publishedAt: LISTING_AT, config });
  const listings = [published('qax', legacy), published('pvx01', parseListingConfig(raw()))];
  const get = (path: string) => managedListingResponse(new Request(`https://market.local${path}`), listings, START + DAY, '7');

  test('the public catalogue lists the legacy listing exactly as before, and not the private one', async () => {
    const body = await get(PUBLIC_CATALOGUE_PATH)!.json() as { assets: Array<{ pair: string; quote: string }> };
    expect(body.assets.map((a) => a.pair)).toEqual(['QAX/USDT']);
    const legacyOnly = await managedListingResponse(new Request(`https://market.local${PUBLIC_CATALOGUE_PATH}`), [listings[0]], START + DAY, '7')!.json();
    expect(body).toEqual(legacyOnly);
  });

  test('no public path answers for the private pair', () => {
    for (const path of ['/market/test-assets/PVX01-SIMUSDT', '/market/test-assets/PVX01-SIMUSDT/candles', '/market/external/candles/PVX01-SIMUSDT',
      '/market/ticker/PVX01-SIMUSDT', '/orderbook/PVX01-SIMUSDT', '/market/test-assets/PVX01-USDT', '/market/ticker/PVX01-USDT']) expect(get(path)).toBeNull();
    expect(get('/market/test-assets/QAX-USDT')).not.toBeNull();
  });

  test('a legacy configuration is byte-for-byte the simulation input it was', () => {
    const asset = listingSimulationConfig(legacy);
    expect(asset).not.toHaveProperty('privateTest');
    expect(asset).toMatchObject({ quote: 'USDT', pair: 'QAX/USDT' });
    expect(JSON.stringify(asset)).toBe(JSON.stringify({
      symbol: 'QAX', name: 'QA Example', quote: 'USDT', pair: 'QAX/USDT', isTestAsset: true, isTradable: true,
      listingArmed: true, listingAt: START, initialPrice: 0.25, seed: 'qax-20261001-synthetic',
    }));
  });
});
