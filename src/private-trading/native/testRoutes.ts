import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { AuthedRequest } from '../../api/middleware/auth';
import type { PrivateTradingService } from '../service';
import { PrivateTradingError, type OwnerSession } from '../serviceTypes';
import { privateTradingConfig } from '../access';
import { NativeDemoService } from './service';
import { PrismaNativeRepository } from './store';
import { nativeDemoRoutes } from './routes';
import { assertNativeTrader } from './testAccess';
import { isNativeTestAccount } from './testAccounts';
import { pendingNativeWallet } from './pendingWallet';

/** Mounted AFTER normal authentication, BEFORE the unchanged legacy owner
 * gate. Only the allowlisted test USER enters this router. All other actors
 * fall through to their original policy. No admin or real-wallet API lives here. */
export function nativeTestAccountRoutes(prisma: PrismaClient, service: PrivateTradingService): Router {
  const r = Router();
  const config = service.store?.config ?? privateTradingConfig;
  const native = service.market ? new NativeDemoService(new PrismaNativeRepository(prisma, config), service.market) : null;
  const actor = (res: Response) => res.locals.nativeTestActor as OwnerSession;
  const handle = (run: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void run(req, res).then(value => res.json(value)).catch(next);
  };
  r.use((req: AuthedRequest, res, next) => {
    if (!isNativeTestAccount(req.userId) || req.userId === config().ownerId) return next('router');
    const claims = jwt.decode(req.headers.authorization!.slice(7)) as jwt.JwtPayload;
    const identity: OwnerSession = { userId: req.userId!, sessionId: req.sessionId ?? '', expiresAt: typeof claims?.exp === 'number' ? claims.exp * 1000 : 0 };
    void assertNativeTrader(prisma, identity, config).then(() => {
      if (!native) throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
      res.locals.nativeTestActor = identity;
      next();
    }).catch(next);
  });
  r.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));
  r.get('/access', handle(async () => ({ allowed: true, mode: 'PRIVATE_SIMULATION', nativeAvailable: true, simulationOnly: true })));
  r.get('/native/wallet', handle(async (_req, res) => {
    const current = await native!.wallet(actor(res));
    return current ? { ...current, initialized: true } : pendingNativeWallet(native!, actor(res));
  }));
  // Charts contain public data only. Do not give testers the legacy owner
  // engine merely so the existing native chart loader can read candles.
  r.get('/candles', handle(async (req, res) => {
    const input = z.object({
      symbol: z.string().regex(/^[A-Z0-9]{1,32}(?:\/|-)?USDT$/), source: z.literal('BYBIT_LINEAR'),
      interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']),
      endTime: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      limit: z.coerce.number().int().min(1).max(1500).optional(),
    }).strict().parse(req.query);
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', disconnect); res.once('close', disconnect);
    try {
      const result = await service.market!.chartCandles({ ...input, symbol: input.symbol.replace(/[-/]USDT$/, 'USDT'), signal: abort.signal });
      if (abort.signal.aborted) throw new PrivateTradingError('cancelled', 'Запрос отменён', 409);
      await assertNativeTrader(prisma, actor(res), config);
      return result;
    } finally { req.removeListener('aborted', disconnect); res.removeListener('close', disconnect); }
  }));
  if (native) r.use('/native', nativeDemoRoutes(native, actor));
  // No fall-through into allocate, previews or any other legacy owner tool.
  r.use((_req, _res, next) => next(new PrivateTradingError('private_access_denied', 'Режим недоступен', 403)));
  return r;
}
