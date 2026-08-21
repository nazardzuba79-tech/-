import { Router, Response } from 'express';
import { BybitMarketDataService, ExternalMarketDataError } from '../../services/BybitMarketDataService';

/**
 * Read-only market data mirrored from Bybit — coin list, live price, and
 * order book depth. Purely informational: nothing here places or affects
 * orders on our own matching engine or on Bybit.
 *
 * Pair route params use a hyphen ("BTC-USDT") instead of a slash, because
 * Express path params can't contain "/" — the handler converts it back to
 * our internal "BTC/USDT" format.
 */
export function marketRouter(marketDataService: BybitMarketDataService): Router {
  const router = Router();

  router.get('/market/external/symbols', async (_req, res) => {
    try {
      const symbols = await marketDataService.listSymbols();
      res.json({ source: 'bybit', symbols });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/tickers', async (_req, res) => {
    try {
      const tickers = await marketDataService.getTickers();
      res.json({ source: 'bybit', tickers });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/tickers/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const ticker = await marketDataService.getTicker(pair);
      if (!ticker) return res.status(404).json({ error: `No ticker for ${pair}` });
      res.json({ source: 'bybit', ticker });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/orderbook/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const book = await marketDataService.getOrderBook(pair, limit);
      res.json({ source: 'bybit', ...book });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/candles/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const interval = typeof req.query.interval === 'string' ? req.query.interval : '1m';
      const limit = Math.min(Number(req.query.limit) || 300, 1000);
      const candles = await marketDataService.getCandles(pair, interval, limit);
      res.json({ source: 'bybit', pair, interval, candles });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/trades/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const limit = Math.min(Number(req.query.limit) || 60, 200);
      const trades = await marketDataService.getRecentTrades(pair, limit);
      res.json({ source: 'bybit', pair, trades });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}

function pairFromSlug(slug: string): string {
  return decodeURIComponent(slug).toUpperCase().replace('-', '/');
}

function handleError(err: unknown, res: Response) {
  if (err instanceof ExternalMarketDataError) {
    // 502: we're a proxy for Bybit here, and Bybit is the one that failed.
    return res.status(502).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
