import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import BigNumber from 'bignumber.js';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { PrivateTradingService } from '../../private-trading/service';
import { OwnerSession, PrivateTradingError, TradeRequest } from '../../private-trading/serviceTypes';
import { PrivateMarketDataError } from '../../private-trading/marketData';

const signed = z.string().max(60).regex(/^-?\d{1,18}(?:\.\d{1,18})?$/).refine(v => new BigNumber(v).isFinite());
const positive = signed.refine(v => new BigNumber(v).gt(0));
const time = z.string().datetime({ offset: true });
const eventTime = z.union([time.transform(v => Date.parse(v)), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const key = z.string().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/);
const identity = z.object({ idempotencyKey: key }).strict();
const protection = { takeProfit: positive.nullable().optional(), stopLoss: positive.nullable().optional() };
const candleSelection = z.object({ source: z.literal('BYBIT_LINEAR'), interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']),
  openTime: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), pricePoint: z.enum(['OPEN', 'CLOSE']) }).strict();
const scenarioEvent = z.discriminatedUnion('kind', [
  z.object({ id: key, kind: z.literal('MARGIN'), effectiveAt: eventTime, amount: signed }).strict(),
  z.object({ id: key, kind: z.literal('CLOSE'), effectiveAt: eventTime, quantity: positive }).strict(),
  z.object({ id: key, kind: z.literal('TPSL'), effectiveAt: eventTime, takeProfit: positive.nullable(), stopLoss: positive.nullable() }).strict(),
]);
export const privatePreviewSchema = z.object({
  mode: z.enum(['DEMO_LIVE', 'HISTORICAL_REPLAY']), symbol: z.string().max(40).regex(/^[A-Z0-9]+(?:\/|-)?USDT$/),
  side: z.enum(['LONG', 'SHORT']), type: z.enum(['MARKET', 'LIMIT']), leverage: positive,
  quantity: positive.optional(), margin: positive.optional(), limitPrice: positive.optional(), ...protection,
  effectiveOpenedAt: time.optional(), effectiveClosedAt: time.optional(), asOf: time.optional(),
  capital: positive.optional(), manualEntryPrice: positive.optional(), events: z.array(scenarioEvent).max(100).optional(), idempotencyKey: key,
  candleEntry: candleSelection.optional(),
}).strict().superRefine((v, ctx) => {
  const issue = (message: string, path: string[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if (Boolean(v.quantity) === Boolean(v.margin)) issue('Укажите количество или маржу', ['quantity']);
  if (v.type === 'LIMIT' && !v.limitPrice) issue('Укажите лимитную цену', ['limitPrice']);
  if (v.mode === 'HISTORICAL_REPLAY') {
    if (!v.effectiveOpenedAt && !v.candleEntry) issue('Выберите свечу входа', ['candleEntry']);
    if (v.candleEntry && (v.effectiveOpenedAt || v.manualEntryPrice || v.effectiveClosedAt)) issue('Цена и время определяются выбранной свечой', ['candleEntry']);
    if (v.type !== 'MARKET') issue('Для входа по свече выберите рыночный тип', ['type']);
  } else if (v.candleEntry || v.effectiveOpenedAt || v.effectiveClosedAt || v.asOf || v.manualEntryPrice || v.capital || v.events?.length) {
    issue('Исторические параметры доступны только в историческом режиме', ['mode']);
  }
});

export function privateTradingRouter(prisma: PrismaClient, service: PrivateTradingService): Router {
  const router = Router();
  const authenticate = requireAuth(prisma);
  router.use('/private-trading', (req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization'); void Promise.resolve(authenticate(req, res, next)).catch(next); });
  router.use('/private-trading', async (req: AuthedRequest, res, next) => {
    try {
      // requireAuth has verified this same bearer token. Decode only its already-verified expiry.
      const claims = jwt.decode(req.headers.authorization!.slice(7)) as jwt.JwtPayload;
      const actor: OwnerSession = { userId: req.userId!, sessionId: req.sessionId ?? '', expiresAt: typeof claims?.exp === 'number' ? claims.exp * 1000 : 0 };
      await service.store.authorized(actor); res.locals.privateActor = actor; next();
    } catch (error) { next(error); }
  });
  router.use('/private-trading', rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));
  const actor = (res: Response) => res.locals.privateActor as OwnerSession;
  const handle = (run: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void run(req, res).then(result => { if (!res.headersSent) res.json(result); }).catch(next);
  };
  router.get('/private-trading/access', handle(async () => ({ allowed: true, mode: 'PRIVATE_SIMULATION' })));
  router.get('/private-trading/state', handle(async (_req, res) => service.state(actor(res))));
  router.get('/private-trading/market', handle(async (req, res) => service.getMarket(actor(res), z.string().min(1).max(40).parse(req.query.symbol))));
  router.get('/private-trading/candles', handle(async (req, res) => {
    const input = z.object({ symbol: z.string().min(1).max(40), source: z.literal('BYBIT_LINEAR'),
      interval: candleSelection.shape.interval, endTime: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      limit: z.coerce.number().int().min(1).max(1500).optional() }).strict().parse(req.query);
    const abort = new AbortController(), disconnect = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', disconnect); res.once('close', disconnect);
    try { return await service.getChartCandles(actor(res), input, abort.signal); }
    finally { req.removeListener('aborted', disconnect); res.removeListener('close', disconnect); }
  }));
  router.post('/private-trading/allocate', handle(async (req, res) => {
    const input = z.object({ amount: positive, idempotencyKey: key }).strict().parse(req.body);
    return service.store.allocate(actor(res), input.amount, input.idempotencyKey);
  }));
  router.post('/private-trading/previews', handle(async (req, res) => service.preview(actor(res), privatePreviewSchema.parse(req.body) as TradeRequest)));
  router.get('/private-trading/previews/:id', handle(async (req, res) => service.getPreview(actor(res), req.params.id)));
  router.delete('/private-trading/previews/:id', handle(async (req, res) => service.cancelPreview(actor(res), req.params.id)));
  router.post('/private-trading/previews/:id/confirm', handle(async (req, res) => service.confirm(actor(res), req.params.id, identity.parse(req.body).idempotencyKey)));
  router.delete('/private-trading/orders/:id', handle(async (req, res) => service.cancelOrder(actor(res), req.params.id, identity.parse(req.body).idempotencyKey)));
  router.post('/private-trading/positions/:id/close', handle(async (req, res) => {
    const input = z.object({ quantity: positive.optional(), idempotencyKey: key }).strict().parse(req.body);
    return service.close(actor(res), req.params.id, input.quantity, input.idempotencyKey);
  }));
  router.patch('/private-trading/positions/:id', handle(async (req, res) => {
    const { idempotencyKey, ...input } = z.object({ ...protection, marginDelta: signed.optional(), leverage: positive.optional(), idempotencyKey: key }).strict().parse(req.body);
    if (!Object.keys(input).length) throw new PrivateTradingError('empty_change', 'Укажите изменение позиции');
    return service.edit(actor(res), req.params.id, input, idempotencyKey);
  }));
  router.post('/private-trading/scenarios/:id/advance', handle(async (req, res) => {
    const input = z.object({ asOf: time, idempotencyKey: key }).strict().parse(req.body);
    return service.advance(actor(res), req.params.id, input.asOf, input.idempotencyKey);
  }));
  router.post('/private-trading/scenarios/:id/close-on-chart', handle(async (req, res) => {
    const input = z.object({ candle: candleSelection, idempotencyKey: key }).strict().parse(req.body);
    return service.closeOnChart(actor(res), req.params.id, input.candle, input.idempotencyKey);
  }));
  router.post('/private-trading/cards', handle(async (req, res) => service.card(actor(res), z.object({ positionId: z.string().min(1).max(100) }).strict().parse(req.body).positionId)));
  router.get('/private-trading/cards/:id', handle(async (req, res) => service.getCard(actor(res), req.params.id)));
  router.use('/private-trading', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ code: 'invalid_request', error: 'Проверьте параметры запроса', fields: error.flatten().fieldErrors });
    if (error instanceof PrivateTradingError) return res.status(error.status).json({ code: error.code, error: error.message });
    if (error instanceof PrivateMarketDataError) return res.status(error.status === 400 ? 400 : 503).json({ code: error.code, error: 'Котировки временно недоступны. Обновите расчёт.' });
    return res.status(500).json({ code: 'private_trading_unavailable', error: 'Операция временно недоступна' });
  });
  return router;
}
