import type { SyntheticCopyState, SyntheticFollower } from './types';

/** Isolated synthetic review accounting. Never a real account/Wallet ledger. */
export interface MasterCapitalDay {
  date: string;
  /** v8: fixed within the strategy week, distinct from accumulated account cash. */
  operatingCapitalTarget?: number;
  nextOperatingCapitalTarget?: number;
  retainedProfit?: number;
  openingEquity: number;
  capitalAtRisk: number;
  tradingPnl: number;
  deposits: number;
  withdrawals: number;
  closingEquity: number;
  cumulativeTradingPnl: number;
  cumulativeDeposits: number;
  cumulativeWithdrawals: number;
}
export interface MasterCashFlow {
  id: string; date: string; timing: 'BEFORE_TRADING' | 'AFTER_TRADING';
  type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number;
}
export interface FollowerAllocationEvent {
  id: string; followerId: string; date: string;
  oldAllocation: number; delta: number; newAllocation: number;
  type: 'JOIN' | 'INCREASE' | 'DECREASE' | 'STOP';
}
export interface CopiedTrade {
  id: string; followerId: string; masterTradeId: string;
  openedAt: string; closedAt: string;
  notional: number; quantity: number; entryPrice: number; exitPrice: number;
  grossPnlBeforeCosts: number; tradingFees: number; funding: number;
  executionCost: number; grossPnl: number;
}
export interface PerformanceFeeEvent {
  id: string; followerId: string; date: string; eligibleProfit: number;
  feeRate: number; feeAmount: number; highWaterMarkBefore: number; highWaterMarkAfter: number;
}
export interface ReviewFollower extends SyntheticFollower {
  startingAllocation: number; grossPnl: number; performanceFees: number;
  netPnl: number; copiedVolume: number; highWaterMark: number;
}
export type ReviewReturnMethodology = 'DAILY_TWR' | 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN';
export interface ReviewEconomicsPolicy {
  methodology: ReviewReturnMethodology; performanceFeeRate: number;
  feeCrystallization: string; copyMinimumPolicyEffectiveDate: string;
  currentCopyMinimum: number;
  holidays: { start: string; end: string; reason: string }[];
}
export interface CashflowLedger {
  policy: ReviewEconomicsPolicy;
  masterDays: MasterCapitalDay[];
  masterCashFlows: MasterCashFlow[];
  followerAllocationEvents: FollowerAllocationEvent[];
  copiedTrades: CopiedTrade[];
  performanceFeeEvents: PerformanceFeeEvent[];
}
export interface CashflowReviewState extends SyntheticCopyState {
  version: 7 | 8;
  followers: ReviewFollower[];
  cashflow: CashflowLedger;
}
export type ReviewPeriod = '7D' | '30D' | '90D' | 'ALL';
export interface ReviewPeriodEconomics {
  roi: number; masterPnl: number; masterTradingVolume: number;
  copiedTradingVolume: number; grossFollowersPnl: number;
  performanceFeeEarnings: number; netFollowersPnl: number;
  activeTradingDays: number; calendarDays: number;
  sharpe: number | null; sortino: number | null; profitFactor: number | null;
  maximumDrawdown: number; annualizedVolatility: number;
}
/** Public projection intentionally excludes private master capital/cash flows. */
export interface ReviewEconomicsResponse {
  methodology: ReviewReturnMethodology; performanceFeeRate: number;
  policy: ReviewEconomicsPolicy;
  periods: Record<ReviewPeriod, ReviewPeriodEconomics>;
  cumulativePnlHistory: { date: string; pnl: number }[];
}
