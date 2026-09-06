import { createReviewSyntheticState } from './reviewSyntheticHistory';
import { calculateReviewPeriod, REVIEW_PERIODS, reviewSlice } from './reviewEconomics';
import type { CashflowReviewState } from './reviewEconomicsTypes';

/** Internal engineering report only; not imported into the public DTO/UI. */
export function reviewReconciliationReport(state: CashflowReviewState) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const r = (value: number, digits = 4) => Number(value.toFixed(digits));
  const allPnl = sum(state.trades.map(trade => trade.netPnl));
  const capitals = state.cashflow.masterDays.map(day => day.capitalAtRisk);
  const firstDay = state.cashflow.masterDays[0];
  const lastDay = state.cashflow.masterDays.at(-1)!;
  const indexStart = state.equityHistory[0].equity;
  const indexEnd = state.equityHistory.at(-1)!.equity;
  const simple = state.version === 8;
  const previousWeekEnd = new Date(Date.parse(state.simulatedAt) - 7 * 86_400_000).toISOString();
  const previousWeekState = { ...state, simulatedAt: previousWeekEnd };
  const previousWeek = reviewSlice(previousWeekState, '7D');
  const initialTarget = firstDay.operatingCapitalTarget ?? firstDay.capitalAtRisk;
  const endingTarget = lastDay.nextOperatingCapitalTarget ?? lastDay.operatingCapitalTarget ?? lastDay.capitalAtRisk;
  const weeklyChanges = state.cashflow.masterDays.filter(day => day.operatingCapitalTarget !== undefined
    && day.nextOperatingCapitalTarget !== undefined && day.nextOperatingCapitalTarget !== day.operatingCapitalTarget);
  const outcomes = (trades: typeof state.trades) => {
    const winningTrades = trades.filter(trade => trade.netPnl > 0).length;
    const losingTrades = trades.filter(trade => trade.netPnl < 0).length;
    const zeroPnlTrades = trades.length - winningTrades - losingTrades;
    return { winningTrades, losingTrades, zeroPnlTrades,
      exactWinRate: winningTrades / Math.max(1, trades.length) * 100,
      averagePnl: r(sum(trades.map(trade => trade.netPnl)) / Math.max(1, trades.length)),
      averageHoldingMinutes: r(sum(trades.map(trade => trade.holdingTimeMinutes)) / Math.max(1, trades.length)),
    };
  };
  return {
    scenario: 'ISOLATED_SYNTHETIC_REVIEW', stateVersion: state.version,
    methodology: state.cashflow.policy.methodology,
    inception: state.initialEquityDate, asOf: state.simulatedAt, policy: state.cashflow.policy,
    periods: REVIEW_PERIODS.map(period => {
      const economics = calculateReviewPeriod(state, period);
      const selected = reviewSlice(state, period);
      const capital = state.cashflow.masterDays.filter(day => day.date > selected.cutoff && day.date <= selected.end);
      const average = sum(capital.map(day => day.capitalAtRisk)) / Math.max(1, capital.length);
      return { period, ...economics, averageDeployedCapital: r(average),
        masterTurnoverToAverageDeployedCapital: r(economics.masterTradingVolume / average),
        masterTrades: selected.trades.length,
        winRate: r(selected.trades.filter(trade => trade.netPnl > 0).length / Math.max(1, selected.trades.length) * 100),
        ...outcomes(selected.trades),
      };
    }),
    previousNonoverlapping7D: {
      start: previousWeek.daily[0]?.date ?? null,
      end: previousWeek.end,
      ...calculateReviewPeriod(previousWeekState, '7D'),
      masterTrades: previousWeek.trades.length,
      ...outcomes(previousWeek.trades),
    },
    privateMasterAccount: {
      operatingRange: [Math.min(...capitals), Math.max(...capitals)],
      opening: firstDay.openingEquity,
      closing: lastDay.closingEquity,
      deposits: r(sum(state.cashflow.masterCashFlows.filter(flow => flow.type === 'DEPOSIT').map(flow => flow.amount))),
      withdrawals: r(sum(state.cashflow.masterCashFlows.filter(flow => flow.type === 'WITHDRAWAL').map(flow => flow.amount))),
      withdrawalEvents: state.cashflow.masterCashFlows.filter(flow => flow.type === 'WITHDRAWAL').length,
      initialOperatingCapitalTarget: initialTarget,
      endingOperatingCapitalTarget: endingTarget,
      totalRetainedOperatingProfit: r(sum(state.cashflow.masterDays.map(day => day.retainedProfit ?? 0))),
      endingCashAboveOperatingTarget: r(lastDay.closingEquity - endingTarget),
      maximumWeeklyTargetGrowthPct: weeklyChanges.length ? Math.max(...weeklyChanges.map(day =>
        (day.nextOperatingCapitalTarget! / day.operatingCapitalTarget! - 1) * 100)) : 0,
      weeklyTargetChanges: weeklyChanges.map(day => ({ date: day.date,
        currentTarget: day.operatingCapitalTarget, nextTarget: day.nextOperatingCapitalTarget,
        retainedProfit: day.retainedProfit ?? 0, withdrawal: day.withdrawals,
        growthPct: (day.nextOperatingCapitalTarget! / day.operatingCapitalTarget! - 1) * 100,
      })),
    },
    reconciliation: {
      tradePnl: r(allPnl), dailyPnl: r(sum(state.dailyResults.map(day => day.realizedPnl))),
      cashflowAdjustedPnl: r(state.cashflow.masterDays.at(-1)!.cumulativeTradingPnl),
      // A ratio of v8 additive index levels is NOT a geometric return factor.
      // Omit the legacy factor in v8 JSON instead of giving it a false name.
      equityIndexFactor: simple ? undefined : indexEnd / indexStart,
      dailyReturnSum: sum(state.dailyResults.map(day => day.dailyReturn)),
      simpleRoiFromLedger: simple ? sum(state.dailyResults.map(day => day.dailyReturn)) * 100 : undefined,
      performanceIndex: { start: indexStart, end: indexEnd, change: indexEnd - indexStart,
        kind: simple ? 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN_POINTS' : 'UNITIZED_TWR_INDEX' },
      aum: r(sum(state.followers.filter(follower => follower.active).map(follower => follower.allocatedCapital))),
      activeFollowers: state.followers.filter(follower => follower.active).length,
      copiedTrades: state.cashflow.copiedTrades.length,
      feeEvents: state.cashflow.performanceFeeEvents.length,
      allocations: state.cashflow.followerAllocationEvents.length,
      grandfatheredBelowCurrentMinimum: state.followers.filter(follower => follower.startingAllocation < state.cashflow.policy.currentCopyMinimum).length,
      grossFollowersPnl: r(sum(state.followers.map(follower => follower.grossPnl))),
      performanceFeeEarnings: r(sum(state.cashflow.performanceFeeEvents.map(event => event.feeAmount))),
      netFollowersPnl: r(sum(state.followers.map(follower => follower.netPnl))),
      followerEquity: r(sum(state.followers.map(follower => follower.currentEquity))),
    },
    execution: {
      masterGrossPnl: r(sum(state.trades.map(trade => trade.grossPnl))),
      masterTradingFees: r(sum(state.trades.map(trade => trade.fees))),
      masterFunding: r(sum(state.trades.map(trade => trade.funding))),
      followerGrossBeforeCosts: r(sum(state.cashflow.copiedTrades.map(trade => trade.grossPnlBeforeCosts))),
      followerTradingFees: r(sum(state.cashflow.copiedTrades.map(trade => trade.tradingFees))),
      followerFunding: r(sum(state.cashflow.copiedTrades.map(trade => trade.funding))),
      followerExecutionCost: r(sum(state.cashflow.copiedTrades.map(trade => trade.executionCost))),
      leverageCounts: [...new Set(state.trades.map(trade => trade.leverage))].sort((a, b) => a - b)
        .map(leverage => ({ leverage, count: state.trades.filter(trade => trade.leverage === leverage).length })),
      averageTradesPerCalendarWeek: state.trades.length / Math.max(1, state.dailyResults.length) * 7,
      ...outcomes(state.trades),
    },
    concentration: {
      largestDay: Math.max(...state.dailyResults.map(day => day.realizedPnl)),
      largestDayShareOfAll: Math.max(...state.dailyResults.map(day => day.realizedPnl)) / allPnl * 100,
      finalDay: state.dailyResults.at(-1)!.realizedPnl,
      finalSevenShareOfAll: sum(state.dailyResults.slice(-7).map(day => day.realizedPnl)) / allPnl * 100,
      negativeDays: state.dailyResults.filter(day => day.realizedPnl < 0).length,
      zeroDays: state.dailyResults.filter(day => day.numberOfTrades === 0).length,
      largestDailyReturnPct: Math.max(...state.dailyResults.map(day => day.dailyReturn)) * 100,
      smallestDailyReturnPct: Math.min(...state.dailyResults.map(day => day.dailyReturn)) * 100,
    },
  };
}

if (require.main === module) {
  console.log(JSON.stringify(reviewReconciliationReport(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z'))), null, 2));
}
