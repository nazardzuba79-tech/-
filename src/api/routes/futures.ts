import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient, Prisma } from '@prisma/client';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { FuturesPositionService } from '../../futures/FuturesPositionService';
import { MarkPriceService } from '../../futures/MarkPriceService';
import { computeUnrealizedPnl, computeROE, PositionSide } from '../../futures/marginMath';
import {
  FUTURES_SYMBOLS,
  MIN_LEVERAGE,
  MAX_LEVERAGE,
  NEW_ACCOUNT_MAX_LEVERAGE,
  NEW_ACCOUNT_PERIOD_DAYS,
  HIGH_LEVERAGE_WARNING_THRESHOLD,
  LEVERAGE_TIERS,
  FUNDING_INTERVAL_HOURS,
} from '../../config/futuresConfig';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';

const placeOrderSchema = z
  .object({
    symbol: z.enum(FUTURES_SYMBOLS as [string, ...string[]]),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
    price: z
      .string()
      .refine((v) => new BigNumber(v).isGreaterThan(0), 'price must be > 0')
      .optional(),
    quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
    leverage: z.number().int().min(MIN_LEVERAGE).max(MAX_LEVERAGE),
    marginType: z.enum(['ISOLATED', 'CROSS']),
    reduceOnly: z.boolean().optional(),
  })
  .refine((v) => v.type !== 'LIMIT' || v.price !== undefined, {
    message: 'price is required for a LIMIT order',
    path: ['price'],
  });

const transferSchema = z.object({
  asset: z.string(),
  amount: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'amount must be > 0'),
  direction: z.enum(['TO_FUTURES', 'TO_SPOT']),
});

/**
 * Perpetual futures REST surface. Deliberately mirrors orders.ts/balances.ts
 * conventions (same auth middleware, same error-shape, same
 * BigNumber-to-string serialization) so the two trading surfaces feel like
 * one product from the client's point of view, while staying fully
 * separate underneath (own tables, own MatchingEngine instance, own
 * services) per FuturesOrder/FuturesBalance's schema comments.
 */
export function futuresRouter(
  prisma: PrismaClient,
  engine: MatchingEngine,
  positionService: FuturesPositionService,
  markPriceService: MarkPriceService
): Router {
  const router = Router();

  router.get('/futures/config', (_req, res) => {
    res.json({
      symbols: FUTURES_SYMBOLS,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: MAX_LEVERAGE,
      newAccountMaxLeverage: NEW_ACCOUNT_MAX_LEVERAGE,
      newAccountPeriodDays: NEW_ACCOUNT_PERIOD_DAYS,
      // Read-only constant, exposed so the terminal can show the next
      // funding settlement without duplicating the interval client-side
      // (funding lands on UTC multiples of it — see FundingRateService's
      // msUntilNextFundingBoundary). No risk or liquidation logic here.
      fundingIntervalHours: FUNDING_INTERVAL_HOURS,
      highLeverageWarningThreshold: HIGH_LEVERAGE_WARNING_THRESHOLD,
      leverageTiers: LEVERAGE_TIERS,
    });
  });

  router.post('/futures/orders', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { symbol, side, type, price, quantity, leverage, marginType, reduceOnly } = parsed.data;
    try {
      const result = await positionService.placeOrder({
        userId: req.userId!,
        symbol,
        side,
        type,
        price: price ? new BigNumber(price) : undefined,
        quantity: new BigNumber(quantity),
        leverage,
        marginType,
        reduceOnly,
      });
      res.status(201).json({
        order: {
          ...result.order,
          price: result.order.price?.toString(),
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/futures/orders/:orderId', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const cancelled = await positionService.cancelOrder(req.userId!, req.params.orderId);
    if (!cancelled) return res.status(404).json({ error: 'Order not found or not cancellable' });
    res.status(204).send();
  });

  router.get('/futures/orders/me', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const statusParam = req.query.status as string | undefined;
    const statuses = statusParam?.split(',').map((s) => s.trim()).filter(Boolean);
    const orders = await prisma.futuresOrder.findMany({
      where: { userId: req.userId, ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      orders.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: o.price?.toString() ?? null,
        originalQuantity: o.originalQuantity.toString(),
        remainingQuantity: o.remainingQuantity.toString(),
        status: o.status,
        reduceOnly: o.reduceOnly,
        leverage: o.leverage,
        marginType: o.marginType,
        createdAt: o.createdAt,
      }))
    );
  });

  router.get('/futures/orderbook/:symbol', (req, res) => {
    const snapshot = engine.getBook(symbolFromSlug(req.params.symbol)).snapshot();
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  });

  router.get('/futures/mark-price/:symbol', async (req, res) => {
    const symbol = symbolFromSlug(req.params.symbol);
    const [markPrice, indexPrice] = await Promise.all([
      markPriceService.getMarkPrice(symbol),
      markPriceService.getIndexPrice(symbol),
    ]);
    if (!markPrice || !indexPrice) return res.status(502).json({ error: `No index price available for ${symbol}` });
    res.json({ symbol, markPrice: markPrice.toString(), indexPrice: indexPrice.toString() });
  });

  router.get('/futures/funding-rate/:symbol', async (req, res) => {
    const symbol = symbolFromSlug(req.params.symbol);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = await prisma.fundingRateRecord.findMany({
      where: { symbol },
      orderBy: { appliedAt: 'desc' },
      take: limit,
    });
    res.json({
      symbol,
      history: history.map((r) => ({
        rate: r.rate.toString(),
        markPrice: r.markPrice.toString(),
        indexPrice: r.indexPrice.toString(),
        appliedAt: r.appliedAt,
      })),
    });
  });

  router.get('/futures/positions', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await prisma.futuresPosition.findMany({ where: { userId: req.userId, status: 'OPEN' } });
    const markPrices = new Map<string, BigNumber | null>();
    for (const symbol of new Set(positions.map((p) => p.symbol))) {
      markPrices.set(symbol, await markPriceService.getMarkPrice(symbol));
    }

    res.json(
      positions.map((p) => {
        const markPrice = markPrices.get(p.symbol);
        const size = new BigNumber(p.size.toString());
        const entryPrice = new BigNumber(p.entryPrice.toString());
        const initialMargin = new BigNumber(p.initialMargin.toString());
        const unrealizedPnl = markPrice ? computeUnrealizedPnl(p.side as PositionSide, size, entryPrice, markPrice) : null;
        const roe = unrealizedPnl ? computeROE(unrealizedPnl, initialMargin) : null;
        return {
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          size: p.size.toString(),
          entryPrice: p.entryPrice.toString(),
          leverage: p.leverage,
          marginType: p.marginType,
          initialMargin: p.initialMargin.toString(),
          liquidationPrice: p.liquidationPrice.toString(),
          markPrice: markPrice?.toString() ?? null,
          unrealizedPnl: unrealizedPnl?.toString() ?? null,
          roe: roe ? roe.times(100).toString() : null,
          openedAt: p.openedAt,
        };
      })
    );
  });

  router.get('/futures/positions/history', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await prisma.futuresPosition.findMany({
      where: { userId: req.userId, status: { in: ['CLOSED', 'LIQUIDATED'] } },
      orderBy: { closedAt: 'desc' },
      take: 100,
    });
    res.json(
      positions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        leverage: p.leverage,
        marginType: p.marginType,
        entryPrice: p.entryPrice.toString(),
        realizedPnl: p.realizedPnl.toString(),
        status: p.status,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      }))
    );
  });

  // Quick-close: submits a reduceOnly MARKET order for the position's full
  // remaining size in the closing direction. Uses the same order-placement
  // path as everything else — no separate "force close" code path to trust.
  router.post('/futures/positions/:positionId/close', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const position = await prisma.futuresPosition.findUnique({ where: { id: req.params.positionId } });
    if (!position || position.userId !== req.userId || position.status !== 'OPEN') {
      return res.status(404).json({ error: 'Position not found or not open' });
    }
    try {
      const result = await positionService.placeOrder({
        userId: req.userId!,
        symbol: position.symbol,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: new BigNumber(position.size.toString()),
        leverage: position.leverage,
        marginType: position.marginType as 'ISOLATED' | 'CROSS',
        reduceOnly: true,
      });
      res.json({
        order: {
          ...result.order,
          price: result.order.price?.toString(),
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/futures/balances', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const balances = await prisma.futuresBalance.findMany({ where: { userId: req.userId } });
    res.json(balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })));
  });

  // Explicit spot<->futures transfer — margin never moves automatically;
  // the user always chooses when collateral crosses between the two
  // wallets (see FuturesBalance's schema comment on why they're separate).
  router.post('/futures/transfer', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { asset, amount, direction } = parsed.data;
    const userId = req.userId!;
    const transferAmount = new BigNumber(amount);

    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const fromBalance =
          direction === 'TO_FUTURES'
            ? await tx.balance.findUnique({ where: { userId_asset: { userId, asset } } })
            : await tx.futuresBalance.findUnique({ where: { userId_asset: { userId, asset } } });
        const fromAvailable = new BigNumber(fromBalance?.available.toString() ?? '0');
        if (fromAvailable.isLessThan(transferAmount)) {
          throw new Error(`Insufficient ${asset} balance to transfer`);
        }
        const nextFromAvailable = fromAvailable.minus(transferAmount).toString();
        if (direction === 'TO_FUTURES') {
          await tx.balance.update({ where: { userId_asset: { userId, asset } }, data: { available: nextFromAvailable } });
        } else {
          await tx.futuresBalance.update({ where: { userId_asset: { userId, asset } }, data: { available: nextFromAvailable } });
        }

        if (direction === 'TO_FUTURES') {
          const toBalance = await tx.futuresBalance.upsert({
            where: { userId_asset: { userId, asset } },
            create: { userId, asset, available: '0', locked: '0' },
            update: {},
          });
          const toAvailable = new BigNumber(toBalance.available.toString()).plus(transferAmount);
          await tx.futuresBalance.update({ where: { userId_asset: { userId, asset } }, data: { available: toAvailable.toString() } });
        } else {
          const toBalance = await tx.balance.upsert({
            where: { userId_asset: { userId, asset } },
            create: { userId, asset, available: '0', locked: '0' },
            update: {},
          });
          const toAvailable = new BigNumber(toBalance.available.toString()).plus(transferAmount);
          await tx.balance.update({ where: { userId_asset: { userId, asset } }, data: { available: toAvailable.toString() } });
        }
      });
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

function symbolFromSlug(slug: string): string {
  return decodeURIComponent(slug).toUpperCase().replace('-', '/');
}
