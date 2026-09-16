import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import type { FuturesAccountState } from './futuresAccountStore';
import { refreshFuturesAccount } from './useFuturesAccount';
import type { ResourceKey } from './futuresAccountStore';
import type { NativeCandle } from './nativeDemoApi';
import type { FuturesContractRules } from './futuresMath';

export interface FuturesAccountAggregate {
  settleBalance: string;
  walletCollateral: string;
  collateral: string;
  equity: string;
  unrealizedPnl: string;
  initialMargin: string;
  maintenanceMargin: string;
  orderReserve: string;
  available: string;
  maintenanceRatio: string | null;
  liquidatable: boolean | null;
  collateralComplete: boolean;
  unpricedAssets: string[];
  collateralAsOf: number | null;
}
export interface FuturesAccountActivation {
  available: string;
  asset: string;
  pending: boolean;
  begin(): void;
}
export interface FuturesExecution {
  engine: 'REAL' | 'NATIVE';
  ready: boolean;
  account: FuturesAccountState | null;
  /** Non-null only when the engine itself forces one mode. */
  marginType: 'ISOLATED' | 'CROSS' | null;
  /** Historical candle identity; the server remains the execution-price authority. */
  candle: NativeCandle | null;
  /** The already-selected candle close for live client-side previews only. */
  selectedEntryPrice: number | null;
  contract: FuturesContractRules | null;
  account_aggregate: FuturesAccountAggregate | null;
  activation: FuturesAccountActivation | null;
  placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: string;
    quantity: string;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSS';
    reduceOnly?: boolean;
    /** Exact position selected by a reduce-only action. Native uses it; real execution ignores it. */
    positionId?: string;
  }): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  closePosition(positionId: string): Promise<void>;
  setProtection(positionId: string, body: { takeProfit: string | null; stopLoss: string | null }): Promise<void>;
  clearProtection(positionId: string): Promise<void>;
  showPnlCard?: (positionId: string) => void;
  refresh(resources?: ResourceKey[]): void;
}

export const REAL_FUTURES_EXECUTION: FuturesExecution = {
  engine: 'REAL',
  ready: true,
  account: null,
  marginType: null,
  candle: null,
  selectedEntryPrice: null,
  contract: null,
  account_aggregate: null,
  activation: null,
  placeOrder: async ({ positionId: _positionId, ...params }) => { await api.placeFuturesOrder(params); },
  cancelOrder: async (orderId) => { await api.cancelFuturesOrder(orderId); },
  closePosition: async (positionId) => { await api.closeFuturesPosition(positionId); },
  setProtection: async (positionId, body) => { await api.setFuturesPositionProtection(positionId, body); },
  clearProtection: async (positionId) => { await api.clearFuturesPositionProtection(positionId); },
  refresh: (resources) => refreshFuturesAccount(resources),
};

const FuturesExecutionContext = createContext<FuturesExecution>(REAL_FUTURES_EXECUTION);
export function FuturesExecutionProvider({ value, children }: { value: FuturesExecution; children: ReactNode }) {
  return <FuturesExecutionContext.Provider value={value}>{children}</FuturesExecutionContext.Provider>;
}
export function useFuturesExecution(): FuturesExecution {
  return useContext(FuturesExecutionContext);
}
