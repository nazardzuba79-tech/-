/**
 * Admin → Listings (the Listing Factory). ADMIN only, re-checked on every
 * request by requireAdmin. Configurations live in Cloudflare (market-edge
 * Durable Object); this router validates, forwards with the server secret and
 * computes the private Preview. It never writes Neon and never credits a
 * balance — owner allocation is a separate, explicit maintenance step.
 *
 * Request budget per admin action: 1 Render request (+ the existing
 * requireAuth/requireAdmin session and role reads) + 1 Cloudflare request
 * (publish: 2 — it re-reads the draft to re-check the venue collision).
 * Public market data for published listings never reaches Render.
 */
import { randomBytes, randomUUID } from 'crypto';
import { Router, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  ListingValidationError, LISTING_COUNTDOWN_ACTIONS, LISTING_SCHEMA_VERSION, generateSeed, listingPair, listingSimulationConfig, parseListingConfig,
  type ListingConfig, type ListingCountdownAction,
} from '../../services/listings/listingConfig';
import { ListingStoreError, rescheduleRequestSchema, type ListingStore } from '../../services/listings/store';
import { managedListingRegistry, type ManagedListingRegistry } from '../../services/listings/registry';
import { SIM_INTERVALS, simulationFor } from '../../services/testMarkets/testMarketSimulation';
import { testMarketDepth } from '../../services/testMarkets/testMarketDepth';
import { AITH_PUBLICATION_PROTOCOL, isAith } from '../../shared/aithPublication';
import { publicTestAsset, testMarketCandles, UnsupportedTestIntervalError } from '../../services/testMarkets/testMarketService';
import { listingScenarioPreview } from '../../services/listings/listingPreview';

/** Venue spot pairs a managed ticker must not shadow (e.g. a real `QAX/USDT`). */
export interface VenueSpotPairs { hasSpotPair(pair: string): boolean }

const PUBLISH_KEY = /^[A-Za-z0-9-]{16,64}$/;
const ID = /^[a-z0-9][a-z0-9-]{2,62}$/;

function failure(res: Response, error: unknown) {
  if (error instanceof ListingValidationError) return res.status(422).json({ error: error.code, message: error.message });
  if (error instanceof ListingStoreError) {
    return res.status(error.status).json({ error: error.code, message: error.message,
      ...(typeof error.details.draftRevision === 'number' ? { draftRevision: error.details.draftRevision } : {}) });
  }
  return res.status(503).json({ error: 'LISTINGS_UNAVAILABLE', message: 'Listings are temporarily unavailable' });
}

/**
 * Build a config from the admin form: the server fills the schema version and
 * an automatic seed. The simulation profile and wick model are never taken
 * from a request — the store assigns them once on creation.
 */
function configFromBody(body: unknown, previous: ListingConfig | null): ListingConfig {
  const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>).config : null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') throw new ListingValidationError('INVALID_CONFIG', 'config is required');
  const { simulationProfile: _assignedByStore, wickModel: _wickModelAssignedByStore, ...input } = raw;
  const seedMode = input.seedMode === 'manual' ? 'manual' : 'auto';
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  const listingAt = typeof input.listingAt === 'string' ? input.listingAt : '';
  const seed = seedMode === 'manual'
    ? input.seed
    : previous?.seed ?? generateSeed(symbol || 'listing', listingAt || new Date().toISOString(), () => randomBytes(6).toString('hex'));
  return parseListingConfig({ ...input, schemaVersion: LISTING_SCHEMA_VERSION, seedMode, seed });
}

function ensureNotOnVenue(config: ListingConfig, venue: VenueSpotPairs | null) {
  if (venue?.hasSpotPair(listingPair(config.symbol))) {
    throw new ListingValidationError('TICKER_ON_MARKET', `${listingPair(config.symbol)} already trades on the market; choose another ticker`);
  }
}

export function adminListingsRouter(
  prisma: PrismaClient,
  store: ListingStore,
  venue: VenueSpotPairs | null,
  registry: Pick<ManagedListingRegistry, 'invalidate' | 'ensureFresh'> & Partial<Pick<ManagedListingRegistry, 'authoritative'>> = managedListingRegistry,
  clock: () => number = Date.now,
): Router {
  const router = Router();
  const guard = [requireAuth(prisma), requireAdmin(prisma)];
  const noStore = (res: Response) => res.set('Cache-Control', 'no-store');
  // A small per-router LRU, populated only by explicit admin preview requests.
  // Revision AND complete configuration are in the key; editing a draft can
  // never show a previously generated, incorrectly labelled history.
  const previewCache = new Map<string, ReturnType<typeof listingScenarioPreview>>();

  router.get('/admin/listings', ...guard, async (_req, res) => {
    noStore(res);
    try { res.json(await store.list()); } catch (error) { failure(res, error); }
  });

  router.post('/admin/listings/:id/reschedule', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const parsed = rescheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_RESCHEDULE_REQUEST' });
    try {
      if (!store.reschedule) return res.status(503).json({ error: 'RESCHEDULE_UNAVAILABLE' });
      const result = await store.reschedule(req.params.id, parsed.data, req.userId!);
      registry.invalidate();
      res.json(result);
    } catch (error) { failure(res, error); }
  });

  router.get('/admin/listings/authority', ...guard, async (_req, res) => {
    noStore(res);
    try {
      if (!registry.authoritative) return res.status(503).json({ error: 'authority_unavailable' });
      const listings = await registry.authoritative();
      res.json({ protocol: AITH_PUBLICATION_PROTOCOL, serverTime: clock(), listings: listings.map(item => ({ id: item.id, version: item.version, initialPrice: item.config.initialPrice, listingAt: item.config.listingAt, readLease: item.readLease })) });
    } catch (error) { failure(res, error); }
  });

  router.post('/admin/listings/:id/replace-prelisting', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    try {
      if (!store.replacePrelisting || !registry.authoritative) return res.status(503).json({ error: 'replacement_protocol_unavailable' });
      const listing = (await store.list()).listings.find(item => item.id === req.params.id);
      if (!listing || !isAith(listing.symbol)) return res.status(422).json({ error: 'replacement_not_supported' });
      // Read-only economic activity gate. AITH's independent trading guard prevents a racing order during the lease drain.
      const counts = await Promise.all([
        prisma.order.count({ where: { pair: { in: ['AITH/USDT', 'AITH-USDT', 'AITHUSDT'] } } }),
        prisma.trade.count({ where: { pair: { in: ['AITH/USDT', 'AITH-USDT', 'AITHUSDT'] } } }),
        prisma.futuresOrder.count({ where: { symbol: { in: ['AITH/USDT', 'AITH-USDT', 'AITHUSDT'] } } }),
        prisma.futuresPosition.count({ where: { symbol: { in: ['AITH/USDT', 'AITH-USDT', 'AITHUSDT'] } } }),
        prisma.balance.count({ where: { asset: 'AITH', OR: [{ available: { not: 0 } }, { locked: { not: 0 } }] } }),
      ]);
      if (counts.some(count => count !== 0)) return res.status(422).json({ error: 'HISTORY_LOCKED', message: 'AITH has economic activity; replacement is forbidden' });
      const result = await store.replacePrelisting(req.params.id, req.body ?? {}, req.userId!);
      registry.invalidate();
      const current = await registry.authoritative();
      if (result.phase === 'COMMITTED' && !current.some(item => item.id === listing.id && item.version === result.version)) {
        return res.status(503).json({ error: 'replacement_committed_registry_unavailable', operationKey: result.operationKey });
      }
      res.json(result);
    } catch (error) { failure(res, error); }
  });

  // Create: a new id; If-Match 0 makes a second submit of the same form a conflict, not a duplicate.
  router.post('/admin/listings', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    try {
      const config = configFromBody(req.body, null);
      ensureNotOnVenue(config, venue);
      const id = `${config.symbol.toLowerCase()}-${randomUUID().slice(0, 8)}`;
      res.status(201).json(await store.saveDraft(id, config, 0, req.userId!));
    } catch (error) { failure(res, error); }
  });

  router.put('/admin/listings/:id/draft', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    const ifMatch = req.headers['if-match'];
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (typeof ifMatch !== 'string' || !/^[1-9]\d{0,15}$/.test(ifMatch)) return res.status(428).json({ error: 'DRAFT_REVISION_REQUIRED' });
    try {
      // An automatic seed is kept by the store itself (withStableSeed), so a save is one Cloudflare call.
      const config = configFromBody(req.body, null);
      ensureNotOnVenue(config, venue);
      res.json(await store.saveDraft(req.params.id, config, Number(ifMatch), req.userId!));
    } catch (error) { failure(res, error); }
  });

  /**
   * Private Preview of the DRAFT at a chosen instant (default: two hours after
   * listing, or now if later). The same simulation as the public edge: the
   * published market will show exactly this for the same configuration.
   */
  router.get('/admin/listings/:id/preview', ...guard, async (req, res) => {
    noStore(res);
    try {
      const listing = (await store.list()).listings.find((item) => item.id === req.params.id);
      if (!listing) return res.status(404).json({ error: 'not_found' });
      const asset = listingSimulationConfig(listing.draft);
      const horizon = typeof req.query.horizon === 'string' ? req.query.horizon : null;
      const requested = typeof req.query.at === 'string' ? Date.parse(req.query.at) : NaN;
      const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
      // A day inside a historical growth window (horizon=window); anything else is refused by the preview.
      const fromDay = typeof req.query.fromDay === 'string' && /^\d{1,4}$/.test(req.query.fromDay) ? Number(req.query.fromDay) : 0;
      let scenario: ReturnType<typeof listingScenarioPreview> | undefined;
      if (horizon !== null) {
        const key = JSON.stringify([listing.id, listing.draftRevision, listing.draft, horizon, interval, fromDay]);
        scenario = previewCache.get(key);
        if (scenario) previewCache.delete(key);
        else scenario = listingScenarioPreview(listing.draft, interval, horizon, { fromDay });
        previewCache.set(key, scenario);
        if (previewCache.size > 12) previewCache.delete(previewCache.keys().next().value!);
      }
      const at = scenario?.scenarioSummary.to ?? (Number.isFinite(requested) ? requested : Math.max(clock(), asset.listingAt + 2 * 60 * 60_000));
      const simulation = simulationFor(asset);
      res.json({
        listingId: listing.id, draftRevision: listing.draftRevision, previewAt: at, serverTime: clock(),
        asset: { ...publicTestAsset(asset, at), logo: listing.draft.logo, displayTimeZone: listing.draft.displayTimeZone },
        // A historical growth window spans years: without a horizon, at most 30 days of candles
        // around `at` (≤ 200), so a coarse interval never asks for the whole window's ticks.
        candles: scenario?.candles ?? testMarketCandles(asset, interval, at, listing.draft.simulationProgram?.kind === 'scenario-controls-v2'
          && listing.draft.simulationProgram.growth === 'historical-window' && SIM_INTERVALS[interval]
          ? Math.max(1, Math.min(200, Math.floor(30 * 24 * 60 * 60_000 / SIM_INTERVALS[interval]))) : 200),
        ...(scenario ? { scenarioSummary: scenario.scenarioSummary } : {}),
        book: testMarketDepth(simulation, at),
        trades: simulation.recentTrades(at, 30).map((trade) => ({ ...trade, time: trade.timestamp })),
      });
    } catch (error) {
      if (error instanceof UnsupportedTestIntervalError) return res.status(400).json({ error: 'unsupported_interval' });
      failure(res, error);
    }
  });

  router.post('/admin/listings/:id/publish', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    const { draftRevision, publishKey, countdown } = (req.body ?? {}) as { draftRevision?: unknown; publishKey?: unknown; countdown?: unknown };
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (!Number.isSafeInteger(draftRevision) || typeof publishKey !== 'string' || !PUBLISH_KEY.test(publishKey)
      || (countdown !== undefined && countdown !== 'staged' && countdown !== 'running')) {
      return res.status(400).json({ error: 'INVALID_PUBLISH_REQUEST' });
    }
    try {
      const listing = (await store.list()).listings.find((item) => item.id === req.params.id);
      if (!listing) return res.status(404).json({ error: 'not_found' });
      ensureNotOnVenue(listing.draft, venue);
      const result = await store.publish(req.params.id, draftRevision as number, publishKey, req.userId!, countdown as 'staged' | 'running' | undefined);
      // Render's trading registry learns the new version on the next order/valuation.
      registry.invalidate();
      res.json(result);
    } catch (error) { failure(res, error); }
  });

  /**
   * The pre-listing timer: start, pause or stop the public countdown of a
   * published listing. Operational state in the store, never a new version;
   * the listing time stays where the publication put it. Nothing starts by
   * itself: a passed date is refused (LISTING_TIME_PAST) until it is moved.
   */
  router.post('/admin/listings/:id/countdown', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    const { action } = (req.body ?? {}) as { action?: unknown };
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (typeof action !== 'string' || !LISTING_COUNTDOWN_ACTIONS.includes(action as ListingCountdownAction)) {
      return res.status(400).json({ error: 'INVALID_COUNTDOWN_REQUEST' });
    }
    try {
      if (!store.countdown) return res.status(503).json({ error: 'COUNTDOWN_UNAVAILABLE', message: 'The listing store does not support the timer yet' });
      const result = await store.countdown(req.params.id, action as ListingCountdownAction, req.userId!);
      // The Spot gate and the restricted-asset guards follow the timer on the next order/valuation.
      registry.invalidate();
      res.json(result);
    } catch (error) { failure(res, error); }
  });

  /** ADMIN-only hard delete. The economic read is intentionally fail-closed. */
  router.post('/admin/listings/:id/delete', ...guard, async (req: AuthedRequest, res) => {
    noStore(res);
    const { symbol, draftRevision, activeVersion, confirmation } = (req.body ?? {}) as Record<string, unknown>;
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,10}$/.test(symbol) ||
      !Number.isSafeInteger(draftRevision) || Number(draftRevision) < 1 ||
      (activeVersion !== null && (!Number.isSafeInteger(activeVersion) || Number(activeVersion) < 1)) ||
      confirmation !== `УДАЛИТЬ ${symbol}`) return res.status(400).json({ error: 'DELETE_CONFIRMATION_REQUIRED' });
    try {
      if (!store.deleteListing) return res.status(503).json({ error: 'DELETE_UNAVAILABLE' });
      const listing = (await store.list()).listings.find(item => item.id === req.params.id);
      if (!listing) return res.status(404).json({ error: 'not_found' });
      if (listing.symbol !== symbol || listing.draftRevision !== draftRevision || listing.activeVersion !== activeVersion)
        return res.status(409).json({ error: 'LISTING_CHANGED', message: 'Листинг изменился. Обновите список перед удалением.' });
      if (listing.draft.tradable || listing.active?.tradable)
        return res.status(422).json({ error: 'LISTING_TRADABLE', message: 'Активный торгуемый рынок нельзя удалить до отключения торговли.' });
      const pairs = [`${symbol}/USDT`, `${symbol}-USDT`, `${symbol}USDT`, `${symbol}/SIMUSDT`, `${symbol}-SIMUSDT`];
      const counts = await Promise.all([
        prisma.order.count({ where: { pair: { in: pairs } } }),
        prisma.trade.count({ where: { pair: { in: pairs } } }),
        prisma.futuresOrder.count({ where: { symbol: { in: pairs } } }),
        prisma.futuresPosition.count({ where: { symbol: { in: pairs } } }),
        prisma.balance.count({ where: { asset: symbol, OR: [{ available: { not: 0 } }, { locked: { not: 0 } }] } }),
        prisma.demoBalance.count({ where: { asset: symbol, OR: [{ available: { not: 0 } }, { locked: { not: 0 } }] } }),
        prisma.demoOrder.count({ where: { pair: { in: pairs } } }),
        prisma.demoTrade.count({ where: { pair: { in: pairs } } }),
      ]);
      if (counts.some(count => count !== 0))
        return res.status(422).json({ error: 'LISTING_HAS_ACTIVITY', message: 'По активу найдены ордера, сделки, позиции или остатки средств. Удаление отменено.' });
      const result = await store.deleteListing(req.params.id, symbol, Number(draftRevision), activeVersion as number | null, req.userId!);
      previewCache.clear();
      registry.invalidate();
      res.json(result);
    } catch (error) { failure(res, error); }
  });

  return router;
}
