import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from './auth';
import { decryptApiSecret } from '../../services/ApiKeyService';

const TIMESTAMP_TOLERANCE_MS = 30_000;

export interface ApiAuthedRequest extends AuthedRequest {
  apiKeyId?: string;
  apiKeyCanTrade?: boolean;
}

/**
 * Drop-in replacement for requireAuth on endpoints a trading bot needs
 * (place/cancel orders, read balances/orders): if the request carries an
 * X-API-KEY header, authenticate it via HMAC signature instead of a JWT;
 * otherwise fall back to the normal logged-in-browser JWT flow untouched.
 *
 * Signing recipe a client must follow (see the API tab in Settings for the
 * user-facing version of this): for a request at `timestamp` (ms epoch),
 *   message   = `${timestamp}${method}${path}${JSON.stringify(body ?? {})}`
 *   signature = HMAC_SHA256(apiSecret, message)  // hex-encoded
 * `path` is the request path INCLUDING `/api/v1/...` but not the query
 * string (e.g. "/api/v1/orders"); `body` is `{}` (not empty string) for a
 * bodyless request.
 */
export function requireAuthOrApiKey(prisma: PrismaClient) {
  return async (req: ApiAuthedRequest, res: Response, next: NextFunction) => {
    const apiKeyHeader = req.header('X-API-KEY');
    if (!apiKeyHeader) {
      return requireAuth(req, res, next);
    }

    const timestamp = req.header('X-API-TIMESTAMP');
    const signature = req.header('X-API-SIGNATURE');
    if (!timestamp || !signature) {
      return res.status(401).json({ error: 'Missing X-API-TIMESTAMP or X-API-SIGNATURE header' });
    }

    const skew = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(skew) || skew > TIMESTAMP_TOLERANCE_MS) {
      return res.status(401).json({ error: 'Request timestamp is missing, invalid, or too old' });
    }

    const record = await prisma.apiKey.findUnique({ where: { apiKey: apiKeyHeader } });
    if (!record || record.revokedAt) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    let expectedSignature: string;
    try {
      const secret = decryptApiSecret(record.encryptedSecret);
      // originalUrl (not req.path) so the signed path is exactly what the
      // client called, e.g. "/api/v1/orders" — req.path inside a mounted
      // sub-router is rebased relative to the mount point and would be
      // just "/orders", which isn't what a client signing the real
      // request URL would expect.
      const path = req.originalUrl.split('?')[0];
      const message = `${timestamp}${req.method}${path}${JSON.stringify(req.body ?? {})}`;
      expectedSignature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    } catch {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const provided = Buffer.from(signature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.userId = record.userId;
    req.apiKeyId = record.id;
    req.apiKeyCanTrade = record.canTrade;
    next();
  };
}

/** Blocks a read-only API key from placing/cancelling orders. JWT-authenticated (browser) requests are always allowed. */
export function requireTradePermission(req: ApiAuthedRequest, res: Response, next: NextFunction) {
  if (!req.apiKeyId) return next();
  if (!req.apiKeyCanTrade) {
    return res.status(403).json({ error: 'This API key does not have trading permission' });
  }
  next();
}
