import type { TestAssetConfig } from './testAssetConfig';
import type { GrowthScheduledScenarioConfig, ScheduledScenarioConfig } from './simulationSchedule';

/** Shared configuration only: no environment, network, database or clock reads. */
const NRX_LISTING_AT = Date.parse('2026-10-03T13:00:00Z');

/** Owner's 2026-10-03 review plan. UTC instants below are Kyiv UTC+3.
 * NOT a deploy-now configuration: run the release preflight before BOTH
 * backend and edge rollouts. An elapsed activation must be rescheduled, never
 * applied retroactively to displayed prices or executed orders.
 *
 * NOT attached to NEURIX (2026-10-05): its activation passed before any API or
 * edge release carried it. The live chart (market-edge 8de23981) never ran it,
 * and attaching it now would price API sales away from that chart. Kept as the
 * reviewed plan; re-attach only with a future activation through the gate.
 */
export const NRX_TWO_WEEK_SCENARIO: Readonly<GrowthScheduledScenarioConfig> = Object.freeze({
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

/** Owner update 2026-10-05: end the growth phase prospectively.
 * 13:00 Kyiv activation -> 48h balance -> 6h -60% selloff -> balance forever.
 * The simulator anchors this program to the exact canonical NRX tick at
 * activation, so nothing already displayed or sold is rewritten.
 */
export const NRX_BALANCE_SELLOFF_SCENARIO: Readonly<ScheduledScenarioConfig> = Object.freeze({
  mode: 'range-selloff-range',
  version: 4,
  from: Date.parse('2026-10-05T10:00:00Z'), // 13:00 Kyiv
  rangeEndAt: Date.parse('2026-10-07T10:00:00Z'), // 48h balance
  selloffEndAt: Date.parse('2026-10-07T16:00:00Z'), // six-hour -60% selloff
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
  scheduledScenario: NRX_BALANCE_SELLOFF_SCENARIO,
});

export const NRX_OWNER_ALLOCATION = '6250';
