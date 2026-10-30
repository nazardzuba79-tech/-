import BigNumber from 'bignumber.js';
import type { NativeAccount } from '../../private-trading/native/store';
import type { DemoEvent } from '../../private-trading/native/engine';

/**
 * Read-only admission of real committed NativeDemo fill receipts.
 *
 * THIS DOES NOT PLACE ORDERS, subscribe followers or read/write a financial
 * ledger. An eventual copy worker must fetch an authoritative persisted
 * NativeDemoAccount revision, verify its owner/session, record every event ID
 * in a durable unique-key inbox, and execute via NativeDemoService.command.
 * Never accept an account snapshot or event from a client request.
 */
export type FuturesDemoCopyFill = Readonly<{
  sourceEventId: string;
  sourceActionId: string;
  sourcePositionId: string;
  symbol: string;
  kind: 'OPEN' | 'CLOSE';
  side: 'LONG' | 'SHORT';
  quantity: string;
  price: string;
  leverage: string;
  marginType: 'CROSS' | 'ISOLATED';
  pricing: 'OBSERVED_BOOK' | 'MAKER_MODEL';
}>;

export type FuturesDemoSourceResult = {
  accepted: FuturesDemoCopyFill[];
  rejected: { eventId: string; reason: string }[];
};

const decimal = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^(0|[1-9]\\d{0,17})(\\.\\d{1,18})?$/.test(value)
  && new BigNumber(value).isFinite() && new BigNumber(value).gt(0);
const symbolOk = (value: string) => /^[A-Z0-9]{2,32}USDT$/.test(value);

/**
 * Explicitly excludes historical candles, speculative order intents, model
 * liquidations, funding, take-profit/stop-loss automation, and synthetic
 * strategy performance. No request-level OPEN/CLOSE is considered executed
 * until a matching immutable NativeDemo event exists in the account snapshot.
 */
export function futuresDemoSourceFills(account: NativeAccount): FuturesDemoSourceResult {
  const accepted: FuturesDemoCopyFill[] = [], rejected: FuturesDemoSourceResult['rejected'] = [];
  if (account.executionMode !== 'LIVE_EXECUTION') return { accepted, rejected };
  const commands = new Map(account.commands.map(c => [c.id, c]));
  const positions = new Map(account.snapshot.positions.map(p => [p.id, p]));
  const ids = new Set<string>();
  for (const event of account.snapshot.events) {
    if (event.kind !== 'OPEN' && event.kind !== 'CLOSE') continue;
    const refuse = (reason: string) => rejected.push({ eventId: event.id, reason });
    if (!event.id || ids.has(event.id)) { refuse('DUPLICATE_SOURCE_EVENT'); continue; }
    ids.add(event.id);
    if (!event.actionId) { refuse('MISSING_SOURCE_ACTION'); continue; }
    const command = commands.get(event.actionId);
    if (!command || command.kind !== event.kind) { refuse('UNVERIFIED_SOURCE_ACTION'); continue; }
    if (command.executionMode === 'HISTORICAL_DEMO'
      || (command.kind === 'OPEN' && (command.order.historical || !!command.candle))
      || (command.kind === 'CLOSE' && !!command.candle)) { refuse('HISTORICAL_SOURCE'); continue; }
    if (!['OBSERVED_BOOK', 'MAKER_MODEL'].includes(event.pricing)) { refuse('NOT_BOOK_FILL'); continue; }
    if (!symbolOk(event.symbol) || !decimal(event.quantity) || !decimal(event.price)) { refuse('INVALID_EXECUTED_FILL'); continue; }
    if (!event.positionId) { refuse('MISSING_SOURCE_POSITION'); continue; }
    const position = positions.get(event.positionId);
    if (!position || position.symbol !== event.symbol || position.historical
      || position.executionMode === 'HISTORICAL_DEMO') { refuse('UNVERIFIED_SOURCE_POSITION'); continue; }
    if (!decimal(position.leverage) || !['CROSS', 'ISOLATED'].includes(position.marginType)) {
      refuse('INVALID_SOURCE_RISK'); continue;
    }
    if (command.kind === 'OPEN') {
      if (command.order.symbol !== event.symbol || command.order.id !== event.orderId
        || command.order.side !== position.side || command.order.leverage !== position.leverage
        || command.order.marginType !== position.marginType || command.order.reduceOnly) {
        refuse('SOURCE_ORDER_MISMATCH'); continue;
      }
    } else if (command.positionId !== position.id || command.kind !== 'CLOSE') {
      refuse('SOURCE_CLOSE_MISMATCH'); continue;
    }
    if (event.pricing !== 'OBSERVED_BOOK' && event.pricing !== 'MAKER_MODEL') { refuse('UNSUPPORTED_PRICE_PROVENANCE'); continue; }
    accepted.push({
      sourceEventId: event.id, sourceActionId: event.actionId,
      sourcePositionId: position.id, symbol: event.symbol, kind: event.kind,
      side: position.side, quantity: event.quantity, price: event.price,
      leverage: position.leverage, marginType: position.marginType,
      pricing: event.pricing as FuturesDemoCopyFill['pricing'],
    });
  }
  return { accepted, rejected };
}

export function futuresDemoSourceNotional(fill: FuturesDemoCopyFill): string {
  return new BigNumber(fill.quantity).times(fill.price).toFixed();
}

/** No caller can treat an accepted source receipt as permission to open risk.
 * The eventual follower worker MUST independently check current equity, all
 * copied exposure, margin, liquidation risk, market depth and max slippage.
 */
export function futuresDemoSourceRiskCheck(fill: FuturesDemoCopyFill, maxLeverage: string, maxFillUsdt: string) {
  if (!decimal(maxLeverage) || !decimal(maxFillUsdt)) return 'INVALID_FOLLOWER_CAP';
  if (new BigNumber(fill.leverage).gt(maxLeverage)) return 'LEVERAGE_CAP_EXCEEDED';
  if (new BigNumber(futuresDemoSourceNotional(fill)).gt(maxFillUsdt)) return 'FILL_NOTIONAL_CAP_EXCEEDED';
  return null;
}
