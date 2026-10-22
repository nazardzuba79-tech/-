export type Side = 'long' | 'short';
export type Market = 'spot' | 'futures';
export type Errors = Record<string, string>;
export type Failure = { ok: false; status: 'incomplete' | 'invalid'; errors: Errors };
export type Result<T> = { ok: true; status: 'ready'; value: T } | Failure;
export interface ExecutionInput {
  side: Side; entry: string; exit: string; quantity: string;
  feeEntry: string; feeExit: string; slipEntry: string; slipExit: string; funding: string; fixedCosts: string;
}
export interface PnlInput extends ExecutionInput {
  market: Market; quantityMode: 'quantity' | 'margin'; margin: string; leverage: string;
}
export interface PnlValue {
  quantity: string; entryExecution: string; exitExecution: string; notional: string;
  initialMargin: string; purchaseCost: string; grossPnl: string; feeOpen: string; feeClose: string;
  funding: string; fixedCosts: string; netPnl: string; roi: string; roiBasis: 'margin' | 'purchase';
  breakEvenExecution: string | null; breakEvenTarget: string | null;
  breakEvenState: 'positive' | 'no_positive_threshold';
  chart: { price: string; pnl: string; x: string; y: string }[];
  chartReference: { zeroY: string; entryX: string; exitX: string; breakEvenX: string | null };
}
export interface PositionInput {
  side: Side; capital: string; riskPercent: string; entry: string; stop: string; leverage: string;
  feeEntry: string; feeStop: string; slipEntry: string; slipStop: string; fixedCosts: string;
  budget?: string; step?: string;
}
export interface PositionValue {
  state: 'sized' | 'no_size'; riskBudget: string; lossPerUnit: string; cashPerUnit: string;
  qRisk: string; qBudget: string | null; quantity: string; notional: string; margin: string;
  plannedLoss: string; reserved: string; actualRisk: string; limitingFactor: 'risk' | 'budget';
  theoretical: boolean; message?: string;
}
export interface LiquidationInput {
  side: Side; entry: string; quantity: string; leverage: string; maintenanceRate: string;
  additionalMargin: string; costs: string;
}
export interface LiquidationValue {
  entry: string; quantity: string; notional: string; initialMargin: string; additionalMargin: string;
  costs: string; margin: string; maintenanceMargin: string; buffer: string;
  liquidationPrice: string | null; zeroMarginPrice: string | null; distancePercent: string | null;
  message?: string;
}
export type LiquidationResult = Failure | {
  ok: true; status: 'ready' | 'insufficient_margin' | 'no_positive_threshold'; value: LiquidationValue;
};
export interface RiskRewardInput {
  side: Side; entry: string; stop: string; target: string; quantity: string;
  feeEntry: string; feeStop: string; feeTarget: string; slipEntry: string; slipStop: string;
  slipTarget: string; fixedCosts: string;
}
export interface RiskRewardValue {
  state: 'profitable' | 'target_not_profitable'; risk: string; reward: string;
  ratio: string | null; breakEvenWinRate: string | null; stopPnl: string; targetPnl: string;
  entryExecution: string; stopExecution: string; targetExecution: string;
}
export interface DcaRow { mode: 'quantity' | 'amount'; price: string; quantity: string; amount: string; fee: string }
export interface DcaInput {
  rows: DcaRow[];
  exit?: { price: string; fee: string };
  targetAverage?: { price: string; fee: string; target: string };
}
export interface DcaValue {
  quantity: string; purchaseSum: string; entryFees: string; costBasis: string; averageBare: string; averageCost: string;
  exit: null | { valueBeforeExitFee: string; exitFee: string; netAtTarget: string; breakEven: string };
  targetAverage: null | {
    state: 'ready' | 'achieved' | 'no_finite_quantity' | 'unreachable' | 'not_reduction';
    quantity: string | null; amountBeforeFee: string | null; totalNewCost: string | null;
    newQuantity: string | null; newAverage: string | null;
  };
  series: { purchase: number; average: string }[];
}
export interface FeesInput {
  market: Market; side: Side; inputMode: 'quantity' | 'notional'; quantity: string; entry: string; exit: string;
  notionalEntry: string; notionalExit: string; includeExit: boolean; entryRole: 'maker' | 'taker';
  exitRole: 'maker' | 'taker'; makerRate: string; takerRate: string;
  funding?: { notional: string; rate: string; periods: string };
}
export interface FeesValue {
  notionalEntry: string; notionalExit: string | null; feeOpen: string; feeClose: string | null; feesTotal: string;
  combinations: { MM: string; MT: string; TM: string; TT: string };
  fundingCost: string | null; netCost: string | null;
}
