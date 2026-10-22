/**
 * TERYVANE (TYVN/USDT), the candidate draft for the listing of 2026-10-27
 * 13:00 UTC = 16:00 Moscow (`config/test-markets/tyvn.draft.json`): the file
 * is a valid draft of the existing managed-listings system, its name and
 * ticker collide with nothing the repository knows, its price path comes from
 * the existing scenario mechanism, and nothing in it trades, opens or credits
 * by itself. The draft is never published or started here.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseListingConfig, withStableProfile, listingSimulationConfig, publishedListingAsset, checkPublishable, listingOpened,
  nextListingCountdown, LISTING_SYMBOL_PATTERN, RESERVED_LISTING_SYMBOLS, MIN_LEAD_MS, type PublishedListing,
} from '../listingConfig';
import { LISTING_SCENARIOS, exactPriceFromGain, validateScenarioControls } from '../../../shared/listingScenarioControls';
import { setManagedListingAssets } from '../managedSnapshot';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';
import { DAY_MS, simulationFor } from '../../testMarkets/testMarketSimulation';

const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../../config/test-markets/tyvn.draft.json'), 'utf8'));
const draft = parseListingConfig(raw);
const saved = withStableProfile(draft, null, 7);
const START = Date.parse('2026-10-27T13:00:00Z');
const HOUR = 3_600_000;
const listing = (state: 'staged' | 'running' | null): PublishedListing => ({
  id: 'tyvn-candidate', version: 1, publishedAt: new Date(START - 5 * DAY_MS).toISOString(), config: saved,
  ...(state ? { countdown: { state, updatedAt: START - 5 * DAY_MS, updatedBy: 'owner' } } : {}),
});

afterEach(() => setManagedListingAssets([]));

test('the file is the approved asset, exactly, and a valid draft of the listing system', () => {
  expect(draft).toMatchObject({ symbol: 'TYVN', name: 'TERYVANE', initialPrice: '0.0250', listingAt: '2026-10-27T13:00:00Z', displayTimeZone: 'Europe/Moscow', tradable: false, seedMode: 'manual', seed: 'teryvane-20261026-v1' });
  expect(listingSimulationConfig(draft)).toMatchObject({ pair: 'TYVN/USDT', symbol: 'TYVN', name: 'TERYVANE', initialPrice: 0.025, listingAt: START, isTradable: false, quote: 'USDT' });
  expect(START % 10_000).toBe(0); // scenario-controls-v2 requires a listing instant on a whole 10 s
  expect(new Date(START).toISOString()).toBe('2026-10-27T13:00:00.000Z'); // Tuesday, 13:00 UTC = 16:00 Moscow (UTC+3)
  expect(new Date(START).getUTCDay()).toBe(2);
  // No supply field exists: the emission (100 000 000 TYVN) is documentation; ownerAllocation is a parameter and credits nothing by itself.
  expect(draft.ownerAllocation).toBe('100000000');
});

test('name and ticker are free: not reserved, not a built-in test asset, well-formed', () => {
  expect(LISTING_SYMBOL_PATTERN.test(draft.symbol)).toBe(true);
  expect(RESERVED_LISTING_SYMBOLS.has('TYVN')).toBe(false);
  expect(isTestAssetPairOrSymbol('TYVN')).toBe(false);
  expect(isTestAssetPairOrSymbol('TYVN/USDT')).toBe(false);
  expect(isTestAssetPairOrSymbol('TERYVANE')).toBe(false);
});

test('the price path uses the existing scenario mechanism with its default shape, bounded, deterministic by seed', () => {
  const program = saved.simulationProgram!;
  if (program.kind !== 'scenario-controls-v2') throw new Error(`unexpected program ${program.kind}`);
  expect(() => validateScenarioControls(program, draft.initialPrice)).not.toThrow();
  // AUTO resolves from the manual seed: the same seed always gives the same scenario, so the preview equals the market.
  expect(program.scenario).not.toBe('AUTO');
  expect(LISTING_SCENARIOS).toContain(program.scenario);
  const again = withStableProfile(draft, null, 11).simulationProgram!;
  expect(again.kind === 'scenario-controls-v2' && again.scenario).toBe(program.scenario);
  expect(program.scenario).toBe('FREQUENT_PULLBACKS');
  expect(program.first24hGainPercent).toBe('1725');
  expect(exactPriceFromGain(draft.initialPrice, '1725')).toBe('0.45625');
  expect(program.maxPrice).toBe(exactPriceFromGain(draft.initialPrice, '9247'));
  expect(program.maxPrice).toBe('2.33675');
  expect(program.stages).toEqual([{ type: 'growth', durationHours: 24, targetPrice: '0.45625' }, { type: 'growth', durationHours: 144, targetPrice: '2.009605' }]);
  expect(program.afterGrowth).toBe('range');

  const sim = simulationFor(publishedListingAsset(listing('running')));
  expect(sim.priceAt(START - 1)).toBeNull();
  expect(sim.priceAt(START)).toBeCloseTo(0.025, 9);
  expect(sim.priceAt(START + DAY_MS)).toBeCloseTo(0.45625, 9);
  for (let t = START; t <= START + 7 * DAY_MS; t += HOUR) {
    const price = sim.priceAt(t)!;
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThanOrEqual(2.33675);
  }
});

test('publishable before the date with the default lead; a passed date is refused, never activated', () => {
  expect(() => checkPublishable(saved, null, START - 5 * DAY_MS)).not.toThrow();
  expect(() => checkPublishable(saved, null, START - MIN_LEAD_MS)).not.toThrow();
  expect(() => checkPublishable(saved, null, START)).toThrow(/LISTING_TIME_PAST|future/);
  const staged = listing('staged');
  expect(() => nextListingCountdown(staged, 'start', START - HOUR)).not.toThrow();
  expect(nextListingCountdown(staged, 'start', START - HOUR)).toBe('running');
  expect(() => nextListingCountdown(staged, 'start', START)).toThrow(/passed/);
  expect(listingOpened(staged, START + HOUR)).toBe(false);
});

test('timer off: Render holds the pair unarmed, refuses orders and gives no trigger price, even after 13:00 UTC', async () => {
  const staged = publishedListingAsset(listing('staged'));
  expect(staged.listingArmed).toBe(false);
  setManagedListingAssets([staged]);
  expect(isTestAssetPairOrSymbol('TYVN/USDT')).toBe(true);
  // The demo refusal comes first; the armed gate behind it is covered for tradable listings in listingCountdown.test.ts.
  for (const now of [START - HOUR, START, START + HOUR]) expect(() => assertSpotListing('TYVN/USDT', now)).toThrow('TERYVANE is not available for trading.');
  const source = spotPriceSource({ getTicker: async () => ({ lastPrice: '1' }) }, () => START + HOUR);
  expect(await source.getTicker('TYVN/USDT')).toBeNull();
});

test('timer running: a demo scenario never executes orders, before or after the opening', () => {
  const running = publishedListingAsset(listing('running'));
  expect(running.listingArmed).toBe(true);
  setManagedListingAssets([running]);
  expect(() => assertSpotListing('TYVN/USDT', START - 1)).toThrow();
  expect(() => assertSpotListing('TYVN/USDT', START)).toThrow('TERYVANE is not available for trading.');
  expect(() => assertSpotListing('TYVN/USDT', START + DAY_MS)).toThrow('TERYVANE is not available for trading.');
});
