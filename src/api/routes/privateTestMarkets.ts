import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { managedListingRegistry, type ManagedListingRegistry } from '../../services/listings/registry';
import { privateTestAdmitted, SIMULATION_QUOTE } from '../../services/listings/privateTest';
import { listingSimulationConfig, type PublishedListing } from '../../services/listings/listingConfig';
import { publicTestAsset, testMarketCandles, UnsupportedTestIntervalError } from '../../services/testMarkets/testMarketService';

/**
 * HISTORY20 PRIVATE TEST MARKETS — authenticated reads for the verified owner
 * and the allowlisted testers only (privateTest.privateTestAdmitted: the mode
 * is on and the database verifies the participant). Anyone else,
 * an ADMIN included, gets the same 404 as for an unknown pair: a private
 * listing's existence is never revealed, and none of this is public data.
 *
 *   GET /private-test/markets                       listings, state and provenance
 *   GET /private-test/markets/:pair/candles         ?interval=5m|15m|1h|4h|1d|1w&limit=
 *   GET /private-test/markets/:pair/ticker          the model price the Spot gate, triggers and sale use
 *   GET /private-test/markets/:pair/orderbook       the real internal book: testers' own resting orders
 *
 * Pairs as VHX01-SIMUSDT. The server clock only: no preview parameter, so
 * no candle or price after `now` ever leaves it. Read-only.
 */
export function privateTestMarketsRouter(
  prisma: PrismaClient, engine: MatchingEngine,
  registry: Pick<ManagedListingRegistry, 'ensureFresh' | 'snapshot'> = managedListingRegistry, clock: () => number = Date.now,
): Router {
  const router = Router();
  const authenticate = requireAuth(prisma);
  const notFound = (res: Response) => res.status(404).json({ error: 'unknown_pair' });
  const admitted = asyncRoute(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!(await privateTestAdmitted(prisma, req.userId))) return notFound(res);
    next();
  });
  const privateListings = async () => {
    await registry.ensureFresh();
    return registry.snapshot().filter((listing) => listing.config.privateTest && listingSimulationConfig(listing.config).quote === SIMULATION_QUOTE);
  };
  const forPair = async (slug: string) => {
    const pair = decodeURIComponent(slug).toUpperCase().replace('-', '/');
    return (await privateListings()).find((listing) => listingSimulationConfig(listing.config).pair === pair) ?? null;
  };

  router.get('/private-test/markets', authenticate, admitted, asyncRoute(async (_req, res) => {
    const now = clock();
    res.json({ serverTime: now, assets: (await privateListings()).map((listing) => privateAsset(listing, now)) });
  }));

  router.get('/private-test/markets/:pair/candles', authenticate, admitted, asyncRoute(async (req, res) => {
    const listing = await forPair(req.params.pair);
    if (!listing) return notFound(res);
    const asset = listingSimulationConfig(listing.config);
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
    const now = clock();
    try {
      res.json({ source: 'simulation', pair: asset.pair, interval, serverTime: now, provenance: provenance(listing),
        candles: testMarketCandles(asset, interval, now, Number(req.query.limit) || 300) });
    } catch (error) {
      if (error instanceof UnsupportedTestIntervalError) return res.status(400).json({ error: 'unsupported_interval' });
      throw error;
    }
  }));

  router.get('/private-test/markets/:pair/ticker', authenticate, admitted, asyncRoute(async (req, res) => {
    const listing = await forPair(req.params.pair);
    if (!listing) return notFound(res);
    const now = clock();
    const asset = listingSimulationConfig(listing.config);
    const { state } = publicTestAsset(asset, now);
    if (state.phase !== 'live' || state.lastPrice === null) return res.status(404).json({ error: 'not_listed', listingAt: new Date(asset.listingAt).toISOString() });
    const book = engine.getBook(asset.pair);
    res.json({ source: 'simulation', serverTime: now, provenance: provenance(listing), ticker: {
      pair: asset.pair, lastPrice: String(state.lastPrice),
      // Executable sides come from testers' own orders; there may be none.
      bidPrice: book.bestBid()?.price?.toString() ?? null, askPrice: book.bestAsk()?.price?.toString() ?? null,
      high24h: String(state.high24h), low24h: String(state.low24h),
      volume24h: String(state.volume24h), quoteVolume24h: String(state.quoteVolume24h),
      changePercent24h: String(state.change24hPercent),
    } });
  }));

  router.get('/private-test/markets/:pair/orderbook', authenticate, admitted, asyncRoute(async (req, res) => {
    const listing = await forPair(req.params.pair);
    if (!listing) return notFound(res);
    const snapshot = engine.getBook(listingSimulationConfig(listing.config).pair).snapshot();
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  }));

  return router;
}

/** What the terminal must show beside a private market: what it is, what it settles in, and what it is not. */
function provenance(listing: PublishedListing) {
  const program = listing.config.simulationProgram;
  const growth = program?.kind === 'scenario-controls-v2' ? program.historicalGrowth : undefined;
  return {
    mode: 'HISTORY20_PRIVATE_TEST' as const,
    settlement: SIMULATION_QUOTE,
    withdrawable: false as const,
    rights: 'HISTORICAL_RIGHTS_UNVERIFIED' as const,
    clock: 'REAL_TIME' as const,
    label: 'Приватный тест History20: модельная цена, расчёты в SIMUSDT, вывод и обмен недоступны',
    scenarioId: growth?.scenarioId ?? null,
    source: growth ? {
      provider: growth.source.provider, asset: growth.source.asset, firstDate: growth.source.firstDate,
      lastDate: growth.source.lastDate, license: growth.source.license,
    } : null,
  };
}

function privateAsset(listing: PublishedListing, now: number) {
  return {
    ...publicTestAsset(listingSimulationConfig(listing.config), now),
    listingId: listing.id, version: listing.version, logo: listing.config.logo,
    displayTimeZone: listing.config.displayTimeZone, provenance: provenance(listing),
  };
}
