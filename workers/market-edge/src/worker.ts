import existingWorker from './index.js';
import { nrxPublicResponse } from '../../../src/services/testMarkets/nrxPublic';
import { managedListingResponse, PUBLIC_CATALOGUE_PATH, listingForPath } from '../../../src/services/listings/listingPublic';
import { authorizeListingsAdmin, listingsStub, publishedListings, ManagedListingsDO, type ListingsEnv } from './listingsStore';

export { ManagedListingsDO };

const unavailable = () => new Response(JSON.stringify({ error: 'listings_unavailable' }), {
  status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
});

/**
 * Order matters:
 * 1. NRX — unchanged, fully static, zero IO.
 * 2. /internal/listings/* — backend-only admin store API (Bearer secret, no browser Origin).
 * 3. Published managed listings — the public catalogue and each listed pair.
 * 4. Everything else — the existing public display edge.
 */
export default {
  async fetch(request: Request, env: ListingsEnv = {}): Promise<Response> {
    const nrx = nrxPublicResponse(request);
    if (nrx) return nrx;
    const url = new URL(request.url);
    if (url.pathname === '/internal/listings' || url.pathname.startsWith('/internal/listings/')) {
      const denied = await authorizeListingsAdmin(request, env);
      if (denied) return denied;
      const stub = listingsStub(env);
      return stub ? stub.fetch(request) : unavailable();
    }
    const isCatalogue = url.pathname === PUBLIC_CATALOGUE_PATH;
    // Only the catalogue and paths shaped like a pair route cost a store read (cached per isolate).
    if (isCatalogue || /^\/(market|orderbook)\//.test(url.pathname)) {
      const published = await publishedListings(env);
      if (!published) {
        if (isCatalogue) return unavailable();
      } else if (isCatalogue || listingForPath(url.pathname, published.listings)) {
        const response = managedListingResponse(request, published.listings, Date.now(), published.revision);
        if (response) return response;
      }
    }
    return existingWorker.fetch(request);
  },
};
