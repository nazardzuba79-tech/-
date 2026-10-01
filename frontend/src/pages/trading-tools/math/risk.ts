import { Decimal, direction, exact, Reader } from './decimal';
import { execution } from './execution';
import type { LiquidationInput, LiquidationResult, LiquidationValue, PositionInput, PositionValue, Result, RiskRewardInput, RiskRewardValue } from './types';

export function computePositionSize(input: PositionInput): Result<PositionValue> {
  const r = new Reader();
  if (!['long', 'short'].includes(input.side)) r.fail('side', 'Выберите направление.');
  const d = direction(input.side);
  const capital = r.read('capital', input.capital, { positive: true });
  const risk = r.read('riskPercent', input.riskPercent, { risk: true }).div(100);
  const entry = r.read('entry', input.entry, { positive: true }); const stop = r.read('stop', input.stop, { positive: true });
  const leverage = r.read('leverage', input.leverage, { leverage: true });
  const feeEntry = r.rate('feeEntry', input.feeEntry); const feeStop = r.rate('feeStop', input.feeStop);
  const slipEntry = r.rate('slipEntry', input.slipEntry); const slipStop = r.rate('slipStop', input.slipStop);
  const costs = r.read('fixedCosts', input.fixedCosts, { nonnegative: true });
  const budget = input.budget?.trim() ? r.read('budget', input.budget, { positive: true }) : null;
  const step = input.step?.trim() ? r.read('step', input.step, { positive: true }) : null;
  const error = r.result(); if (error) return error;
  if (!d.times(entry.minus(stop)).gt(0)) return { ok: false, status: 'invalid', errors: { stop: 'Защитный стоп должен быть ниже входа для Long и выше для Short.' } };
  const ef = entry.times(new Decimal(1).plus(d.times(slipEntry)));
  const sf = stop.times(new Decimal(1).minus(d.times(slipStop)));
  const riskBudget = capital.times(risk);
  const lossPerUnit = d.times(ef.minus(sf)).plus(ef.times(feeEntry)).plus(sf.times(feeStop));
  const cashPerUnit = ef.div(leverage).plus(ef.times(feeEntry)).plus(sf.times(feeStop));
  if (!lossPerUnit.gt(0)) return { ok: false, status: 'invalid', errors: { stop: 'Для расчёта нужен положительный убыток на единицу.' } };
  if (riskBudget.lte(costs)) return { ok: false, status: 'invalid', errors: { fixedCosts: 'Резерв расходов должен быть меньше риск-бюджета.' } };
  if (budget && budget.lte(costs)) return { ok: false, status: 'invalid', errors: { budget: 'Бюджет не позволяет положительный объём после расходов.' } };
  const qRisk = riskBudget.minus(costs).div(lossPerUnit);
  // Multiply through by leverage before division. Dividing by an already
  // truncated Ef/L would slightly over-size a repeating margin quotient.
  const cashNumerator = ef.plus(leverage.times(ef.times(feeEntry).plus(sf.times(feeStop))));
  const qBudget = budget ? budget.minus(costs).times(leverage).div(cashNumerator) : null;
  const budgetLimits = Boolean(qBudget && qBudget.lt(qRisk));
  const qRaw = qBudget ? Decimal.minimum(qRisk, qBudget) : qRisk;
  const quantity = step ? qRaw.div(step).integerValue(Decimal.ROUND_FLOOR).times(step) : qRaw;
  const plannedLoss = quantity.times(lossPerUnit).plus(costs);
  const notional = quantity.times(ef);
  const margin = notional.div(leverage);
  const reserved = margin.plus(notional.times(feeEntry)).plus(quantity.times(sf).times(feeStop)).plus(costs);
  if (plannedLoss.gt(riskBudget) || (budget && reserved.gt(budget))) {
    return { ok: false, status: 'invalid', errors: { quantity: 'Не удалось подобрать объём в пределах заданного бюджета.' } };
  }
  return { ok: true, status: 'ready', value: {
    state: quantity.isZero() ? 'no_size' : 'sized', riskBudget: exact(riskBudget), lossPerUnit: exact(lossPerUnit), cashPerUnit: exact(cashPerUnit),
    qRisk: exact(qRisk), qBudget: qBudget ? exact(qBudget) : null, quantity: exact(quantity), notional: exact(notional), margin: exact(margin),
    plannedLoss: exact(plannedLoss), reserved: exact(reserved), actualRisk: exact(plannedLoss.div(capital).times(100)),
    limitingFactor: budgetLimits ? 'budget' : 'risk', theoretical: !step,
    ...(quantity.isZero() ? { message: 'При заданном шаге нет подходящего объёма.' } : {}),
  } };
}

export function computeLiquidation(input: LiquidationInput): LiquidationResult {
  const r = new Reader();
  if (!['long', 'short'].includes(input.side)) r.fail('side', 'Выберите направление.');
  const entry = r.read('entry', input.entry, { positive: true }); const quantity = r.read('quantity', input.quantity, { positive: true });
  const leverage = r.read('leverage', input.leverage, { leverage: true }); const maintenanceRate = r.rate('maintenanceRate', input.maintenanceRate);
  const additional = r.read('additionalMargin', input.additionalMargin, { nonnegative: true });
  const costs = r.read('costs', input.costs, { nonnegative: true });
  const error = r.result(); if (error) return error;
  const d = direction(input.side); const notional = quantity.times(entry); const initial = notional.div(leverage);
  const margin = initial.plus(additional).minus(costs); const maintenance = notional.times(maintenanceRate);
  const buffer = margin.minus(maintenance); const zero = entry.minus(d.times(margin.div(quantity)));
  const liquidation = entry.minus(d.times(buffer.div(quantity)));
  const base: LiquidationValue = {
    entry: exact(entry), quantity: exact(quantity), notional: exact(notional), initialMargin: exact(initial), additionalMargin: exact(additional), costs: exact(costs),
    margin: exact(margin), maintenanceMargin: exact(maintenance), buffer: exact(buffer),
    liquidationPrice: null, zeroMarginPrice: zero.gt(0) ? exact(zero) : null, distancePercent: null,
  };
  if (margin.lte(maintenance)) return { ok: true, status: 'insufficient_margin', value: { ...base,
    message: margin.lte(0) ? 'Введённое обеспечение не положительно.' : 'В этой модели обеспечения недостаточно уже при входе.' } };
  if (liquidation.lte(0)) return { ok: true, status: 'no_positive_threshold', value: { ...base, message: 'В этой модели нет положительного ценового порога.' } };
  return { ok: true, status: 'ready', value: { ...base, liquidationPrice: exact(liquidation), distancePercent: exact(entry.minus(liquidation).abs().div(entry).times(100)) } };
}

export function computeRiskReward(input: RiskRewardInput): Result<RiskRewardValue> {
  const r = new Reader();
  if (!['long', 'short'].includes(input.side)) r.fail('side', 'Выберите направление.');
  const entry = r.read('entry', input.entry, { positive: true }); const stop = r.read('stop', input.stop, { positive: true });
  const target = r.read('target', input.target, { positive: true }); const quantity = r.read('quantity', input.quantity, { positive: true });
  const feeEntry = r.rate('feeEntry', input.feeEntry); const feeStop = r.rate('feeStop', input.feeStop); const feeTarget = r.rate('feeTarget', input.feeTarget);
  const slipEntry = r.rate('slipEntry', input.slipEntry); const slipStop = r.rate('slipStop', input.slipStop); const slipTarget = r.rate('slipTarget', input.slipTarget);
  const costs = r.read('fixedCosts', input.fixedCosts, { nonnegative: true });
  const error = r.result(); if (error) return error;
  const d = direction(input.side);
  if (!d.times(entry.minus(stop)).gt(0)) r.fail('stop', 'Стоп должен находиться с защитной стороны входа.');
  if (!d.times(target.minus(entry)).gt(0)) r.fail('target', 'Цель должна находиться с прибыльной стороны входа.');
  const levelsError = r.result(); if (levelsError) return levelsError;
  const common = { side: input.side, entry, quantity, feeEntry, slipEntry, funding: new Decimal(0), fixedCosts: costs };
  const atStop = execution({ ...common, exit: stop, feeExit: feeStop, slipExit: slipStop });
  const atTarget = execution({ ...common, exit: target, feeExit: feeTarget, slipExit: slipTarget });
  const risk = atStop.netPnl.negated(); const reward = atTarget.netPnl;
  if (!risk.gt(0)) return { ok: false, status: 'invalid', errors: { stop: 'Сценарий не соответствует защитному стопу с положительным риском.' } };
  return { ok: true, status: 'ready', value: {
    state: reward.gt(0) ? 'profitable' : 'target_not_profitable', risk: exact(risk), reward: exact(reward),
    ratio: reward.gt(0) ? exact(reward.div(risk)) : null,
    breakEvenWinRate: reward.gt(0) ? exact(risk.div(risk.plus(reward)).times(100)) : null,
    stopPnl: exact(atStop.netPnl), targetPnl: exact(atTarget.netPnl), entryExecution: exact(atStop.entryExecution),
    stopExecution: exact(atStop.exitExecution), targetExecution: exact(atTarget.exitExecution),
  } };
}
