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

/**
 * History20 private test markets (privateTest.ts), `<SYMBOL>/SIMUSDT`. Kept
 * apart from the published listings: the public routes never serve them, and
 * only the owner and allowlisted testers may trade them.
 */
let privateTestAssets: readonly TestAssetConfig[] = Object.freeze([]);

export function setPrivateTestListingAssets(next: readonly TestAssetConfig[]): void {
  privateTestAssets = Object.freeze([...next]);
}

export function privateTestListingAssets(): readonly TestAssetConfig[] {
  return privateTestAssets;
}
