import BigNumber from 'bignumber.js';
import {
  computeInitialMargin,
  computeLiquidationPrice,
  computeCrossLiquidationPrice,
  computeUnrealizedPnl,
  computeROE,
  computeMaintenanceMargin,
  computeMarginRatio,
  computeBankruptcyPrice,
} from '../marginMath';

describe('computeInitialMargin', () => {
  it('is notional / leverage', () => {
    expect(computeInitialMargin(new BigNumber(10_000), 10).toNumber()).toBe(1_000);
    expect(computeInitialMargin(new BigNumber(5_000), 25).toNumber()).toBe(200);
  });
});

describe('computeLiquidationPrice (isolated)', () => {
  it('matches the long formula: entry * (1 - 1/leverage + mmr)', () => {
    const price = computeLiquidationPrice(new BigNumber(50_000), 'LONG', 10, 0.004);
    // 50000 * (1 - 0.1 + 0.004) = 50000 * 0.904
    expect(price.toNumber()).toBeCloseTo(45_200, 6);
  });

  it('matches the short formula: entry * (1 + 1/leverage - mmr)', () => {
    const price = computeLiquidationPrice(new BigNumber(50_000), 'SHORT', 10, 0.004);
    // 50000 * (1 + 0.1 - 0.004) = 50000 * 1.096
    expect(price.toNumber()).toBeCloseTo(54_800, 6);
  });

  it('is always below entry price for a long, above for a short', () => {
    const long = computeLiquidationPrice(new BigNumber(100), 'LONG', 5, 0.01);
    const short = computeLiquidationPrice(new BigNumber(100), 'SHORT', 5, 0.01);
    expect(long.isLessThan(100)).toBe(true);
    expect(short.isGreaterThan(100)).toBe(true);
  });

  it('moves closer to entry price as leverage increases (less room before liquidation)', () => {
    const lowLev = computeLiquidationPrice(new BigNumber(100), 'LONG', 5, 0.004);
    const highLev = computeLiquidationPrice(new BigNumber(100), 'LONG', 50, 0.004);
    // Higher leverage -> liquidation price closer to entry (smaller drop tolerated).
    expect(highLev.isGreaterThan(lowLev)).toBe(true);
  });

  it('sits strictly between the bankruptcy price and entry price', () => {
    const entry = new BigNumber(50_000);
    const liq = computeLiquidationPrice(entry, 'LONG', 10, 0.004);
    const bankruptcy = computeBankruptcyPrice(entry, 'LONG', 10);
    // Liquidation must trigger BEFORE bankruptcy — i.e. at a higher price for a long.
    expect(liq.isGreaterThan(bankruptcy)).toBe(true);
    expect(liq.isLessThan(entry)).toBe(true);
  });
});

describe('computeCrossLiquidationPrice', () => {
  it('gives more room (lower liq price for a long) than isolated when there is free balance backing it', () => {
    const entry = new BigNumber(50_000);
    const isolated = computeLiquidationPrice(entry, 'LONG', 10, 0.004);
    const cross = computeCrossLiquidationPrice(entry, 'LONG', 10, 0.004, new BigNumber(500_000), new BigNumber(10_000));
    expect(cross.isLessThan(isolated)).toBe(true);
  });

  it('degrades to the isolated formula when free balance is zero', () => {
    const entry = new BigNumber(50_000);
    const isolated = computeLiquidationPrice(entry, 'LONG', 10, 0.004);
    const cross = computeCrossLiquidationPrice(entry, 'LONG', 10, 0.004, new BigNumber(500_000), new BigNumber(0));
    expect(cross.toNumber()).toBeCloseTo(isolated.toNumber(), 8);
  });
});

describe('computeUnrealizedPnl', () => {
  it('is positive for a long when mark rises above entry', () => {
    const pnl = computeUnrealizedPnl('LONG', new BigNumber(1), new BigNumber(50_000), new BigNumber(51_000));
    expect(pnl.toNumber()).toBe(1_000);
  });

  it('is positive for a short when mark falls below entry', () => {
    const pnl = computeUnrealizedPnl('SHORT', new BigNumber(1), new BigNumber(50_000), new BigNumber(49_000));
    expect(pnl.toNumber()).toBe(1_000);
  });

  it('is negative for a long when mark falls', () => {
    const pnl = computeUnrealizedPnl('LONG', new BigNumber(2), new BigNumber(50_000), new BigNumber(49_500));
    expect(pnl.toNumber()).toBe(-1_000);
  });
});

describe('computeROE', () => {
  it('is unrealized PnL / initial margin', () => {
    expect(computeROE(new BigNumber(500), new BigNumber(1_000)).toNumber()).toBe(0.5);
  });

  it('is zero when initial margin is zero (no division by zero)', () => {
    expect(computeROE(new BigNumber(500), new BigNumber(0)).toNumber()).toBe(0);
  });
});

describe('computeMaintenanceMargin (tiered)', () => {
  it('uses tier 1 for a small position', () => {
    // 10,000 notional @ 0.4% - 0 = 40
    expect(computeMaintenanceMargin(new BigNumber(10_000)).toNumber()).toBeCloseTo(40, 6);
  });

  it('uses a higher-rate tier for a large position, staying continuous at the boundary', () => {
    // 100,000 notional falls in tier 2: 0.5% - 50 = 450
    expect(computeMaintenanceMargin(new BigNumber(100_000)).toNumber()).toBeCloseTo(450, 6);
  });

  it('scales up for a very large position (higher tier, higher rate)', () => {
    const small = computeMaintenanceMargin(new BigNumber(10_000));
    const huge = computeMaintenanceMargin(new BigNumber(10_000_000));
    // Even though the huge position is 1000x the notional, its required
    // maintenance margin should be far more than 1000x — that's the whole
    // point of the tiered rate increasing.
    expect(huge.dividedBy(small).isGreaterThan(1000)).toBe(true);
  });
});

describe('computeMarginRatio', () => {
  it('is maintenance margin / margin balance', () => {
    expect(computeMarginRatio(new BigNumber(50), new BigNumber(1_000)).toNumber()).toBe(0.05);
  });

  it('treats a zero-or-negative margin balance as fully underwater (ratio 1)', () => {
    expect(computeMarginRatio(new BigNumber(50), new BigNumber(0)).toNumber()).toBe(1);
    expect(computeMarginRatio(new BigNumber(50), new BigNumber(-10)).toNumber()).toBe(1);
  });
});

describe('computeBankruptcyPrice', () => {
  it('is entry * (1 - 1/leverage) for a long', () => {
    expect(computeBankruptcyPrice(new BigNumber(50_000), 'LONG', 10).toNumber()).toBe(45_000);
  });

  it('is entry * (1 + 1/leverage) for a short', () => {
    expect(computeBankruptcyPrice(new BigNumber(50_000), 'SHORT', 10).toNumber()).toBe(55_000);
  });
});
