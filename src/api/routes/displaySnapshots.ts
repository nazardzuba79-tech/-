import { Router } from 'express';
import type { LiveSource } from '../../services/marketData/live/contract';
import type { KrakenMarketDataService } from '../../services/KrakenMarketDataService';
import type { MarketUniverse } from '../../services/marketData/bybit/MarketUniverse';
import { FuturesDisplayTrades } from '../../services/FuturesDisplayTrades';
import { DISPLAY_REFRESH_MS, publicDisplayCache } from '../middleware/publicDisplayCache';

/** Display data is sampled at the HTTP boundary, NOT in the collector/price source.
 * Every execution, margin, liquidation, funding and ledger reader keeps its original source.
 */
export function displaySnapshotsRouter(source: LiveSource | null,
  spot: Pick<KrakenMarketDataService, 'getOrderBookWithMeta'>, universe: MarketUniverse | null,
  trades = new FuturesDisplayTrades({ url: process.env.MARKET_DATA_COLLECTOR_URL ?? '', token: process.env.MARKET_DATA_COLLECTOR_TOKEN ?? '' })): Router {
  const router = Router();
  router.get('/market/display', publicDisplayCache(DISPLAY_REFRESH_MS, body => body?.type === 'snapshot' && Array.isArray(body.rows) && body.rows.length > 0), (_req, res) => {
    if (!source) { res.status(503).json({ error: 'display_source_unavailable' }); return; }
    res.json(source.snapshot());
  });
  router.get('/market/display/futures-book/:symbol', publicDisplayCache(DISPLAY_REFRESH_MS, body => body?.available === true), async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const listed = /^[A-Z0-9]{1,28}USDT$/.test(symbol) && universe?.perpetualCandidates().find(i => i.providerSymbol === symbol);
    if (!listed || !universe) { res.status(404).json({ error: 'symbol_not_listed' }); return; }
    try {
      const book = await universe.provider.getOrderBook('linear', symbol);
      if (book.value.symbol !== symbol) throw new Error('Wrong contract');
      res.json({ available: true, symbol, source: 'bybit', fetchedAt: book.fetchedAt, stale: book.stale,
        updateId: book.value.updateId, providerTime: book.value.providerTime,
        bids: book.value.bids.slice(0, 200), asks: book.value.asks.slice(0, 200) });
    } catch { res.status(503).json({ error: 'display_book_unavailable' }); }
  });
  router.get('/market/display/futures-trades/:symbol', publicDisplayCache(DISPLAY_REFRESH_MS, body => Array.isArray(body?.trades)), async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol) || !universe?.perpetualCandidates().some(i => i.providerSymbol === symbol)) {
      res.status(404).json({ error: 'symbol_not_listed' }); return;
    }
    try { res.json(await trades.get(symbol)); }
    catch { res.status(503).json({ error: 'display_trades_unavailable' }); }
  });
  router.get('/market/display/spot-book/:pair', publicDisplayCache(DISPLAY_REFRESH_MS, body => body?.available === true), async (req, res) => {
    const slug = req.params.pair.toUpperCase();
    if (!/^[A-Z0-9]{1,32}-[A-Z0-9]{2,12}$/.test(slug)) { res.status(400).json({ error: 'invalid_pair' }); return; }
    const pair = slug.replace('-', '/');
    try {
      const book = await spot.getOrderBookWithMeta(pair, 50);
      if (book.value.pair !== pair) throw new Error('Wrong pair');
      res.json({ ...book.value, available: true, fetchedAt: book.fetchedAt, stale: book.stale });
    } catch { res.status(503).json({ error: 'display_book_unavailable' }); }
  });
  return router;
}
