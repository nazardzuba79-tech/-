export type DecimalString = string;
export type Side = 'LONG' | 'SHORT';
export interface RiskTier {
  maxNotional: DecimalString;
  maintenanceRate: DecimalString;
  deduction: DecimalString;
  maxLeverage?: DecimalString;
}
export interface ModelProfile {
  pricingModelVersion: string;
  feeModelVersion: string;
  riskModelVersion: string;
  takerFeeRate: DecimalString;
  makerFeeRate: DecimalString;
  liquidationFeeRate: DecimalString;
  slippageBps: DecimalString;
  riskTiers: RiskTier[];
  assumptions: string[];
}
export interface ContractRules {
  symbol: string;
  tickSize: DecimalString;
  qtyStep: DecimalString;
  minOrderQty: DecimalString;
  maxOrderQty: DecimalString;
  maxMarketOrderQty: DecimalString;
  minNotionalValue: DecimalString;
  minLeverage: DecimalString;
  maxLeverage: DecimalString;
  leverageStep: DecimalString;
}
export interface PositionInput {
  side: Side;
  quantity: DecimalString;
  entryPrice: DecimalString;
  markPrice: DecimalString;
  leverage: DecimalString;
  /** Remaining collateral, including closing-fee reserve, AFTER separately journaled charges. */
  allocatedMargin?: DecimalString;
  /** Contribution-based remaining collateral, excluding funding/realized transfers. */
  roiMarginBasis?: DecimalString;
  openingFees?: DecimalString;
  closingFees?: DecimalString;
  /** Signed cash flow: receipt positive, payment negative. Already applied to collateral. */
  fundingNet?: DecimalString;
  realizedGross?: DecimalString;
  profile: ModelProfile;
}
export interface FinancialSnapshot {
  entryNotional: DecimalString;
  markNotional: DecimalString;
  baseInitialMargin: DecimalString;
  closeFeeReserve: DecimalString;
  allocatedMargin: DecimalString;
  maintenanceMargin: DecimalString;
  equity: DecimalString;
  unrealizedPnl: DecimalString;
  realizedGross: DecimalString;
  netPnl: DecimalString;
  roiMarginBasis: DecimalString;
  roiPercent: DecimalString | null;
  liquidationPrice: DecimalString | null;
  liquidatable: boolean;
}
export interface Candle {
  timestamp: number;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
}
/** The browser sends only the identity; price and effective time are resolved by the server. */
export interface CandleSelection {
  source: 'BYBIT_LINEAR'; interval: string; openTime: number; pricePoint: 'OPEN' | 'CLOSE';
}
export interface ResolvedCandleSelection extends CandleSelection {
  symbol: string; intervalMs: number; closeTime: number; effectiveAt: number; price: DecimalString;
  candle: Candle; fetchedAt: number; verification: 'VERIFIED';
}
export interface ReplayCheckpoint {
  version: 1; identity: string; nextTime: number; boundaryProcessed: boolean;
  free: DecimalString; margin: DecimalString; basisRemaining: DecimalString; basisClosed: DecimalString;
  takeProfit: DecimalString | null; stopLoss: DecimalString | null;
}
export interface FundingEvent { timestamp: number; rate: DecimalString; markPrice: DecimalString }
export interface HistoricalData {
  tradeCandles: Candle[];
  markCandles: Candle[];
  fundingEvents: FundingEvent[];
  expectedFundingTimestamps: number[];
  intervalMs: number;
  complete: boolean;
  issues?: string[];
}
export type ScenarioEvent =
  | { id: string; effectiveAt: number; kind: 'MARGIN'; amount: DecimalString }
  | { id: string; effectiveAt: number; kind: 'CLOSE'; quantity: DecimalString }
  | { id: string; effectiveAt: number; kind: 'TPSL'; takeProfit: DecimalString | null; stopLoss: DecimalString | null };
export interface ReplayInput {
  scenarioId: string;
  symbol: string;
  side: Side;
  quantity: DecimalString;
  leverage: DecimalString;
  createdAt: number;
  /** Current calculation wall time on an advance; original creation time remains immutable. */
  evaluatedAt?: number;
  requestedOpenedAt: number;
  requestedClosedAt?: number;
  asOf: number;
  allocatedCapital: DecimalString;
  manualEntryPrice?: DecimalString;
  /** V2 exact selected OHLC point; never accepted as a browser-provided price. */
  candleEntry?: ResolvedCandleSelection;
  candleClose?: ResolvedCandleSelection;
  /** Trusted persisted result, including its append-only journal and resume cursor. */
  resume?: ReplayResult;
  takeProfit?: DecimalString | null;
  stopLoss?: DecimalString | null;
  events?: ScenarioEvent[];
  data: HistoricalData;
  profile: ModelProfile;
}
export interface ReplayFill {
  id: string;
  effectiveAt: number;
  kind: 'OPEN' | 'CLOSE' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
  quantity: DecimalString;
  price: DecimalString;
  fee: DecimalString;
  realizedGross: DecimalString;
}
export interface ReplayJournalEntry {
  id: string;
  effectiveAt: number;
  kind: 'OPEN_FEE' | 'CLOSE_FEE' | 'FUNDING' | 'REALIZED_PNL' | 'MARGIN' | 'LIQUIDATION_FEE';
  amount: DecimalString;
}
export interface ReplayResult {
  scenarioId: string;
  createdAt: number;
  effectiveOpenedAt: number | null;
  effectiveClosedAt: number | null;
  asOf: number;
  evaluatedThrough: number | null;
  mode: 'HISTORICAL_REPLAY';
  verification: 'VERIFIED' | 'INCOMPLETE' | 'AMBIGUOUS';
  status: 'NOT_OPENED' | 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  issues: string[];
  assumptions: string[];
  pricingModelVersion: string;
  feeModelVersion: string;
  riskModelVersion: string;
  entryPrice: DecimalString | null;
  valuationPrice: DecimalString | null;
  remainingQuantity: DecimalString;
  allocatedCapital: DecimalString;
  scenarioEquity: DecimalString;
  /** Isolated collateral still attached to the remaining open quantity. */
  remainingCollateral: DecimalString;
  openingFees: DecimalString;
  closingFees: DecimalString;
  fundingNet: DecimalString;
  realizedGross: DecimalString;
  unrealizedPnl: DecimalString;
  netPnl: DecimalString;
  roiMarginBasis: DecimalString;
  roiPercent: DecimalString | null;
  liquidationPrice: DecimalString | null;
  fills: ReplayFill[];
  journal: ReplayJournalEntry[];
  candleEntry?: ResolvedCandleSelection;
  candleClose?: ResolvedCandleSelection;
  checkpoint?: ReplayCheckpoint;
}
