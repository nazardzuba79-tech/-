import type { TestAssetConfig } from './testAssetConfig';
import type { ScheduledScenarioConfig } from './simulationSchedule';

/** Shared configuration only: no environment, network, database or clock reads. */
const NRX_LISTING_AT = Date.parse('2026-10-03T13:00:00Z');

/** Owner's 2026-10-03 review plan. UTC instants below are Kyiv UTC+3.
 * NOT a deploy-now configuration: run the release preflight before BOTH
 * backend and edge rollouts. An elapsed activation must be rescheduled, never
 * applied retroactively to displayed prices or executed orders.
 */
export const NRX_TWO_WEEK_SCENARIO: Readonly<ScheduledScenarioConfig> = Object.freeze({
  version: 3,
  // Owner update 2026-10-03: first impulse begins this evening. All targets
  // remain listing-relative to 0.80 USDT; already shown history stays intact.
  from: Date.parse('2026-10-03T18:00:00Z'), // 21:00 Kyiv
  firstTargetAt: Date.parse('2026-10-03T21:00:00Z'), // 00:00 Kyiv
  breakoutAt: Date.parse('2026-10-04T05:00:00Z'), // 08:00 Kyiv
  secondTargetAt: Date.parse('2026-10-04T09:00:00Z'), // 12:00 Kyiv
  thirdTargetAt: Date.parse('2026-10-04T13:00:00Z'), // 16:00 Kyiv
  rangeEndAt: Date.parse('2026-10-06T13:00:00Z'), // 48h upper range
  selloffEndAt: Date.parse('2026-10-06T19:00:00Z'), // six-hour selloff
  endAt: Date.parse('2026-10-17T18:00:00Z'), // fourteen days from activation
  firstGainPercent: 840,
  secondGainPercent: 1745,
  thirdGainPercent: 7217,
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
  // Release MUST be live (Hetzner API and the market-edge Worker) before this
  // instant; otherwise move it to the next full hour after the release.
  marketStructure: { from: NRX_LISTING_AT },
  scheduledScenario: NRX_TWO_WEEK_SCENARIO,
});

export const NRX_OWNER_ALLOCATION = '6250';
