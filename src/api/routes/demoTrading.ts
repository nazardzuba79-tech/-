import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { DemoTradingService, DemoTradingError } from '../../services/DemoTradingService';
import { VtaDemoSales, VtaDemoError } from '../../services/testMarkets/VtaDemoSales';

const priceString = z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'must be > 0');

const placeOrderSchema = z
  .object({
    pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
    price: priceString.optional(),
    quantity: priceString,
  })
  .refine((v) => v.type !== 'LIMIT' || v.price !== undefined, { message: 'price is required for a LIMIT order', path: ['price'] });

/**
 * The admin-only demo trading sandbox — see DemoBalance's doc comment in
 * schema.prisma for why this trades against its own MatchingEngine/tables
 * instead of the real ones. Every route here is gated behind requireAdmin:
 * this is a private testing tool for the operator, not a feature any real
 * user account can reach.
 */
export function demoTradingRouter(prisma: PrismaClient, demoTrading: DemoTradingService, vtaDemo = new VtaDemoSales(prisma)): Router {
  const router = Router();

  router.get('/demo/vta', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    try { res.json(await vtaDemo.snapshot(req.userId!)); } catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  router.get('/demo/vta/sales/:requestId', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    const parsed = z.string().uuid().safeParse(req.params.requestId);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request ID' });
    try { res.json(await vtaDemo.operation(req.userId!, parsed.data)); } catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  const vtaSaleSchema = z.object({ requestId: z.string().uuid(), quantity: priceString }).strict();
  router.post('/demo/vta/sell', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    const parsed = vtaSaleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректный запрос продажи.' });
    try { res.json(await vtaDemo.sell({ userId: req.userId!, ...parsed.data })); }
    catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message, ...(error.status === 400 ? { vtaOutcome: 'REJECTED' } : {}) });
      next(error);
    }
  });

  router.get('/demo/balances', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const balances = await demoTrading.getBalances(req.userId!);
    res.json(balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })));
  }));

  router.post('/demo/orders', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { pair, side, type, price, quantity } = parsed.data;

    try {
      const result = await demoTrading.placeOrder({
        userId: req.userId!,
        pair,
        side,
        type,
        price: price ? new BigNumber(price) : undefined,
        quantity: new BigNumber(quantity),
      });
      res.status(201).json({
        order: {
          ...result.order,
          price: result.order.price?.toString() ?? null,
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })),
      });
    } catch (err) {
      if (err instanceof DemoTradingError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.get('/demo/orders/open', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const orders = await demoTrading.getOpenOrders(req.userId!);
    res.json(
      orders.map((o) => ({
        id: o.id,
        pair: o.pair,
        side: o.side,
        type: o.type,
        price: o.price?.toString() ?? null,
        originalQuantity: o.originalQuantity.toString(),
        remainingQuantity: o.remainingQuantity.toString(),
        status: o.status,
        createdAt: o.createdAt,
      }))
    );
  }));

  router.delete('/demo/orders/:orderId', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const cancelled = await demoTrading.cancelOrder(req.userId!, req.params.orderId);
    if (!cancelled) return res.status(404).json({ error: 'Order not found or not cancellable' });
    res.status(204).send();
  }));

  router.get('/demo/orderbook/:pair', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const snapshot = demoTrading.getOrderBook(req.params.pair.toUpperCase());
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  });

  router.get('/demo/trades/:pair', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req, res) => {
    const trades = await demoTrading.getRecentTrades(req.params.pair.toUpperCase());
    res.json(trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })));
  }));

  return router;
}
