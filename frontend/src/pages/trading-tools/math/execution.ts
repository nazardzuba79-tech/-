import { Decimal, direction, exact, Reader, type DecimalValue } from './decimal';
import type { PnlInput, PnlValue, Result, Side } from './types';

export interface ExecutionValues {
  side: Side; entry: DecimalValue; exit: DecimalValue; quantity: DecimalValue;
  feeEntry: DecimalValue; feeExit: DecimalValue; slipEntry: DecimalValue; slipExit: DecimalValue;
  funding: DecimalValue; fixedCosts: DecimalValue;
}
export function execution(values: ExecutionValues) {
  const d = direction(values.side);
  const entryExecution = values.entry.times(new Decimal(1).plus(d.times(values.slipEntry)));
  const exitExecution = values.exit.times(new Decimal(1).minus(d.times(values.slipExit)));
  const notional = values.quantity.times(entryExecution);
  const feeOpen = notional.times(values.feeEntry);
  const feeClose = values.quantity.times(exitExecution).times(values.feeExit);
  const grossPnl = d.times(values.quantity).times(exitExecution.minus(entryExecution));
  const netPnl = grossPnl.minus(feeOpen).minus(feeClose).minus(values.funding).minus(values.fixedCosts);
  return { entryExecution, exitExecution, notional, feeOpen, feeClose, grossPnl, netPnl };
}

export function computePnl(input: PnlInput): Result<PnlValue> {
  const r = new Reader();
  if (!['spot', 'futures'].includes(input.market)) r.fail('market', 'Выберите рынок.');
  if (!['quantity', 'margin'].includes(input.quantityMode)) r.fail('quantityMode', 'Выберите источник количества.');
  const spot = input.market === 'spot';
  if (!spot && !['long', 'short'].includes(input.side)) r.fail('side', 'Выберите направление.');
  const side = spot ? 'long' : input.side;
  const d = direction(side);
  const entry = r.read('entry', input.entry, { positive: true });
  const exit = r.read('exit', input.exit, { positive: true });
  const leverage = spot ? new Decimal(1) : r.read('leverage', input.leverage, { leverage: true });
  const feeEntry = r.rate('feeEntry', input.feeEntry); const feeExit = r.rate('feeExit', input.feeExit);
  const slipEntry = r.rate('slipEntry', input.slipEntry); const slipExit = r.rate('slipExit', input.slipExit);
  const funding = spot ? new Decimal(0) : r.read('funding', input.funding);
  const fixedCosts = r.read('fixedCosts', input.fixedCosts, { nonnegative: true });
  const inputQuantity = input.quantityMode === 'quantity' ? r.read('quantity', input.quantity, { positive: true }) : null;
  const inputMargin = input.quantityMode === 'margin' ? r.read('margin', input.margin, { positive: true }) : null;
  const error = r.result(); if (error) return error;
  const ef = entry.times(new Decimal(1).plus(d.times(slipEntry)));
  const quantity = inputQuantity ?? inputMargin!.times(leverage).div(ef);
  const values = { side, entry, exit, quantity, feeEntry, feeExit, slipEntry, slipExit, funding, fixedCosts };
  const result = execution(values);
  const initialMargin = result.notional.div(leverage);
  const purchaseCost = result.notional.plus(result.feeOpen);
  const denominator = quantity.times(new Decimal(1).minus(d.times(feeExit)));
  const numerator = result.notional.times(new Decimal(1).plus(d.times(feeEntry))).plus(d.times(funding.plus(fixedCosts)));
  const breakEven = numerator.div(denominator);
  const targetBe = breakEven.gt(0) ? breakEven.div(new Decimal(1).minus(d.times(slipExit))) : null;
  const extremes = [entry, exit, ...(targetBe ? [targetBe] : [])];
  const low = Decimal.minimum(...extremes).times('0.9');
  const high = Decimal.maximum(...extremes).times('1.1');
  const points = Array.from({ length: 41 }, (_, index) => {
    const price = low.plus(high.minus(low).times(index).div(40));
    return { price, pnl: execution({ ...values, exit: price }).netPnl };
  });
  const pnlLow = Decimal.minimum(0, ...points.map((point) => point.pnl));
  const pnlHigh = Decimal.maximum(0, ...points.map((point) => point.pnl));
  const x = (value: DecimalValue) => exact(value.minus(low).div(high.minus(low)).times(100));
  const y = (value: DecimalValue) => pnlHigh.eq(pnlLow) ? '50' : exact(new Decimal(100).minus(value.minus(pnlLow).div(pnlHigh.minus(pnlLow)).times(100)));
  return { ok: true, status: 'ready', value: {
    quantity: exact(quantity), entryExecution: exact(result.entryExecution), exitExecution: exact(result.exitExecution),
    notional: exact(result.notional), initialMargin: exact(initialMargin), purchaseCost: exact(purchaseCost),
    grossPnl: exact(result.grossPnl), feeOpen: exact(result.feeOpen), feeClose: exact(result.feeClose),
    funding: exact(funding), fixedCosts: exact(fixedCosts), netPnl: exact(result.netPnl),
    roi: exact(result.netPnl.div(spot ? purchaseCost : initialMargin).times(100)), roiBasis: spot ? 'purchase' : 'margin',
    breakEvenExecution: breakEven.gt(0) ? exact(breakEven) : null,
    breakEvenTarget: targetBe ? exact(targetBe) : null, breakEvenState: targetBe ? 'positive' : 'no_positive_threshold',
    chart: points.map((point) => ({ price: exact(point.price), pnl: exact(point.pnl), x: x(point.price), y: y(point.pnl) })),
    chartReference: { zeroY: y(new Decimal(0)), entryX: x(entry), exitX: x(exit), breakEvenX: targetBe ? x(targetBe) : null },
  } };
}
