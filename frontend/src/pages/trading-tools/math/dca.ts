import { Decimal, exact, Reader } from './decimal';
import type { DecimalValue } from './decimal';
import type { DcaInput, DcaValue, Result } from './types';

type Ratio = { numerator: DecimalValue; denominator: DecimalValue };
const addRatio = (a: Ratio, b: Ratio): Ratio => ({
  numerator: a.numerator.times(b.denominator).plus(b.numerator.times(a.denominator)),
  denominator: a.denominator.times(b.denominator),
});
const divideRatio = (value: Ratio): DecimalValue => value.numerator.div(value.denominator);
const average = (cost: DecimalValue, quantity: Ratio): DecimalValue => cost.times(quantity.denominator).div(quantity.numerator);

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
  let quantity: Ratio = { numerator: new Decimal(0), denominator: new Decimal(1) };
  let purchaseSum = new Decimal(0); let entryFees = new Decimal(0);
  const series = rows.map((row, index) => {
    // Keep amount/price as a ratio: a rounded 1/3 must not create an artificial
    // target shortfall or loss when selling the holding at its exact cost.
    const q: Ratio = { numerator: row.quantity ?? row.amount!, denominator: row.quantity ? new Decimal(1) : row.price };
    const amount = row.amount ?? row.quantity!.times(row.price);
    quantity = addRatio(quantity, q); purchaseSum = purchaseSum.plus(amount); entryFees = entryFees.plus(amount.times(row.fee));
    return { purchase: index + 1, average: exact(average(purchaseSum.plus(entryFees), quantity)) };
  });
  const costBasis = purchaseSum.plus(entryFees);
  let targetAverage: DcaValue['targetAverage'] = null;
  if (target) {
    const effective = target.price.times(new Decimal(1).plus(target.fee));
    const difference = costBasis.times(quantity.denominator).minus(target.target.times(quantity.numerator));
    const empty = { quantity: null, amountBeforeFee: null, totalNewCost: null, newQuantity: null, newAverage: null };
    if (difference.isZero()) targetAverage = { ...empty, state: 'achieved', quantity: '0', amountBeforeFee: '0', totalNewCost: '0', newQuantity: exact(divideRatio(quantity)), newAverage: exact(average(costBasis, quantity)) };
    else if (difference.lt(0)) targetAverage = { ...empty, state: 'not_reduction' };
    else if (target.target.eq(effective)) targetAverage = { ...empty, state: 'no_finite_quantity' };
    else if (target.target.lt(effective)) targetAverage = { ...empty, state: 'unreachable' };
    else {
      const qAdd: Ratio = { numerator: difference, denominator: quantity.denominator.times(target.target.minus(effective)) };
      const newQuantity = addRatio(quantity, qAdd);
      const newCostNumerator = costBasis.times(qAdd.denominator).plus(qAdd.numerator.times(effective));
      targetAverage = { state: 'ready', quantity: exact(divideRatio(qAdd)),
        amountBeforeFee: exact(qAdd.numerator.times(target.price).div(qAdd.denominator)),
        totalNewCost: exact(qAdd.numerator.times(effective).div(qAdd.denominator)),
        newQuantity: exact(divideRatio(newQuantity)),
        newAverage: exact(newCostNumerator.times(newQuantity.denominator).div(qAdd.denominator.times(newQuantity.numerator))) };
    }
  }
  const exitValueNumerator = exit ? quantity.numerator.times(exit.price) : null;
  return { ok: true, status: 'ready', value: {
    quantity: exact(divideRatio(quantity)), purchaseSum: exact(purchaseSum), entryFees: exact(entryFees), costBasis: exact(costBasis),
    averageBare: exact(average(purchaseSum, quantity)), averageCost: exact(average(costBasis, quantity)),
    exit: exit ? { valueBeforeExitFee: exact(exitValueNumerator!.div(quantity.denominator)),
      exitFee: exact(exitValueNumerator!.times(exit.fee).div(quantity.denominator)),
      netAtTarget: exact(exitValueNumerator!.times(new Decimal(1).minus(exit.fee)).minus(costBasis.times(quantity.denominator)).div(quantity.denominator)),
      breakEven: exact(costBasis.times(quantity.denominator).div(quantity.numerator.times(new Decimal(1).minus(exit.fee)))) } : null,
    targetAverage, series,
  } };
}
