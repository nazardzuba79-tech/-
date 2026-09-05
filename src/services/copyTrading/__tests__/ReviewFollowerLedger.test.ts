import { buildReviewAumHistory, populateReviewFollowers, refreshReviewFollowerLedgers } from '../reviewFollowerLedger';
import { advanceCashflowMasterState, createCashflowMasterState } from '../reviewMasterLedger';
import type { CashflowReviewState, FollowerAllocationEvent, ReviewFollower } from '../reviewEconomicsTypes';
import type { SyntheticTrade } from '../types';

const DAY_MS = 86_400_000;
const cash = (value: number) => Math.round(value * 10_000);
const total = (values: number[]) => values.reduce((sum, value) => sum + cash(value), 0);
const dayAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function fixture(from = '2026-02-20', until = '2026-02-25'): CashflowReviewState {
  return {
    version: 7, seed: 1, rngState: 1, simulatedAt: `${until}T23:59:59Z`, mode: 'FAST_FORWARD',
    initialEquityDate: from, trades: [], equityHistory: [], aumHistory: [], dailyResults: [], followers: [],
    cashflow: {
      policy: {
        methodology: 'DAILY_TWR', performanceFeeRate: 0.1,
        feeCrystallization: 'DAILY_GROSS_PNL_HIGH_WATER_MARK',
        copyMinimumPolicyEffectiveDate: '2026-03-01', currentCopyMinimum: 20_000, holidays: [],
      },
      masterDays: [], masterCashFlows: [], followerAllocationEvents: [], copiedTrades: [], performanceFeeEvents: [],
    },
  };
}

function addFollower(state: CashflowReviewState, allocation = 10_000, joinedAt = `${state.initialEquityDate}T00:00:00Z`): ReviewFollower {
  const id = `fixture-${state.followers.length + 1}`;
  const follower: ReviewFollower = {
    id, displayName: 'Synthetic fixture', copyStartDate: joinedAt,
    startingAllocation: allocation, allocatedCapital: allocation,
    copyRatio: 1, slippageBps: 0, latencyMs: 0,
    currentEquity: allocation, realizedPnl: 0, unrealizedPnl: 0, roi: 0, copiedTrades: 0,
    grossPnl: 0, performanceFees: 0, netPnl: 0, copiedVolume: 0, highWaterMark: 0, active: true,
  };
  state.followers.push(follower);
  state.cashflow.followerAllocationEvents.push({
    id: `${id}:join`, followerId: id, date: joinedAt, type: 'JOIN',
    oldAllocation: 0, delta: allocation, newAllocation: allocation,
  });
  return follower;
}

function addTrade(state: CashflowReviewState, date: string, grossPnl: number, overrides: Partial<SyntheticTrade> = {}, capitalAtRisk = 10_000): SyntheticTrade {
  const trade: SyntheticTrade = {
    id: `master-${state.trades.length + 1}`, symbol: 'BTCUSDT', side: 'LONG',
    entryPrice: 100, exitPrice: 100 + grossPnl / 100, quantity: 100, leverage: 2,
    openedAt: `${date}T09:00:00Z`, closedAt: `${date}T10:00:00Z`,
    grossPnl, fees: 0, funding: 0, netPnl: grossPnl, returnPct: grossPnl / capitalAtRisk * 100,
    holdingTimeMinutes: 60, riskR: 1, result: grossPnl >= 0 ? 'WIN' : 'LOSS', ...overrides,
  };
  state.trades.push(trade);
  if (!state.cashflow.masterDays.some(day => day.date === date)) {
    state.cashflow.masterDays.push({
      date, openingEquity: capitalAtRisk, capitalAtRisk, tradingPnl: trade.netPnl,
      deposits: 0, withdrawals: 0, closingEquity: capitalAtRisk + trade.netPnl,
      cumulativeTradingPnl: trade.netPnl, cumulativeDeposits: capitalAtRisk, cumulativeWithdrawals: 0,
    });
  }
  return trade;
}

function addAllocation(state: CashflowReviewState, follower: ReviewFollower, date: string, previous: number, next: number): FollowerAllocationEvent {
  const event: FollowerAllocationEvent = {
    id: `${follower.id}:allocation:${date}`, followerId: follower.id, date,
    oldAllocation: previous, delta: next - previous, newAllocation: next,
    type: next === 0 ? 'STOP' : next > previous ? 'INCREASE' : 'DECREASE',
  };
  state.cashflow.followerAllocationEvents.push(event);
  return event;
}

describe('v7 review follower ledgers: independent accounting fixtures', () => {
  test('daily HWM charges only new profit, not a loss or a recovery to the previous peak', () => {
    const state = fixture();
    addFollower(state);
    [100, -60, 40, 20, 15].forEach((pnl, index) => addTrade(state, dayAfter('2026-02-20', index), pnl));
    refreshReviewFollowerLedgers(state);

    expect(state.cashflow.performanceFeeEvents.map(event => ({
      date: event.date, eligible: event.eligibleProfit, fee: event.feeAmount,
      before: event.highWaterMarkBefore, after: event.highWaterMarkAfter,
    }))).toEqual([
      { date: '2026-02-20', eligible: 100, fee: 10, before: 0, after: 100 },
      { date: '2026-02-24', eligible: 15, fee: 1.5, before: 100, after: 115 },
    ]);
    expect(state.followers[0]).toMatchObject({
      grossPnl: 115, performanceFees: 11.5, netPnl: 103.5,
      realizedPnl: 103.5, currentEquity: 10_103.5, highWaterMark: 115,
    });
    expect(state.followers[0].roi).toBeCloseTo(1.035, 10);
  });

  test('a contribution during drawdown never resets the HWM or creates a performance fee', () => {
    const state = fixture();
    const follower = addFollower(state);
    addTrade(state, '2026-02-20', 100);
    addTrade(state, '2026-02-21', -60);
    addAllocation(state, follower, '2026-02-22', 10_000, 25_000);
    addTrade(state, '2026-02-22', 20); // 2.5x copied scale: only 50 recovered.
    refreshReviewFollowerLedgers(state);

    expect(state.cashflow.performanceFeeEvents).toHaveLength(1);
    expect(state.followers[0]).toMatchObject({
      allocatedCapital: 25_000, grossPnl: 90, highWaterMark: 100,
      performanceFees: 10, netPnl: 80, currentEquity: 25_080,
    });
    const expectedFactor = (1 + 90 / 10_000) * (1 - 60 / 10_090) * (1 + 50 / 25_030);
    expect(state.followers[0].roi).toBeCloseTo((expectedFactor - 1) * 100, 10);
  });

  test('uses entry time for eligibility, not a pre-join position that merely closes after joining', () => {
    const state = fixture('2026-03-01', '2026-03-01');
    addFollower(state, 20_000, '2026-03-01T00:00:00Z');
    // A position opened before the JOIN is excluded even if its close is on
    // the join date. Actual scenario positions are all intraday.
    addTrade(state, '2026-03-01', 500, { openedAt: '2026-02-28T23:00:00Z', closedAt: '2026-03-01T10:00:00Z' });
    const eligible = addTrade(state, '2026-03-01', 100, { openedAt: '2026-03-01T11:00:00Z', closedAt: '2026-03-01T12:00:00Z' });
    refreshReviewFollowerLedgers(state);
    expect(state.cashflow.copiedTrades).toHaveLength(1);
    expect(state.cashflow.copiedTrades[0]).toMatchObject({ masterTradeId: eligible.id, grossPnl: 200, notional: 20_000 });
    expect(state.followers[0].netPnl).toBe(180);
  });

  test('copy scale uses the capital-at-risk ledger, and execution drag uses real round-trip notional', () => {
    const state = fixture();
    const follower = addFollower(state);
    follower.copyRatio = 0.9;
    follower.slippageBps = 1.7;
    follower.latencyMs = 300;
    addTrade(state, '2026-02-20', 100, { fees: 2, funding: 0.5, netPnl: 97.5 }, 20_000);
    // Deliberately unrelated TWR values must never be treated as capital.
    state.equityHistory = [{ date: '2026-02-20', equity: 987_654_321 }];
    refreshReviewFollowerLedgers(state);
    const copy = state.cashflow.copiedTrades[0];
    expect(copy).toMatchObject({
      quantity: 45, notional: 4_500, grossPnlBeforeCosts: 45,
      tradingFees: 0.9, funding: 0.225, executionCost: 1.809, grossPnl: 42.066,
    });
    expect(cash(copy.grossPnl)).toBe(cash(copy.grossPnlBeforeCosts) - cash(copy.tradingFees) - cash(copy.funding) - cash(copy.executionCost));
    expect(state.followers[0].performanceFees).toBe(4.2066);
    expect(state.followers[0].netPnl).toBe(37.8594);
    expect(state.followers[0].copiedVolume).toBe(4_500);
    const variant = structuredClone(state);
    variant.equityHistory[0].equity = 100;
    refreshReviewFollowerLedgers(variant);
    expect(variant.cashflow.copiedTrades).toEqual(state.cashflow.copiedTrades);
  });

  test('daily crystallization nets every winning/losing trade and preserves a funding credit', () => {
    const state = fixture();
    addFollower(state);
    addTrade(state, '2026-02-20', 100, { funding: -1, netPnl: 101 });
    addTrade(state, '2026-02-20', -120, { openedAt: '2026-02-20T11:00:00Z', closedAt: '2026-02-20T12:00:00Z' });
    refreshReviewFollowerLedgers(state);
    expect(state.cashflow.copiedTrades[0].funding).toBe(-1);
    expect(state.cashflow.performanceFeeEvents).toEqual([]);
    expect(state.followers[0]).toMatchObject({ grossPnl: -19, performanceFees: 0, netPnl: -19, highWaterMark: 0 });
  });

  test('losses reduce the next actual position, while recovered profits never automatically compound allocation', () => {
    const state = fixture();
    addFollower(state);
    addTrade(state, '2026-02-20', -2_000);
    addTrade(state, '2026-02-20', 1_000, { openedAt: '2026-02-20T11:00:00Z', closedAt: '2026-02-20T12:00:00Z' });
    addTrade(state, '2026-02-21', 1_000);
    addTrade(state, '2026-02-22', 1_000);
    addTrade(state, '2026-02-23', 1_000);
    refreshReviewFollowerLedgers(state);
    expect(state.cashflow.copiedTrades.map(trade => trade.notional)).toEqual([10_000, 8_000, 8_800, 9_680, 10_000]);
    expect(state.cashflow.copiedTrades.map(trade => trade.grossPnl)).toEqual([-2_000, 800, 880, 968, 1_000]);
    expect(state.cashflow.performanceFeeEvents.map(event => event.feeAmount)).toEqual([64.8, 100]);
    expect(state.followers[0]).toMatchObject({ allocatedCapital: 10_000, netPnl: 1_483.2, currentEquity: 11_483.2 });
    expect(state.followers[0].roi).toBeCloseTo(14.832, 10);
  });

  test('reconstructs AUM from JOIN/increase/decrease/STOP without adding trading profits', () => {
    const state = fixture('2026-02-20', '2026-02-24');
    const follower = addFollower(state, 7_000);
    addAllocation(state, follower, '2026-02-21', 7_000, 22_500);
    addAllocation(state, follower, '2026-02-22', 22_500, 12_125);
    addAllocation(state, follower, '2026-02-24', 12_125, 0);
    addTrade(state, '2026-02-20', 100);
    addTrade(state, '2026-02-21', 100);
    addTrade(state, '2026-02-22', 100);
    addTrade(state, '2026-02-24', 100);
    refreshReviewFollowerLedgers(state);
    expect(buildReviewAumHistory(state)).toEqual([
      { date: '2026-02-20', aum: 7_000, followerCount: 1 },
      { date: '2026-02-21', aum: 22_500, followerCount: 1 },
      { date: '2026-02-22', aum: 12_125, followerCount: 1 },
      { date: '2026-02-23', aum: 12_125, followerCount: 1 },
      { date: '2026-02-24', aum: 0, followerCount: 0 },
    ]);
    expect(state.cashflow.copiedTrades.map(trade => trade.notional)).toEqual([7_000, 22_500, 12_125]);
    expect(state.followers[0].active).toBe(false);
    expect(state.followers[0].currentEquity).toBe(state.followers[0].netPnl);
  });

  test('effective-date eligibility grandfathers old allocations but rejects a below-minimum new join', () => {
    const older = fixture('2026-02-28', '2026-03-02');
    addFollower(older, 5_000);
    expect(() => refreshReviewFollowerLedgers(older)).not.toThrow();
    const newJoin = fixture('2026-03-01', '2026-03-02');
    addFollower(newJoin, 7_000);
    expect(() => refreshReviewFollowerLedgers(newJoin)).toThrow('effective copy minimum');
  });

  test('fails closed for non-reconciling allocation changes or missing master capital', () => {
    const invalid = fixture();
    const follower = addFollower(invalid);
    const increase = addAllocation(invalid, follower, '2026-02-22', 10_000, 25_000);
    increase.delta = 1;
    expect(() => refreshReviewFollowerLedgers(invalid)).toThrow('does not reconcile');
    const missing = fixture();
    addFollower(missing);
    addTrade(missing, '2026-02-20', 100);
    missing.cashflow.masterDays = [];
    expect(() => refreshReviewFollowerLedgers(missing)).toThrow('capital at risk');
  });

  test('rejects intraday or ambiguous same-day allocation events rather than claiming inaccurate TWR', () => {
    const intraday = fixture();
    const follower = addFollower(intraday);
    addAllocation(intraday, follower, '2026-02-21T12:00:00Z', 10_000, 15_000);
    expect(() => refreshReviewFollowerLedgers(intraday)).toThrow('UTC day start');
    const ambiguous = fixture();
    const other = addFollower(ambiguous);
    addAllocation(ambiguous, other, '2026-02-20', 10_000, 15_000);
    expect(() => refreshReviewFollowerLedgers(ambiguous)).toThrow('one allocation event');
  });

  test('replay retains existing immutable trade/fee objects and refuses a silent historical rewrite', () => {
    const state = fixture();
    addFollower(state);
    addTrade(state, '2026-02-20', 100);
    refreshReviewFollowerLedgers(state);
    const copy = state.cashflow.copiedTrades[0];
    const fee = state.cashflow.performanceFeeEvents[0];
    refreshReviewFollowerLedgers(state);
    expect(state.cashflow.copiedTrades[0]).toBe(copy);
    expect(state.cashflow.performanceFeeEvents[0]).toBe(fee);
    state.trades[0].grossPnl = 200;
    expect(() => refreshReviewFollowerLedgers(state)).toThrow('rewrite historical');
    expect(state.cashflow.copiedTrades[0]).toBe(copy);
    expect(state.cashflow.performanceFeeEvents[0]).toBe(fee);
  });

  test('rejects an insolvent copy scenario instead of silently skipping negative-equity ROI', () => {
    const state = fixture();
    addFollower(state);
    addTrade(state, '2026-02-20', -11_000, { quantity: 200, exitPrice: 45 });
    expect(() => refreshReviewFollowerLedgers(state)).toThrow('cannot fund continuing copy execution');
    expect(state.cashflow.copiedTrades).toHaveLength(0);
    expect(state.cashflow.performanceFeeEvents).toHaveLength(0);
  });

  test('rejects overlapping master positions instead of spending unclosed profit or double-counting free margin', () => {
    const state = fixture();
    addFollower(state);
    addTrade(state, '2026-02-20', 100);
    addTrade(state, '2026-02-20', 100, { openedAt: '2026-02-20T09:30:00Z', closedAt: '2026-02-20T10:30:00Z' });
    expect(() => refreshReviewFollowerLedgers(state)).toThrow('sequential master positions');
  });
});

describe('v7 explicit 64-follower review cohorts against the master ledger', () => {
  let state: CashflowReviewState;
  beforeAll(() => {
    state = createCashflowMasterState();
    populateReviewFollowers(state);
  });

  test('64 heterogeneous deposits actually sum to 7.2m and enforce the explicit policy timeline', () => {
    expect(state.followers).toHaveLength(64);
    expect(state.followers.every(follower => follower.active)).toBe(true);
    expect(total(state.followers.map(follower => follower.allocatedCapital))).toBe(cash(7_200_000));
    expect(state.followers.slice(0, 2).map(follower => follower.startingAllocation)).toEqual([5_000, 7_000]);
    expect(new Set(state.followers.map(follower => follower.allocatedCapital)).size).toBe(64);
    expect(state.followers.filter(follower => follower.allocatedCapital < 20_000)).toHaveLength(8);
    expect(state.followers.filter(follower => follower.allocatedCapital > 300_000)).toHaveLength(4);
    expect(state.followers.at(-1)?.allocatedCapital).toBe(132_500);
    for (const follower of state.followers) {
      if (follower.copyStartDate.slice(0, 10) >= '2026-03-01') expect(follower.startingAllocation).toBeGreaterThanOrEqual(20_000);
      expect(follower.currentEquity).not.toBe(follower.allocatedCapital);
    }
    expect(state.aumHistory[0]).toEqual({ date: '2025-08-21', aum: 12_000, followerCount: 2 });
    expect(state.aumHistory.at(-1)).toEqual({ date: '2026-09-05', aum: 7_200_000, followerCount: 64 });
    const joins = state.followers.map(follower => Date.parse(follower.copyStartDate));
    expect(new Set(joins.slice(1).map((join, index) => join - joins[index])).size).toBeGreaterThan(8);
    expect(state.followers.filter(follower => follower.copyStartDate.slice(0, 10) > '2026-08-29').length).toBeGreaterThanOrEqual(3);
  });

  test('independently reconstructs every follower profit, fee, volume, equity and HWM at fixed-point precision', () => {
    const masterTrades = new Map(state.trades.map(trade => [trade.id, trade]));
    const masterDays = new Map(state.cashflow.masterDays.map(day => [day.date, day]));
    for (const follower of state.followers) {
      const copies = state.cashflow.copiedTrades.filter(trade => trade.followerId === follower.id);
      const events = state.cashflow.performanceFeeEvents.filter(event => event.followerId === follower.id);
      const gross = total(copies.map(trade => trade.grossPnl));
      const fees = total(events.map(event => event.feeAmount));
      expect(cash(follower.grossPnl)).toBe(gross);
      expect(cash(follower.performanceFees)).toBe(fees);
      expect(cash(follower.netPnl)).toBe(gross - fees);
      expect(cash(follower.currentEquity)).toBe(cash(follower.allocatedCapital) + gross - fees);
      expect(cash(follower.copiedVolume)).toBe(total(copies.map(trade => trade.notional)));
      expect(follower.copiedTrades).toBe(copies.length);
      expect(follower.roi).toBeCloseTo(follower.netPnl / follower.startingAllocation * 100, 8);
      expect(copies.every(trade => Date.parse(trade.openedAt) >= Date.parse(follower.copyStartDate))).toBe(true);

      const days = new Map<string, number>();
      const feesByDate = new Map(events.map(event => [event.date, cash(event.feeAmount)]));
      let priorGross = 0;
      let paidFees = 0;
      let priorDay: string | undefined;
      for (const trade of copies) {
        expect(cash(trade.grossPnl)).toBe(cash(trade.grossPnlBeforeCosts) - cash(trade.tradingFees) - cash(trade.funding) - cash(trade.executionCost));
        const date = trade.closedAt.slice(0, 10);
        if (priorDay && priorDay !== date) paidFees += feesByDate.get(priorDay) ?? 0;
        const available = cash(follower.startingAllocation) + priorGross - paidFees;
        const master = masterTrades.get(trade.masterTradeId)!;
        const capital = masterDays.get(trade.openedAt.slice(0, 10))!.capitalAtRisk;
        const actualScale = Math.min(follower.startingAllocation, available / 10_000) / capital * follower.copyRatio;
        expect(trade.quantity).toBeCloseTo(master.quantity * actualScale, 8);
        expect(cash(trade.notional)).toBe(cash(trade.entryPrice * trade.quantity));
        expect(cash(trade.notional / master.leverage)).toBeLessThanOrEqual(available + 1);
        priorGross += cash(trade.grossPnl);
        expect(cash(follower.startingAllocation) + priorGross - paidFees).toBeGreaterThan(0);
        priorDay = date;
        days.set(date, (days.get(date) ?? 0) + cash(trade.grossPnl));
      }
      let pnl = 0;
      let high = 0;
      let feesToDate = 0;
      const expectedFees = [];
      for (const [date, dailyPnl] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        pnl += dailyPnl;
        if (pnl > high) {
          expectedFees.push({ date, eligible: pnl - high, fee: Math.round((pnl - high) * 0.1), before: high, after: pnl });
          feesToDate += Math.round((pnl - high) * 0.1);
          high = pnl;
        }
        expect(cash(follower.startingAllocation) + pnl - feesToDate).toBeGreaterThan(0);
      }
      expect(events.map(event => ({
        date: event.date, eligible: cash(event.eligibleProfit), fee: cash(event.feeAmount),
        before: cash(event.highWaterMarkBefore), after: cash(event.highWaterMarkAfter),
      }))).toEqual(expectedFees);
      expect(cash(follower.highWaterMark)).toBe(high);
    }
    expect(total(state.followers.map(follower => follower.grossPnl)) - total(state.followers.map(follower => follower.performanceFees)))
      .toBe(total(state.followers.map(follower => follower.netPnl)));
    expect(total(state.followers.map(follower => follower.performanceFees)))
      .toBe(total(state.cashflow.performanceFeeEvents.map(event => event.feeAmount)));
    expect(state.followers[0].roi).toBeGreaterThan(state.followers.at(-1)!.roi);
  });

  test('AUM is reconstructible from dated allocation events on every historical day', () => {
    for (const snapshot of state.aumHistory) {
      const balances = new Map<string, number>();
      for (const event of state.cashflow.followerAllocationEvents) {
        if (event.date.slice(0, 10) <= snapshot.date) balances.set(event.followerId, event.newAllocation);
      }
      expect(cash(snapshot.aum)).toBe(total([...balances.values()]));
      expect(snapshot.followerCount).toBe([...balances.values()].filter(balance => balance > 0).length);
    }
  });

  test('90-day advance adds trades/fees but preserves all prior histories and the same 64 cohorts', () => {
    const advanced = advanceCashflowMasterState(state, 90);
    refreshReviewFollowerLedgers(advanced);
    expect(advanced.cashflow.followerAllocationEvents).toEqual(state.cashflow.followerAllocationEvents);
    expect(advanced.followers).toHaveLength(64);
    expect(advanced.cashflow.copiedTrades.length).toBeGreaterThan(state.cashflow.copiedTrades.length);
    expect(advanced.cashflow.performanceFeeEvents.length).toBeGreaterThan(state.cashflow.performanceFeeEvents.length);
    expect(advanced.cashflow.copiedTrades.slice(0, state.cashflow.copiedTrades.length)).toEqual(state.cashflow.copiedTrades);
    expect(advanced.cashflow.performanceFeeEvents.slice(0, state.cashflow.performanceFeeEvents.length)).toEqual(state.cashflow.performanceFeeEvents);
    expect(advanced.aumHistory.slice(0, state.aumHistory.length)).toEqual(state.aumHistory);
    expect(advanced.aumHistory.at(-1)).toMatchObject({ aum: 7_200_000, followerCount: 64 });
    expect(total(advanced.followers.map(follower => follower.netPnl))).toBeGreaterThan(total(state.followers.map(follower => follower.netPnl)));
    const before = structuredClone(advanced.cashflow.followerAllocationEvents);
    populateReviewFollowers(advanced);
    expect(advanced.cashflow.followerAllocationEvents).toEqual(before);
  }, 30_000);
});
