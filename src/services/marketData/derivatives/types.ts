/**
 * The vocabulary for EXTERNAL derivatives reference data.
 *
 * Every type here describes somebody else's venue. None of it is VOLTEX
 * financial state, and none of it may ever stand in for VOLTEX's own mark
 * price, index price, funding settlement, margin or liquidation — see
 * `docs/MARKET_DATA_ARCHITECTURE.md` §15 and the separation tests.
 *
 * ── Why attribution is a list, not a string ─────────────────────────
 *
 * A single `source: DataSource` works when exactly one provider answers a
 * question. It stops working the moment two venues contribute to one
 * figure, because the interesting failure is PARTIAL: Binance answers, OKX
 * does not. Reporting that as `source: 'binance'` loses the fact that a
 * second venue was asked; reporting it as "Binance + OKX" is worse, since
 * it claims a contribution that did not happen.
 *
 * So every multi-venue value carries `sources: VenueAttribution[]`
 * containing exactly the venues that actually produced the number, each
 * with its own fetch time and staleness. The UI's label is derived from
 * that list rather than written by hand, which is what makes it impossible
 * for the label to outlive the contribution.
 */

/** External derivatives venues this system reads. Deliberately narrow. */
export type DerivativesVenue = 'binance' | 'okx';

export interface VenueAttribution {
  venue: DerivativesVenue;
  /** The venue's contract identifier, so a reader can check the figure. */
  contract: string;
  fetchedAt: number;
  stale: boolean;
}

/**
 * One venue's open interest for one contract.
 *
 * `openInterestBase` is in units of the base asset; `openInterestUsd` is
 * notional. Either may be `null` when the venue did not report it — a
 * missing USD notional is NOT zero notional, and nothing here multiplies
 * by a price the venue did not give us in order to invent one.
 */
export interface VenueOpenInterest {
  venue: DerivativesVenue;
  contract: string;
  baseAsset: string;
  openInterestBase: number | null;
  openInterestUsd: number | null;
  fetchedAt: number;
  stale: boolean;
}

/**
 * Tracked-venue open interest.
 *
 * Deliberately NOT called market-wide. It is the sum over the venues that
 * answered, and `venues` names them. Binance plus OKX is a large share of
 * perpetual open interest and is not the whole market; presenting it as
 * such would be a fabricated aggregate.
 */
export interface TrackedVenueOpenInterest {
  baseAsset: string;
  /** Present only when at least one venue reported a USD notional. */
  totalOpenInterestUsd: number | null;
  /** Contributing venues, in the order they are displayed. */
  venues: VenueOpenInterest[];
}

export interface VenueFunding {
  venue: DerivativesVenue;
  contract: string;
  /** A fraction, not a percentage. A real 0 is a real 0 — a venue whose
   *  current rate is exactly flat is a fact, and it is not the same as a
   *  venue that did not report. */
  fundingRate: number | null;
  /** Epoch ms of the next settlement, when the venue publishes one. */
  nextFundingTime: number | null;
  /** The venue's settlement cadence in hours, when it is derivable from
   *  the response without assuming a convention. */
  intervalHours: number | null;
  fetchedAt: number;
  stale: boolean;
}

/**
 * Binance publishes three different positioning ratios and they mean
 * three different things. Collapsing them into one "long/short ratio"
 * would be the single easiest way to publish a wrong number on this page,
 * so the definition travels with the value.
 */
export type LongShortRatioKind =
  /** Share of ALL accounts holding a long vs a short position. */
  | 'global_account'
  /** Share of TOP accounts (by margin balance) holding long vs short. */
  | 'top_account'
  /** Share of TOP accounts' POSITION VALUE that is long vs short. This is
   *  a size-weighted measure, not an account count. */
  | 'top_position';

export interface LongShortRatio {
  venue: DerivativesVenue;
  contract: string;
  kind: LongShortRatioKind;
  /** Proportions in [0,1] as the venue reports them. */
  longAccount: number | null;
  shortAccount: number | null;
  longShortRatio: number | null;
  /** The sampling period the venue aggregated over, e.g. "5m". */
  period: string;
  /** The venue's own timestamp for the sample. */
  observedAt: number | null;
  fetchedAt: number;
  stale: boolean;
}

/**
 * Perpetual premium / basis for one venue's contract.
 *
 * `basisPercent = (mark - index) / index * 100`, computed here and stated
 * in the payload so a reader never has to guess the convention. It is NOT
 * a futures term structure: that needs dated contracts, and these are
 * perpetuals.
 */
export interface VenueBasis {
  venue: DerivativesVenue;
  contract: string;
  markPrice: number | null;
  indexPrice: number | null;
  /** Null unless BOTH prices are present and the index is non-zero. */
  basisPercent: number | null;
  fetchedAt: number;
  stale: boolean;
}

/** A value assembled from more than one venue, carrying exactly the
 *  venues that contributed to it. */
export interface MultiVenue<T> {
  value: T;
  sources: VenueAttribution[];
}

/** Finite-number coercion for provider payloads. `null` for anything that
 *  is not a real number — never 0, which would be a claim. */
export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
