import type { SpotDepthLevel } from './spotOrderBook';

/** Display-only quantities in BASE units, including cumulative base depth. */
export function referenceQuantity(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value > 0 && value < 1e-7) return value.toExponential(2);
  if (value > 0 && value < 0.001) return value.toLocaleString('en-US', { maximumFractionDigits: Math.ceil(-Math.log10(value)) + 2 });
  if (value >= 1e6) return value.toExponential(3);
  return value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function visibleDepthRatio(bids: SpotDepthLevel[], asks: SpotDepthLevel[]): number | null {
  if (!bids.length || !asks.length) return null;
  const buy = bids[bids.length - 1].cumulative, sell = asks[asks.length - 1].cumulative;
  return Number.isFinite(buy + sell) && buy > 0 && sell > 0 ? buy / (buy + sell) * 100 : null;
}

/** Whole rows only: reserve the center price band before dividing the stacks. */
export function referenceRowCount(height: number, both: boolean): number {
  return Math.max(1, Math.min(30, Math.floor((height - 56) / (both ? 2 : 1) / 26)));
}
