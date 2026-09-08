import { Router } from 'express';
import { MarketDataGateway } from '../../services/marketData/MarketDataGateway';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import type { PrismaClient } from '@prisma/client';
import type { Availability } from '../../services/marketData/types';

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
export function marketDataRouter(prisma: PrismaClient, gateway: MarketDataGateway): Router {
  const router = Router();

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
   * The canonical asset catalogue.
   *
   * `?tradable=true` narrows it to assets with at least one executable
   * VOLTEX pair. The distinction is the point of the endpoint: the
   * catalogue is ~500 assets of reference metadata, the tradable set is
   * whatever the venue actually lists, and one is never evidence for the
   * other. `limit`/`offset` exist so a 500-row table pages instead of
   * shipping the whole catalogue to render 50 visible rows.
   */
  router.get('/market/assets', async (req, res) => {
    try {
      const result = await gateway.getAssetCatalogue();
      if (!result.available) return res.json(result);

      const tradableOnly = req.query.tradable === 'true';
      // Clamped, not trusted: `limit` is client-supplied and this is a
      // public endpoint.
      const limit = clampInt(req.query.limit, 100, 1, 500);
      const offset = clampInt(req.query.offset, 0, 0, 100_000);

      const all = tradableOnly ? result.value.assets.filter((a) => a.tradable) : result.value.assets;
      res.json({
        available: true,
        source: result.source,
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        value: {
          assets: all.slice(offset, offset + limit),
          total: all.length,
          catalogueTotal: result.value.total,
          tradableCount: result.value.tradableCount,
          collisions: result.value.collisions,
          metadataComplete: result.value.metadataComplete,
          limit,
          offset,
        },
      });
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
