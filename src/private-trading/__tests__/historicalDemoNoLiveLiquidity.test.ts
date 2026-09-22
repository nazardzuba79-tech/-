import BigNumber from 'bignumber.js';
import {
  emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  closeDemoPosition, demoAccount, demoPositionView, DemoState, DemoOrderInput,
} from '../native/engine';
import { validateContractOrder } from '../math';

/**
 * HISTORICAL_DEMO fills at a price the trader picked off a past candle. It
 * consumes no depth, competes with nobody, and puts no real exposure on the
 * book — so the venue's LIVE liquidity rules have nothing to describe here.
 *
 * Three of them were being applied anyway, and a trader sizing a historical
 * position was told «Плечо выше допустимого для такого размера позиции»
 * about a position that exists only as arithmetic.
 *
 * What these pin: the three liquidity rules are lifted for HISTORICAL_DEMO
 * and for nothing else, the contract rules that describe the INSTRUMENT
 * still apply, and every number leverage actually feeds — margin, ROI, the
 * liquidation price, fees, PnL — is computed exactly as before.
 */

const M = 60_000;
const T = Date.UTC(2026, 8, 22, 5, 0, 0);
const bn = (v: string) => new BigNumber(v);

// Tier 2's cap is 5x, so anything above 100 000 of notional is capped there
// under LIVE rules. The deduction is continuous, which the engine enforces.
const LADDER = [
  { maxNotional: '100000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' },
  { maxNotional: '1000000000', maintenanceRate: '0.015', deduction: '1000', maxLeverage: '5' },
];
const rules = {
  symbol: 'AKEUSDT', tickSize: '0.00001', minPrice: '0.00001', maxPrice: '1000000',
  qtyStep: '1', minOrderQty: '1', maxOrderQty: '500000', maxMarketOrderQty: '500000',
  minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1',
};
const profile = {
  pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture',
  takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0',
  riskTiers: LADDER, assumptions: [] as string[],
};

/** A wallet deep enough that margin is never what refuses these orders. */
function fresh(balance = '100000000'): DemoState {
  const s = emptyDemoState(balance, T - M);
  registerDemoInstrument(s, { rules, profile });
  // Near-live valuation price. The historical entry is chosen separately.
  markDemoAccount(s, { AKEUSDT: { mark: '0.5', last: '0.5' } }, T);
  return s;
}

/** The owner's own case: AKE/USDT, 1 200 000 at 10x. */
const BIG: DemoOrderInput = {
  id: 'h1', symbol: 'AKEUSDT', side: 'LONG', type: 'MARKET', quantity: '1200000', leverage: '10',
};
const historical = (over: Partial<DemoOrderInput> = {}): DemoOrderInput =>
  ({ ...BIG, historical: true, executionMode: 'HISTORICAL_DEMO', ...over });
const live = (over: Partial<DemoOrderInput> = {}): DemoOrderInput =>
  ({ ...BIG, executionMode: 'LIVE_EXECUTION', ...over });

describe('HISTORICAL_DEMO is not bound by live liquidity, and LIVE_EXECUTION still is', () => {
  // 400 000 × 0.5 = 200 000 of notional sits in tier 2, whose cap is 5x, and
  // is UNDER maxMarketOrderQty — so the tier is what decides, not the size.
  const TIER_BOUND = { quantity: '400000', leverage: '10' };

  it('1. opens a historical order at 10x where the live tier allows only 5x', () => {
    const order = placeDemoOrder(fresh(), historical(TIER_BOUND), T);
    expect(order.status).toBe('OPEN');
    expect(order.leverage).toBe('10');
    expect(order.historical).toBe(true);
  });

  it('2. refuses the SAME input under LIVE_EXECUTION, with TIER_LEVERAGE_EXCEEDED', () => {
    expect(() => placeDemoOrder(fresh(), live(TIER_BOUND), T)).toThrow(/TIER_LEVERAGE_EXCEEDED/);
  });

  it('3. opens a historical order larger than maxMarketOrderQty', () => {
    // 1 200 000 against a 500 000 cap, at 10x: both lifted rules at once,
    // which is the owner's reported case exactly.
    const order = placeDemoOrder(fresh(), historical(), T);
    expect(order.status).toBe('OPEN');
    expect(order.quantity).toBe('1200000');
  });

  it('4. refuses the same oversized quantity under LIVE_EXECUTION', () => {
    expect(() => placeDemoOrder(fresh(), live(), T)).toThrow(/INVALID_ORDER_SIZE/);
  });

  it('4b. refuses an oversized LIMIT order under LIVE_EXECUTION, and admits it historically', () => {
    // maxOrderQty, the limit-order twin of the rule above.
    const limit = { type: 'LIMIT' as const, price: '0.5', quantity: '900000', leverage: '2' };
    expect(() => placeDemoOrder(fresh(), live(limit), T)).toThrow(/INVALID_ORDER_SIZE/);
    expect(placeDemoOrder(fresh(), historical(limit), T).status).toBe('OPEN');
  });

  it('5. opens with no order book in reach at all', () => {
    // Nothing in this path consults depth: the state carries no book, and
    // the fill below is taken at the selected historical price.
    const s = fresh();
    expect(s.bookConsumption).toEqual({});
    const order = placeDemoOrder(s, historical(), T);
    expect(order.status).toBe('OPEN');
    fillDemoOrder(s, order.id, order.remaining, '0.4', T, 'SELECTED_POINT');
    expect(s.positions[0].status).toBe('OPEN');
    expect(s.positions[0].entryPrice).toBe('0.4');
    // Still no book was touched, before or after the fill.
    expect(s.bookConsumption).toEqual({});
  });

  it('the CONTRACT rules that are not about liquidity still bind historically', () => {
    const base = { rules, profile, price: '0.5', leverage: '10', market: true, historical: true };
    // A quantity off the step is still malformed, historical or not.
    expect(() => validateContractOrder({ ...base, quantity: '1200000.5' })).toThrow(/INVALID_QUANTITY_STEP/);
    // So is one below the instrument's minimum, or under minimum notional.
    expect(() => validateContractOrder({ ...base, quantity: '0' })).toThrow();
    // And leverage outside the instrument's own range is still refused —
    // what was lifted is the TIER cap, not the range.
    expect(() => validateContractOrder({ ...base, quantity: '1200000', leverage: '500' })).toThrow();
  });
});

describe('the numbers leverage actually feeds are unchanged', () => {
  /** Opens 1 200 000 at 10x with a historical entry of 0.4. */
  function opened(balance?: string): DemoState {
    const s = fresh(balance);
    const order = placeDemoOrder(s, historical(), T);
    fillDemoOrder(s, order.id, order.remaining, '0.4', T, 'SELECTED_POINT');
    return s;
  }

  it('6. PnL runs from the historical entry to the current near-live mark', () => {
    const s = opened();
    const p = s.positions[0];
    expect(p.entryPrice).toBe('0.4');           // the price picked off the candle
    // The near-live valuation price, moved after the open.
    markDemoAccount(s, { AKEUSDT: { mark: '0.5', last: '0.5' } }, T + M);
    const account = demoAccount(s);
    // LONG 1 200 000 from 0.4 to 0.5 is +0.1 per unit.
    const expected = bn('0.5').minus('0.4').times('1200000');
    expect(bn(account.unrealizedPnl).toFixed()).toBe(expected.toFixed());
  });

  it('7. margin, fees and the liquidation price are computed exactly as before', () => {
    const s = opened();
    const p = s.positions[0];
    const notional = bn(p.entryPrice).times(p.quantity);   // 480 000
    expect(bn(p.entryNotional).toFixed()).toBe(notional.toFixed());
    // Margin is notional / leverage — the arithmetic the lifted caps never touched.
    expect(bn(p.roiBasis).toFixed()).toBe(notional.div('10').toFixed());
    // Opening fee is the taker rate on the notional, unchanged.
    expect(bn(p.openingFees).toFixed()).toBe(notional.times(profile.takerFeeRate).toFixed());
    // A liquidation price exists and sits below a LONG's entry. The deep
    // fixture wallet can never be liquidated, so this one part of the check
    // is taken on a wallet that only just covers the position's margin.
    const tight = opened('70000');
    const view = demoPositionView(tight, tight.positions[0]);
    expect(view.liquidationPrice).not.toBeNull();
    expect(bn(view.liquidationPrice!).lt(p.entryPrice)).toBe(true);
    // Solved by hand against the SAME maintenance ladder live positions use:
    // 69 736 + (P - 0.4)*1 200 000 = 1 200 000*P*0.015 - 1000 + 1 200 000*P*0.00055
    expect(bn(view.liquidationPrice!).minus('0.34647').abs().lt('0.001')).toBe(true);
  });

  it('8. closes at the current near-live price with no book liquidity available', () => {
    const s = opened();
    const p = s.positions[0];
    markDemoAccount(s, { AKEUSDT: { mark: '0.5', last: '0.5' } }, T + M);
    closeDemoPosition(s, p.id, undefined, '0.5', T + M, 'NEAR_LIVE_DEMO');
    const closed = s.positions[0];
    expect(closed.status).toBe('CLOSED');
    expect(s.bookConsumption).toEqual({});     // never consulted depth
    // Realised gross is the same 0.1 per unit the unrealised figure showed.
    expect(bn(closed.realizedGross).toFixed()).toBe(bn('0.1').times('1200000').toFixed());
  });
});
