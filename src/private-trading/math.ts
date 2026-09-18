import BigNumber from 'bignumber.js';
import { ContractRules, FinancialSnapshot, ModelProfile, PositionInput, RiskTier, Side } from './types';

// Local precision: never mutate the production engine's BigNumber configuration.
const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });
export function decimal(value: unknown, name = 'value', positive = false): BigNumber {
  if (typeof value !== 'string' || value.length > 120 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`INVALID_${name.toUpperCase()}`);
  const result = new D(value);
  if (!result.isFinite() || (positive && !result.gt(0))) throw new Error(`INVALID_${name.toUpperCase()}`);
  return result;
}
export const amount = (value: BigNumber): string => value.isZero() ? '0' : value.toFixed();
const nonnegative = (value: string, name: string) => {
  const n = decimal(value, name);
  if (n.lt(0)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return n;
};
function sideCheck(side: Side): void { if (side !== 'LONG' && side !== 'SHORT') throw new Error('INVALID_SIDE'); }
/**
 * A profile object that passed validation once passes again: profiles are
 * never mutated after registration, and the check walks the whole tier
 * ladder in decimal arithmetic. Re-running it for every order placed under
 * the same registered profile — every replayed order, on every command —
 * was a measurable share of a command's compute at thirty contracts.
 */
const validatedProfiles = new WeakSet<ModelProfile>();
export function validateProfile(profile: ModelProfile): void {
  if (validatedProfiles.has(profile)) return;
  validateProfileOnce(profile);
  validatedProfiles.add(profile);
}
function validateProfileOnce(profile: ModelProfile): void {
  for (const key of ['pricingModelVersion', 'feeModelVersion', 'riskModelVersion'] as const) if (!profile[key]) throw new Error('MODEL_VERSION_REQUIRED');
  for (const key of ['takerFeeRate', 'makerFeeRate', 'liquidationFeeRate'] as const) if (nonnegative(profile[key], key).gte(1)) throw new Error('INVALID_FEE_RATE');
  if (nonnegative(profile.slippageBps, 'slippage').gte(10000)) throw new Error('INVALID_SLIPPAGE');
  if (!profile.riskTiers.length) throw new Error('RISK_TIERS_REQUIRED');
  let lastCap = new D(0), lastRate = new D(0), lastDeduction = new D(0);
  for (const tier of profile.riskTiers) {
    const cap = decimal(tier.maxNotional, 'risk_cap', true), rate = nonnegative(tier.maintenanceRate, 'maintenance_rate');
    const deduction = nonnegative(tier.deduction, 'deduction');
    if (!cap.gt(lastCap) || rate.lt(lastRate) || rate.gte(1)) throw new Error('INVALID_RISK_TIERS');
    // A continuous tier schedule is required for a well-defined liquidation boundary.
    const expectedDeduction = lastDeduction.plus(lastCap.times(rate.minus(lastRate)));
    if (!deduction.minus(expectedDeduction).abs().lte('0.00000001')) throw new Error('DISCONTINUOUS_RISK_TIERS');
    if (tier.maxLeverage && decimal(tier.maxLeverage, 'tier_leverage', true).lt(1)) throw new Error('INVALID_TIER_LEVERAGE');
    lastCap = cap; lastRate = rate; lastDeduction = deduction;
  }
}
export function selectRiskTier(notional: string, profile: ModelProfile): RiskTier {
  const n = nonnegative(notional, 'notional');
  const tier = profile.riskTiers.find((t) => n.lte(decimal(t.maxNotional, 'risk_cap', true)));
  if (!tier) throw new Error('RISK_LIMIT_EXCEEDED');
  return tier;
}
export function linearPnl(side: Side, quantity: string, entryPrice: string, price: string): string {
  sideCheck(side);
  const q = nonnegative(quantity, 'quantity'), entry = decimal(entryPrice, 'entry_price', true), p = decimal(price, 'price', true);
  return amount(q.times(side === 'LONG' ? p.minus(entry) : entry.minus(p)));
}
export function roiPercent(pnl: string, basis: string): string | null {
  const denominator = nonnegative(basis, 'roi_basis');
  return denominator.isZero() ? null : amount(decimal(pnl).div(denominator).times(100));
}
export function weightedEntry(fills: Array<{ quantity: string; price: string }>): string {
  let q = new D(0), notional = new D(0);
  for (const fill of fills) { const size = decimal(fill.quantity, 'quantity', true); q = q.plus(size); notional = notional.plus(size.times(decimal(fill.price, 'price', true))); }
  if (q.isZero()) throw new Error('FILLS_REQUIRED');
  return amount(notional.div(q));
}
export function quoteOrderCost(input: { side: Side; quantity: string; price: string; leverage: string; profile: ModelProfile; maker?: boolean }) {
  sideCheck(input.side); validateProfile(input.profile);
  const q = decimal(input.quantity, 'quantity', true), p = decimal(input.price, 'price', true), l = decimal(input.leverage, 'leverage', true);
  if (l.lt(1)) throw new Error('INVALID_LEVERAGE');
  const notional = q.times(p), tier = selectRiskTier(amount(notional), input.profile);
  if (tier.maxLeverage && l.gt(tier.maxLeverage)) throw new Error('TIER_LEVERAGE_EXCEEDED');
  const base = notional.div(l), close = notional.times(input.side === 'LONG' ? new D(1).minus(new D(1).div(l)) : new D(1).plus(new D(1).div(l))).times(input.profile.takerFeeRate);
  const open = notional.times(input.maker ? input.profile.makerFeeRate : input.profile.takerFeeRate);
  return { entryNotional: amount(notional), baseInitialMargin: amount(base), closeFeeReserve: amount(close), openingFee: amount(open), positionMargin: amount(base.plus(close)), totalCost: amount(base.plus(close).plus(open)) };
}
function closingReserve(input: PositionInput): BigNumber {
  const q = decimal(input.quantity, 'quantity', true), e = decimal(input.entryPrice, 'entry_price', true), l = decimal(input.leverage, 'leverage', true);
  if (l.lt(1)) throw new Error('INVALID_LEVERAGE');
  return q.times(e).times(input.side === 'LONG' ? new D(1).minus(new D(1).div(l)) : new D(1).plus(new D(1).div(l))).times(input.profile.takerFeeRate);
}
export function liquidationPrice(input: PositionInput): string | null {
  sideCheck(input.side); validateProfile(input.profile);
  const q = decimal(input.quantity, 'quantity', true), e = decimal(input.entryPrice, 'entry_price', true), reserve = closingReserve(input);
  const collateral = input.allocatedMargin === undefined ? q.times(e).div(input.leverage).plus(reserve) : decimal(input.allocatedMargin, 'allocated_margin');
  let lower = new D(0);
  for (const tier of input.profile.riskTiers) {
    const rate = decimal(tier.maintenanceRate), deduction = decimal(tier.deduction), cap = decimal(tier.maxNotional);
    const numerator = input.side === 'LONG' ? q.times(e).minus(collateral).plus(reserve).minus(deduction) : q.times(e).plus(collateral).minus(reserve).plus(deduction);
    const denominator = q.times(input.side === 'LONG' ? new D(1).minus(rate) : new D(1).plus(rate));
    const price = numerator.div(denominator), notional = price.times(q);
    if (price.gt(0) && notional.gte(lower) && notional.lte(cap)) return amount(price);
    lower = cap;
  }
  return null;
}
export function calculatePosition(input: PositionInput): FinancialSnapshot {
  sideCheck(input.side); validateProfile(input.profile);
  const q = decimal(input.quantity, 'quantity', true), e = decimal(input.entryPrice, 'entry_price', true), mark = decimal(input.markPrice, 'mark_price', true);
  const reserve = closingReserve(input), base = q.times(e).div(input.leverage);
  const collateral = input.allocatedMargin === undefined ? base.plus(reserve) : decimal(input.allocatedMargin, 'allocated_margin');
  const tier = selectRiskTier(amount(q.times(mark)), input.profile);
  const maintenance = D.maximum(0, q.times(mark).times(tier.maintenanceRate).minus(tier.deduction)).plus(reserve);
  const pnl = decimal(linearPnl(input.side, input.quantity, input.entryPrice, input.markPrice));
  const gross = decimal(input.realizedGross ?? '0'), funding = decimal(input.fundingNet ?? '0');
  const net = gross.plus(pnl).plus(funding).minus(nonnegative(input.openingFees ?? '0', 'opening_fees')).minus(nonnegative(input.closingFees ?? '0', 'closing_fees'));
  const equity = collateral.plus(pnl);
  // Cash charges affect liquidation equity, not the contribution-based ROI denominator.
  const basis = input.roiMarginBasis === undefined ? D.maximum(0, collateral) : nonnegative(input.roiMarginBasis, 'roi_basis');
  return { entryNotional: amount(q.times(e)), markNotional: amount(q.times(mark)), baseInitialMargin: amount(base), closeFeeReserve: amount(reserve), allocatedMargin: amount(collateral), maintenanceMargin: amount(maintenance), equity: amount(equity), unrealizedPnl: amount(pnl), realizedGross: amount(gross), netPnl: amount(net), roiMarginBasis: amount(basis), roiPercent: roiPercent(amount(pnl), amount(basis)), liquidationPrice: liquidationPrice(input), liquidatable: equity.lte(maintenance) };
}
export function fundingCashflow(side: Side, quantity: string, markPrice: string, rate: string): string {
  sideCheck(side);
  const payment = nonnegative(quantity, 'quantity').times(decimal(markPrice, 'mark_price', true)).times(decimal(rate, 'funding_rate'));
  return amount(side === 'LONG' ? payment.negated() : payment);
}
export function closePositionAllocation(input: { side: Side; quantity: string; closeQuantity: string; entryPrice: string; exitPrice: string; allocatedMargin: string; openingFeesRemaining?: string; fundingRemaining?: string; feeRate: string }) {
  const q = decimal(input.quantity, 'quantity', true), closed = decimal(input.closeQuantity, 'close_quantity', true);
  if (closed.gt(q)) throw new Error('CLOSE_EXCEEDS_POSITION');
  const ratio = closed.div(q), margin = decimal(input.allocatedMargin, 'allocated_margin');
  const fee = closed.times(decimal(input.exitPrice, 'exit_price', true)).times(nonnegative(input.feeRate, 'fee_rate'));
  const gross = decimal(linearPnl(input.side, input.closeQuantity, input.entryPrice, input.exitPrice));
  const openAllocated = nonnegative(input.openingFeesRemaining ?? '0', 'opening_fees').times(ratio), fundingAllocated = decimal(input.fundingRemaining ?? '0').times(ratio);
  return { remainingQuantity: amount(q.minus(closed)), releasedMargin: amount(margin.times(ratio)), remainingMargin: amount(margin.times(new D(1).minus(ratio))), closingFee: amount(fee), realizedGross: amount(gross), allocatedOpeningFees: amount(openAllocated), allocatedFunding: amount(fundingAllocated), netRealized: amount(gross.minus(fee).minus(openAllocated).plus(fundingAllocated)) };
}
/**
 * A contract rule the order broke, with the rule's own number.
 *
 * `message` is still the bare code, so every existing catch, error map and
 * test that matches on it is unaffected. What is added is `detail`: WHICH
 * limit, what it allows, and what the order asked for — because "Размер
 * ордера вне лимитов контракта" names none of the three, and a trader who
 * cannot see the number cannot pick a size that satisfies it.
 */
export class ContractRuleError extends Error {
  constructor(code: string, readonly detail: { limit: string; allowed: string; actual: string }) {
    super(code);
    this.name = 'ContractRuleError';
  }
}

/**
 * `reduceOnly`: the order only reduces an existing position. Every contract
 * rule still applies to it — quantity and price steps, order size limits,
 * minimum notional, the leverage range — but the RISK-TIER leverage cap does
 * not: that cap admits new exposure, and a reducing order adds none. A
 * position whose tier has tightened since it was opened (the market moved
 * its notional up the ladder) must still be closable at its own leverage.
 */
export function validateContractOrder(input: { rules: ContractRules; quantity: string; price: string; leverage: string; market: boolean; profile: ModelProfile; reduceOnly?: boolean }): void {
  const { rules } = input, q = decimal(input.quantity, 'quantity', true), p = decimal(input.price, 'price', true), l = decimal(input.leverage, 'leverage', true);
  if (!q.mod(decimal(rules.qtyStep, 'quantity_step', true)).isZero()) {
    throw new ContractRuleError('INVALID_QUANTITY_STEP', { limit: 'qtyStep', allowed: rules.qtyStep, actual: input.quantity });
  }
  if (!input.market && !p.mod(decimal(rules.tickSize, 'price_step', true)).isZero()) {
    throw new ContractRuleError('INVALID_PRICE_STEP', { limit: 'tickSize', allowed: rules.tickSize, actual: input.price });
  }
  // Split into the three distinct rules it always was, so the refusal can
  // say which one bound — a MARKET order over maxMarketOrderQty and an
  // order under minNotionalValue are different problems with different fixes.
  if (q.lt(rules.minOrderQty)) {
    throw new ContractRuleError('INVALID_ORDER_SIZE', { limit: 'minOrderQty', allowed: rules.minOrderQty, actual: input.quantity });
  }
  const maxQty = input.market ? rules.maxMarketOrderQty : rules.maxOrderQty;
  if (q.gt(maxQty)) {
    throw new ContractRuleError('INVALID_ORDER_SIZE', {
      limit: input.market ? 'maxMarketOrderQty' : 'maxOrderQty', allowed: maxQty, actual: input.quantity,
    });
  }
  if (q.times(p).lt(rules.minNotionalValue)) {
    throw new ContractRuleError('INVALID_ORDER_SIZE', { limit: 'minNotionalValue', allowed: rules.minNotionalValue, actual: amount(q.times(p)) });
  }
  if (l.lt(rules.minLeverage) || l.gt(rules.maxLeverage) || !l.minus(rules.minLeverage).mod(decimal(rules.leverageStep, 'leverage_step', true)).isZero()) {
    throw new ContractRuleError('INVALID_LEVERAGE', {
      limit: l.gt(rules.maxLeverage) ? 'maxLeverage' : l.lt(rules.minLeverage) ? 'minLeverage' : 'leverageStep',
      allowed: l.gt(rules.maxLeverage) ? rules.maxLeverage : l.lt(rules.minLeverage) ? rules.minLeverage : rules.leverageStep,
      actual: input.leverage,
    });
  }
  validateProfile(input.profile);
  if (input.reduceOnly) return;
  const tier = selectRiskTier(amount(q.times(p)), input.profile);
  if (tier.maxLeverage && l.gt(tier.maxLeverage)) {
    throw new ContractRuleError('TIER_LEVERAGE_EXCEEDED', { limit: 'tierMaxLeverage', allowed: tier.maxLeverage, actual: input.leverage });
  }
}
export interface BookLevel { price: string; quantity: string }
export function consumeBook(side: 'BUY' | 'SELL', quantity: string, book: { bids: BookLevel[]; asks: BookLevel[] }, limitPrice?: string) {
  if (side !== 'BUY' && side !== 'SELL') throw new Error('INVALID_SIDE');
  let remaining = decimal(quantity, 'quantity', true);
  const limit = limitPrice === undefined ? null : decimal(limitPrice, 'limit_price', true);
  const levels = (side === 'BUY' ? book.asks : book.bids).map((level) => ({ price: decimal(level.price, 'book_price', true), quantity: decimal(level.quantity, 'book_quantity', true) })).sort((a, b) => side === 'BUY' ? a.price.comparedTo(b.price)! : b.price.comparedTo(a.price)!);
  const fills: Array<{quantity: string; price: string}> = [];
  for (const level of levels) {
    if (limit && (side === 'BUY' ? level.price.gt(limit) : level.price.lt(limit))) break;
    const size = D.minimum(remaining, level.quantity);
    if (size.isZero()) break;
    fills.push({ quantity: amount(size), price: amount(level.price) }); remaining = remaining.minus(size);
  }
  return { fills, filledQuantity: amount(decimal(quantity).minus(remaining)), remainingQuantity: amount(remaining), averagePrice: fills.length ? weightedEntry(fills) : null, complete: remaining.isZero() };
}
