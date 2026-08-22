import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { OrderService, PriceSource } from '../../services/OrderService';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';

const CONDITIONAL_TYPES = ['STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET'];
const LIMIT_FAMILY = ['LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT'];

const priceString = z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'must be > 0');

const placeOrderSchema = z
  .object({
    pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET', 'STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET']).default('LIMIT'),
    price: priceString.optional(),
    triggerPrice: priceString.optional(),
    quantity: priceString,
  })
  .refine((v) => !LIMIT_FAMILY.includes(v.type) || v.price !== undefined, {
    message: 'price is required for this order type',
    path: ['price'],
  })
  .refine((v) => !CONDITIONAL_TYPES.includes(v.type) || v.triggerPrice !== undefined, {
    message: 'triggerPrice is required for this order type',
    path: ['triggerPrice'],
  });

const placeOcoOrderSchema = z.object({
  pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
  side: z.enum(['BUY', 'SELL']),
  quantity: priceString,
  takeProfitPrice: priceString,
  stopTriggerPrice: priceString,
  stopLimitPrice: priceString,
});

export function ordersRouter(prisma: PrismaClient, engine: MatchingEngine, priceSource: PriceSource): Router {
  const router = Router();
  const orderService = new OrderService(prisma, engine, priceSource);

  router.post('/orders', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { pair, side, type, price, triggerPrice, quantity } = parsed.data;

    try {
      const result = await orderService.placeOrder({
        userId: req.userId!,
        pair,
        side,
        type,
        price: price ? new BigNumber(price) : undefined,
        triggerPrice: triggerPrice ? new BigNumber(triggerPrice) : undefined,
        quantity: new BigNumber(quantity),
      });
      res.status(201).json({
        order: {
          ...result.order,
          price: result.order.price?.toString(),
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t: (typeof result.trades)[number]) => ({
        ...t,
        price: t.price.toString(),
        quantity: t.quantity.toString(),
      })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // OCO: a take-profit leg and a stop leg placed together, sharing one
  // fund lock — whichever triggers first cancels the other (see
  // OrderService.placeOcoOrder / PriceWatcherService).
  router.post('/orders/oco', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = placeOcoOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { pair, side, quantity, takeProfitPrice, stopTriggerPrice, stopLimitPrice } = parsed.data;

    try {
      const result = await orderService.placeOcoOrder({
        userId: req.userId!,
        pair,
        side,
        quantity: new BigNumber(quantity),
        takeProfitPrice: new BigNumber(takeProfitPrice),
        stopTriggerPrice: new BigNumber(stopTriggerPrice),
        stopLimitPrice: new BigNumber(stopLimitPrice),
      });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Own orders, newest first — powers the "Open Orders" panel on the trade
  // page. Not paginated: fine for a single user's order history on an
  // internal team exchange, revisit if that stops being true.
  router.get('/orders/me', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    // Accepts a single status ("OPEN") or a comma-separated list
    // ("OPEN,PARTIALLY_FILLED") so the trade page can ask for "open orders"
    // and "order history" as two distinct queries instead of filtering
    // client-side.
    const statusParam = req.query.status as string | undefined;
    const statuses = statusParam?.split(',').map((s) => s.trim()).filter(Boolean);
    const orders = await prisma.order.findMany({
      where: {
        userId: req.userId,
        ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      orders.map((o: (typeof orders)[number]) => ({
        id: o.id,
        pair: o.pair,
        side: o.side,
        type: o.type,
        price: o.price?.toString() ?? null,
        triggerPrice: o.triggerPrice?.toString() ?? null,
        ocoGroupId: o.ocoGroupId,
        originalQuantity: o.originalQuantity.toString(),
        remainingQuantity: o.remainingQuantity.toString(),
        status: o.status,
        createdAt: o.createdAt,
      }))
    );
  });

  router.get('/orderbook/:pair', async (req, res) => {
    const snapshot = engine.getBook(req.params.pair.toUpperCase()).snapshot();
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  });

  // Moves a still-pending conditional order's trigger (and, for a
  // LIMIT-family one, execution) price — powers dragging a SL/TP line on
  // the chart.
  router.patch('/orders/:orderId/trigger', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = z
      .object({ triggerPrice: priceString.optional(), price: priceString.optional() })
      .refine((v) => v.triggerPrice !== undefined || v.price !== undefined, 'at least one of triggerPrice/price is required')
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten?.() ?? parsed.error.message });
    }
    try {
      const result = await orderService.updateConditionalOrder(req.userId!, req.params.orderId, {
        triggerPrice: parsed.data.triggerPrice ? new BigNumber(parsed.data.triggerPrice) : undefined,
        price: parsed.data.price ? new BigNumber(parsed.data.price) : undefined,
      });
      if (!result) return res.status(404).json({ error: 'Order not found or no longer pending' });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/orders/:orderId', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const cancelled = await orderService.cancelOrder(req.userId!, req.params.orderId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Order not found or not cancellable' });
    }
    res.status(204).send();
  });

  return router;
}
