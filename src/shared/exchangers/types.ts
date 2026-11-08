/**
 * «Обменники» (/exchangers, issue #694) — the public API contract shared by the
 * Express router (src/routes) and the React page (frontend/src/pages).
 *
 * Pure types plus the BestChange marks list. No runtime dependencies, no I/O.
 * The exact JSON shapes are documented in docs/EXCHANGERS_694.md ("API contract").
 */

/** How a RUB payment method is presented. */
export type MethodKind = 'payment_system' | 'bank' | 'card';

export type AssetId = 'USDT' | 'BTC' | 'ETH' | 'TRX' | 'TON' | 'USDC' | 'LTC' | 'SOL';

export type NetworkId = 'tron' | 'ethereum' | 'bsc' | 'ton' | 'bitcoin' | 'litecoin' | 'solana';

/**
 * Feature flags BestChange documents for a rate row (`marks[]`). Unknown values
 * coming from the API are dropped, never passed through.
 */
export const OFFER_MARKS = [
  'card2card',
  'cardverify',
  'delay',
  'delivery',
  'floating',
  'manual',
  'more',
  'official',
  'otherin',
  'otherout',
  'percent',
  'purse',
  'reg',
  'unstable',
  'verifying',
  'atm',
  'language',
] as const;

export type OfferMark = (typeof OFFER_MARKS)[number];

export function isOfferMark(value: unknown): value is OfferMark {
  return typeof value === 'string' && (OFFER_MARKS as readonly string[]).includes(value);
}

/** Snapshot state shared by both endpoints. */
export type ExchangersStatus = 'ok' | 'not_configured' | 'unavailable';

// ---------------------------------------------------------------------------
// Non-OK bodies (both endpoints)
// ---------------------------------------------------------------------------

/** HTTP 200 — the server has no BestChange API key. The page says so honestly. */
export interface ExchangersNotConfiguredResponse {
  status: 'not_configured';
}

/** HTTP 503 — upstream failed and no usable (≤ 5 min) snapshot exists. */
export interface ExchangersUnavailableResponse {
  status: 'unavailable';
  /** Seconds. */
  retryAfter: number;
}

/** HTTP 400 — the query failed validation. */
export interface ExchangersInvalidResponse {
  status: 'invalid';
}

/** HTTP 429 — route limiter. */
export interface ExchangersRateLimitedResponse {
  status: 'rate_limited';
  /** Seconds. */
  retryAfter: number;
}

export type ExchangersErrorResponse =
  | ExchangersNotConfiguredResponse
  | ExchangersUnavailableResponse
  | ExchangersInvalidResponse
  | ExchangersRateLimitedResponse;

// ---------------------------------------------------------------------------
// GET /api/v1/exchangers/directory
// ---------------------------------------------------------------------------

export interface DirectoryMethod {
  /** A fixed id from RUB_METHODS (e.g. "sbp") or `bc-<urlname>` for a dynamic extra. */
  id: string;
  label: string;
  kind: MethodKind;
  /** At least one rate row exists for this method towards a supported asset/network. */
  available: boolean;
}

export interface DirectoryAsset {
  assetId: AssetId;
  networkId: NetworkId;
  available: boolean;
}

export interface DirectoryOkResponse {
  status: 'ok';
  /** ISO-8601 time of the snapshot, or null when unknown. */
  asOf: string | null;
  methods: DirectoryMethod[];
  assets: DirectoryAsset[];
}

export type DirectoryResponse = DirectoryOkResponse | ExchangersErrorResponse;

// ---------------------------------------------------------------------------
// GET /api/v1/exchangers/offers?method=&asset=&network=&amount=
// ---------------------------------------------------------------------------

export interface OffersQuery {
  method: string;
  asset: AssetId;
  network: NetworkId;
  /** RUB, 1 ≤ amount ≤ 100 000 000. */
  amount: number;
}

/** Review counters exactly as BestChange groups them. */
export interface ExchangerReviews {
  positive: number;
  neutral: number;
  claim: number;
  closed: number;
}

export interface OfferExchanger {
  id: number;
  name: string;
  rating: number | null;
  reviews: ExchangerReviews | null;
}

/** A validated `https://(www.)bestchange.(ru|com)/click.php?id=<changer>` link. */
export interface OfferLink {
  kind: 'exchanger';
  url: string;
}

/** A validated `https://www.bestchange.ru/{from}-to-{to}.html[?p=<partner>]` link. */
export interface DirectionLink {
  url: string;
}

/**
 * One exchanger's offer. Every optional fact is `null` when BestChange did not
 * supply it; `null` means "unknown" and is never shown or compared as zero.
 */
export interface Offer {
  /** Decimal changer id as a string (stable React key). */
  id: string;
  exchanger: OfferExchanger;
  /** RUB paid per 1 unit of the received asset (normalised `rate`). */
  rubPerUnit: number;
  /** Normalised `rankrate` (rate incl. extra commissions for a $300 exchange). */
  rankRubPerUnit: number | null;
  /** Estimated units received for `query.amount`, before network fees. */
  receiveAmount: number | null;
  minRub: number | null;
  maxRub: number | null;
  /** Reserve in units of the received asset. */
  reserve: number | null;
  marks: OfferMark[];
  /** Whether `query.amount` is within [minRub, maxRub]; null when limits are unknown. */
  fitsAmount: boolean | null;
  link: OfferLink | null;
}

export interface OffersOkResponse {
  status: 'ok';
  asOf: string | null;
  /** True when served from a snapshot older than the TTL (≤ 5 min). */
  stale: boolean;
  query: OffersQuery;
  directionLink: DirectionLink | null;
  offers: Offer[];
}

export type OffersResponse = OffersOkResponse | ExchangersErrorResponse;

// ---------------------------------------------------------------------------
// Minimal shape of a BestChange `currencies[]` item used by the resolvers in
// catalog.ts. The server validates the raw JSON into this shape first.
// ---------------------------------------------------------------------------

export interface BestChangeCurrencyLike {
  id: number;
  name: string;
  urlname: string;
  code: string;
  crypto: boolean;
  cash: boolean;
}
