import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';

export interface Candle {
  time: number; // bucket start, epoch SECONDS (lightweight-charts wants seconds, not ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const INTERVALS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
} as const;

export type IntervalKey = keyof typeof INTERVALS;

/**
 * Buckets raw trades into OHLCV candles in application code rather than a
 * DB-specific time-bucket function (e.g. Postgres date_trunc), so this works
 * unchanged if you ever swap databases. For a low/medium-volume internal
 * team exchange this is plenty fast; if trade volume grows a lot, move this
 * to a materialized view or a scheduled job that pre-aggregates candles
 * instead of computing on every request.
 */
export class CandleService {
  constructor(private prisma: PrismaClient) {}

  async getCandles(pair: string, interval: IntervalKey, limit = 200): Promise<Candle[]> {
    const bucketSeconds = INTERVALS[interval];
    const sinceMs = Date.now() - bucketSeconds * 1000 * limit;

    const trades = await this.prisma.trade.findMany({
      where: { pair, executedAt: { gte: new Date(sinceMs) } },
      orderBy: { executedAt: 'asc' },
      select: { price: true, quantity: true, executedAt: true },
    });

    if (trades.length === 0) return [];

    const buckets = new Map<number, Candle>();

    for (const trade of trades) {
      const tradeSeconds = Math.floor(trade.executedAt.getTime() / 1000);
      const bucketTime = tradeSeconds - (tradeSeconds % bucketSeconds);
      const price = new BigNumber(trade.price.toString()).toNumber();
      const qty = new BigNumber(trade.quantity.toString()).toNumber();

      const existing = buckets.get(bucketTime);
      if (!existing) {
        buckets.set(bucketTime, { time: bucketTime, open: price, high: price, low: price, close: price, volume: qty });
      } else {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price; // trades are time-ordered, so last write wins
        existing.volume += qty;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
  }
}
