import type { FuturesProtectionTrigger } from './api';
import type { NativeState, NativePosition, NativeOrder, NativeDraft, NativeCandle } from './nativeDemoApi';
import type {
  FuturesAccountState, FuturesBalance, FuturesPosition, FuturesOrder, FuturesPositionHistoryRow, ResourceState,
} from './futuresAccountStore';

/**
 * NativeDemo state, expressed in the shapes the ORIGINAL futures terminal
 * already reads.
 *
 * The point of this module is that the terminal does not learn about the
 * simulation engine. `FuturesOrderForm`, `FuturesAccountSummary`,
 * `FuturesPositionsPanel`, `FuturesOrdersPanel` and `AssetsPanel` keep
 * reading `useFuturesAccount()` and keep rendering exactly the columns,
 * densities and controls they render for every other account — only the
 * SOURCE of those four resources changes, and only for the owner whose
 * access verdict says the native engine backs this terminal.
 *
 * Everything here is a projection. Nothing is computed, rounded or
 * reinterpreted: every figure is the string the server already sent, moved
 * into the field the original component looks for. The one derived value
 * is `locked` (used margin plus order reserve), which is the same sum the
 * real `/futures/balances` reports as locked, and it is a sum of two
 * server strings rather than a re-derivation of either.
 */

/** `BTCUSDT` (native) -> `BTC/USDT` (terminal). */
export function nativeSymbolToPair(symbol: string): string {
  const match = /^(.+?)(USDT|USDC|USD)$/.exec(symbol);
  return match ? `${match[1]}/${match[2]}` : symbol;
}

/** `BTC/USDT` (terminal) -> `BTCUSDT` (native). */
export function pairToNativeSymbol(pair: string): string {
  return pair.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

/** Sum of two decimal strings, exactly, without going through a float.
 *  Both operands are server-formatted non-negative decimals. */
export function addDecimalStrings(a: string, b: string): string {
  const split = (value: string) => {
    const [whole = '0', fraction = ''] = value.trim().replace(/^\+/, '').split('.');
    return { whole, fraction };
  };
  const left = split(a), right = split(b);
  if (left.whole.startsWith('-') || right.whole.startsWith('-')) {
    // Neither used margin nor order reserve is ever negative; if the server
    // ever says otherwise, say so rather than inventing an exact answer.
    return String(Number(a) + Number(b));
  }
  const width = Math.max(left.fraction.length, right.fraction.length);
  const scale = (side: { whole: string; fraction: string }) =>
    BigInt(side.whole + side.fraction.padEnd(width, '0'));
  const total = (scale(left) + scale(right)).toString().padStart(width + 1, '0');
  const whole = total.slice(0, total.length - width) || '0';
  const fraction = width === 0 ? '' : total.slice(total.length - width).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** A resource the server has actually answered. */
function answered<T>(data: T, fetchedAt: number): ResourceState<T> {
  return { data, loading: false, refreshing: false, failed: false, loaded: true, fetchedAt };
}

/** A resource nobody has answered yet — `null`, never an empty array. The
 *  whole unknown-vs-empty contract of the terminal depends on this. */
function unanswered<T>(loading: boolean, failed: boolean): ResourceState<T> {
  return { data: null, loading, refreshing: false, failed, loaded: failed, fetchedAt: 0 };
}

/**
 * A TP/SL price on a native position, as the trigger row the table reads.
 *
 * The native engine keeps protection as a price ON the position and
 * evaluates it inline, so the retry bookkeeping a real trigger row carries
 * has no counterpart here: `attempts` is 0 and `lastError` is null because
 * nothing has been attempted and nothing has failed, not as a zero standing
 * in for something unknown. The timestamps are the position's own, which is
 * when the engine last wrote this protection.
 */
function nativeTrigger(
  position: NativePosition,
  kind: 'TAKE_PROFIT' | 'STOP_LOSS',
  triggerPrice: string | null,
): FuturesProtectionTrigger | null {
  if (triggerPrice === null) return null;
  const at = new Date(position.openedAt).toISOString();
  return {
    id: `${position.id}:${kind}`, kind, triggerPrice,
    status: 'PENDING', lastError: null, attempts: 0, revision: 0, createdAt: at, updatedAt: at,
  };
}

export function nativePositionToTerminal(position: NativePosition): FuturesPosition {
  return {
    id: position.id,
    symbol: nativeSymbolToPair(position.symbol),
    side: position.side,
    size: position.quantity,
    entryPrice: position.entryPrice,
    leverage: Number(position.leverage),
    // The native engine settles this account in Cross. Reporting ISOLATED
    // here would label the row with a mode the engine is not using.
    marginType: 'CROSS',
    initialMargin: position.roiBasis,
    liquidationPrice: position.liquidationPrice,
    markPrice: position.markPrice,
    unrealizedPnl: position.unrealizedPnl,
    // The engine already reports these apart; they stay apart. `netPnl` is
    // deliberately NOT used for an open row — it is the closed result, and
    // it already contains the fees and funding the realized figure carries,
    // so showing it here would count them twice.
    realizedPnl: position.realizedPnl,
    roe: position.roiPercent,
    openedAt: new Date(position.openedAt).toISOString(),
    // The native engine keeps TP/SL as prices on the position rather than
    // as separate trigger rows, so the retry bookkeeping a real trigger
    // carries has no counterpart. It is reported as PENDING with no
    // attempts and no error, which is what those fields mean for a trigger
    // the engine evaluates inline — not as a zero standing in for unknown.
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
    marginType: 'CROSS',
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
    // The native engine names an order by the POSITION it opens; the
    // terminal names it by the direction it trades. They are the same fact.
    side: order.side === 'SHORT' ? 'SELL' : 'BUY',
    type: order.type,
    price: order.price,
    originalQuantity: order.quantity,
    remainingQuantity: order.remaining,
    status: order.status,
    reduceOnly: false,
    leverage: Number(order.leverage),
    marginType: 'CROSS',
    createdAt: new Date(order.createdAt).toISOString(),
  };
}

/**
 * The account's one balance row.
 *
 * `available` is spendable margin and `locked` is margin already committed
 * — used margin plus the reserve behind working orders — which is exactly
 * what the real endpoint's two fields mean. The summary card adds them
 * back together for "margin balance"; equity is that sum plus unrealized
 * P&L, which the card derives from the positions it is already reading.
 */
export function nativeBalances(state: NativeState): FuturesBalance[] {
  const account = state.account;
  if (!account) return [{ asset: 'USDT', available: '0', locked: '0' }];
  return [{
    asset: 'USDT',
    available: account.available,
    locked: addDecimalStrings(account.initialMargin, account.orderReserve),
  }];
}

/**
 * Project the whole native state into the four account resources the
 * terminal reads.
 *
 * `state === null` means the native state has not been answered yet, and
 * every resource stays `null` — the unknown the panels render as a dash.
 * That is deliberately NOT an empty account: the difference is the whole
 * reason the store models it.
 */
export function nativeAccountState(
  state: NativeState | null,
  flags: { loading: boolean; failed: boolean; fetchedAt: number },
): FuturesAccountState {
  if (state === null || !state.initialized) {
    const pending = <T,>() => unanswered<T>(flags.loading, flags.failed);
    return {
      balances: state === null ? pending<FuturesBalance[]>() : answered(nativeBalances(state), flags.fetchedAt),
      positions: pending<FuturesPosition[]>(),
      orders: pending<FuturesOrder[]>(),
      orderHistory: pending<FuturesOrder[]>(),
      positionHistory: pending<FuturesPositionHistoryRow[]>(),
    };
  }
  const working = state.orders.filter((order) => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status));
  return {
    balances: answered(nativeBalances(state), flags.fetchedAt),
    positions: answered(state.positions.map(nativePositionToTerminal), flags.fetchedAt),
    orders: answered(working.map(nativeOrderToTerminal), flags.fetchedAt),
    orderHistory: answered(state.orders.map(nativeOrderToTerminal), flags.fetchedAt),
    positionHistory: answered(state.history.map(nativePositionToHistoryRow), flags.fetchedAt),
  };
}

/**
 * The terminal's order payload, as a native command.
 *
 * The terminal trades a QUANTITY of the contract; the native engine accepts
 * either a quantity or a margin, so the quantity is passed through
 * untouched rather than converted into a margin and back. `leverage` and
 * the TP/SL prices are carried as typed.
 *
 * `candle` is present only when the trader picked a historical bar. The
 * engine prices that trade from the bar the SERVER holds for that open
 * time — the client sends the bar's identity, never a price of its own.
 */
export function terminalOrderToNativeDraft(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price?: string;
  quantity: string;
  leverage: number;
  reduceOnly?: boolean;
  /** The position a reducing order reduces. Required when `reduceOnly`. */
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
    ...(params.type === 'LIMIT' && params.price ? { price: params.price } : {}),
    // A reducing order stays the order it is. Collapsing a reduce-only
    // LIMIT into a CLOSE would price it at the book instead of at the price
    // the trader set, which is a different trade.
    ...(params.reduceOnly && params.positionId ? { reduceOnly: true as const, positionId: params.positionId } : {}),
    ...(params.candle ? { candle: params.candle } : {}),
    ...(params.protection ? { protection: params.protection } : {}),
  };
}
