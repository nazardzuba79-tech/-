/** Display-only Spot book math. Never used for matching, balances or execution. */
export interface SpotBookLevel { price: string; quantity: string }
export interface SpotDepthLevel { price: number; quantity: number; cumulative: number }

function positive(value: string | number | null): number | null {
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function spotBookMetrics(bids: readonly SpotBookLevel[], asks: readonly SpotBookLevel[]) {
  const prices = (levels: readonly SpotBookLevel[]) => levels
    .filter(level => positive(level.quantity) !== null)
    .map(level => positive(level.price)).filter((price): price is number => price !== null);
  const bidPrices = prices(bids), askPrices = prices(asks);
  const bestBid = bidPrices.length ? Math.max(...bidPrices) : null;
  const bestAsk = askPrices.length ? Math.min(...askPrices) : null;
  const complete = bestBid !== null && bestAsk !== null && bestAsk >= bestBid;
  const mid = complete ? (bestBid + bestAsk) / 2 : null;
  const spread = complete ? bestAsk - bestBid : null;
  return { bestBid, bestAsk, mid, spread, spreadPercent: spread === null || mid === null ? null : spread / mid * 100 };
}

export function spotGroupSteps(referencePrice: number | null): number[] {
  if (positive(referencePrice) === null) return [0.1, 0.5, 1, 10, 50];
  const unit = 10 ** Math.max(-18, Math.floor(Math.log10(referencePrice!)) - 5);
  return [1, 5, 10, 50, 100, 500].map(factor => Number((unit * factor).toPrecision(14)));
}

export function defaultSpotGroupStep(referencePrice: number | null): number {
  const steps = spotGroupSteps(referencePrice);
  return positive(referencePrice) === null ? steps[0] : steps[4];
}

/** Plain decimal string: this exact value also fills the order price input. */
export function spotLevelPrice(price: number, step: number): string {
  const decimals = Math.max(0, Math.min(20, -Math.floor(Math.log10(step))));
  return price.toFixed(decimals);
}

/** Retain tiny nonzero prices/spreads rather than presenting a rounded zero. */
export function formatSpotBookNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 10 ? 2 : magnitude >= 1 ? 4
    : Math.min(20, Math.max(6, 5 - Math.floor(Math.log10(magnitude || 1))));
  return value.toLocaleString('en-US', { minimumFractionDigits: magnitude >= 1 ? decimals : 0, maximumFractionDigits: decimals });
}

export function formatSpotSpreadPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 0.001 ? 3 : Math.min(14, Math.max(6, 2 - Math.floor(Math.log10(magnitude || 1))));
  return `${value.toLocaleString('en-US', { minimumFractionDigits: magnitude >= 0.001 ? 3 : 0, maximumFractionDigits: decimals })}%`;
}

export function aggregateSpotBook(levels: readonly SpotBookLevel[], step: number, side: 'BUY' | 'SELL'): SpotDepthLevel[] {
  if (positive(step) === null) return [];
  const buckets = new Map<number, number>();
  for (const level of levels) {
    const price = positive(level.price), quantity = positive(level.quantity);
    if (price === null || quantity === null) continue;
    const units = price / step;
    // Only remove floating-point boundary noise, not a real part of the tick.
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(units)) * 4;
    const bucketUnits = side === 'BUY' ? Math.floor(units + tolerance) : Math.ceil(units - tolerance);
    const bucket = Number((bucketUnits * step).toPrecision(14));
    if (bucket <= 0) continue;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + quantity);
  }
  let cumulative = 0;
  return [...buckets.entries()].sort((a, b) => side === 'BUY' ? b[0] - a[0] : a[0] - b[0])
    .map(([price, quantity]) => ({ price, quantity, cumulative: cumulative += quantity }));
}
