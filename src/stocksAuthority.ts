/**
 * Dedicated Stocks authority process (`node dist/stocksAuthority.js`).
 *
 * The same `stocksTestCashRouter` the API can mount, in its own Node process, so
 * Stocks viewer/trader authority traffic never shares the crypto API's event
 * loop. Nothing is relaxed: every request keeps the JWT, live Session,
 * revocation, contact-block and actor binding checks, the PostgreSQL authority
 * with its row locks and atomic commands, and the private ingress (loopback-only
 * listener, capability header, finite transport quota). There is no public
 * listener. The crypto API then runs with every Stocks variable unset, which
 * mounts no Stocks route there. See docs/STOCKS_613_PROCESS_ISOLATION.md.
 */
import express, { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { stocksTestCashRouter } from './api/routes/stocksTestCash';
import { createStocksAuthorityIngress, stocksAuthorityIngressConfig } from './api/middleware/stocksAuthorityIngress';

type RouterConfig = Parameters<typeof stocksTestCashRouter>[1];
type Authority = Parameters<typeof stocksTestCashRouter>[2];

// Same middleware order as the API: helmet, JSON body limit, ingress, router. `authority` is for unit tests
// only; without it the router opens the PostgreSQL authority exactly as in the API.
export function createStocksAuthorityApp(prisma: PrismaClient, options: { router?: RouterConfig; authority?: Authority; ingress?: RequestHandler } = {}): Express {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  if (options.ingress) app.use(options.ingress);
  app.use('/api/v1', stocksTestCashRouter(prisma, options.router, options.authority));
  app.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  return app;
}

// Configuration is the API's own environment contract (the router and requireAuth read process.env).
export async function startStocksAuthority(deps: { prisma?: PrismaClient; authority?: Authority } = {}) {
  // Without the private loopback port this process would have no listener at all.
  const config = stocksAuthorityIngressConfig(process.env);
  if (config.port === undefined) throw Error('STOCKS_AUTHORITY_PROCESS_CONFIG_INVALID');
  const ingress = createStocksAuthorityIngress(config);
  const prisma = deps.prisma ?? new PrismaClient();
  try {
    const app = createStocksAuthorityApp(prisma, { authority: deps.authority, ingress: ingress.middleware });
    const server = (await ingress.listen(app))!;
    return {
      port: config.port,
      async close() {
        await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
        if (!deps.prisma) await prisma.$disconnect();
      },
    };
  } catch (error) {
    if (!deps.prisma) await prisma.$disconnect();
    throw error;
  }
}

if (require.main === module) {
  startStocksAuthority().then(service => {
    console.log('STOCKS_AUTHORITY_LISTENING ' + service.port);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await service.close(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch(error => {
    // Never print configuration, URLs, keys or database errors.
    console.error(/^STOCKS_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'STOCKS_AUTHORITY_START_FAILED');
    process.exitCode = 1;
  });
}
