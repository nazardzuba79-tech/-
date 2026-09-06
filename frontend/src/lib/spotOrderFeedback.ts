/** Read-only interpretation of the real placement response, not execution math. */
export type SpotOrderFeedback =
  | { kind: 'placed' | 'cancelledEmpty' | 'unknown' }
  | { kind: 'cancelledPartial'; filled: string; remaining: string };

function decimal(value: unknown): { units: bigint; scale: number } | null {
  if (typeof value !== 'string' || value.length > 128 || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const [mantissa, exponent = '0'] = value.toLowerCase().split('e');
  if (Math.abs(Number(exponent)) > 100) return null;
  const [integer, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  return scale < 0 ? { units: BigInt(integer + fraction) * 10n ** BigInt(-scale), scale: 0 }
    : { units: BigInt(integer + fraction), scale };
}

function quantity(units: bigint, scale: number) {
  if (scale === 0) return units.toString();
  const text = units.toString().padStart(scale + 1, '0');
  return (text.slice(0, -scale) + '.' + text.slice(-scale)).replace(/\.?0+$/, '');
}

export function spotOrderFeedback(response: unknown): SpotOrderFeedback {
  if (!response || typeof response !== 'object') return { kind: 'unknown' };
  const { order, trades } = response as { order?: Record<string, unknown>; trades?: unknown[] };
  if (!order || typeof order !== 'object') return { kind: 'unknown' };
  if (['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER', 'FILLED'].includes(String(order.status))) return { kind: 'placed' };
  if (order.status !== 'CANCELLED' || !Array.isArray(trades)) return { kind: 'unknown' };
  const original = decimal(order.originalQuantity); const remaining = decimal(order.remainingQuantity);
  const fills = trades.map(trade => decimal(trade && typeof trade === 'object' ? (trade as Record<string, unknown>).quantity : undefined));
  if (!original || !remaining || fills.some(fill => !fill)) return { kind: 'unknown' };
  const scale = Math.max(original.scale, remaining.scale, ...fills.map(fill => fill!.scale));
  const units = (value: { units: bigint; scale: number }) => value.units * 10n ** BigInt(scale - value.scale);
  const filled = units(original) - units(remaining);
  const actualFills = fills.reduce((sum, fill) => sum + units(fill!), 0n);
  // Never announce an invented fill if status/quantities/trades disagree.
  if (original.units <= 0n || filled < 0n || filled !== actualFills) return { kind: 'unknown' };
  if (filled === 0n) return { kind: 'cancelledEmpty' };
  return { kind: 'cancelledPartial', filled: quantity(filled, scale), remaining: quantity(units(remaining), scale) || '0' };
}
