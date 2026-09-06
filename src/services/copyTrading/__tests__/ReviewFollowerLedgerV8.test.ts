import { populateReviewFollowers, refreshReviewFollowerLedgers } from '../reviewFollowerLedger';
import { createCashflowMasterState } from '../reviewMasterLedger';
import { advanceSimpleReturnMasterState, createSimpleReturnMasterState } from '../reviewPerformanceV8';
import { calculateReviewPeriod, REVIEW_PERIODS, reviewSlice } from '../reviewEconomics';
import { reviewReconciliationReport } from '../reviewReconciliationReport';
import type { CashflowReviewState } from '../reviewEconomicsTypes';

const cash = (value: number) => Math.round(value * 10_000);
const sum = (values: number[]) => values.reduce((total, value) => total + cash(value), 0);
const plainSum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function createState(): CashflowReviewState {
  const state = createSimpleReturnMasterState();
  populateReviewFollowers(state);
  return state;
}

function followerSlice(state: CashflowReviewState, period: typeof REVIEW_PERIODS[number]) {
  const { cutoff, end } = reviewSlice(state, period);
  const inWindow = (date: string) => date.slice(0, 10) > cutoff && date.slice(0, 10) <= end;
  return {
    copied: state.cashflow.copiedTrades.filter(trade => inWindow(trade.closedAt)),
    fees: state.cashflow.performanceFeeEvents.filter(event => inWindow(event.date)),
  };
}

describe('v8 follower economics use the new trade ledger, never the public additive index', () => {
  let state: CashflowReviewState;
  beforeAll(() => { state = createState(); });

  test('preserves every authored v7 allocation and execution parameter without retaining old profits', () => {
    const legacy = createCashflowMasterState();
    populateReviewFollowers(legacy);
    const settings = (source: CashflowReviewState) => source.followers.map(follower => ({
      id: follower.id, copyStartDate: follower.copyStartDate, startingAllocation: follower.startingAllocation,
      allocatedCapital: follower.allocatedCapital, copyRatio: follower.copyRatio,
      slippageBps: follower.slippageBps, latencyMs: follower.latencyMs,
    }));
    expect(state.version).toBe(8);
    expect(state.trades).toHaveLength(471);
    expect(state.followers).toHaveLength(64);
    expect(settings(state)).toEqual(settings(legacy));
    expect(state.cashflow.followerAllocationEvents).toEqual(legacy.cashflow.followerAllocationEvents);
    expect(state.aumHistory).toEqual(legacy.aumHistory);
    expect(sum(state.followers.map(follower => follower.allocatedCapital))).toBe(cash(7_200_000));
    expect(state.cashflow.policy.performanceFeeRate).toBe(0.1);
    expect(state.cashflow.policy.copyMinimumPolicyEffectiveDate).toBe('2026-03-01');
    expect(sum(legacy.followers.map(follower => follower.netPnl))).toBe(cash(10_803_990.5431));
    expect(sum(legacy.cashflow.performanceFeeEvents.map(event => event.feeAmount))).toBe(cash(1_200_443.4346));
    expect(sum(state.followers.map(follower => follower.netPnl)))
      .not.toBe(sum(legacy.followers.map(follower => follower.netPnl)));
    expect(sum(state.cashflow.copiedTrades.map(trade => trade.notional)))
      .not.toBe(sum(legacy.cashflow.copiedTrades.map(trade => trade.notional)));
  });

  test('independently replays entry equity, trade costs, daily HWM fees and positive available margin for all 64 followers', () => {
    const masterTrades = new Map(state.trades.map(trade => [trade.id, trade]));
    const masterDays = new Map(state.cashflow.masterDays.map(day => [day.date, day]));
    for (const follower of state.followers) {
      const copied = state.cashflow.copiedTrades.filter(trade => trade.followerId === follower.id);
      const fees = state.cashflow.performanceFeeEvents.filter(event => event.followerId === follower.id);
      const expectedMasterIds = state.trades.filter(trade => Date.parse(trade.openedAt) >= Date.parse(follower.copyStartDate))
        .map(trade => trade.id);
      expect(copied.map(trade => trade.masterTradeId)).toEqual(expectedMasterIds);
      let gross = 0;
      let paid = 0;
      let high = 0;
      const expectedFees = [];
      const days = [...new Set(copied.map(trade => trade.closedAt.slice(0, 10)))];
      for (const date of days) {
        for (const copy of copied.filter(trade => trade.closedAt.slice(0, 10) === date)) {
          const master = masterTrades.get(copy.masterTradeId)!;
          const available = cash(follower.startingAllocation) + gross - paid;
          const capitalAtRisk = masterDays.get(date)!.capitalAtRisk;
          const scale = Math.min(follower.startingAllocation, available / 10_000) / capitalAtRisk * follower.copyRatio;
          const quantity = master.quantity * scale;
          expect(copy.quantity).toBe(quantity);
          expect(cash(copy.notional)).toBe(cash(master.entryPrice * quantity));
          expect(cash(copy.grossPnlBeforeCosts)).toBe(cash(master.grossPnl * scale));
          expect(cash(copy.tradingFees)).toBe(cash(master.fees * scale));
          expect(cash(copy.funding)).toBe(cash(master.funding * scale));
          const execution = cash(quantity * (master.entryPrice + master.exitPrice)
            * (follower.slippageBps + follower.latencyMs / 1000) / 10_000);
          expect(cash(copy.executionCost)).toBe(execution);
          expect(cash(copy.grossPnl)).toBe(cash(copy.grossPnlBeforeCosts) - cash(copy.tradingFees)
            - cash(copy.funding) - execution);
          expect(cash(copy.notional / master.leverage)).toBeLessThanOrEqual(available + 1);
          gross += cash(copy.grossPnl);
          expect(cash(follower.startingAllocation) + gross - paid).toBeGreaterThan(0);
        }
        if (gross > high) {
          const eligible = gross - high;
          const fee = Math.round(eligible * 0.1);
          expectedFees.push({ date, eligible, fee, before: high, after: gross });
          paid += fee;
          high = gross;
        }
        expect(cash(follower.startingAllocation) + gross - paid).toBeGreaterThan(0);
      }
      expect(fees.map(event => ({ date: event.date, eligible: cash(event.eligibleProfit), fee: cash(event.feeAmount),
        before: cash(event.highWaterMarkBefore), after: cash(event.highWaterMarkAfter) }))).toEqual(expectedFees);
      expect(cash(follower.grossPnl)).toBe(gross);
      expect(cash(follower.performanceFees)).toBe(paid);
      expect(cash(follower.netPnl)).toBe(gross - paid);
      expect(cash(follower.realizedPnl)).toBe(gross - paid);
      expect(cash(follower.currentEquity)).toBe(cash(follower.allocatedCapital) + gross - paid);
      expect(cash(follower.copiedVolume)).toBe(sum(copied.map(trade => trade.notional)));
      expect(follower.copiedTrades).toBe(copied.length);
      expect(cash(follower.highWaterMark)).toBe(high);
      // The allocation itself is unchanged: linked net account returns telescope
      // to net profit / contribution, independently of the master's public index.
      expect(follower.roi).toBeCloseTo(follower.netPnl / follower.startingAllocation * 100, 8);
    }
  }, 30_000);

  test('copied financial records are independent of cosmetic public-index levels', () => {
    const replayed = structuredClone(state);
    replayed.equityHistory = replayed.equityHistory.map((point, index) => ({ ...point, equity: 90_000 + index * 100 }));
    refreshReviewFollowerLedgers(replayed);
    expect(replayed.cashflow.copiedTrades).toEqual(state.cashflow.copiedTrades);
    expect(replayed.cashflow.performanceFeeEvents).toEqual(state.cashflow.performanceFeeEvents);
    expect(replayed.followers).toEqual(state.followers);
  });

  test.each([7, 30, 90])('+%i days appends actual copied turnover and fees without changing any existing records', days => {
    const advanced = advanceSimpleReturnMasterState(state, days);
    refreshReviewFollowerLedgers(advanced);
    expect(advanced.trades.slice(0, state.trades.length)).toEqual(state.trades);
    expect(advanced.cashflow.masterCashFlows.slice(0, state.cashflow.masterCashFlows.length)).toEqual(state.cashflow.masterCashFlows);
    expect(advanced.cashflow.copiedTrades.slice(0, state.cashflow.copiedTrades.length)).toEqual(state.cashflow.copiedTrades);
    expect(advanced.cashflow.performanceFeeEvents.slice(0, state.cashflow.performanceFeeEvents.length)).toEqual(state.cashflow.performanceFeeEvents);
    expect(advanced.cashflow.followerAllocationEvents).toEqual(state.cashflow.followerAllocationEvents);
    expect(advanced.aumHistory.slice(0, state.aumHistory.length)).toEqual(state.aumHistory);
    expect(advanced.followers).toHaveLength(64);
    expect(advanced.aumHistory.at(-1)).toMatchObject({ aum: 7_200_000, followerCount: 64 });
    expect(advanced.cashflow.copiedTrades.length).toBeGreaterThan(state.cashflow.copiedTrades.length);
    expect(advanced.cashflow.performanceFeeEvents.length).toBeGreaterThan(state.cashflow.performanceFeeEvents.length);
    const newCopies = advanced.cashflow.copiedTrades.slice(state.cashflow.copiedTrades.length);
    expect(newCopies.every(trade => Date.parse(trade.openedAt) > Date.parse(state.simulatedAt))).toBe(true);
    expect(sum(newCopies.map(trade => trade.notional))).toBeGreaterThan(0);
    expect(sum(advanced.followers.map(follower => follower.copiedVolume)) - sum(state.followers.map(follower => follower.copiedVolume)))
      .toBe(sum(newCopies.map(trade => trade.notional)));
    const newFees = advanced.cashflow.performanceFeeEvents.slice(state.cashflow.performanceFeeEvents.length);
    expect(sum(advanced.followers.map(follower => follower.netPnl)) - sum(state.followers.map(follower => follower.netPnl)))
      .toBe(sum(newCopies.map(trade => trade.grossPnl)) - sum(newFees.map(event => event.feeAmount)));
    expect(sum(advanced.followers.map(follower => follower.netPnl))).not.toBe(sum(state.followers.map(follower => follower.netPnl)));
    if (days === 7) expect(plainSum(advanced.dailyResults.slice(-7).map(day => day.dailyReturn)) * 100).toBeCloseTo(72, 5);
    for (const period of REVIEW_PERIODS) {
      const slice = followerSlice(advanced, period);
      const economics = calculateReviewPeriod(advanced, period);
      expect(cash(economics.grossFollowersPnl)).toBe(sum(slice.copied.map(trade => trade.grossPnl)));
      expect(cash(economics.netFollowersPnl)).toBe(sum(slice.copied.map(trade => trade.grossPnl)) - sum(slice.fees.map(event => event.feeAmount)));
    }
    expect(advanced.followers.every(follower => follower.currentEquity > 0)).toBe(true);
  }, 30_000);

  test('serialization, replay and split progression are deterministic and do not create a new cohort', () => {
    const first = advanceSimpleReturnMasterState(state, 3);
    refreshReviewFollowerLedgers(first);
    const split = advanceSimpleReturnMasterState(JSON.parse(JSON.stringify(first)) as CashflowReviewState, 4);
    refreshReviewFollowerLedgers(split);
    const together = advanceSimpleReturnMasterState(state, 7);
    refreshReviewFollowerLedgers(together);
    expect(split.cashflow.copiedTrades).toEqual(together.cashflow.copiedTrades);
    expect(split.cashflow.performanceFeeEvents).toEqual(together.cashflow.performanceFeeEvents);
    expect(split.followers).toEqual(together.followers);
    const before = JSON.stringify(split.cashflow);
    populateReviewFollowers(split);
    expect(JSON.stringify(split.cashflow)).toBe(before);
  });

  test('internal report reconciles all periods, non-overlapping previous week, real counts and private capital', () => {
    const report = reviewReconciliationReport(state);
    expect(report.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    expect(report.reconciliation.equityIndexFactor).toBeUndefined();
    expect(JSON.stringify(report.reconciliation)).not.toContain('equityIndexFactor');
    expect(report.reconciliation.simpleRoiFromLedger).toBeCloseTo(3727, 5);
    expect(report.reconciliation.performanceIndex.kind).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN_POINTS');
    expect(report.execution).toMatchObject({ winningTrades: 458, losingTrades: 13, zeroPnlTrades: 0 });
    expect(report.execution.exactWinRate).toBe(458 / 471 * 100);
    expect(report.execution.averagePnl).toBe(Number((4_711_027 / 471).toFixed(4)));
    expect(report.execution.averageHoldingMinutes).toBe(Number((plainSum(state.trades.map(trade => trade.holdingTimeMinutes)) / 471).toFixed(4)));
    expect(report.execution.averageTradesPerCalendarWeek).toBeCloseTo(471 / 380 * 7, 10);
    expect(cash(report.reconciliation.grossFollowersPnl)).toBe(sum(state.cashflow.copiedTrades.map(trade => trade.grossPnl)));
    expect(cash(report.reconciliation.performanceFeeEarnings)).toBe(sum(state.cashflow.performanceFeeEvents.map(event => event.feeAmount)));
    expect(cash(report.reconciliation.netFollowersPnl)).toBe(cash(report.reconciliation.grossFollowersPnl) - cash(report.reconciliation.performanceFeeEarnings));
    expect(report.reconciliation.activeFollowers).toBe(64);
    expect(report.reconciliation.aum).toBe(7_200_000);
    const previousWeek = state.dailyResults.slice(-14, -7);
    expect(report.previousNonoverlapping7D.roi).toBeCloseTo(plainSum(previousWeek.map(day => day.dailyReturn)) * 100, 8);
    expect(report.previousNonoverlapping7D.roi).toBeCloseTo(115, 5);
    for (const row of report.periods) {
      const slice = reviewSlice(state, row.period);
      const copiedSlice = followerSlice(state, row.period);
      expect(cash(row.masterPnl)).toBe(sum(slice.trades.map(trade => trade.netPnl)));
      expect(row.masterTradingVolume).toBe(Number(plainSum(slice.trades.map(trade => trade.entryPrice * trade.quantity)).toFixed(2)));
      expect(row.copiedTradingVolume).toBe(Number((sum(copiedSlice.copied.map(trade => trade.notional)) / 10_000).toFixed(2)));
      expect(cash(row.grossFollowersPnl)).toBe(sum(copiedSlice.copied.map(trade => trade.grossPnl)));
      expect(cash(row.performanceFeeEarnings)).toBe(sum(copiedSlice.fees.map(event => event.feeAmount)));
    }
    const capital = report.privateMasterAccount;
    expect(capital.maximumWeeklyTargetGrowthPct).toBeLessThanOrEqual(1.000001);
    expect(cash(capital.closing)).toBe(cash(capital.deposits) + cash(report.reconciliation.tradePnl) - cash(capital.withdrawals));
    expect(capital.initialOperatingCapitalTarget).toBe(state.cashflow.masterDays[0].operatingCapitalTarget);
    expect(capital.endingOperatingCapitalTarget).toBe(state.cashflow.masterDays.at(-1)!.nextOperatingCapitalTarget);
  });
});
