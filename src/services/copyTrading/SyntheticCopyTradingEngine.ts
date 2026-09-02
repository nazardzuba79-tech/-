import { SYNTHETIC_COPY_CONFIG } from './syntheticConfig';
import { addUtcDays, calculateAnalytics, equityAtOrBefore, summarizePeriods, utcDay } from './analytics';
import { DailyResult, SyntheticCopyResponse, SyntheticCopyState, SyntheticFollower, SyntheticFollowerEvent, SyntheticTrade } from './types';

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

function buildSegment(start: number, end: number, days: number, rng: SeededRandom, shocks: Map<number, number>): number[] {
  const logs = Array.from({ length: days }, (_, index) => rng.between(-0.012, 0.012) + (shocks.get(index) ?? 0));
  const correction = (Math.log(end / start) - logs.reduce((sum, value) => sum + value, 0)) / days;
  const values: number[] = [];
  let equity = start;
  for (const value of logs) {
    equity *= Math.exp(value + correction);
    values.push(equity);
  }
  values[values.length - 1] = end;
  return values;
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

function generateFollowers(startDate: string, rng: SeededRandom): SyntheticFollower[] {
  const names = ['Liam', 'Olivia', 'Noah', 'Emma', 'Mason', 'Mia', 'Lucas', 'Sofia', 'Ethan', 'Ava', 'Leo', 'Luna', 'Kai', 'Nora', 'Max', 'Ivy', 'Aria', 'Theo', 'Ella', 'Finn', 'Maya', 'Owen', 'Zoe', 'Hugo', 'Lily', 'Alex', 'Sara', 'Dani', 'Mila', 'Roman', 'Ada', 'Iris'];
  const followers = names.map((displayName, index) => ({
    id: `F-${String(index + 1).padStart(3, '0')}`,
    displayName,
    copyStartDate: addUtcDays(startDate, rng.integer(0, 78)),
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
    const masterAtStart = equityAtOrBefore(state.equityHistory, follower.copyStartDate).equity;
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

function appendDay(state: SyntheticCopyState, date: string, endEquity: number, rng: SeededRandom, forcedLossBudget?: number): void {
  const startEquity = state.equityHistory[state.equityHistory.length - 1].equity;
  const netDayPnl = endEquity - startEquity;
  const count = rng.integer(SYNTHETIC_COPY_CONFIG.tradesPerDay.min, SYNTHETIC_COPY_CONFIG.tradesPerDay.max);
  // One loss roughly every four trading days gives ~2.9% losing trades at
  // the configured 4–12/day cadence. A down day always gets a losing trade
  // so a positive-labelled trade can never carry a negative PnL.
  const outcomes = Array.from({ length: count }, () => 'WIN');
  if (state.dailyResults.length % 5 === 1 || netDayPnl < 0) outcomes[count - 1] = 'LOSS';
  if (!outcomes.includes('WIN')) outcomes[0] = 'WIN';
  const lossCount = outcomes.filter((outcome) => outcome === 'LOSS').length;
  const existingLoss = Math.abs(state.trades.filter((trade) => trade.result === 'LOSS').reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalNet = state.trades.reduce((sum, trade) => sum + trade.netPnl, 0) + netDayPnl;
  const catchUpLoss = Math.max(0, totalNet / (SYNTHETIC_COPY_CONFIG.targetProfitFactor - 1) - existingLoss);
  const lossBudget = lossCount ? Math.max(Math.abs(netDayPnl) * 1.15, forcedLossBudget ?? catchUpLoss) : 0;
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
}

function initialTargets(rng: SeededRandom): number[] {
  const first = buildSegment(100_000, 253_640, 60, rng, new Map([[19, -0.075], [20, -0.032], [44, -0.025]]));
  const second = buildSegment(253_640, 423_870, 23, rng, new Map([[8, -0.035]]));
  const third = buildSegment(423_870, 941_000, 7, rng, new Map([[2, -0.025]]));
  return [...first, ...second, ...third];
}

export function createInitialState(now = new Date()): SyntheticCopyState {
  const today = utcDay(now);
  const firstDate = addUtcDays(today, -90);
  const rng = new SeededRandom(SYNTHETIC_COPY_CONFIG.seed);
  const state: SyntheticCopyState = {
    version: 1,
    seed: SYNTHETIC_COPY_CONFIG.seed,
    rngState: rng.state,
    simulatedAt: `${today}T23:59:59.999Z`,
    mode: 'REAL_TIME',
    initialEquityDate: firstDate,
    trades: [],
    equityHistory: [{ date: firstDate, equity: SYNTHETIC_COPY_CONFIG.initialCapital }],
    dailyResults: [],
    followers: [],
  };
  const targets = initialTargets(rng);
  const totalNet = targets[targets.length - 1] - SYNTHETIC_COPY_CONFIG.initialCapital;
  const desiredGrossLoss = totalNet / (SYNTHETIC_COPY_CONFIG.targetProfitFactor - 1);
  const lossDays = targets.map((_, index) => index).filter((index) => index % 5 === 1);
  const weights = lossDays.map((index) => state.equityHistory[0].equity * (1 + index / 90));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < targets.length; index++) {
    const lossIndex = lossDays.indexOf(index);
    const budget = lossIndex >= 0 ? desiredGrossLoss * weights[lossIndex] / weightTotal : undefined;
    appendDay(state, addUtcDays(firstDate, index + 1), targets[index], rng, budget);
  }
  state.followers = generateFollowers(firstDate, rng);
  state.rngState = rng.state;
  refreshFollowers(state);
  return state;
}

function targetNextEquity(state: SyntheticCopyState): number {
  const current = state.equityHistory[state.equityHistory.length - 1];
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
  const copy: SyntheticCopyState = JSON.parse(JSON.stringify(state));
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
  const copy: SyntheticCopyState = JSON.parse(JSON.stringify(state));
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
  return copy;
}

export function toResponse(state: SyntheticCopyState): SyntheticCopyResponse {
  return {
    trader: { id: 'VX-001', name: 'Nazara', vip: true },
    simulation: { seed: state.seed, mode: state.mode, simulatedAt: state.simulatedAt },
    analytics: calculateAnalytics(state),
    trades: [...state.trades].sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
    equityHistory: state.equityHistory,
    dailyResults: state.dailyResults,
    followers: state.followers,
    weekly: summarizePeriods(state, 'week'),
    monthly: summarizePeriods(state, 'month'),
  };
}
