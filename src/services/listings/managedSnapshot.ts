/**
 * The published managed listings Render currently knows, as test-asset
 * configurations. A plain holder: no IO, so the synchronous restricted-asset
 * guards (deposits, withdrawals, adjustments, collateral, Spot listing) can
 * read it. `registry.ts` keeps it fresh.
 */
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';
import { isAith } from '../../shared/aithPublication';

let assets: readonly TestAssetConfig[] = Object.freeze([]);
let aithValidUntil = 0;

export function setManagedListingAssets(next: readonly TestAssetConfig[], validUntil = 0): void {
  assets = Object.freeze([...next]);
  aithValidUntil = validUntil;
}

export function managedListingAssets(): readonly TestAssetConfig[] {
  return assets.filter(asset => !isAith(asset.symbol) || Date.now() < aithValidUntil);
}
