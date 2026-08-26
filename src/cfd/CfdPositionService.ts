import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { CfdMarketDataService, CFD_INSTRUMENTS } from '../services/CfdMarketDataService';
import { computeInitialMargin, computeLiquidationPrice, computeUnrealizedPnl, PositionSide } from '../futures/marginMath';
import { MIN_LEVERAGE, MAX_LEVERAGE, NEW_ACCOUNT_MAX_LEVERAGE, NEW_ACCOUNT_PERIOD_DAYS, getLeverageTier } from '../config/futuresConfig';

type TxClient = Prisma.TransactionClient;

// The margin wallet is the same FuturesBalance USDT row Futures trading
// already uses — one "leveraged trading balance" backs both instrument
// classes, same as a real broker's unified margin account. Nothing here
// ever touches spot Balance.
const MARGIN_ASSET = 'USDT';

/**
 * Dealer-model CFD trading — deliberately NOT built on the matching engine
 * FuturesPositionService uses. There's no realistic peer liquidity for
 * "gold" or "NAS100" among our own users, so every open/close fills
 * instantly against the current live Twelve Data mark price, with this
 * platform as the counterparty. That's exactly how real retail CFD/forex
 * brokers work (IG, OANDA, etc. — no public central order book either),
 * so this isn't a simulation standing in for something more real; it's
 * the real model for this asset class.
 *
 * v1 is deliberately narrower than futures: MARKET fills only, ISOLATED
 * margin only, no position flip (closing an opposite-direction position
 * must happen before opening the new one) — enough to actually trade,
 * without the extra surface area of the futures matching/flip logic that
 * doesn't apply here anyway.
 */
export class CfdPositionService {
  constructor(private prisma: PrismaClient, private cfdMarketData: CfdMarketDataService) {}

  private async getLivePrice(symbol: string): Promise<BigNumber> {
    const instrument = CFD_INSTRUMENTS.find((i) => i.symbol === symbol);
    if (!instrument) throw new Error(`Unknown CFD instrument: ${symbol}`);
    const tickers = await this.cfdMarketData.getTickers();
    const ticker = tickers.find((t) => t.symbol === symbol);
    if (!ticker) throw new Error(`No live price available for ${symbol} right now`);
    const price = new BigNumber(ticker.price);
    if (!price.isFinite() || price.isLessThanOrEqualTo(0)) throw new Error(`No live price available for ${symbol} right now`);
    return price;
  }

  async open(params: { userId: string; symbol: string; side: 'BUY' | 'SELL'; quantity: BigNumber; leverage: number }) {
    if (!Number.isInteger(params.leverage) || params.leverage < MIN_LEVERAGE || params.leverage > MAX_LEVERAGE) {
      throw new Error(`Leverage must be an integer between ${MIN_LEVERAGE} and ${MAX_LEVERAGE}`);
    }
    if (!params.quantity.isGreaterThan(0)) {
      throw new Error('Quantity must be greater than zero');
    }

    const price = await this.getLivePrice(params.symbol);
    const direction: PositionSide = params.side === 'BUY' ? 'LONG' : 'SHORT';
    const notional = params.quantity.times(price);

    const tier = getLeverageTier(notional.toNumber());
    if (params.leverage > tier.maxLeverage) {
      throw new Error(`Max leverage for a ${notional.toFixed(2)} USDT position is ${tier.maxLeverage}x`);
    }

    return this.prisma.$transaction(async (tx: TxClient) => {
      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new Error('User not found');
      const accountAgeDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < NEW_ACCOUNT_PERIOD_DAYS && params.leverage > NEW_ACCOUNT_MAX_LEVERAGE) {
        throw new Error(`New accounts are limited to ${NEW_ACCOUNT_MAX_LEVERAGE}x leverage for the first ${NEW_ACCOUNT_PERIOD_DAYS} days`);
      }

      const existing = await tx.cfdPosition.findFirst({
        where: { userId: params.userId, symbol: params.symbol, status: 'OPEN' },
      });
      if (existing && (existing.side as PositionSide) !== direction) {
        throw new Error('You already have an open position on this instrument in the opposite direction — close it first');
      }

      const addedMargin = computeInitialMargin(notional, params.leverage);
      const balance = await tx.futuresBalance.findUnique({ where: { userId_asset: { userId: params.userId, asset: MARGIN_ASSET } } });
      const available = new BigNumber(balance?.available.toString() ?? '0');
      if (available.isLessThan(addedMargin)) {
        throw new Error(`Insufficient ${MARGIN_ASSET} margin balance`);
      }
      await tx.futuresBalance.upsert({
        where: { userId_asset: { userId: params.userId, asset: MARGIN_ASSET } },
        create: { userId: params.userId, asset: MARGIN_ASSET, available: available.minus(addedMargin).toString(), locked: addedMargin.toString() },
        update: {
          available: available.minus(addedMargin).toString(),
          locked: new BigNumber(balance!.locked.toString()).plus(addedMargin).toString(),
        },
      });

      if (existing) {
        const existingSize = new BigNumber(existing.size.toString());
        const existingEntry = new BigNumber(existing.entryPrice.toString());
        const existingMargin = new BigNumber(existing.initialMargin.toString());
        const newSize = existingSize.plus(params.quantity);
        const newEntry = existingSize.times(existingEntry).plus(params.quantity.times(price)).dividedBy(newSize);
        const newMargin = existingMargin.plus(addedMargin);
        const newNotional = newSize.times(newEntry);
        const newTier = getLeverageTier(newNotional.toNumber());
        const liquidationPrice = computeLiquidationPrice(newEntry, direction, params.leverage, newTier.maintenanceMarginRate);
        return tx.cfdPosition.update({
          where: { id: existing.id },
          data: {
            size: newSize.toString(),
            entryPrice: newEntry.toString(),
            leverage: params.leverage,
            initialMargin: newMargin.toString(),
            liquidationPrice: liquidationPrice.toString(),
          },
        });
      }

      const liquidationPrice = computeLiquidationPrice(price, direction, params.leverage, tier.maintenanceMarginRate);
      return tx.cfdPosition.create({
        data: {
          userId: params.userId,
          symbol: params.symbol,
          side: direction,
          size: params.quantity.toString(),
          entryPrice: price.toString(),
          leverage: params.leverage,
          initialMargin: addedMargin.toString(),
          liquidationPrice: liquidationPrice.toString(),
          status: 'OPEN',
        },
      });
    });
  }

  async close(params: { userId: string; positionId: string }) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const position = await tx.cfdPosition.findUnique({ where: { id: params.positionId } });
      if (!position || position.userId !== params.userId) throw new Error('Position not found');
      if (position.status !== 'OPEN') throw new Error('Position is not open');

      const price = await this.getLivePrice(position.symbol);
      const side = position.side as PositionSide;
      const size = new BigNumber(position.size.toString());
      const entryPrice = new BigNumber(position.entryPrice.toString());
      const initialMargin = new BigNumber(position.initialMargin.toString());
      const realizedPnl = computeUnrealizedPnl(side, size, entryPrice, price);
      // Negative-balance protection: a loss can never take more than the
      // margin actually locked to this position — same guarantee real
      // retail CFD brokers are legally required to give.
      const marginBalance = BigNumber.max(initialMargin.plus(realizedPnl), 0);

      const balance = await tx.futuresBalance.findUnique({ where: { userId_asset: { userId: params.userId, asset: MARGIN_ASSET } } });
      const lockedNow = new BigNumber(balance?.locked.toString() ?? '0');
      const availableNow = new BigNumber(balance?.available.toString() ?? '0');
      await tx.futuresBalance.update({
        where: { userId_asset: { userId: params.userId, asset: MARGIN_ASSET } },
        data: {
          available: availableNow.plus(marginBalance).toString(),
          locked: BigNumber.max(lockedNow.minus(initialMargin), 0).toString(),
        },
      });

      return tx.cfdPosition.update({
        where: { id: position.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          realizedPnl: realizedPnl.toString(),
        },
      });
    });
  }

  async listOpen(userId: string) {
    return this.prisma.cfdPosition.findMany({ where: { userId, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  }

  async listHistory(userId: string) {
    return this.prisma.cfdPosition.findMany({ where: { userId, status: { in: ['CLOSED', 'LIQUIDATED'] } }, orderBy: { closedAt: 'desc' }, take: 100 });
  }
}
