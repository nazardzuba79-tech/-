import { NEURIX } from './neurix';
import { simulationFor } from './testMarketSimulation';
import { testMarketDepth } from './testMarketDepth';
import { publicTestAsset, testMarketCandles, UnsupportedTestIntervalError } from './testMarketService';

const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

/** Edge-compatible, on-demand presentation. No IO, DB, timers or executable orders.
 * The production Worker never supplies a clock override or accepts a client clock.
 */
export function nrxPublicResponse(request: Request, clock: () => number = Date.now): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.toUpperCase().includes('NRX')) return null;
  const respond = (body: unknown, status = 200) => new Response(
    request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers },
  );
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return respond({ error: 'method_not_allowed' }, 405);
  const now = clock();
  const simulation = simulationFor(NEURIX);
  const path = url.pathname;
  if (path === '/market/nrx') return respond({ serverTime: now, assets: [publicTestAsset(NEURIX, now)] });
  if (path === '/market/test-assets/NRX-USDT') return respond(publicTestAsset(NEURIX, now));
  if (['/market/test-assets/NRX-USDT/candles', '/market/external/candles/NRX-USDT', '/market/display/spot-candles/NRX-USDT'].includes(path)) {
    const interval = url.searchParams.get('interval') ?? '5m';
    try {
      return respond({ source: 'simulation', pair: NEURIX.pair, interval, serverTime: now,
        candles: testMarketCandles(NEURIX, interval, now, Number(url.searchParams.get('limit')) || 300) });
    } catch (error) {
      if (error instanceof UnsupportedTestIntervalError) return respond({ error: 'unsupported_interval' }, 400);
      throw error;
    }
  }
  if (['/market/display/spot-book/NRX-USDT', '/market/external/orderbook/NRX-USDT', '/orderbook/NRX-USDT'].includes(path)) {
    return respond(testMarketDepth(simulation, now));
  }
  if (['/market/display/spot-trades/NRX-USDT', '/market/external/trades/NRX-USDT'].includes(path)) {
    return respond({ source: 'simulation', pair: NEURIX.pair,
      trades: simulation.recentTrades(now).map(trade => ({ ...trade, time: trade.timestamp })), serverTime: now });
  }
  if (['/market/ticker/NRX-USDT', '/market/external/tickers/NRX-USDT'].includes(path)) {
    const { state } = publicTestAsset(NEURIX, now);
    if (state.lastPrice === null) return respond({ error: 'not_listed', listingAt: NEURIX.listingAt }, 404);
    const book = testMarketDepth(simulation, now);
    return respond({ source: 'simulation', ticker: {
      pair: NEURIX.pair, lastPrice: String(state.lastPrice),
      bidPrice: book.bids[0].price, askPrice: book.asks[0].price,
      high24h: String(state.high24h), low24h: String(state.low24h),
      volume24h: String(state.volume24h), quoteVolume24h: String(state.quoteVolume24h),
      changePercent24h: String(state.change24hPercent),
    }, serverTime: now });
  }
  // Reserved locally, including malformed NRX routes: NEVER fall through to venues.
  return respond({ error: 'not_found' }, 404);
}
