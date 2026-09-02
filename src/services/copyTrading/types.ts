export type SyntheticMode = 'REAL_TIME' | 'FAST_FORWARD';

export interface SyntheticTrade {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  openedAt: string;
  closedAt: string;
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  returnPct: number;
  holdingTimeMinutes: number;
  riskR: number;
  result: 'WIN' | 'LOSS';
}

export interface EquitySnapshot {
  date: string;
  equity: number;
}

export interface AumSnapshot {
  date: string;
  aum: number;
}

export interface DailyResult {
  date: string;
  startEquity: number;
  endEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  funding: number;
  numberOfTrades: number;
  wins: number;
  losses: number;
  dailyReturn: number;
  drawdown: number;
}

export interface SyntheticFollower {
  id: string;
  displayName: string;
  copyStartDate: string;
  allocatedCapital: number;
  currentEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  roi: number;
  copiedTrades: number;
  copyRatio: number;
  slippageBps: number;
  latencyMs: number;
  active: boolean;
}

export interface SyntheticCopyState {
  version: 1;
  seed: number;
  rngState: number;
  simulatedAt: string;
  mode: SyntheticMode;
  initialEquityDate: string;
  trades: SyntheticTrade[];
  equityHistory: EquitySnapshot[];
  aumHistory: AumSnapshot[];
  dailyResults: DailyResult[];
  followers: SyntheticFollower[];
}

export type SyntheticFollowerEvent =
  | { type: 'NEW'; displayName: string; allocatedCapital: number }
  | { type: 'INCREASE'; followerId: string; amount: number }
  | { type: 'DECREASE'; followerId: string; amount: number }
  | { type: 'STOP'; followerId: string };

export interface PeriodSummary {
  period: string;
  roi: number;
  pnl: number;
  trades: number;
  winRate: number;
  maxDrawdown: number;
}

export interface SyntheticAnalytics {
  roi7: number;
  roi30: number;
  roi90: number;
  roiAll: number;
  winRate: number;
  maximumDrawdown: number;
  averageWinR: number;
  averageLossR: number;
  plRatio: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  annualizedVolatility: number;
  totalTradingDays: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  tradesLast7D: number;
  tradesLast30D: number;
  averageTradesPerDay: number;
  averageTradesPerWeek: number;
  averageHoldingTimeMinutes: number;
  medianHoldingTimeMinutes: number;
  longestTradeMinutes: number;
  shortestTradeMinutes: number;
  masterPnl: number;
  followerPnl: number;
  followerPnl7: number;
  followerPnl30: number;
  followerPnl90: number;
  aum: number;
  activeFollowers: number;
  tradingVolume: number;
  allTime: {
    roi: number;
    pnl: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    maximumDrawdown: number;
    profitFactor: number;
    sharpe: number;
    sortino: number;
    tradingDays: number;
    averageTrade: number;
    followersPnl: number;
    aum: number;
  };
}

export interface SyntheticCopyResponse {
  trader: { id: string; name: string; vip: boolean };
  simulation: { seed: number; mode: SyntheticMode; simulatedAt: string };
  analytics: SyntheticAnalytics;
  trades: SyntheticTrade[];
  equityHistory: EquitySnapshot[];
  aumHistory: AumSnapshot[];
  dailyResults: DailyResult[];
  followers: SyntheticFollower[];
  weekly: PeriodSummary[];
  monthly: PeriodSummary[];
}
