import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { assertCfdFreshQuote, CfdQuoteUnavailable, type CfdQuote, type CfdQuoteSource } from '../services/marketData/cfd/CfdQuote';
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

  constructor(private prisma: PrismaClient, private cfdMarketData: CfdQuoteSource) {}

  async checkAndLiquidate(): Promise<number> {
    if (!this.cfdMarketData.isConfigured()) return 0;
    const positions = await this.prisma.cfdPosition.findMany({ where: { status: 'OPEN' } });
    if (positions.length === 0) return 0;

    let tickers;
    try {
      tickers = await this.cfdMarketData.getQuotes();
    } catch (err) {
      console.error('[CfdLiquidationEngine] Failed to fetch CFD prices:', err);
      return 0;
    }
    const quoteBySymbol = new Map(tickers.map((t) => [t.symbol, t]));

    let liquidatedCount = 0;
    for (const position of positions) {
      const quote = quoteBySymbol.get(position.symbol);
      let markPrice: BigNumber;
      try { markPrice = new BigNumber(assertCfdFreshQuote(quote,position.symbol,this.cfdMarketData.maxQuoteAgeMs)); }
      catch { continue; }

      const liquidationPrice = new BigNumber(position.liquidationPrice.toString());
      const side = position.side as PositionSide;
      const triggered =
        side === 'LONG' ? markPrice.isLessThanOrEqualTo(liquidationPrice) : markPrice.isGreaterThanOrEqualTo(liquidationPrice);
      if (!triggered) continue;

      try {
        const liquidated = await this.liquidatePosition(position.id, quote!);
        if (liquidated) liquidatedCount++;
      } catch (err) {
        // Expiry inside the transaction must roll back its writes before we
        // skip this position. Other positions can still have safe fresh quotes.
        if (!(err instanceof CfdQuoteUnavailable)) throw err;
      }
    }
    return liquidatedCount;
  }

  async liquidatePosition(positionId: string, quote: CfdQuote): Promise<boolean> {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const position = await tx.cfdPosition.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'OPEN') return false;
      const validateQuote = () => assertCfdFreshQuote(quote,position.symbol,this.cfdMarketData.maxQuoteAgeMs);
      let markPrice: BigNumber;
      try { markPrice = new BigNumber(validateQuote()); } catch { return false; }
      const threshold = new BigNumber(position.liquidationPrice.toString());
      if (position.side === 'LONG' ? markPrice.isGreaterThan(threshold) : markPrice.isLessThan(threshold)) return false;

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
      validateQuote();
      await tx.futuresBalance.update({
        where: { userId_asset: { userId: position.userId, asset: MARGIN_ASSET } },
        data: { locked: BigNumber.max(lockedNow.minus(initialMargin), 0).toString() },
      });

      validateQuote();
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
