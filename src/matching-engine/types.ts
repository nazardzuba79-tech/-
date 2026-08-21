import BigNumber from 'bignumber.js';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type OrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';

/**
 * All monetary amounts use BigNumber, never native JS numbers.
 * Floating point arithmetic on money is the #1 cause of exchange bugs
 * and fund-losing exploits (rounding drift, precision loss).
 */
export interface Order {
  id: string;
  userId: string;
  pair: string; // e.g. "BTC/USDT"
  side: OrderSide;
  type: OrderType;
  price: BigNumber | null; // null for MARKET orders
  originalQuantity: BigNumber;
  remainingQuantity: BigNumber;
  status: OrderStatus;
  createdAt: number; // epoch ms, used for time-priority
  updatedAt: number;
}

export interface Trade {
  id: string;
  pair: string;
  takerOrderId: string;
  makerOrderId: string;
  takerUserId: string;
  makerUserId: string;
  price: BigNumber;
  quantity: BigNumber;
  side: OrderSide; // side of the taker
  executedAt: number;
}

export interface OrderBookLevel {
  price: BigNumber;
  quantity: BigNumber;
  orderCount: number;
}

export interface OrderBookSnapshot {
  pair: string;
  bids: OrderBookLevel[]; // sorted descending by price
  asks: OrderBookLevel[]; // sorted ascending by price
  timestamp: number;
}
