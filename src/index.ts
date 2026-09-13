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
import { TraderMadeStreamQuoteSource } from './services/marketData/cfd/TraderMadeStreamQuoteSource';
import { DerivPublicStreamQuoteSource } from './services/marketData/cfd/DerivPublicStreamQuoteSource';
import { BiquoteCfdQuoteSource } from './services/marketData/cfd/BiquoteCfdQuoteSource';
import { CfdDisplayQuoteRouter } from './services/marketData/cfd/CfdDisplayQuoteRouter';
import { ResilientCfdQuoteSource } from './services/marketData/cfd/ResilientCfdQuoteSource';
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
import { marketDataRouter } from './api/routes/marketData';
import { marketOptionsRouter } from './api/routes/marketOptions';

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

const parseCfdSymbols = (value: string | undefined) => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cfdMaxQuoteAgeMs = Number(process.env.CFD_MAX_QUOTE_AGE_MS ?? 5000);
const twelveEntitled = parseCfdSymbols(process.env.TWELVE_DATA_VERIFIED_LIVE_SYMBOLS ?? process.env.CFD_VERIFIED_LIVE_SYMBOLS);
const twelveExecution = parseCfdSymbols(process.env.TWELVE_DATA_EXECUTION_SYMBOLS ?? process.env.CFD_EXECUTION_SYMBOLS);
const cfdDataService = new CfdMarketDataService(process.env.TWELVE_DATA_API_KEY, undefined, undefined, {}, {
  maxQuoteAgeMs: cfdMaxQuoteAgeMs,
  entitledSymbols: twelveEntitled,
  executionSymbols: twelveExecution,
  creditsPerMinute: Number(process.env.CFD_CREDITS_PER_MINUTE ?? 8),
  creditsPerDay: Number(process.env.CFD_CREDITS_PER_DAY ?? 800),
});

// Financial execution remains separately admitted. Public/no-key feeds may
// keep the UI priced, but cannot become open/close/PnL/liquidation inputs.
const cfdMultiProviderExecutionEnabled = process.env.CFD_MULTI_PROVIDER_EXECUTION_ENABLED === 'true';
const cfdFreeDisplayEnabled = process.env.CFD_FREE_DISPLAY_ENABLED !== 'false';
const traderMadeCfdDataService = new TraderMadeStreamQuoteSource(process.env.TRADERMADE_STREAM_API_KEY, {
  maxQuoteAgeMs: cfdMaxQuoteAgeMs,
  entitledSymbols: parseCfdSymbols(process.env.TRADERMADE_VERIFIED_LIVE_SYMBOLS),
  executionSymbols: parseCfdSymbols(process.env.TRADERMADE_EXECUTION_SYMBOLS),
  financialUseEvidence: process.env.TRADERMADE_FINANCIAL_USE_EVIDENCE,
});
const derivShadowEnabled = process.env.DERIV_CFD_SHADOW_ENABLED !== 'false';
const derivCfdDataService = new DerivPublicStreamQuoteSource({
  maxQuoteAgeMs: cfdMaxQuoteAgeMs,
  shadow: derivShadowEnabled || cfdFreeDisplayEnabled,
  entitledSymbols: parseCfdSymbols(process.env.DERIV_CFD_VERIFIED_LIVE_SYMBOLS),
  executionSymbols: parseCfdSymbols(process.env.DERIV_CFD_EXECUTION_SYMBOLS),
  financialUseEvidence: process.env.DERIV_CFD_FINANCIAL_USE_EVIDENCE,
});
const biquoteCfdDisplayService = new BiquoteCfdQuoteSource({
  maxQuoteAgeMs: cfdMaxQuoteAgeMs,
  cacheMs: Number(process.env.BIQUOTE_CFD_CACHE_MS ?? 1000),
});
const cfdDisplaySource = cfdFreeDisplayEnabled ? new CfdDisplayQuoteRouter([
  { id:'biquote', priority:10, source:biquoteCfdDisplayService },
  { id:'deriv', priority:20, source:derivCfdDataService },
], {
  providerWaitMs:Number(process.env.CFD_DISPLAY_PROVIDER_WAIT_MS ?? 1300),
  freshAgeMs:Number(process.env.CFD_DISPLAY_FRESH_AGE_MS ?? 120000),
}) : undefined;

const resilientCfdDataService = new ResilientCfdQuoteSource([
  {
    id: 'twelvedata', source: cfdDataService, priority: 10,
    lineage: process.env.TWELVE_DATA_LINEAGE_ID?.trim() || 'unknown', enabled: cfdMultiProviderExecutionEnabled,
    admissionEvidence: process.env.TWELVE_DATA_FINANCIAL_USE_EVIDENCE ?? '',
  },
  {
    id: 'tradermade', source: traderMadeCfdDataService, priority: 20,
    lineage: process.env.TRADERMADE_LINEAGE_ID?.trim() || 'unknown', enabled: cfdMultiProviderExecutionEnabled,
    admissionEvidence: process.env.TRADERMADE_FINANCIAL_USE_EVIDENCE ?? '',
  },
  {
    id: 'deriv', source: derivCfdDataService, priority: 30,
    lineage: process.env.DERIV_CFD_LINEAGE_ID?.trim() || 'unknown', enabled: cfdMultiProviderExecutionEnabled,
    admissionEvidence: process.env.DERIV_CFD_FINANCIAL_USE_EVIDENCE ?? '',
  },
], {
  maxQuoteAgeMs: cfdMaxQuoteAgeMs,
  providerWaitMs: Number(process.env.CFD_PROVIDER_WAIT_MS ?? 1200),
  maxDivergenceBps: Number(process.env.CFD_PROVIDER_MAX_DIVERGENCE_BPS ?? 100),
  comparableWindowMs: Number(process.env.CFD_PROVIDER_COMPARABLE_WINDOW_MS ?? 5000),
  failbackSamples: Number(process.env.CFD_PROVIDER_FAILBACK_SAMPLES ?? 3),
  failbackHoldMs: Number(process.env.CFD_PROVIDER_FAILBACK_HOLD_MS ?? 30000),
  minExecutionLineages: Number(process.env.CFD_MIN_EXECUTION_LINEAGES ?? 2),
});
const cfdRiskSource = cfdMultiProviderExecutionEnabled ? resilientCfdDataService : cfdDataService;
const cfdPositionService = new CfdPositionService(prisma, cfdRiskSource);
// Wallet valuation + portfolio performance. Reads the ledger, never writes
// it; execution/risk uses the stricter cfdRiskSource defined above.
const walletPortfolioService = new WalletPortfolioService(prisma, marketDataService, cfdDataService);
const cfdLiquidationEngine = new CfdLiquidationEngine(prisma, cfdRiskSource);
const supportEmailService = new SupportEmailService();
const kycEmailService = new KycEmailService();

const futuresEngine = new MatchingEngine();
const markPriceService = new MarkPriceService(marketDataService);
const futuresPositionService = new FuturesPositionService(prisma, futuresEngine, markPriceService);
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

const spotOrderService = new OrderService(prisma, engine, marketDataService);
const priceWatcherService = new PriceWatcherService(prisma, spotOrderService, marketDataService);
const demoEngine = new MatchingEngine();
const demoTradingService = new DemoTradingService(prisma, demoEngine);

const marketDataGateway = new MarketDataGateway(marketDataService, coinGeckoService, fearGreedService, cfdDataService, undefined, liveReferenceCollector?.feed ?? null);
const binanceDerivativesService = new BinanceDerivativesService(process.env.BINANCE_FUTURES_API_BASE_URL);
const okxDerivativesService = new OkxDerivativesService(process.env.OKX_API_BASE_URL);
const externalDerivativesService = new ExternalDerivativesService(binanceDerivativesService, okxDerivativesService);
const derivedAnalyticsService = new DerivedAnalyticsService(marketDataGateway);
const analyticsDataService = new AnalyticsDataService(
  prisma,
  marketDataGateway,
  markPriceService,
  futuresMarketRegistry,
  externalDerivativesService,
  derivedAnalyticsService,
  coinGeckoService
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
app.use('/api/v1', cfdRouter(prisma, cfdDataService, cfdPositionService, undefined, cfdRiskSource,
  () => ({ deriv:derivCfdDataService.diagnostics(), biquote:biquoteCfdDisplayService.diagnostics() }), cfdDisplaySource));
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
app.use('/api/v1', supportRouter(prisma, supportEmailService));
app.use('/api/v1', demoTradingRouter(prisma, demoTradingService));
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
  if (recoveredCount > 0) console.log(`Recovered ${recoveredCount} resting order(s) into the matching engine`);
  const recoveredFuturesCount = await recoverFuturesOrderBook(prisma, futuresEngine);
  if (recoveredFuturesCount > 0) console.log(`Recovered ${recoveredFuturesCount} resting futures order(s) into the futures matching engine`);

  if (cfdMultiProviderExecutionEnabled) traderMadeCfdDataService.start();
  if (cfdFreeDisplayEnabled || derivShadowEnabled || (cfdMultiProviderExecutionEnabled && derivCfdDataService.isConfigured())) derivCfdDataService.start();
  futuresMarketRegistry.start();
  fundingRateService.startScheduler();
  liquidationEngine.startScheduler();
  futuresProtectionService.startScheduler();
  cfdLiquidationEngine.startScheduler();
  priceWatcherService.startScheduler(PRICE_WATCHER_CHECK_INTERVAL_MS);

  app.listen(PORT, () => console.log(`Exchange API listening on :${PORT}`));
  liveReferenceCollector?.start();
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  traderMadeCfdDataService.stop();
  derivCfdDataService.stop();
  liveReferenceCollector?.stop();
  marketUniverse.stop();
  futuresMarketRegistry.stop();
  fundingRateService.stopScheduler();
  liquidationEngine.stopScheduler();
  futuresProtectionService.stopScheduler();
  cfdLiquidationEngine.stopScheduler();
  priceWatcherService.stopScheduler();
  await prisma.$disconnect();
  process.exit(0);
});
