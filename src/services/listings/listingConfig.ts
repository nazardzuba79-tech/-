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
import { isHistory20PrivateSymbol, SIMULATION_QUOTE } from '../../shared/history20PrivateSymbol';
import { SIMULATION_PROFILES, profileForOrdinal } from '../testMarkets/simulationRealism';
import { LISTING_SCENARIOS, normalizeScenarioDecimal, validateScenarioControls } from '../../shared/listingScenarioControls';
import { historicalSerializedBytes, freezeHistoricalMoveProgram } from '../../shared/listingHistoricalReplay';
import { HISTORICAL_GROWTH_LICENSES, HISTORICAL_GROWTH_PROVIDERS, validateHistoricalGrowthProgram } from '../../shared/listingHistoricalGrowth';
import { HISTORICAL_DEMO_NO_LEDGER, isHistoricalDemoConfig } from './simulationContour';

export const LISTING_QUOTE = 'USDT' as const;
/** Upper bound of one account's one-time private test funding, per asset. */
export const MAX_PRIVATE_TEST_FUNDING = 1_000_000;
export const LISTING_SCHEMA_VERSION = 1 as const;

/** Tickers a managed listing may never take: settlement/fiat, the built-in test assets and major venue coins. */
export const RESERVED_LISTING_SYMBOLS: ReadonlySet<string> = new Set([
  'USDT', 'USDC', 'USD', 'EUR', 'DAI', 'BUSD', 'TUSD', 'FDUSD',
  // The restricted settlement unit of History20 private tests.
  'SIMUSDT',
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
const scenarioDecimal = z.string().trim().regex(/^\d{1,12}(?:[.,]\d{1,10})?$/, 'Введите число, не более 10 знаков после запятой').transform(normalizeScenarioDecimal);
const frequency = z.enum(['rare', 'moderate', 'often']);
/** voltex.historical-growth.v1: the growth window that replaces the stages (listingHistoricalGrowth.ts). */
export const historicalGrowthSchema = z.object({
  format: z.literal('voltex.historical-growth.v1'),
  scenarioId: z.string().regex(/^VHX-\d{2}-[A-Z0-9]{2,10}$/),
  scenarioVersion: z.literal(1),
  source: z.object({
    provider: z.enum(HISTORICAL_GROWTH_PROVIDERS),
    asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
    quote: z.enum(['USD', 'USDT']),
    metric: z.enum(['PriceUSD', 'spot daily OHLCV']),
    dataKind: z.enum(['daily_reference', 'exchange_ohlcv']),
    timeframe: z.literal('1d'),
    firstDate: z.string().max(10),
    lastDate: z.string().max(10),
    sliceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    license: z.enum(HISTORICAL_GROWTH_LICENSES),
  }).strict(),
  rights: z.literal('HISTORICAL_RIGHTS_UNVERIFIED'),
  clock: z.object({ mode: z.literal('REAL_TIME'), sourceStepSeconds: z.literal(86400), scenarioStepSeconds: z.literal(86400) }).strict(),
  targetPeakGrowthPercent: z.string().max(8),
  targetNormalization: z.object({ version: z.literal(1), method: z.literal('LOG_AMPLITUDE_OWNER_CAP'),
    sourceTargetPeakGrowthPercent: z.literal('15324'), maxTargetPeakGrowthPercent: z.literal('15000') }).strict().optional(),
  intrabar: z.enum(['LOG_LINEAR_REFERENCE_V1', 'SEEDED_OHLC_PATH_V1', 'SEEDED_BRIDGE_REFERENCE_V2', 'SEEDED_BRIDGE_OHLC_V2']),
  logs: z.array(z.array(z.number().int()).min(1).max(4)).min(30).max(1500),
  logsSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const scenarioControlsSchema = z.object({
  kind: z.literal('scenario-controls-v2'),
  scenario: z.enum(['AUTO', ...LISTING_SCENARIOS]),
  first24hGainPercent: scenarioDecimal,
  maxPrice: scenarioDecimal,
  stages: z.array(z.object({
    type: z.enum(['growth', 'range', 'pullback', 'recovery']),
    durationHours: z.number().int().min(1).max(720),
    targetPrice: scenarioDecimal,
  // Empty only in the historical growth window, where it replaces the stages (validateScenarioControls).
  }).strict()).min(0).max(24),
  afterGrowth: z.enum(['range', 'historical']),
  historical: z.object({
    version: z.literal(1),
    clips: z.array(z.object({
      source: z.enum(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']),
      sourceStart: z.string().max(30),
      resolution: z.literal('1h'),
      provenance: z.literal('USER_SUPPLIED_UNVERIFIED'),
      bars: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])).min(24).max(2400),
    }).strict()).min(1).max(3),
  }).strict().optional(),
  growth: z.literal('historical-window').optional(),
  historicalGrowth: historicalGrowthSchema.optional(),
  pullbacks: z.object({ frequency, minDepthPercent: scenarioDecimal.refine(v => Number(v) <= 60, 'Глубина отката должна быть не выше 60%'), maxDepthPercent: scenarioDecimal.refine(v => Number(v) <= 60, 'Глубина отката должна быть не выше 60%'), durationMinutes: z.number().int().min(5).max(360) }).strict(),
  candles: z.object({ intensity: z.enum(['low', 'medium', 'high']), diversity: z.number().min(0).max(1), pauseFrequency: frequency }).strict(),
  wicks: z.object({ length: z.enum(['short', 'normal', 'pronounced']), longFrequency: frequency }).strict(),
}).strict();

/** What an admin edits. `seed` is fixed once generated; see `withStableSeed`. */
export const listingConfigSchema = z.object({
  schemaVersion: z.literal(LISTING_SCHEMA_VERSION),
  symbol: z.string().trim().toUpperCase().regex(LISTING_SYMBOL_PATTERN, 'ticker: 2–10 latin letters/digits, starting with a letter'),
  name: trimmed(2, 40),
  /** A small inline image. `null` falls back to the generic coin mark. */
  logo: z.string().max(Math.ceil(LOGO_MAX_BYTES * 4 / 3) + 64).regex(LOGO_DATA_URL, 'logo must be a PNG, JPEG, WebP or SVG data URL').nullable(),
  initialPrice: z.preprocess(value => typeof value === 'string' ? value.trim().replace(',', '.') : value, z.string().regex(DECIMAL, 'initial price: a plain decimal with at most 10 decimals')
    .refine((v) => Number(v) > 0 && Number(v) <= MAX_INITIAL_PRICE, `initial price must be > 0 and ≤ ${MAX_INITIAL_PRICE}`)),
  /** UTC instant of the first simulated tick, ISO-8601 with an explicit `Z`. */
  listingAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/, 'listing time must be an ISO UTC instant')
    .refine((v) => {
      const instant = Date.parse(v);
      return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 16) === v.slice(0, 16);
    }, 'invalid listing time'),
  /** How the admin saw and entered the time. Display only; `listingAt` is the instant. */
  displayTimeZone: z.string().min(1).max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/, 'invalid time zone')
    .refine((timeZone) => {
      try { new Intl.DateTimeFormat('en', { timeZone }).format(0); return true; }
      catch { return false; }
    }, 'invalid time zone'),
  /** Owner inventory to allocate LATER, in a separate audited step. Never credited by create/preview/publish. */
  ownerAllocation: z.string().regex(QUANTITY, 'owner allocation: a plain quantity with at most 8 decimals'),
  seedMode: z.enum(['auto', 'manual']),
  seed: z.string().regex(LISTING_SEED_PATTERN, 'seed: 8–64 lowercase letters, digits or hyphens'),
  /** After listing, ordinary Spot orders may be placed (matched only against real resting orders). */
  tradable: z.boolean(),
  /**
   * Candle character, assigned by the store when the listing is created
   * (`withStableProfile`) and never changed afterwards. Absent on listings
   * created before profiles existed: they keep the original candles.
   */
  simulationProfile: z.enum(SIMULATION_PROFILES).optional(),
  /** Persisted range model assigned on new INSERT; absent means the original shadows. */
  wickModel: z.literal('NATURAL_V1').optional(),
  /**
   * History20 private test (owner decision 2026-10-19): only a History20
   * growth window with a reserved ticker (VHX01…VHX99) may carry it. It is
   * quoted and settled in the restricted SIMUSDT unit, traded only by the
   * verified owner and the allowlisted testers (privateTest.isPrivateTestParticipant),
   * kept out of every public catalogue and route, and funded only by the
   * explicit one-time `funding` per account (privateTestFunding.ts). It cannot
   * be added, removed or changed once the private test has started.
   */
  privateTest: z.object({
    settlement: z.literal(SIMULATION_QUOTE),
    funding: z.object({
      base: z.string().regex(QUANTITY, 'funding: a plain quantity with at most 8 decimals'),
      quote: z.string().regex(QUANTITY, 'funding: a plain quantity with at most 8 decimals'),
    }).strict(),
  }).strict().optional(),
  /** Optional immutable bounded lifecycle; only non-executable demo listings. */
  simulationProgram: z.union([z.object({
    kind: z.literal('capped-growth-range-v1'),
    first24hGainPercent: z.number().finite().positive().max(100000),
    maxGainPercent: z.number().finite().positive().max(100000),
    peakAfterHours: z.number().int().min(48).max(720),
    rangeFraction: z.number().min(.02).max(.3),
  }).strict().refine(p => p.maxGainPercent * .94 > p.first24hGainPercent, 'cap must exceed day-one target'), scenarioControlsSchema]).optional(),
}).strict();

export type ListingConfig = z.infer<typeof listingConfigSchema>;

export class ListingValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const listingPair = (symbol: string, quote: string = LISTING_QUOTE) => `${symbol.toUpperCase()}/${quote}`;
export const listingSlug = (symbol: string, quote: string = LISTING_QUOTE) => `${symbol.toUpperCase()}-${quote}`;
/** The quote a configuration trades in: SIMUSDT for a History20 private test, USDT otherwise. */
export const listingQuote = (config: Pick<ListingConfig, 'privateTest'>) => config.privateTest ? SIMULATION_QUOTE : LISTING_QUOTE;

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
  if (config.simulationProgram?.kind === 'scenario-controls-v2') {
    if (Date.parse(config.listingAt) % 10_000 !== 0) throw new ListingValidationError('INVALID_SCENARIO', 'Время запуска должно совпадать с границей 10 секунд');
    if ((config.simulationProgram.afterGrowth === 'historical' || config.simulationProgram.growth === 'historical-window')
        && historicalSerializedBytes(config) > 80 * 1024)
      throw new ListingValidationError('HISTORICAL_DATA_TOO_LARGE', 'Файл движения слишком большой для сохранения в листинге (80 КБ с логотипом)');
    try {
      // The window's stored logs must match their checksum before any simulation reads them.
      if (config.simulationProgram.historicalGrowth) validateHistoricalGrowthProgram(config.simulationProgram.historicalGrowth);
      validateScenarioControls(config.simulationProgram, config.initialPrice);
    }
    catch (error) { throw new ListingValidationError('INVALID_SCENARIO', error instanceof Error ? error.message : 'Проверьте настройки движения цены'); }
  }
  if (config.simulationProgram && config.tradable) throw new ListingValidationError('DEMO_ONLY', 'Bounded scenarios require a non-tradable demo listing');
  if (config.privateTest) {
    if (!isHistoricalGrowthWindowConfig(config))
      throw new ListingValidationError('PRIVATE_TEST_WINDOW_ONLY', 'Приватный тест доступен только для листинга с историческим окном роста (History20)');
    if (!isHistory20PrivateSymbol(config.symbol)) throw new ListingValidationError('PRIVATE_TEST_SYMBOL', PRIVATE_TEST_SYMBOL_MESSAGE);
    // One funding path only: the explicit one-time test funding, never the owner allocation.
    if (Number(config.ownerAllocation) !== 0)
      throw new ListingValidationError('PRIVATE_TEST_FUNDING_ONLY', 'Приватный тест пополняется только разовым тестовым финансированием: распределение владельцу должно быть 0');
    const { base, quote } = config.privateTest.funding;
    if (Number(base) > MAX_PRIVATE_TEST_FUNDING || Number(quote) > MAX_PRIVATE_TEST_FUNDING)
      throw new ListingValidationError('PRIVATE_TEST_FUNDING_BOUND', `Тестовое финансирование: не более ${MAX_PRIVATE_TEST_FUNDING} на актив`);
    if (Number(base) === 0 && Number(quote) === 0)
      throw new ListingValidationError('PRIVATE_TEST_FUNDING_BOUND', 'Тестовое финансирование: укажите количество актива или SIMUSDT');
  }
  // The historical demo contour has no real inventory to allocate (simulationContour).
  if (isHistoricalDemoConfig(config) && Number(config.ownerAllocation) !== 0)
    throw new ListingValidationError(HISTORICAL_DEMO_NO_LEDGER, 'Историческая симуляция не выдаёт актив: распределение владельцу должно быть 0');
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
 * Profile stability. A new listing takes the profile of its creation
 * ordinal (#1 CALM_TREND, #2 IMPULSE_TREND, #3 PULLBACK_TREND,
 * #4 COMPRESSION_BREAKOUT, #5 CALM_TREND…); every later save keeps the
 * stored profile and wick model, whatever the request carried. A listing
 * stored without either field keeps that absence and its original candles.
 */
export function withStableProfile(next: ListingConfig, previous: ListingConfig | null, creationOrdinal: number | null): ListingConfig {
  const { simulationProfile: _requested, wickModel: _requestedWicks, simulationProgram: requestedProgram, ...rest } = next;
  if (previous?.simulationProgram && next.tradable) throw new ListingValidationError('DEMO_ONLY', 'A bounded demo cannot enable real trading');
  if (previous?.simulationProgram?.kind === 'scenario-controls-v2' && requestedProgram?.kind !== 'scenario-controls-v2') throw new ListingValidationError('HISTORY_LOCKED', 'Нельзя удалить сохранённые настройки движения цены');
  if (previous?.simulationProgram?.kind === 'capped-growth-range-v1' && requestedProgram?.kind === 'scenario-controls-v2') throw new ListingValidationError('HISTORY_LOCKED', 'Прежний сценарий нельзя заменить новой версией');
  const v2 = requestedProgram?.kind === 'scenario-controls-v2' ? {
    ...requestedProgram,
    scenario: requestedProgram.scenario === 'AUTO' ? LISTING_SCENARIOS[Array.from(next.seed).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % LISTING_SCENARIOS.length] : requestedProgram.scenario,
  } : undefined;
  if (previous) return { ...rest,
    ...(previous.simulationProfile ? { simulationProfile: previous.simulationProfile } : {}),
    ...(previous.wickModel ? { wickModel: previous.wickModel } : {}),
    ...(v2 ? { simulationProgram: v2 } : previous.simulationProgram ? { simulationProgram: previous.simulationProgram } : {}),
  };
  const created = { ...rest, ...(v2 ? { simulationProgram: v2 } : requestedProgram ? { simulationProgram: requestedProgram } : {}) };
  return creationOrdinal === null ? created : { ...created, simulationProfile: profileForOrdinal(creationOrdinal), wickModel: 'NATURAL_V1' };
}

/** A History20 growth window (`growth: 'historical-window'`): the price path of an ordinary scenario listing. */
export function isHistoricalGrowthWindowConfig(config: Pick<ListingConfig, 'simulationProgram'>): boolean {
  const program = config.simulationProgram;
  return program?.kind === 'scenario-controls-v2' && program.growth === 'historical-window';
}

/**
 * Rules for the PRIVATE TEST of a History20 growth window (owner decision,
 * 2026-10-19, PR #544): the verified owner and the allowlisted testers only,
 * quoted in the non-withdrawable SIMUSDT unit (privateTest.ts). It is not a
 * publication: the public catalogue and edge never serve it, and
 * `checkPublishable` still refuses every public listing of a window with
 * HISTORICAL_RIGHTS_UNVERIFIED. Once a private test starts, its history is
 * locked exactly as a published market's is.
 */
export const PRIVATE_TEST_SYMBOL_MESSAGE = 'Приватный тест History20 доступен только для тикеров VHX01–VHX99';

export function checkPrivateTestable(next: ListingConfig, active: ListingConfig | null, now: number, minLeadMs = MIN_LEAD_MS,
  opened: boolean = active !== null && Date.parse(active.listingAt) <= now): void {
  if (!isHistoricalGrowthWindowConfig(next)) {
    throw new ListingValidationError('PRIVATE_TEST_WINDOW_ONLY', 'Приватный тест доступен только для листинга с историческим окном роста (History20)');
  }
  // A reserved ticker stays restricted by every guard even when the registry does not know the listing.
  if (!isHistory20PrivateSymbol(next.symbol)) throw new ListingValidationError('PRIVATE_TEST_SYMBOL', PRIVATE_TEST_SYMBOL_MESSAGE);
  // A replayed historical move after the window has no private exception.
  if (next.simulationProgram?.kind === 'scenario-controls-v2' && next.simulationProgram.afterGrowth === 'historical')
    throw new ListingValidationError('HISTORICAL_RIGHTS_UNVERIFIED',
      'Историческое движение доступно для сохранённого черновика и приватного предпросмотра. Публикация запрещена до проверки прав на данные и изоляции торговли.');
  checkHistoryLocks(next, active, now, minLeadMs, opened);
}

/**
 * Rules for publishing `next` over the currently active version, at server
 * time `now`. They protect the past: once a market has history, nothing that
 * shapes that history can change.
 */
export function checkPublishable(next: ListingConfig, active: ListingConfig | null, now: number, minLeadMs = MIN_LEAD_MS,
  // Whether the active market opened (public history exists). A listing whose timer never ran past its date did not.
  opened: boolean = active !== null && Date.parse(active.listingAt) <= now): void {
  // The one exception to the rights gate below: a History20 window run as a
  // private test (SIMUSDT, owner and allowlisted testers, never public).
  if (next.privateTest) return checkPrivateTestable(next, active, now, minLeadMs, opened);
  // Administrative draft+private preview are functional, but a user-provided
  // historical dataset has no independently verified redistribution rights.
  // Never publish it to a market whose synthetic reference can affect Spot.
  // A future license-approved rollout must explicitly replace this gate
  // after legal review, isolated paper accounting and full QA.
  if (next.simulationProgram?.kind === 'scenario-controls-v2'
      && (next.simulationProgram.afterGrowth === 'historical' || next.simulationProgram.growth === 'historical-window'))
    throw new ListingValidationError('HISTORICAL_RIGHTS_UNVERIFIED',
      'Историческое движение доступно для сохранённого черновика и приватного предпросмотра. Публикация запрещена до проверки прав на данные и изоляции торговли.');
  // A reserved History20 private ticker is never published as an ordinary listing.
  if (isHistory20PrivateSymbol(next.symbol)) throw new ListingValidationError('RESERVED_TICKER', `Ticker ${next.symbol} is reserved for History20 private tests`);
  checkHistoryLocks(next, active, now, minLeadMs, opened);
}

/** What once-live history forbids, for a public publication and a private test alike. */
function checkHistoryLocks(next: ListingConfig, active: ListingConfig | null, now: number, minLeadMs: number, opened: boolean): void {
  // Private stays private, public stays public, and the test funding is fixed once live.
  if (active && JSON.stringify(next.privateTest ?? null) !== JSON.stringify(active.privateTest ?? null))
    throw new ListingValidationError('HISTORY_LOCKED', 'Режим приватного теста опубликованного листинга изменить нельзя');
  const at = Date.parse(next.listingAt);
  if (!active) {
    if (at < now + minLeadMs) throw new ListingValidationError('LISTING_TIME_PAST', 'The listing time must be at least one minute in the future');
    if (at > now + MAX_LEAD_MS) throw new ListingValidationError('LISTING_TIME_TOO_FAR', 'The listing time must be within one year');
    return;
  }
  if (next.symbol !== active.symbol) throw new ListingValidationError('TICKER_LOCKED', 'The ticker of a published listing cannot change');
  if (next.seed !== active.seed) throw new ListingValidationError('HISTORY_LOCKED', 'The seed of a published listing cannot change');
  if (next.initialPrice !== active.initialPrice) throw new ListingValidationError('HISTORY_LOCKED', 'The initial price of a published listing cannot change');
  if (next.simulationProfile !== active.simulationProfile) throw new ListingValidationError('HISTORY_LOCKED', 'The simulation profile of a published listing cannot change');
  if (next.wickModel !== active.wickModel) throw new ListingValidationError('HISTORY_LOCKED', 'The wick model of a published listing cannot change');
  if (JSON.stringify(next.simulationProgram) !== JSON.stringify(active.simulationProgram)) throw new ListingValidationError('HISTORY_LOCKED', 'The bounded program of a published listing cannot change');
  if (next.listingAt !== active.listingAt) {
    const activeAt = Date.parse(active.listingAt);
    // Moving the date is a postponement or an earlier opening of a market that has not opened yet.
    if (opened) throw new ListingValidationError('HISTORY_LOCKED', 'The listing already opened; its time cannot change');
    if (at < now + minLeadMs) throw new ListingValidationError('LISTING_TIME_PAST', 'The new listing time must be at least one minute in the future');
    if (at > now + MAX_LEAD_MS) throw new ListingValidationError('LISTING_TIME_TOO_FAR', 'The listing time must be within one year');
  }
}

/** The simulation input for a configuration. Same seed, time and price → same market, everywhere. */
export function listingSimulationConfig(config: ListingConfig): TestAssetConfig {
  return {
    symbol: config.symbol,
    name: config.name,
    quote: listingQuote(config),
    pair: listingPair(config.symbol, listingQuote(config)),
    isTestAsset: true,
    isTradable: config.tradable,
    ...(config.privateTest ? { privateTest: true as const } : {}),
    listingArmed: true,
    listingAt: Date.parse(config.listingAt),
    initialPrice: Number(config.initialPrice),
    seed: config.seed,
    ...(config.simulationProgram?.kind === 'scenario-controls-v2' ? { scheduledScenario: {
      mode: 'scenario-controls-v2' as const, version: 2 as const,
      from: Date.parse(config.listingAt), initialPrice: config.initialPrice,
      // Own a frozen snapshot for bounded O(1) historical lookups; leave the
      // caller's draft and every legacy non-historical scenario untouched.
      controls: config.simulationProgram.afterGrowth === 'historical' && config.simulationProgram.historical
        ? { ...config.simulationProgram, historical: freezeHistoricalMoveProgram(config.simulationProgram.historical) }
        : config.simulationProgram,
    } } : config.simulationProgram ? { scheduledScenario: {
      mode: 'capped-growth-range' as const, version: 1,
      from: Date.parse(config.listingAt),
      firstTargetAt: Date.parse(config.listingAt) + 24 * 3600000,
      peakAt: Date.parse(config.listingAt) + config.simulationProgram.peakAfterHours * 3600000,
      firstGainPercent: config.simulationProgram.first24hGainPercent,
      maxGainPercent: config.simulationProgram.maxGainPercent,
      rangeFraction: config.simulationProgram.rangeFraction,
    } } : {}),
    ...(config.simulationProfile ? { simulationProfile: config.simulationProfile } : {}),
    ...(config.simulationProfile && config.wickModel === 'NATURAL_V1'
      ? { naturalWicks: { futureFrom: Date.parse(config.listingAt) } } : {}),
  };
}

/**
 * THE PRE-LISTING TIMER of a published listing is operational state kept next
 * to the immutable configuration, never inside it: the owner starts, pauses
 * and stops the public countdown without a new version and without moving
 * the listing time. The countdown always counts to `listingAt`; starting it
 * later never shifts that instant.
 *
 * - `staged`: published and validated, not public yet — no page, no
 *   countdown, no market. Render still knows the ticker (restricted
 *   everywhere).
 * - `running`: the public page shows the countdown; the market opens at
 *   `listingAt` by the server clock.
 * - `paused`: the public page shows the date, the countdown is hidden; the
 *   market stays frozen before its first tick, even past `listingAt`.
 *
 * A listing published before this state existed has none and behaves as
 * `running` (today's behaviour).
 */
export type ListingCountdownState = 'staged' | 'running' | 'paused';
export type ListingCountdownAction = 'start' | 'pause' | 'stop';
export interface ListingCountdown {
  state: ListingCountdownState;
  /** Server time of the last change and who made it. */
  updatedAt: number;
  updatedBy: string;
  /** Server time of the last start. */
  startedAt?: number;
}
export const LISTING_COUNTDOWN_ACTIONS: readonly ListingCountdownAction[] = ['start', 'pause', 'stop'];

export const listingCountdownSchema = z.object({
  state: z.enum(['staged', 'running', 'paused']),
  updatedAt: z.number().int().nonnegative(),
  updatedBy: z.string().max(64),
  startedAt: z.number().int().nonnegative().optional(),
}).strict();

/** A published listing as the public catalogue carries it: no owner allocation, no seed mode. */
export interface PublishedListing {
  id: string;
  version: number;
  publishedAt: string;
  config: ListingConfig;
  readLease?: import('../../shared/aithPublication').ListingReadLease;
  /** Absent on listings published before the timer existed: their clock runs. */
  countdown?: ListingCountdown;
}

export const publishedListingSchema = z.object({
  id: z.string().regex(LISTING_ID_PATTERN),
  version: z.number().int().positive(),
  publishedAt: z.string(),
  config: listingConfigSchema,
  readLease: z.object({
    protocol: z.literal('aith-prelisting-v1'), generation: z.number().int().positive(),
    issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  }).strict().optional(),
  countdown: listingCountdownSchema.optional(),
}).strict();

/** Whether the listing's clock runs: `running`, or no timer state at all. */
export const listingCountdownArmed = (listing: Pick<PublishedListing, 'countdown'>): boolean =>
  !listing.countdown || listing.countdown.state === 'running';

/** The simulation input of a published listing: its configuration, armed only while the timer runs. */
export function publishedListingAsset(listing: Pick<PublishedListing, 'config' | 'countdown'>): TestAssetConfig {
  return { ...listingSimulationConfig(listing.config), listingArmed: listingCountdownArmed(listing) };
}

/** The market opened: its clock was running at the listing time, so public history exists. */
export function listingOpened(listing: Pick<PublishedListing, 'config' | 'countdown'>, now: number): boolean {
  return listingCountdownArmed(listing) && Date.parse(listing.config.listingAt) <= now;
}

/**
 * The timer state after an admin action, or a refusal. Nothing is ever
 * activated automatically: starting needs a listing time still ahead (a
 * passed date must be moved first), and an opened market has no timer to
 * pause or stop.
 */
export function nextListingCountdown(listing: Pick<PublishedListing, 'config' | 'countdown'>, action: ListingCountdownAction, now: number): ListingCountdownState {
  if (listingOpened(listing, now)) throw new ListingValidationError('MARKET_OPEN', 'The market already opened; its timer cannot change');
  if (action === 'start') {
    if (Date.parse(listing.config.listingAt) <= now) {
      throw new ListingValidationError('LISTING_TIME_PAST', 'The listing time has passed; set a new listing time before starting the timer');
    }
    return 'running';
  }
  return action === 'pause' ? 'paused' : 'staged';
}
