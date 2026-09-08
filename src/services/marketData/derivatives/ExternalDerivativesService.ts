import { available, unavailable, type Availability } from '../types';
import { BinanceDerivativesService } from './BinanceDerivativesService';
import { OkxDerivativesService } from './OkxDerivativesService';
import {
  type DerivativesVenue,
  type TrackedVenueTurnover,
  type VenueTurnover,
  type LongShortRatio,
  type LongShortRatioKind,
  type TrackedVenueOpenInterest,
  type VenueAttribution,
  type VenueBasis,
  type VenueFunding,
  type VenueOpenInterest,
} from './types';

/**
 * The cross-venue derivatives view.
 *
 * This service composes the per-venue adapters; it owns no transport and
 * no cache of its own. Each adapter already has its own circuit and its
 * own `ProviderCache`, so a hundred readers of this page cost one request
 * per venue per TTL — proven in `ExternalDerivatives.test.ts` rather than
 * asserted here.
 *
 * ── The three rules this file exists to enforce ─────────────────────
 *
 * **1. Partial is partial.** Binance answering and OKX failing produces a
 * value built from Binance alone, with `sources` naming Binance alone. The
 * label the UI prints is derived from that list, so it cannot keep saying
 * "Binance + OKX" while OKX is down. Both failing is `available: false`,
 * not an empty aggregate.
 *
 * **2. Tracked venues are not the market.** The sum below is over the
 * venues that answered. It is called tracked-venue open interest
 * everywhere — payload, i18n key and UI — because Binance plus OKX is a
 * large share of perpetual open interest and is not a market-wide
 * aggregate. No provider here supplies one, so none is claimed.
 *
 * **3. Nothing here is a VOLTEX number.** Every value is labelled with the
 * external venue that produced it. VOLTEX's own open interest, funding and
 * mark price come from `AnalyticsDataService`'s venue-scoped section and
 * are never mixed into these aggregates — and no value produced here may
 * enter mark price, index price, margin, leverage, liquidation, funding
 * settlement or PnL. `AnalyticsSeparation.test.ts` asserts that.
 */

/** Assets the external modules cover. Every one is listed on both venues
 *  in the adapters' contract maps; an asset missing from a venue simply
 *  contributes no row from it. */
export const TRACKED_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;

export interface FundingComparison {
  baseAsset: string;
  venues: VenueFunding[];
}

export interface BasisComparison {
  baseAsset: string;
  venues: VenueBasis[];
}

/**
 * What the Futures header needs, and nothing else.
 *
 * Contributors are per metric. `openInterestBaseVenues` names the venues
 * whose BASE-unit open interest was summed; `openInterestUsdVenues` names
 * the venues that reported a notional. They can differ, and a UI that
 * shows a base figure must credit the base contributors.
 */
export interface FuturesMarketStats {
  baseAsset: string;
  turnover24hUsd: number | null;
  turnoverVenues: DerivativesVenue[];
  openInterestBase: number | null;
  openInterestUsd: number | null;
  openInterestBaseVenues: DerivativesVenue[];
  openInterestUsdVenues: DerivativesVenue[];
}

export interface PositioningValue {
  baseAsset: string;
  /** One entry per ratio DEFINITION, never merged into a single figure. */
  ratios: LongShortRatio[];
}

function attribution(rows: { venue: DerivativesVenue; contract: string; fetchedAt: number; stale: boolean }[]): VenueAttribution[] {
  return rows.map((r) => ({ venue: r.venue, contract: r.contract, fetchedAt: r.fetchedAt, stale: r.stale }));
}

/** Oldest contributing fetch, so a mixed-age aggregate reports the age a
 *  reader should actually judge it by. */
function oldest(rows: { fetchedAt: number }[]): number {
  return rows.reduce((min, r) => Math.min(min, r.fetchedAt), Number.POSITIVE_INFINITY);
}

/** A settled promise that failed contributes nothing — it never
 *  contributes a zero, and it never fails the whole section. */
async function settle<T>(task: Promise<T | null>): Promise<T | null> {
  try {
    return await task;
  } catch {
    return null;
  }
}

export class ExternalDerivativesService {
  constructor(
    private readonly binance: BinanceDerivativesService,
    private readonly okx: OkxDerivativesService
  ) {}

  /**
   * Open interest across the venues that answered.
   *
   * The USD total sums only the venues that actually reported a notional.
   * A venue reporting base units but no notional contributes its base
   * figure to the table and nothing to the total — adding it at another
   * venue's price would be inventing a number.
   */
  async getTrackedOpenInterest(baseAsset: string): Promise<Availability<TrackedVenueOpenInterest>> {
    const rows = (
      await Promise.all([
        settle(this.binance.getOpenInterest(baseAsset)),
        settle(this.okx.getOpenInterest(baseAsset)),
      ])
    ).filter((r): r is VenueOpenInterest => r !== null);

    if (rows.length === 0) {
      return unavailable('provider_unavailable', 'No tracked venue returned open interest for this asset.');
    }

    const priced = rows.filter((r) => r.openInterestUsd !== null);
    return available({
      value: {
        baseAsset: baseAsset.toUpperCase(),
        totalOpenInterestUsd: priced.length > 0 ? priced.reduce((sum, r) => sum + (r.openInterestUsd ?? 0), 0) : null,
        venues: rows,
      },
      // A single `source` cannot express two contributors; the real
      // attribution rides in the value's `venues` and in the section meta
      // the snapshot attaches. This one names the lead venue only.
      source: rows[0].venue,
      fetchedAt: oldest(rows),
      stale: rows.some((r) => r.stale),
    });
  }

  /**
   * 24h turnover across the venues that reported a comparable figure.
   *
   * A venue that answered but reports no quote-currency turnover (OKX, at
   * the time of writing — see `OkxDerivativesService`) contributes its row
   * with `turnover24hUsd: null` and nothing to the total, and is NOT
   * listed as a contributor. That distinction is the whole point: "OKX
   * answered but does not publish this" and "OKX is down" are different
   * facts, and neither is zero turnover.
   */
  async getTrackedTurnover24h(baseAsset: string): Promise<Availability<TrackedVenueTurnover>> {
    const rows = (
      await Promise.all([
        settle(this.binance.getTurnover24h(baseAsset)),
        settle(this.okx.getTurnover24h(baseAsset)),
      ])
    ).filter((r): r is VenueTurnover => r !== null);

    if (rows.length === 0) {
      return unavailable('provider_unavailable', 'No tracked venue returned a 24h ticker for this asset.');
    }

    const reporting = rows.filter((r) => r.turnover24hUsd !== null);
    if (reporting.length === 0) {
      // Every venue answered, none of them publishes a comparable
      // turnover. Unavailable, not zero.
      return unavailable('no_data', 'No tracked venue publishes a comparable quote-currency turnover for this asset.');
    }
    return available({
      value: {
        baseAsset: baseAsset.toUpperCase(),
        totalTurnoverUsd: reporting.reduce((sum, r) => sum + (r.turnover24hUsd ?? 0), 0),
        venues: reporting,
      },
      source: reporting[0].venue,
      fetchedAt: oldest(reporting),
      stale: reporting.some((r) => r.stale),
    });
  }

  /** Per-venue funding, side by side. Never averaged: an average of two
   *  venues' funding is not a rate anyone can be charged. */
  async getFundingComparison(baseAsset: string): Promise<Availability<FundingComparison>> {
    const rows = (
      await Promise.all([settle(this.binance.getFunding(baseAsset)), settle(this.okx.getFunding(baseAsset))])
    ).filter((r): r is VenueFunding => r !== null);

    if (rows.length === 0) {
      return unavailable('provider_unavailable', 'No tracked venue returned a funding rate for this asset.');
    }
    return available({
      value: { baseAsset: baseAsset.toUpperCase(), venues: rows },
      source: rows[0].venue,
      fetchedAt: oldest(rows),
      stale: rows.some((r) => r.stale),
    });
  }

  /** Perpetual premium per venue, each against that venue's OWN index. */
  async getBasisComparison(baseAsset: string): Promise<Availability<BasisComparison>> {
    const rows = (
      await Promise.all([settle(this.binance.getBasis(baseAsset)), settle(this.okx.getBasis(baseAsset))])
    ).filter((r): r is VenueBasis => r !== null && (r.markPrice !== null || r.indexPrice !== null));

    if (rows.length === 0) {
      return unavailable('provider_unavailable', 'No tracked venue returned a mark and index price for this asset.');
    }
    return available({
      value: { baseAsset: baseAsset.toUpperCase(), venues: rows },
      source: rows[0].venue,
      fetchedAt: oldest(rows),
      stale: rows.some((r) => r.stale),
    });
  }

  /**
   * Binance positioning, as three separate measures.
   *
   * Binance is the only tracked venue publishing these, so the module is
   * labelled Binance-only rather than presented as cross-venue — and
   * certainly not as "market-wide crypto long/short", which it is not.
   */
  async getPositioning(baseAsset: string): Promise<Availability<PositioningValue>> {
    const kinds: LongShortRatioKind[] = ['global_account', 'top_account', 'top_position'];
    const ratios = (
      await Promise.all(kinds.map((kind) => settle(this.binance.getLongShortRatio(baseAsset, kind))))
    ).filter((r): r is LongShortRatio => r !== null);

    if (ratios.length === 0) {
      return unavailable('provider_unavailable', 'Binance did not return positioning statistics for this asset.');
    }
    return available({
      value: { baseAsset: baseAsset.toUpperCase(), ratios },
      source: 'binance',
      fetchedAt: oldest(ratios),
      stale: ratios.some((r) => r.stale),
    });
  }

  /**
   * The one read the Futures header makes.
   *
   * Turnover and open interest for one asset, in a single call, so the
   * header does not poll the whole Analytics snapshot for two numbers.
   * Both halves come from the SAME per-venue caches every other consumer
   * uses, so this endpoint adds no upstream request of its own.
   *
   * Contributors are reported per metric, because they genuinely differ:
   * OKX contributes open interest but no turnover, so a single combined
   * venue list would misattribute one of the two figures.
   */
  async getFuturesMarketStats(baseAsset: string): Promise<Availability<FuturesMarketStats>> {
    const [turnover, openInterest] = await Promise.all([
      this.getTrackedTurnover24h(baseAsset).catch(() => unavailable('provider_unavailable') as Availability<TrackedVenueTurnover>),
      this.getTrackedOpenInterest(baseAsset).catch(() => unavailable('provider_unavailable') as Availability<TrackedVenueOpenInterest>),
    ]);

    if (!turnover.available && !openInterest.available) {
      return unavailable('provider_unavailable', 'No tracked venue returned derivatives statistics for this asset.');
    }

    // Base units are summed ONLY across venues that reported base units.
    // Binance's openInterest is in base units and OKX's oiCcy is in base
    // currency, so they are directly comparable — no price from either
    // venue is ever applied to the other's quantity.
    const oiVenues = openInterest.available ? openInterest.value.venues : [];
    const baseReporting = oiVenues.filter((v) => v.openInterestBase !== null);
    const usdReporting = oiVenues.filter((v) => v.openInterestUsd !== null);

    const fetchedAt = Math.min(
      turnover.available ? turnover.fetchedAt : Number.POSITIVE_INFINITY,
      openInterest.available ? openInterest.fetchedAt : Number.POSITIVE_INFINITY
    );
    return available({
      value: {
        baseAsset: baseAsset.toUpperCase(),
        turnover24hUsd: turnover.available ? turnover.value.totalTurnoverUsd : null,
        turnoverVenues: turnover.available ? turnover.value.venues.map((v) => v.venue) : [],
        openInterestBase: baseReporting.length > 0 ? baseReporting.reduce((s, v) => s + (v.openInterestBase ?? 0), 0) : null,
        openInterestUsd: usdReporting.length > 0 ? usdReporting.reduce((s, v) => s + (v.openInterestUsd ?? 0), 0) : null,
        openInterestBaseVenues: baseReporting.map((v) => v.venue),
        openInterestUsdVenues: usdReporting.map((v) => v.venue),
      },
      source: (turnover.available ? turnover.source : openInterest.available ? openInterest.source : 'binance') as DerivativesVenue,
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
      stale: (turnover.available && turnover.stale) || (openInterest.available && openInterest.stale),
    });
  }

  /** The venues that contributed to a set of rows, for the section meta. */
  static attributionOf(rows: { venue: DerivativesVenue; contract: string; fetchedAt: number; stale: boolean }[]): VenueAttribution[] {
    return attribution(rows);
  }
}
