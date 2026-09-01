import { Router, Response } from 'express';
import { KrakenMarketDataService, ExternalMarketDataError } from '../../services/KrakenMarketDataService';
import { CoinGeckoService, ExternalRankingError } from '../../services/CoinGeckoService';
import { FearGreedService } from '../../services/FearGreedService';
import { PrismaClient } from '@prisma/client';

/**
 * Read-only market data mirrored from Kraken — coin list, live price, order
 * book depth, recent trades, and candles. Purely informational: nothing
 * here places or affects orders on our own matching engine or on Kraken.
 * (Kraken, not Bybit, because Bybit's public API blocks requests from
 * US-hosted servers, which is where this backend runs by default.)
 *
 * Pair route params use a hyphen ("BTC-USDT") instead of a slash, because
 * Express path params can't contain "/" — the handler converts it back to
 * our internal "BTC/USDT" format.
 */
export function marketRouter(
  marketDataService: KrakenMarketDataService,
  coinGeckoService: CoinGeckoService,
  fearGreedService: FearGreedService,
  prisma: PrismaClient
): Router {
  const router = Router();

  // The photo shown for the platform's featured strategy leader on the
  // Copy Trading page. It is the operator's own profile photo, published
  // deliberately: a strategy leader with a blank avatar is exactly what a
  // marketplace should not look like.
  //
  // Public on purpose — every visitor to the marketplace has to see it —
  // and therefore narrow on purpose: it returns one field for one
  // designated account and nothing else. It is NOT a lookup that can be
  // pointed at an arbitrary user, which is why it takes no parameters.
  router.get('/market/featured-trader', async (_req, res) => {
    try {
      const featured = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { avatarUrl: true },
      });
      res.json({ avatarUrl: featured?.avatarUrl ?? null });
    } catch (err) {
      // A missing photo must never break the marketplace — fall back to
      // the initials avatar rather than failing the page.
      console.error(err);
      res.json({ avatarUrl: null });
    }
  });

  // Market-WIDE headline figures for the Markets page: total 24h volume
  // and market cap across every exchange (CoinGecko /global), plus the
  // published Crypto Fear & Greed Index (alternative.me). Both are the
  // same numbers other exchanges show, which is the whole point — see
  // FearGreedService's doc comment for why the index can't be derived from
  // our own tickers. The two sources are independent, so one being
  // rate-limited leaves the other's figure intact rather than blanking the
  // whole card; only both failing is an error.
  router.get('/market/global', async (_req, res) => {
    const [globalResult, fearGreedResult] = await Promise.allSettled([
      coinGeckoService.getGlobalMarket(),
      fearGreedService.getIndex(),
    ]);

    if (globalResult.status === 'rejected' && fearGreedResult.status === 'rejected') {
      return res.status(502).json({ error: 'Market-wide data is temporarily unavailable' });
    }

    res.json({
      source: 'coingecko+alternative.me',
      global: globalResult.status === 'fulfilled' ? globalResult.value : null,
      fearGreed: fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null,
    });
  });

  // Market-cap rank + category metadata (DeFi/Layer 1/Meme/Stablecoin) for
  // sorting and filtering the pair list — Kraken's own AssetPairs endpoint
  // (listSymbols above) has neither, so this is a separate real source
  // rather than a hand-maintained ranking that would go stale. Purely
  // additive: a coin missing here just doesn't get a rank/category badge,
  // it's never removed from the tradable pair list over it.
  router.get('/market/external/rankings', async (_req, res) => {
    try {
      const rankings = await coinGeckoService.getRankings();
      res.json({ source: 'coingecko', rankings });
    } catch (err) {
      if (err instanceof ExternalRankingError) {
        return res.status(502).json({ error: err.message });
      }
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/market/external/symbols', async (_req, res) => {
    try {
      const symbols = await marketDataService.listSymbols();
      res.json({ source: 'kraken', symbols });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/tickers', async (_req, res) => {
    try {
      const tickers = await marketDataService.getTickers();
      res.json({ source: 'kraken', tickers });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/tickers/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const ticker = await marketDataService.getTicker(pair);
      if (!ticker) return res.status(404).json({ error: `No ticker for ${pair}` });
      res.json({ source: 'kraken', ticker });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/orderbook/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const book = await marketDataService.getOrderBook(pair, limit);
      res.json({ source: 'kraken', ...book });
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
      res.json({ source: 'kraken', pair, interval, candles });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/market/external/trades/:pair', async (req, res) => {
    try {
      const pair = pairFromSlug(req.params.pair);
      const limit = Math.min(Number(req.query.limit) || 60, 200);
      const trades = await marketDataService.getRecentTrades(pair, limit);
      res.json({ source: 'kraken', pair, trades });
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
