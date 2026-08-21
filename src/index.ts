import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { MatchingEngine } from './matching-engine/MatchingEngine';
import { ordersRouter } from './api/routes/orders';
import { depositsRouter } from './api/routes/deposits';
import { authRouter } from './api/routes/auth';
import { candlesRouter } from './api/routes/candles';
import { productsRouter } from './api/routes/products';
import { balancesRouter } from './api/routes/balances';
import { marketRouter } from './api/routes/market';
import { accountRouter } from './api/routes/account';
import { kycRouter } from './api/routes/kyc';
import { adminRouter } from './api/routes/admin';
import { recoverOrderBook } from './services/OrderBookRecovery';
import { BybitMarketDataService } from './services/BybitMarketDataService';

const app = express();
const prisma = new PrismaClient();
const engine = new MatchingEngine();
const marketDataService = new BybitMarketDataService(process.env.BYBIT_API_BASE_URL || 'https://api.bybit.com');

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] }));
app.use(express.json({ limit: '100kb' }));

// Global rate limit; tighten further per-route (esp. auth, withdrawals) in production.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1', ordersRouter(prisma, engine));
app.use('/api/v1', depositsRouter(prisma));
app.use('/api/v1', authRouter(prisma));
app.use('/api/v1', candlesRouter(prisma));
app.use('/api/v1', productsRouter(prisma));
app.use('/api/v1', balancesRouter(prisma));
app.use('/api/v1', marketRouter(marketDataService));
app.use('/api/v1', accountRouter(prisma));
app.use('/api/v1', kycRouter(prisma));
app.use('/api/v1', adminRouter(prisma));

// Centralized error handler — never leak stack traces to clients.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3000;

async function start() {
  // MUST run before app.listen — otherwise a request could place/match an
  // order against an incomplete book while old orders are still loading.
  const recoveredCount = await recoverOrderBook(prisma, engine);
  if (recoveredCount > 0) {
    console.log(`Recovered ${recoveredCount} resting order(s) into the matching engine`);
  }

  app.listen(PORT, () => console.log(`Exchange API listening on :${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
