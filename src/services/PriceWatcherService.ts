import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { OrderService, PriceSource } from './OrderService';

/**
 * Background trigger engine for conditional orders (STOP_LIMIT,
 * STOP_MARKET, TAKE_PROFIT_LIMIT, TAKE_PROFIT_MARKET, and OCO pairs built
 * from them) — mirrors LiquidationEngine's pattern for futures: every
 * LIQUIDATION-style interval, scan every PENDING_TRIGGER order and check
 * its trigger condition against the REAL market price (the same Kraken
 * mirror the rest of the app prices things from, not the internal book —
 * a thin internal book shouldn't be able to fire someone's stop-loss).
 *
 * A SELL-side STOP/TAKE_PROFIT triggers once price falls to/through its
 * trigger (stop-loss) or rises to/through it (take-profit) — direction
 * was already locked in at placement time by OrderService's validation,
 * so here it's just "which side of current price does the trigger sit on":
 *   STOP:         SELL fires when price <= trigger; BUY fires when price >= trigger
 *   TAKE_PROFIT:  SELL fires when price >= trigger; BUY fires when price <= trigger
 */
export class PriceWatcherService {
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaClient, private orderService: OrderService, private priceSource: PriceSource) {}

  /** Scans all pending conditional orders once. Returns how many triggered. */
  async checkAndTrigger(): Promise<number> {
    const pending = await this.prisma.order.findMany({ where: { status: 'PENDING_TRIGGER' } });
    if (pending.length === 0) return 0;

    const priceCache = new Map<string, BigNumber | null>();
    let triggeredCount = 0;

    for (const order of pending) {
      let price = priceCache.get(order.pair);
      if (price === undefined) {
        // Never trigger off missing data — an honest skip beats acting on
        // a stale/fabricated price.
        try {
          const ticker = await this.priceSource.getTicker(order.pair);
          price = ticker ? new BigNumber(ticker.lastPrice) : null;
        } catch {
          price = null;
        }
        priceCache.set(order.pair, price);
      }
      if (!price) continue;

      const triggerPrice = new BigNumber(order.triggerPrice!.toString());
      const isStopFamily = order.type === 'STOP_LIMIT' || order.type === 'STOP_MARKET';
      const fires =
        (isStopFamily && order.side === 'SELL' && price.isLessThanOrEqualTo(triggerPrice)) ||
        (isStopFamily && order.side === 'BUY' && price.isGreaterThanOrEqualTo(triggerPrice)) ||
        (!isStopFamily && order.side === 'SELL' && price.isGreaterThanOrEqualTo(triggerPrice)) ||
        (!isStopFamily && order.side === 'BUY' && price.isLessThanOrEqualTo(triggerPrice));
      if (!fires) continue;

      const result = await this.orderService.triggerOrder(order.id).catch((err) => {
        console.error(`[PriceWatcherService] Failed to trigger order ${order.id}:`, err);
        return null;
      });
      if (result) triggeredCount++;
    }

    return triggeredCount;
  }

  startScheduler(intervalMs: number): void {
    this.timer = setInterval(() => {
      this.checkAndTrigger().catch((err) => console.error('[PriceWatcherService] Trigger check failed', err));
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
