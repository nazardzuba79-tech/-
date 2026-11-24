export type RiskLevel = "Низкий" | "Умеренный" | "Повышенный";

export type StrategyCategory =
  | "Quantitative Intelligence"
  | "Grid"
  | "DCA"
  | "Momentum"
  | "Market Neutral"
  | "Rebalance"
  | "Breakout";

export type IntelligenceBucket =
  | "Лидеры доходности"
  | "Количественные стратегии"
  | "Трендовые стратегии"
  | "Сбалансированные стратегии"
  | "Портфельные стратегии";

export type TimeframeKey = "7D" | "30D" | "90D" | "1Y" | "ALL";

export interface PerformancePoint {
  date: string;
  value: number; // Cumulative model return %
  drawdown: number; // Drawdown from peak %
  benchmark?: number; // Optional baseline reference %
}

export interface MonthlyReturnEntry {
  year: number;
  monthIndex: number; // 0..11
  monthShort: string;
  monthFull: string;
  returnPct: number;
  tradesCount: number;
  maxDrawdownPct: number;
}

export interface DistributionBucket {
  range: string;
  count: number;
  isPositive: boolean;
}

export interface FinancialStatistics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  recoveryFactor: number;
  annualizedVolatility: number;
  avgWinPct: number;
  avgLossPct: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  expectancyPct: number;
}

export interface Strategy {
  id: string;
  rank: number;
  name: string;
  author: string;
  authorRole: string;
  avatar: string | null;
  source: "model" | "verified" | "unavailable";
  netPnl: number | null;
  verified?: Extract<
    import("../../../../../src/shared/thomasPerformance").BotHistory,
    { status: "verified" }
  >;
  logoUrl?: string | null;
  logoId?: string;
  isVip: boolean;
  isFeatured: boolean;
  market: string;
  category: StrategyCategory;
  risk: RiskLevel;
  intelligenceBuckets: IntelligenceBucket[];
  shortDescription: string;
  methodologySummary: string;
  accentColor: string;
  secondaryColor: string;
  // Internally consistent model metrics
  return30d: number;
  return1yArithmetic: number;
  returnAllArithmetic: number;
  maxDrawdown: number;
  winRate: number;
  tradesCount: number;
  minInvestmentUsdt: number;
  horizonLabel: string;
  behaviorTag: string;
  // Time-series curves
  series: Record<TimeframeKey, PerformancePoint[]>;
  // Detailed analytics
  monthly24: MonthlyReturnEntry[];
  statistics: Partial<FinancialStatistics>;
  distribution: DistributionBucket[];
  riskControls: string[];
  architecturePoints: string[];
}

export interface AcademyArticle {
  id: string;
  title: string;
  category: string;
  readTime: string;
  summary: string;
  keyTakeaways: string[];
  bodyParagraphs: string[];
  illustrationType: "algorithmic" | "quant-risk" | "selection";
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  topic: string;
}

export interface StudioDraftStrategy {
  id: string;
  name: string;
  description: string;
  market: string;
  category: StrategyCategory;
  risk: RiskLevel;
  minInvestmentUsdt: number;
  maxDrawdownStop: number;
  lookbackWindow: number;
  leverageCap: string;
  rebalanceInterval: string;
  status: "Черновик" | "Опубликована";
  visibility: "Публичная в Marketplace" | "Только по приглашению";

  customLogoUrl?: string | null;
  presetLogoId: string;
  updatedAt: string;
}
