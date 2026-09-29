import {
  checkPublishable, generateSeed, listingSimulationConfig, logoBytes, parseListingConfig, withStableProfile, withStableSeed,
  ListingValidationError, type ListingConfig, type PublishedListing,
} from '../listingConfig';
import { managedListingResponse, listingForPath } from '../listingPublic';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-01T10:00:00Z');
const config = (extra: Partial<ListingConfig> = {}): ListingConfig => ({
  schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25',
  listingAt: '2026-10-01T12:00:00Z', displayTimeZone: 'Europe/Kyiv', ownerAllocation: '1000',
  seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true, ...extra,
});
const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as ListingValidationError).code; } };
const published = (cfg = config(), version = 1): PublishedListing => ({ id: 'qax-1', version, publishedAt: new Date(NOW).toISOString(), config: cfg });
const get = (path: string, listings: PublishedListing[], now: number) => managedListingResponse(new Request(`https://market.local${path}`), listings, now, '1');

describe('listing configuration', () => {
  test('valid config parses; ticker is upper-cased; unknown fields are refused', () => {
    expect(parseListingConfig({ ...config(), symbol: 'qax' }).symbol).toBe('QAX');
    expect(code(() => parseListingConfig({ ...config(), extra: 1 }))).toBe('INVALID_CONFIG');
  });
  test.each([
    [{ symbol: 'VTA' }, 'RESERVED_TICKER'], [{ symbol: 'BTC' }, 'RESERVED_TICKER'], [{ symbol: '1AB' }, 'INVALID_CONFIG'],
    [{ initialPrice: '0' }, 'INVALID_CONFIG'], [{ initialPrice: '1e3' }, 'INVALID_CONFIG'], [{ initialPrice: '2000000' }, 'INVALID_CONFIG'],
    [{ listingAt: '2026-10-01 12:00' }, 'INVALID_CONFIG'], [{ listingAt: '2026-10-01T12:00:00+03:00' }, 'INVALID_CONFIG'],
    [{ ownerAllocation: '-5' }, 'INVALID_CONFIG'], [{ seed: 'short' }, 'INVALID_CONFIG'], [{ name: '<b>x</b>' }, 'INVALID_CONFIG'],
    [{ logo: 'https://example.invalid/logo.png' }, 'INVALID_CONFIG'],
  ])('rejects %j with %s', (change, expected) => {
    expect(code(() => parseListingConfig({ ...config(), ...change }))).toBe(expected);
  });
  test('logo: small PNG data URL accepted; over 64 KB refused', () => {
    const small = `data:image/png;base64,${Buffer.alloc(1000, 1).toString('base64')}`;
    expect(parseListingConfig(config({ logo: small })).logo).toBe(small);
    expect(logoBytes(small)).toBe(1000);
    const big = `data:image/png;base64,${Buffer.alloc(70 * 1024, 1).toString('base64')}`;
    expect(code(() => parseListingConfig(config({ logo: big })))).not.toBeNull();
  });
  test('automatic seed: generated once, then stable across edits of ticker and date', () => {
    const seed = generateSeed('QAX', '2026-10-01T12:00:00Z', () => 'A1B2C3');
    expect(seed).toBe('qax-20261001-a1b2c3');
    const first = config({ seedMode: 'auto', seed });
    const edited = withStableSeed(config({ seedMode: 'auto', seed: 'qax-20261005-zzzzzz', listingAt: '2026-10-05T12:00:00Z' }), first);
    expect(edited.seed).toBe(seed);
    expect(withStableSeed(config({ seedMode: 'manual', seed: 'manual-seed-0001' }), first).seed).toBe('manual-seed-0001');
  });
});

describe('publish rules protect history', () => {
  test('first publish needs a future time within a year', () => {
    expect(code(() => checkPublishable(config({ listingAt: '2026-10-01T10:00:30Z' }), null, NOW))).toBe('LISTING_TIME_PAST');
    expect(code(() => checkPublishable(config({ listingAt: '2027-12-01T10:00:00Z' }), null, NOW))).toBe('LISTING_TIME_TOO_FAR');
    expect(code(() => checkPublishable(config(), null, NOW))).toBeNull();
  });
  test('after publish: ticker, seed and initial price are locked; the name may change', () => {
    const active = config();
    expect(code(() => checkPublishable(config({ symbol: 'QAY' }), active, NOW))).toBe('TICKER_LOCKED');
    expect(code(() => checkPublishable(config({ seed: 'other-seed-00001' }), active, NOW))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config({ initialPrice: '0.3' }), active, NOW))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config({ name: 'Renamed' }), active, NOW))).toBeNull();
  });
  test('the time may be postponed before opening, never after', () => {
    const active = config();
    expect(code(() => checkPublishable(config({ listingAt: '2026-10-02T12:00:00Z' }), active, NOW))).toBeNull();
    expect(code(() => checkPublishable(config({ listingAt: '2026-10-02T12:00:00Z' }), active, Date.parse('2026-10-01T12:00:01Z')))).toBe('HISTORY_LOCKED');
  });
});

describe('public market of a published listing (computed on read)', () => {
  const listingAt = Date.parse(config().listingAt);
  test('countdown before listing, automatic live after — the same request, only the server time differs', async () => {
    const before = await get('/market/listings', [published()], listingAt - 1)!.json();
    expect(before.assets[0].state.phase).toBe('pre-listing');
    expect(before.assets[0].state.lastPrice).toBeNull();
    const after = await get('/market/listings', [published()], listingAt + 10 * 60_000)!.json();
    expect(after.assets[0].state.phase).toBe('live');
    expect(after.assets[0].state.lastPrice).toBeGreaterThan(0);
    expect(get('/market/ticker/QAX-USDT', [published()], listingAt - 1)!.status).toBe(404);
    expect(get('/market/ticker/QAX-USDT', [published()], listingAt + 60_000)!.status).toBe(200);
  });
  test('candles, book and tape answer on every alias; one canonical history', async () => {
    const at = listingAt + 3 * HOUR;
    for (const path of ['/market/test-assets/QAX-USDT/candles?interval=5m', '/market/external/candles/QAX-USDT?interval=5m', '/market/display/spot-candles/QAX-USDT?interval=5m']) {
      // 3 h after listing: 36 closed 5-minute candles plus the one forming at `at`.
      expect((await get(path, [published()], at)!.json()).candles.length).toBe(37);
    }
    expect((await get('/market/display/spot-book/QAX-USDT', [published()], at)!.json()).bids).toHaveLength(25);
    expect((await get('/market/external/trades/QAX-USDT', [published()], at)!.json()).trades.length).toBeGreaterThan(0);
  });
  test('reload / another isolate / Preview on Render produce identical history for the same configuration', () => {
    const at = listingAt + 5 * HOUR;
    const fresh = () => {
      const asset = listingSimulationConfig(config());
      const sim = new TestMarketSimulation(asset);
      return sim.candles5m(at, asset.listingAt).map((c) => [c.openTime, c.open, c.close]);
    };
    expect(fresh()).toEqual(fresh());
    // Render's Preview and the edge both go through testMarketCandles on the same config.
    expect(testMarketCandles(listingSimulationConfig(config()), '1h', at)).toEqual(testMarketCandles(listingSimulationConfig({ ...config() }), '1h', at));
  });
  test('a renamed version 2 does not rewrite past prices', () => {
    const at = listingAt + 4 * HOUR;
    const v1 = testMarketCandles(listingSimulationConfig(config()), '5m', at);
    const v2 = testMarketCandles(listingSimulationConfig(config({ name: 'Renamed' })), '5m', at);
    expect(v2).toEqual(v1);
  });
  test('a different seed is a different market (so the seed is locked after publish)', () => {
    const at = listingAt + 4 * HOUR;
    expect(testMarketCandles(listingSimulationConfig(config({ seed: 'qax-other-000001' })), '5m', at))
      .not.toEqual(testMarketCandles(listingSimulationConfig(config()), '5m', at));
  });
  test('unknown or unpublished pairs are not answered here; paths are case-insensitive', () => {
    expect(get('/market/test-assets/QBX-USDT', [published()], listingAt)).toBeNull();
    expect(get('/market/display/futures-book/QAXUSDT', [published()], listingAt)).toBeNull();
    expect(listingForPath('/market/test-assets/qax-usdt', [published()])).not.toBeNull();
    expect(get('/market/listings', [], listingAt)).not.toBeNull();
  });
  test('the public catalogue never carries the seed or the owner allocation', async () => {
    const body = JSON.stringify(await get('/market/listings', [published()], listingAt)!.json());
    expect(body).not.toContain('qax-20261001-synthetic');
    expect(body).not.toContain('ownerAllocation');
    expect(get('/market/listings', [published()], listingAt, )!.headers.get('cache-control')).toBe('no-store');
  });
});

describe('simulation profile and wick policy of a managed listing', () => {
  const listingAt = Date.parse(config().listingAt);
  test('optional in the schema; only the four profiles are accepted', () => {
    expect(parseListingConfig(config()).simulationProfile).toBeUndefined();
    for (const profile of ['CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT'] as const) {
      expect(parseListingConfig(config({ simulationProfile: profile })).simulationProfile).toBe(profile);
    }
    expect(code(() => parseListingConfig({ ...config(), simulationProfile: 'RANDOM' }))).toBe('INVALID_CONFIG');
  });
  test('the wick model is optional; only NATURAL_V1 is accepted', () => {
    expect(parseListingConfig(config())).not.toHaveProperty('wickModel');
    const natural = config({ simulationProfile: 'IMPULSE_TREND', wickModel: 'NATURAL_V1' });
    expect(parseListingConfig(natural)).toStrictEqual(natural);
    expect(code(() => parseListingConfig({ ...config(), wickModel: 'NATURAL_V2' }))).toBe('INVALID_CONFIG');
    expect(code(() => parseListingConfig({ ...config(), wickModel: null }))).toBe('INVALID_CONFIG');
  });
  test('assigned once at creation by ordinal, then kept whatever a later request carries', () => {
    const listings = [0, 1, 2, 3, 4, 5].map((n) => withStableProfile(config(), null, n));
    expect(listings.map((listing) => listing.simulationProfile)).toEqual([
      'CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT', 'CALM_TREND', 'IMPULSE_TREND',
    ]);
    expect(listings.map((listing) => listing.wickModel)).toEqual(Array(6).fill('NATURAL_V1'));
    // A request cannot choose its own profile at creation…
    expect(withStableProfile(config({ simulationProfile: 'COMPRESSION_BREAKOUT' }), null, 0)).toMatchObject({
      simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1',
    });
    // …nor change it on a later save.
    const created = withStableProfile(config(), null, 1);
    expect(withStableProfile(config({ name: 'Renamed', simulationProfile: 'CALM_TREND' }), created, null).simulationProfile).toBe('IMPULSE_TREND');
    // A listing stored before profiles existed keeps the original candles.
    expect('simulationProfile' in withStableProfile(config({ simulationProfile: 'PULLBACK_TREND' }), config(), null)).toBe(false);
  });
  test('without a creation ordinal, a request cannot opt a new config into either model field', () => {
    expect(withStableProfile(config({ simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1' }), null, null))
      .toStrictEqual(config());
  });
  test.each([
    { fields: 'neither field', previous: config() },
    { fields: 'only the existing profile', previous: config({ simulationProfile: 'PULLBACK_TREND' }) },
    { fields: 'only the stored wick model', previous: config({ wickModel: 'NATURAL_V1' }) },
    { fields: 'both stored fields', previous: config({ simulationProfile: 'IMPULSE_TREND', wickModel: 'NATURAL_V1' }) },
  ])('edits preserve $fields, including absence, regardless of the request or a supplied ordinal', ({ previous }) => {
    for (const next of [
      config({ name: 'Renamed' }),
      config({ name: 'Renamed', simulationProfile: 'COMPRESSION_BREAKOUT', wickModel: 'NATURAL_V1' }),
    ]) {
      expect(withStableProfile(next, previous, 0)).toStrictEqual({ ...previous, name: 'Renamed' });
    }
  });
  test('locked with the history after publish', () => {
    const active = config({ simulationProfile: 'IMPULSE_TREND' });
    expect(code(() => checkPublishable(config({ simulationProfile: 'CALM_TREND' }), active, NOW))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config(), active, NOW))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config({ simulationProfile: 'IMPULSE_TREND' }), config(), NOW))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config({ simulationProfile: 'IMPULSE_TREND', name: 'Renamed' }), active, NOW))).toBeNull();
  });
  test.each([NOW, listingAt + HOUR])('the published wick model cannot be added or removed at server time %s', (now) => {
    const legacy = config({ simulationProfile: 'IMPULSE_TREND' });
    const natural = config({ simulationProfile: 'IMPULSE_TREND', wickModel: 'NATURAL_V1' });
    expect(code(() => checkPublishable(natural, legacy, now))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(legacy, natural, now))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable({ ...natural, name: 'Renamed' }, natural, now))).toBeNull();
    expect(code(() => checkPublishable({ ...legacy, name: 'Renamed' }, legacy, now))).toBeNull();
  });
  test('only a stored NATURAL_V1 model with a profile opts into natural wicks from listing time', () => {
    for (const legacy of [config(), config({ simulationProfile: 'CALM_TREND' }), config({ wickModel: 'NATURAL_V1' })]) {
      expect(listingSimulationConfig(legacy)).not.toHaveProperty('naturalWicks');
    }
    const natural = listingSimulationConfig(config({ simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1' }));
    expect(natural.simulationProfile).toBe('CALM_TREND');
    expect(natural.naturalWicks).toStrictEqual({ futureFrom: listingAt });
    const postponed = listingSimulationConfig(config({
      simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1', listingAt: '2026-10-03T09:30:00Z',
    }));
    expect(postponed.naturalWicks).toStrictEqual({ futureFrom: Date.parse('2026-10-03T09:30:00Z') });
  });
  test('the profile reaches the simulation: other candles, the same hour anchors', async () => {
    const plain = listingSimulationConfig(config());
    const calm = listingSimulationConfig(config({ simulationProfile: 'CALM_TREND' }));
    expect(plain.simulationProfile).toBeUndefined();
    expect(calm.simulationProfile).toBe('CALM_TREND');
    const at = listingAt + 6 * HOUR;
    expect(testMarketCandles(calm, '5m', at)).not.toEqual(testMarketCandles(plain, '5m', at));
    for (let h = 0; h <= 6; h++) {
      expect(new TestMarketSimulation(calm).priceAt(listingAt + h * HOUR)).toBe(new TestMarketSimulation(plain).priceAt(listingAt + h * HOUR));
    }
    // The edge serves exactly the profile's candles, and the public record does not expose the profile.
    const listing = published(config({ simulationProfile: 'CALM_TREND' }));
    expect((await get('/market/test-assets/QAX-USDT/candles?interval=5m', [listing], at)!.json()).candles).toEqual(testMarketCandles(calm, '5m', at));
    expect(JSON.stringify(await get('/market/listings', [listing], at)!.json())).not.toContain('CALM_TREND');
  });
});
