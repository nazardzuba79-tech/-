/**
 * The pre-listing timer of a published listing (listingConfig.ListingCountdown):
 * operational state next to the immutable configuration. The countdown always
 * counts to `listingAt` by the server clock; starting, pausing or stopping it
 * never moves that instant, and nothing activates by itself.
 *
 * Fixed instant: Monday 2026-10-26 13:00 UTC = 16:00 Moscow. Synthetic ticker.
 */
import {
  ListingValidationError, checkPublishable, listingCountdownArmed, listingOpened, nextListingCountdown, publishedListingAsset,
  type ListingConfig, type ListingCountdown, type PublishedListing,
} from '../listingConfig';
import { managedListingResponse } from '../listingPublic';
import { setManagedListingAssets } from '../managedSnapshot';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';

const LISTING_AT = '2026-10-26T13:00:00Z';
const AT = Date.parse(LISTING_AT);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const PUBLISHED_AT = Date.parse('2026-10-20T10:00:00Z');

const config = (extra: Partial<ListingConfig> = {}): ListingConfig => ({
  schemaVersion: 1, symbol: 'QTM', name: 'QA Timer', logo: null, initialPrice: '0.25', listingAt: LISTING_AT, displayTimeZone: 'Europe/Moscow',
  ownerAllocation: '1000', seedMode: 'manual', seed: 'qtm-20261026-synthetic', tradable: true, ...extra,
});
const timer = (state: ListingCountdown['state'], extra: Partial<ListingCountdown> = {}): ListingCountdown => ({ state, updatedAt: PUBLISHED_AT, updatedBy: 'admin-1', ...extra });
const published = (countdown?: ListingCountdown, cfg = config()): PublishedListing =>
  ({ id: 'qtm-1', version: 1, publishedAt: new Date(PUBLISHED_AT).toISOString(), config: cfg, ...(countdown ? { countdown } : {}) });
const code = (run: () => unknown) => { try { run(); return null; } catch (error) { return (error as ListingValidationError).code; } };

afterEach(() => setManagedListingAssets([]));

describe('the pre-listing timer is operational state, never part of the configuration', () => {
  test('armed only while running; a listing published before the timer existed counts as running', () => {
    expect(listingCountdownArmed(published())).toBe(true);
    expect(listingCountdownArmed(published(timer('running')))).toBe(true);
    expect(listingCountdownArmed(published(timer('paused')))).toBe(false);
    expect(listingCountdownArmed(published(timer('staged')))).toBe(false);
    for (const listing of [published(), published(timer('running')), published(timer('paused')), published(timer('staged'))]) {
      const asset = publishedListingAsset(listing);
      expect(asset.listingArmed).toBe(listingCountdownArmed(listing));
      // The timer never changes what the market is: same pair, time, price and seed.
      expect([asset.pair, asset.listingAt, asset.initialPrice, asset.seed]).toEqual(['QTM/USDT', AT, 0.25, 'qtm-20261026-synthetic']);
    }
  });

  test('the market opens only with a running timer at the listing time, by server time', () => {
    for (const listing of [published(), published(timer('running'))]) {
      expect(listingOpened(listing, AT - 1)).toBe(false);
      expect(listingOpened(listing, AT)).toBe(true);
      expect(listingOpened(listing, AT + DAY)).toBe(true);
    }
    for (const listing of [published(timer('paused')), published(timer('staged'))]) {
      expect(listingOpened(listing, AT + DAY)).toBe(false);
    }
  });

  test('transitions: start needs a listing time still ahead; pause and stop refuse an opened market; otherwise the three states', () => {
    const before = AT - 2 * DAY, after = AT + HOUR;
    expect(nextListingCountdown(published(timer('staged')), 'start', before)).toBe('running');
    expect(nextListingCountdown(published(timer('paused')), 'start', before)).toBe('running');
    expect(nextListingCountdown(published(timer('running')), 'pause', before)).toBe('paused');
    expect(nextListingCountdown(published(), 'pause', before)).toBe('paused');
    expect(nextListingCountdown(published(timer('running')), 'stop', before)).toBe('staged');
    expect(nextListingCountdown(published(timer('paused')), 'stop', before)).toBe('staged');
    // Starting at the instant itself is too late: the date must be moved first.
    expect(code(() => nextListingCountdown(published(timer('staged')), 'start', AT))).toBe('LISTING_TIME_PAST');
    expect(code(() => nextListingCountdown(published(timer('paused')), 'start', after))).toBe('LISTING_TIME_PAST');
    // A paused or staged listing past its date never opened: stopping it is still allowed.
    expect(nextListingCountdown(published(timer('paused')), 'stop', after)).toBe('staged');
    // An opened market (running at the listing time) has no timer to change.
    for (const action of ['start', 'pause', 'stop'] as const) {
      expect(code(() => nextListingCountdown(published(timer('running')), action, AT))).toBe('MARKET_OPEN');
      expect(code(() => nextListingCountdown(published(), action, after))).toBe('MARKET_OPEN');
    }
  });

  test('a listing whose timer never ran may move its date even after it passed; an opened market may not', () => {
    const active = config();
    const moved = config({ listingAt: '2026-11-02T13:00:00Z' });
    const now = AT + DAY;
    expect(code(() => checkPublishable(moved, active, now, 60_000, false))).toBeNull();
    expect(code(() => checkPublishable(moved, active, now, 60_000, true))).toBe('HISTORY_LOCKED');
    // Without the flag the rule is the old one: a passed date is an opened market.
    expect(code(() => checkPublishable(moved, active, now))).toBe('HISTORY_LOCKED');
    // Before the date, moving it is allowed either way, within the lead and the year.
    expect(code(() => checkPublishable(moved, active, AT - DAY))).toBeNull();
    expect(code(() => checkPublishable(config({ listingAt: '2026-10-26T13:00:30Z' }), active, AT, 60_000, false))).toBe('LISTING_TIME_PAST');
    // Everything else stays locked for a not-opened market too.
    expect(code(() => checkPublishable(config({ initialPrice: '0.3' }), active, now, 60_000, false))).toBe('HISTORY_LOCKED');
    expect(code(() => checkPublishable(config({ seed: 'qtm-other-seed-0001' }), active, now, 60_000, false))).toBe('HISTORY_LOCKED');
  });
});

describe('Render follows the timer: the Spot gate, trigger prices and the restricted-asset guards', () => {
  test('a staged or paused listing is known (restricted everywhere) but never opens, even past 13:00 UTC', () => {
    for (const state of ['staged', 'paused'] as const) {
      setManagedListingAssets([publishedListingAsset(published(timer(state)))]);
      expect(isTestAssetPairOrSymbol('QTM')).toBe(true);
      expect(isTestAssetPairOrSymbol('QTM/USDT')).toBe(true);
      for (const now of [AT - 1, AT, AT + HOUR, AT + 30 * DAY]) expect(() => assertSpotListing('QTM/USDT', now)).toThrow('Trading has not started yet');
    }
    const venue = { getTicker: jest.fn(async () => ({ lastPrice: '999' })) };
    expect(venue.getTicker).not.toHaveBeenCalled();
  });

  test('a running tradable listing refuses orders one millisecond before 13:00 UTC and opens at the instant; the trigger price appears with it', async () => {
    for (const listing of [published(), published(timer('running', { startedAt: PUBLISHED_AT }))]) {
      setManagedListingAssets([publishedListingAsset(listing)]);
      expect(() => assertSpotListing('QTM/USDT', AT - 1)).toThrow('Trading has not started yet');
      expect(() => assertSpotListing('QTM/USDT', AT)).not.toThrow();
      expect(() => assertSpotListing('QTM/USDT', AT + HOUR)).not.toThrow();
      const venue = { getTicker: jest.fn(async () => ({ lastPrice: '999' })) };
      expect(await spotPriceSource(venue, () => AT - 1).getTicker('QTM/USDT')).toBeNull();
      expect(await spotPriceSource(venue, () => AT + HOUR).getTicker('QTM/USDT')).not.toBeNull();
      expect(venue.getTicker).not.toHaveBeenCalled();
    }
    // Paused: no trigger price at any time, and the venue is never asked.
    setManagedListingAssets([publishedListingAsset(published(timer('paused')))]);
    const venue = { getTicker: jest.fn(async () => ({ lastPrice: '999' })) };
    expect(await spotPriceSource(venue, () => AT + HOUR).getTicker('QTM/USDT')).toBeNull();
    expect(venue.getTicker).not.toHaveBeenCalled();
    // Non-tradable listings stay closed whatever the timer does.
    setManagedListingAssets([publishedListingAsset(published(timer('running'), config({ tradable: false })))]);
    expect(() => assertSpotListing('QTM/USDT', AT + HOUR)).toThrow('QA Timer is not available for trading.');
  });
});

describe('the public edge follows the timer', () => {
  const read = async (path: string, listings: PublishedListing[], now: number) => {
    const response = managedListingResponse(new Request(`https://edge.test${path}`), listings, now, '7');
    return response ? { status: response.status, body: await response.json() as any } : null;
  };

  test('running: the catalogue counts down to 26.10.2026 13:00 UTC, then the market is live', async () => {
    const listing = published(timer('running', { startedAt: PUBLISHED_AT }));
    const before = await read('/market/listings', [listing], AT - 5 * DAY);
    expect(before!.body.assets[0]).toMatchObject({ pair: 'QTM/USDT', managed: true, listingArmed: true, countdown: 'running', listingAt: '2026-10-26T13:00:00.000Z',
      displayTimeZone: 'Europe/Moscow', state: { phase: 'pre-listing', lastPrice: null } });
    expect(before!.body.serverTime).toBe(AT - 5 * DAY);
    expect((await read('/market/ticker/QTM-USDT', [listing], AT - 1))!.status).toBe(404);
    const live = await read('/market/listings', [listing], AT);
    expect(live!.body.assets[0].state.phase).toBe('live');
    expect((await read('/market/ticker/QTM-USDT', [listing], AT + HOUR))!.status).toBe(200);
    // The same listing published before the timer existed behaves the same.
    expect((await read('/market/listings', [published()], AT - 1))!.body.assets[0]).toMatchObject({ listingArmed: true, countdown: 'running', state: { phase: 'pre-listing' } });
  });

  test('paused: the date stays on the page, the countdown and the market do not come, even past the listing time', async () => {
    const listing = published(timer('paused', { startedAt: PUBLISHED_AT }));
    for (const now of [AT - DAY, AT, AT + 3 * DAY]) {
      const asset = (await read('/market/listings', [listing], now))!.body.assets[0];
      expect(asset).toMatchObject({ listingArmed: false, countdown: 'paused', listingAt: '2026-10-26T13:00:00.000Z', state: { phase: 'pre-listing', lastPrice: null } });
      expect((await read('/market/ticker/QTM-USDT', [listing], now))!.status).toBe(404);
      expect((await read('/market/test-assets/QTM-USDT/candles?interval=5m', [listing], now))!.body.candles).toEqual([]);
      expect((await read('/market/display/spot-book/QTM-USDT', [listing], now))!.body.available).toBe(false);
      expect((await read('/market/display/spot-trades/QTM-USDT', [listing], now))!.body.trades).toEqual([]);
    }
  });
});
