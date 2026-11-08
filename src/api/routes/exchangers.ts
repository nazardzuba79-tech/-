import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isMethodIdShape, isSupportedPair } from '../../shared/exchangers/catalog';
import { parseRubAmount } from '../../shared/exchangers/amount';
import type { AssetId, DirectoryResponse, ExchangersErrorResponse, NetworkId, OffersResponse } from '../../shared/exchangers/types';
import type { ExchangersService } from '../../services/exchangers/BestChangeService';

/**
 * «Обменники» (/exchangers, #694) — public, read-only BestChange comparison.
 *
 *   GET /exchangers/directory
 *   GET /exchangers/offers?method=&asset=&network=&amount=
 *
 * No auth and never a 401 (a 401 would log a visitor with a stale token out).
 * Answers: 200 ok | 200 not_configured | 400 invalid | 429 rate_limited |
 * 503 unavailable. No error text, upstream URL, key or upstream body is ever
 * returned or logged: the service already reduces every failure to a status.
 */
export interface ExchangersRouterOptions {
  /** Per client (req.ip) per minute. Default 60. */
  perClientLimit?: number;
  windowMs?: number;
}

const OFFERS_KEYS = new Set(['method', 'asset', 'network', 'amount']);
const MAX_QUERY_LENGTH = 256;

function retryAfterFrom(req: Request, property: string, windowMs: number): number {
  const info = (req as unknown as Record<string, { resetTime?: Date } | undefined>)[property];
  const reset = info?.resetTime instanceof Date ? info.resetTime.getTime() : Date.now() + windowMs;
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

function send(res: Response, body: DirectoryResponse | OffersResponse): void {
  switch (body.status) {
    case 'ok':
      res.setHeader('Cache-Control', 'public, max-age=15');
      res.status(200).json(body);
      return;
    case 'not_configured':
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ status: 'not_configured' });
      return;
    case 'invalid':
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ status: 'invalid' });
      return;
    default: {
      // 'unavailable' (and, defensively, anything unexpected) ⇒ 503 with a fixed body.
      const hint = 'retryAfter' in body ? body.retryAfter : undefined;
      const retryAfter = typeof hint === 'number' && Number.isFinite(hint) && hint > 0 ? Math.min(3600, Math.ceil(hint)) : 30;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', String(retryAfter));
      res.status(503).json({ status: 'unavailable', retryAfter } satisfies ExchangersErrorResponse);
    }
  }
}

function sendUnexpected(res: Response): void {
  console.error('[exchangers] request failed');
  if (res.headersSent) return;
  send(res, { status: 'unavailable', retryAfter: 30 });
}

function single(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

export function exchangersRouter(service: ExchangersService, options: ExchangersRouterOptions = {}): Router {
  const router = Router();
  const windowMs = options.windowMs ?? 60_000;

  const limited = (property: string) => (req: Request, res: Response) => {
    const retryAfter = retryAfterFrom(req, property, windowMs);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ status: 'rate_limited', retryAfter } satisfies ExchangersErrorResponse);
  };

  // Per client only. There is deliberately no process-wide (constant-key) ceiling: a shared
  // counter would let a handful of clients lock every visitor out of a public page, and it
  // would protect nothing upstream — BestChange traffic is bounded by the service's snapshot
  // TTL, single in-flight refresh and failure cooldown, never by client volume. The app-wide
  // limiter in src/index.ts still applies in front of this router.
  router.use('/exchangers', rateLimit({
    windowMs,
    limit: options.perClientLimit ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
    requestPropertyName: 'exchangersClientRateLimit',
    handler: limited('exchangersClientRateLimit'),
  }));

  router.get('/exchangers/directory', async (_req, res) => {
    try {
      send(res, await service.directory());
    } catch {
      sendUnexpected(res);
    }
  });

  router.get('/exchangers/offers', async (req, res) => {
    try {
      const rawQuery = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
      const keys = Object.keys(req.query);
      const method = single(req.query.method);
      const asset = single(req.query.asset);
      const network = single(req.query.network);
      const amountRaw = single(req.query.amount);
      const amount = amountRaw === null ? null : parseRubAmount(amountRaw);
      if (
        rawQuery.length > MAX_QUERY_LENGTH
        || keys.length !== OFFERS_KEYS.size
        || keys.some((k) => !OFFERS_KEYS.has(k))
        || !isMethodIdShape(method)
        || !isSupportedPair(asset, network)
        || amount === null
      ) {
        send(res, { status: 'invalid' });
        return;
      }
      send(res, await service.offers({ method, asset: asset as AssetId, network: network as NetworkId, amount }));
    } catch {
      sendUnexpected(res);
    }
  });

  return router;
}
