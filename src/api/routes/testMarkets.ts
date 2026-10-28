import { Router, Request, Response, NextFunction } from 'express';
import { isSimulationSettled, TEST_ASSETS, testAssetForPair, type TestAssetConfig } from '../../services/testMarkets/testAssetConfig';
import { getCurrentTestMarketState, simulationFor } from '../../services/testMarkets/testMarketSimulation';
import { isRetiredNrx } from '../../shared/nrxRetirement';
import { testMarketDepth } from '../../services/testMarkets/testMarketDepth';
import {
  effectiveTestMarketNow, publicTestAsset, resolveSimulationNow, testMarketCandles, UnsupportedTestIntervalError,
} from '../../services/testMarkets/testMarketService';

/**
 * TEST MARKETS — read-only, simulated, never tradable.
 *
 *   GET /market/test-assets                 every test asset with its state
 *   GET /market/test-assets/:pair           one asset (pair as VTA-USDT)
 *   GET /market/test-assets/:pair/candles   ?interval=5m|15m|1h|4h|1d|1w&limit=
 *
 * Mounted AHEAD of the venue-backed routers so the shared Spot endpoints
 * the terminal already calls (candles, ticker, book, trades) answer for a
 * test pair from the simulation — and for every other pair fall straight
 * through to the router that serves them today, untouched.
 *
 * Nothing here writes, and nothing here is cached publicly: the server's
 * clock decides what exists, so no candle after `now` ever leaves it.
 */
export function testMarketsRouter(clock: () => number = Date.now, env: NodeJS.ProcessEnv = process.env): Router {
  const router = Router();
  // Retirement covers stale clients and encoded aliases, before venue fallback.
  // Private balances/history/cancel routes do not pass through this public gate.
  router.use((req, res, next) => {
    let path = req.path;
    try { path = decodeURIComponent(path); } catch { /* Express rejects invalid encodings later. */ }
    const marketPath = /^\/(?:market(?:\/|$)|orderbook\/)/i.test(path);
    const pathHasNrx = path.split('/').some(segment => segment && isRetiredNrx(segment));
    const queryHasNrx = [req.query.pair, req.query.symbol].some(value => typeof value === 'string' && isRetiredNrx(value));
    if (marketPath && (pathHasNrx || queryHasNrx)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(410).json({ error: 'market_retired', symbol: 'NRX' });
    }
    next();
  });
  const nowFor = (req: Request) => resolveSimulationNow(req.query.simulationPreviewTime, clock, env);
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  router.get('/market/test-assets', (req, res) => {
    const now = nowFor(req);
    noStore(res);
    res.json({ serverTime: now, assets: TEST_ASSETS.map((asset) => publicTestAsset(asset, now)) });
  });

  router.get('/market/test-assets/:pair', (req, res) => {
    const asset = publicTestAssetForPair(pairFromSlug(req.params.pair));
    if (!asset) return res.status(404).json({ error: 'unknown_test_asset' });
    noStore(res);
    res.json(publicTestAsset(asset, nowFor(req)));
  });

  const sendCandles = (asset: TestAssetConfig, req: Request, res: Response) => {
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
    const limit = Number(req.query.limit) || 300;
    const now = nowFor(req);
    try {
      noStore(res);
      res.json({ source: 'simulation', pair: asset.pair, interval, isTestAsset: true, serverTime: now,
        candles: testMarketCandles(asset, interval, now, limit) });
    } catch (err) {
      if (err instanceof UnsupportedTestIntervalError) return res.status(400).json({ error: err.message });
      throw err;
    }
  };
  router.get('/market/test-assets/:pair/candles', (req, res) => {
    const asset = publicTestAssetForPair(pairFromSlug(req.params.pair));
    if (!asset) return res.status(404).json({ error: 'unknown_test_asset' });
    sendCandles(asset, req, res);
  });

  // ── The shared Spot endpoints, answered for test pairs only ─────────
  const forTestPair = (handler: (asset: TestAssetConfig, req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      const pair = pairFromSlug(req.params.pair);
      // A History20 private test pair is answered nowhere public and never handed to a venue
      // route — whether the registry knows it or not.
      if (isSimulationSettled(pair)) return res.status(404).json({ error: 'unknown_test_asset' });
      const asset = testAssetForPair(pair);
      if (!asset) return next();
      handler(asset, req, res);
    };

  router.get('/market/external/candles/:pair', forTestPair(sendCandles));

  const ticker = (asset: TestAssetConfig, req: Request, res: Response) => {
    const state = getCurrentTestMarketState(simulationFor(asset), effectiveTestMarketNow(asset, nowFor(req)));
    noStore(res);
    if (state.phase !== 'live' || state.lastPrice === null) return res.status(404).json({ error: `No ticker for ${asset.pair}`, isTestAsset: true, listingAt: new Date(asset.listingAt).toISOString() });
    const last = String(state.lastPrice);
    const book = testMarketDepth(simulationFor(asset), state.serverTime);
    res.json({ source: 'simulation', isTestAsset: true, isTradable: false, ticker: {
      pair: asset.pair, lastPrice: last, bidPrice: book.bids[0].price, askPrice: book.asks[0].price,
      high24h: String(state.high24h), low24h: String(state.low24h),
      volume24h: String(state.volume24h), quoteVolume24h: String(state.quoteVolume24h),
      changePercent24h: String(state.change24hPercent),
    } });
  };
  router.get('/market/external/tickers/:pair', forTestPair(ticker));
  router.get('/market/ticker/:pair', forTestPair(ticker));

  // Read-only display depth. No orders, matching, database reads or mutations.
  const sendBook = (asset: TestAssetConfig, req: Request, res: Response) => {
    noStore(res);
    res.json(testMarketDepth(simulationFor(asset), effectiveTestMarketNow(asset, nowFor(req))));
  };
  router.get('/market/external/orderbook/:pair', forTestPair(sendBook));
  router.get('/market/display/spot-book/:pair', forTestPair(sendBook));
  router.get('/orderbook/:pair', forTestPair(sendBook));
  router.get('/market/external/trades/:pair', forTestPair((asset, req, res) => {
    noStore(res);
    res.json({ source: 'simulation', pair: asset.pair, isTestAsset: true,
      trades: simulationFor(asset).recentTrades(effectiveTestMarketNow(asset, nowFor(req))) });
  }));

  return router;
}

function pairFromSlug(slug: string): string {
  return decodeURIComponent(slug).toUpperCase().replace('-', '/');
}

/** A test asset the public may read: never a History20 private test pair. */
function publicTestAssetForPair(pair: string): TestAssetConfig | null {
  return isSimulationSettled(pair) ? null : testAssetForPair(pair);
}
