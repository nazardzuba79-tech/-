import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, demoAccount, demoPositionView,
  closeDemoPosition, settleDemoFunding, estimateDemoLiquidationPrice, positionRisk, isolatedHealth, evaluateDemoRiskAndProtection,
  setDemoCollateral, DemoInstrument, DemoState, NATIVE_DEMO_MODEL } from '../native/engine';
import { crossAccount } from '../native/accountModel';
import { accountLedger } from '../native/ledger';
import { roiPercent } from '../math';
import type { CollateralValuation } from '../native/collateral';
import vectors from './fixtures/golden_vectors.json';

/**
 * THE FINANCIAL CONTRACT, CHECKED ON THE REAL ENGINE.
 *
 * `fixtures/golden_vectors.json` is the independent Decimal oracle's output
 * (see the engine package's `reference_math.py`). Its fees, tiers and
 * prices are explicitly TEST fixtures — none of them is a production
 * setting, and the funding vector is answered with the engine's OWN
 * declared model rate, never with the fixture's number. What is compared
 * is the algebra: weighted entry, P&L, proportional partial close, one
 * cash ledger, tier deduction, cross/isolated equity, and the flat-tier
 * isolated liquidation solution.
 */
const T = 1_728_000_000_000; // 2024-10-04T00:00:00Z, an 8h funding boundary
const M = 60_000;
type Tier = { maxNotional: string; maintenanceRate: string; deduction: string; maxLeverage?: string };
const FLAT: Tier[] = [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }];
const ORACLE_TIERS: Tier[] = (vectors.vectors.find(v => v.id === 'mm-tier') as { tiers: string[][] }).tiers
  .map(([maxNotional, maintenanceRate, deduction]) => ({ maxNotional, maintenanceRate, deduction }));

function instrument(symbol: string, fee: string, tiers: Tier[], tickSize = '0.01', qtyStep = '1'): DemoInstrument {
  return {
    rules: { symbol, tickSize, qtyStep, minOrderQty: qtyStep, maxOrderQty: '1000000', maxMarketOrderQty: '1000000', minNotionalValue: '1', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
    profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: fee, makerFeeRate: fee, liquidationFeeRate: '0', slippageBps: '0', riskTiers: tiers, assumptions: [] },
  };
}
function account(deposit: string, inst: DemoInstrument, mark: string, at = T - M) {
  const s = emptyDemoState(deposit, at);
  registerDemoInstrument(s, inst);
  markDemoAccount(s, { [inst.rules.symbol]: { mark, last: mark } }, at);
  return s;
}
let seq = 0;
function fill(s: DemoState, symbol: string, side: 'LONG' | 'SHORT', quantity: string, price: string, leverage: string, marginType: 'CROSS' | 'ISOLATED' = 'CROSS', at = s.time) {
  const id = `o${++seq}`;
  placeDemoOrder(s, { id, symbol, side, type: 'MARKET', quantity, leverage, marginType }, at);
  fillDemoOrder(s, id, quantity, price, at, 'SELECTED_POINT');
  return s.positions.find(p => p.id === s.orders.find(o => o.id === id)!.positionId)!;
}
const complete: CollateralValuation = { settleAsset: 'USDT', lines: [], priced: '0', unpriced: [], complete: true, asOf: null };
const vector = <T,>(id: string) => vectors.vectors.find(v => v.id === id) as T;

describe('isolated positions are separate risk books', () => {
  // Fixture tiers where a second isolated position of the same contract
  // would push a merged bucket into a higher tier with a deduction.
  const inst = instrument('ABCUSDT', '0', ORACLE_TIERS);

  test('opening a second isolated position on the contract does not change the first one\'s maintenance or liquidation price', () => {
    const s = account('100000', inst, '100');
    const first = fill(s, 'ABCUSDT', 'LONG', '6', '100', '10', 'ISOLATED');        // 600 notional, own tier 1
    const before = { mm: positionRisk(s, first, '100').maintenance.toFixed(), liq: demoPositionView(s, first).liquidationPrice, health: isolatedHealth(s, first, '100').toFixed() };
    expect(before.mm).toBe('12'); // 600 x 0.02 - 0, as the oracle's own_mm
    // A historical isolated entry on the same contract: its own position, its own book.
    placeDemoOrder(s, { id: 'hist', symbol: 'ABCUSDT', side: 'LONG', type: 'MARKET', quantity: '13', leverage: '10', marginType: 'ISOLATED', historical: true }, s.time);
    fillDemoOrder(s, 'hist', '13', '100', s.time, 'SELECTED_POINT');
    expect(s.positions.filter(p => p.status === 'OPEN')).toHaveLength(2);
    const after = { mm: positionRisk(s, first, '100').maintenance.toFixed(), liq: demoPositionView(s, first).liquidationPrice, health: isolatedHealth(s, first, '100').toFixed() };
    expect(after).toEqual(before);
    // The second is answered on ITS notional alone: 1300 x 0.025 - 5.
    const second = s.positions.find(p => p.id === 'hist')!;
    expect(positionRisk(s, second, '100').maintenance.toFixed()).toBe('27.5');
    // And NOT on a merged 1900 bucket (which would be 42.5 split pro rata).
    expect(new BigNumber(demoAccount(s).isolatedMaintenanceMargin).toFixed()).toBe('39.5');
  });

  test('an isolated position in the other direction is not merged into this one\'s tier either', () => {
    const s = account('100000', inst, '100');
    const long = fill(s, 'ABCUSDT', 'LONG', '6', '100', '10', 'ISOLATED');
    const mm = positionRisk(s, long, '100').maintenance.toFixed();
    fill(s, 'ABCUSDT', 'SHORT', '13', '100', '10', 'ISOLATED');
    expect(positionRisk(s, long, '100').maintenance.toFixed()).toBe(mm);
  });

  test('cross positions of one contract still share one tier bucket', () => {
    const s = account('100000', inst, '100');
    const a = fill(s, 'ABCUSDT', 'LONG', '6', '100', '10', 'CROSS');
    expect(positionRisk(s, a, '100').maintenance.toFixed()).toBe('12');
    fill(s, 'ABCUSDT', 'SHORT', '13', '100', '10', 'CROSS');
    // 1900 in tier 2: 600 x 0.025 - 5 x 600/1900
    expect(positionRisk(s, a, '100').maintenance.decimalPlaces(6).toFixed()).toBe('13.421053');
  });
});

describe('exposure that outgrew the last tier stays readable and closable', () => {
  const inst = instrument('XYZUSDT', '0', ORACLE_TIERS); // last cap 3000
  test('a rally past the last cap does not break the account read, and the position can be closed', () => {
    const s = account('100000', inst, '100');
    const p = fill(s, 'XYZUSDT', 'LONG', '25', '100', '10', 'CROSS');          // 2500, inside the table
    markDemoAccount(s, { XYZUSDT: { mark: '200', last: '200' } }, s.time + 1);  // 5000, beyond it
    expect(() => demoAccount(s)).not.toThrow();
    expect(() => evaluateDemoRiskAndProtection(s, s.time + 1)).not.toThrow();
    const risk = positionRisk(s, p, '200');
    expect(risk.beyondLastTier).toBe(true);
    // The last tier's own parameters, not a lower invented rate: 5000 x 0.03 - 15.
    expect(risk.maintenance.toFixed()).toBe('135');
    expect(demoPositionView(s, p).liquidationPrice).not.toBe('0');
    // New risk on top is refused; closing is not.
    expect(() => placeDemoOrder(s, { id: 'more', symbol: 'XYZUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10' }, s.time + 1)).toThrow('RISK_LIMIT_EXCEEDED');
    placeDemoOrder(s, { id: 'reduce', symbol: 'XYZUSDT', side: 'SHORT', type: 'LIMIT', price: '210', quantity: '5', leverage: '10', reduceOnly: true, positionId: p.id }, s.time + 1);
    closeDemoPosition(s, p.id, undefined, '200', s.time + 2);
    expect(p.status).toBe('CLOSED');
  });
  test('the policy is declared on the model', () => {
    expect(NATIVE_DEMO_MODEL.riskBeyondLastTier).toBe('LAST_TIER_PARAMETERS_FOR_EXISTING_EXPOSURE_NEW_RISK_REFUSED');
    expect(NATIVE_DEMO_MODEL.riskBuckets).toBe('CROSS_PER_CONTRACT | ISOLATED_PER_POSITION');
  });
});

describe('golden vectors, answered by the engine', () => {
  const symbol = 'GLDUSDT';

  test('weighted-entry: fills of 2 @ 100 and 3 @ 110 average to 106', () => {
    const v = vector<{ fills: string[][]; expectedEntry: string }>('weighted-entry');
    const s = account('100000', instrument(symbol, '0', FLAT), '100');
    let p!: ReturnType<typeof fill>;
    for (const [q, price] of v.fills) p = fill(s, symbol, 'LONG', q, price, '1');
    expect(p.entryPrice).toBe(v.expectedEntry);
    expect(p.quantity).toBe('5');
  });

  test.each(['long-upl', 'short-upl'])('%s: unrealized P&L is s x (Q x mark - cost basis), with no leverage in it', (id) => {
    const v = vector<{ side: 'LONG' | 'SHORT'; quantity: string; entry: string; mark: string; expected: string }>(id);
    for (const leverage of ['1', '5', '20']) {
      const s = account('100000', instrument(symbol, '0', FLAT), v.entry);
      const p = fill(s, symbol, v.side, v.quantity, v.entry, leverage);
      markDemoAccount(s, { [symbol]: { mark: v.mark, last: v.mark } }, s.time + 1);
      expect(demoPositionView(s, p).unrealizedPnl).toBe(v.expected);
      expect(demoAccount(s).unrealizedPnl).toBe(v.expected);
    }
  });

  test('partial-close: proportional cost basis, unchanged entry, gross and fee booked once', () => {
    const v = vector<{ side: 'LONG'; quantity: string; entry: string; closeQty: string; exit: string; feeRate: string; expected: Record<string, string> }>('partial-close');
    const s = account('100000', instrument(symbol, v.feeRate, FLAT), v.entry);
    // Opening fee is charged on the way in and must not reappear in the close.
    const p = fill(s, symbol, v.side, v.quantity, v.entry, '1');
    const cashBefore = new BigNumber(s.walletBalance);
    closeDemoPosition(s, p.id, v.closeQty, v.exit, s.time + 1);
    expect(p.quantity).toBe(v.expected.remaining);
    expect(p.entryPrice).toBe(v.expected.entry);
    expect(new BigNumber(p.quantity).times(p.entryPrice).toFixed()).toBe(v.expected.remaining_cost_basis);
    expect(p.realizedGross).toBe(v.expected.realized_gross);
    expect(p.closingFees).toBe(v.expected.closing_fee);
    expect(new BigNumber(s.walletBalance).minus(cashBefore).toFixed()).toBe(v.expected.cash_delta);
    const event = s.events.at(-1)!;
    expect(event).toMatchObject({ kind: 'CLOSE', quantity: v.closeQty, price: v.exit, fee: v.expected.closing_fee, cashflow: v.expected.cash_delta });
  });

  test('full-ledger: one cash ledger over opens and closes, fees exactly once, net P&L as the oracle', () => {
    const v = vector<{ initialCash: string; opens: string[][]; closes: string[][]; feeRateAllFills: string; expectedFinalCash: string; expectedNetPnl: string }>('full-ledger');
    const s = account(v.initialCash, instrument(symbol, v.feeRateAllFills, FLAT), '100');
    let p!: ReturnType<typeof fill>;
    for (const [q, price] of v.opens) p = fill(s, symbol, 'LONG', q, price, '1');
    for (const [q, price] of v.closes) closeDemoPosition(s, p.id, q, price, s.time + 1);
    expect(p.status).toBe('CLOSED');
    expect(s.walletBalance).toBe(v.expectedFinalCash);
    expect(demoPositionView(s, p).netPnl).toBe(v.expectedNetPnl);
    // The ledger projection reconciles to the same balance from the events alone.
    const ledger = accountLedger(s);
    expect(ledger.reconciled).toBe(true);
    expect(ledger.closingBalance).toBe(v.expectedFinalCash);
    expect(ledger.totals.net).toBe(v.expectedNetPnl);
    expect(ledger.entries.filter(e => e.source === 'OPENING_FEE')).toHaveLength(2);
    expect(ledger.entries.filter(e => e.source === 'CLOSING_FEE')).toHaveLength(2);
  });

  test('full-ledger-funding: a signed funding cash-flow is added exactly once, at the engine\'s OWN declared rate', () => {
    // The fixture's 1.25 is arbitrary. The engine's model is short +0.004 of
    // position value per 8h; 5 @ 62.5 = 312.5 makes that exactly +1.25, so the
    // vector's algebra is checked without importing its number as a rate.
    const v = vector<{ fundingCashflow: string; expectedFinalCash: string }>('full-ledger-funding');
    const base = vector<{ expectedFinalCash: string }>('full-ledger');
    const s = account(base.expectedFinalCash, instrument(symbol, '0', FLAT), '106');
    const p = fill(s, symbol, 'SHORT', '5', '106', '1');
    markDemoAccount(s, { [symbol]: { mark: '62.5', last: '62.5' } }, T);
    settleDemoFunding(s, T);
    const funding = s.events.filter(e => e.kind === 'FUNDING');
    expect(funding).toHaveLength(1);
    expect(funding[0].cashflow).toBe(v.fundingCashflow);
    expect(new BigNumber(NATIVE_DEMO_MODEL.funding.shortCashflow).times(5).times('62.5').toFixed()).toBe(v.fundingCashflow);
    expect(s.walletBalance).toBe(v.expectedFinalCash);
    expect(p.fundingNet).toBe(v.fundingCashflow);
    // Not charged twice on a repeated settlement of the same boundary.
    expect(() => settleDemoFunding(s, T)).not.toThrow();
    expect(s.events.filter(e => e.kind === 'FUNDING')).toHaveLength(1);
    expect(accountLedger(s).totals.funding).toBe(v.fundingCashflow);
  });

  test('mm-tier: maintenance is max(0, notional x rate - deduction) on the tier the notional falls in', () => {
    const v = vector<{ notional: string; expectedBareMM: string }>('mm-tier');
    const s = account('100000', instrument(symbol, '0', ORACLE_TIERS), '100');
    const p = fill(s, symbol, 'LONG', '15', '100', '10');
    expect(positionRisk(s, p, '100').value.toFixed()).toBe(v.notional);
    expect(positionRisk(s, p, '100').maintenance.toFixed()).toBe(v.expectedBareMM);
    expect(demoAccount(s).maintenanceMargin).toBe(v.expectedBareMM);
    // Tier continuity at the caps: exactly the cap, one step below, one above.
    for (const [q, expected] of [['10', '20'], ['20', '45'], ['30', '75']] as const) {
      const t = account('100000', instrument(symbol, '0', ORACLE_TIERS), '100');
      expect(positionRisk(t, fill(t, symbol, 'LONG', q, '100', '10'), '100').maintenance.toFixed()).toBe(expected);
    }
  });

  test('cross-and-isolated: the isolated post is a transfer, its profit backs nothing else, total equity counts it once', () => {
    const v = vector<Record<string, string>>('cross-and-isolated');
    const s = account('1000', instrument(symbol, '0', FLAT), '100');
    const p = fill(s, symbol, 'LONG', '1', '100', '1', 'ISOLATED');
    expect(p.isolatedMargin).toBe(v.isolatedPost);
    expect(s.walletBalance).toBe(v.freeCash);
    markDemoAccount(s, { [symbol]: { mark: '500', last: '500' } }, s.time + 1);
    const engine = demoAccount(s);
    expect(engine.isolatedUnrealizedPnl).toBe(v.isolatedUpl);
    expect(engine.equity).toBe(v.expectedCrossEquity);
    expect(engine.available).toBe(v.expectedAvailable);
    const view = crossAccount(engine, complete, true);
    expect(view.equity).toBe(v.expectedTotalEquity);
    expect(view.available).toBe(v.expectedAvailable);
    expect(view.settleBalance).toBe('1000');
  });

  test.each(['long-liq-simplified', 'short-liq-simplified'])('%s: the isolated liquidation estimate solves posted + P&L = maintenance to within one tick', (id) => {
    const v = vector<{ side: 'LONG' | 'SHORT'; quantity: string; entry: string; posted: string; mmRate: string; decimalApproximation: string }>(id);
    const flat: Tier[] = [{ maxNotional: '1000000000', maintenanceRate: v.mmRate, deduction: '0' }];
    const s = account('100000', instrument(symbol, '0', flat), v.entry);
    const leverage = new BigNumber(v.quantity).times(v.entry).div(v.posted).toFixed(); // 10
    const p = fill(s, symbol, v.side, v.quantity, v.entry, leverage, 'ISOLATED');
    expect(p.isolatedMargin).toBe(v.posted);
    const estimate = estimateDemoLiquidationPrice(s, p.id)!;
    expect(estimate).not.toBeNull();
    expect(new BigNumber(estimate).minus(v.decimalApproximation).abs().lte('0.01')).toBe(true);
    // The engine's declared convention: the reference is rounded TOWARD the
    // current price, so at the estimate the position is still (just) solvent
    // and one more tick in the adverse direction crosses its own boundary.
    expect(isolatedHealth(s, p, estimate).gt(0)).toBe(true);
    const beyond = new BigNumber(estimate).plus(v.side === 'LONG' ? '-0.01' : '0.01').toFixed();
    expect(isolatedHealth(s, p, beyond).lte(0)).toBe(true);
  });

  test('a zero ROI basis is undefined, not 0% and not Infinity; quantities are floored to the step', () => {
    expect(roiPercent('10', '0')).toBeNull();
    expect(roiPercent('10', '50')).toBe('20');
    const s = account('100000', instrument(symbol, '0', FLAT, '0.01', '0.001'), '100');
    expect(() => placeDemoOrder(s, { id: 'step', symbol, side: 'LONG', type: 'MARKET', quantity: '2.123456789', leverage: '1' }, s.time)).toThrow('INVALID_QUANTITY_STEP');
    expect(() => placeDemoOrder(s, { id: 'ok', symbol, side: 'LONG', type: 'MARKET', quantity: '2.123', leverage: '1' }, s.time)).not.toThrow();
    // Leverage changes margin, never quantity or P&L (vector test_09).
    const p = fill(s, symbol, 'LONG', '5', '106', '10');
    expect(p.roiBasis).toBe('53');
    markDemoAccount(s, { [symbol]: { mark: '120', last: '120' } }, s.time + 1);
    expect(demoPositionView(s, p).unrealizedPnl).toBe('70');
  });
});

describe('the engine decides on the journaled wallet valuation, not on the settle row alone', () => {
  const symbol = 'COLUSDT';
  const inst = instrument(symbol, '0', FLAT);
  const collateral = (priced: string, complete = true) => ({ priced, complete, asOf: 1 });

  test('admission: an order the settle row cannot cover is admitted against priced wallet collateral', () => {
    const s = account('100', inst, '100');
    const order = { id: 'big', symbol, side: 'LONG' as const, type: 'MARKET' as const, quantity: '50', leverage: '10' }; // 500 margin
    expect(() => placeDemoOrder(structuredClone(s), order, s.time)).toThrow('INSUFFICIENT_DEMO_MARGIN');
    setDemoCollateral(s, collateral('10000'));
    expect(demoAccount(s).available).toBe('10100');
    expect(() => placeDemoOrder(s, order, s.time)).not.toThrow();
    fillDemoOrder(s, 'big', '50', '100', s.time, 'SELECTED_POINT');
    expect(s.positions[0].quantity).toBe('50');
  });

  test('liquidation: the same collateral that admitted the order also backs it', () => {
    const s = account('100', inst, '100');
    setDemoCollateral(s, collateral('10000'));
    const p = fill(s, symbol, 'LONG', '50', '100', '10');
    markDemoAccount(s, { [symbol]: { mark: '60', last: '60' } }, s.time + 1); // -2000 on 100 of cash
    const a = demoAccount(s);
    expect(a.settleEquity).toBe('-1900');
    expect(a.equity).toBe('8100');
    expect(a.liquidatable).toBe(false);
    evaluateDemoRiskAndProtection(s, s.time + 1);
    expect(p.status).toBe('OPEN');
    // And the reference price is answered on the same pool.
    expect(demoPositionView(s, p).liquidationPrice).toBeNull();
  });

  test('an incomplete valuation is a floor: it admits only against the floor and never decides a liquidation', () => {
    const s = account('100', inst, '100');
    setDemoCollateral(s, collateral('1000', false));
    // The floor covers 1 100 of margin and not more.
    expect(() => placeDemoOrder(structuredClone(s), { id: 'over', symbol, side: 'LONG', type: 'MARKET', quantity: '120', leverage: '10' }, s.time)).toThrow('INSUFFICIENT_DEMO_MARGIN');
    const p = fill(s, symbol, 'LONG', '100', '100', '10');
    markDemoAccount(s, { [symbol]: { mark: '85', last: '85' } }, s.time + 1); // -1500: below the floor's maintenance
    const a = demoAccount(s);
    expect(a.collateralComplete).toBe(false);
    expect(a.liquidatable).toBe(false);
    expect(a.liquidationUnknown).toBe(true);
    evaluateDemoRiskAndProtection(s, s.time + 1);
    expect(p.status).toBe('OPEN');
    // A floor that already clears maintenance is a definite answer.
    markDemoAccount(s, { [symbol]: { mark: '100', last: '100' } }, s.time + 2);
    expect(demoAccount(s).liquidationUnknown).toBe(false);
  });

  test('the account response is the engine account: nothing is added twice', () => {
    const s = account('100', inst, '100');
    setDemoCollateral(s, collateral('10000'));
    fill(s, symbol, 'LONG', '50', '100', '10');
    const engine = demoAccount(s);
    const valuation: CollateralValuation = { settleAsset: 'USDT', lines: [], priced: '10000', unpriced: [], complete: true, asOf: 1 };
    const view = crossAccount(engine, valuation, true);
    expect(view.walletCollateral).toBe('10000');
    expect(view.equity).toBe(engine.equity);
    expect(view.available).toBe(engine.available);
    expect(view.liquidatable).toBe(engine.liquidatable);
    // A stale valuation passed alongside a journaled one does not change the account: the journal wins.
    const stale = crossAccount(engine, { ...valuation, priced: '999999' }, true);
    expect(stale.equity).toBe(engine.equity);
  });

  test('a state that was never told anything still acts on the settle row alone', () => {
    const s = account('5200', inst, '50000');
    expect(s.collateral).toBeNull();
    expect(demoAccount(s).externalCollateral).toBeNull();
    expect(demoAccount(s).equity).toBe(demoAccount(s).settleEquity);
  });
});
