import type { CashflowReviewState } from './reviewEconomicsTypes';
import type { SyntheticTrade } from './types';
import { isReviewHoliday } from './reviewEconomicsConfig';
import { REVIEW_PERFORMANCE_V8_CONFIG as C } from './reviewPerformanceV8Config';

const DAY_MS = 86_400_000;
const MONEY_SCALE = 10_000;
const money = (value: number) => Math.round(value * MONEY_SCALE) / MONEY_SCALE;
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekStart = (date: string) => addDays(date, -weekday(date));
const dateSeed = (date: string, salt = 0) => (C.seed ^ (Date.parse(`${date}T00:00:00Z`) / DAY_MS) ^ salt) >>> 0;

class Random {
  constructor(public state: number) {}
  next() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 4294967296; }
  between(min: number, max: number) { return min + this.next() * (max - min); }
  integer(min: number, max: number) { return Math.floor(this.between(min, max + 1)); }
}
interface DayPlan { date: string; return: number; count: number; losses: number; pnl?: number }
interface WeightedDay { date: string; weight: number; fixed: number | null }

/** Hash-mixed dates keep adjacent weeks irregular without mutable global RNG. */
function randomFor(date: string, salt = 0) {
  let seed = dateSeed(date, salt);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  return new Random((seed ^ (seed >>> 16)) >>> 0);
}

// Vary the planned session opportunity ceiling so bounded calibration does not
// manufacture rows of identically tall bars. This is generation, not UI clipping.
const dailyCeiling = (date: string) => randomFor(date, 0xe473).between(0.198, C.maximumPlannedDailyReturn);

/** Water filling preserves the selected weekly/daily relative weights while
 * meeting a whole-segment budget. Saturated days remain genuine <=21.8%
 * planned returns. No residual is ever assigned to a terminal day. */
function allocateBounded(weights: number[], ceilings: number[], total: number): number[] {
  if (total < -1e-12 || total > ceilings.reduce((sum, value) => sum + value, 0) + 1e-10) {
    throw new Error(`Infeasible simple-return budget: ${total}`);
  }
  let low = 0, high = 1;
  const sumAt = (scale: number) => weights.reduce((sum, weight, i) => sum + Math.min(ceilings[i], weight * scale), 0);
  while (sumAt(high) + 1e-12 < total) high *= 2;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (sumAt(middle) < total) low = middle; else high = middle;
  }
  return weights.map((weight, i) => Math.min(ceilings[i], weight * (low + high) / 2));
}

/** Exactly thirteen negative sessions imply exactly thirteen losing trades.
 * Two short losing weeks use five sessions, not seven forced losing trades.
 * The other negative sessions are dispersed over the full baseline. */
const LOSING_WEEKS = new Set(['2025-10-12', '2026-02-08']);
// Rare losses are material (18–30% of operating capital), not cosmetic red
// pixels. High win frequency therefore does NOT imply low tail risk. The two
// deliberately losing weeks still sum to -15%, without outsized >22% gains.
const LOSING_WEEK_DAYS = [0.195, -0.18, 0, -0.185, 0.20, -0.18, 0];
const NEGATIVE_DAYS: Record<string, number> = {
  '2025-09-11': -0.235,
  '2025-11-19': -0.28,
  '2026-03-18': -0.255,
  '2026-05-05': -0.30,
  '2026-07-15': -0.26,
  '2026-08-20': -0.23,
  '2026-09-01': -0.085,
};

function baselineWeightedDays(dates: string[]): WeightedDay[] {
  const weeks = new Map<string, { target: number; quietDay: number }>();
  return dates.map(date => {
    const start = weekStart(date);
    if (isReviewHoliday(date)) return { date, weight: 0, fixed: 0 };
    if (LOSING_WEEKS.has(start)) return { date, weight: 0, fixed: LOSING_WEEK_DAYS[weekday(date)] };
    if (NEGATIVE_DAYS[date] !== undefined) return { date, weight: 0, fixed: NEGATIVE_DAYS[date] };
    let week = weeks.get(start);
    if (!week) {
      const rng = randomFor(start, 0x38a71);
      const regime = rng.next();
      const target = regime < 0.34 ? rng.between(0.94, 1.18)
        : regime < 0.80 ? rng.between(0.55, 0.85)
          : regime < 0.95 ? rng.between(0.28, 0.54) : rng.between(0.07, 0.23);
      // The exact final two weeks need all their non-negative sessions.
      const quietDay = regime > 0.80 && start < '2026-08-23' ? rng.integer(0, 6) : -1;
      week = { target, quietDay }; weeks.set(start, week);
    }
    if (weekday(date) === week.quietDay) return { date, weight: 0, fixed: 0 };
    return { date, weight: week.target * randomFor(date, 0x8734).between(0.55, 1.45), fixed: null };
  });
}

/** Nested anchors constrain consecutive slices of ONE lifetime history.
 * Calibration acts on weekly regimes first, then genuine daily returns. */
function calibrateSegment(days: WeightedDay[], target: number): number[] {
  const groups = new Map<string, number[]>();
  days.forEach((day, index) => {
    const key = weekStart(day.date);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const groupsWithFreeDays = [...groups.values()].filter(indices => indices.some(i => days[i].fixed === null));
  const fixedTotal = days.reduce((sum, day) => sum + (day.fixed ?? 0), 0);
  const weights = groupsWithFreeDays.map(indices => indices.reduce((sum, i) => sum + days[i].weight, 0));
  const ceilings = groupsWithFreeDays.map(indices => {
    const free = indices.filter(i => days[i].fixed === null);
    const fixed = indices.reduce((sum, i) => sum + (days[i].fixed ?? 0), 0);
    return Math.min(free.reduce((sum, i) => sum + dailyCeiling(days[i].date), 0), C.maximumWeeklyReturn * indices.length / 7 - fixed);
  });
  const weeklyBudgets = allocateBounded(weights, ceilings, target - fixedTotal);
  const result = days.map(day => day.fixed ?? 0);
  groupsWithFreeDays.forEach((indices, group) => {
    const free = indices.filter(i => days[i].fixed === null);
    const values = allocateBounded(free.map(i => days[i].weight), free.map(i => dailyCeiling(days[i].date)), weeklyBudgets[group]);
    free.forEach((index, i) => { result[index] = values[i]; });
  });
  return result;
}

function assignBaselineCounts(plans: DayPlan[]) {
  for (const plan of plans) { plan.count = plan.return === 0 ? 0 : 1; plan.losses = plan.return < 0 ? 1 : 0; }
  let remaining = C.initialTrades - plans.reduce((sum, plan) => sum + plan.count, 0);
  const weekCounts = new Map<string, number>();
  for (const plan of plans) weekCounts.set(weekStart(plan.date), (weekCounts.get(weekStart(plan.date)) ?? 0) + plan.count);
  const candidates = plans.filter(plan => plan.return > 0)
    .map(plan => ({ plan, score: randomFor(plan.date, 0x28435).next() / Math.sqrt(plan.return) }))
    .sort((a, b) => a.score - b.score);
  for (let pass = 0; remaining > 0; pass++) {
    if (pass > 2) throw new Error('Insufficient baseline execution slots');
    for (const { plan } of candidates) {
      if (!remaining) break;
      const start = weekStart(plan.date), current = weekCounts.get(start)!;
      if (LOSING_WEEKS.has(start) || current >= 12 || plan.count >= 3) continue;
      plan.count++; weekCounts.set(start, current + 1); remaining--;
    }
  }
  if (plans.reduce((sum, plan) => sum + plan.losses, 0) !== C.losingTrades) throw new Error('Invalid v8 loss plan');
}

function baselinePlans(): DayPlan[] {
  const dates = Array.from({ length: 380 }, (_, index) => addDays(C.inception, index + 1));
  const weighted = baselineWeightedDays(dates);
  const boundaries = [0, 290, 350, 366, 373, 380];
  const totals = [C.returns.ALL - C.returns['90D'], C.returns['90D'] - C.returns['30D'],
    C.returns['30D'] - C.returns.previous7D - C.returns['7D'], C.returns.previous7D, C.returns['7D']];
  const returns = totals.flatMap((total, i) => calibrateSegment(weighted.slice(boundaries[i], boundaries[i + 1]), total));
  const plans = dates.map((date, i) => ({ date, return: returns[i], count: 0, losses: 0 }));
  assignBaselineCounts(plans);
  return plans;
}

/** Financial rounding allocates 0.0001-USDT units by fractional remainder,
 * spread across the entire history. It never edits a curve or a final bucket. */
function roundedAllocation(values: number[], total: number): number[] {
  const units = values.map(value => Math.round(value * MONEY_SCALE));
  let remaining = Math.round(total * MONEY_SCALE) - units.reduce((sum, value) => sum + value, 0);
  const order = values.map((value, index) => ({ index, residual: value * MONEY_SCALE - units[index] }))
    .filter(({ index }) => values[index] !== 0)
    .sort((a, b) => remaining >= 0 ? b.residual - a.residual : a.residual - b.residual);
  if (!order.length && remaining) throw new Error('Cannot allocate nonzero PnL to inactive days');
  for (let cursor = 0; remaining !== 0; cursor++) {
    const direction = Math.sign(remaining); units[order[cursor % order.length].index] += direction; remaining -= direction;
  }
  return units.map(value => value / MONEY_SCALE);
}

function retentionGrowth(date: string) {
  return randomFor(weekStart(date), 0x98352).between(C.weeklyRetentionGrowth.min, C.weeklyRetentionGrowth.max);
}

/** The target is stable inside the week. Actual available opening equity is an
 * additional hard bound after losses; no invisible deposit restores a deficit.
 * Profit cash sits idle until Saturday. Retained growth is <=0.45% per week. */
function settleWeek(date: string, accountBeforeFlow: number, target: number, weekPnl: number) {
  if (weekday(date) !== 6 || isReviewHoliday(date)) return { nextTarget: target, withdrawal: 0, retained: 0 };
  const retained = Math.min(Math.max(0, accountBeforeFlow - target), Math.max(0, weekPnl) * 0.02, target * retentionGrowth(date));
  const nextTarget = target + retained;
  return { nextTarget, withdrawal: Math.max(0, accountBeforeFlow - nextTarget), retained };
}

function unitCapitalPath(plans: DayPlan[]) {
  let account = 1, target = 1, weekPnl = 0;
  return plans.map(plan => {
    if (weekday(plan.date) === 0) weekPnl = 0;
    const pnl = Math.min(target, account) * plan.return;
    weekPnl += pnl;
    const settlement = settleWeek(plan.date, account + pnl, target, weekPnl);
    account += pnl - settlement.withdrawal;
    target = settlement.nextTarget;
    return pnl;
  });
}

/** Rounded prices, quantity, both fee legs and funding produce every net PnL.
 * Sequential same-UTC-day slots bound concurrent margin. A large day increases
 * required notional rather than requiring implausibly huge underlying moves. */
function makeTrade(rng: Random, id: number, plan: DayPlan, desiredNet: number, capital: number, slot: number): SyntheticTrade {
  const asset = C.assets[rng.integer(0, C.assets.length - 1)];
  const side = rng.next() < 0.49 ? 'SHORT' : 'LONG';
  const direction = side === 'LONG' ? 1 : -1;
  const minimumLeverage = Math.max(2, Math.ceil(Math.abs(desiredNet) / capital / 0.72 / 0.065));
  const leverage = rng.integer(minimumLeverage, 8);
  const entryPrice = round(asset.referencePrice * rng.between(0.82, 1.23), 10);
  const slotMinutes = Math.floor(1380 / plan.count);
  const holdingTimeMinutes = rng.integer(Math.max(8, Math.floor(slotMinutes * 0.25)), slotMinutes - 4);
  const openMinute = 20 + slot * slotMinutes + rng.integer(0, 2);
  const openedAt = new Date(Date.parse(`${plan.date}T00:00:00Z`) + openMinute * 60_000).toISOString();
  const closedAt = new Date(Date.parse(openedAt) + holdingTimeMinutes * 60_000).toISOString();
  const notionalTarget = Math.max(capital * rng.between(0.42, 0.72) * leverage, Math.abs(desiredNet) / 0.065);
  const quantity = round(notionalTarget / entryPrice, 8);
  const notional = entryPrice * quantity;
  const funding = money(notional * C.fundingRatePerEightHours * holdingTimeMinutes / 480);
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
  if (minimumLeverage > 8 || exitPrice <= 0 || Math.abs(netPnl - desiredNet) >= 0.000049) throw new Error(`v8 execution cannot reconcile ${id}`);
  const margin = notional / leverage;
  return { id: `REV8-${String(id).padStart(7, '0')}`, symbol: asset.symbol, side, entryPrice, exitPrice,
    quantity, leverage, openedAt, closedAt, grossPnl, fees, funding, netPnl,
    returnPct: round(netPnl / margin * 100, 8), holdingTimeMinutes,
    riskR: round(netPnl / (margin * 0.01), 8), result: netPnl > 0 ? 'WIN' : 'LOSS' };
}

function appendDay(state: CashflowReviewState, plan: DayPlan, initialCapital: number) {
  const previous = state.cashflow.masterDays[state.cashflow.masterDays.length - 1];
  const opening = previous?.closingEquity ?? initialCapital;
  const target = previous?.nextOperatingCapitalTarget ?? initialCapital;
  const capital = Math.min(opening, target);
  const plannedPnl = plan.pnl ?? money(capital * plan.return);
  const rng = randomFor(plan.date, 0x72b31);
  const weights = Array.from({ length: plan.count }, () => rng.between(0.55, 1.45));
  const sumWeights = weights.reduce((sum, value) => sum + value, 0);
  const tradePnl = plan.count ? roundedAllocation(weights.map(value => value / sumWeights * plannedPnl), plannedPnl) : [];
  const trades = tradePnl.map((pnl, slot) => makeTrade(rng, state.trades.length + slot + 1, plan, pnl, capital, slot));
  const pnl = money(trades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const weekPnl = state.cashflow.masterDays.filter(day => day.date >= weekStart(plan.date)).reduce((sum, day) => sum + day.tradingPnl, pnl);
  const settlement = settleWeek(plan.date, money(opening + pnl), target, weekPnl);
  const nextTarget = money(settlement.nextTarget);
  const withdrawal = money(settlement.withdrawal);
  const closing = money(opening + pnl - withdrawal);
  if (withdrawal > 0) state.cashflow.masterCashFlows.push({ id: `MCF8-W-${plan.date}`, date: plan.date,
    timing: 'AFTER_TRADING', type: 'WITHDRAWAL', amount: withdrawal });
  const dailyReturn = pnl / capital;
  const index = state.equityHistory[state.equityHistory.length - 1].equity + dailyReturn * 100;
  const peak = Math.max(index, ...state.equityHistory.map(point => point.equity));
  state.trades.push(...trades);
  state.dailyResults.push({ date: plan.date, startEquity: opening, endEquity: closing,
    realizedPnl: pnl, unrealizedPnl: 0, fees: money(trades.reduce((sum, trade) => sum + trade.fees, 0)),
    funding: money(trades.reduce((sum, trade) => sum + trade.funding, 0)), numberOfTrades: trades.length,
    wins: trades.filter(trade => trade.netPnl > 0).length, losses: trades.filter(trade => trade.netPnl < 0).length,
    dailyReturn, drawdown: (index - peak) / peak });
  state.equityHistory.push({ date: plan.date, equity: index });
  state.cashflow.masterDays.push({ date: plan.date, operatingCapitalTarget: target,
    nextOperatingCapitalTarget: nextTarget, retainedProfit: money(settlement.retained), openingEquity: opening,
    capitalAtRisk: capital, tradingPnl: pnl, deposits: 0, withdrawals: withdrawal, closingEquity: closing,
    cumulativeTradingPnl: money((previous?.cumulativeTradingPnl ?? 0) + pnl), cumulativeDeposits: initialCapital,
    cumulativeWithdrawals: money((previous?.cumulativeWithdrawals ?? 0) + withdrawal) });
  state.simulatedAt = `${plan.date}T23:59:59.999Z`;
  state.rngState = rng.state;
}

/** Canonical baseline only. Solve a UNIT-capital account/retention/withdrawal
 * path before emitting any priced trade; never scale a generated history.
 * Index=100+100*SUM(daily returns), not account value and not geometric TWR. */
export function createSimpleReturnMasterState(): CashflowReviewState {
  const plans = baselinePlans();
  const unitPnl = unitCapitalPath(plans);
  const initialCapital = money(C.masterPnl / unitPnl.reduce((sum, value) => sum + value, 0));
  const budgets = roundedAllocation(unitPnl.map(pnl => pnl * initialCapital), C.masterPnl);
  const state: CashflowReviewState = {
    version: 8, seed: C.seed, rngState: C.seed, mode: 'REAL_TIME', initialEquityDate: C.inception,
    simulatedAt: `${C.inception}T23:59:59.999Z`, trades: [], dailyResults: [], followers: [], aumHistory: [],
    equityHistory: [{ date: C.inception, equity: 100 }],
    cashflow: {
      policy: { methodology: 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN', performanceFeeRate: C.performanceFeeRate,
        feeCrystallization: C.feeCrystallization, copyMinimumPolicyEffectiveDate: C.copyMinimumPolicyEffectiveDate,
        currentCopyMinimum: C.currentCopyMinimum, holidays: C.holidays.map(pause => ({ ...pause })) },
      masterCashFlows: [{ id: 'MCF-INITIAL', date: C.inception, timing: 'BEFORE_TRADING', type: 'DEPOSIT', amount: initialCapital }],
      masterDays: [], followerAllocationEvents: [], copiedTrades: [], performanceFeeEvents: [],
    },
  };
  plans.forEach((plan, i) => appendDay(state, { ...plan, pnl: budgets[i] }, initialCapital));
  return state;
}

function futurePlans(start: string): DayPlan[] {
  const rng = randomFor(start, 0xd31a7);
  const selector = rng.next();
  const target = start === C.firstFutureWeek.start ? C.firstFutureWeek.return
    : selector < 0.15 ? rng.between(0.90, 1.20)
      : selector < 0.68 ? rng.between(0.55, 0.85)
        : selector < 0.86 ? rng.between(0.25, 0.55)
          : selector < 0.94 ? rng.between(0.02, 0.25) : -rng.between(0.03, 0.15);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const plans = dates.map(date => ({ date, return: 0, count: 0, losses: 0 }));
  if (target < 0) {
    // Two gains, three losses, two pauses. The target governs the signed daily
    // net ledger; no losing-week adjustment is placed on Saturday.
    const gainTotal = rng.between(0.025, 0.075);
    const gains = [0, 4], losses = [1, 3, 5];
    gains.forEach(i => { plans[i].return = gainTotal / 2; });
    const weights = losses.map(() => rng.between(0.6, 1.4));
    const total = weights.reduce((sum, value) => sum + value, 0);
    losses.forEach((i, n) => { plans[i].return = (target - gainTotal) * weights[n] / total; });
  } else {
    const active = target < 0.25 ? [1, 3, 5] : [0, 1, 2, 3, 4, 5, 6];
    const loss = target < 0.9 && target > 0.25 && rng.next() < 0.20 ? rng.integer(0, 6) : -1;
    const lossReturn = loss >= 0 ? -rng.between(0.025, 0.08) : 0;
    const positive = active.filter(i => i !== loss);
    const values = allocateBounded(positive.map(() => rng.between(0.55, 1.45)), positive.map(i => dailyCeiling(dates[i])), target - lossReturn);
    positive.forEach((index, i) => { plans[index].return = values[i]; });
    if (loss >= 0) plans[loss].return = lossReturn;
  }
  for (const plan of plans) { plan.count = plan.return === 0 ? 0 : 1; plan.losses = plan.return < 0 ? 1 : 0; }
  const wanted = target < 0.25 ? rng.integer(3, 5) : target < 0.55 ? rng.integer(7, 9) : rng.integer(8, 12);
  let remaining = Math.max(0, wanted - plans.reduce((sum, plan) => sum + plan.count, 0));
  for (const plan of [...plans].sort((a, b) => randomFor(a.date, 0xab4c).next() - randomFor(b.date, 0xab4c).next())) {
    if (remaining && plan.return > 0) { plan.count++; remaining--; }
  }
  return plans;
}

/** Date-derived immutable weekly regimes make serialized split/batch advances
 * identical. Only the newly appended day is emitted; past data is never fitted
 * to updated headlines or wall-clock randomness. */
export function advanceSimpleReturnMasterState(original: CashflowReviewState, days: number): CashflowReviewState {
  if (original.version !== 8) throw new Error('The v8 generator cannot migrate an existing v7 history');
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Advance must be 0–365 whole days');
  const state: CashflowReviewState = JSON.parse(JSON.stringify(original));
  const initialCapital = state.cashflow.masterCashFlows.find(flow => flow.id === 'MCF-INITIAL')!.amount;
  for (let i = 0; i < days; i++) {
    const date = addDays(state.simulatedAt.slice(0, 10), 1);
    const plans = futurePlans(weekStart(date));
    appendDay(state, plans[weekday(date)], initialCapital);
  }
  if (days > 0) state.mode = 'FAST_FORWARD';
  return state;
}
