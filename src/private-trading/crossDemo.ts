import BigNumber from 'bignumber.js';
import { amount, calculatePosition, decimal } from './math';
import type { Candle, ModelProfile, Side } from './types';
import { NATIVE_DEMO_MODEL } from './native/engine';

const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });

/**
 * Owner-set custom demo funding cash-flow per 8h settlement (signed fraction of position value).
 * Single source of truth: the native engine model. Not provider/Bybit funding.
 */
export const DEMO_FUNDING_CASHFLOW_RATE = {
  LONG: NATIVE_DEMO_MODEL.funding.longCashflow,
  SHORT: NATIVE_DEMO_MODEL.funding.shortCashflow,
} as const;

export interface CrossDemoPositionInput {
  id: string;
  side: Side;
  quantity: string;
  entryPrice: string;
  markPrice: string;
  leverage: string;
  profile: ModelProfile;
}

export interface CrossDemoAccountSnapshot {
  walletBalance: string;
  totalUnrealizedPnl: string;
  marginBalance: string;
  totalMaintenanceMargin: string;
  maintenanceMarginRate: string | null;
  liquidatable: boolean;
}

function positionRisk(position: CrossDemoPositionInput, markPrice = position.markPrice) {
  // allocatedMargin is intentionally zero here: cross collateral lives at account
  // level. calculatePosition remains the single source for P&L and tiered MM.
  return calculatePosition({
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    markPrice,
    leverage: position.leverage,
    allocatedMargin: '0',
    profile: position.profile,
  });
}

/**
 * Bybit-style cross account health for the private demo account.
 * Wallet balance is the whole demo wallet after realized fees/funding; every
 * open USDT-perpetual position shares that collateral.
 */
export function crossDemoAccountSnapshot(walletBalance: string, positions: CrossDemoPositionInput[]): CrossDemoAccountSnapshot {
  const wallet = decimal(walletBalance, 'wallet_balance');
  if (wallet.lt(0)) throw new Error('INVALID_WALLET_BALANCE');
  let upl = new D(0), maintenance = new D(0);
  for (const position of positions) {
    const risk = positionRisk(position);
    upl = upl.plus(risk.unrealizedPnl);
    maintenance = maintenance.plus(risk.maintenanceMargin);
  }
  const marginBalance = wallet.plus(upl);
  return {
    walletBalance: amount(wallet),
    totalUnrealizedPnl: amount(upl),
    marginBalance: amount(marginBalance),
    totalMaintenanceMargin: amount(maintenance),
    maintenanceMarginRate: marginBalance.lte(0) ? null : amount(maintenance.div(marginBalance)),
    liquidatable: marginBalance.lte(maintenance),
  };
}

function health(walletBalance: string, positions: CrossDemoPositionInput[], targetId: string, targetMark: BigNumber): BigNumber {
  const wallet = decimal(walletBalance, 'wallet_balance');
  let upl = new D(0), maintenance = new D(0);
  for (const position of positions) {
    const risk = positionRisk(position, position.id === targetId ? amount(targetMark) : position.markPrice);
    upl = upl.plus(risk.unrealizedPnl);
    maintenance = maintenance.plus(risk.maintenanceMargin);
  }
  return wallet.plus(upl).minus(maintenance);
}

/**
 * Dynamic cross-margin liquidation reference with all other positions frozen at
 * their current mark. Returns null when the shared wallet keeps the position
 * solvent for every positive price in the searched direction.
 */
export function crossDemoLiquidationPrice(walletBalance: string, positions: CrossDemoPositionInput[], targetId: string): string | null {
  const target = positions.find(position => position.id === targetId);
  if (!target) throw new Error('POSITION_NOT_FOUND');
  const current = decimal(target.markPrice, 'mark_price', true);
  const currentHealth = health(walletBalance, positions, targetId, current);
  if (currentHealth.lte(0)) return amount(current);

  let low: BigNumber, high: BigNumber;
  if (target.side === 'LONG') {
    low = new D('0.000000000001');
    high = current;
    if (health(walletBalance, positions, targetId, low).gt(0)) return null;
  } else {
    low = current;
    high = D.maximum(current.times(2), decimal(target.entryPrice, 'entry_price', true).times(2));
    let attempts = 0;
    while (health(walletBalance, positions, targetId, high).gt(0) && attempts++ < 80) high = high.times(2);
    if (attempts >= 80 && health(walletBalance, positions, targetId, high).gt(0)) return null;
  }

  // Find the zero of account equity - account MM. For LONG health increases with
  // price; for SHORT it decreases with price.
  for (let i = 0; i < 160; i++) {
    const mid = low.plus(high).div(2);
    const h = health(walletBalance, positions, targetId, mid);
    if (target.side === 'LONG') {
      if (h.lte(0)) low = mid; else high = mid;
    } else {
      if (h.gt(0)) low = mid; else high = mid;
    }
  }
  return amount(target.side === 'LONG' ? high : low);
}

/** Funding fee = position value × funding cash-flow rate. */
export function crossDemoFundingCashflow(side: Side, quantity: string, markPrice: string): string {
  const q = decimal(quantity, 'quantity', true);
  const mark = decimal(markPrice, 'mark_price', true);
  const rate = new D(DEMO_FUNDING_CASHFLOW_RATE[side]);
  return amount(q.times(mark).times(rate));
}

/**
 * OHLC-only historical limit fill. A gap through the limit receives the candle
 * open (better price); otherwise a wick touch fills at the limit.
 */
export function historicalLimitFillPrice(side: Side, limitPrice: string, candle: Candle): string | null {
  const limit = decimal(limitPrice, 'limit_price', true);
  const open = decimal(candle.open, 'candle_open', true);
  const high = decimal(candle.high, 'candle_high', true);
  const low = decimal(candle.low, 'candle_low', true);
  if (side === 'LONG') {
    if (low.gt(limit)) return null;
    return amount(open.lte(limit) ? open : limit);
  }
  if (high.lt(limit)) return null;
  return amount(open.gte(limit) ? open : limit);
}
