import type { SyntheticTrade } from './types';
import type { CashflowReviewState, ReviewFollower } from './reviewEconomicsTypes';
import { toCashflowReviewResponse } from './reviewEconomics';
import { refreshReviewFollowerLedgers } from './reviewFollowerLedger';

/** Explicitly synthetic review scenario. Never imports account, order, wallet,
 * matching, or database services. Prices below are simulation reference prices,
 * not claims about executions by the person who owns the strategy identity. */
export const KSENIA_REVIEW = Object.freeze({
  traderId: 'VX-KSENIA', inception: '2025-08-06', baseline: '2026-09-06',
  capital: 180_000, seed: 0x4b53454e, feeRate: .1, target365Fees: 1_275_547,
});
const DAY = 86_400_000;
const m = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
const round = (v: number, digits: number) => Number(v.toFixed(digits));
const dateAt = (date: string, offset: number) => new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
const countDays = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
function random(key: string) {
  let n = KSENIA_REVIEW.seed;
  for (const c of key) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
interface Plan { date: string; return: number; wins: number; losses: number; breakevens: number }
function baselinePlans(): Plan[] {
  const n = countDays(KSENIA_REVIEW.inception, KSENIA_REVIEW.baseline);
  const plans: Plan[] = Array.from({ length: n }, (_, i) => ({ date: dateAt(KSENIA_REVIEW.inception, i + 1), return: 0, wins: 1, losses: 0, breakevens: 0 }));
  const rank = (i: number, salt: string) => random(`${salt}:${plans[i].date}`)();
  const quiet = Array.from({ length: n - 38 }, (_, i) => i + 20).sort((a, b) => rank(a, 'quiet') - rank(b, 'quiet')).slice(0, 24);
  quiet.forEach(i => { plans[i].wins = 0; });
  const red = [0, 1, 2, ...Array.from({ length: n - 48 }, (_, i) => i + 25)
    .filter(i => !quiet.includes(i) && i % 9 === 0).sort((a, b) => rank(a, 'red') - rank(b, 'red')).slice(0, 27)];
  if (red.length !== 30) throw new Error('Ksenia baseline loss-session schedule incomplete');
  red.forEach(i => { plans[i].wins = 0; plans[i].losses = 1; plans[i].return = i < 3 ? -.027 : -(.005 + rank(i, 'loss-size') * .03); });
  // Nested interval budgets are solved before any execution exists. No emitted
  // history is rescaled and no final trade/day is a balancing bucket.
  const intervals = [[0, n - 90, 12.88], [n - 90, n - 30, 3.51], [n - 30, n - 7, .55], [n - 7, n, .62]];
  for (const [start, end, target] of intervals) {
    const positive = plans.slice(start, end).filter(p => p.wins);
    const negative = plans.slice(start, end).reduce((s, p) => s + p.return, 0);
    const weights = positive.map(p => {
      const week = dateAt(p.date, -new Date(p.date).getUTCDay());
      const regime = random('regime:' + week)();
      return (.3 + regime * 1.2) * (.6 + random('session:' + p.date)() * .8);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    positive.forEach((p, i) => { p.return = weights[i] / total * (target - negative); });
  }
  const positive = plans.filter(p => p.wins).sort((a, b) => random('frequency:' + a.date)() - random('frequency:' + b.date)());
  positive.slice(0, 55).forEach(p => { p.wins++; });
  positive.slice(55, 72).forEach(p => { p.losses++; });
  positive.slice(72, 74).forEach(p => { p.breakevens++; });
  return plans;
}
const ASSETS = [['BTCUSDT', 61000], ['ETHUSDT', 2800], ['SOLUSDT', 145], ['BNBUSDT', 540], ['XRPUSDT', .75], ['DOGEUSDT', .16]] as const;
function pricedTrade(date: string, ordinal: number, slot: number, count: number, desired: number, capital: number): SyntheticTrade {
  const rng = random(`trade:${date}:${slot}`);
  const [symbol, reference] = ASSETS[Math.floor(rng() * ASSETS.length)];
  const side = rng() < .48 ? 'SHORT' : 'LONG';
  const sign = side === 'LONG' ? 1 : -1;
  const leverage = 3 + Math.floor(rng() * 4);
  const entryPrice = round(reference * (.85 + rng() * .32), 10);
  const quantity = round(Math.max(capital * leverage * .6, Math.abs(desired) / .055) / entryPrice, 8);
  if (quantity * entryPrice / leverage > capital) throw new Error('Ksenia synthetic margin exceeds operating capital');
  const slotMinutes = Math.floor(1380 / count);
  const holdingTimeMinutes = Math.floor(slotMinutes * (.3 + rng() * .6));
  const openedAt = new Date(Date.parse(date) + (20 + slot * slotMinutes) * 60000).toISOString();
  const closedAt = new Date(Date.parse(openedAt) + holdingTimeMinutes * 60000).toISOString();
  const feeRate = .00035;
  const funding = m(entryPrice * quantity * .00004 * holdingTimeMinutes / 480);
  let exitPrice = round((entryPrice * quantity * (sign + feeRate) + desired + funding) / (quantity * (sign - feeRate)), 12);
  let grossPnl = 0, fees = 0, netPnl = 0;
  for (let i = 0; i < 20; i++) {
    grossPnl = m(sign * (exitPrice - entryPrice) * quantity);
    fees = m((entryPrice + exitPrice) * quantity * feeRate);
    netPnl = m(grossPnl - fees - funding);
    if (Math.abs(netPnl - desired) < .000049) break;
    exitPrice = round(entryPrice + sign * m(desired + fees + funding) / quantity, 12);
  }
  if (Math.abs(netPnl - desired) >= .000049 || exitPrice <= 0) throw new Error('Ksenia priced execution reconciliation failed');
  const margin = entryPrice * quantity / leverage;
  return { id: `KS-REV-${String(ordinal).padStart(7, '0')}`, symbol, side, entryPrice, exitPrice, quantity, leverage,
    openedAt, closedAt, grossPnl, fees, funding, netPnl, returnPct: netPnl / margin * 100,
    holdingTimeMinutes, riskR: netPnl / (margin * .01), result: netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'BREAKEVEN' };
}
function appendDay(state: CashflowReviewState, plan: Plan) {
  const previous = state.cashflow.masterDays.at(-1);
  const openingEquity = previous?.closingEquity ?? KSENIA_REVIEW.capital;
  const capitalAtRisk = Math.min(openingEquity, KSENIA_REVIEW.capital);
  const wanted = m(capitalAtRisk * plan.return);
  const losses = plan.losses ? m(Math.max(0, -wanted) + (plan.wins ? capitalAtRisk * .012 : 0)) : 0;
  const split = (amount: number, count: number): number[] => {
    const rng = random(`split:${plan.date}:${amount}`);
    const weights = Array.from({ length: count }, () => .7 + rng() * .6);
    const total = weights.reduce((a, b) => a + b, 0);
    // Largest-remainder allocation conserves fixed-point cents across executions,
    // without altering a return or inventing a balancing execution.
    const units = Math.round(Math.abs(amount) * 10000);
    const exact = weights.map(w => w / total * units);
    const allocated = exact.map(Math.floor);
    let remainder = units - allocated.reduce((a, b) => a + b, 0);
    [...allocated.keys()].sort((a, b) => (exact[b] - allocated[b]) - (exact[a] - allocated[a])).forEach(i => { if (remainder-- > 0) allocated[i]++; });
    return allocated.map(value => Math.sign(amount) * value / 10000);
  };
  const values = [...split(m(wanted + losses), plan.wins), ...split(-losses, plan.losses), ...Array(plan.breakevens).fill(0)];
  const trades = values.map((net, i) => pricedTrade(plan.date, state.trades.length + i + 1, i, values.length, net, capitalAtRisk));
  const pnl = m(trades.reduce((s, t) => s + t.netPnl, 0));
  const withdrawals = new Date(plan.date).getUTCDay() === 6 ? m(Math.max(0, openingEquity + pnl - KSENIA_REVIEW.capital)) : 0;
  const closingEquity = m(openingEquity + pnl - withdrawals);
  const dailyReturn = pnl / capitalAtRisk;
  const equity = state.equityHistory.at(-1)!.equity + dailyReturn * 100;
  const peak = Math.max(equity, ...state.equityHistory.map(p => p.equity));
  state.trades.push(...trades);
  state.dailyResults.push({ date: plan.date, startEquity: openingEquity, endEquity: closingEquity, realizedPnl: pnl, unrealizedPnl: 0,
    fees: m(trades.reduce((s, t) => s + t.fees, 0)), funding: m(trades.reduce((s, t) => s + t.funding, 0)),
    numberOfTrades: trades.length, wins: trades.filter(t => t.netPnl > 0).length, losses: trades.filter(t => t.netPnl < 0).length,
    dailyReturn, drawdown: (equity - peak) / peak });
  state.equityHistory.push({ date: plan.date, equity });
  state.cashflow.masterDays.push({ date: plan.date, openingEquity, capitalAtRisk, tradingPnl: pnl, deposits: 0, withdrawals, closingEquity,
    operatingCapitalTarget: KSENIA_REVIEW.capital, nextOperatingCapitalTarget: KSENIA_REVIEW.capital, retainedProfit: 0,
    cumulativeTradingPnl: m((previous?.cumulativeTradingPnl ?? 0) + pnl), cumulativeDeposits: KSENIA_REVIEW.capital,
    cumulativeWithdrawals: m((previous?.cumulativeWithdrawals ?? 0) + withdrawals) });
  if (withdrawals) state.cashflow.masterCashFlows.push({ id: `KS-W-${plan.date}`, date: plan.date, timing: 'AFTER_TRADING', type: 'WITHDRAWAL', amount: withdrawals });
  state.simulatedAt = plan.date + 'T23:59:59.999Z';
}
export function createKseniaMasterState(): CashflowReviewState {
  const state: CashflowReviewState = { version: 8, seed: KSENIA_REVIEW.seed, rngState: KSENIA_REVIEW.seed, mode: 'REAL_TIME',
    initialEquityDate: KSENIA_REVIEW.inception, simulatedAt: KSENIA_REVIEW.inception + 'T23:59:59.999Z', trades: [], dailyResults: [], followers: [], aumHistory: [],
    equityHistory: [{ date: KSENIA_REVIEW.inception, equity: 100 }], cashflow: {
      policy: { methodology: 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN', performanceFeeRate: .1, feeCrystallization: 'DAILY_HIGH_WATER_MARK',
        copyMinimumPolicyEffectiveDate: '2026-01-01', currentCopyMinimum: 20_000, holidays: [] },
      masterDays: [], masterCashFlows: [{ id: 'KS-INITIAL', date: KSENIA_REVIEW.inception, timing: 'BEFORE_TRADING', type: 'DEPOSIT', amount: KSENIA_REVIEW.capital }],
      followerAllocationEvents: [], copiedTrades: [], performanceFeeEvents: [],
    } };
  baselinePlans().forEach(plan => appendDay(state, plan));
  return state;
}
/** Follower cohorts/settings are simulation inputs, not real subscriptions.
 * Distinct allocations in each six-member cohort total 675,000, hence 5.4M.
 * The first cohort includes historically grandfathered allocations below 20k. */
export function populateKseniaFollowers(state: CashflowReviewState, utilization: number) {
  if (state.followers.length) throw new Error('Cannot replace existing Ksenia followers');
  const allocations = [15_000, 18_000, 82_000, 125_000, 175_000, 260_000];
  state.followers = Array.from({ length: 48 }, (_, i): ReviewFollower => {
    const group = Math.floor(i / 6);
    const allocation = group === 0 ? allocations[i % 6] : [27_000, 43_000, 87_000, 128_000, 170_000, 220_000][i % 6];
    const offset = group * 43 + (i % 6) * 5 + Math.floor(random('join:' + i)() * 4);
    const copyStartDate = dateAt(KSENIA_REVIEW.inception, offset) + 'T00:00:00.000Z';
    const id = `KS-COHORT-${String(i + 1).padStart(3, '0')}`;
    state.cashflow.followerAllocationEvents.push({ id: id + ':join', followerId: id, date: copyStartDate, type: 'JOIN', oldAllocation: 0, delta: allocation, newAllocation: allocation });
    return { id, displayName: `K•••${String(i + 1).padStart(2, '0')}`, copyStartDate, startingAllocation: allocation, allocatedCapital: allocation,
      copyRatio: utilization * (.85 + (i % 6) * .03), slippageBps: .15 + (i % 7) * .08, latencyMs: 55 + (i * 37) % 260,
      currentEquity: allocation, realizedPnl: 0, unrealizedPnl: 0, roi: 0, copiedTrades: 0, active: true,
      grossPnl: 0, performanceFees: 0, netPnl: 0, copiedVolume: 0, highWaterMark: 0 };
  });
  refreshReviewFollowerLedgers(state);
}
export function kseniaFeeEarnings365(state: CashflowReviewState) {
  const cutoff = dateAt(state.simulatedAt, -365);
  return m(state.cashflow.performanceFeeEvents.filter(e => e.date.slice(0, 10) > cutoff && e.date.slice(0, 10) <= state.simulatedAt.slice(0, 10)).reduce((sum, event) => sum + event.feeAmount, 0));
}
export function advanceKseniaReview(original: CashflowReviewState, days: number): CashflowReviewState {
  if (original.seed !== KSENIA_REVIEW.seed || !Number.isInteger(days) || days < 0 || days > 365) throw new Error('Invalid Ksenia advance');
  const state: CashflowReviewState = JSON.parse(JSON.stringify(original));
  for (let i = 0; i < days; i++) {
    const date = dateAt(state.simulatedAt, 1);
    const weekday = new Date(date).getUTCDay();
    const week = dateAt(date, -weekday);
    const rng = random('future-week:' + week);
    const regime = rng();
    const target = regime < .06 ? -.02 - rng() * .05 : regime < .18 ? rng() * .1 : regime < .4 ? .1 + rng() * .2 : regime < .77 ? .25 + rng() * .2 : .45 + rng() * .25;
    const weights = Array.from({ length: 7 }, () => .6 + rng() * .8);
    const weight = weights[weekday] / weights.reduce((a, b) => a + b, 0);
    const dailyReturn = target * weight;
    const plan: Plan = { date, return: dailyReturn, wins: dailyReturn > 0 ? 1 : 0, losses: dailyReturn < 0 ? 1 : 0, breakevens: 0 };
    if (dailyReturn > 0 && random('future-frequency:' + date)() < .22) plan.wins++;
    const resolved = state.trades.filter(t => t.result !== 'BREAKEVEN').length;
    const losses = state.trades.filter(t => t.result === 'LOSS').length;
    if (plan.wins && losses < Math.round((resolved + plan.wins) * 47 / 444)) plan.losses++;
    appendDay(state, plan);
  }
  refreshReviewFollowerLedgers(state);
  return state;
}
export function kseniaReviewResponse(state: CashflowReviewState) {
  return { ...toCashflowReviewResponse(state), trader: { id: KSENIA_REVIEW.traderId, name: 'Ksenia', vip: true },
    provenance: 'SYNTHETIC_REVIEW' as const, traderEarnings365: kseniaFeeEarnings365(state) };
}

/** Pre-execution cohort utilization solved against the baseline HWM ledger.
 * It is a copy-risk input (19.57–23.03% exposure), NOT a replacement fee or
 * retrospective PnL adjustment. All 48 cohorts use it from their own join date.
 * Full-precision fee events independently sum to the approved 365D fixture. */
export function createKseniaReviewState(): CashflowReviewState {
  const state = createKseniaMasterState();
  populateKseniaFollowers(state, .230262537333357);
  if (kseniaFeeEarnings365(state) !== KSENIA_REVIEW.target365Fees) throw new Error('Ksenia baseline fee fixture no longer reconciles');
  return state;
}
