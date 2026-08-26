import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { CfdMarketDataService } from '../services/CfdMarketDataService';
import { computeUnrealizedPnl, PositionSide } from '../futures/marginMath';
import { LIQUIDATION_CHECK_INTERVAL_MS } from '../config/futuresConfig';

type TxClient = Prisma.TransactionClient;
const MARGIN_ASSET = 'USDT';

/**
 * CFD counterpart of LiquidationEngine — same "check every open position's
 * mark price against its liquidationPrice, force-close any that crossed
 * it" loop, but reading prices from Twelve Data instead of Kraken and
 * releasing margin with negative-balance protection (see
 * CfdPositionService.close) instead of an insurance-fund settlement,
 * since a CFD loss can never exceed the position's own locked margin.
 */
export class CfdLiquidationEngine {
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaClient, private cfdMarketData: CfdMarketDataService) {}

  async checkAndLiquidate(): Promise<number> {
    if (!this.cfdMarketData.isConfigured()) return 0;
    const positions = await this.prisma.cfdPosition.findMany({ where: { status: 'OPEN' } });
    if (positions.length === 0) return 0;

    let tickers;
    try {
      tickers = await this.cfdMarketData.getTickers();
    } catch (err) {
      console.error('[CfdLiquidationEngine] Failed to fetch CFD prices:', err);
      return 0;
    }
    const priceBySymbol = new Map(tickers.map((t) => [t.symbol, new BigNumber(t.price)]));

    let liquidatedCount = 0;
    for (const position of positions) {
      const markPrice = priceBySymbol.get(position.symbol);
      if (!markPrice || !markPrice.isFinite() || markPrice.isLessThanOrEqualTo(0)) continue; // honest skip, no fabricated price

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

  async liquidatePosition(positionId: string, markPrice: BigNumber): Promise<boolean> {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const position = await tx.cfdPosition.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'OPEN') return false;

      const side = position.side as PositionSide;
      const size = new BigNumber(position.size.toString());
      const entryPrice = new BigNumber(position.entryPrice.toString());
      const initialMargin = new BigNumber(position.initialMargin.toString());
      const realizedPnl = computeUnrealizedPnl(side, size, entryPrice, markPrice);

      // Liquidation forfeits the position's entire locked margin — the
      // trader gets nothing back, same as futures. Negative-balance
      // protection still applies: the loss stops at the margin locked.
      const balance = await tx.futuresBalance.findUnique({ where: { userId_asset: { userId: position.userId, asset: MARGIN_ASSET } } });
      const lockedNow = new BigNumber(balance?.locked.toString() ?? '0');
      await tx.futuresBalance.update({
        where: { userId_asset: { userId: position.userId, asset: MARGIN_ASSET } },
        data: { locked: BigNumber.max(lockedNow.minus(initialMargin), 0).toString() },
      });

      await tx.cfdPosition.update({
        where: { id: position.id },
        data: { status: 'LIQUIDATED', closedAt: new Date(), realizedPnl: realizedPnl.toString() },
      });

      return true;
    });
  }

  startScheduler(intervalMs: number = LIQUIDATION_CHECK_INTERVAL_MS): void {
    this.timer = setInterval(() => {
      this.checkAndLiquidate().catch((err) => console.error('CFD liquidation check failed', err));
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
