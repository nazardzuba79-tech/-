import BigNumber from 'bignumber.js';
import { createHash, randomUUID } from 'crypto';
import { amount, calculatePosition, closePositionAllocation, consumeBook, decimal, fundingCashflow, quoteOrderCost, roiPercent, selectRiskTier, weightedEntry } from './math';
import { PrivateFreshQuote, assertPrivateFreshQuote } from './marketData';
import { AccountState, PrivateOrder, PrivatePosition, PrivateTradingError } from './serviceTypes';
import { AccountTx, money } from './store';

const n = (value: string) => new BigNumber(value);

/** Use a cloned state for previews; a locked transaction state for execution. */
export function availablePrivateBook(state: AccountState, quote: PrivateFreshQuote) {
  assertPrivateFreshQuote(quote, quote.symbol);
  const books = state.bookConsumption ??= {};
  // Freshness bounds make old snapshots unusable; discard expired consumption records.
  for (const [symbol, previous] of Object.entries(books)) if (Date.now() - previous.providerTimestamp > 6000) delete books[symbol];
  const fingerprint = createHash('sha256').update(JSON.stringify([quote.bids, quote.asks])).digest('hex');
  let used = books[quote.symbol];
  if (used && (quote.providerTimestamp < used.providerTimestamp || quote.bookGeneratedAt < used.bookGeneratedAt)) throw new PrivateTradingError('quote_out_of_order', 'Котировка обновляется. Повторите действие', 503);
  if (!used || quote.bookGeneratedAt > used.bookGeneratedAt) {
    used = books[quote.symbol] = { providerTimestamp: quote.providerTimestamp, bookGeneratedAt: quote.bookGeneratedAt, fingerprint, bids: {}, asks: {} };
  } else if (used.fingerprint !== fingerprint) throw new PrivateTradingError('inconsistent_snapshot', 'Котировка обновляется. Повторите действие', 503);
  else used.providerTimestamp = quote.providerTimestamp;
  const remaining = (side: 'bids' | 'asks') => quote[side].map(level => ({ price: level.price, quantity: amount(n(level.quantity).minus(used[side][amount(n(level.price))] ?? '0')) })).filter(level => n(level.quantity).gt(0));
  return { bids: remaining('bids'), asks: remaining('asks') };
}
function recordConsumption(tx: AccountTx, quote: PrivateFreshQuote, side: 'BUY' | 'SELL', fills: Array<{ price: string; quantity: string }>) {
  const used = tx.state.bookConsumption![quote.symbol][side === 'BUY' ? 'asks' : 'bids'];
  for (const fill of fills) { const key = amount(n(fill.price)); used[key] = amount(n(used[key] ?? '0').plus(fill.quantity)); }
}
function recordQuantity(position: PrivatePosition, now: number) {
  const timeline = position.quantityTimeline ??= [];
  // One account lock determines the actual order of fills with the same millisecond.
  if (timeline.length && timeline[timeline.length - 1].effectiveAt === now) timeline[timeline.length - 1].quantity = position.quantity;
  else timeline.push({ effectiveAt: now, quantity: position.quantity });
}
export function updatePosition(position: PrivatePosition, quote: PrivateFreshQuote) {
  assertPrivateFreshQuote(quote, position.symbol);
  if (position.status !== 'OPEN') return;
  position.markPrice = quote.markPrice;
  const current = calculatePosition({ ...position, markPrice: quote.markPrice, roiMarginBasis: position.initialMarginBasis });
  position.liquidationPrice = current.liquidationPrice;
  position.unrealizedPnl = current.unrealizedPnl; position.netPnl = current.netPnl;
  position.roiPercent = roiPercent(position.unrealizedPnl, position.initialMarginBasis);
  position.asOf = new Date(quote.markProviderTimestamp).toISOString(); position.dataStatus = 'LIVE';
  return current;
}

export async function fillPrivateOrder(tx: AccountTx, order: PrivateOrder, quote: PrivateFreshQuote, suffix: string = randomUUID()) {
  assertPrivateFreshQuote(quote, order.symbol);
  if (!['OPEN', 'PARTIALLY_FILLED'].includes(order.status) || quote.bookGeneratedAt <= order.lastBookTimestamp) return;
  const direction = order.side === 'LONG' ? 'BUY' : 'SELL';
  const execution = consumeBook(direction, order.remainingQuantity, availablePrivateBook(tx.state, quote), order.limitPrice ?? undefined);
  order.lastBookTimestamp = quote.bookGeneratedAt;
  if (!execution.averagePrice) {
    if (order.type === 'MARKET') await cancelPrivateOrder(tx, order, `${suffix}:ioc`);
    return;
  }
  const cost = quoteOrderCost({ side: order.side, quantity: execution.filledQuantity, price: execution.averagePrice, leverage: order.leverage, profile: order.profile });
  let position = tx.state.positions.find(p => p.id === order.positionId);
  if (position && position.status !== 'OPEN') throw new PrivateTradingError('position_closed', 'Позиция уже закрыта', 409);
  const aggregateQuantity = amount(n(position?.quantity ?? '0').plus(execution.filledQuantity));
  const aggregateEntry = position && n(position.quantity).gt(0) ? weightedEntry([
    { quantity: position.quantity, price: position.entryPrice }, ...execution.fills,
  ]) : execution.averagePrice;
  // Successive small fills must not bypass the risk tier for the whole position.
  quoteOrderCost({ side: order.side, quantity: aggregateQuantity, price: aggregateEntry, leverage: order.leverage, profile: order.profile });
  const markTier = selectRiskTier(amount(n(aggregateQuantity).times(quote.markPrice)), order.profile);
  if (markTier.maxLeverage && n(order.leverage).gt(markTier.maxLeverage)) throw new PrivateTradingError('tier_leverage_exceeded', 'Плечо превышает лимит для размера позиции', 409);
  const resting = order.type === 'LIMIT' && n(execution.remainingQuantity).gt(0);
  const restCost = resting ? quoteOrderCost({ side: order.side, quantity: execution.remainingQuantity, price: order.limitPrice!, leverage: order.leverage, profile: order.profile }).totalCost : '0';
  // A better SHORT limit price can increase notional and margin. Its reserved
  // consent budget cannot silently borrow extra free cash for a later fill.
  if (order.type === 'LIMIT' && n(cost.totalCost).plus(restCost).gt(order.reserved)) return;
  const available = tx.available.plus(order.reserved);
  if (available.lt(n(cost.totalCost).plus(restCost))) throw new PrivateTradingError('insufficient_margin', 'Недостаточно демо-маржи для исполнения', 409);
  tx.available = available.minus(cost.totalCost).minus(restCost);
  tx.reserved = tx.reserved.minus(order.reserved).plus(cost.positionMargin).plus(restCost);
  tx.realized = tx.realized.minus(cost.openingFee);
  order.reserved = money(restCost);
  const now = Date.now(), at = new Date(now).toISOString();
  if (!position) {
    position = {
      id: order.positionId, mode: 'DEMO_LIVE', symbol: order.symbol, side: order.side, leverage: order.leverage,
      quantity: '0', initialQuantity: '0', entryPrice: execution.averagePrice, markPrice: quote.markPrice,
      allocatedMargin: '0', initialMarginBasis: '0', realizedMarginBasis: '0', liquidationPrice: null,
      unrealizedPnl: '0', realizedGross: '0', netPnl: '0', roiPercent: null, openingFees: '0', closingFees: '0', fundingNet: '0',
      takeProfit: order.takeProfit, stopLoss: order.stopLoss, status: 'OPEN', createdAt: at,
      effectiveOpenedAt: at, effectiveClosedAt: null, asOf: at, profile: order.profile, verification: 'VERIFIED',
      lastFundingAt: now, lastBookTimestamp: quote.providerTimestamp, lastFillAt: now, isolatedDeficit: '0', quantityTimeline: [],
    };
    tx.state.positions.push(position);
  }
  position.entryPrice = aggregateEntry;
  position.quantity = aggregateQuantity;
  position.initialQuantity = amount(n(position.initialQuantity).plus(execution.filledQuantity));
  position.allocatedMargin = money(n(position.allocatedMargin).plus(cost.positionMargin));
  position.initialMarginBasis = money(n(position.initialMarginBasis).plus(cost.positionMargin));
  position.openingFees = money(n(position.openingFees).plus(cost.openingFee));
  position.lastFillAt = now;
  position.lastBookTimestamp = quote.providerTimestamp;
  recordQuantity(position, now);
  order.filledQuantity = amount(n(order.filledQuantity).plus(execution.filledQuantity));
  order.remainingQuantity = execution.remainingQuantity;
  order.status = execution.complete ? 'FILLED' : resting ? 'PARTIALLY_FILLED' : 'CANCELLED';
  await tx.entry('OPEN_FEE', money(n(cost.openingFee).negated()), `${suffix}:fee`, now, undefined, { positionId: position.id });
  await tx.entry('MARGIN_RESERVED', cost.positionMargin, `${suffix}:margin`, now, undefined, { positionId: position.id });
  for (const [i, fill] of execution.fills.entries()) await tx.entry('FILL', '0', `${suffix}:fill:${i}`, now, undefined, { ...fill, orderId: order.id, positionId: position.id, side: order.side });
  updatePosition(position, quote);
  const check = calculatePosition({ ...position });
  if (check.liquidatable) throw new PrivateTradingError('insufficient_initial_margin', 'Маржа недостаточна для открытия позиции', 409);
  recordConsumption(tx, quote, direction, execution.fills);
}

export async function cancelPrivateOrder(tx: AccountTx, order: PrivateOrder, suffix: string) {
  if (!['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) return;
  tx.available = tx.available.plus(order.reserved); tx.reserved = tx.reserved.minus(order.reserved);
  await tx.entry('ORDER_RESERVE_RELEASED', order.reserved, suffix, undefined, undefined, { orderId: order.id });
  order.reserved = '0'; order.status = 'CANCELLED';
}

export async function closePrivatePosition(tx: AccountTx, position: PrivatePosition, requested: string, quote: PrivateFreshQuote, kind: 'CLOSE' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' = 'CLOSE', suffix: string = randomUUID()) {
  assertPrivateFreshQuote(quote, position.symbol);
  if (position.status !== 'OPEN') throw new PrivateTradingError('position_closed', 'Позиция уже закрыта', 409);
  const qty = decimal(requested, 'quantity', true);
  if (qty.gt(position.quantity)) throw new PrivateTradingError('invalid_close_size', 'Размер закрытия превышает позицию');
  const direction = position.side === 'LONG' ? 'SELL' : 'BUY';
  const execution = consumeBook(direction, requested, availablePrivateBook(tx.state, quote));
  if (!execution.averagePrice) throw new PrivateTradingError('liquidity_unavailable', 'Исполнение временно недоступно', 503);
  // Every close reduces its own position; resting entry remainders cannot reopen it.
  for (const order of tx.state.orders.filter(o => o.positionId === position.id)) await cancelPrivateOrder(tx, order, `${suffix}:cancel:${order.id}`);
  const allocation = closePositionAllocation({ ...position, closeQuantity: execution.filledQuantity, exitPrice: execution.averagePrice, feeRate: position.profile.takerFeeRate });
  const ratio = n(execution.filledQuantity).div(position.quantity);
  let returned = n(allocation.releasedMargin).plus(allocation.realizedGross).minus(allocation.closingFee);
  let liquidationFee = n('0');
  if (kind === 'LIQUIDATION') liquidationFee = n(execution.filledQuantity).times(execution.averagePrice).times(position.profile.liquidationFeeRate);
  returned = returned.minus(liquidationFee);
  // Negative isolated equity is recorded as a model deficit, never charged to other collateral.
  const deficit = returned.lt(0) ? returned.negated() : n('0');
  tx.available = tx.available.plus(BigNumber.maximum(0, returned));
  tx.reserved = tx.reserved.minus(allocation.releasedMargin);
  tx.realized = tx.realized.plus(allocation.realizedGross).minus(allocation.closingFee).minus(liquidationFee);
  position.realizedGross = money(n(position.realizedGross).plus(allocation.realizedGross));
  position.isolatedDeficit = money(n(position.isolatedDeficit ?? '0').plus(deficit));
  tx.state.isolatedDeficit = money(n(tx.state.isolatedDeficit ?? '0').plus(deficit));
  position.closingFees = money(n(position.closingFees).plus(allocation.closingFee).plus(liquidationFee));
  const releasedBasis = n(position.initialMarginBasis).times(ratio);
  position.realizedMarginBasis = money(n(position.realizedMarginBasis).plus(releasedBasis));
  position.initialMarginBasis = money(n(position.initialMarginBasis).minus(releasedBasis));
  position.quantity = allocation.remainingQuantity; position.allocatedMargin = money(allocation.remainingMargin);
  position.markPrice = execution.averagePrice; position.lastFillAt = Date.now();
  position.lastBookTimestamp = quote.providerTimestamp;
  recordQuantity(position, position.lastFillAt);
  if (n(position.quantity).isZero()) {
    position.status = kind === 'LIQUIDATION' ? 'LIQUIDATED' : 'CLOSED';
    position.effectiveClosedAt = new Date().toISOString(); position.asOf = position.effectiveClosedAt;
    position.unrealizedPnl = '0'; position.liquidationPrice = null; position.takeProfit = null; position.stopLoss = null;
    position.netPnl = money(n(position.realizedGross).plus(position.fundingNet).minus(position.openingFees).minus(position.closingFees));
    position.roiPercent = roiPercent(position.netPnl, position.realizedMarginBasis);
  } else updatePosition(position, quote);
  await tx.entry('REALIZED_PNL', allocation.realizedGross, `${suffix}:pnl`, undefined, undefined, { positionId: position.id, kind });
  await tx.entry('CLOSE_FEE', money(n(allocation.closingFee).negated()), `${suffix}:fee`, undefined, undefined, { positionId: position.id });
  if (liquidationFee.gt(0)) await tx.entry('LIQUIDATION_FEE', money(liquidationFee.negated()), `${suffix}:liqfee`);
  if (deficit.gt(0)) await tx.entry('ISOLATED_DEFICIT', money(deficit), `${suffix}:deficit`, undefined, undefined, { positionId: position.id });
  await tx.entry('MARGIN_RELEASED', allocation.releasedMargin, `${suffix}:released`, undefined, undefined, { positionId: position.id });
  for (const [i, fill] of execution.fills.entries()) await tx.entry('FILL', '0', `${suffix}:fill:${i}`, undefined, undefined, { ...fill, positionId: position.id, kind });
  recordConsumption(tx, quote, direction, execution.fills);
}

export async function applyPrivateFunding(tx: AccountTx, position: PrivatePosition, event: { timestamp: number; rate: string; markPrice: string }) {
  if (!Number.isSafeInteger(event.timestamp) || event.timestamp > Date.now()) throw new PrivateTradingError('invalid_funding_time', 'Некорректное время расчёта funding');
  if (event.timestamp <= position.lastFundingAt || event.timestamp <= Date.parse(position.effectiveOpenedAt)) return;
  if (position.effectiveClosedAt && event.timestamp >= Date.parse(position.effectiveClosedAt)) return;
  const timeline = [...(position.quantityTimeline ?? [])].sort((a,b) => a.effectiveAt-b.effectiveAt);
  const atSettlement = timeline.filter(point => point.effectiveAt < event.timestamp).pop();
  // Old persisted positions without a timeline cannot safely backfill past resizes.
  if (!atSettlement && event.timestamp < position.lastFillAt) throw new PrivateTradingError('funding_history_incomplete', 'История расчёта funding временно недоступна', 503);
  const cash = fundingCashflow(position.side, atSettlement?.quantity ?? position.quantity, event.markPrice, event.rate);
  if (n(cash).lt(0)) {
    const payment = n(cash).negated(), freePayment = BigNumber.minimum(tx.available, payment);
    tx.available = tx.available.minus(freePayment);
    const collateralPayment = payment.minus(freePayment);
    const paidCollateral = BigNumber.minimum(n(position.allocatedMargin), collateralPayment);
    const deficit = collateralPayment.minus(paidCollateral);
    position.allocatedMargin = money(n(position.allocatedMargin).minus(paidCollateral));
    tx.reserved = tx.reserved.minus(paidCollateral);
    if (deficit.gt(0)) {
      position.isolatedDeficit = money(n(position.isolatedDeficit ?? '0').plus(deficit));
      tx.state.isolatedDeficit = money(n(tx.state.isolatedDeficit ?? '0').plus(deficit));
      await tx.entry('ISOLATED_FUNDING_DEFICIT', money(deficit), `funding-deficit:${position.id}:${event.timestamp}`, event.timestamp, undefined, { positionId: position.id });
    }
  } else tx.available = tx.available.plus(cash);
  position.fundingNet = money(n(position.fundingNet).plus(cash));
  position.lastFundingAt = event.timestamp; tx.realized = tx.realized.plus(cash);
  await tx.entry('FUNDING', cash, `funding:${position.id}:${event.timestamp}`, event.timestamp, undefined, { positionId: position.id, rate: event.rate });
  position.netPnl = money(n(position.realizedGross).plus(position.unrealizedPnl).plus(position.fundingNet).minus(position.openingFees).minus(position.closingFees));
  if (position.status !== 'OPEN') position.roiPercent = roiPercent(position.netPnl, position.realizedMarginBasis);
}
