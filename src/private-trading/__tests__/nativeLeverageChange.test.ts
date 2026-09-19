import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, setDemoLeverage, demoAccount, DemoState } from '../native/engine';
import { nativeInvariants } from '../native/invariants';

/**
 * A LEVERAGE CHANGE IS VALIDATED AS A LEVERAGE CHANGE.
 *
 * `setDemoLeverage` used to run the generic ORDER validator on the whole
 * position as if it were a market order for its entire size, at its entry
 * price: a position built from two valid trades of `maxMarketOrderQty`
 * could not change its leverage at all (INVALID_ORDER_SIZE), and the tier
 * was read off the entry notional rather than the bucket's current one.
 * Now: the contract's leverage range and step; the risk tier of the bucket
 * the position is in NOW, at the current mark; the margin the account can
 * put behind it; and, for an isolated position, that the re-sized post
 * keeps it solvent. Nothing about order sizes.
 */
const M = 60_000, H = 3_600_000;
const T = Date.UTC(2026, 8, 15, 5, 0, 0);
const bn = (v: string | number) => new BigNumber(v);
const rules = { symbol: 'LADDERUSDT', tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '10', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' };
// Tier 1 to 100 000 at 100x, tier 2 to 200 000 at 25x, tier 3 beyond at 10x.
const tiers = [
  { maxNotional: '100000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' },
  { maxNotional: '200000', maintenanceRate: '0.01', deduction: '500', maxLeverage: '25' },
  { maxNotional: '1000000000', maintenanceRate: '0.015', deduction: '1500', maxLeverage: '10' },
];
const profile = { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0', riskTiers: tiers, assumptions: [] as string[] };
let n = 0;
function position(marginType: 'CROSS' | 'ISOLATED', deposit = '100000'): { s: DemoState; id: string } {
  const s = emptyDemoState(deposit, T - M);
  registerDemoInstrument(s, { rules, profile });
  markDemoAccount(s, { LADDERUSDT: { mark: '1000', last: '1000' } }, T - M);
  // Two valid MARKET trades of exactly maxMarketOrderQty: a position of 20, which no single market order could be.
  let id = '';
  for (const q of ['10', '10']) {
    const oid = `o${++n}`;
    placeDemoOrder(s, { id: oid, symbol: 'LADDERUSDT', side: 'LONG', type: 'MARKET', quantity: q, leverage: '10', marginType }, s.time + 1);
    fillDemoOrder(s, oid, q, '1000', s.time, 'SELECTED_POINT');
    id = s.positions[0].id;
  }
  expect(s.positions[0].quantity).toBe('20');
  return { s, id };
}
const codes = (s: DemoState) => nativeInvariants(s).map(v => v.code);

describe('a position larger than one market order can still change its leverage', () => {
  test('cross: 10x → 5x with enough collateral works; margin follows, quantity and entry do not', () => {
    const { s, id } = position('CROSS');
    const before = demoAccount(s);
    setDemoLeverage(s, id, '5', s.time + 1);
    const p = s.positions[0];
    expect(p).toMatchObject({ leverage: '5', quantity: '20', entryPrice: '1000' });
    expect(p.roiBasis).toBe(bn(20).times(1000).div(5).toFixed());
    expect(bn(demoAccount(s).usedMargin).gt(before.usedMargin)).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ kind: 'LEVERAGE', leverage: '5', marginDelta: '0' });
    expect(codes(s)).toEqual([]);
  });
  test('isolated: 10x → 5x posts the difference from the wallet, back to 10x returns it, and the journal says so', () => {
    const { s, id } = position('ISOLATED');
    const p = s.positions[0], wallet = s.walletBalance;
    expect(p.isolatedMargin).toBe('2000');
    setDemoLeverage(s, id, '5', s.time + 1);
    expect(p.isolatedMargin).toBe('4000');
    expect(bn(wallet).minus(s.walletBalance).toFixed()).toBe('2000');
    expect(s.events.at(-1)).toMatchObject({ kind: 'LEVERAGE', leverage: '5', marginDelta: '2000' });
    setDemoLeverage(s, id, '10', s.time + 1);
    expect(p.isolatedMargin).toBe('2000');
    expect(s.walletBalance).toBe(wallet);
    expect(s.events.at(-1)).toMatchObject({ kind: 'LEVERAGE', leverage: '10', marginDelta: '-2000' });
    expect(codes(s)).toEqual([]);
  });
});

describe('what a leverage change is still held to', () => {
  test('the contract range and step', () => {
    const { s, id } = position('CROSS');
    expect(() => setDemoLeverage(s, id, '0.5', s.time + 1)).toThrow('INVALID_LEVERAGE');
    expect(() => setDemoLeverage(s, id, '101', s.time + 1)).toThrow('INVALID_LEVERAGE');
    expect(() => setDemoLeverage(s, id, '7.5', s.time + 1)).toThrow('INVALID_LEVERAGE');
    expect(s.positions[0].leverage).toBe('10');
  });
  test('the risk tier of the bucket NOW, at the current mark — not the entry notional', () => {
    const { s, id } = position('CROSS');
    // 20 × 1 000 = 20 000 at entry (tier 1, 100x). The market goes to 7 500: 150 000 is tier 2, capped at 25x.
    markDemoAccount(s, { LADDERUSDT: { mark: '7500', last: '7500' } }, s.time + 1);
    expect(() => setDemoLeverage(s, id, '50', s.time + 1)).toThrow('TIER_LEVERAGE_EXCEEDED');
    expect(s.positions[0].leverage).toBe('10');
    setDemoLeverage(s, id, '25', s.time + 1);
    expect(s.positions[0].leverage).toBe('25');
    // And the bucket, not the position alone: a hedge on the same contract counts (gross), and at 10x it is admitted
    // into tier 3 (150 000 + 75 000 = 225 000), where the long's 25x is no longer allowed.
    const oid = `o${++n}`;
    placeDemoOrder(s, { id: oid, symbol: 'LADDERUSDT', side: 'SHORT', type: 'MARKET', quantity: '10', leverage: '10' }, s.time + 1);
    fillDemoOrder(s, oid, '10', '7500', s.time, 'SELECTED_POINT');
    expect(() => setDemoLeverage(s, id, '20', s.time + 1)).toThrow('TIER_LEVERAGE_EXCEEDED');
    setDemoLeverage(s, id, '10', s.time + 1);
    expect(codes(s)).toEqual([]);
  });
  test('the margin the account can actually put behind it, and nothing moves on a refusal', () => {
    // 2 100 of cash: the two fills posted 2 000 of margin (plus fees) at 10x; 1x would need 20 000.
    const { s, id } = position('CROSS', '2100');
    const snapshot = JSON.stringify([s.positions[0], s.walletBalance]);
    expect(() => setDemoLeverage(s, id, '1', s.time + 1)).toThrow('INSUFFICIENT_DEMO_MARGIN');
    expect(JSON.stringify([s.positions[0], s.walletBalance])).toBe(snapshot);
    const iso = position('ISOLATED', '2100');
    const isoSnapshot = JSON.stringify([iso.s.positions[0], iso.s.walletBalance]);
    expect(() => setDemoLeverage(iso.s, iso.id, '1', iso.s.time + 1)).toThrow('INSUFFICIENT_DEMO_MARGIN');
    expect(JSON.stringify([iso.s.positions[0], iso.s.walletBalance])).toBe(isoSnapshot);
  });
  test('isolated safety: raising leverage may not shrink the post below what the current loss needs', () => {
    const { s, id } = position('ISOLATED');
    // 20 @ 1 000 with 2 000 posted; the mark falls to 930: the loss is 1 400 and the post is still solvent at 10x.
    markDemoAccount(s, { LADDERUSDT: { mark: '930', last: '930' } }, s.time + 1);
    // At 50x the post would be 400 against a 1 400 loss: liquidatable at once — refused, nothing moves.
    const snapshot = JSON.stringify([s.positions[0], s.walletBalance]);
    expect(() => setDemoLeverage(s, id, '50', s.time + 1)).toThrow('INSUFFICIENT_DEMO_MARGIN');
    expect(JSON.stringify([s.positions[0], s.walletBalance])).toBe(snapshot);
    // Lowering it is fine.
    setDemoLeverage(s, id, '5', s.time + 1);
    expect(s.positions[0].isolatedMargin).toBe('4000');
    expect(codes(s)).toEqual([]);
  });
  test('an order resting on the position has to be cancelled first', () => {
    const { s, id } = position('CROSS');
    placeDemoOrder(s, { id: `o${++n}`, symbol: 'LADDERUSDT', side: 'SHORT', type: 'LIMIT', price: '2000', quantity: '5', leverage: '10', reduceOnly: true, positionId: id }, s.time + 1);
    expect(() => setDemoLeverage(s, id, '5', s.time + 1)).toThrow('CANCEL_ORDERS_BEFORE_LEVERAGE');
  });
});
