/**
 * MANAGED LISTINGS — the shared, IO-free core of the Listing Factory.
 *
 * An admin creates a listing in Admin → Listings; its configuration lives in
 * Cloudflare (the market-edge Durable Object), never in Neon. Everything a
 * listed market shows — metadata, countdown, prelisting → live, candles,
 * display book and tape — is computed on read from ONE published
 * configuration (seed, listing time, initial price) and the server clock, by
 * the same deterministic simulation VTA and NRX use. Nothing is generated in
 * the background and nothing is stored per tick.
 *
 * This module is bundled into the Worker and imported by Render. It must
 * stay free of IO, environment reads and clock reads (callers pass `now`).
 */
import { z } from 'zod';
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';

export const LISTING_QUOTE = 'USDT' as const;
export const LISTING_SCHEMA_VERSION = 1 as const;

/** Tickers a managed listing may never take: settlement/fiat, the built-in test assets and major venue coins. */
export const RESERVED_LISTING_SYMBOLS: ReadonlySet<string> = new Set([
  'USDT', 'USDC', 'USD', 'EUR', 'DAI', 'BUSD', 'TUSD', 'FDUSD',
  'VTA', 'NRX',
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'TON', 'TRX', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'MATIC', 'POL', 'LTC', 'BCH',
  'XAU', 'XAG',
]);

export const LISTING_SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const LISTING_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const LISTING_SEED_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;
/** A decimal string: no exponent, no sign, at most 10 fractional digits. */
const DECIMAL = /^(0|[1-9]\d{0,11})(\.\d{1,10})?$/;
/** Up to 18 integer digits and 8 decimals for a quantity (Spot balance precision). */
const QUANTITY = /^(0|[1-9]\d{0,17})(\.\d{1,8})?$/;
export const LOGO_MAX_BYTES = 64 * 1024;
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
/** The earliest a listing may open after it is first published, and the farthest ahead. */
export const MIN_LEAD_MS = 60_000;
/** A test environment may shorten the lead (never below this) to watch a listing open. */
export const MIN_LEAD_FLOOR_MS = 5_000;
export const MAX_LEAD_MS = 366 * 24 * 60 * 60_000;
export const MAX_INITIAL_PRICE = 1_000_000;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max).refine((v) => !/[\u0000-\u001f\u007f<>]/.test(v), 'invalid characters');

/** What an admin edits. `seed` is fixed once generated; see `withStableSeed`. */
export const listingConfigSchema = z.object({
  schemaVersion: z.literal(LISTING_SCHEMA_VERSION),
  symbol: z.string().trim().toUpperCase().regex(LISTING_SYMBOL_PATTERN, 'ticker: 2–10 latin letters/digits, starting with a letter'),
  name: trimmed(2, 40),
  /** A small inline image. `null` falls back to the generic coin mark. */
  logo: z.string().max(Math.ceil(LOGO_MAX_BYTES * 4 / 3) + 64).regex(LOGO_DATA_URL, 'logo must be a PNG, JPEG, WebP or SVG data URL').nullable(),
  initialPrice: z.string().regex(DECIMAL, 'initial price: a plain decimal with at most 10 decimals')
    .refine((v) => Number(v) > 0 && Number(v) <= MAX_INITIAL_PRICE, `initial price must be > 0 and ≤ ${MAX_INITIAL_PRICE}`),
  /** UTC instant of the first simulated tick, ISO-8601 with an explicit `Z`. */
  listingAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/, 'listing time must be an ISO UTC instant')
    .refine((v) => Number.isFinite(Date.parse(v)), 'invalid listing time'),
  /** How the admin saw and entered the time. Display only; `listingAt` is the instant. */
  displayTimeZone: z.string().min(1).max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/, 'invalid time zone'),
  /** Owner inventory to allocate LATER, in a separate audited step. Never credited by create/preview/publish. */
  ownerAllocation: z.string().regex(QUANTITY, 'owner allocation: a plain quantity with at most 8 decimals'),
  seedMode: z.enum(['auto', 'manual']),
  seed: z.string().regex(LISTING_SEED_PATTERN, 'seed: 8–64 lowercase letters, digits or hyphens'),
  /** After listing, ordinary Spot orders may be placed (matched only against real resting orders). */
  tradable: z.boolean(),
}).strict();

export type ListingConfig = z.infer<typeof listingConfigSchema>;

export class ListingValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const listingPair = (symbol: string) => `${symbol.toUpperCase()}/${LISTING_QUOTE}`;
export const listingSlug = (symbol: string) => `${symbol.toUpperCase()}-${LISTING_QUOTE}`;

/** Byte size of a base64 data URL payload. */
export function logoBytes(logo: string | null): number {
  if (!logo) return 0;
  const payload = logo.slice(logo.indexOf(',') + 1);
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}

/**
 * Parse and check one configuration on its own: shape, reserved tickers and
 * logo size. Uniqueness is checked by the store (atomically) and dates by
 * `checkPublishable` (they depend on `now`).
 */
export function parseListingConfig(input: unknown): ListingConfig {
  const parsed = listingConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ListingValidationError('INVALID_CONFIG', `${issue.path.join('.') || 'config'}: ${issue.message}`);
  }
  const config = parsed.data;
  if (RESERVED_LISTING_SYMBOLS.has(config.symbol)) throw new ListingValidationError('RESERVED_TICKER', `Ticker ${config.symbol} is reserved`);
  if (logoBytes(config.logo) > LOGO_MAX_BYTES) throw new ListingValidationError('LOGO_TOO_LARGE', `Logo must be at most ${LOGO_MAX_BYTES / 1024} KB`);
  return config;
}

/**
 * A new automatic seed: readable, unique enough, and — once saved — never
 * regenerated. `random` is injected so the store and tests stay deterministic.
 */
export function generateSeed(symbol: string, listingAt: string, random: () => string): string {
  const day = listingAt.slice(0, 10).replace(/-/g, '');
  return `${symbol.toLowerCase()}-${day}-${random().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}`.slice(0, 64);
}

/**
 * Seed stability. An auto seed that already exists is kept as is on every
 * later save, even if the ticker or date changes; switching to manual keeps
 * the admin's value; switching back to auto keeps the current seed.
 */
export function withStableSeed(next: ListingConfig, previous: ListingConfig | null): ListingConfig {
  if (next.seedMode === 'auto' && previous) return { ...next, seed: previous.seed };
  return next;
}

/**
 * Rules for publishing `next` over the currently active version, at server
 * time `now`. They protect the past: once a market has history, nothing that
 * shapes that history can change.
 */
export function checkPublishable(next: ListingConfig, active: ListingConfig | null, now: number, minLeadMs = MIN_LEAD_MS): void {
  const at = Date.parse(next.listingAt);
  if (!active) {
    if (at < now + minLeadMs) throw new ListingValidationError('LISTING_TIME_PAST', 'The listing time must be at least one minute in the future');
    if (at > now + MAX_LEAD_MS) throw new ListingValidationError('LISTING_TIME_TOO_FAR', 'The listing time must be within one year');
    return;
  }
  if (next.symbol !== active.symbol) throw new ListingValidationError('TICKER_LOCKED', 'The ticker of a published listing cannot change');
  if (next.seed !== active.seed) throw new ListingValidationError('HISTORY_LOCKED', 'The seed of a published listing cannot change');
  if (next.initialPrice !== active.initialPrice) throw new ListingValidationError('HISTORY_LOCKED', 'The initial price of a published listing cannot change');
  if (next.listingAt !== active.listingAt) {
    const activeAt = Date.parse(active.listingAt);
    // Moving the date is a postponement or an earlier opening of a market that has not opened yet.
    if (activeAt <= now) throw new ListingValidationError('HISTORY_LOCKED', 'The listing already opened; its time cannot change');
    if (at < now + minLeadMs) throw new ListingValidationError('LISTING_TIME_PAST', 'The new listing time must be at least one minute in the future');
    if (at > now + MAX_LEAD_MS) throw new ListingValidationError('LISTING_TIME_TOO_FAR', 'The listing time must be within one year');
  }
}

/** The simulation input for a configuration. Same seed, time and price → same market, everywhere. */
export function listingSimulationConfig(config: ListingConfig): TestAssetConfig {
  return {
    symbol: config.symbol,
    name: config.name,
    quote: LISTING_QUOTE,
    pair: listingPair(config.symbol),
    isTestAsset: true,
    isTradable: config.tradable,
    listingArmed: true,
    listingAt: Date.parse(config.listingAt),
    initialPrice: Number(config.initialPrice),
    seed: config.seed,
  };
}

/** A published listing as the public catalogue carries it: no owner allocation, no seed mode. */
export interface PublishedListing {
  id: string;
  version: number;
  publishedAt: string;
  config: ListingConfig;
}

export const publishedListingSchema = z.object({
  id: z.string().regex(LISTING_ID_PATTERN),
  version: z.number().int().positive(),
  publishedAt: z.string(),
  config: listingConfigSchema,
}).strict();
