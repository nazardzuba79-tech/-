import type { TestAssetConfig } from './testAssetConfig';

/** Shared configuration only: no environment, network, database or clock reads. */
export const NEURIX: TestAssetConfig = Object.freeze({
  symbol: 'NRX', name: 'NEURIX', quote: 'USDT', pair: 'NRX/USDT',
  isTestAsset: true, isTradable: true, listingArmed: true,
  listingAt: Date.parse('2026-10-03T13:00:00Z'), initialPrice: 0.80,
  seed: 'neurix-2026-10-03',
});

export const NRX_OWNER_ALLOCATION = '31250';
