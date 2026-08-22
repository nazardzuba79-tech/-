import BigNumber from 'bignumber.js';
import { getLeverageTier } from '../config/futuresConfig';

export type PositionSide = 'LONG' | 'SHORT';

/** initial_margin = position_size / leverage (position_size here means notional value). */
export function computeInitialMargin(notional: BigNumber, leverage: number): BigNumber {
  return notional.dividedBy(leverage);
}

/**
 * Liquidation price for an ISOLATED-margin position:
 *   Long:  liq_price = entry_price * (1 - initial_margin_ratio + maintenance_margin_ratio)
 *   Short: liq_price = entry_price * (1 + initial_margin_ratio - maintenance_margin_ratio)
 * where initial_margin_ratio = 1 / leverage.
 */
export function computeLiquidationPrice(
  entryPrice: BigNumber,
  side: PositionSide,
  leverage: number,
  maintenanceMarginRate: number
): BigNumber {
  const initialMarginRatio = new BigNumber(1).dividedBy(leverage);
  const mmr = new BigNumber(maintenanceMarginRate);
  if (side === 'LONG') {
    return entryPrice.times(new BigNumber(1).minus(initialMarginRatio).plus(mmr));
  }
  return entryPrice.times(new BigNumber(1).plus(initialMarginRatio).minus(mmr));
}

/**
 * Liquidation price for a CROSS-margin position — the position's own
 * margin is backstopped by the rest of the futures wallet, so it can
 * absorb more adverse price movement before hitting maintenance margin.
 * `freeBalance` is the account's unlocked futures balance available to
 * that backstop; expressed as extra margin ratio added on top of the
 * position's own initial margin ratio.
 */
export function computeCrossLiquidationPrice(
  entryPrice: BigNumber,
  side: PositionSide,
  leverage: number,
  maintenanceMarginRate: number,
  notional: BigNumber,
  freeBalance: BigNumber
): BigNumber {
  const initialMarginRatio = new BigNumber(1).dividedBy(leverage);
  const mmr = new BigNumber(maintenanceMarginRate);
  // Extra cushion the free balance buys, expressed as a fraction of notional.
  const backstopRatio = notional.isZero() ? new BigNumber(0) : freeBalance.dividedBy(notional);
  if (side === 'LONG') {
    return entryPrice.times(new BigNumber(1).minus(initialMarginRatio).minus(backstopRatio).plus(mmr));
  }
  return entryPrice.times(new BigNumber(1).plus(initialMarginRatio).plus(backstopRatio).minus(mmr));
}

/** Unrealized PnL, computed off the mark price (never the last trade price —
 * see MarkPriceService for why). */
export function computeUnrealizedPnl(
  side: PositionSide,
  size: BigNumber,
  entryPrice: BigNumber,
  markPrice: BigNumber
): BigNumber {
  const diff = side === 'LONG' ? markPrice.minus(entryPrice) : entryPrice.minus(markPrice);
  return diff.times(size);
}

/** Return on equity — unrealized PnL as a fraction of the margin actually
 * put up, which is what makes leverage's effect on returns visible (the
 * same price move produces a much bigger ROE% at 50x than at 2x). */
export function computeROE(unrealizedPnl: BigNumber, initialMargin: BigNumber): BigNumber {
  if (initialMargin.isZero()) return new BigNumber(0);
  return unrealizedPnl.dividedBy(initialMargin);
}

/** Maintenance margin required to keep a position open, using the tiered
 * bracket table (rate + a fixed deduction so requirements stay continuous
 * across tier boundaries — see futuresConfig.ts). */
export function computeMaintenanceMargin(notional: BigNumber): BigNumber {
  const tier = getLeverageTier(notional.toNumber());
  return notional.times(tier.maintenanceMarginRate).minus(tier.maintenanceAmount);
}

/** Margin ratio — maintenance margin required as a fraction of current
 * margin balance (initial margin + unrealized PnL for isolated). 100%+
 * means the position is at or past its liquidation threshold. Shown in
 * the UI as an early-warning indicator before liquidation actually fires. */
export function computeMarginRatio(maintenanceMargin: BigNumber, marginBalance: BigNumber): BigNumber {
  if (marginBalance.isLessThanOrEqualTo(0)) return new BigNumber(1);
  return maintenanceMargin.dividedBy(marginBalance);
}

/**
 * Bankruptcy price — the price at which the position's margin balance
 * hits exactly zero (not just "below maintenance", but genuinely gone).
 * A liquidation that executes at a worse price than this leaves a
 * shortfall the insurance fund must cover; one that executes better than
 * this leaves a surplus the fund collects. See LiquidationEngine.
 */
export function computeBankruptcyPrice(
  entryPrice: BigNumber,
  side: PositionSide,
  leverage: number
): BigNumber {
  const initialMarginRatio = new BigNumber(1).dividedBy(leverage);
  if (side === 'LONG') {
    return entryPrice.times(new BigNumber(1).minus(initialMarginRatio));
  }
  return entryPrice.times(new BigNumber(1).plus(initialMarginRatio));
}
