import { Router } from 'express';
import type { MarketUniverse } from '../../services/marketData/bybit/MarketUniverse';

/**
 * The fallback order book.
 *
 * The terminal's depth comes from a WebSocket in the visitor's OWN browser,
 * which costs this process nothing and is the path every healthy visitor
 * stays on. This route exists for the visitors that path fails for — a
 * network that drops WebSockets, a corporate proxy, a jurisdiction the
 * venue refuses — who until now simply saw an empty book forever.
 *
 * It is written to be cheap enough to be worth having:
 *
 *  - The venue call goes through the SAME `BybitMarketDataService` the
 *    universe and tickers use, so it shares one circuit breaker, one local
 *    request budget and one `ProviderCache`. A venue outage trips once for
 *    everything rather than once per feature.
 *  - That cache coalesces concurrent readers onto a single in-flight
 *    request and holds the answer for a second. Cost therefore scales with
 *    the number of CONTRACTS being watched, not the number of people
 *    watching them: a thousand fallback clients on BTCUSDT are one upstream
 *    request per second, the same as one client.
 *  - The symbol must be a contract the venue actually lists as a linear
 *    perpetual. That is what keeps this from being an open proxy to an
 *    arbitrary venue endpoint.
 *
 * Public, like the rest of the market reference routes: this is published
 * market data, it carries no VOLTEX account state, and gating it behind
 * `requireAuth` would add a database round trip to a path whose entire
 * reason for existing is that it must stay cheap.
 */
export function marketDepthRouter(universe: MarketUniverse | null): Router {
  const router = Router();

  router.get('/market/futures/orderbook/:symbol', async (req, res) => {
    if (!universe) {
      res.json({ available: false, reason: 'provider_not_configured', detail: 'No venue is wired in this environment.' });
      return;
    }
    const requested = String(req.params.symbol ?? '').toUpperCase().replace('/', '');
    // Listed-contract check first, so an unlisted symbol never reaches the
    // venue at all. `available: false` rather than 404: the question was
    // answerable, and the answer is that we do not carry this contract.
    const listed = universe.perpetualCandidates().find((i) => i.providerSymbol === requested);
    if (!listed) {
      res.json({ available: false, reason: 'symbol_not_listed', detail: `${requested} is not a listed linear perpetual.` });
      return;
    }
    try {
      const book = await universe.provider.getOrderBook('linear', listed.providerSymbol);
      res.json({
        available: true,
        source: 'bybit',
        fetchedAt: book.fetchedAt,
        stale: book.stale,
        symbol: book.value.symbol,
        updateId: book.value.updateId,
        // The venue's own clock, passed through and labelled as such. It is
        // never compared against a browser clock — that comparison is what
        // used to empty this book on any machine whose time was off.
        providerTime: book.value.providerTime,
        bids: book.value.bids,
        asks: book.value.asks,
      });
    } catch (err) {
      // An unreachable venue is not an empty book. No levels are returned
      // at all, so nothing downstream can render this as zero depth.
      res.json({
        available: false,
        reason: 'provider_unavailable',
        detail: err instanceof Error ? err.message : 'The venue did not answer.',
      });
    }
  });

  return router;
}
