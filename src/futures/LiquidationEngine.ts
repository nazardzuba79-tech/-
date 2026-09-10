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

  /** Force-closes one position at `markPrice`. CLAIMS the position inside
   * the transaction so a position closed by the user, or by a TP/SL
   * trigger, between the scan and now is never double-liquidated. Returns
   * false (no-op) in that case. */
  async liquidatePosition(positionId: string, markPrice: BigNumber): Promise<boolean> {
    return this.prisma.$transaction(async (tx: TxClient) => {
      // THE SAME LOCK EVERY FUTURES CLOSE ALREADY TAKES.
      //
      // `FuturesBookTransaction.run` wraps every placement, cancellation and
      // reduce-only close in exactly this advisory transaction lock — the
      // same literal key, because a different one would serialize nothing.
      // Taking it here makes the ordering between liquidation and a TP/SL or
      // manual close DETERMINISTIC rather than a question of how READ
      // COMMITTED and SERIALIZABLE snapshots happen to interleave:
      //
      //   close wins the lock  -> liquidation waits, then sees the position
      //                           is no longer OPEN and no-ops
      //   liquidation wins it  -> it settles, and the close's reduce-only
      //                           preflight then finds no opposing capacity
      //
      // Either way exactly one settlement happens. The conditional claim
      // below is KEPT as defence in depth, so the invariant does not rest on
      // a single mechanism.
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))::text AS locked`
      );

      // A CONDITIONAL WRITE, not a read-then-check.
      //
      // Belt to the lock's braces. Even holding `futures-book`, a
      // `findUnique` + `if (status !== 'OPEN')` guard would be a snapshot
      // read at READ COMMITTED, and a status set by anything that does NOT
      // take the lock would still slip past it and settle a position
      // somebody else had already settled: PnL realized twice and the same
      // margin released twice. `updateMany` compiles to a single
      // `UPDATE ... WHERE id = ? AND status = 'OPEN'`, and PostgreSQL takes
      // the row lock and re-evaluates that predicate against the newest
      // committed version, so exactly one closer can ever see count === 1.
      //
      // Only the guard changed. The liquidation trigger condition, the
      // maintenance-margin and liquidation-price formulas, the total
      // forfeiture of locked margin and the insurance-fund settlement below
      // are all exactly as they were.
      const claimed = await tx.futuresPosition.updateMany({
        where: { id: positionId, status: 'OPEN' },
        data: { status: 'LIQUIDATED' },
      });
      if (claimed.count === 0) return false;

      // Read AFTER the claim: this now reflects any concurrent partial
      // reduce that committed first, so size and margin are the position's
      // real current figures rather than a pre-claim snapshot's.
      const position = await tx.futuresPosition.findUnique({ where: { id: positionId } });
      if (!position) return false;

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
          // status is already LIQUIDATED from the claim above; restated here
          // so the row this method writes is complete and self-describing.
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
