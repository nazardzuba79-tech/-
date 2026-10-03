import type { TestAssetConfig } from './testAssetConfig';

/** Shared configuration only: no environment, network, database or clock reads. */
const NRX_LISTING_AT = Date.parse('2026-10-03T13:00:00Z');

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
});

export const NRX_OWNER_ALLOCATION = '6250';
