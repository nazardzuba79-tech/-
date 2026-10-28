import type { Express, Request, RequestHandler } from 'express';
import { createServer, IncomingMessage, Server } from 'http';
import { timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';

export interface StocksAuthorityIngressConfig {
  port?: number;
  gatewayKey?: string;
  requestsPerMinute?: number;
}
const PREFIX = '/api/v1/stocks-test-cash/';
const METHODS = new Map([['identity', 'GET'], ['identities', 'POST'], ['readiness', 'GET'], ['command', 'POST']]);
const loopback = (address?: string) => address === '127.0.0.1' || address === '::ffff:127.0.0.1';

// Explicit opt-in, no implicit public/forwarded-IP trust or automatic migration
// of a running deployment. Invalid configuration stops startup.
export function stocksAuthorityIngressConfig(env = process.env): StocksAuthorityIngressConfig {
  if (env.STOCKS_AUTHORITY_INTERNAL_PORT === undefined) {
    if (env.STOCKS_AUTHORITY_REQUESTS_PER_MINUTE !== undefined) throw Error('STOCKS_INGRESS_CONFIG_INVALID');
    return {};
  }
  const raw = env.STOCKS_AUTHORITY_INTERNAL_PORT, port = Number(raw);
  if (!/^\d{4,5}$/.test(raw) || port < 1024 || port > 65535 || port === Number(env.PORT ?? 3000))
    throw Error('STOCKS_INGRESS_CONFIG_INVALID');
  const rawLimit = env.STOCKS_AUTHORITY_REQUESTS_PER_MINUTE ?? '240';
  if (!/^\d{3}$/.test(rawLimit)) throw Error('STOCKS_INGRESS_CONFIG_INVALID');
  if (env.STOCKS_CATALOGUE_ENABLED !== 'true' && env.STOCKS_TEST_CASH_ENABLED !== 'true')
    throw Error('STOCKS_INGRESS_CONFIG_INVALID');
  return { port, gatewayKey: env.STOCKS_TEST_CASH_GATEWAY_KEY, requestsPerMinute: Number(rawLimit) };
}

export function createStocksAuthorityIngress(
  config: StocksAuthorityIngressConfig,
  skipPublic: (req: Request) => boolean = () => false,
) {
  const enabled = config.port !== undefined;
  const limit = config.requestsPerMinute ?? 240;
  const key = Buffer.from(config.gatewayKey ?? '');
  if (enabled && (!Number.isInteger(config.port) || config.port! < 0 || config.port! > 65535 ||
    key.length < 32 || key.length > 256 || !Number.isInteger(limit) || limit < 120 || limit > 240))
    throw Error('STOCKS_INGRESS_CONFIG_INVALID');
  // Transport provenance only, NEVER a user authorization decision. A request
  // received on the public listener cannot add itself to this private WeakSet.
  const privateRequests = new WeakSet<IncomingMessage>();
  let server: Server | undefined;
  const publicLimit = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: skipPublic,
  });
  const privateLimit = rateLimit({
    windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: () => 'stocks-authority-service',
    handler: (_req, res) => res.status(429).json({ error: 'AUTH_RATE_LIMIT' }),
  });
  // Invalid private attempts have a separate bounded denial budget. Header
  // spoofing cannot rotate that budget or consume the valid service allowance.
  const rejectedLimit = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: () => 'stocks-authority-denied',
  });
  function trusted(req: Request): boolean {
    const method = METHODS.get(req.originalUrl.slice(PREFIX.length));
    if (!req.originalUrl.startsWith(PREFIX) || method !== req.method) return false;
    const socket = req.socket, address = server?.address();
    if (!address || typeof address === 'string' || !loopback(socket.remoteAddress) ||
      !loopback(socket.localAddress) || socket.localPort !== address.port ||
      req.headers.host !== `127.0.0.1:${address.port}`) return false;
    if (Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-') ||
      h === 'x-real-ip' || h.startsWith('cf-') || h === 'true-client-ip')) return false;
    // Reject duplicates instead of relying on Node's header coalescing.
    const occurrences = req.rawHeaders.filter((_, i) => i % 2 === 0)
      .filter(h => h.toLowerCase() === 'x-stocks-authority-key').length;
    const supplied = req.headers['x-stocks-authority-key'];
    if (occurrences !== 1 || typeof supplied !== 'string') return false;
    const candidate = Buffer.from(supplied);
    return candidate.length === key.length && timingSafeEqual(candidate, key);
  }
  const middleware: RequestHandler = (req, res, next) => {
    if (privateRequests.has(req)) {
      if (!trusted(req)) return rejectedLimit(req, res, () => { res.status(403).json({ error: 'AUTH_REQUIRED' }); });
      // Downstream JWT, live Session, actor binding and PG commit checks are
      // unchanged. This only chooses an independent finite transport quota.
      return privateLimit(req, res, next);
    }
    return publicLimit(req, res, () => {
      // When the private listener is explicitly enabled, authority-only paths
      // are not accessible through a public proxy even with a copied capability.
      if (enabled && /^\/api\/v1\/stocks-test-cash\/(?:identity|identities|command|readiness)\/?$/i.test(req.path))
        return void res.status(403).json({ error: 'AUTH_REQUIRED' });
      next();
    });
  };
  return {
    middleware,
    async listen(app: Express): Promise<Server | undefined> {
      if (!enabled) return undefined;
      if (server) throw Error('STOCKS_INGRESS_ALREADY_STARTED');
      server = createServer((req, res) => { privateRequests.add(req); app(req, res); });
      const current = server;
      current.requestTimeout = 15000;
      current.headersTimeout = 10000;
      current.keepAliveTimeout = 5000;
      current.maxConnections = 128;
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        current.once('error', fail);
        current.listen(config.port!, '127.0.0.1', () => { current.removeListener('error', fail); resolve(); });
      });
      return current;
    },
  };
}
