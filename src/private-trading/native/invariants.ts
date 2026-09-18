import BigNumber from 'bignumber.js';
import { decimal, linearPnl } from '../math';
import { demoAccount, demoPositionView, estimateDemoLiquidationPrice, isolatedHealth, positionRisk, DemoState, DemoPosition } from './engine';
import { accountLedger } from './ledger';
import { crossAccount } from './accountModel';
import type { CollateralValuation } from './collateral';

/**
 * THE FINANCIAL INVARIANTS OF A NATIVE ACCOUNT, CHECKED ON ONE STATE.
 *
 * Every figure the engine reports is re-derived here from the raw state
 * and the event journal by a DIFFERENT route than the engine took, and the
 * two must agree exactly. In particular each economic event — a fee, a
 * realized slice, a funding flow — must be counted exactly once: the
 * position's own accumulators, the account aggregate and the ledger fold
 * all have to reproduce the same sums from the same events.
 *
 * Pure: no side effects, no market data, no clock. `null` answers are
 * checked as unknowns ("—"), never coerced to 0.
 */
const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });
const n = (x: string) => decimal(x);
const REDUCING = ['CLOSE', 'TAKE_PROFIT', 'STOP_LOSS', 'LIQUIDATION'] as const;
const eq = (a: BigNumber | string, b: BigNumber | string, tolerance = '0') => new D(a).minus(b).abs().lte(tolerance);

export interface InvariantViolation { code: string; detail: string }

export function nativeInvariants(s: DemoState, valuation?: CollateralValuation): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const fail = (code: string, detail: string) => { out.push({ code, detail }); };
  const account = demoAccount(s);
  const open = s.positions.filter(p => p.status === 'OPEN');
  const active = s.orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED');

  // 1. Account aggregates are the sums of their parts.
  let im = new D(0), mm = new D(0), upl = new D(0), isoPost = new D(0), isoUpl = new D(0), isoMm = new D(0);
  for (const p of open) {
    const mark = s.marks[p.symbol]?.mark;
    if (!mark) { fail('MARK_MISSING', p.id); continue; }
    if (p.markPrice !== mark) fail('POSITION_MARK_STALE', `${p.id} ${p.markPrice} vs ${mark}`);
    const risk = positionRisk(s, p, mark);
    const pnl = new D(linearPnl(p.side, p.quantity, p.entryPrice, mark));
    if (!eq(risk.unrealized, pnl)) fail('UNREALIZED_MISMATCH', p.id);
    if (p.marginType === 'ISOLATED') { isoPost = isoPost.plus(p.isolatedMargin); isoUpl = isoUpl.plus(pnl); isoMm = isoMm.plus(risk.maintenance); if (n(p.isolatedMargin).lt(0)) fail('NEGATIVE_POST', p.id); }
    else { im = im.plus(risk.initial); mm = mm.plus(risk.maintenance); upl = upl.plus(pnl); if (p.isolatedMargin !== '0') fail('CROSS_HAS_POST', p.id); }
  }
  const reserve = active.reduce((v, o) => v.plus(o.reserved), new D(0));
  if (!eq(account.usedMargin, im)) fail('USED_MARGIN_SUM', `${account.usedMargin} vs ${im}`);
  if (!eq(account.maintenanceMargin, mm)) fail('MAINTENANCE_SUM', `${account.maintenanceMargin} vs ${mm}`);
  if (!eq(account.unrealizedPnl, upl)) fail('UNREALIZED_SUM', `${account.unrealizedPnl} vs ${upl}`);
  if (!eq(account.isolatedMargin, isoPost)) fail('ISOLATED_MARGIN_SUM', `${account.isolatedMargin} vs ${isoPost}`);
  if (!eq(account.isolatedUnrealizedPnl, isoUpl)) fail('ISOLATED_UPL_SUM', '');
  if (!eq(account.isolatedMaintenanceMargin, isoMm)) fail('ISOLATED_MM_SUM', '');
  if (!eq(account.orderReserve, reserve)) fail('RESERVE_SUM', `${account.orderReserve} vs ${reserve}`);
  const external = s.collateral ? n(s.collateral.priced) : new D(0);
  const equity = n(s.walletBalance).plus(external).plus(upl);
  if (!eq(account.equity, equity)) fail('EQUITY_FORMULA', `${account.equity} vs ${equity}`);
  if (!eq(account.settleEquity, n(s.walletBalance).plus(upl))) fail('SETTLE_EQUITY_FORMULA', '');
  if (!eq(account.available, D.maximum(0, equity.minus(im).minus(reserve)))) fail('AVAILABLE_FORMULA', '');
  // Unknown is null, a real zero is '0'.
  if ((account.maintenanceRatio === null) !== equity.lte(0)) fail('RATIO_NULL_RULE', String(account.maintenanceRatio));
  if (account.liquidatable && !open.some(p => p.marginType === 'CROSS')) fail('LIQUIDATABLE_WITHOUT_CROSS', '');
  if (account.liquidatable && s.collateral && !s.collateral.complete) fail('LIQUIDATABLE_ON_FLOOR', '');

  // 2. Every order's reserve is the formula, and reduce-only orders reserve nothing.
  for (const o of active) {
    const inst = s.instruments[o.symbol];
    if (!inst) { fail('INSTRUMENT_MISSING', o.symbol); continue; }
    const price = o.price ?? s.marks[o.symbol]?.mark;
    if (o.reduceOnly) { if (o.reserved !== '0') fail('REDUCE_ONLY_RESERVE', o.id); continue; }
    if (o.price && price) {
      const expected = n(o.remaining).times(price).times(new D(1).div(o.leverage).plus(n(inst.profile.takerFeeRate).times(2)));
      if (!eq(o.reserved, expected, '0.000001')) fail('RESERVE_FORMULA', `${o.id} ${o.reserved} vs ${expected}`);
    }
    if (n(o.filled).plus(o.remaining).minus(o.quantity).abs().gt('0.000000001')) fail('ORDER_QUANTITY_SPLIT', o.id);
  }

  // 3. Each position reproduces its own history from the journal: fees, realized, funding, entry — once each.
  for (const p of s.positions) {
    const events = s.events.filter(e => e.positionId === p.id);
    const opens = events.filter(e => e.kind === 'OPEN');
    const reducing = events.filter(e => (REDUCING as readonly string[]).includes(e.kind));
    const funding = events.filter(e => e.kind === 'FUNDING');
    const openingFees = opens.reduce((v, e) => v.plus(e.fee), new D(0));
    const closingFees = reducing.reduce((v, e) => v.plus(e.fee), new D(0));
    const realized = reducing.reduce((v, e) => v.plus(n(e.cashflow).plus(e.fee)), new D(0));
    const fundingNet = funding.reduce((v, e) => v.plus(e.cashflow), new D(0));
    if (!eq(p.openingFees, openingFees)) fail('OPENING_FEES_ONCE', `${p.id} ${p.openingFees} vs ${openingFees}`);
    if (!eq(p.closingFees, closingFees)) fail('CLOSING_FEES_ONCE', `${p.id} ${p.closingFees} vs ${closingFees}`);
    if (!eq(p.realizedGross, realized)) fail('REALIZED_ONCE', `${p.id} ${p.realizedGross} vs ${realized}`);
    if (!eq(p.fundingNet, fundingNet)) fail('FUNDING_ONCE', `${p.id} ${p.fundingNet} vs ${fundingNet}`);
    const openedQty = opens.reduce((v, e) => v.plus(e.quantity), new D(0));
    const closedQty = reducing.reduce((v, e) => v.plus(e.quantity), new D(0));
    if (!eq(p.quantity, openedQty.minus(closedQty), '0.000000001')) fail('QUANTITY_FROM_FILLS', `${p.id} ${p.quantity} vs ${openedQty.minus(closedQty)}`);
    if (n(p.quantity).lt(0)) fail('NEGATIVE_QUANTITY', p.id);
    if (p.status === 'OPEN' && n(p.quantity).isZero()) fail('OPEN_WITH_ZERO_QUANTITY', p.id);
    if (p.status !== 'OPEN' && !n(p.quantity).isZero()) fail('CLOSED_WITH_QUANTITY', p.id);
    // Average entry is the quantity-weighted average of the fills; a partial close never moves it.
    if (openedQty.gt(0)) {
      const weighted = opens.reduce((v, e) => v.plus(n(e.quantity).times(e.price!)), new D(0)).div(openedQty);
      if (!eq(p.entryPrice, weighted, '0.000000000001')) fail('WEIGHTED_ENTRY', `${p.id} ${p.entryPrice} vs ${weighted}`);
    }
    // ROI basis follows leverage, not P&L: quantity x entry / leverage.
    if (p.status === 'OPEN' && !eq(p.roiBasis, n(p.quantity).times(p.entryPrice).div(p.leverage), '0.000000001')) fail('ROI_BASIS_LEVERAGE', p.id);
    const view = demoPositionView(s, p);
    const basis = p.status === 'OPEN' ? p.roiBasis : p.closedRoiBasis;
    if ((view.roiPercent === null) !== n(basis).lte(0)) fail('ROI_NULL_RULE', p.id);
    if (!eq(view.realizedPnl, realized.minus(openingFees).minus(closingFees).plus(fundingNet))) fail('REALIZED_VIEW', p.id);
    // An isolated position's realized loss, funding included, never exceeds what was posted for it.
    if (p.marginType === 'ISOLATED' && p.status !== 'OPEN') {
      const posted = opens.reduce((v, e) => v.plus(n(e.quantity).times(e.price!).div(p.leverage)), new D(0));
      if (realized.plus(fundingNet).lt(posted.negated().minus('0.000001'))) fail('ISOLATED_LOSS_BEYOND_POST', `${p.id} ${realized.plus(fundingNet)} < -${posted}`);
    }
  }

  // 4. The ledger fold of the journal reproduces the settle balance (free cash plus open posts).
  const ledger = accountLedger(s);
  if (!ledger.reconciled) fail('LEDGER_UNRECONCILED', `${ledger.closingBalance} vs ${ledger.settleBalance}`);
  const journalFees = s.events.reduce((v, e) => v.plus(e.fee), new D(0));
  if (!eq(ledger.totals.fees, journalFees)) fail('LEDGER_FEES_ONCE', '');

  // 5. Liquidation references: at the reference the position is still solvent, one tick further it is not.
  for (const p of open) {
    const reference = estimateDemoLiquidationPrice(s, p.id);
    if (reference === null) continue;
    if (!n(reference).gt(0)) { fail('LIQ_PRICE_NOT_POSITIVE', p.id); continue; }
    const tick = n(s.instruments[p.symbol].rules.tickSize);
    const health = (mark: string) => {
      if (p.marginType === 'ISOLATED') return isolatedHealth(s, p, mark);
      const probe: DemoState = { ...s, positions: s.positions.map(x => x.status === 'OPEN' && x.symbol === p.symbol ? { ...x, markPrice: mark } : x), marks: { ...s.marks, [p.symbol]: { ...s.marks[p.symbol], mark } } };
      const a = demoAccount(probe); return n(a.equity).minus(a.maintenanceMargin);
    };
    const net = p.marginType === 'ISOLATED' ? (p.side === 'LONG' ? 1 : -1) : Math.sign(open.filter(x => x.symbol === p.symbol && x.marginType === 'CROSS').reduce((v, x) => v + Number(x.quantity) * (x.side === 'LONG' ? 1 : -1), 0));
    const beyond = n(reference).plus(tick.times(net > 0 ? -1 : 1)).toFixed();
    if (health(reference).lte(0) && n(reference).toFixed() !== n(s.marks[p.symbol].mark).toFixed()) fail('LIQ_REFERENCE_ALREADY_UNDER', `${p.id} at ${reference}`);
    if (n(beyond).gt(0) && health(beyond).gt(0)) fail('LIQ_REFERENCE_TOO_FAR', `${p.id} ${reference}: still solvent at ${beyond}`);
  }

  // 6. The account response is the engine account, whatever valuation is passed alongside.
  if (valuation) {
    const view = crossAccount(account, valuation, open.length > 0);
    if (!eq(view.available, account.available)) fail('RESPONSE_AVAILABLE', `${view.available} vs ${account.available}`);
    if (s.collateral && !eq(view.walletCollateral, s.collateral.priced)) fail('RESPONSE_COLLATERAL', '');
    if (!eq(view.settleBalance, n(s.walletBalance).plus(isoPost))) fail('RESPONSE_SETTLE_BALANCE', '');
    if (!eq(view.equity, equity.plus(isoPost).plus(isoUpl))) fail('RESPONSE_EQUITY', '');
    if (view.collateralComplete && view.liquidatable !== account.liquidatable) fail('RESPONSE_VERDICT', '');
  }
  return out;
}

/** Throw with every violation listed, for use inside tests and the stress harness. */
export function assertNativeInvariants(s: DemoState, valuation?: CollateralValuation, label = '') {
  const violations = nativeInvariants(s, valuation);
  if (violations.length) throw new Error(`Native invariants violated${label ? ` (${label})` : ''}:\n${violations.map(v => `  ${v.code}: ${v.detail}`).join('\n')}`);
}
export type { DemoPosition };
