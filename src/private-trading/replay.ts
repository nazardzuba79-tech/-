import { amount, calculatePosition, closePositionAllocation, decimal, fundingCashflow, linearPnl, quoteOrderCost, roiPercent, validateProfile } from './math';
import { Candle, ReplayInput, ReplayResult } from './types';

const zero = () => decimal('0');
function validTime(t: number): boolean { return Number.isSafeInteger(t) && t >= 0; }
function assertCandle(c: Candle): void {
  if (!validTime(c.timestamp)) throw new Error('INVALID_CANDLE_TIME');
  const o = decimal(c.open, 'candle_open', true), h = decimal(c.high, 'candle_high', true), l = decimal(c.low, 'candle_low', true), close = decimal(c.close, 'candle_close', true);
  if (l.gt(h) || o.gt(h) || o.lt(l) || close.gt(h) || close.lt(l)) throw new Error('INVALID_CANDLE_RANGE');
}

/** Deterministic OHLC simulation, never an assertion of historical exchange fills. */
export function replayScenario(input: ReplayInput): ReplayResult {
  validateProfile(input.profile);
  if (!input.scenarioId || !input.symbol || !['LONG', 'SHORT'].includes(input.side)) throw new Error('INVALID_SCENARIO');
  const evaluatedAt = input.evaluatedAt ?? input.createdAt;
  if (![input.createdAt, evaluatedAt, input.requestedOpenedAt, input.asOf].every(validTime) || evaluatedAt < input.createdAt || input.asOf > evaluatedAt || input.requestedOpenedAt >= input.asOf) throw new Error('INVALID_SCENARIO_TIME');
  const interval = input.data.intervalMs;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 86400000 || input.data.tradeCandles.length > 50000 || input.data.markCandles.length > 50000) throw new Error('HISTORY_LIMIT_EXCEEDED');
  const openedAt = (Math.floor(input.requestedOpenedAt / interval) + 1) * interval;
  const closedAt = input.requestedClosedAt === undefined ? null : (Math.floor(input.requestedClosedAt / interval) + 1) * interval;
  if (input.requestedClosedAt !== undefined && (!validTime(input.requestedClosedAt) || input.requestedClosedAt < openedAt || closedAt! > input.asOf)) throw new Error('INVALID_CLOSE_TIME');
  const initialQuantity = decimal(input.quantity, 'quantity', true), capital = decimal(input.allocatedCapital, 'allocated_capital', true);
  decimal(input.leverage, 'leverage', true);
  const result: ReplayResult = { scenarioId: input.scenarioId, createdAt: input.createdAt, effectiveOpenedAt: null, effectiveClosedAt: null, asOf: input.asOf, evaluatedThrough: null, mode: 'HISTORICAL_REPLAY', verification: 'VERIFIED', status: 'NOT_OPENED', issues: [], assumptions: [...input.profile.assumptions, 'ENTRY_AND_MANUAL_CLOSE_AT_NEXT_CANDLE_OPEN', 'MARK_TPSL_TRIGGER_NEXT_TRADE_CANDLE_OPEN', 'INTRABAR_LIQUIDATION_MODEL_AT_MARK_BOUNDARY', 'FUNDING_FREE_SCENARIO_CASH_FIRST_THEN_ISOLATED_COLLATERAL', 'BOUNDARY_PRIORITY_RISK_FUNDING_RISK_CLOSE_MARGIN_TPSL', 'ENTRY_FIXED_MARGIN_PROFILE_NOT_EXACT_HISTORICAL_BYBIT'], pricingModelVersion: input.profile.pricingModelVersion, feeModelVersion: input.profile.feeModelVersion, riskModelVersion: input.profile.riskModelVersion, entryPrice: null, valuationPrice: null, remainingQuantity: '0', allocatedCapital: amount(capital), scenarioEquity: amount(capital), remainingCollateral: '0', openingFees: '0', closingFees: '0', fundingNet: '0', realizedGross: '0', unrealizedPnl: '0', netPnl: '0', roiMarginBasis: '0', roiPercent: null, liquidationPrice: null, fills: [], journal: [] };
  const fail = (issue: string, verification: 'INCOMPLETE' | 'AMBIGUOUS' = 'INCOMPLETE') => { if (result.verification !== 'AMBIGUOUS') result.verification = verification; result.issues.push(issue); };
  if (!input.data.complete) { fail('PROVIDER_HISTORY_INCOMPLETE'); result.issues.push(...(input.data.issues ?? [])); }
  const candles = new Map<number, Candle>(), marks = new Map<number, Candle>();
  for (const [source, target] of [[input.data.tradeCandles, candles], [input.data.markCandles, marks]] as const) {
    for (const c of source) {
      assertCandle(c);
      if (c.timestamp % interval !== 0) throw new Error('UNALIGNED_CANDLE');
      if (target.has(c.timestamp)) throw new Error('DUPLICATE_CANDLE');
      target.set(c.timestamp, c);
    }
  }
  const events = [...(input.events ?? [])];
  if (events.length > 1000) throw new Error('EVENT_LIMIT_EXCEEDED');
  const ids = new Set<string>();
  const eventPriority = { CLOSE: 0, MARGIN: 1, TPSL: 2 };
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new Error('DUPLICATE_EVENT'); ids.add(event.id);
    if (!validTime(event.effectiveAt) || event.effectiveAt < openedAt || event.effectiveAt > input.asOf) throw new Error('INVALID_EVENT_TIME');
    if (event.effectiveAt % interval !== 0) { fail('EVENT_REQUIRES_FINER_HISTORY', 'AMBIGUOUS'); return result; }
    if (event.kind === 'MARGIN') decimal(event.amount, 'margin_change');
    else if (event.kind === 'CLOSE') decimal(event.quantity, 'close_quantity', true);
    else if (event.kind === 'TPSL') { if (event.takeProfit !== null) decimal(event.takeProfit, 'take_profit', true); if (event.stopLoss !== null) decimal(event.stopLoss, 'stop_loss', true); }
    else throw new Error('INVALID_SCENARIO_EVENT');
  }
  events.sort((a, b) => a.effectiveAt - b.effectiveAt || eventPriority[a.kind] - eventPriority[b.kind] || a.id.localeCompare(b.id));
  const funding = new Map<number, typeof input.data.fundingEvents[number]>();
  for (const f of input.data.fundingEvents) {
    if (!validTime(f.timestamp) || funding.has(f.timestamp)) throw new Error('INVALID_FUNDING_TIME');
    decimal(f.rate, 'funding_rate'); decimal(f.markPrice, 'funding_mark', true); funding.set(f.timestamp, f);
    if (f.timestamp > openedAt && f.timestamp <= input.asOf && f.timestamp % interval !== 0) fail('FUNDING_REQUIRES_FINER_HISTORY');
  }
  for (const time of input.data.expectedFundingTimestamps) {
    if (time > openedAt && time <= input.asOf && (!funding.has(time) || time % interval !== 0)) fail('FUNDING_HISTORY_INCOMPLETE');
  }
  let q = zero(), margin = zero(), free = capital, openingFees = zero(), closingFees = zero(), fundingNet = zero(), gross = zero();
  let entry = '', valuation = '', basisRemaining = zero(), basisClosed = zero();
  let tp = input.takeProfit ?? null, sl = input.stopLoss ?? null;
  if (tp !== null) decimal(tp, 'take_profit', true); if (sl !== null) decimal(sl, 'stop_loss', true);
  let pendingTrigger: 'TAKE_PROFIT' | 'STOP_LOSS' | null = null;
  const slip = (price: string, opening: boolean) => {
    const buy = opening ? input.side === 'LONG' : input.side === 'SHORT';
    const multiplier = decimal('1').plus(decimal(input.profile.slippageBps).div(10000).times(buy ? 1 : -1));
    return amount(decimal(price, 'execution_price', true).times(multiplier));
  };
  const journal = (id: string, effectiveAt: number, kind: ReplayResult['journal'][number]['kind'], value: string) => result.journal.push({ id: `${input.scenarioId}:${id}`, effectiveAt, kind, amount: value });
  const position = (markPrice: string) => calculatePosition({ side: input.side, quantity: amount(q), entryPrice: entry, leverage: input.leverage, allocatedMargin: amount(margin), markPrice, profile: input.profile });
  const close = (quantity: string, price: string, time: number, kind: 'CLOSE' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION', id: string) => {
    const exitPrice = slip(price, false), closeQ = decimal(quantity, 'close_quantity', true);
    const rate = kind === 'LIQUIDATION' ? amount(decimal(input.profile.takerFeeRate).plus(input.profile.liquidationFeeRate)) : input.profile.takerFeeRate;
    const allocation = closePositionAllocation({ side: input.side, quantity: amount(q), closeQuantity: quantity, entryPrice: entry, exitPrice, allocatedMargin: amount(margin), feeRate: rate });
    const allocatedBasis = basisRemaining.times(closeQ).div(q); basisRemaining = basisRemaining.minus(allocatedBasis); basisClosed = basisClosed.plus(allocatedBasis);
    q = decimal(allocation.remainingQuantity); margin = decimal(allocation.remainingMargin);
    free = free.plus(allocation.releasedMargin).plus(allocation.realizedGross).minus(allocation.closingFee);
    gross = gross.plus(allocation.realizedGross); closingFees = closingFees.plus(allocation.closingFee);
    journal(`${id}:pnl`, time, 'REALIZED_PNL', allocation.realizedGross);
    journal(`${id}:fee`, time, kind === 'LIQUIDATION' ? 'LIQUIDATION_FEE' : 'CLOSE_FEE', amount(decimal(allocation.closingFee).negated()));
    result.fills.push({ id: `${input.scenarioId}:${id}`, effectiveAt: time, kind, quantity, price: exitPrice, fee: allocation.closingFee, realizedGross: allocation.realizedGross });
    valuation = exitPrice;
    if (q.isZero()) { result.status = kind === 'LIQUIDATION' ? 'LIQUIDATED' : 'CLOSED'; result.effectiveClosedAt = time; }
  };
  const atOpenRisk = (mark: string, trade: string, time: number): boolean => {
    if (!q.gt(0)) return false;
    if (!position(mark).liquidatable) return false;
    close(amount(q), trade, time, 'LIQUIDATION', `liquidation:${time}`); return true;
  };
  for (let t = openedAt; t <= input.asOf; t += interval) {
    const candle = candles.get(t), mark = marks.get(t);
    if (!candle || !mark) {
      // No next bar is needed when the entire requested interval ended on the previous close.
      if (t === input.asOf && result.evaluatedThrough === t && closedAt !== t && !events.some((e) => e.effectiveAt === t) && !funding.has(t) && !pendingTrigger) break;
      fail(`MISSING_CANDLE:${t}`); break;
    }
    if (result.status === 'NOT_OPENED') {
      entry = input.manualEntryPrice === undefined ? slip(candle.open, true) : amount(decimal(input.manualEntryPrice, 'manual_entry', true));
      if (input.manualEntryPrice !== undefined) result.assumptions.push('MANUAL_ENTRY_PRICE_ASSUMPTION');
      const cost = quoteOrderCost({ side: input.side, quantity: input.quantity, price: entry, leverage: input.leverage, profile: input.profile });
      if (free.lt(cost.totalCost)) throw new Error('INSUFFICIENT_SCENARIO_CAPITAL');
      margin = decimal(cost.positionMargin); basisRemaining = margin; free = free.minus(cost.totalCost); openingFees = decimal(cost.openingFee); q = initialQuantity;
      result.entryPrice = entry; result.effectiveOpenedAt = t; result.status = 'OPEN';
      journal('open:fee', t, 'OPEN_FEE', amount(openingFees.negated()));
      result.fills.push({ id: `${input.scenarioId}:open`, effectiveAt: t, kind: 'OPEN', quantity: amount(q), price: entry, fee: amount(openingFees), realizedGross: '0' });
    }
    valuation = mark.open; result.evaluatedThrough = t;
    // Existing risk at the boundary precedes newly requested rescue margin.
    if (atOpenRisk(mark.open, candle.open, t)) break;
    const f = funding.get(t);
    if (f && t > openedAt) {
      if (!decimal(f.markPrice).eq(mark.open)) { fail(`FUNDING_MARK_MISMATCH:${t}`); break; }
      const flow = decimal(fundingCashflow(input.side, amount(q), f.markPrice, f.rate));
      if (flow.lt(0)) { const paidFree = free.gt(flow.abs()) ? flow.abs() : free; free = free.minus(paidFree); margin = margin.minus(flow.abs().minus(paidFree)); }
      else free = free.plus(flow);
      fundingNet = fundingNet.plus(flow); journal(`funding:${t}`, t, 'FUNDING', amount(flow));
      if (atOpenRisk(mark.open, candle.open, t)) break;
    }
    if (closedAt === t || pendingTrigger) { close(amount(q), candle.open, t, pendingTrigger ?? 'CLOSE', `close:${t}`); break; }
    for (const event of events.filter((e) => e.effectiveAt === t)) {
      if (!q.gt(0)) break;
      if (event.kind === 'CLOSE') close(event.quantity, candle.open, t, 'CLOSE', event.id);
      else if (event.kind === 'MARGIN') {
        const change = decimal(event.amount);
        if (change.gt(free) || margin.plus(change).lte(0)) throw new Error('INSUFFICIENT_MARGIN');
        const oldMargin = margin; margin = margin.plus(change);
        if (position(mark.open).liquidatable) { margin = oldMargin; throw new Error('UNSAFE_MARGIN_REMOVAL'); }
        free = free.minus(change); basisRemaining = basisRemaining.plus(change);
        if (basisRemaining.lte(0)) throw new Error('INVALID_ROI_MARGIN_BASIS');
        journal(event.id, t, 'MARGIN', amount(change));
      } else { tp = event.takeProfit; sl = event.stopLoss; }
    }
    if (!q.gt(0)) break;
    if (t + interval > input.asOf) {
      if (t < input.asOf) fail('AS_OF_REQUIRES_CLOSED_CANDLE');
      break;
    }
    const adverse = input.side === 'LONG' ? mark.low : mark.high;
    const liqHit = position(adverse).liquidatable;
    const tpHit = tp !== null && (input.side === 'LONG' ? decimal(mark.high).gte(tp) : decimal(mark.low).lte(tp));
    const slHit = sl !== null && (input.side === 'LONG' ? decimal(mark.low).lte(sl) : decimal(mark.high).gte(sl));
    if ((tpHit && slHit) || (liqHit && (tpHit || slHit))) { fail(`INTRABAR_PATH_AMBIGUOUS:${t}`, 'AMBIGUOUS'); break; }
    if (liqHit) {
      const boundary = position(mark.open).liquidationPrice;
      if (!boundary) { fail('LIQUIDATION_BOUNDARY_OUTSIDE_MODEL'); break; }
      close(amount(q), boundary, t + interval, 'LIQUIDATION', `liquidation:${t}`);
      result.assumptions.push('LIQUIDATION_TIME_RECORDED_AT_CONTAINING_CANDLE_END'); result.evaluatedThrough = t + interval; break;
    }
    if (tpHit || slHit) pendingTrigger = tpHit ? 'TAKE_PROFIT' : 'STOP_LOSS';
    valuation = mark.close; result.evaluatedThrough = t + interval;
  }
  if (pendingTrigger && q.gt(0)) fail('TRIGGER_AWAITS_NEXT_CANDLE_EXECUTION');
  result.remainingQuantity = amount(q); result.valuationPrice = valuation || null;
  result.openingFees = amount(openingFees); result.closingFees = amount(closingFees); result.fundingNet = amount(fundingNet); result.realizedGross = amount(gross);
  result.unrealizedPnl = q.gt(0) && entry && valuation ? linearPnl(input.side, amount(q), entry, valuation) : '0';
  result.netPnl = amount(gross.plus(result.unrealizedPnl).plus(fundingNet).minus(openingFees).minus(closingFees));
  result.scenarioEquity = amount(free.plus(margin).plus(result.unrealizedPnl));
  result.remainingCollateral = amount(q.gt(0) ? margin : zero());
  result.roiMarginBasis = amount(basisRemaining.plus(basisClosed)); result.roiPercent = roiPercent(result.netPnl, result.roiMarginBasis);
  if (q.gt(0) && valuation) result.liquidationPrice = position(valuation).liquidationPrice;
  if (result.status === 'NOT_OPENED') fail('NO_EXECUTABLE_ENTRY_CANDLE');
  if (result.status === 'OPEN' && result.evaluatedThrough !== input.asOf) fail('HISTORY_DID_NOT_REACH_AS_OF');
  return result;
}
