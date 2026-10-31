import { createHash } from 'crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncRoute } from '../asyncRoute';
import type { NativeDemoService } from '../../private-trading/native/service';
import { DemoEngineError } from '../../private-trading/native/engine';
import { PrivateTradingError } from '../../private-trading/serviceTypes';
import { FuturesCopyExecutionError, FuturesDemoFollowerExecutor } from '../../services/copyTrading/FuturesDemoFollowerExecutor';
import { FuturesDemoObserverError } from '../../services/copyTrading/FuturesDemoObserverService';

const limits = z.object({
  ratio: z.string().max(32), maxLeverage: z.string().max(32), maxFillUsdt: z.string().max(32),
  maxTotalExposureUsdt: z.string().max(32), maxDeviationBps: z.string().max(16),
}).strict();

/**
 * Follower-initiated copy of a bound leader's Native Demo Futures OPEN/CLOSE.
 *
 * Every command runs as the signed-in follower's OWN session against their own
 * NativeDemoAccount; there is no worker, no service identity and no leader
 * write. The executor itself is hard-OFF outside the disposable loopback
 * review gate (NODE_ENV=test + local copy_demo_* database + explicit flags).
 */
export function copyFuturesDemoExecutionRouter(
  db: PrismaClient, executor: FuturesDemoFollowerExecutor | null,
  native: Pick<NativeDemoService, 'command'> | null, enabled: () => boolean,
) {
  const router = Router();
  const base = '/copy-trading/futures-demo-execution';
  router.use(base,
    (_req, res, next) => enabled() && executor && native ? next() : res.status(403).json({ code: 'FUTURES_COPY_EXECUTOR_OFF' }),
    requireAuth(db),
    (req: AuthedRequest, res, next) => req.sessionId ? next() : res.status(401).json({ code: 'SESSION_REQUIRED' }));
  router.get(base, asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await executor!.snapshot(req.userId!, req.sessionId!));
  }));
  router.put(base, asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = limits.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'INVALID_COPY_EXECUTION_LIMITS' });
    res.setHeader('Cache-Control', 'no-store');
    await executor!.begin(req.userId!, req.sessionId!, parsed.data);
    res.json(await executor!.snapshot(req.userId!, req.sessionId!));
  }));
  router.delete(base, asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const stopped = await executor!.stop(req.userId!, req.sessionId!);
    res.json({ ...stopped, ...(await executor!.snapshot(req.userId!, req.sessionId!)) });
  }));
  router.post(`${base}/run`, asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // requireAuth verified this bearer; read only its verified expiry, exactly
    // like the Futures terminal does, and never extend it.
    const claims = jwt.decode(req.headers.authorization!.slice(7)) as jwt.JwtPayload | null;
    const actor = { userId: req.userId!, sessionId: req.sessionId!,
      expiresAt: typeof claims?.exp === 'number' ? claims.exp * 1000 : 0 };
    if (actor.expiresAt <= Date.now()) return res.status(401).json({ code: 'SESSION_REQUIRED' });
    // Admit THIS session to the follower's own Native Demo account (the same
    // persisted REFRESH the terminal performs). Deterministic per session and
    // expiry, so a double click or retry answers with the first receipt.
    const key = 'copy-admit-' + createHash('sha256').update(`${actor.sessionId}:${actor.expiresAt}`).digest('hex').slice(0, 48);
    await native!.command(actor, { kind: 'REFRESH', idempotencyKey: key }, { persist: true });
    const run = await executor!.run(req.userId!, req.sessionId!, 10);
    res.json({ ...run, ...(await executor!.snapshot(req.userId!, req.sessionId!)) });
  }));
  router.use((error: unknown, _req: unknown, res: any, next: (e: unknown) => void) => {
    if (error instanceof FuturesCopyExecutionError || error instanceof FuturesDemoObserverError)
      return res.status(error.status).json({ code: error.code });
    if (error instanceof DemoEngineError) return res.status(409).json({ code: error.code });
    // Native admission refusals (uninitialized/expired account, session) keep their own status.
    if (error instanceof PrivateTradingError) return res.status(error.status).json({ code: error.code });
    next(error);
  });
  return router;
}
