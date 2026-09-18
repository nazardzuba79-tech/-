import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, closeDemoPosition, setDemoLeverage, settleDemoFunding, migrateDemoState, DemoState, DemoPosition, StoredDemoState } from '../native/engine';
import { nativeInvariants, assertNativeInvariants } from '../native/invariants';

/**
 * THE ORACLE IS INDEPENDENT, AND IT IS RIGHT.
 *
 * `nativeInvariants` re-derives a position from its own journal. Its entry
 * used to be the quantity-weighted average of EVERY open fill of the
 * position's life, which calls 2 @ 100, close 1, add 1 @ 200 an entry of
 * 133.33 — the engine's 150 (1 remaining @ 100 averaged with 1 @ 200) was
 * then reported as a violation. The remaining quantity has to be replayed
 * in order: a close leaves the entry alone and takes quantity away, the
 * next open averages what REMAINS with what is added. The engine was right;
 * the oracle is corrected, and it still catches a tampered state.
 */
const H = 3_600_000, M = 60_000;
const T = Date.UTC(2026, 8, 15, 5, 0, 0);
const bn = (v: string | number) => new BigNumber(v);
const rules = { symbol: 'BTCUSDT', tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' };
const profile = { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0',
  riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] as string[] };

function fresh(): DemoState {
  const s = emptyDemoState('100000', T - M);
  registerDemoInstrument(s, { rules, profile });
  markDemoAccount(s, { BTCUSDT: { mark: '100', last: '100' } }, T - M);
  return s;
}
let n = 0;
function open(s: DemoState, side: 'LONG' | 'SHORT', quantity: string, price: string, leverage = '10', marginType: 'CROSS' | 'ISOLATED' = 'CROSS') {
  const id = `o${++n}`, time = s.time + 1;
  markDemoAccount(s, { BTCUSDT: { mark: price, last: price } }, time);
  placeDemoOrder(s, { id, symbol: 'BTCUSDT', side, type: 'MARKET', quantity, leverage, marginType }, time);
  fillDemoOrder(s, id, quantity, price, time, 'SELECTED_POINT');
  return s.positions.find(p => p.status === 'OPEN' && p.side === side && p.marginType === marginType)!;
}
function close(s: DemoState, id: string, quantity: string, price: string) {
  const time = s.time + 1;
  markDemoAccount(s, { BTCUSDT: { mark: price, last: price } }, time);
  closeDemoPosition(s, id, quantity, price, time, 'SELECTED_POINT');
}
const codes = (s: DemoState) => nativeInvariants(s).map(v => v.code);

describe('average entry follows the REMAINING quantity, in order', () => {
  test('LONG 2 @ 100 → close 1 → add 1 @ 200: quantity 2, entry 150, no violation', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100');
    close(s, p.id, '1', '100');
    open(s, 'LONG', '1', '200');
    expect(p.quantity).toBe('2'); expect(p.entryPrice).toBe('150');
    expect(codes(s)).toEqual([]);
  });
  test('SHORT 3 @ 100 → close 1 → add 2 @ 80: quantity 4, entry 90', () => {
    const s = fresh();
    const p = open(s, 'SHORT', '3', '100');
    close(s, p.id, '1', '100');
    open(s, 'SHORT', '2', '80');
    expect(p.quantity).toBe('4'); expect(p.entryPrice).toBe('90');    // (2 × 100 + 2 × 80) / 4
    expect(codes(s)).toEqual([]);
  });
  test('several partial closes between adds: 4 @ 100, close 1, close 1, add 2 @ 130, close 3, add 1 @ 70', () => {
    const s = fresh();
    const p = open(s, 'LONG', '4', '100');
    close(s, p.id, '1', '110'); close(s, p.id, '1', '90');
    open(s, 'LONG', '2', '130');                                   // 2 @ 100 + 2 @ 130 → 4 @ 115
    expect(p.entryPrice).toBe('115');
    close(s, p.id, '3', '120');                                    // 1 @ 115 remains
    open(s, 'LONG', '1', '70');                                    // 1 @ 115 + 1 @ 70 → 2 @ 92.5
    expect(p.quantity).toBe('2'); expect(p.entryPrice).toBe('92.5');
    expect(codes(s)).toEqual([]);
  });
  test('a leverage change moves margin and the ROI basis, never the entry (cross and isolated)', () => {
    for (const bucket of ['CROSS', 'ISOLATED'] as const) {
      const s = fresh();
      const p = open(s, 'LONG', '2', '100', '10', bucket);
      close(s, p.id, '1', '100');
      open(s, 'LONG', '1', '200', '10', bucket);
      setDemoLeverage(s, p.id, '20', s.time + 1);
      expect(p.entryPrice).toBe('150'); expect(p.leverage).toBe('20');
      expect(p.roiBasis).toBe(bn(2).times(150).div(20).toFixed());
      if (bucket === 'ISOLATED') expect(p.isolatedMargin).toBe('15');
      open(s, 'LONG', '1', '90', '20', bucket);                    // 2 @ 150 + 1 @ 90 → 3 @ 130, at the new leverage
      expect(p.entryPrice).toBe('130');
      close(s, p.id, '3', '130');
      expect(codes(s)).toEqual([]);
    }
  });
  test('funding on an isolated post between fills is folded too', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100', '10', 'ISOLATED');
    const boundary = Math.ceil(s.time / (8 * H)) * 8 * H;
    markDemoAccount(s, { BTCUSDT: { mark: '100', last: '100' } }, boundary);
    settleDemoFunding(s, boundary);                                // -0.001 × 200 = -0.2 charged to the post
    expect(p.isolatedMargin).toBe('19.8');
    close(s, p.id, '1', '100');
    open(s, 'LONG', '1', '200', '10', 'ISOLATED');
    expect(p.entryPrice).toBe('150');
    expect(codes(s)).toEqual([]);
  });
});

describe('the oracle still catches a state that lies', () => {
  test('an entry that is not the fold of the fills', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100'); close(s, p.id, '1', '100'); open(s, 'LONG', '1', '200');
    p.entryPrice = '133.333333333333333333';                       // the old, wrong average of every open
    expect(codes(s)).toContain('WEIGHTED_ENTRY');
  });
  test('a quantity that is not the fold of the fills, and a post that is not', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100', '10', 'ISOLATED'); close(s, p.id, '1', '100');
    p.quantity = '1.5';
    expect(codes(s)).toContain('QUANTITY_FROM_FILLS');
    p.quantity = '1'; p.isolatedMargin = '11';
    expect(codes(s)).toContain('POST_FROM_JOURNAL');
  });
  test('a shortfall line that does not match its slice', () => {
    const s = fresh();
    const p = open(s, 'LONG', '1', '100', '10', 'ISOLATED');      // post 10, bankruptcy 90
    close(s, p.id, '1', '50');                                     // loss 50 + fee: a SHORTFALL line follows
    expect(codes(s)).toEqual([]);
    const shortfall = s.events.find(e => e.kind === 'SHORTFALL')!;
    shortfall.cashflow = bn(shortfall.cashflow).plus(1).toFixed();
    expect(codes(s)).toEqual(expect.arrayContaining(['SHORTFALL_SLICE', 'SHORTFALL_ONCE']));
  });
  test('assertNativeInvariants names every violated code', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100'); p.entryPrice = '1';
    expect(() => assertNativeInvariants(s, undefined, 'tampered')).toThrow(/tampered[\s\S]*WEIGHTED_ENTRY/);
  });
});

describe('a state persisted before the SHORTFALL line', () => {
  test('reads with shortfallCovered = 0 on every position, and passes the oracle', () => {
    const s = fresh();
    const p = open(s, 'LONG', '2', '100', '10', 'ISOLATED'); close(s, p.id, '1', '100');
    const stored = JSON.parse(JSON.stringify(s)) as StoredDemoState;
    stored.version = 2;
    for (const q of stored.positions) delete (q as Partial<DemoPosition>).shortfallCovered;
    const migrated = migrateDemoState(stored);
    expect(migrated.version).toBe(3);
    expect(migrated.positions.map(q => q.shortfallCovered)).toEqual(['0']);
    expect(codes(migrated)).toEqual([]);
  });
});
