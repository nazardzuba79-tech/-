import { amount, calculatePosition, closePositionAllocation, decimal, fundingCashflow, linearPnl, quoteOrderCost, roiPercent, validateProfile } from './math';
import { createHash } from 'crypto';
import { Candle, ReplayInput, ReplayResult, ResolvedCandleSelection } from './types';

const zero = () => decimal('0');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
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
  const validateSelection = (selected: ResolvedCandleSelection) => {
    assertCandle(selected.candle);
    if (selected.source !== 'BYBIT_LINEAR' || selected.symbol !== input.symbol || selected.verification !== 'VERIFIED'
      || !['OPEN', 'CLOSE'].includes(selected.pricePoint) || !validTime(selected.openTime) || !validTime(selected.closeTime)
      || !Number.isSafeInteger(selected.intervalMs) || selected.intervalMs < interval || selected.intervalMs % interval !== 0
      || selected.candle.timestamp !== selected.openTime || selected.closeTime !== selected.openTime + selected.intervalMs
      || selected.closeTime > evaluatedAt || selected.openTime % interval !== 0
      || selected.effectiveAt !== (selected.pricePoint === 'CLOSE' ? selected.closeTime : selected.openTime)
      || !decimal(selected.price, 'candle_price', true).eq(selected.pricePoint === 'CLOSE' ? selected.candle.close : selected.candle.open)) throw new Error('INVALID_SELECTED_CANDLE');
  };
  if (input.candleEntry) { validateSelection(input.candleEntry); if (input.manualEntryPrice !== undefined) throw new Error('CONFLICTING_ENTRY_MODEL'); }
  if (input.candleClose) validateSelection(input.candleClose);
  const openedAt = input.candleEntry?.effectiveAt ?? (Math.floor(input.requestedOpenedAt / interval) + 1) * interval;
  const closedAt = input.candleClose?.effectiveAt ?? (input.requestedClosedAt === undefined ? null : (Math.floor(input.requestedClosedAt / interval) + 1) * interval);
  if (openedAt > input.asOf || (closedAt !== null && (closedAt <= openedAt || closedAt > input.asOf))) throw new Error('INVALID_CLOSE_TIME');
  const identity = createHash('sha256').update(JSON.stringify(canonical({ scenario: input.scenarioId, symbol: input.symbol, side: input.side,
    quantity: input.quantity, leverage: input.leverage, capital: input.allocatedCapital, openedAt, entry: input.candleEntry,
    manual: input.manualEntryPrice, profile: input.profile, interval, takeProfit: input.takeProfit, stopLoss: input.stopLoss, events: input.events ? [...input.events].sort((a, b) => a.id.localeCompare(b.id)) : undefined }))).digest('hex');
  const resume = input.resume;
  if (resume && (resume.verification !== 'VERIFIED' || resume.status !== 'OPEN' || !resume.checkpoint
    || resume.checkpoint.identity !== identity || resume.checkpoint.version !== 1 || resume.asOf >= input.asOf
    || resume.evaluatedThrough !== resume.asOf || resume.checkpoint.nextTime !== resume.asOf)) throw new Error('INVALID_REPLAY_CHECKPOINT');
  if (input.requestedClosedAt !== undefined && (!validTime(input.requestedClosedAt) || input.requestedClosedAt < openedAt || closedAt! > input.asOf)) throw new Error('INVALID_CLOSE_TIME');
  const initialQuantity = decimal(input.quantity, 'quantity', true), capital = decimal(input.allocatedCapital, 'allocated_capital', true);
  decimal(input.leverage, 'leverage', true);
  const result: ReplayResult = { scenarioId: input.scenarioId, createdAt: input.createdAt, effectiveOpenedAt: null, effectiveClosedAt: null, asOf: input.asOf, evaluatedThrough: null, mode: 'HISTORICAL_REPLAY', verification: 'VERIFIED', status: 'NOT_OPENED', issues: [], assumptions: [...input.profile.assumptions, 'ENTRY_AND_MANUAL_CLOSE_AT_NEXT_CANDLE_OPEN', 'MARK_TPSL_TRIGGER_NEXT_TRADE_CANDLE_OPEN', 'INTRABAR_LIQUIDATION_MODEL_AT_MARK_BOUNDARY', 'FUNDING_FREE_SCENARIO_CASH_FIRST_THEN_ISOLATED_COLLATERAL', 'BOUNDARY_PRIORITY_RISK_FUNDING_RISK_CLOSE_MARGIN_TPSL', 'ENTRY_FIXED_MARGIN_PROFILE_NOT_EXACT_HISTORICAL_BYBIT'], pricingModelVersion: input.profile.pricingModelVersion, feeModelVersion: input.profile.feeModelVersion, riskModelVersion: input.profile.riskModelVersion, entryPrice: null, valuationPrice: null, remainingQuantity: '0', allocatedCapital: amount(capital), scenarioEquity: amount(capital), remainingCollateral: '0', openingFees: '0', closingFees: '0', fundingNet: '0', realizedGross: '0', unrealizedPnl: '0', netPnl: '0', roiMarginBasis: '0', roiPercent: null, liquidationPrice: null, fills: [], journal: [] };
  if (resume) Object.assign(result, structuredClone(resume), { asOf: input.asOf, checkpoint: undefined });
  if (input.candleEntry) {
    result.candleEntry = structuredClone(input.candleEntry);
    result.assumptions = result.assumptions.filter(a => a !== 'ENTRY_AND_MANUAL_CLOSE_AT_NEXT_CANDLE_OPEN');
    if (!result.assumptions.includes('ENTRY_AT_VERIFIED_SELECTED_CANDLE_POINT_V2')) result.assumptions.push('ENTRY_AT_VERIFIED_SELECTED_CANDLE_POINT_V2', 'OHLC_POINT_MODEL_NOT_HISTORICAL_DEPTH_EXECUTION');
  }
  if (input.candleClose) { result.candleClose = structuredClone(input.candleClose); result.assumptions.push('CLOSE_AT_VERIFIED_SELECTED_CANDLE_POINT_V2'); }
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
  let q = decimal(resume?.remainingQuantity ?? '0'), margin = decimal(resume?.checkpoint?.margin ?? '0'), free = decimal(resume?.checkpoint?.free ?? amount(capital)),
    openingFees = decimal(resume?.openingFees ?? '0'), closingFees = decimal(resume?.closingFees ?? '0'), fundingNet = decimal(resume?.fundingNet ?? '0'), gross = decimal(resume?.realizedGross ?? '0');
  let entry = resume?.entryPrice ?? '', valuation = resume?.valuationPrice ?? '', basisRemaining = decimal(resume?.checkpoint?.basisRemaining ?? '0'), basisClosed = decimal(resume?.checkpoint?.basisClosed ?? '0');
  let tp = resume?.checkpoint ? resume.checkpoint.takeProfit : input.takeProfit ?? null, sl = resume?.checkpoint ? resume.checkpoint.stopLoss : input.stopLoss ?? null;
  let nextTime = resume?.checkpoint?.nextTime ?? openedAt, boundaryProcessed = resume?.checkpoint?.boundaryProcessed ?? false;
  if (tp !== null) decimal(tp, 'take_profit', true); if (sl !== null) decimal(sl, 'stop_loss', true);
  let pendingTrigger: 'TAKE_PROFIT' | 'STOP_LOSS' | null = null;
  const slip = (price: string, opening: boolean) => {
    const buy = opening ? input.side === 'LONG' : input.side === 'SHORT';
    const multiplier = decimal('1').plus(decimal(input.profile.slippageBps).div(10000).times(buy ? 1 : -1));
    return amount(decimal(price, 'execution_price', true).times(multiplier));
  };
  const journal = (id: string, effectiveAt: number, kind: ReplayResult['journal'][number]['kind'], value: string) => result.journal.push({ id: `${input.scenarioId}:${id}`, effectiveAt, kind, amount: value });
  const position = (markPrice: string) => calculatePosition({ side: input.side, quantity: amount(q), entryPrice: entry, leverage: input.leverage, allocatedMargin: amount(margin), markPrice, profile: input.profile });
  const close = (quantity: string, price: string, time: number, kind: 'CLOSE' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION', id: string, exactPoint = false) => {
    const exitPrice = exactPoint ? amount(decimal(price, 'close_point', true)) : slip(price, false), closeQ = decimal(quantity, 'close_quantity', true);
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
  const settleFunding = (time: number, mark: string, trade: string): boolean => {
    const f = funding.get(time);
    if (!f || time <= openedAt) return false;
    if (!decimal(f.markPrice).eq(mark)) { fail(`FUNDING_MARK_MISMATCH:${time}`); return true; }
    const flow = decimal(fundingCashflow(input.side, amount(q), f.markPrice, f.rate));
    if (flow.lt(0)) { const paidFree = free.gt(flow.abs()) ? flow.abs() : free; free = free.minus(paidFree); margin = margin.minus(flow.abs().minus(paidFree)); }
    else free = free.plus(flow);
    fundingNet = fundingNet.plus(flow); journal(`funding:${time}`, time, 'FUNDING', amount(flow));
    return atOpenRisk(mark, trade, time);
  };
  const opening = (price: string, time: number) => {
    entry = price;
    const cost = quoteOrderCost({ side: input.side, quantity: input.quantity, price: entry, leverage: input.leverage, profile: input.profile });
    if (free.lt(cost.totalCost)) throw new Error('INSUFFICIENT_SCENARIO_CAPITAL');
    margin = decimal(cost.positionMargin); basisRemaining = margin; free = free.minus(cost.totalCost); openingFees = decimal(cost.openingFee); q = initialQuantity;
    result.entryPrice = entry; result.effectiveOpenedAt = time; result.status = 'OPEN';
    journal('open:fee', time, 'OPEN_FEE', amount(openingFees.negated()));
    result.fills.push({ id: `${input.scenarioId}:open`, effectiveAt: time, kind: 'OPEN', quantity: amount(q), price: entry, fee: amount(openingFees), realizedGross: '0' });
  };
  // A selected close can be the latest complete bar. Its earlier range is never position risk.
  if (!resume && input.candleEntry?.pricePoint === 'CLOSE') {
    opening(amount(decimal(input.candleEntry.price, 'candle_entry', true)), openedAt);
    const previousMark = marks.get(openedAt - interval);
    const previousTrade = candles.get(openedAt - interval);
    if (!previousTrade || !decimal(previousTrade.close).eq(input.candleEntry.price)) fail('SELECTED_ENTRY_HISTORY_MISMATCH');
    if (!previousMark) fail(`MISSING_ENTRY_MARK:${openedAt - interval}`);
    else { valuation = previousMark.close; result.evaluatedThrough = openedAt; atOpenRisk(valuation, input.candleEntry.price, openedAt); }
  }
  for (let t = nextTime; q.gt(0) || result.status === 'NOT_OPENED'; t += interval) {
    if (t > input.asOf) break;
    const candle = candles.get(t), mark = marks.get(t);
    if (!candle || !mark) {
      // No next bar is needed when the entire requested interval ended on the previous close.
      if (t === input.asOf && result.evaluatedThrough === t && closedAt !== t && !events.some((e) => e.effectiveAt === t) && !funding.has(t) && !pendingTrigger) break;
      fail(`MISSING_CANDLE:${t}`); break;
    }
    if (result.status === 'NOT_OPENED') {
      if (input.candleEntry && !decimal(candle.open).eq(input.candleEntry.price)) fail('SELECTED_ENTRY_HISTORY_MISMATCH');
      entry = input.candleEntry ? amount(decimal(input.candleEntry.price, 'candle_entry', true)) : input.manualEntryPrice === undefined ? slip(candle.open, true) : amount(decimal(input.manualEntryPrice, 'manual_entry', true));
      if (input.manualEntryPrice !== undefined) result.assumptions.push('MANUAL_ENTRY_PRICE_ASSUMPTION');
      opening(entry, t);
    }
    if (!boundaryProcessed) {
    valuation = mark.open; result.evaluatedThrough = t;
    // Existing risk at the boundary precedes newly requested rescue margin.
    if (atOpenRisk(mark.open, candle.open, t)) break;
    if (settleFunding(t, mark.open, candle.open)) break;
    if (closedAt === t || pendingTrigger) {
      const selected = input.candleClose && !pendingTrigger;
      if (selected && input.candleClose!.pricePoint === 'OPEN' && !decimal(candle.open).eq(input.candleClose!.price)) { fail('SELECTED_CLOSE_HISTORY_MISMATCH'); break; }
      close(amount(q), selected ? input.candleClose!.price : candle.open, t, pendingTrigger ?? 'CLOSE', `close:${t}`, Boolean(selected)); break;
    }
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
    }
    boundaryProcessed = true; nextTime = t;
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
    nextTime = t + interval; boundaryProcessed = false;
    // The complete held candle's risk path precedes its selected close price.
    if (input.candleClose?.pricePoint === 'CLOSE' && input.candleClose.effectiveAt === t + interval && !pendingTrigger) {
      if (!decimal(candle.close).eq(input.candleClose.price)) { fail('SELECTED_CLOSE_HISTORY_MISMATCH'); break; }
      const closingFunding = funding.get(t + interval);
      if (closingFunding && (atOpenRisk(closingFunding.markPrice, input.candleClose.price, t + interval) || settleFunding(t + interval, closingFunding.markPrice, input.candleClose.price))) break;
      close(amount(q), input.candleClose.price, t + interval, 'CLOSE', `close:${t + interval}`, true); break;
    }
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
  if (result.verification === 'VERIFIED' && result.status === 'OPEN' && !pendingTrigger) result.checkpoint = {
    version: 1, identity, nextTime, boundaryProcessed, free: amount(free), margin: amount(margin), basisRemaining: amount(basisRemaining), basisClosed: amount(basisClosed), takeProfit: tp, stopLoss: sl,
  };
  return result;
}
