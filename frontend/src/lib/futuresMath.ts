// Client-side mirror of src/futures/marginMath.ts's liquidation-price
// formulas — used ONLY for a live preview in the order form before
// submitting. The backend recomputes and stores the authoritative value
// at order-fill time; this never gates anything, it just shows the trader
// what to expect using the exact same math.

export interface LeverageTier {
  notionalCap: number | null; // null = last/uncapped tier
  maxLeverage: number;
  maintenanceMarginRate: number;
  maintenanceAmount: number;
}

export function getLeverageTier(tiers: LeverageTier[], notionalUsd: number): LeverageTier | null {
  for (const tier of tiers) {
    if (tier.notionalCap === null || notionalUsd <= tier.notionalCap) return tier;
  }
  return tiers[tiers.length - 1] ?? null;
}

export interface FuturesExposurePosition {
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
}

export interface FuturesExposureOrder {
  side: 'BUY' | 'SELL';
  remainingQuantity: number;
  price: number;
}

/** Informational client mirror of the backend exposure projection. */
export function projectFuturesExposureNotional(params: {
  position: FuturesExposurePosition | null;
  activeOrders: FuturesExposureOrder[];
  candidate: FuturesExposureOrder;
}): number {
  const direction = params.candidate.side === 'BUY' ? 'LONG' : 'SHORT';
  const legs = [...params.activeOrders, params.candidate].filter(
    (order) => order.side === params.candidate.side && order.remainingQuantity > 0
  );
  if (!params.position) {
    return legs.reduce((total, order) => total + order.remainingQuantity * order.price, 0);
  }
  if (params.position.side === direction) {
    return params.position.size * params.position.entryPrice
      + legs.reduce((total, order) => total + order.remainingQuantity * order.price, 0);
  }

  let quantityToReduce = params.position.size;
  let remainderNotional = 0;
  for (const order of [...legs].sort((a, b) => a.price - b.price)) {
    const reducingQuantity = Math.min(quantityToReduce, order.remainingQuantity);
    quantityToReduce -= reducingQuantity;
    remainderNotional += (order.remainingQuantity - reducingQuantity) * order.price;
  }
  return remainderNotional;
}

export function previewLiquidationPrice(params: {
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  leverage: number;
  marginType: 'ISOLATED' | 'CROSS';
  maintenanceMarginRate: number;
  notional: number;
  freeBalance: number;
}): number | null {
  const { entryPrice, side, leverage, marginType, maintenanceMarginRate, notional, freeBalance } = params;
  if (!entryPrice || !leverage || entryPrice <= 0 || leverage <= 0) return null;

  const initialMarginRatio = 1 / leverage;
  const backstopRatio = marginType === 'CROSS' && notional > 0 ? freeBalance / notional : 0;

  if (side === 'LONG') {
    return entryPrice * (1 - initialMarginRatio - backstopRatio + maintenanceMarginRate);
  }
  return entryPrice * (1 + initialMarginRatio + backstopRatio - maintenanceMarginRate);
}

// ---------------------------------------------------------------------------
// Position sizing
//
// Sizing is not "balance × leverage". The leverage a position is allowed to
// use is itself a function of how big that position is (the tier table), so
// the maximum order is the fixed point of the two constraints, not the
// product of them. Computing the product and letting the tier clamp the
// leverage afterwards — which is what this form used to do — leaves the
// QUANTITY sized for the leverage the trader picked and the MARGIN charged
// at the lower one the tier allows, and the server rejects the difference.
// ---------------------------------------------------------------------------

/** Decimal places an order quantity is submitted with. */
export const QUANTITY_DECIMALS = 8;

/**
 * Relative shave applied to a computed maximum before it becomes an order.
 *
 * The server compares exact decimals; the client computes in doubles. A
 * 1 000 000 USDT order in a 0.0000082 USDT contract is ~1.2e11 units, and
 * multiplying that back by the price carries ~1e-10 USDT of representation
 * error — enough to land fractionally OVER the free margin, or over a tier
 * cap, and be rejected outright. A trillionth of the order is invisible to
 * the trader and orders of magnitude larger than any such error.
 */
const SIZING_SAFETY = 1 - 1e-12;

/**
 * Floor `value` to `decimals` places.
 *
 * Sizing must never round UP. `toFixed` rounds to nearest, so a quantity of
 * 10 000 / 60 000 becomes 0.16666667 — fractionally MORE than the margin
 * that paid for it, which is why dragging the size slider to 100% used to
 * be rejected on roughly a third of the listed contracts.
 *
 * The truncation is done on the decimal text rather than by scaling by
 * 10^decimals, because the scaled value exceeds 2^53 for the low-priced
 * end of the universe and `Math.floor` on it is a no-op.
 */
export function floorToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const text = value.toFixed(decimals + 2);
  const dot = text.indexOf('.');
  return Number(decimals > 0 ? text.slice(0, dot + 1 + decimals) : text.slice(0, dot));
}

/**
 * The largest order that BOTH fits the free margin and stays inside the
 * leverage tier its own size selects, together with the leverage that
 * order may actually use.
 *
 * `tier.maxLeverage` is non-increasing in notional, so the fixed point is
 * exact after one pass: each tier offers `min(selected, tier.maxLeverage)`
 * of leverage and has room up to its own cap, and the answer is whichever
 * tier yields the most notional. With the shipped table and 10 000 USDT
 * free, 100x selected, that is 250 000 USDT at 50x — not the 1 000 000 at
 * 100x the raw product suggests, which would need 100 000 USDT of margin.
 *
 * `existingExposure` is the bucket's exposure WITHOUT this order: the tier
 * is chosen by the resulting total, while the margin is charged only for
 * the new exposure (whatever backs the existing position is already locked
 * and therefore already out of `freeMargin`).
 */
export function maxAffordableNotional(params: {
  tiers: LeverageTier[];
  freeMargin: number;
  selectedLeverage: number;
  existingExposure?: number;
}): { notional: number; leverage: number } {
  const { tiers, freeMargin, selectedLeverage } = params;
  const existingExposure = params.existingExposure ?? 0;
  const none = { notional: 0, leverage: selectedLeverage };
  if (!Number.isFinite(freeMargin) || freeMargin <= 0) return none;
  if (!Number.isFinite(selectedLeverage) || selectedLeverage <= 0) return none;
  if (tiers.length === 0) {
    return { notional: freeMargin * selectedLeverage * SIZING_SAFETY, leverage: selectedLeverage };
  }

  let best = 0;
  for (const tier of tiers) {
    const leverage = Math.min(selectedLeverage, tier.maxLeverage);
    if (!(leverage > 0)) continue;
    // Two independent ceilings: what the margin buys at this tier's
    // leverage, and how much exposure the tier itself still has room for.
    const room = tier.notionalCap === null ? Infinity : tier.notionalCap - existingExposure;
    const notional = Math.min(freeMargin * leverage, room);
    if (notional > best) best = notional;
  }
  if (!(best > 0) || !Number.isFinite(best)) return none;

  const notional = best * SIZING_SAFETY;
  // The tier is re-read from the answer rather than carried out of the
  // loop: a margin-limited size can land in an EARLIER tier than the one
  // that produced it, and that tier's ceiling is the higher of the two.
  const tier = getLeverageTier(tiers, existingExposure + notional);
  return { notional, leverage: Math.min(selectedLeverage, tier?.maxLeverage ?? selectedLeverage) };
}
