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
