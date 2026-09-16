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

  const price = side === 'LONG'
    ? entryPrice * (1 - initialMarginRatio - backstopRatio + maintenanceMarginRate)
    : entryPrice * (1 + initialMarginRatio + backstopRatio - maintenanceMarginRate);

  /**
   * A PRICE AT OR BELOW ZERO IS NOT A PRICE.
   *
   * On a Cross position the account itself is the backstop, so a large
   * balance behind a small order pushes the formula's long result straight
   * through zero and out the other side: a 10 000 000 balance against a
   * 5 000 notional printed `-100 948 106.00` in the panel. It is not a
   * liquidation price the trader can be liquidated at — it is the formula
   * saying the adverse move does not exist, because the collateral outlasts
   * the contract.
   *
   * `null` is how this function already says "no answer", and it is what
   * the server's own estimator returns in the same situation. The panel
   * renders it as a dash. A negative number rendered as a price is the one
   * outcome that reads as information and is not.
   */
  return Number.isFinite(price) && price > 0 ? price : null;
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

// ---------------------------------------------------------------------------
// Contract rules
//
// A contract does not accept an arbitrary quantity. It has a step, a floor,
// a ceiling (a different one for MARKET than for LIMIT) and a minimum
// order value, and an order that misses any of them is refused outright.
// Sizing that ignores them produces a number the engine can only reject —
// which is exactly how a slider-sized order failed with "Количество не
// кратно шагу контракта" on the simulation engine while passing every test
// written against an engine that enforces no step at all.
// ---------------------------------------------------------------------------

export interface FuturesContractRules {
  qtyStep: string;
  minOrderQty: string;
  maxOrderQty: string;
  maxMarketOrderQty: string;
  minNotionalValue: string;
}

/** Decimal places a step implies: '0.001' -> 3, '1' -> 0, '10' -> 0. */
export function stepDecimals(step: string): number {
  const dot = step.indexOf('.');
  return dot === -1 ? 0 : step.length - dot - 1;
}

export interface ContractSizing {
  /** The quantity to submit. 0 when nothing valid fits. */
  quantity: number;
  /** Which rule bound the result, when one did — for a message that names it. */
  cappedBy: 'maxOrderQty' | 'maxMarketOrderQty' | null;
  /** The rule this quantity still violates, if any. */
  rejectedBy: 'minOrderQty' | 'minNotionalValue' | null;
  /** That rule's own value, so a message can quote it. */
  limit: string | null;
}

/**
 * Fit a desired quantity to what the contract will actually accept.
 *
 * Down, never up, at every step: the quantity is floored to a whole number
 * of `qtyStep`s and then clamped to the ceiling, so a size that fitted the
 * margin before still fits it after. What it cannot do is raise a quantity
 * to `minOrderQty` or to `minNotionalValue` — that would spend margin the
 * trader did not offer — so those are reported rather than applied.
 *
 * The step arithmetic runs on integers scaled by the step's own decimal
 * width, so `0.1 + 0.2` never decides whether an order is a multiple of
 * the step.
 */
export function fitQuantityToContract(
  quantity: number,
  price: number,
  rules: FuturesContractRules,
  options: { market: boolean },
): ContractSizing {
  const none: ContractSizing = { quantity: 0, cappedBy: null, rejectedBy: null, limit: null };
  if (!Number.isFinite(quantity) || quantity <= 0) return none;

  const decimals = stepDecimals(rules.qtyStep);
  const step = Number(rules.qtyStep);
  if (!(step > 0)) return none;

  const scale = 10 ** decimals;
  const steps = Math.floor(Number((quantity / step).toFixed(6)));
  let fitted = Number((steps * step).toFixed(decimals));

  const ceiling = Number(options.market ? rules.maxMarketOrderQty : rules.maxOrderQty);
  let cappedBy: ContractSizing['cappedBy'] = null;
  if (Number.isFinite(ceiling) && fitted > ceiling) {
    // The ceiling itself has to land on the step, so floor it too.
    fitted = Math.floor(Number((ceiling * scale).toFixed(6))) / scale;
    fitted = Number((Math.floor(Number((fitted / step).toFixed(6))) * step).toFixed(decimals));
    cappedBy = options.market ? 'maxMarketOrderQty' : 'maxOrderQty';
  }

  if (!(fitted > 0) || fitted < Number(rules.minOrderQty)) {
    return { quantity: 0, cappedBy, rejectedBy: 'minOrderQty', limit: rules.minOrderQty };
  }
  if (price > 0 && fitted * price < Number(rules.minNotionalValue)) {
    return { quantity: 0, cappedBy, rejectedBy: 'minNotionalValue', limit: rules.minNotionalValue };
  }
  return { quantity: fitted, cappedBy, rejectedBy: null, limit: cappedBy === null ? null : String(ceiling) };
}
