import { formatSpotBookNumber, spotLevelPrice, type SpotDepthLevel } from './spotOrderBook';

/** Display-only quantities in BASE units, including cumulative base depth. */
function shortExponent(value: number): string {
  const text = value.toExponential(2);
  return text.length > 8 ? value.toExponential(1) : text;
}

export function referenceQuantity(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1e12) return shortExponent(value);
  for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= scale) return `${(value / scale).toFixed(2)}${suffix}`;
  }
  const text = value > 0 && value < 0.001
    ? value.toLocaleString('en-US', { maximumFractionDigits: Math.min(20, Math.ceil(-Math.log10(value)) + 2) })
    : value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return text.length > 8 || (value > 0 && Number(text) === 0) ? shortExponent(value) : text;
}

/** Bounded display only; price selection always uses the full spotLevelPrice value. */
export function referencePrice(value: number, step?: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const decimals = step === undefined ? undefined : Math.max(2, spotLevelPrice(value, step).split('.')[1]?.length ?? 0);
  const text = decimals === undefined ? formatSpotBookNumber(value) : value.toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
  return text.length > 10 || Number(text.replace(/,/g, '')) === 0 ? value.toExponential(3) : text;
}

export function visibleDepthRatio(bids: SpotDepthLevel[], asks: SpotDepthLevel[]): number | null {
  if (!bids.length || !asks.length) return null;
  const buy = bids[bids.length - 1].cumulative, sell = asks[asks.length - 1].cumulative;
  return Number.isFinite(buy + sell) && buy > 0 && sell > 0 ? buy / (buy + sell) * 100 : null;
}

export const REFERENCE_ROW_HEIGHT = 22;
export const REFERENCE_CENTER_HEIGHT = 36;

/** Whole rows only: reserve the center price band before dividing the stacks. */
export function referenceRowCount(height: number, both: boolean): number {
  return Math.max(1, Math.min(30, Math.floor((height - REFERENCE_CENTER_HEIGHT) / (both ? 2 : 1) / REFERENCE_ROW_HEIGHT)));
}
