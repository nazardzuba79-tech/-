import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MarkPriceService } from './MarkPriceService';
import { InsuranceFundService } from './InsuranceFundService';
import { computeUnrealizedPnl, PositionSide } from './marginMath';
import { LIQUIDATION_CHECK_INTERVAL_MS } from '../config/futuresConfig';

type TxClient = Prisma.TransactionClient;

/**
 * Background risk-management loop: every LIQUIDATION_CHECK_INTERVAL_MS,
 * checks every OPEN position's mark price against its stored
 * liquidationPrice and force-closes any that have crossed it.
 *
 * A liquidated position's ENTIRE locked margin is forfeited — the trader
 * gets nothing back, win or lose, which is what makes liquidation costly
 * enough to matter and is standard practice on every real exchange. What
 * happens to that margin (plus/minus the position's real PnL at the mark
 * price the liquidation executed at) is decided against the bankruptcy
 * price via the insurance fund: leftover margin becomes a fund
 * contribution, a loss beyond the margin becomes a fund payout.
 */
export class LiquidationEngine {
  private timer?: NodeJS.Timeout;
  private insuranceFund = new InsuranceFundService();

  constructor(private prisma: PrismaClient, private markPriceService: MarkPriceService) {}

  /** Scans all open positions once. Returns how many were liquidated. */
  async checkAndLiquidate(): Promise<number> {
    const positions = await this.prisma.futuresPosition.findMany({ where: { status: 'OPEN' } });
    let liquidatedCount = 0;

    for (const position of positions) {
      // Never liquidate off missing data — an honest skip beats a
      // fabricated mark price that could wrongly wipe out a position.
      const markPrice = await this.markPriceService.getMarkPrice(position.symbol);
      if (!markPrice) continue;

      const liquidationPrice = new BigNumber(position.liquidationPrice.toString());
      const side = position.side as PositionSide;
      const triggered =
        side === 'LONG' ? markPrice.isLessThanOrEqualTo(liquidationPrice) : markPrice.isGreaterThanOrEqualTo(liquidationPrice);
      if (!triggered) continue;

      const liquidated = await this.liquidatePosition(position.id, markPrice);
      if (liquidated) liquidatedCount++;
    }

    return liquidatedCount;
  }

  /** Force-closes one position at `markPrice`. Re-checks status inside the
   * transaction so a position closed by the user between the scan and now
   * is never double-liquidated. Returns false (no-op) in that case. */
  async liquidatePosition(positionId: string, markPrice: BigNumber): Promise<boolean> {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const position = await tx.futuresPosition.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'OPEN') return false;

      const side = position.side as PositionSide;
      const size = new BigNumber(position.size.toString());
      const entryPrice = new BigNumber(position.entryPrice.toString());
      const initialMargin = new BigNumber(position.initialMargin.toString());
      const [, quote] = position.symbol.split('/');

      const realizedPnl = computeUnrealizedPnl(side, size, entryPrice, markPrice);
      const marginBalance = initialMargin.plus(realizedPnl);

      // Release the locked margin from the user's wallet — it's forfeited
      // either way (contributed to the fund, or consumed covering the loss).
      await this.adjustBalance(tx, position.userId, quote, { locked: initialMargin.negated() });

      await this.insuranceFund.record(
        tx,
        quote,
        marginBalance,
        marginBalance.isGreaterThanOrEqualTo(0) ? 'LIQUIDATION_SURPLUS' : 'LIQUIDATION_SHORTFALL',
        position.id
      );

      await tx.futuresPosition.update({
        where: { id: position.id },
        data: {
          status: 'LIQUIDATED',
          closedAt: new Date(),
          size: '0',
          realizedPnl: new BigNumber(position.realizedPnl.toString()).plus(realizedPnl).toString(),
        },
      });

      return true;
    });
  }

  private async adjustBalance(tx: TxClient, userId: string, asset: string, delta: { available?: BigNumber; locked?: BigNumber }) {
    const existing = await tx.futuresBalance.upsert({
      where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: '0', locked: '0' },
      update: {},
    });
    const available = new BigNumber(existing.available.toString()).plus(delta.available ?? 0);
    const locked = new BigNumber(existing.locked.toString()).plus(delta.locked ?? 0);
    await tx.futuresBalance.update({
      where: { userId_asset: { userId, asset } },
      data: { available: available.toString(), locked: locked.toString() },
    });
  }

  startScheduler(intervalMs: number = LIQUIDATION_CHECK_INTERVAL_MS): void {
    this.timer = setInterval(() => {
      this.checkAndLiquidate().catch((err) => console.error('Liquidation check failed', err));
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
