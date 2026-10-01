import { Decimal, exact, Reader } from './decimal';
import type { DcaInput, DcaValue, Result } from './types';

export function computeDca(input: DcaInput): Result<DcaValue> {
  if (!input.rows.length) return { ok: false, status: 'incomplete', errors: { rows: 'Добавьте хотя бы одну покупку.' } };
  if (input.rows.length > 50) return { ok: false, status: 'invalid', errors: { rows: 'Допустимо не более 50 покупок.' } };
  const r = new Reader();
  const rows = input.rows.map((row, index) => {
    const prefix = `rows.${index}`;
    if (!['quantity', 'amount'].includes(row.mode)) r.fail(`${prefix}.mode`, 'Выберите способ ввода покупки.');
    return {
      price: r.read(`${prefix}.price`, row.price, { positive: true }), fee: r.rate(`${prefix}.fee`, row.fee),
      quantity: row.mode === 'quantity' ? r.read(`${prefix}.quantity`, row.quantity, { positive: true }) : null,
      amount: row.mode === 'amount' ? r.read(`${prefix}.amount`, row.amount, { positive: true }) : null,
    };
  });
  const exit = input.exit ? { price: r.read('exit.price', input.exit.price, { positive: true }), fee: r.rate('exit.fee', input.exit.fee) } : null;
  const target = input.targetAverage ? {
    price: r.read('targetAverage.price', input.targetAverage.price, { positive: true }),
    fee: r.rate('targetAverage.fee', input.targetAverage.fee), target: r.read('targetAverage.target', input.targetAverage.target, { positive: true }),
  } : null;
  const error = r.result(); if (error) return error;
  let quantity = new Decimal(0); let purchaseSum = new Decimal(0); let entryFees = new Decimal(0);
  const series = rows.map((row, index) => {
    const q = row.quantity ?? row.amount!.div(row.price);
    // An entered amount is already exact; do not multiply an approximate quotient back into it.
    const amount = row.amount ?? q.times(row.price);
    quantity = quantity.plus(q); purchaseSum = purchaseSum.plus(amount); entryFees = entryFees.plus(amount.times(row.fee));
    return { purchase: index + 1, average: exact(purchaseSum.plus(entryFees).div(quantity)) };
  });
  const costBasis = purchaseSum.plus(entryFees);
  let targetAverage: DcaValue['targetAverage'] = null;
  if (target) {
    const effective = target.price.times(new Decimal(1).plus(target.fee));
    const difference = costBasis.minus(target.target.times(quantity));
    const empty = { quantity: null, amountBeforeFee: null, totalNewCost: null, newQuantity: null, newAverage: null };
    if (difference.isZero()) targetAverage = { ...empty, state: 'achieved', quantity: '0', amountBeforeFee: '0', totalNewCost: '0', newQuantity: exact(quantity), newAverage: exact(costBasis.div(quantity)) };
    else if (difference.lt(0)) targetAverage = { ...empty, state: 'not_reduction' };
    else if (target.target.eq(effective)) targetAverage = { ...empty, state: 'no_finite_quantity' };
    else if (target.target.lt(effective)) targetAverage = { ...empty, state: 'unreachable' };
    else {
      const qAdd = difference.div(target.target.minus(effective));
      const amount = qAdd.times(target.price); const totalNewCost = qAdd.times(effective); const newQuantity = quantity.plus(qAdd);
      targetAverage = { state: 'ready', quantity: exact(qAdd), amountBeforeFee: exact(amount), totalNewCost: exact(totalNewCost),
        newQuantity: exact(newQuantity), newAverage: exact(costBasis.plus(totalNewCost).div(newQuantity)) };
    }
  }
  const valueBeforeExitFee = exit ? quantity.times(exit.price) : null;
  const exitFee = exit ? valueBeforeExitFee!.times(exit.fee) : null;
  return { ok: true, status: 'ready', value: {
    quantity: exact(quantity), purchaseSum: exact(purchaseSum), entryFees: exact(entryFees), costBasis: exact(costBasis),
    averageBare: exact(purchaseSum.div(quantity)), averageCost: exact(costBasis.div(quantity)),
    exit: exit ? { valueBeforeExitFee: exact(valueBeforeExitFee!), exitFee: exact(exitFee!),
      netAtTarget: exact(valueBeforeExitFee!.minus(exitFee!).minus(costBasis)), breakEven: exact(costBasis.div(quantity.times(new Decimal(1).minus(exit.fee)))) } : null,
    targetAverage, series,
  } };
}
