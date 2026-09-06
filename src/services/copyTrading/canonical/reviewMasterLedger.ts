import type { CashflowReviewState } from './reviewEconomicsTypes';
import type { SyntheticTrade } from './types';
import { REVIEW_ECONOMICS_CONFIG as C, isReviewHoliday } from './reviewEconomicsConfig';

const DAY_MS = 86_400_000;
const MONEY_SCALE = 10_000;
const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const money = (value: number) => Math.round(value * MONEY_SCALE) / MONEY_SCALE;
const dayAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

class Random {
  constructor(public state: number) {}
  next() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 4294967296; }
  between(min: number, max: number) { return min + this.next() * (max - min); }
  integer(min: number, max: number) { return Math.floor(this.between(min, max + 1)); }
}
interface DayPlan { date: string; return: number; count: number; losses: number; pnl?: number }

/** Separate log-return constraints for consecutive segments, never separate
 * 7/30/90/ALL pictures. Negative sessions stay negative; leave contributes 1x. */
function segmentReturns(dates: string[], factor: number, rng: Random): number[] {
  let regime = 1, remaining = 0;
  const active = dates.map((date, index) => isReviewHoliday(date) ? -1 : index).filter(i => i >= 0);
  const losses = new Set<number>();
  // Irregular signed sessions, including a loss in the last seven days.
  for (let cursor = active.length <= 7 ? 2 : rng.integer(5, 12); cursor < active.length; cursor += rng.integer(9, 19)) losses.add(active[cursor]);
  const negativeLogs = dates.map((_, i) => losses.has(i) ? -rng.between(0.0015, 0.009) : 0);
  const weights = dates.map((date, i) => {
    if (isReviewHoliday(date) || losses.has(i)) return 0;
    if (remaining-- <= 0) { regime = rng.between(0.45, 1.7); remaining = rng.integer(6, 22); }
    return regime * rng.between(0.45, 1.55);
  });
  const logBudget = Math.log(factor) - negativeLogs.reduce((s, v) => s + v, 0);
  const weightSum = weights.reduce((s, v) => s + v, 0);
  return weights.map((weight, i) => Math.expm1(negativeLogs[i] + (weight ? logBudget * weight / weightSum : 0)));
}

/** Count/outcome calibration changes the execution plan, not displayed KPIs. */
function countPlan(plans: DayPlan[], total: number, rng: Random) {
  const active = plans.filter(plan => plan.return !== 0);
  for (const plan of active) plan.count = rng.integer(5, 13);
  let delta = total - active.reduce((sum, p) => sum + p.count, 0);
  const order = [...active]; // Random starting cursor avoids end balancing.
  let cursor = rng.integer(0, order.length - 1);
  while (delta !== 0) {
    const plan = order[cursor++ % order.length];
    if (delta > 0 && plan.count < 16) { plan.count++; delta--; }
    else if (delta < 0 && plan.count > 4) { plan.count--; delta++; }
  }
  const desiredLosses = Math.round(total * (1 - C.winRate));
  for (const plan of active) plan.losses = plan.return < 0 ? 1 : 0;
  let lossDelta = desiredLosses - active.reduce((sum, p) => sum + p.losses, 0);
  if (lossDelta < 0) throw new Error('Negative-day count exceeds the configured trade loss budget');
  const candidates = active.filter(plan => plan.losses === 0).map(plan => ({ plan, key: rng.next() })).sort((a, b) => a.key - b.key);
  for (const { plan } of candidates) { if (lossDelta === 0) break; plan.losses = 1; lossDelta--; }
  if (lossDelta !== 0) throw new Error('Insufficient sessions for the outcome plan');
}

/** Round a vector in 0.0001 USDT units and distribute at most one unit per
 * session. No last-day/final-trade profit plug or curve modification. */
function roundedAllocation(values: number[], total: number): number[] {
  const units = values.map(value => Math.round(value * MONEY_SCALE));
  let remainder = Math.round(total * MONEY_SCALE) - units.reduce((sum, value) => sum + value, 0);
  const order = values.map((value, index) => ({ index, residual: value * MONEY_SCALE - units[index] }))
    .filter(({ index }) => values[index] !== 0)
    .sort((a, b) => remainder >= 0 ? b.residual - a.residual : a.residual - b.residual);
  for (let cursor = 0; remainder !== 0; cursor++) {
    const direction = Math.sign(remainder);
    units[order[cursor % order.length].index] += direction; remainder -= direction;
  }
  return units.map(value => value / MONEY_SCALE);
}

function makeTrade(rng: Random, id: number, date: string, desiredNet: number,
  capitalAtRisk: number, slot: number, count: number): SyntheticTrade {
  const asset = C.assets[rng.integer(0, C.assets.length - 1)];
  const side = rng.next() < 0.49 ? 'SHORT' : 'LONG';
  const direction = side === 'LONG' ? 1 : -1;
  const leverage = rng.integer(C.leverage.min, C.leverage.max);
  const entryPrice = round(asset.referencePrice * rng.between(0.82, 1.23), 10);
  // Slots do not overlap: even the sum of concurrent margins never exceeds
  // deployed account capital. Free cash is NOT removed from ROI denominator.
  const slotMinutes = Math.floor(1380 / count);
  const holdingTimeMinutes = rng.integer(Math.max(8, Math.floor(slotMinutes * 0.25)), Math.max(9, slotMinutes - 4));
  const openMinute = 20 + slot * slotMinutes + rng.integer(0, 2);
  const openedAt = new Date(Date.parse(`${date}T00:00:00Z`) + openMinute * 60_000).toISOString();
  const closedAt = new Date(Date.parse(openedAt) + holdingTimeMinutes * 60_000).toISOString();
  const desiredNotional = capitalAtRisk * rng.between(0.18, 0.72) * leverage;
  const quantity = round(desiredNotional / entryPrice, 8);
  const notional = entryPrice * quantity;
  const funding = money(notional * C.fundingRatePerEightHours * holdingTimeMinutes / 480);
  // Solve price, then independently remeasure all financial fields using the
  // emitted rounded execution values. Never edit netPnl without changing price.
  let exitPrice = round((notional * (direction + C.tradingFeeRate) + desiredNet + funding)
    / (quantity * (direction - C.tradingFeeRate)), 12);
  let grossPnl = 0, fees = 0, netPnl = 0;
  for (let iteration = 0; iteration < 12; iteration++) {
    grossPnl = money(direction * (exitPrice - entryPrice) * quantity);
    fees = money((entryPrice + exitPrice) * quantity * C.tradingFeeRate);
    netPnl = money(grossPnl - fees - funding);
    if (Math.abs(netPnl - desiredNet) < 0.000049) break;
    exitPrice = round(entryPrice + direction * money(desiredNet + fees + funding) / quantity, 12);
  }
  if (exitPrice <= 0 || Math.abs(netPnl - desiredNet) >= 0.000049) throw new Error(`Execution rounding could not reconcile planned PnL: ${id} ${asset.symbol} wanted=${desiredNet} actual=${netPnl} quantity=${quantity}`);
  const margin = notional / leverage;
  return { id: `REV7-${String(id).padStart(7, '0')}`, symbol: asset.symbol, side,
    entryPrice, exitPrice, quantity, leverage, openedAt, closedAt, grossPnl, fees, funding, netPnl,
    returnPct: round(netPnl / margin * 100, 8), holdingTimeMinutes,
    // R is normalized to a modeled 1% of actual initial position margin.
    riskR: round(netPnl / (margin * 0.01), 8), result: netPnl > 0 ? 'WIN' : 'LOSS' };
}

function appendPlannedDay(state: CashflowReviewState, plan: DayPlan, operatingBase: number, rng: Random) {
  const previous = state.cashflow.masterDays[state.cashflow.masterDays.length - 1];
  const opening = previous?.closingEquity ?? operatingBase;
  const capitalAtRisk = opening;
  const pnl = plan.pnl ?? money(capitalAtRisk * plan.return);
  const lossBudget = plan.losses ? money(pnl < 0 ? Math.abs(pnl) * 1.25 : capitalAtRisk * rng.between(0.0008, 0.004)) : 0;
  const winners = plan.count - plan.losses;
  const weights = Array.from({ length: winners }, () => rng.between(0.5, 1.5));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const winPnl = winners ? roundedAllocation(weights.map(w => (pnl + lossBudget) * w / weightSum), money(pnl + lossBudget)) : [];
  const outcomes = [...winPnl, ...(plan.losses ? [-lossBudget] : [])]
    .map(value => ({ value, key: rng.next() })).sort((a, b) => a.key - b.key).map(({ value }) => value);
  const trades = outcomes.map((value, slot) => makeTrade(rng, state.trades.length + slot + 1,
    plan.date, value, capitalAtRisk, slot, plan.count));
  const realizedPnl = money(trades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const withdrawal = plan.count ? money(Math.max(0, opening + realizedPnl - operatingBase)) : 0;
  const closing = money(opening + realizedPnl - withdrawal);
  if (withdrawal > 0) state.cashflow.masterCashFlows.push({ id: `MCF-W-${plan.date}`, date: plan.date,
    timing: 'AFTER_TRADING', type: 'WITHDRAWAL', amount: withdrawal });
  const dailyReturn = capitalAtRisk ? realizedPnl / capitalAtRisk : 0;
  const index = state.equityHistory[state.equityHistory.length - 1].equity * (1 + dailyReturn);
  const peak = Math.max(index, ...state.equityHistory.map(point => point.equity));
  state.trades.push(...trades);
  state.dailyResults.push({ date: plan.date, startEquity: opening, endEquity: closing,
    realizedPnl, unrealizedPnl: 0, fees: money(trades.reduce((sum, trade) => sum + trade.fees, 0)),
    funding: money(trades.reduce((sum, trade) => sum + trade.funding, 0)),
    numberOfTrades: trades.length, wins: trades.filter(t => t.result === 'WIN').length,
    losses: trades.filter(t => t.result === 'LOSS').length, dailyReturn, drawdown: (index - peak) / peak });
  state.equityHistory.push({ date: plan.date, equity: index });
  state.cashflow.masterDays.push({ date: plan.date, openingEquity: opening, capitalAtRisk,
    tradingPnl: realizedPnl, deposits: 0, withdrawals: withdrawal, closingEquity: closing,
    cumulativeTradingPnl: money((previous?.cumulativeTradingPnl ?? 0) + realizedPnl),
    cumulativeDeposits: operatingBase,
    cumulativeWithdrawals: money((previous?.cumulativeWithdrawals ?? 0) + withdrawal) });
  state.simulatedAt = `${plan.date}T23:59:59.999Z`;
  state.rngState = rng.state;
}

/** Pinned review bootstrap. Equity history is a unitized TWR index starting at
 * 100, NOT private account balance. Account values live only in cashflow. */
export function createCashflowMasterState(): CashflowReviewState {
  const rng = new Random(C.seed);
  const dates = Array.from({ length: 380 }, (_, i) => dayAfter(C.inception, i + 1));
  const boundaries = [0, 290, 350, 373, 380];
  const factors = [C.factors.ALL / C.factors['90D'], C.factors['90D'] / C.factors['30D'],
    C.factors['30D'] / C.factors['7D'], C.factors['7D']];
  const returns = factors.flatMap((factor, i) => segmentReturns(dates.slice(boundaries[i], boundaries[i + 1]), factor, rng));
  const plans: DayPlan[] = dates.map((date, i) => ({ date, return: returns[i], count: 0, losses: 0 }));
  countPlan(plans.slice(0, 290), C.initialTrades - C.recentTrades, rng);
  countPlan(plans.slice(290), C.recentTrades, rng);
  // Solve the operating account scale from its actual cash-flow rule. A loss
  // reduces tomorrow's capital until earned profit recovers it; no top-up.
  let normalizedAccount = 1;
  const normalizedPnl = plans.map(plan => {
    const profit = normalizedAccount * plan.return;
    normalizedAccount = Math.min(1, normalizedAccount + profit);
    return profit;
  });
  const operatingBase = money(C.masterPnl / normalizedPnl.reduce((sum, pnl) => sum + pnl, 0));
  const budgets = roundedAllocation(normalizedPnl.map(pnl => pnl * operatingBase), C.masterPnl);
  const state: CashflowReviewState = {
    version: 7, seed: C.seed, rngState: rng.state, mode: 'REAL_TIME', initialEquityDate: C.inception,
    simulatedAt: `${C.inception}T23:59:59.999Z`, trades: [], dailyResults: [], followers: [], aumHistory: [],
    equityHistory: [{ date: C.inception, equity: 100 }],
    cashflow: {
      policy: { methodology: 'DAILY_TWR', performanceFeeRate: C.performanceFeeRate,
        feeCrystallization: C.feeCrystallization, copyMinimumPolicyEffectiveDate: C.copyMinimumPolicyEffectiveDate,
        currentCopyMinimum: C.currentCopyMinimum, holidays: C.holidays.map(pause => ({ ...pause })) },
      // Inception deposit precedes the first trading day and supplies its opening equity.
      masterCashFlows: [{ id: 'MCF-INITIAL', date: C.inception, timing: 'BEFORE_TRADING', type: 'DEPOSIT', amount: operatingBase }],
      masterDays: [], followerAllocationEvents: [], copiedTrades: [], performanceFeeEvents: [],
    },
  };
  plans.forEach((plan, i) => appendPlannedDay(state, { ...plan, pnl: budgets[i] }, operatingBase, rng));
  return state;
}

/** Append-only future review simulation, never a recalibration of public
 * bootstrap targets. Serialized state + rngState reproduces split/batch runs. */
export function advanceCashflowMasterState(original: CashflowReviewState, days: number): CashflowReviewState {
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Advance must be 0–365 whole days');
  const state: CashflowReviewState = JSON.parse(JSON.stringify(original));
  if (days === 0) return state;
  const rng = new Random(state.rngState);
  const base = state.cashflow.masterCashFlows.find(flow => flow.id === 'MCF-INITIAL')!.amount;
  for (let day = 0; day < days; day++) {
    const date = dayAfter(state.simulatedAt.slice(0, 10), 1);
    const quiet = isReviewHoliday(date) || rng.next() < 0.035;
    const negative = !quiet && rng.next() < 0.08;
    const dailyReturn = quiet ? 0 : negative ? -rng.between(0.001, 0.008) : rng.between(0.003, 0.035);
    const count = quiet ? 0 : rng.integer(5, 13);
    const currentLosses = state.trades.filter(trade => trade.result === 'LOSS').length;
    const lossDue = count > 0 && currentLosses < Math.round((state.trades.length + count) * (1 - C.winRate));
    appendPlannedDay(state, { date, return: dailyReturn, count, losses: negative || lossDue ? 1 : 0 }, base, rng);
  }
  state.mode = 'FAST_FORWARD';
  return state;
}
