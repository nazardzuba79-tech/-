import type { MonthlyPerformanceTable } from './monthlyCopyPerformance';

export const THOMAS_STRATEGY = 'thomas-quant-ai';
export const BOT_PERIODS = ['7D', '30D', '90D', '1Y', 'ALL'] as const;
export type BotPeriod = typeof BOT_PERIODS[number];

export interface BotPeriodResult {
  firstDate: string;
  lastDate: string;
  roi: number;
  netPnl: number;
  realizedPnl: number | null;
  unrealizedChange: number | null;
  fees: number | null;
  trades: number;
  winRate: number | null;
  drawdown: number;
  /** Daily compounded return in %, starting with the opening reference point. */
  series: number[];
  /** UTC dates of daily observations following the initial reference point. */
  observationDates?: string[];
}

export type BotHistory = { status: 'unavailable' } | {
  status: 'verified';
  botId: 'range';
  strategyId: typeof THOMAS_STRATEGY;
  marketScope?: 'XRP/USDT' | 'multi-asset';
  portfolio?: { asOf: string; grossPct: number; netPct: number; weights: { asset: string; pct: number }[] };
  inceptionDate: string;
  asOf: string;
  periods: Record<BotPeriod, BotPeriodResult>;
  monthly: MonthlyPerformanceTable;
};
