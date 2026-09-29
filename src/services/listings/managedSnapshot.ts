/**
 * The published managed listings Render currently knows, as test-asset
 * configurations. A plain holder: no IO, so the synchronous restricted-asset
 * guards (deposits, withdrawals, adjustments, collateral, Spot listing) can
 * read it. `registry.ts` keeps it fresh.
 */
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';

let assets: readonly TestAssetConfig[] = Object.freeze([]);

export function setManagedListingAssets(next: readonly TestAssetConfig[]): void {
  assets = Object.freeze([...next]);
}

export function managedListingAssets(): readonly TestAssetConfig[] {
  return assets;
}
