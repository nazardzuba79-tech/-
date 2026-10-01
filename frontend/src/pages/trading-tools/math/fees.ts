import { Decimal, direction, exact, Reader } from './decimal';
import type { FeesInput, FeesValue, Result } from './types';

export function computeFees(input: FeesInput): Result<FeesValue> {
  const r = new Reader();
  if (!['spot', 'futures'].includes(input.market)) r.fail('market', 'Выберите рынок.');
  if (!['quantity', 'notional'].includes(input.inputMode)) r.fail('inputMode', 'Выберите способ ввода номинала.');
  if (!['maker', 'taker'].includes(input.entryRole)) r.fail('entryRole', 'Выберите Maker или Taker.');
  if (input.includeExit && !['maker', 'taker'].includes(input.exitRole)) r.fail('exitRole', 'Выберите Maker или Taker.');
  const maker = r.rate('makerRate', input.makerRate); const taker = r.rate('takerRate', input.takerRate);
  const quantity = input.inputMode === 'quantity' ? r.read('quantity', input.quantity, { positive: true }) : null;
  const entry = quantity ? r.read('entry', input.entry, { positive: true }) : null;
  const exit = quantity && input.includeExit ? r.read('exit', input.exit, { positive: true }) : null;
  const ne = input.inputMode === 'notional' ? r.read('notionalEntry', input.notionalEntry, { positive: true }) : null;
  const nx = input.inputMode === 'notional' && input.includeExit ? r.read('notionalExit', input.notionalExit, { positive: true }) : null;
  const funding = input.market === 'futures' && input.funding ? {
    notional: r.read('funding.notional', input.funding.notional, { positive: true }),
    rate: r.read('funding.rate', input.funding.rate).div(100),
    periods: r.read('funding.periods', input.funding.periods, { integer: true }),
  } : null;
  if (funding && !['long', 'short'].includes(input.side)) r.fail('side', 'Выберите направление финансирования.');
  const error = r.result(); if (error) return error;
  const notionalEntry = ne ?? quantity!.times(entry!);
  const notionalExit = input.includeExit ? (nx ?? quantity!.times(exit!)) : null;
  const feeOpen = notionalEntry.times(input.entryRole === 'maker' ? maker : taker);
  const feeClose = notionalExit ? notionalExit.times(input.exitRole === 'maker' ? maker : taker) : null;
  const feesTotal = feeOpen.plus(feeClose ?? 0);
  const combination = (open: typeof maker, close: typeof maker) => exact(notionalEntry.times(open).plus(notionalExit ? notionalExit.times(close) : 0));
  const fundingCost = funding ? direction(input.side).times(funding.notional).times(funding.rate).times(funding.periods) : null;
  return { ok: true, status: 'ready', value: {
    notionalEntry: exact(notionalEntry), notionalExit: notionalExit ? exact(notionalExit) : null,
    feeOpen: exact(feeOpen), feeClose: feeClose ? exact(feeClose) : null, feesTotal: exact(feesTotal),
    combinations: { MM: combination(maker, maker), MT: combination(maker, taker), TM: combination(taker, maker), TT: combination(taker, taker) },
    fundingCost: fundingCost ? exact(fundingCost) : null, netCost: fundingCost ? exact(feesTotal.plus(fundingCost)) : null,
  } };
}
