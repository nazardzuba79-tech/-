import { calculatePosition, closePositionAllocation, consumeBook, decimal, fundingCashflow, linearPnl, liquidationPrice, quoteOrderCost, roiPercent, validateContractOrder, validateProfile, weightedEntry } from '../math';
import { ContractRules, ModelProfile } from '../types';

export const profile: ModelProfile = { pricingModelVersion: 'test-price-v1', feeModelVersion: 'test-fees-v1', riskModelVersion: 'test-risk-v1', takerFeeRate: '0', makerFeeRate: '0', liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: ['TEST_ONLY_PARAMETERS'] };
const feeProfile = { ...profile, takerFeeRate: '0.00055', makerFeeRate: '0.0002' };
const rules: ContractRules = { symbol: 'XYZUSDT', tickSize: '0.001', qtyStep: '0.1', minOrderQty: '0.2', maxOrderQty: '10000', maxMarketOrderQty: '500', minNotionalValue: '5', minLeverage: '1', maxLeverage: '50', leverageStep: '0.1' };

describe('private isolated decimal math', () => {
  test('requested 120% price rise produces 1200% margin ROI without applying leverage twice', () => {
    const p = calculatePosition({ side: 'LONG', quantity: '10', entryPrice: '100', markPrice: '220', leverage: '10', profile });
    expect(p).toMatchObject({ entryNotional: '1000', baseInitialMargin: '100', unrealizedPnl: '1200', netPnl: '1200', roiPercent: '1200' });
  });
  test.each(['1', '2', '5', '10', '25', '50'])('fixed quantity has fixed absolute PnL at %sx', (leverage) => {
    const p = calculatePosition({ side: 'LONG', quantity: '10', entryPrice: '100', markPrice: '110', leverage, profile });
    expect(p.unrealizedPnl).toBe('100'); expect(p.roiPercent).toBe(decimal(leverage).times(10).toFixed());
  });
  test('short sign, negative PnL, and weighted fills', () => {
    expect(linearPnl('SHORT', '3', '100', '90')).toBe('30');
    expect(linearPnl('SHORT', '3', '100', '110')).toBe('-30');
    expect(weightedEntry([{ quantity: '1', price: '100' }, { quantity: '3', price: '120' }])).toBe('115');
  });
  test('close fee reserve is collateral, not an already paid fee', () => {
    const cost = quoteOrderCost({ side: 'LONG', quantity: '10', price: '100', leverage: '10', profile: feeProfile });
    expect(cost).toMatchObject({ openingFee: '0.55', closeFeeReserve: '0.495', positionMargin: '100.495', totalCost: '101.045' });
    const value = calculatePosition({ side: 'LONG', quantity: '10', entryPrice: '100', markPrice: '110', leverage: '10', openingFees: cost.openingFee, profile: feeProfile });
    expect(value.netPnl).toBe('99.45'); expect(value.roiMarginBasis).toBe('100.495');
    expect(quoteOrderCost({ side: 'SHORT', quantity: '10', price: '100', leverage: '10', profile: feeProfile }).closeFeeReserve).toBe('0.605');
  });
  test('added collateral moves liquidation away and reduces ROI', () => {
    const base = { side: 'LONG' as const, quantity: '10', entryPrice: '100', markPrice: '110', leverage: '10', profile };
    const before = calculatePosition(base), after = calculatePosition({ ...base, allocatedMargin: '200' });
    expect(after.roiPercent).toBe('50'); expect(decimal(after.liquidationPrice!).lt(before.liquidationPrice!)).toBe(true);
    expect(after.unrealizedPnl).toBe(before.unrealizedPnl);
  });
  test('piecewise mark maintenance tiers use deduction and not an entry-only shortcut', () => {
    const tiers = { ...profile, riskTiers: [{ maxNotional: '1000', maintenanceRate: '0.01', deduction: '0' }, { maxNotional: '100000', maintenanceRate: '0.02', deduction: '10' }] };
    const value = calculatePosition({ side: 'LONG', quantity: '10', entryPrice: '100', markPrice: '120', leverage: '10', profile: tiers });
    expect(value.maintenanceMargin).toBe('14');
    expect(decimal(value.liquidationPrice!).minus(decimal('900').div('9.9')).abs().lt('0.0000000001')).toBe(true);
  });
  test.each(['LONG', 'SHORT'] as const)('liquidation boundary solves equity=maintenance for %s', (side) => {
    const args = { side, quantity: '2', entryPrice: '100', markPrice: '100', leverage: '10', profile: feeProfile };
    const boundary = liquidationPrice(args)!;
    const value = calculatePosition({ ...args, markPrice: boundary });
    expect(decimal(value.equity).minus(value.maintenanceMargin).abs().lt('0.00000000000000000001')).toBe(true);
  });
  test('partial close allocates margin, historical fees and funding proportionately', () => {
    expect(closePositionAllocation({ side: 'LONG', quantity: '10', closeQuantity: '4', entryPrice: '100', exitPrice: '120', allocatedMargin: '100', openingFeesRemaining: '1', fundingRemaining: '-2', feeRate: '0.001' })).toEqual({ remainingQuantity: '6', releasedMargin: '40', remainingMargin: '60', closingFee: '0.48', realizedGross: '80', allocatedOpeningFees: '0.4', allocatedFunding: '-0.8', netRealized: '78.32' });
  });
  test('funding cashflows have opposite directions and signed rates', () => {
    expect(fundingCashflow('LONG', '10', '100', '0.001')).toBe('-1');
    expect(fundingCashflow('SHORT', '10', '100', '0.001')).toBe('1');
    expect(fundingCashflow('LONG', '10', '100', '-0.001')).toBe('1');
  });
  test('explicit contribution ROI basis is independent of funding cash routing',()=>{
    const p=calculatePosition({side:'LONG',quantity:'10',entryPrice:'100',markPrice:'110',leverage:'10',allocatedMargin:'99',fundingNet:'-1',roiMarginBasis:'100',profile});
    expect(p.roiPercent).toBe('100');expect(p.netPnl).toBe('99');expect(p.equity).toBe('199');
  });
  test('no Infinity or NaN for zero ROI basis', () => { expect(roiPercent('1', '0')).toBeNull(); });
  test.each([null, undefined, 100, '', 'NaN', 'Infinity', '1e6', ' 1 ', '0x10', {}, '1.2.3'])('reject malformed decimal %p', (value) => { expect(() => decimal(value)).toThrow(); });
  test.each(['0', '-1'])('reject nonpositive prices %s', (price) => { expect(() => linearPnl('LONG', '1', '100', price)).toThrow(); });
  test('reject discontinuous tiers and unsupported notional', () => {
    expect(() => validateProfile({ ...profile, riskTiers: [{ maxNotional: '100', maintenanceRate: '0.01', deduction: '1' }] })).toThrow('DISCONTINUOUS');
    expect(() => quoteOrderCost({ side: 'LONG', quantity: '1000000000', price: '100', leverage: '10', profile })).toThrow('RISK_LIMIT');
  });
  test('symbol-specific filters including quantity and leverage steps', () => {
    const order = { rules, quantity: '1.2', price: '100.001', leverage: '2.1', market: false, profile };
    expect(() => validateContractOrder(order)).not.toThrow();
    expect(() => validateContractOrder({ ...order, quantity: '1.23' })).toThrow('QUANTITY_STEP');
    expect(() => validateContractOrder({ ...order, price: '100.0015' })).toThrow('PRICE_STEP');
    expect(() => validateContractOrder({ ...order, leverage: '2.11' })).toThrow('LEVERAGE');
    expect(() => validateContractOrder({ ...order, quantity: '1000', market: true })).toThrow('ORDER_SIZE');
  });
  test('market execution consumes actual depth and leaves unfilled quantity', () => {
    const book = { bids: [{price: '99', quantity: '2'}], asks: [{price: '102', quantity: '1'}, {price: '101', quantity: '1'}] };
    expect(consumeBook('BUY', '3', book)).toMatchObject({filledQuantity: '2', remainingQuantity: '1', averagePrice: '101.5', complete: false});
    expect(consumeBook('BUY', '3', book, '101')).toMatchObject({filledQuantity: '1', remainingQuantity: '2', averagePrice: '101'});
    expect(consumeBook('SELL', '1', book, '100').fills).toHaveLength(0);
  });
});
