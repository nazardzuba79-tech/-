import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { MatchingEngine } from './matching-engine/MatchingEngine';
import { ordersRouter } from './api/routes/orders';
import { tradesRouter } from './api/routes/trades';
import { depositsRouter } from './api/routes/deposits';
import { adminDepositsRouter } from './api/routes/adminDeposits';
import { adminWalletsRouter } from './api/routes/adminWallets';
import { withdrawalsRouter } from './api/routes/withdrawals';
import { adminWithdrawalsRouter } from './api/routes/adminWithdrawals';
import { authRouter } from './api/routes/auth';
import { candlesRouter } from './api/routes/candles';
import { productsRouter } from './api/routes/products';
import { balancesRouter } from './api/routes/balances';
import { marketRouter } from './api/routes/market';
import { CoinGeckoService } from './services/CoinGeckoService';
import { accountRouter } from './api/routes/account';
import { kycRouter } from './api/routes/kyc';
import { adminRouter } from './api/routes/admin';
import { adminUsersRouter } from './api/routes/adminUsers';
import { adminAuditLogRouter } from './api/routes/adminAuditLog';
import { cardRouter } from './api/routes/card';
import { apiKeysRouter } from './api/routes/apiKeys';
import { reservesRouter } from './api/routes/reserves';
import { futuresRouter } from './api/routes/futures';
import { supportRouter } from './api/routes/support';
import { SupportEmailService } from './services/SupportEmailService';
import { recoverOrderBook } from './services/OrderBookRecovery';
import { KrakenMarketDataService } from './services/KrakenMarketDataService';
import { recoverFuturesOrderBook } from './futures/FuturesOrderBookRecovery';
import { MarkPriceService } from './futures/MarkPriceService';
import { FuturesPositionService } from './futures/FuturesPositionService';
import { FundingRateService } from './futures/FundingRateService';
import { LiquidationEngine } from './futures/LiquidationEngine';
import { OrderService } from './services/OrderService';
import { PriceWatcherService } from './services/PriceWatcherService';
import { PRICE_WATCHER_CHECK_INTERVAL_MS } from './config/limits';

const app = express();
const prisma = new PrismaClient();
const engine = new MatchingEngine();
const marketDataService = new KrakenMarketDataService(process.env.KRAKEN_API_BASE_URL || 'https://api.kraken.com');
const coinGeckoService = new CoinGeckoService(process.env.COINGECKO_API_BASE_URL || 'https://api.coingecko.com/api/v3');
const supportEmailService = new SupportEmailService();

// Perpetual futures runs on its own matching engine and services,
// deliberately never sharing state with the spot engine above (see
// FuturesOrder/FuturesBalance's schema comments).
const futuresEngine = new MatchingEngine();
const markPriceService = new MarkPriceService(marketDataService);
const futuresPositionService = new FuturesPositionService(prisma, futuresEngine, markPriceService);
const fundingRateService = new FundingRateService(prisma, markPriceService);
const liquidationEngine = new LiquidationEngine(prisma, markPriceService);

// Shares the spot engine/prisma/priceSource with ordersRouter's own
// OrderService instance — OrderService holds no in-process state beyond
// those injected deps, so a second instance here is safe.
const spotOrderService = new OrderService(prisma, engine, marketDataService);
const priceWatcherService = new PriceWatcherService(prisma, spotOrderService, marketDataService);

// Deployed behind Caddy (see api.ts's docker-compose comment) — without this,
// req.ip is always the proxy's own address, which would both defeat the
// per-IP login rate limiter below (every user looks like the same caller)
// and make the account security log's IP column useless.
app.set('trust proxy', 1);

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
app.use('/api/v1', ordersRouter(prisma, engine, marketDataService));
app.use('/api/v1', tradesRouter(prisma));
app.use('/api/v1', depositsRouter(prisma, marketDataService));
app.use('/api/v1', adminDepositsRouter(prisma, marketDataService));
app.use('/api/v1', adminWalletsRouter(prisma));
app.use('/api/v1', withdrawalsRouter(prisma));
app.use('/api/v1', adminWithdrawalsRouter(prisma));
app.use('/api/v1', authRouter(prisma));
app.use('/api/v1', candlesRouter(prisma));
app.use('/api/v1', productsRouter(prisma));
app.use('/api/v1', balancesRouter(prisma));
app.use('/api/v1', marketRouter(marketDataService, coinGeckoService));
app.use('/api/v1', accountRouter(prisma));
app.use('/api/v1', kycRouter(prisma));
app.use('/api/v1', adminRouter(prisma));
app.use('/api/v1', adminUsersRouter(prisma));
app.use('/api/v1', adminAuditLogRouter(prisma));
app.use('/api/v1', cardRouter(prisma));
app.use('/api/v1', apiKeysRouter(prisma));
app.use('/api/v1', reservesRouter(prisma));
app.use('/api/v1', futuresRouter(prisma, futuresEngine, futuresPositionService, markPriceService));
app.use('/api/v1', supportRouter(prisma, supportEmailService));

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
  const recoveredFuturesCount = await recoverFuturesOrderBook(prisma, futuresEngine);
  if (recoveredFuturesCount > 0) {
    console.log(`Recovered ${recoveredFuturesCount} resting futures order(s) into the futures matching engine`);
  }

  fundingRateService.startScheduler();
  liquidationEngine.startScheduler();
  priceWatcherService.startScheduler(PRICE_WATCHER_CHECK_INTERVAL_MS);

  app.listen(PORT, () => console.log(`Exchange API listening on :${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  fundingRateService.stopScheduler();
  liquidationEngine.stopScheduler();
  priceWatcherService.stopScheduler();
  await prisma.$disconnect();
  process.exit(0);
});
