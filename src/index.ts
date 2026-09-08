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
import { FearGreedService } from './services/FearGreedService';
import { ArbitrageService } from './services/ArbitrageService';
import { arbitrageRouter } from './api/routes/arbitrage';
import { cfdRouter } from './api/routes/cfd';
import { referralRouter } from './api/routes/referral';
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
import { KycEmailService } from './services/KycEmailService';
import { recoverOrderBook } from './services/OrderBookRecovery';
import { KrakenMarketDataService } from './services/KrakenMarketDataService';
import { CfdMarketDataService } from './services/CfdMarketDataService';
import { CfdPositionService } from './cfd/CfdPositionService';
import { CfdLiquidationEngine } from './cfd/CfdLiquidationEngine';
import { recoverFuturesOrderBook } from './futures/FuturesOrderBookRecovery';
import { MarkPriceService } from './futures/MarkPriceService';
import { FuturesPositionService } from './futures/FuturesPositionService';
import { FundingRateService } from './futures/FundingRateService';
import { FuturesMarketRegistry } from './futures/FuturesMarketRegistry';
import { LiquidationEngine } from './futures/LiquidationEngine';
import { OrderService } from './services/OrderService';
import { PriceWatcherService } from './services/PriceWatcherService';
import { PRICE_WATCHER_CHECK_INTERVAL_MS } from './config/limits';
import { DemoTradingService } from './services/DemoTradingService';
import { demoTradingRouter } from './api/routes/demoTrading';
import { portfolioRouter } from './api/routes/portfolio';
import { WalletPortfolioService } from './services/WalletPortfolioService';
import { syntheticCopyTradingRouter } from './api/routes/syntheticCopyTrading';
import { copyPerformanceRouter } from './api/routes/copyPerformance';
import { analyticsRouter } from './api/routes/analytics';
import { AnalyticsDataService } from './services/AnalyticsDataService';
import { MarketDataGateway } from './services/marketData/MarketDataGateway';
import { BinanceDerivativesService } from './services/marketData/derivatives/BinanceDerivativesService';
import { OkxDerivativesService } from './services/marketData/derivatives/OkxDerivativesService';
import { ExternalDerivativesService } from './services/marketData/derivatives/ExternalDerivativesService';
import { DerivedAnalyticsService } from './services/analytics/DerivedAnalyticsService';
import { marketDataRouter } from './api/routes/marketData';

const app = express();
const prisma = new PrismaClient();
const engine = new MatchingEngine();
const marketDataService = new KrakenMarketDataService(process.env.KRAKEN_API_BASE_URL || 'https://api.kraken.com');
const coinGeckoService = new CoinGeckoService(
  process.env.COINGECKO_API_BASE_URL || 'https://api.coingecko.com/api/v3',
  fetch,
  process.env.COINGECKO_API_KEY
);
const fearGreedService = new FearGreedService(process.env.FEAR_GREED_API_BASE_URL || 'https://api.alternative.me');
const arbitrageService = new ArbitrageService(marketDataService);
const cfdDataService = new CfdMarketDataService(process.env.TWELVE_DATA_API_KEY);
const cfdPositionService = new CfdPositionService(prisma, cfdDataService);
// Wallet valuation + portfolio performance. Reads the ledger, never writes
// it; see WalletPortfolioService and AdminPortfolioProfile.
const walletPortfolioService = new WalletPortfolioService(prisma, marketDataService, cfdDataService);
const cfdLiquidationEngine = new CfdLiquidationEngine(prisma, cfdDataService);
const supportEmailService = new SupportEmailService();
const kycEmailService = new KycEmailService();

// Perpetual futures runs on its own matching engine and services,
// deliberately never sharing state with the spot engine above (see
// FuturesOrder/FuturesBalance's schema comments).
const futuresEngine = new MatchingEngine();
const markPriceService = new MarkPriceService(marketDataService);
const futuresPositionService = new FuturesPositionService(prisma, futuresEngine, markPriceService);
// Which contracts are listed is derived from live market data under the
// listing rules in config/futuresConfig — see FuturesMarketRegistry.
const futuresMarketRegistry = new FuturesMarketRegistry(marketDataService, prisma);
const fundingRateService = new FundingRateService(prisma, markPriceService, () => futuresMarketRegistry.list());
const liquidationEngine = new LiquidationEngine(prisma, markPriceService);

// Shares the spot engine/prisma/priceSource with ordersRouter's own
// OrderService instance — OrderService holds no in-process state beyond
// those injected deps, so a second instance here is safe.
const spotOrderService = new OrderService(prisma, engine, marketDataService);
const priceWatcherService = new PriceWatcherService(prisma, spotOrderService, marketDataService);

// Admin-only sandbox for testing order-book/liquidity behavior with fake
// funds — its own engine and its own DemoBalance/DemoOrder/DemoTrade
// tables, never sharing state with the spot or futures engines above (see
// DemoBalance's schema.prisma doc comment for why).
const demoEngine = new MatchingEngine();
const demoTradingService = new DemoTradingService(prisma, demoEngine);

// The unified reference-market façade. It orchestrates the provider
// services constructed above rather than replacing them — same Kraken
// service, same CoinGecko service, same caches, same circuits — and adds
// the canonical asset registry, provenance/freshness on every answer, and
// capability routing. It is deliberately given the CFD service too, so
// "which provider answers a CFD quote" is a routing decision in one place.
//
// It reads reference data only. Nothing here touches VOLTEX financial
// state: mark price, funding settlement, open interest, positions, margin
// and liquidation stay with the futures services and are unchanged.
const marketDataGateway = new MarketDataGateway(marketDataService, coinGeckoService, fearGreedService, cfdDataService);

// External derivatives reference data (Binance + OKX public futures
// endpoints). Public, unauthenticated, no key and no environment variable
// — see each adapter's doc comment for the exact endpoint families. Each
// venue gets its OWN circuit, registered under a name distinct from the
// arbitrage circuits, so one venue rate-limiting cannot blind the other.
//
// Nothing produced here may enter mark price, index price, margin,
// leverage, liquidation, funding settlement, PnL or matching. It is
// reference data about other venues and it reaches exactly one consumer:
// the read-only Analytics snapshot below.
const binanceDerivativesService = new BinanceDerivativesService(process.env.BINANCE_FUTURES_API_BASE_URL);
const okxDerivativesService = new OkxDerivativesService(process.env.OKX_API_BASE_URL);
const externalDerivativesService = new ExternalDerivativesService(binanceDerivativesService, okxDerivativesService);

// Realized volatility, correlations and sector performance, computed from
// series the gateway already caches. No new provider and no new sweep.
const derivedAnalyticsService = new DerivedAnalyticsService(marketDataGateway);

// Read-only analytics aggregation. Market-wide figures and sentiment come
// through the gateway above — the same cached reads /markets already
// makes, so opening Analytics costs no extra upstream requests — and this
// venue's own funding, open interest and mark/index prices come from the
// futures services. The external sections are clearly labelled by venue
// and are never mixed with VOLTEX's own book.
const analyticsDataService = new AnalyticsDataService(
  prisma,
  marketDataGateway,
  markPriceService,
  futuresMarketRegistry,
  externalDerivativesService,
  derivedAnalyticsService,
  coinGeckoService
);

// Deployed behind Caddy (see api.ts's docker-compose comment) — without this,
// req.ip is always the proxy's own address, which would both defeat the
// per-IP login rate limiter below (every user looks like the same caller)
// and make the account security log's IP column useless.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] }));
// A base64 profile photo does not fit in the app-wide limit below, and
// raising that limit would lift the ceiling on every other endpoint too.
// Mounted BEFORE the global parser on purpose: whichever runs first parses
// the body, and the later one then skips it — so this order is what makes
// the wider limit apply, and only on this path. The size the endpoint
// itself accepts is capped separately (AVATAR_MAX_BYTES in account.ts).
app.use('/api/v1/me/avatar', express.json({ limit: '1mb' }));
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
app.use('/api/v1', marketRouter(marketDataService, coinGeckoService, fearGreedService, prisma));
app.use('/api/v1', arbitrageRouter(arbitrageService));
app.use('/api/v1', cfdRouter(prisma, cfdDataService, cfdPositionService));
app.use('/api/v1', referralRouter(prisma));
app.use('/api/v1', accountRouter(prisma));
app.use('/api/v1', kycRouter(prisma, kycEmailService));
app.use('/api/v1', adminRouter(prisma));
app.use('/api/v1', adminUsersRouter(prisma, demoTradingService));
app.use('/api/v1', adminAuditLogRouter(prisma));
app.use('/api/v1', cardRouter(prisma, walletPortfolioService));
app.use('/api/v1', apiKeysRouter(prisma));
app.use('/api/v1', reservesRouter(prisma));
app.use('/api/v1', futuresRouter(prisma, futuresEngine, futuresPositionService, markPriceService, futuresMarketRegistry));
app.use('/api/v1', supportRouter(prisma, supportEmailService));
app.use('/api/v1', demoTradingRouter(prisma, demoTradingService));
app.use('/api/v1', portfolioRouter(prisma, walletPortfolioService));
app.use('/api/v1', syntheticCopyTradingRouter(prisma));
app.use('/api/v1', copyPerformanceRouter(prisma));
app.use('/api/v1', analyticsRouter(prisma, analyticsDataService));
// Additive: every pre-existing /market/* route above keeps its shape.
app.use('/api/v1', marketDataRouter(prisma, marketDataGateway));

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

  futuresMarketRegistry.start();
  fundingRateService.startScheduler();
  liquidationEngine.startScheduler();
  cfdLiquidationEngine.startScheduler();
  priceWatcherService.startScheduler(PRICE_WATCHER_CHECK_INTERVAL_MS);

  app.listen(PORT, () => console.log(`Exchange API listening on :${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  futuresMarketRegistry.stop();
  fundingRateService.stopScheduler();
  liquidationEngine.stopScheduler();
  cfdLiquidationEngine.stopScheduler();
  priceWatcherService.stopScheduler();
  await prisma.$disconnect();
  process.exit(0);
});
