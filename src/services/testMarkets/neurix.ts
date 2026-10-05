import type { TestAssetConfig } from './testAssetConfig';
import type { GrowthScheduledScenarioConfig, ScheduledScenarioConfig } from './simulationSchedule';

/** Shared configuration only: no environment, network, database or clock reads. */
const NRX_LISTING_AT = Date.parse('2026-10-03T13:00:00Z');


/** Historical reviewed v3 plan retained only for release fingerprint/tests; not attached. */
export const NRX_TWO_WEEK_SCENARIO: Readonly<GrowthScheduledScenarioConfig> = Object.freeze({
  version: 3,
  from: Date.parse('2026-10-03T18:00:00Z'),
  firstTargetAt: Date.parse('2026-10-03T21:00:00Z'),
  breakoutAt: Date.parse('2026-10-04T05:00:00Z'),
  secondTargetAt: Date.parse('2026-10-04T09:00:00Z'),
  thirdTargetAt: Date.parse('2026-10-04T13:00:00Z'),
  rangeEndAt: Date.parse('2026-10-06T13:00:00Z'),
  selloffEndAt: Date.parse('2026-10-06T19:00:00Z'),
  endAt: Date.parse('2026-10-17T18:00:00Z'),
  firstGainPercent: 840,
  secondGainPercent: 1745,
  thirdGainPercent: 7217,
  rangeFraction: .20,
  selloffFraction: .60,
});

/** Owner update 2026-10-05: end growth prospectively without changing the
 * already allocated production inventory. */
export const NRX_BALANCE_SELLOFF_SCENARIO: Readonly<ScheduledScenarioConfig> = Object.freeze({
  mode: 'range-selloff-range',
  version: 5,
  from: Date.parse('2026-10-05T20:00:00Z'), // 23:00 Kyiv
  rangeEndAt: Date.parse('2026-10-07T20:00:00Z'), // 48h balance
  selloffEndAt: Date.parse('2026-10-08T02:00:00Z'), // six-hour -60% selloff
  rangeFraction: .20,
  selloffFraction: .60,
});

export const NEURIX: TestAssetConfig = Object.freeze({
  symbol: 'NRX', name: 'NEURIX', quote: 'USDT', pair: 'NRX/USDT',
  isTestAsset: true, isTradable: true, listingArmed: true,
  listingAt: NRX_LISTING_AT, initialPrice: 0.80,
  seed: 'neurix-2026-10-03',
  // Owner (2026-10-03): a live post-listing market on 15m/1h/4h — price
  // discovery, impulse legs, corrections with flushes that are bought back,
  // accumulation ranges — with the same block and day anchors as before.
  // From the listing itself: nothing has been shown or traded before it.
  // Release MUST be live (Render and the market-edge Worker) before this
  // instant; otherwise move it to the next full hour after the release.
  marketStructure: { from: NRX_LISTING_AT },
  scheduledScenario: NRX_BALANCE_SELLOFF_SCENARIO,
});

export const NRX_OWNER_ALLOCATION = '31250';
