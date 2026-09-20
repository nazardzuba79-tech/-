import {
  calculatePosition,
  fundingCashflow,
  linearPnl,
  liquidationPrice,
  pnlForRoi,
  quoteOrderCost,
  roiPercent,
  selectRiskTier,
  targetExitPrice,
  validateContractOrder,
} from '../math';
import { ContractRules, ModelProfile } from '../types';

/**
 * The calculator's arithmetic, held to the engine's own functions.
 *
 * Every assertion here is a ROUND TRIP: the solver's answer is fed back
 * through the formula it inverts, and the two have to agree exactly. That is
 * the property that matters — a target price that does not actually produce
 * the requested PnL when `linearPnl` is run on it is wrong no matter how
 * plausible it looks, and the reference mock in the design export is exactly
 * that kind of wrong (it prints the current PnL against a TP price that would
 * pay more than double).
 */

const profile: ModelProfile = {
  pricingModelVersion: 'test',
  feeModelVersion: 'test',
  riskModelVersion: 'test',
  takerFeeRate: '0.00055',
  makerFeeRate: '0.0002',
  liquidationFeeRate: '0.005',
  slippageBps: '0',
  riskTiers: [
    { maxNotional: '50000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' },
    { maxNotional: '250000', maintenanceRate: '0.01', deduction: '250', maxLeverage: '50' },
    { maxNotional: '1000000', maintenanceRate: '0.025', deduction: '4000', maxLeverage: '20' },
  ],
  assumptions: [],
};

const rules: ContractRules = {
  symbol: 'BTCUSDT',
  tickSize: '0.1',
  qtyStep: '0.001',
  minOrderQty: '0.001',
  maxOrderQty: '100',
  maxMarketOrderQty: '50',
  minNotionalValue: '5',
  minLeverage: '1',
  maxLeverage: '100',
  leverageStep: '1',
};

describe('PnL, both directions', () => {
  it('LONG gross PnL is quantity x (exit - entry)', () => {
    expect(linearPnl('LONG', '0.45', '79650', '81485.5')).toBe('825.975');
  });

  it('SHORT gross PnL is quantity x (entry - exit)', () => {
    expect(linearPnl('SHORT', '0.45', '81485.5', '79650')).toBe('825.975');
  });

  it('a LONG that moves against the trader loses exactly what a SHORT would gain', () => {
    const down = linearPnl('LONG', '0.45', '81485.5', '79650');
    expect(down).toBe('-825.975');
    expect(Number(down)).toBe(-Number(linearPnl('SHORT', '0.45', '81485.5', '79650')));
  });

  /**
   * The design export's own numbers, which are the reason this file exists.
   * Its position row is internally consistent, but the TP and SL rows print
   * the CURRENT PnL instead of the PnL those triggers would actually realise,
   * and the SL row prints the wrong sign on top of that.
   */
  it('the reference mock TP/SL figures do not survive the real formula', () => {
    expect(linearPnl('LONG', '0.45', '79650', '81485.5')).toBe('825.975');
    expect(linearPnl('LONG', '0.45', '79650', '83500')).toBe('1732.5');
    expect(linearPnl('LONG', '0.45', '79650', '80100')).toBe('202.5');
  });
});

describe('order cost: notional is not margin', () => {
  const quote = quoteOrderCost({ side: 'LONG', quantity: '0.25', price: '81480', leverage: '50', profile });

  it('notional is price x quantity', () => {
    expect(quote.entryNotional).toBe('20370');
  });

  it('base initial margin is notional / leverage, and is a different number', () => {
    expect(quote.baseInitialMargin).toBe('407.4');
    expect(quote.baseInitialMargin).not.toBe(quote.entryNotional);
  });

  it('position margin carries the closing-fee reserve on top of base margin', () => {
    expect(Number(quote.positionMargin)).toBeGreaterThan(Number(quote.baseInitialMargin));
    expect(Number(quote.positionMargin)).toBeCloseTo(
      Number(quote.baseInitialMargin) + Number(quote.closeFeeReserve), 10,
    );
  });

  it('total cost is position margin plus the opening fee', () => {
    expect(Number(quote.totalCost)).toBeCloseTo(
      Number(quote.positionMargin) + Number(quote.openingFee), 10,
    );
  });

  it('a maker open is charged the maker rate', () => {
    const maker = quoteOrderCost({ side: 'LONG', quantity: '0.25', price: '81480', leverage: '50', profile, maker: true });
    expect(Number(maker.openingFee)).toBeLessThan(Number(quote.openingFee));
    expect(maker.openingFee).toBe('4.074');
  });
});

describe('ROI uses the engine basis, and inverts', () => {
  it('pnlForRoi is the exact inverse of roiPercent', () => {
    const basis = '407.4';
    const pnl = pnlForRoi('217.93', basis);
    expect(roiPercent(pnl, basis)).toBe('217.93');
  });

  it('a zero basis has no ROI rather than an infinite one', () => {
    expect(roiPercent('100', '0')).toBeNull();
  });
});

describe('target exit price inverts linearPnl exactly', () => {
  for (const side of ['LONG', 'SHORT'] as const) {
    it(`${side}: a GROSS target round-trips through linearPnl`, () => {
      const target = '1732.5';
      const exit = targetExitPrice({ side, quantity: '0.45', entryPrice: '79650', targetPnl: target, basis: 'GROSS' });
      expect(exit).not.toBeNull();
      expect(linearPnl(side, '0.45', '79650', exit!)).toBe(target);
    });

    it(`${side}: a NET target round-trips once both fees are charged`, () => {
      const quantity = '0.45';
      const entry = '79650';
      const net = '1000';
      const openingFee = quoteOrderCost({ side, quantity, price: entry, leverage: '20', profile }).openingFee;
      const exit = targetExitPrice({
        side, quantity, entryPrice: entry, targetPnl: net, basis: 'NET',
        openingFee, closingFeeRate: profile.takerFeeRate,
      });
      expect(exit).not.toBeNull();
      const gross = Number(linearPnl(side, quantity, entry, exit!));
      const closingFee = Number(quantity) * Number(exit!) * Number(profile.takerFeeRate);
      expect(gross - Number(openingFee) - closingFee).toBeCloseTo(Number(net), 8);
    });
  }

  it('a NET target costs more of a move than the same GROSS target', () => {
    const base = { side: 'LONG' as const, quantity: '0.45', entryPrice: '79650', targetPnl: '1000' };
    const gross = targetExitPrice({ ...base, basis: 'GROSS' })!;
    const net = targetExitPrice({ ...base, basis: 'NET', openingFee: '19.7', closingFeeRate: profile.takerFeeRate })!;
    expect(Number(net)).toBeGreaterThan(Number(gross));
  });

  it('a target that would need a price at or below zero has no answer', () => {
    expect(targetExitPrice({
      side: 'LONG', quantity: '0.45', entryPrice: '79650', targetPnl: '-40000', basis: 'GROSS',
    })).toBeNull();
  });

  it('zero quantity has no answer rather than a division by zero', () => {
    expect(targetExitPrice({
      side: 'LONG', quantity: '0', entryPrice: '79650', targetPnl: '100', basis: 'GROSS',
    })).toBeNull();
  });
});

describe('liquidation comes from the tier ladder, not a single rate', () => {
  const position = {
    side: 'LONG' as const, quantity: '0.45', entryPrice: '79650', markPrice: '79650',
    leverage: '20', profile,
  };

  it('an isolated LONG liquidates below entry', () => {
    const price = liquidationPrice(position);
    expect(price).not.toBeNull();
    expect(Number(price)).toBeLessThan(Number(position.entryPrice));
    expect(Number(price)).toBeGreaterThan(0);
  });

  it('an isolated SHORT liquidates above entry', () => {
    const price = liquidationPrice({ ...position, side: 'SHORT' });
    expect(price).not.toBeNull();
    expect(Number(price)).toBeGreaterThan(Number(position.entryPrice));
  });

  it('the tier actually used is the one the notional falls in', () => {
    expect(selectRiskTier('20000', profile).maintenanceRate).toBe('0.005');
    expect(selectRiskTier('100000', profile).maintenanceRate).toBe('0.01');
    expect(selectRiskTier('500000', profile).maintenanceRate).toBe('0.025');
  });

  it('collateral that outlasts the contract reports NO reachable price, not a negative one', () => {
    const price = liquidationPrice({ ...position, allocatedMargin: '10000000' });
    expect(price).toBeNull();
  });

  it('more allocated margin always moves a LONG liquidation further away', () => {
    const tight = Number(liquidationPrice({ ...position, allocatedMargin: '1800' }));
    const loose = Number(liquidationPrice({ ...position, allocatedMargin: '5000' }));
    expect(loose).toBeLessThan(tight);
  });
});

describe('calculatePosition is the single source for the panel figures', () => {
  const snapshot = calculatePosition({
    side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '81485.5',
    leverage: '20', profile,
  });

  it('unrealized PnL matches linearPnl on the same inputs', () => {
    expect(snapshot.unrealizedPnl).toBe(linearPnl('LONG', '0.45', '79650', '81485.5'));
  });

  it('ROI is that PnL over the reported basis', () => {
    expect(snapshot.roiPercent).toBe(roiPercent(snapshot.unrealizedPnl, snapshot.roiMarginBasis));
  });

  it('a partial close scales the position down without changing the entry', () => {
    const half = calculatePosition({
      side: 'LONG', quantity: '0.225', entryPrice: '79650', markPrice: '81485.5',
      leverage: '20', profile,
    });
    expect(Number(half.unrealizedPnl)).toBeCloseTo(Number(snapshot.unrealizedPnl) / 2, 10);
    expect(half.entryNotional).toBe('17921.25');
  });
});

describe('contract rules reject what the engine would reject', () => {
  const base = { rules, profile, price: '81480', leverage: '20', market: false };

  it('a quantity off the step is refused', () => {
    expect(() => validateContractOrder({ ...base, quantity: '0.0005' })).toThrow();
  });

  it('a quantity over the contract maximum is refused', () => {
    expect(() => validateContractOrder({ ...base, quantity: '500' })).toThrow();
  });

  it('a notional under the minimum is refused', () => {
    expect(() => validateContractOrder({ ...base, quantity: '0.001', price: '1' })).toThrow();
  });

  it('leverage above the tier cap is refused by the cost quote', () => {
    expect(() => quoteOrderCost({
      side: 'LONG', quantity: '4', price: '81480', leverage: '100', profile,
    })).toThrow('TIER_LEVERAGE_EXCEEDED');
  });

  it('a size the rules allow passes', () => {
    expect(() => validateContractOrder({ ...base, quantity: '0.45' })).not.toThrow();
  });
});

describe('funding is a separate, signed cash flow', () => {
  it('a LONG pays when the rate is positive', () => {
    expect(fundingCashflow('LONG', '0.45', '81485.5', '0.0001')).toBe('-3.6668475');
  });

  it('a SHORT receives the same amount', () => {
    expect(fundingCashflow('SHORT', '0.45', '81485.5', '0.0001')).toBe('3.6668475');
  });

  it('a negative rate reverses who pays', () => {
    expect(Number(fundingCashflow('LONG', '0.45', '81485.5', '-0.0001'))).toBeGreaterThan(0);
  });
});
