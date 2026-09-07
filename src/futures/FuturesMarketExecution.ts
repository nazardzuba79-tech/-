import { Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { OrderSide } from '../matching-engine/types';
import { FuturesBookTransaction } from './FuturesBookTransaction';
import { computeInitialMargin, PositionSide } from './marginMath';

type Terms = { userId: string; side: OrderSide; leverage: number; marginType: string; reduceOnly?: boolean };
type Position = { side: PositionSide; size: BigNumber; leverage: number };

/** Read-only execution plan. Neither matching nor persistence is invoked.
 * Virtual positions ensure sibling reduce-only makers share one capacity,
 * exactly as they do during sequential settlement. The source book is untouched.
 */
export async function estimateFuturesMarketExecution(
  tx: Prisma.TransactionClient, session: FuturesBookTransaction, taker: Terms & { quantity: BigNumber }
) {
  const positions = new Map<string, Position | null>();
  const key = (terms: Terms) => JSON.stringify([terms.userId, terms.marginType]);
  const read = async (terms: Terms) => {
    const id = key(terms);
    if (!positions.has(id)) {
      const row = await tx.futuresPosition.findFirst({
        where: { userId: terms.userId, symbol: session.symbol, marginType: terms.marginType, status: 'OPEN' },
      });
      positions.set(id, row ? { side: row.side as PositionSide, size: new BigNumber(row.size.toString()), leverage: row.leverage } : null);
    }
    return positions.get(id)!;
  };
  const direction = (terms: Terms): PositionSide => terms.side === 'BUY' ? 'LONG' : 'SHORT';
  const capacity = (terms: Terms, position: Position | null, remaining: BigNumber) => !terms.reduceOnly
    ? remaining : position && position.side !== direction(terms) ? position.size : new BigNumber(0);
  const advance = (terms: Terms, position: Position | null, quantity: BigNumber) => {
    const side = direction(terms);
    if (position?.side === side) {
      if (position.leverage !== terms.leverage) throw new Error(`Increasing this position requires ${position.leverage}x leverage`);
      positions.set(key(terms), { ...position, size: position.size.plus(quantity) });
    } else if (position && quantity.isLessThan(position.size)) {
      positions.set(key(terms), { ...position, size: position.size.minus(quantity) });
    } else {
      const remainder = quantity.minus(position?.size ?? 0);
      positions.set(key(terms), remainder.isZero() ? null : { side, size: remainder, leverage: terms.leverage });
    }
  };

  let remaining = taker.quantity;
  let notional = new BigNumber(0);
  let reservedMargin = new BigNumber(0);
  const legs: { makerOrderId: string; quantity: BigNumber; price: BigNumber }[] = [];
  for (const maker of session.staged.getBook(session.symbol).getOppositeBook(taker.side)) {
    if (remaining.isZero()) break;
    const takerPosition = await read(taker);
    const takerCapacity = capacity(taker, takerPosition, remaining);
    if (!takerCapacity.isGreaterThan(0)) break;
    const row = session.rows.get(maker.id)!;
    const makerTerms: Terms = { ...row, side: maker.side };
    const makerPosition = await read(makerTerms);
    const makerCapacity = capacity(makerTerms, makerPosition, maker.remainingQuantity);
    if (!makerCapacity.isGreaterThan(0)) continue; // execution cancels this stale RO maker
    if (maker.userId === taker.userId) throw new Error('Futures self-match is not allowed');
    const quantity = BigNumber.minimum(remaining, maker.remainingQuantity, takerCapacity, makerCapacity);
    const price = maker.price!;
    advance(taker, takerPosition, quantity);
    advance(makerTerms, makerPosition, quantity);
    legs.push({ makerOrderId: maker.id, quantity, price });
    notional = notional.plus(quantity.times(price));
    // PostgreSQL persists margin at 18 decimals after each fill. Round each
    // reservation up, so accumulated storage rounding cannot underfund a sweep.
    reservedMargin = reservedMargin.plus(computeInitialMargin(quantity.times(price), taker.leverage).decimalPlaces(18, BigNumber.ROUND_CEIL));
    remaining = remaining.minus(quantity);
  }
  if (!remaining.isZero() || legs.length === 0) {
    throw new Error('Insufficient market liquidity for requested quantity');
  }
  return { executableQuantity: taker.quantity.minus(remaining), notional, reservedMargin, legs };
}
