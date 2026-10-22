export type MarketColumnSort<F extends string = 'price' | 'change'> = { field: F; dir: 1 | -1 } | null;

/** Third click restores the product's normal listing, without selecting a market. */
export function nextMarketColumnSort<F extends string>(current: MarketColumnSort<F>, field: F): MarketColumnSort<F> {
  return current?.field !== field ? { field, dir: -1 }
    : current.dir === -1 ? { field, dir: 1 } : null;
}

export function compareMarketValues(a: number | null, b: number | null, dir: 1 | -1): number {
  const validA = a !== null && Number.isFinite(a), validB = b !== null && Number.isFinite(b);
  if (!validA || !validB) return validA ? -1 : validB ? 1 : 0;
  return (a! - b!) * dir;
}
