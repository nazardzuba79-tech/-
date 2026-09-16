import type { FuturesProtectionTrigger } from './api';
import type { NativeState, NativePosition, NativeOrder, NativeDraft, NativeCandle } from './nativeDemoApi';
import type {
  FuturesAccountState, FuturesBalance, FuturesPosition, FuturesOrder, FuturesPositionHistoryRow, ResourceState,
} from './futuresAccountStore';

/** Native state projected into the shapes the normal futures terminal already reads. */
export function nativeSymbolToPair(symbol: string): string {
  const match = /^(.+?)(USDT|USDC|USD)$/.exec(symbol);
  return match ? `${match[1]}/${match[2]}` : symbol;
}
export function pairToNativeSymbol(pair: string): string {
  return pair.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}
export function addDecimalStrings(a: string, b: string): string {
  const split = (value: string) => {
    const [whole = '0', fraction = ''] = value.trim().replace(/^\+/, '').split('.');
    return { whole, fraction };
  };
  const left = split(a), right = split(b);
  if (left.whole.startsWith('-') || right.whole.startsWith('-')) return String(Number(a) + Number(b));
  const width = Math.max(left.fraction.length, right.fraction.length);
  const scale = (side: { whole: string; fraction: string }) => BigInt(side.whole + side.fraction.padEnd(width, '0'));
  const total = (scale(left) + scale(right)).toString().padStart(width + 1, '0');
  const whole = total.slice(0, total.length - width) || '0';
  const fraction = width === 0 ? '' : total.slice(total.length - width).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
function answered<T>(data: T, fetchedAt: number): ResourceState<T> {
  return { data, loading: false, refreshing: false, failed: false, loaded: true, fetchedAt };
}
function unanswered<T>(loading: boolean, failed: boolean): ResourceState<T> {
  return { data: null, loading, refreshing: false, failed, loaded: failed, fetchedAt: 0 };
}
function nativeTrigger(position: NativePosition, kind: 'TAKE_PROFIT' | 'STOP_LOSS', triggerPrice: string | null): FuturesProtectionTrigger | null {
  if (triggerPrice === null) return null;
  const at = new Date(position.openedAt).toISOString();
  return { id: `${position.id}:${kind}`, kind, triggerPrice, status: 'PENDING', lastError: null, attempts: 0, revision: 0, createdAt: at, updatedAt: at };
}
export function nativePositionToTerminal(position: NativePosition): FuturesPosition {
  return {
    id: position.id,
    symbol: nativeSymbolToPair(position.symbol),
    side: position.side,
    size: position.quantity,
    entryPrice: position.entryPrice,
    leverage: Number(position.leverage),
    marginType: position.marginType,
    initialMargin: position.roiBasis,
    liquidationPrice: position.liquidationPrice,
    markPrice: position.markPrice,
    unrealizedPnl: position.unrealizedPnl,
    realizedPnl: position.realizedPnl,
    roe: position.roiPercent,
    openedAt: new Date(position.openedAt).toISOString(),
    protection: {
      takeProfit: nativeTrigger(position, 'TAKE_PROFIT', position.protection.takeProfit),
      stopLoss: nativeTrigger(position, 'STOP_LOSS', position.protection.stopLoss),
    },
  };
}
export function nativePositionToHistoryRow(position: NativePosition): FuturesPositionHistoryRow {
  return {
    id: position.id,
    symbol: nativeSymbolToPair(position.symbol),
    side: position.side,
    leverage: Number(position.leverage),
    marginType: position.marginType,
    entryPrice: position.entryPrice,
    realizedPnl: position.netPnl,
    status: position.status,
    openedAt: new Date(position.openedAt).toISOString(),
    closedAt: position.closedAt === null ? null : new Date(position.closedAt).toISOString(),
  };
}
export function nativeOrderToTerminal(order: NativeOrder): FuturesOrder {
  return {
    id: order.id,
    symbol: nativeSymbolToPair(order.symbol),
    side: order.side === 'SHORT' ? 'SELL' : 'BUY',
    type: order.type,
    price: order.price,
    originalQuantity: order.quantity,
    remainingQuantity: order.remaining,
    status: order.status,
    reduceOnly: order.reduceOnly === true,
    leverage: Number(order.leverage),
    // Persisted V2 orders have no field and are legacy Cross orders.
    marginType: order.marginType === 'ISOLATED' ? 'ISOLATED' : 'CROSS',
    createdAt: new Date(order.createdAt).toISOString(),
  };
}
export function nativeBalances(state: NativeState): FuturesBalance[] | null {
  const account = state.account;
  if (!account) return null;
  return [{ asset: 'USDT', available: account.available, locked: addDecimalStrings(account.initialMargin, account.orderReserve) }];
}
export function nativeAccountState(
  state: NativeState | null,
  flags: { loading: boolean; failed: boolean; fetchedAt: number },
): FuturesAccountState {
  if (state === null || !state.initialized) {
    const pending = <T,>() => unanswered<T>(flags.loading, flags.failed);
    const balances = state === null ? null : nativeBalances(state);
    return {
      balances: balances === null ? pending<FuturesBalance[]>() : answered(balances, flags.fetchedAt),
      positions: pending<FuturesPosition[]>(),
      orders: pending<FuturesOrder[]>(),
      orderHistory: pending<FuturesOrder[]>(),
      positionHistory: pending<FuturesPositionHistoryRow[]>(),
    };
  }
  const working = state.orders.filter((order) => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status));
  const balances = nativeBalances(state);
  return {
    balances: balances === null ? unanswered<FuturesBalance[]>(flags.loading, flags.failed) : answered(balances, flags.fetchedAt),
    positions: answered(state.positions.map(nativePositionToTerminal), flags.fetchedAt),
    orders: answered(working.map(nativeOrderToTerminal), flags.fetchedAt),
    orderHistory: answered(state.orders.map(nativeOrderToTerminal), flags.fetchedAt),
    positionHistory: answered(state.history.map(nativePositionToHistoryRow), flags.fetchedAt),
  };
}
export function terminalOrderToNativeDraft(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price?: string;
  quantity: string;
  leverage: number;
  marginType: 'CROSS' | 'ISOLATED';
  reduceOnly?: boolean;
  positionId?: string;
  candle?: NativeCandle | null;
  protection?: { takeProfit: string | null; stopLoss: string | null };
}): NativeDraft {
  return {
    kind: 'OPEN',
    symbol: pairToNativeSymbol(params.symbol),
    side: params.side === 'SELL' ? 'SHORT' : 'LONG',
    type: params.type,
    quantity: params.quantity,
    leverage: String(params.leverage),
    marginType: params.marginType,
    ...(params.type === 'LIMIT' && params.price ? { price: params.price } : {}),
    ...(params.reduceOnly && params.positionId ? { reduceOnly: true as const, positionId: params.positionId } : {}),
    ...(params.candle ? { candle: params.candle } : {}),
    ...(params.protection ? { protection: params.protection } : {}),
  };
}
