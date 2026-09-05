import { createReviewSyntheticState } from './reviewSyntheticHistory';
import { calculateReviewPeriod, REVIEW_PERIODS, reviewSlice } from './reviewEconomics';
import type { CashflowReviewState } from './reviewEconomicsTypes';

/** Internal engineering report only; not imported into the public DTO/UI. */
export function reviewReconciliationReport(state: CashflowReviewState) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const r = (value: number, digits = 4) => Number(value.toFixed(digits));
  const allPnl = sum(state.trades.map(trade => trade.netPnl));
  const capitals = state.cashflow.masterDays.map(day => day.capitalAtRisk);
  return {
    scenario: 'ISOLATED_SYNTHETIC_REVIEW', stateVersion: state.version,
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
      };
    }),
    privateMasterAccount: {
      operatingRange: [Math.min(...capitals), Math.max(...capitals)],
      opening: state.cashflow.masterDays[0].openingEquity,
      closing: state.cashflow.masterDays.at(-1)!.closingEquity,
      deposits: r(sum(state.cashflow.masterCashFlows.filter(flow => flow.type === 'DEPOSIT').map(flow => flow.amount))),
      withdrawals: r(sum(state.cashflow.masterCashFlows.filter(flow => flow.type === 'WITHDRAWAL').map(flow => flow.amount))),
      withdrawalEvents: state.cashflow.masterCashFlows.filter(flow => flow.type === 'WITHDRAWAL').length,
    },
    reconciliation: {
      tradePnl: r(allPnl), dailyPnl: r(sum(state.dailyResults.map(day => day.realizedPnl))),
      cashflowAdjustedPnl: r(state.cashflow.masterDays.at(-1)!.cumulativeTradingPnl),
      equityIndexFactor: state.equityHistory.at(-1)!.equity / state.equityHistory[0].equity,
      aum: r(sum(state.followers.filter(follower => follower.active).map(follower => follower.allocatedCapital))),
      activeFollowers: state.followers.filter(follower => follower.active).length,
      copiedTrades: state.cashflow.copiedTrades.length,
      feeEvents: state.cashflow.performanceFeeEvents.length,
      allocations: state.cashflow.followerAllocationEvents.length,
      grandfatheredBelowCurrentMinimum: state.followers.filter(follower => follower.startingAllocation < state.cashflow.policy.currentCopyMinimum).length,
    },
    concentration: {
      largestDay: Math.max(...state.dailyResults.map(day => day.realizedPnl)),
      largestDayShareOfAll: Math.max(...state.dailyResults.map(day => day.realizedPnl)) / allPnl * 100,
      finalDay: state.dailyResults.at(-1)!.realizedPnl,
      finalSevenShareOfAll: sum(state.dailyResults.slice(-7).map(day => day.realizedPnl)) / allPnl * 100,
      negativeDays: state.dailyResults.filter(day => day.realizedPnl < 0).length,
      zeroDays: state.dailyResults.filter(day => day.numberOfTrades === 0).length,
    },
  };
}

if (require.main === module) {
  console.log(JSON.stringify(reviewReconciliationReport(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z'))), null, 2));
}
