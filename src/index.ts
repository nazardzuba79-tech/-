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
import { SupportNotificationOutbox } from './services/SupportNotificationOutbox';
import { adminSupportRouter } from './api/routes/adminSupport';
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
import { BybitMarketDataService } from './services/marketData/bybit/BybitMarketDataService';
import { MarketUniverse } from './services/marketData/bybit/MarketUniverse';
import { LiquidationEngine } from './futures/LiquidationEngine';
import { FuturesProtectionService } from './futures/FuturesProtectionService';
import { OrderService } from './services/OrderService';
import { PriceWatcherService } from './services/PriceWatcherService';
import { PRICE_WATCHER_CHECK_INTERVAL_MS } from './config/limits';
import { DemoTradingService } from './services/DemoTradingService';
import { demoTradingRouter } from './api/routes/demoTrading';
import { privateTradingRouter } from './api/routes/privateTrading';
import { createNativeLimitPass } from './private-trading/native/limitPass';
import { PrivateTradingService } from './private-trading/service';
import { PrivateTradingStore } from './private-trading/store';
import { PrivateTradingMarketData } from './private-trading/marketData';
import { portfolioRouter } from './api/routes/portfolio';
import { WalletPortfolioService } from './services/WalletPortfolioService';
import { syntheticCopyTradingRouter } from './api/routes/syntheticCopyTrading';
import { copyPerformanceRouter } from './api/routes/copyPerformance';
import { analyticsRouter } from './api/routes/analytics';
import { AnalyticsDataService } from './services/AnalyticsDataService';
import { MarketDataGateway } from './services/marketData/MarketDataGateway';
import { collectorFromEnv, CollectorUniverseProvider } from './services/marketData/live/MarketDataCollectorClient';
import { BinanceDerivativesService } from './services/marketData/derivatives/BinanceDerivativesService';
import { OkxDerivativesService } from './services/marketData/derivatives/OkxDerivativesService';
import { ExternalDerivativesService } from './services/marketData/derivatives/ExternalDerivativesService';
import { DerivedAnalyticsService } from './services/analytics/DerivedAnalyticsService';
import { DeribitAnalyticsService } from './services/analytics/DeribitAnalyticsService';
import { LiquidationStreamService } from './services/analytics/LiquidationStreamService';
import { HistoricalOpenInterestService } from './services/analytics/HistoricalOpenInterestService';
import { CoinGlassAnalyticsService } from './services/analytics/CoinGlassAnalyticsService';
import { marketDataRouter } from './api/routes/marketData';
import { displaySnapshotsRouter } from './api/routes/displaySnapshots';
import { testMarketsRouter } from './api/routes/testMarkets';
import { marketOptionsRouter } from './api/routes/marketOptions';
import { resolveBuildCommit } from './buildCommit';

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
const cfdDataService = new CfdMarketDataService(process.env.TWELVE_DATA_API_KEY, undefined, undefined, {}, {
  maxQuoteAgeMs: Number(process.env.CFD_MAX_QUOTE_AGE_MS ?? 5000),
  entitledSymbols: (process.env.CFD_VERIFIED_LIVE_SYMBOLS ?? '').split(',').map(s=>s.trim()).filter(Boolean),
  executionSymbols: (process.env.CFD_EXECUTION_SYMBOLS ?? '').split(',').map(s=>s.trim()).filter(Boolean),
  creditsPerMinute: Number(process.env.CFD_CREDITS_PER_MINUTE ?? 8),
  creditsPerDay: Number(process.env.CFD_CREDITS_PER_DAY ?? 800),
});
// The wake callbacks below are deliberately late-bound closures: each
// engine is constructed further down, and the callback only ever runs at
// request time, long after this module has finished evaluating. They carry
// no correctness weight — every sweep still finds its work within
// IDLE_SWEEP_MAX_MS — they just spare the first trade after a quiet spell
// from waiting out a backed-off tick.
const cfdPositionService = new CfdPositionService(prisma, cfdDataService, () => cfdLiquidationEngine.wake());
const walletPortfolioService = new WalletPortfolioService(prisma, marketDataService, cfdDataService);
const cfdLiquidationEngine = new CfdLiquidationEngine(prisma, cfdDataService);
const supportEmailService = new SupportEmailService();
// Durable delivery of support emails (Postgres outbox, no extra service).
const supportNotificationOutbox = new SupportNotificationOutbox(prisma, supportEmailService);
const kycEmailService = new KycEmailService();

const futuresEngine = new MatchingEngine();
const markPriceService = new MarkPriceService(marketDataService);
const futuresPositionService = new FuturesPositionService(prisma, futuresEngine, markPriceService, () => liquidationEngine.wake());

const liveReferenceCollector = collectorFromEnv();
const venueUniverseSource = liveReferenceCollector
  ? new CollectorUniverseProvider(liveReferenceCollector)
  : new BybitMarketDataService();
const marketUniverse = new MarketUniverse(venueUniverseSource, { includeInverse: true });
marketUniverse.start();

const futuresMarketRegistry = new FuturesMarketRegistry(marketDataService, prisma, marketUniverse);
const fundingRateService = new FundingRateService(prisma, markPriceService, () => futuresMarketRegistry.list());
const liquidationEngine = new LiquidationEngine(prisma, markPriceService);
const futuresProtectionService = new FuturesProtectionService(prisma, futuresPositionService, markPriceService);

const spotOrderService = new OrderService(prisma, engine, marketDataService, () => priceWatcherService.wake());
const priceWatcherService = new PriceWatcherService(prisma, spotOrderService, marketDataService);

const demoEngine = new MatchingEngine();
const demoTradingService = new DemoTradingService(prisma, demoEngine);
const privateTradingService = new PrivateTradingService(new PrivateTradingStore(prisma),
  process.env.MARKET_DATA_COLLECTOR_URL && process.env.MARKET_DATA_COLLECTOR_TOKEN
    ? new PrivateTradingMarketData({ collector: { url: process.env.MARKET_DATA_COLLECTOR_URL, token: process.env.MARKET_DATA_COLLECTOR_TOKEN } })
    : null);
const nativeLimitPass=privateTradingService.market?createNativeLimitPass(prisma,privateTradingService.market):null;

const marketDataGateway = new MarketDataGateway(
  marketDataService,
  coinGeckoService,
  fearGreedService,
  cfdDataService,
  undefined,
  liveReferenceCollector?.feed ?? null
);

const binanceDerivativesService = new BinanceDerivativesService(process.env.BINANCE_FUTURES_API_BASE_URL);
const okxDerivativesService = new OkxDerivativesService(process.env.OKX_API_BASE_URL);
const externalDerivativesService = new ExternalDerivativesService(binanceDerivativesService, okxDerivativesService);
const derivedAnalyticsService = new DerivedAnalyticsService(marketDataGateway);

// Read-only analytics feeds. None of these values can enter matching,
// balances, margin, liquidation or funding settlement.
const deribitAnalyticsService = new DeribitAnalyticsService(
  process.env.DERIBIT_API_BASE_URL || 'https://www.deribit.com/api/v2'
);
const liquidationStreamService = new LiquidationStreamService(
  process.env.BINANCE_LIQUIDATION_WS_URL || 'wss://fstream.binance.com/market/ws/!forceOrder@arr'
);
const historicalOpenInterestService = new HistoricalOpenInterestService(
  process.env.BINANCE_FUTURES_API_BASE_URL || 'https://fapi.binance.com'
);
const coinGlassApiKey = process.env.COINGLASS_API_KEY?.trim();
const licensedAnalyticsService = coinGlassApiKey
  ? new CoinGlassAnalyticsService(
      coinGlassApiKey,
      process.env.COINGLASS_API_BASE_URL || 'https://open-api-v4.coinglass.com'
    )
  : null;

const analyticsDataService = new AnalyticsDataService(
  prisma,
  marketDataGateway,
  markPriceService,
  futuresMarketRegistry,
  externalDerivativesService,
  derivedAnalyticsService,
  coinGeckoService,
  deribitAnalyticsService,
  liquidationStreamService,
  historicalOpenInterestService,
  licensedAnalyticsService
);

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] }));
app.use('/api/v1/me/avatar', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/**
 * Liveness, AND which build is answering.
 *
 * `status` is unchanged for anything already polling this. `commit` is the
 * only way to tell whether the API is running the code you think it is: the
 * frontend and the backend deploy independently, so a fresh Cloudflare Pages
 * build says nothing about which revision Render is serving. Render sets
 * RENDER_GIT_COMMIT itself; the other names cover other hosts and local runs.
 * `null` means the platform did not tell us — not "old", and not a guess.
 */
const BUILD_COMMIT = resolveBuildCommit(process.env);
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  commit: BUILD_COMMIT,
  branch: process.env.RENDER_GIT_BRANCH ?? null,
  startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
}));
// Test markets first: they answer the shared Spot endpoints for test pairs
// only (simulated, never tradable) and pass every other pair through.
app.use('/api/v1', testMarketsRouter());
app.use('/api/v1', displaySnapshotsRouter(liveReferenceCollector?.feed ?? null, marketDataService, marketUniverse));
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
app.use('/api/v1', futuresRouter(prisma, futuresEngine, futuresPositionService, markPriceService, futuresMarketRegistry, futuresProtectionService));
app.use('/api/v1', supportRouter(prisma, supportNotificationOutbox));
app.use('/api/v1', adminSupportRouter(prisma, supportEmailService, supportNotificationOutbox));
app.use('/api/v1', demoTradingRouter(prisma, demoTradingService));
app.use('/api/v1', privateTradingRouter(prisma, privateTradingService));
app.use('/api/v1', portfolioRouter(prisma, walletPortfolioService));
app.use('/api/v1', syntheticCopyTradingRouter(prisma));
app.use('/api/v1', copyPerformanceRouter(prisma));
app.use('/api/v1', analyticsRouter(prisma, analyticsDataService));
app.use('/api/v1', marketDataRouter(prisma, marketDataGateway, externalDerivativesService, marketUniverse));
app.use('/api/v1', marketOptionsRouter(liveReferenceCollector));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3000;

async function start() {
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
  futuresProtectionService.startScheduler();
  cfdLiquidationEngine.startScheduler();
  priceWatcherService.startScheduler(PRICE_WATCHER_CHECK_INTERVAL_MS);
  privateTradingService.start();
  nativeLimitPass?.start();
  liquidationStreamService.start();

  app.listen(PORT, () => console.log(`Exchange API listening on :${PORT}`));
  // Catch up on support emails a previous process left pending (e.g. one
  // stopped right after answering). Reads nothing when mail is unconfigured.
  supportNotificationOutbox.start();
  liveReferenceCollector?.start();
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  liquidationStreamService.stop();
  liveReferenceCollector?.stop();
  marketUniverse.stop();
  futuresMarketRegistry.stop();
  fundingRateService.stopScheduler();
  liquidationEngine.stopScheduler();
  futuresProtectionService.stopScheduler();
  cfdLiquidationEngine.stopScheduler();
  priceWatcherService.stopScheduler();
  privateTradingService.stop();
  await nativeLimitPass?.stop();
  await prisma.$disconnect();
  process.exit(0);
});
