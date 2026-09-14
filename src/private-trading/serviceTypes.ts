import type { ModelProfile, ReplayInput, ReplayResult, Side } from './types';

export type Mode = 'DEMO_LIVE' | 'HISTORICAL_REPLAY';
export interface OwnerSession { userId: string; sessionId: string; expiresAt: number }
export interface TradeRequest {
  mode: Mode; symbol: string; side: Side; type: 'MARKET' | 'LIMIT'; leverage: string;
  quantity?: string; margin?: string; limitPrice?: string;
  takeProfit?: string | null; stopLoss?: string | null;
  effectiveOpenedAt?: string; effectiveClosedAt?: string; asOf?: string;
  capital?: string; manualEntryPrice?: string; events?: ReplayInput['events'];
  idempotencyKey: string;
}
export interface PrivatePosition {
  id: string; mode: Mode; symbol: string; side: Side; leverage: string;
  quantity: string; initialQuantity: string; entryPrice: string; markPrice: string;
  allocatedMargin: string; initialMarginBasis: string; realizedMarginBasis: string;
  liquidationPrice: string | null; unrealizedPnl: string; realizedGross: string;
  netPnl: string; roiPercent: string | null; openingFees: string; closingFees: string; fundingNet: string;
  takeProfit: string | null; stopLoss: string | null;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED'; createdAt: string; effectiveOpenedAt: string;
  effectiveClosedAt: string | null; asOf: string; profile: ModelProfile;
  verification: 'VERIFIED' | 'INCOMPLETE' | 'AMBIGUOUS';
  lastFundingAt: number; lastBookTimestamp: number; lastFillAt: number;
  dataStatus?: 'LIVE' | 'UNAVAILABLE'; scenarioId?: string;
  /** Cash shortfall absorbed by the private isolated model; not trading profit. */
  isolatedDeficit?: string;
  /** Quantity AFTER each actual fill, for funding's effective-time accounting. */
  quantityTimeline?: Array<{ effectiveAt: number; quantity: string }>;
}
export interface PrivateOrder {
  id: string; symbol: string; side: Side; type: 'MARKET' | 'LIMIT';
  quantity: string; remainingQuantity: string; filledQuantity: string; limitPrice: string | null;
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
  positionId: string; createdAt: string; reserved: string; leverage: string;
  takeProfit: string | null; stopLoss: string | null; profile: ModelProfile;
  lastBookTimestamp: number;
}
export interface PrivateScenario {
  id: string; request: TradeRequest; result: ReplayResult; position: PrivatePosition;
  profile: ModelProfile; allocatedCapital: string; createdAt: string; version: number;
}
export interface AccountState {
  version: 1; positions: PrivatePosition[]; orders: PrivateOrder[]; scenarios: PrivateScenario[];
  session: OwnerSession | null;
  isolatedDeficit?: string;
  bookConsumption?: Record<string, { providerTimestamp: number; bookGeneratedAt: number; fingerprint: string; bids: Record<string, string>; asks: Record<string, string> }>;
}
export interface PreviewResult {
  position: PrivatePosition;
  cost: { required: string; initialMargin: string; fee: string; closeFeeReserve: string };
  issues: string[]; assumptions: string[];
  request: TradeRequest; profile: ModelProfile;
  replay?: ReplayResult; quote?: unknown; scenarioId?: string; scenarioVersion?: number;
  consent?: { slippageBps: string; slippagePercent: string; quantity: string; minimumFillQuantity: string; maxRequired: string;
    maxAveragePrice: string | null; minAveragePrice: string | null };
}
export const emptyState = (): AccountState => ({ version: 1, positions: [], orders: [], scenarios: [], session: null });
export class PrivateTradingError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
