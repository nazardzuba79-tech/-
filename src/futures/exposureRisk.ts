import BigNumber from 'bignumber.js';
import { OrderSide } from '../matching-engine/types';
import { PositionSide } from './marginMath';

export interface ExposurePosition {
  side: PositionSide;
  size: BigNumber;
  entryPrice: BigNumber;
  leverage: number;
}

export interface ExposureOrder {
  side: OrderSide;
  remainingQuantity: BigNumber;
  price: BigNumber;
  leverage: number;
}

export interface ProjectedExposure {
  notional: BigNumber;
  maxContributingLeverage: number;
}

/**
 * Calculates the largest position exposure that can result if the candidate
 * and every already-resting order in the same direction fill. Opposing
 * resting orders are deliberately not netted: their execution order is not
 * guaranteed, so relying on them would recreate a split-order bypass.
 *
 * When the current position is opposite the orders, base quantity is reduced
 * first. The cheapest order quantities are treated as the reducing fills so
 * the remaining opposite-side notional is the conservative (largest) one.
 */
export function projectFuturesExposure(params: {
  position: ExposurePosition | null;
  activeOrders: ExposureOrder[];
  candidate: ExposureOrder;
}): ProjectedExposure {
  const direction: PositionSide = params.candidate.side === 'BUY' ? 'LONG' : 'SHORT';
  const legs = [...params.activeOrders, params.candidate].filter(
    (order) => order.side === params.candidate.side && order.remainingQuantity.isGreaterThan(0)
  );

  const maxOrderLeverage = legs.reduce((max, order) => Math.max(max, order.leverage), 0);
  const position = params.position;
  if (!position) {
    return {
      notional: legs.reduce(
        (total, order) => total.plus(order.remainingQuantity.times(order.price)),
        new BigNumber(0)
      ),
      maxContributingLeverage: maxOrderLeverage,
    };
  }

  if (position.side === direction) {
    const orderNotional = legs.reduce(
      (total, order) => total.plus(order.remainingQuantity.times(order.price)),
      new BigNumber(0)
    );
    return {
      notional: position.size.times(position.entryPrice).plus(orderNotional),
      maxContributingLeverage: Math.max(position.leverage, maxOrderLeverage),
    };
  }

  let quantityToReduce = position.size;
  let oppositeRemainderNotional = new BigNumber(0);
  for (const order of [...legs].sort((a, b) => a.price.comparedTo(b.price) ?? 0)) {
    const reducingQuantity = BigNumber.minimum(quantityToReduce, order.remainingQuantity);
    quantityToReduce = quantityToReduce.minus(reducingQuantity);
    oppositeRemainderNotional = oppositeRemainderNotional.plus(
      order.remainingQuantity.minus(reducingQuantity).times(order.price)
    );
  }

  return {
    notional: oppositeRemainderNotional,
    // Any one of these orders can be the leg left after the position closes,
    // depending on fill order, so the safe tier check uses the highest one.
    maxContributingLeverage: maxOrderLeverage,
  };
}
