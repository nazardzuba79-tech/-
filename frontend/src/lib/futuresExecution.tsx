import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import type { FuturesAccountState } from './futuresAccountStore';
import { refreshFuturesAccount } from './useFuturesAccount';
import type { ResourceKey } from './futuresAccountStore';
import type { NativeCandle } from './nativeDemoApi';
import type { FuturesContractRules } from './futuresMath';

/**
 * Which engine backs the futures terminal for the signed-in account, and
 * how the terminal talks to it.
 *
 * The terminal has exactly ONE order form, ONE positions table, ONE orders
 * table and ONE assets table, and they are the same components for every
 * account. What differs for the owner whose access verdict pins them to
 * the simulation engine is not the interface — it is where the account
 * state comes from and where an order goes. That seam is this context.
 *
 * Without a provider the terminal behaves exactly as it always has: the
 * shared account store polls the real endpoints and every write is the
 * `api` call the component used to make inline. The default below IS that
 * behaviour, so an ordinary user's path is unchanged by construction
 * rather than by a branch somebody has to remember to keep symmetric.
 */
/**
 * The account aggregate, as the ENGINE computed it.
 *
 * Every figure here is one number from one server-side calculation
 * (`demoAccount` in the native engine): equity, both margins, the order
 * reserve and what is left available. When an engine publishes these, the
 * summary card DISPLAYS them — it does not re-derive margin from positions
 * and a leverage-tier table the way it must for an engine that publishes
 * no aggregate, because two derivations of the same figure are two figures.
 *
 * That re-derivation is what reported a maintenance margin of 0.00% on the
 * owner's account: it was applying the REAL engine's tier table to a
 * position the simulation engine had already priced under its own risk
 * tiers.
 */
/**
 * The account, exactly as the server computed it.
 *
 * This is a TRANSCRIPT, not an input to another calculation. Every field
 * here is the server's single answer, and nothing in the interface may
 * re-derive one of them from the others or from the position list — two
 * derivations of one figure are two figures, and that is how the
 * maintenance margin once came out as 0.00%.
 */
export interface FuturesAccountAggregate {
  /** The simulation ledger's settle-asset balance. */
  settleBalance: string;
  /** The rest of the wallet, valued at mark. Only the part that COULD be valued. */
  walletCollateral: string;
  /** settleBalance + walletCollateral. */
  collateral: string;
  equity: string;
  unrealizedPnl: string;
  /** Initial margin held by open positions. */
  initialMargin: string;
  maintenanceMargin: string;
  /** Margin reserved behind working orders. */
  orderReserve: string;
  available: string;
  /** `null` when there is no position to measure a ratio against. */
  maintenanceRatio: string | null;
  /**
   * `null` means the question could not be answered, because part of the
   * collateral has no price. It is NOT `false`, and it is NOT `true`:
   * rendering either would be inventing a verdict.
   */
  liquidatable: boolean | null;
  /** False when `equity` is a floor rather than the account. */
  collateralComplete: boolean;
  /** The assets behind an incomplete valuation, so the interface can name them. */
  unpricedAssets: string[];
  /** The stalest price behind `walletCollateral`. */
  collateralAsOf: number | null;
}

export interface FuturesExecution {
  /** REAL = our matching engine and the real futures ledger.
   *  NATIVE = the simulation engine; no real order, no real wallet write. */
  engine: 'REAL' | 'NATIVE';
  /**
   * False while the access verdict or the account state is still unknown,
   * and false when either failed.
   *
   * Trading is blocked on false. It is NEVER a fallback to real execution:
   * an owner pinned to the simulation engine must not reach the real one
   * because a policy read timed out, so "not known yet" and "failed" are
   * the same answer here — no.
   */
  ready: boolean;
  /** Non-null replaces the shared store as the source of account state. */
  account: FuturesAccountState | null;
  /** The margin mode the engine actually settles in, when it is not the
   *  trader's to choose. `null` leaves the terminal's own toggle live. */
  marginType: 'ISOLATED' | 'CROSS' | null;
  /** A historical bar the trader picked on the chart, to be priced by the
   *  server. `null` means "trade at the current book", which is every
   *  ordinary order. */
  candle: NativeCandle | null;
  /** The selected contract's quantity rules, when the engine publishes
   *  them. `null` — every real account — means the terminal enforces no
   *  per-contract step or ceiling of its own, which is what it always did. */
  contract: FuturesContractRules | null;
  /** The engine's own account aggregate, when it publishes one. `null` —
   *  every real account — leaves the summary deriving as it always has. */
  account_aggregate: FuturesAccountAggregate | null;
  placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: string;
    quantity: string;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSS';
    reduceOnly?: boolean;
  }): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  closePosition(positionId: string): Promise<void>;
  setProtection(positionId: string, body: { takeProfit: string | null; stopLoss: string | null }): Promise<void>;
  clearProtection(positionId: string): Promise<void>;
  /** Open this position's P&L card. Absent where no card service exists,
   *  so the button is not rendered rather than rendered dead. */
  showPnlCard?: (positionId: string) => void;
  /** Tell whichever source backs this terminal that the account changed. */
  refresh(resources?: ResourceKey[]): void;
}

export const REAL_FUTURES_EXECUTION: FuturesExecution = {
  engine: 'REAL',
  ready: true,
  account: null,
  marginType: null,
  candle: null,
  contract: null,
  account_aggregate: null,
  placeOrder: async (params) => { await api.placeFuturesOrder(params); },
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

/** The engine this terminal is talking to. Outside a provider: the real one. */
export function useFuturesExecution(): FuturesExecution {
  return useContext(FuturesExecutionContext);
}
