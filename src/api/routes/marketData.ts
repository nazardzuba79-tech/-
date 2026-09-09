import { Router } from 'express';
import { MarketDataGateway } from '../../services/marketData/MarketDataGateway';
import type { MarketUniverse } from '../../services/marketData/bybit/MarketUniverse';
import type { ExternalDerivativesService } from '../../services/marketData/derivatives/ExternalDerivativesService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import type { PrismaClient } from '@prisma/client';
import type { Availability } from '../../services/marketData/types';
import type { AssetSortKey } from '../../services/marketData/AssetRegistry';

/**
 * The gateway's own HTTP surface.
 *
 * These endpoints are ADDITIVE. Every pre-existing `/market/*` route keeps
 * its exact response shape, because several shipped frontend surfaces
 * depend on them and this task is plumbing, not a contract break. What is
 * new here is the shape the frontend should migrate to: one snapshot
 * instead of six polls, a catalogue that separates "listed in the
 * catalogue" from "tradable on VOLTEX", and freshness metadata on every
 * payload.
 *
 * The response convention is the gateway's `Availability<T>` union,
 * serialized directly:
 *
 *   { available: true, value: …, source: "kraken", fetchedAt: 1234, stale: false }
 *   { available: false, reason: "provider_unavailable", detail: "…" }
 *
 * An unavailable section carries NO value-carrying fields at all. That is
 * the anti-fake-zero guarantee expressed on the wire: a client cannot plot
 * a missing metric as zero, because there is nothing there to plot. It
 * also means the frontend never has to infer failure from a suspicious
 * number.
 *
 * HTTP status: an `available: false` section is still a 200. It is a
 * successful answer to "what do you have?" — the answer is "not this".
 * Reserving non-2xx for genuine server faults keeps a provider outage from
 * looking like a bug in VOLTEX.
 */
export function marketDataRouter(
  prisma: PrismaClient,
  gateway: MarketDataGateway,
  /** External derivatives reference data. Optional so an environment
   *  without the venues wired answers `provider_not_configured` rather
   *  than failing to construct the router. */
  externalDerivatives: ExternalDerivativesService | null = null,
  /** The discoverable venue instrument universe. Optional for the same
   *  reason: an environment with no venue wired answers honestly rather
   *  than failing to construct. */
  universe: MarketUniverse | null = null
): Router {
  const router = Router();

  /**
   * Tracked-venue derivatives statistics for ONE asset.
   *
   * Exists so the Futures header does not have to poll the whole
   * Analytics snapshot for two numbers. It reads the same per-venue
   * ProviderCaches every other consumer uses, so it adds no upstream
   * request of its own: a hundred readers cost what one reader costs.
   *
   * Public market reference data, like the rest of this router — no auth,
   * no VOLTEX account state, and nothing here can reach an order book.
   */
  router.get('/market/derivatives/:baseAsset', async (req, res) => {
    if (!externalDerivatives) {
      res.json({ available: false, reason: 'provider_not_configured', detail: 'No external derivatives venue is wired in this environment.' });
      return;
    }
    // Bounded before it reaches an adapter; the adapters then refuse
    // anything not in their explicit contract maps, so a client cannot
    // steer a Binance/OKX request at an arbitrary symbol.
    const baseAsset = String(req.params.baseAsset ?? '').slice(0, 12).toUpperCase();
    try {
      res.json(await externalDerivatives.getFuturesMarketStats(baseAsset));
    } catch {
      res.json({ available: false, reason: 'provider_unavailable', detail: 'Derivatives statistics could not be read.' });
    }
  });

  /**
   * GET /market/universe — the DISCOVERABLE market universe.
   *
   * Every real instrument the venue lists: hundreds of spot pairs, 500+
   * perpetuals. This is deliberately NOT the executable set — `has()` on
   * the futures registry decides that, and it is a strict subset (see
   * FuturesMarketRegistry). A market appearing here is a statement that it
   * exists in the world, never that VOLTEX will take an order on it.
   *
   * `executable` is stamped per row from the futures registry, so the UI
   * never has to guess and can never render a Trade button for a market
   * the backend would reject.
   *
   * One request serves the whole universe. Nothing here is per-instrument,
   * and nothing triggers an upstream call: it reads the already-refreshed
   * in-memory universe.
   */
  router.get('/market/universe', (req, res) => {
    if (!universe) {
      res.json({ available: false, reason: 'provider_not_configured', detail: 'No venue universe is wired in this environment.' });
      return;
    }
    const snapshot = universe.snapshot();
    if (!snapshot.loaded) {
      // Never an empty list: "we have not loaded it" and "there are no
      // markets" are different facts and only one of them is true.
      res.json({ available: false, reason: 'provider_unavailable', detail: 'The market universe has not loaded yet.' });
      return;
    }

    const type = String(req.query.type ?? '');
    const rows = type ? snapshot.instruments.filter((i) => i.marketType === type) : snapshot.instruments;

    res.json({
      available: true,
      fetchedAt: snapshot.refreshedAt,
      stale: false,
      value: {
        counts: {
          spot: snapshot.instruments.filter((i) => i.marketType === 'spot').length,
          linearPerpetual: snapshot.instruments.filter((i) => i.marketType === 'linear_perpetual').length,
          linearFutures: snapshot.instruments.filter((i) => i.marketType === 'linear_futures').length,
          inverse: snapshot.instruments.filter((i) => i.marketType === 'inverse').length,
        },
        instruments: rows.map((i) => ({
          symbol: i.symbol,
          marketType: i.marketType,
          baseAsset: i.baseAsset,
          quoteAsset: i.quoteAsset,
          settleAsset: i.settleAsset,
          status: i.status,
          filters: i.filters,
          // Provenance travels in the payload for logs and diagnostics.
          // The customer-facing UI never renders it — asserted by
          // frontend/src/lib/__tests__/noProviderBranding.test.ts.
          provider: i.provider,
          providerSymbol: i.providerSymbol,
        })),
      },
    });
  });

  /**
   * The single shared snapshot: all spot tickers, market-wide overview and
   * sentiment in one payload.
   *
   * This is the endpoint that replaces the per-component polling loops.
   * Before it, a homepage view could run four independent timers against
   * three endpoints for overlapping data; the backend's caches absorbed
   * the provider cost but VOLTEX still served every one of those requests.
   * Now one poll feeds every consumer on the page.
   */
  router.get('/market/snapshot', async (_req, res) => {
    try {
      res.json(await gateway.getSnapshot());
    } catch (err) {
      // Each section already degrades independently inside the gateway, so
      // reaching here means something structural broke rather than a
      // provider being down.
      console.error('[marketData] snapshot failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The canonical asset catalogue: search, sort, filter and paginate.
   *
   *   ?search=btc        symbol OR name, case-insensitive
   *   ?tradable=true     only assets with a real executable VOLTEX pair
   *   ?sort=marketCap    rank | marketCap | volume24h | price | change24h
   *                      | symbol | name          (default: rank)
   *   ?dir=asc|desc      default desc, which for `rank` means best-first
   *   ?limit= &offset=   clamped; default 100, max 1000 (1000 so the
   *                      Markets page can load the whole catalogue once
   *                      and then filter it client-side)
   *
   * The tradable distinction is the point of the endpoint. The catalogue
   * is ~500 assets of market-wide reference metadata; the tradable set is
   * whatever the venue actually lists, and one is never evidence for the
   * other. The response reports `matched` (rows passing the filter) AND
   * `catalogueTotal` separately so a filtered view can say what it is a
   * subset of.
   *
   * Filtering and sorting run over the already-cached join, so paging
   * through the whole catalogue or typing in a search box costs ZERO
   * upstream provider requests.
   */
  router.get('/market/assets', async (req, res) => {
    try {
      const result = await gateway.queryAssets({
        search: typeof req.query.search === 'string' ? req.query.search.slice(0, 64) : undefined,
        tradableOnly: req.query.tradable === 'true',
        sort: parseSort(req.query.sort),
        direction: req.query.dir === 'asc' ? 'asc' : 'desc',
        // Clamped, not trusted: both are client-supplied on a public
        // endpoint. The registry clamps again, so neither layer relies on
        // the other having done it.
        limit: clampInt(req.query.limit, 100, 1, 1000),
        offset: clampInt(req.query.offset, 0, 0, 100_000),
      });
      res.json(result);
    } catch (err) {
      console.error('[marketData] asset catalogue failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Icon/display metadata for a batch of tickers — `?symbols=BTC,ETH,SOL`.
   *
   * The whole reason this is a batch endpoint: rendering a 500-row market
   * table must cost ONE metadata request, not 500. Unknown symbols are
   * absent from the response rather than present-and-empty, so the client
   * falls through to its own deterministic letter avatar without a round
   * trip that could only ever return nothing.
   */
  router.get('/market/assets/icons', async (req, res) => {
    const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      // Bounded: the query string is client-controlled and this walks the
      // catalogue once per call.
      .slice(0, 500);
    if (symbols.length === 0) return res.json({ assets: {} });
    try {
      res.json({ assets: await gateway.iconMetadata(symbols) });
    } catch (err) {
      console.error('[marketData] icon metadata failed', err);
      // Icons are decoration. A failure here degrades to letter avatars,
      // it does not fail the page.
      res.json({ assets: {} });
    }
  });

  /** Executable VOLTEX markets. Explicitly separate from the catalogue. */
  router.get('/market/tradable', async (_req, res) => {
    res.json(await gateway.getTradableMarkets());
  });

  /** One pair's ticker, with provenance and freshness. */
  router.get('/market/ticker/:pair', async (req, res) => {
    res.json(await gateway.getTicker(req.params.pair.replace('-', '/')));
  });

  /**
   * Gateway and provider status: circuit state per provider, the
   * capability routing table, and catalogue size.
   *
   * Admin-only, matching the existing `/analytics/overview` gate. Provider
   * health is operational detail — which upstreams are failing and how
   * often they rate-limit us — and an ordinary client has no business
   * seeing it.
   */
  router.get('/market/status', requireAuth(prisma), requireAdmin(prisma), async (_req: AuthedRequest, res) => {
    try {
      res.json(await gateway.getStatus());
    } catch (err) {
      console.error('[marketData] status failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

/** Only the sort keys the registry implements. Anything else falls back to
 *  the default rather than being passed through to a lookup that would
 *  silently do nothing. */
function parseSort(raw: unknown): AssetSortKey | undefined {
  const allowed: AssetSortKey[] = ['rank', 'marketCap', 'volume24h', 'price', 'change24h', 'symbol', 'name'];
  return typeof raw === 'string' && (allowed as string[]).includes(raw) ? (raw as AssetSortKey) : undefined;
}

/** Parse a client-supplied integer into a bounded range, falling back to a
 *  default for anything absent or unparseable. Never throws. */
function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Re-exported so route tests can assert on the union without importing
 *  from the service layer. */
export type { Availability };
