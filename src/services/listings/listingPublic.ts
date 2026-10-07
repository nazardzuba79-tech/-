/**
 * Public market data for PUBLISHED managed listings, computed on read.
 *
 * Edge-compatible like nrxPublic: no IO, DB, timers or environment. The
 * caller passes the published listings (from the Durable Object) and the
 * server clock; every path serves the same shapes VOLTEX already reads for
 * NRX, so the terminal needs no per-ticker code. A draft is never an input
 * here, so no URL or parameter can reach one.
 */
import { simulationFor } from '../testMarkets/testMarketSimulation';
import { testMarketDepth } from '../testMarkets/testMarketDepth';
import { publicTestAsset, testMarketCandles, UnsupportedTestIntervalError } from '../testMarkets/testMarketService';
import { listingPair, listingSimulationConfig, listingSlug, type PublishedListing } from './listingConfig';
import { isAith, validAithLease } from '../../shared/aithPublication';

const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

/** The public record of one listing: the ordinary test-asset shape plus its logo and identity. */
export function publicListingAsset(listing: PublishedListing, now: number) {
  const asset = listingSimulationConfig(listing.config);
  return {
    ...publicTestAsset(asset, now),
    managed: true as const,
    listingId: listing.id,
    version: listing.version,
    ...(listing.readLease ? { readLease: listing.readLease } : {}),
    logo: listing.config.logo,
    displayTimeZone: listing.config.displayTimeZone,
  };
}

/** The catalogue path. Everything else is keyed by the pair slug, e.g. `QAX-USDT`. */
export const PUBLIC_CATALOGUE_PATH = '/market/listings';

/** Which published listing, if any, a public path is about. */
export function listingForPath(pathname: string, listings: readonly PublishedListing[]): PublishedListing | null {
  const match = /^\/(?:market\/(?:test-assets|external\/(?:candles|orderbook|trades|tickers)|display\/spot-(?:book|trades|candles)|ticker)|orderbook)\/([A-Z0-9]+-USDT)(?:\/candles)?$/i.exec(pathname);
  if (!match) return null;
  const slug = match[1].toUpperCase();
  return listings.find((listing) => listingSlug(listing.config.symbol) === slug) ?? null;
}

/**
 * Answer a public request about managed listings, or `null` when the path is
 * not about one (the caller then continues with its other handlers).
 */
export function managedListingResponse(request: Request, listings: readonly PublishedListing[], now: number, revision: string): Response | null {
  listings = listings.filter(item => !isAith(item.config.symbol) || validAithLease(item.readLease, item.version, now));
  const url = new URL(request.url);
  const path = url.pathname;
  const isCatalogue = path === PUBLIC_CATALOGUE_PATH;
  const listing = isCatalogue ? null : listingForPath(path, listings);
  if (!isCatalogue && !listing) return null;
  const respond = (body: unknown, status = 200) => new Response(
    request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers },
  );
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return respond({ error: 'method_not_allowed' }, 405);
  if (isCatalogue) {
    return respond({ serverTime: now, revision, assets: listings.map((item) => publicListingAsset(item, now)) });
  }
  const current = listing as PublishedListing;
  if (isAith(current.config.symbol) && url.searchParams.has('listingVersion') && url.searchParams.get('listingVersion') !== String(current.version)) {
    return respond({ error: 'listing_version_changed', version: current.version }, 409);
  }
  const asset = listingSimulationConfig(current.config);
  const simulation = simulationFor(asset);
  const slug = listingSlug(current.config.symbol);
  const upper = path.toUpperCase();
  if (upper === `/MARKET/TEST-ASSETS/${slug}`) return respond(publicListingAsset(current, now));
  if (upper.endsWith('/CANDLES') || upper.startsWith('/MARKET/EXTERNAL/CANDLES/') || upper.startsWith('/MARKET/DISPLAY/SPOT-CANDLES/')) {
    const interval = url.searchParams.get('interval') ?? '5m';
    try {
      return respond({ source: 'simulation', pair: listingPair(current.config.symbol), interval, serverTime: now,
        candles: testMarketCandles(asset, interval, now, Number(url.searchParams.get('limit')) || 300) });
    } catch (error) {
      if (error instanceof UnsupportedTestIntervalError) return respond({ error: 'unsupported_interval' }, 400);
      throw error;
    }
  }
  if (upper.startsWith('/MARKET/DISPLAY/SPOT-BOOK/') || upper.startsWith('/MARKET/EXTERNAL/ORDERBOOK/') || upper.startsWith('/ORDERBOOK/')) {
    return respond(testMarketDepth(simulation, now));
  }
  if (upper.startsWith('/MARKET/DISPLAY/SPOT-TRADES/') || upper.startsWith('/MARKET/EXTERNAL/TRADES/')) {
    return respond({ source: 'simulation', pair: asset.pair,
      trades: simulation.recentTrades(now).map((trade) => ({ ...trade, time: trade.timestamp })), serverTime: now });
  }
  // Ticker (both aliases).
  const { state } = publicTestAsset(asset, now);
  if (state.lastPrice === null) return respond({ error: 'not_listed', listingAt: asset.listingAt }, 404);
  const book = testMarketDepth(simulation, now);
  return respond({ source: 'simulation', ticker: {
    pair: asset.pair, lastPrice: String(state.lastPrice),
    bidPrice: book.bids[0].price, askPrice: book.asks[0].price,
    high24h: String(state.high24h), low24h: String(state.low24h),
    volume24h: String(state.volume24h), quoteVolume24h: String(state.quoteVolume24h),
    changePercent24h: String(state.change24hPercent),
  }, serverTime: now });
}
