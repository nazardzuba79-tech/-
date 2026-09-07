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
