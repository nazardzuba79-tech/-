export interface CapitalizationAsset {
  symbol: string;
  categories: string[];
  marketCap: number | null;
}

/** Rank real reported capitalization, never volume or a hardcoded coin list. */
export function topCapitalizationAssets<T extends CapitalizationAsset>(assets: readonly T[]): T[] {
  const seen = new Set<string>();
  return assets.filter(asset => !asset.categories.includes('STABLECOIN') &&
    asset.marketCap !== null && Number.isFinite(asset.marketCap) && asset.marketCap > 0)
    .slice().sort((a, b) => b.marketCap! - a.marketCap! || a.symbol.localeCompare(b.symbol))
    .filter(asset => {
      const symbol = asset.symbol.toUpperCase();
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    }).slice(0, 8);
}
