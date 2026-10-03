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
  version: 2,
  from: Date.parse('2026-10-04T16:00:00Z'),
  firstTargetAt: Date.parse('2026-10-04T18:48:00Z'),
  breakoutAt: Date.parse('2026-10-05T05:00:00Z'),
  secondTargetAt: Date.parse('2026-10-05T11:30:00Z'),
  rangeEndAt: Date.parse('2026-10-07T11:30:00Z'),
  // A staged six-hour selloff, with countertrend rebounds rather than a gap.
  selloffEndAt: Date.parse('2026-10-07T17:30:00Z'),
  endAt: Date.parse('2026-10-18T16:00:00Z'),
  firstGainPercent: 1247,
  secondGainPercent: 7217,
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

export const NRX_OWNER_ALLOCATION = '31250';
