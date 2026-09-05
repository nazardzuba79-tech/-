import { SYNTHETIC_COPY_CONFIG } from './syntheticConfig';
import { addUtcDays, addUtcMonths, calculateAnalytics, dayDiff, followerMasterAtStart, summarizePeriods, utcDay } from './analytics';
import { DailyResult, SyntheticCopyResponse, SyntheticCopyState, SyntheticFollower, SyntheticFollowerEvent, SyntheticTrade } from './types';
import { requireCashflowState, toCashflowReviewResponse } from './reviewEconomics';
import { advanceCashflowMasterState } from './reviewMasterLedger';
import { refreshReviewFollowerLedgers } from './reviewFollowerLedger';

const round = (value: number, digits = 8) => Number(value.toFixed(digits));

class SeededRandom {
  constructor(public state: number) {}
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  between(min: number, max: number): number { return min + (max - min) * this.next(); }
  integer(min: number, max: number): number { return Math.floor(this.between(min, max + 1)); }
}

function weightedSymbol(rng: SeededRandom) {
  const total = SYNTHETIC_COPY_CONFIG.symbols.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng.between(0, total);
  for (const item of SYNTHETIC_COPY_CONFIG.symbols) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return SYNTHETIC_COPY_CONFIG.symbols[0];
}

function createTrade(
  rng: SeededRandom,
  id: number,
  date: string,
  netPnl: number,
  riskR: number,
): SyntheticTrade {
  const asset = weightedSymbol(rng);
  const side: 'LONG' | 'SHORT' = rng.next() > 0.46 ? 'LONG' : 'SHORT';
  const leverage = rng.integer(2, 8);
  const holdingTimeMinutes = rng.next() < 0.035 ? rng.integer(1_440, 3_600) : rng.integer(18, 620);
  const closeMinute = rng.integer(60, 1_430);
  const closed = new Date(`${date}T00:00:00.000Z`);
  closed.setUTCMinutes(closeMinute);
  const opened = new Date(closed.getTime() - holdingTimeMinutes * 60_000);
  const dailyDrift = 1 + Math.sin(id * 0.17) * 0.045;
  const entryPrice = asset.price * dailyDrift * rng.between(0.96, 1.04);
  const moveFraction = rng.between(0.0025, 0.018);
  const fees = Math.max(0.08, Math.abs(netPnl) * rng.between(0.0015, 0.004));
  const funding = Math.max(0.01, Math.abs(netPnl) * rng.between(0.0001, 0.0012));
  const grossPnl = netPnl + fees + funding;
  const quantity = Math.abs(grossPnl) / Math.max(0.00000001, entryPrice * moveFraction);
  const favorable = grossPnl >= 0 ? 1 : -1;
  const signedMove = (side === 'LONG' ? favorable : -favorable) * moveFraction;
  const exitPrice = entryPrice * (1 + signedMove);
  const margin = entryPrice * quantity / leverage;
  return {
    id: `SYN-${String(id).padStart(7, '0')}`,
    symbol: asset.symbol,
    side,
    entryPrice: round(entryPrice, asset.price < 1 ? 6 : 2),
    exitPrice: round(exitPrice, asset.price < 1 ? 6 : 2),
    quantity: round(quantity, 8),
    leverage,
    openedAt: opened.toISOString(),
    closedAt: closed.toISOString(),
    grossPnl: round(grossPnl, 4),
    fees: round(fees, 4),
    funding: round(funding, 4),
    netPnl: round(netPnl, 4),
    returnPct: round(netPnl / margin * 100, 4),
    holdingTimeMinutes,
    riskR: round(riskR, 4),
    result: netPnl >= 0 ? 'WIN' : 'LOSS',
  };
}

function generateFollowers(startDate: string, currentDate: string, rng: SeededRandom): SyntheticFollower[] {
  const names = ['Liam', 'Olivia', 'Noah', 'Emma', 'Mason', 'Mia', 'Lucas', 'Sofia', 'Ethan', 'Ava', 'Leo', 'Luna', 'Kai', 'Nora', 'Max', 'Ivy', 'Aria', 'Theo', 'Ella', 'Finn', 'Maya', 'Owen', 'Zoe', 'Hugo', 'Lily', 'Alex', 'Sara', 'Dani', 'Mila', 'Roman', 'Ada', 'Iris'];
  // Scenario cohorts: two founding copiers, six at week two, twelve after
  // one calendar month. Subsequent organic growth retains today's 32 copiers.
  // Dates between milestones are seeded and irregular, not chart constants.
  const milestones = [
    { date: startDate, count: 2 },
    { date: addUtcDays(startDate, 7), count: 6 },
    { date: addUtcMonths(startDate, 1), count: 12 },
    { date: addUtcMonths(startDate, 2), count: 17 },
    { date: addUtcMonths(startDate, 6), count: 25 },
    { date: currentDate, count: SYNTHETIC_COPY_CONFIG.followerCount },
  ];
  const joinDates: string[] = [];
  for (const [index, milestone] of milestones.entries()) {
    const previous = milestones[index - 1];
    const newCount = milestone.count - joinDates.length;
    const days = previous ? dayDiff(previous.date, milestone.date) : 0;
    const cohort = Array.from({ length: newCount }, (_, followerIndex) => {
      if (!previous || index === 1 || followerIndex === newCount - 1) return milestone.date;
      return addUtcDays(previous.date, rng.integer(1, days));
    }).sort();
    joinDates.push(...cohort);
  }
  const followers = names.map((displayName, index) => ({
    id: `F-${String(index + 1).padStart(3, '0')}`,
    displayName,
    copyStartDate: joinDates[index],
    allocatedCapital: round(rng.between(70_000, 350_000), 2),
    currentEquity: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    roi: 0,
    copiedTrades: 0,
    copyRatio: round(rng.between(0.72, 1), 4),
    slippageBps: round(rng.between(0.8, 8), 3),
    latencyMs: rng.integer(90, 2_800),
    active: true,
  }));
  const desiredAum = 7_200_000;
  const scale = desiredAum / followers.reduce((sum, follower) => sum + follower.allocatedCapital, 0);
  const scaled = followers.map((follower) => ({ ...follower, allocatedCapital: round(follower.allocatedCapital * scale, 2) }));
  const roundingResidual = desiredAum - scaled.reduce((sum, follower) => sum + follower.allocatedCapital, 0);
  scaled[scaled.length - 1].allocatedCapital = round(scaled[scaled.length - 1].allocatedCapital + roundingResidual, 2);
  return scaled;
}

function refreshFollowers(state: SyntheticCopyState): void {
  for (const follower of state.followers) {
    const eligibleTrades = state.trades.filter((trade) => utcDay(trade.closedAt) >= follower.copyStartDate);
    const masterAtStart = followerMasterAtStart(state, follower);
    const scale = follower.allocatedCapital / Math.max(1, masterAtStart);
    const realizedPnl = eligibleTrades.reduce((sum, trade) => {
      const executionPenalty = Math.abs(trade.netPnl) * (follower.slippageBps / 10_000 + follower.latencyMs / 50_000_000);
      return sum + trade.netPnl * scale * follower.copyRatio - executionPenalty * scale;
    }, 0);
    follower.realizedPnl = round(realizedPnl, 2);
    follower.currentEquity = round(follower.allocatedCapital + realizedPnl, 2);
    follower.roi = round(realizedPnl / follower.allocatedCapital * 100, 4);
    follower.copiedTrades = eligibleTrades.length;
  }
}

function followerAum(state: SyntheticCopyState): number {
  return round(state.followers.filter((follower) => follower.active).reduce((sum, follower) => sum + follower.allocatedCapital, 0), 2);
}

function buildInitialAumHistory(state: SyntheticCopyState) {
  return state.equityHistory.map((point) => ({
    date: point.date,
    aum: round(state.followers
      .filter((follower) => follower.active && follower.copyStartDate <= point.date)
      .reduce((sum, follower) => sum + follower.allocatedCapital, 0), 2),
    ...(state.version >= 4 ? { followerCount: state.followers
      .filter((follower) => follower.active && follower.copyStartDate <= point.date).length } : {}),
  }));
}

function ensureAumHistory(state: SyntheticCopyState): void {
  if (!Array.isArray(state.aumHistory)) state.aumHistory = buildInitialAumHistory(state);
}

function recordAum(state: SyntheticCopyState, date: string): void {
  ensureAumHistory(state);
  const snapshot = { date, aum: followerAum(state), ...(state.version >= 4
    ? { followerCount: state.followers.filter((follower) => follower.active).length } : {}) };
  const last = state.aumHistory[state.aumHistory.length - 1];
  if (last?.date === date) state.aumHistory[state.aumHistory.length - 1] = snapshot;
  else state.aumHistory.push(snapshot);
}

function appendDay(state: SyntheticCopyState, date: string, endEquity: number, rng: SeededRandom,
  plan?: { count: number; loss: boolean; lossBudget: number }): void {
  const startEquity = state.equityHistory[state.equityHistory.length - 1].equity;
  const netDayPnl = endEquity - startEquity;
  const count = plan?.count ?? rng.integer(SYNTHETIC_COPY_CONFIG.tradesPerDay.min, SYNTHETIC_COPY_CONFIG.tradesPerDay.max);
  // Count trade outcomes, not losing days: a red day can contain several
  // smaller wins and one larger loss. v3+ budgets ~2.8% losing trades across
  // the accumulating ledger instead of adding a periodic loss on top of
  // every red day. Previously stored versions retain their original policy.
  const outcomes = Array.from({ length: count }, () => 'WIN');
  const lossDue = plan ? plan.loss : state.version >= 3
    ? state.trades.filter((trade) => trade.result === 'LOSS').length
      < Math.round((state.trades.length + count) * (1 - SYNTHETIC_COPY_CONFIG.targetWinRate))
    : state.dailyResults.length % 5 === 1;
  if (lossDue || netDayPnl < 0) outcomes[count - 1] = 'LOSS';
  if (!outcomes.includes('WIN')) outcomes[0] = 'WIN';
  const lossCount = outcomes.filter((outcome) => outcome === 'LOSS').length;
  const existingLoss = Math.abs(state.trades.filter((trade) => trade.result === 'LOSS').reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalNet = state.trades.reduce((sum, trade) => sum + trade.netPnl, 0) + netDayPnl;
  const catchUpLoss = Math.max(0, totalNet / (SYNTHETIC_COPY_CONFIG.targetProfitFactor - 1) - existingLoss);
  const lossBudget = lossCount ? Math.max(Math.abs(netDayPnl) * 1.15, plan?.lossBudget ?? catchUpLoss) : 0;
  const winBudget = netDayPnl + lossBudget;
  const winWeights = outcomes.map((outcome) => outcome === 'WIN' ? rng.between(SYNTHETIC_COPY_CONFIG.winningRiskR.min, SYNTHETIC_COPY_CONFIG.winningRiskR.max) : 0);
  const lossWeights = outcomes.map((outcome) => outcome === 'LOSS' ? rng.between(Math.abs(SYNTHETIC_COPY_CONFIG.losingRiskR.max), Math.abs(SYNTHETIC_COPY_CONFIG.losingRiskR.min)) : 0);
  const winWeightTotal = winWeights.reduce((sum, value) => sum + value, 0);
  const lossWeightTotal = lossWeights.reduce((sum, value) => sum + value, 0);
  const created: SyntheticTrade[] = outcomes.map((outcome, index) => {
    const pnl = outcome === 'WIN'
      ? winBudget * winWeights[index] / winWeightTotal
      : -lossBudget * lossWeights[index] / lossWeightTotal;
    const riskR = outcome === 'WIN' ? winWeights[index] : -lossWeights[index];
    return createTrade(rng, state.trades.length + index + 1, date, pnl, riskR);
  });
  const roundedDelta = netDayPnl - created.reduce((sum, trade) => sum + trade.netPnl, 0);
  created[0].netPnl = round(created[0].netPnl + roundedDelta, 4);
  created[0].grossPnl = round(created[0].netPnl + created[0].fees + created[0].funding, 4);
  const peak = Math.max(...state.equityHistory.map((point) => point.equity), endEquity);
  const daily: DailyResult = {
    date,
    startEquity: round(startEquity, 4),
    endEquity: round(endEquity, 4),
    realizedPnl: round(netDayPnl, 4),
    unrealizedPnl: 0,
    fees: round(created.reduce((sum, trade) => sum + trade.fees, 0), 4),
    funding: round(created.reduce((sum, trade) => sum + trade.funding, 0), 4),
    numberOfTrades: created.length,
    wins: created.filter((trade) => trade.result === 'WIN').length,
    losses: created.filter((trade) => trade.result === 'LOSS').length,
    dailyReturn: round(endEquity / startEquity - 1, 8),
    drawdown: round((endEquity - peak) / peak, 8),
  };
  state.trades.push(...created);
  state.dailyResults.push(daily);
  state.equityHistory.push({ date, equity: round(endEquity, 4) });
  if (state.followers.length) recordAum(state, date);
}

function initialTargets(rng: SeededRandom, days: number, opening: number, closing: number): number[] {
  // One additive lifetime budget. Irregular regime changes, daily noise and
  // independently spaced losses replace the repeated sine/ten-day waveform.
  // No window-specific anchor and no end-of-history boost.
  let nextLoss = rng.integer(5, 13);
  let nextRegime = 0;
  let regime = 1;
  let target = 1;
  const weights = Array.from({ length: days }, (_, day) => {
    if (day >= nextRegime) {
      target = rng.between(0.65, 1.5);
      nextRegime = day + rng.integer(9, 29);
    }
    regime += (target - regime) * 0.2;
    if (day === nextLoss) {
      nextLoss += rng.integer(5, 17);
      return -rng.between(0.07, 0.2);
    }
    return regime * rng.between(0.5, 1.5);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const netPnl = closing - opening;
  let cumulativeWeight = 0;
  return weights.map((weight, index) => {
    cumulativeWeight += weight;
    return round(opening + netPnl * (index === weights.length - 1 ? 1 : cumulativeWeight / totalWeight), 4);
  });
}

function initialTradePlan(targets: number[], rng: SeededRandom, initialCapital: number,
  initialTradeCount: number) {
  const { targetWinRate, targetProfitFactor, tradesPerDay } = SYNTHETIC_COPY_CONFIG;
  if (initialTradeCount < targets.length * tradesPerDay.min || initialTradeCount > targets.length * tradesPerDay.max) {
    throw new Error('Synthetic trade count is outside the daily cadence bounds');
  }
  const counts = targets.map(() => rng.integer(tradesPerDay.min, tradesPerDay.max));
  const order = targets.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const other = rng.integer(0, index);
    [order[index], order[other]] = [order[other], order[index]];
  }
  // Balance the integer count across shuffled sessions, never by adding a
  // last-day cluster. Keep the established 4–12 trades/day range.
  let remaining = initialTradeCount - counts.reduce((sum, count) => sum + count, 0);
  for (let cursor = 0; remaining !== 0; cursor++) {
    const day = order[cursor % order.length];
    const adjustment = Math.sign(remaining);
    const count = counts[day] + adjustment;
    if (count >= tradesPerDay.min && count <= tradesPerDay.max) {
      counts[day] = count;
      remaining -= adjustment;
    }
  }
  const dailyPnl = targets.map((target, index) => target - (index ? targets[index - 1] : initialCapital));
  const lossDays = new Set(dailyPnl.flatMap((pnl, index) => pnl < 0 ? [index] : []));
  const targetLossCount = Math.round(initialTradeCount * (1 - targetWinRate));
  for (const day of order) {
    if (lossDays.size >= targetLossCount) break;
    lossDays.add(day);
  }
  // Both daily results and the trade-level win rate are real projections of
  // this synthetic ledger: some profitable days also include a losing trade.
  const lossWeight = [...lossDays].reduce((sum, day) => sum + Math.abs(dailyPnl[day]), 0);
  const desiredGrossLoss = (targets[targets.length - 1] - initialCapital) / (targetProfitFactor - 1);
  return counts.map((count, day) => ({ count, loss: lossDays.has(day),
    lossBudget: lossDays.has(day) ? desiredGrossLoss * Math.abs(dailyPnl[day]) / lossWeight : 0 }));
}

export function createInitialState(now = new Date()): SyntheticCopyState {
  const today = utcDay(now);
  const config = SYNTHETIC_COPY_CONFIG;
  const firstDate = addUtcDays(addUtcMonths(today, -config.initialHistoryMonths), -config.initialHistoryExtraDays);
  const historyDays = dayDiff(firstDate, today);
  const earlierDays = historyDays - config.initialHistoryDays;
  const closingEquity = config.initialCapital + config.targetPnlAll;
  const rng = new SeededRandom(SYNTHETIC_COPY_CONFIG.seed);
  const state: SyntheticCopyState = {
    version: config.stateVersion,
    seed: SYNTHETIC_COPY_CONFIG.seed,
    rngState: rng.state,
    simulatedAt: `${today}T23:59:59.999Z`,
    mode: 'REAL_TIME',
    initialEquityDate: firstDate,
    continuationTemplateStart: earlierDays,
    trades: [],
    equityHistory: [{ date: firstDate, equity: SYNTHETIC_COPY_CONFIG.initialCapital }],
    aumHistory: [],
    dailyResults: [],
    followers: [],
  };
  // Reconcile the previous unfinished additive-history work semantically:
  // generate ALL once; split only the count plan to retain 97.2% trade outcomes.
  const targets = initialTargets(rng, historyDays, config.initialCapital, closingEquity);
  const earlierTargets = targets.slice(0, earlierDays);
  const recentTargets = targets.slice(earlierDays);
  const recentOpening = earlierTargets[earlierTargets.length - 1];
  const recentPlans = initialTradePlan(recentTargets, rng, recentOpening, config.initialTradeCount);
  // 243/250 is the exact rational 97.2% win rate. Balance the older cadence
  // in whole groups of 250, retaining 4–12 trades/day and exact full-ledger ROI.
  const earlierTradeCount = Math.round(earlierDays * config.initialTradeCount / config.initialHistoryDays / 250) * 250;
  const earlierPlans = initialTradePlan(earlierTargets, rng, config.initialCapital, earlierTradeCount);
  const plans = [...earlierPlans, ...recentPlans];
  for (let index = 0; index < targets.length; index++) {
    appendDay(state, addUtcDays(firstDate, index + 1), targets[index], rng, plans[index]);
  }
  state.followers = generateFollowers(firstDate, today, rng);
  state.aumHistory = buildInitialAumHistory(state);
  state.rngState = rng.state;
  refreshFollowers(state);
  return state;
}

function targetNextEquity(state: SyntheticCopyState): number {
  const current = state.equityHistory[state.equityHistory.length - 1];
  if (state.version >= 2) {
    // Keep session exposure bounded rather than compounding each template
    // return against ever-larger equity, which recreates end-loaded bars.
    // Only append: neither past trades nor ALL history is rewritten. Existing
    // version-1 environments retain their original regime until explicit reset.
    const index = state.dailyResults.length;
    const templateStart = state.version >= 4 ? (state.continuationTemplateStart ?? 0) : 0;
    const template = state.dailyResults[templateStart + (index - templateStart) % SYNTHETIC_COPY_CONFIG.initialHistoryDays];
    const drift = 1 + 0.12 * Math.sin(index * 0.71) + 0.06 * Math.cos(index * 0.19);
    return round(current.equity + template.realizedPnl * drift, 4);
  }
  // Repeat the calibrated 90-day regime (including its flat sessions and
  // pullbacks) rather than incrementing an ROI label. This makes each full
  // 90-day rolling window stable while 7D/30D genuinely change as old
  // regimes leave their windows. It also avoids the impossible demand of
  // compounding +110% every week while capping the same 30D window at
  // +310%: four such minimum weeks would already exceed +1,800%.
  const phase = state.dailyResults.length % SYNTHETIC_COPY_CONFIG.initialHistoryDays;
  const template = state.dailyResults[phase];
  const templateReturn = template.endEquity / template.startEquity - 1;
  // Small deterministic regime drift means risk metrics and the curve do
  // evolve rather than replaying an identical SVG. Its mean is near zero,
  // so it cannot turn the controlled 90-day regime into runaway growth.
  const index = state.dailyResults.length;
  const regimeDrift = 0.0035 * Math.sin(index * 0.71) + 0.0015 * Math.cos(index * 0.19);
  return current.equity * (1 + templateReturn + regimeDrift);
}

export function advanceState(state: SyntheticCopyState, days: number): SyntheticCopyState {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Days must be an integer from 1 to 365');
  if (state.version === 7) {
    const advanced = advanceCashflowMasterState(requireCashflowState(state), days);
    refreshReviewFollowerLedgers(advanced);
    return advanced;
  }
  const copy: SyntheticCopyState = JSON.parse(JSON.stringify(state));
  ensureAumHistory(copy);
  const rng = new SeededRandom(copy.rngState);
  copy.mode = 'FAST_FORWARD';
  for (let index = 0; index < days; index++) {
    const date = addUtcDays(copy.equityHistory[copy.equityHistory.length - 1].date, 1);
    appendDay(copy, date, targetNextEquity(copy), rng);
  }
  copy.rngState = rng.state;
  copy.simulatedAt = `${copy.equityHistory[copy.equityHistory.length - 1].date}T23:59:59.999Z`;
  refreshFollowers(copy);
  return copy;
}

export function catchUpRealTime(state: SyntheticCopyState, now = new Date()): SyntheticCopyState {
  if (state.mode !== 'REAL_TIME') return state;
  const currentDate = state.equityHistory[state.equityHistory.length - 1].date;
  const today = utcDay(now);
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${currentDate}T00:00:00Z`)) / 86_400_000));
  const advanced = days ? advanceState(state, days) : JSON.parse(JSON.stringify(state));
  advanced.mode = 'REAL_TIME';
  return advanced;
}

export function applyFollowerEvent(state: SyntheticCopyState, event: SyntheticFollowerEvent): SyntheticCopyState {
  // The review cohort is a versioned authored scenario, not an account API.
  // Legacy admin behavior is unchanged; do not replay v7 using its old scaler.
  if (state.version === 7) throw new Error('Review cohort changes require explicit allocation-ledger events');
  const copy: SyntheticCopyState = JSON.parse(JSON.stringify(state));
  ensureAumHistory(copy);
  if (event.type === 'NEW') {
    const next = copy.followers.length + 1;
    copy.followers.push({
      id: `F-${String(next).padStart(3, '0')}`,
      displayName: event.displayName,
      copyStartDate: copy.equityHistory[copy.equityHistory.length - 1].date,
      allocatedCapital: round(event.allocatedCapital, 2),
      currentEquity: event.allocatedCapital,
      realizedPnl: 0,
      unrealizedPnl: 0,
      roi: 0,
      copiedTrades: 0,
      copyRatio: 0.9,
      slippageBps: 3,
      latencyMs: 600,
      active: true,
    });
  } else {
    const follower = copy.followers.find((item) => item.id === event.followerId);
    if (!follower) throw new Error('Synthetic follower not found');
    if (event.type === 'STOP') follower.active = false;
    if (event.type === 'INCREASE') follower.allocatedCapital = round(follower.allocatedCapital + event.amount, 2);
    if (event.type === 'DECREASE') follower.allocatedCapital = round(Math.max(0, follower.allocatedCapital - event.amount), 2);
  }
  refreshFollowers(copy);
  recordAum(copy, copy.equityHistory[copy.equityHistory.length - 1].date);
  return copy;
}

export function toResponse(state: SyntheticCopyState): SyntheticCopyResponse {
  if (state.version === 7) return toCashflowReviewResponse(state);
  ensureAumHistory(state);
  return {
    trader: { id: 'VX-001', name: 'Nazara', vip: true },
    simulation: { seed: state.seed, mode: state.mode, simulatedAt: state.simulatedAt, stateVersion: state.version },
    analytics: calculateAnalytics(state),
    trades: [...state.trades].sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
    equityHistory: state.equityHistory,
    aumHistory: state.aumHistory,
    dailyResults: state.dailyResults,
    followers: state.followers,
    weekly: summarizePeriods(state, 'week'),
    monthly: summarizePeriods(state, 'month'),
  };
}
