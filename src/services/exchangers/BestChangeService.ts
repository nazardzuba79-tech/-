/**
 * «Обменники» (/exchangers, #694): server-side BestChange comparison.
 *
 * Read-only. Nothing here moves money or touches any VOLTEX balance, deposit,
 * withdrawal, Copy Trading, Spot, Futures or Wallet state. Exact behaviour is
 * specified in docs/EXCHANGERS_694.md; in short:
 *
 *   - unset / malformed BESTCHANGE_API_KEY ⇒ `not_configured`, no upstream call;
 *   - currency ids are never hard-coded: RUB methods and receive pairs are
 *     resolved from the live `currencies` directory by the shared catalogue rules;
 *   - ONE batched `rates` request covers every method × receive pair of a snapshot
 *     (≤ 500 pairs), however many clients ask; currencies are cached 1 h, changers
 *     10 min, the rates snapshot BESTCHANGE_CACHE_TTL_SECONDS (30..300, default 45);
 *     a failed refresh serves the last snapshot for up to 5 min with `stale: true`;
 *     refreshes are single-flight and run their upstream calls one after another,
 *     so there is never more than one upstream request in flight;
 *   - every outbound link is built/validated by src/shared/exchangers/links.ts.
 */
import {
  RECEIVE_PAIRS,
  pairKey,
  resolveReceiveCurrencies,
  resolveRubMethods,
  type ReceivePair,
  type ResolvedRubMethod,
} from '../../shared/exchangers/catalog';
import { buildDirectionUrl, normalizePartnerId, pickExchangerClickUrl } from '../../shared/exchangers/links';
import { receiveAmountFor, rubPerUnit } from '../../shared/exchangers/normalize';
import type {
  BestChangeCurrencyLike,
  DirectoryResponse,
  ExchangersErrorResponse,
  Offer,
  OffersQuery,
  OffersResponse,
} from '../../shared/exchangers/types';
import {
  MAX_RATE_PAIRS,
  createBestChangeClient,
  isPlausibleBestChangeKey,
  type BestChangeApi,
  type BestChangeClientOptions,
  type RatePair,
} from './BestChangeClient';
import { RefreshingValue, type Cached } from './cache';
import { BestChangeError } from './errors';
import {
  parseChangers,
  parseCurrencies,
  parseRates,
  type BestChangeChanger,
  type BestChangeCurrency,
  type BestChangeRateRow,
} from './parse';

export const DEFAULT_CACHE_TTL_SECONDS = 45;
export const MIN_CACHE_TTL_SECONDS = 30;
export const MAX_CACHE_TTL_SECONDS = 300;
export const CURRENCIES_TTL_MS = 60 * 60_000;
export const CHANGERS_TTL_MS = 10 * 60_000;
export const SNAPSHOT_MAX_STALE_MS = 5 * 60_000;
/** Pause after a failed refresh before upstream is tried again. */
export const FAILURE_COOLDOWN_MS = 15_000;
/** A rejected key will not fix itself; retry rarely. */
export const KEY_REJECTED_COOLDOWN_MS = 5 * 60_000;
const MAX_OFFERS = 200;

/** BESTCHANGE_CACHE_TTL_SECONDS → integer seconds in [30, 300]; unset or unparsable ⇒ 45. */
export function resolveCacheTtlSeconds(raw: unknown): number {
  let n = Number.NaN;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d{1,6}$/.test(raw.trim())) n = Number(raw.trim());
  if (!Number.isFinite(n)) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.min(MAX_CACHE_TTL_SECONDS, Math.max(MIN_CACHE_TTL_SECONDS, Math.round(n)));
}

export interface BestChangeServiceOptions {
  /** BESTCHANGE_API_KEY (already trimmed). Unset/blank/malformed ⇒ not configured. */
  apiKey?: string | null;
  /** BESTCHANGE_PARTNER_ID, digits only; anything else is ignored. */
  partnerId?: string | number | null;
  /** BESTCHANGE_CACHE_TTL_SECONDS. */
  cacheTtlSeconds?: string | number | null;
  fetchFn?: typeof fetch;
  /** Transport tuning (timeouts, body cap); the key always comes from `apiKey`. */
  clientOptions?: Omit<BestChangeClientOptions, 'apiKey' | 'fetchFn' | 'now'>;
  /** Replaces the HTTP client entirely (tests). Ignored when no valid key is configured. */
  client?: BestChangeApi;
  now?: () => number;
}

/** What the router depends on. */
export interface ExchangersService {
  isConfigured(): boolean;
  directory(): Promise<DirectoryResponse>;
  /** `{status:'invalid'}` when the method or the asset/network is not in the live directory. */
  offers(query: OffersQuery): Promise<OffersResponse>;
}

interface SnapshotMethod extends ResolvedRubMethod {
  available: boolean;
}

interface SnapshotReceive {
  pair: ReceivePair;
  currency: BestChangeCurrencyLike;
  available: boolean;
}

interface Snapshot {
  methods: SnapshotMethod[];
  receive: SnapshotReceive[];
  rates: Map<string, BestChangeRateRow[]>;
  changers: Map<number, BestChangeChanger>;
}

function rateKey(fromId: number, toId: number): string {
  return `${fromId}-${toId}`;
}

/** Floors to `decimals` places without binary artefacts (105.13 stays 105.13). */
function floorTo(value: number, decimals: number): number | null {
  const factor = 10 ** decimals;
  const scaled = Number((value * factor).toPrecision(15));
  const out = Math.floor(scaled) / factor;
  return Number.isFinite(out) && out > 0 ? out : null;
}

function nonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function isUsableRow(row: BestChangeRateRow, changers: Map<number, BestChangeChanger>): boolean {
  return changers.get(row.changer)?.active === true && rubPerUnit(row.rate) !== null;
}

function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown';
}

export class BestChangeService implements ExchangersService {
  private readonly client: BestChangeApi | null;
  private readonly partnerId: string | null;
  readonly cacheTtlSeconds: number;
  private readonly now: () => number;
  private readonly currencies: RefreshingValue<BestChangeCurrency[]>;
  private readonly changers: RefreshingValue<Map<number, BestChangeChanger>>;
  private readonly snapshot: RefreshingValue<Snapshot>;

  constructor(options: BestChangeServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    const key = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (key && !isPlausibleBestChangeKey(key)) {
      console.warn('[bestchange] BESTCHANGE_API_KEY has an unexpected format; exchangers stay not configured');
    }
    this.client = key && isPlausibleBestChangeKey(key)
      ? options.client ?? createBestChangeClient({ ...options.clientOptions, apiKey: key, fetchFn: options.fetchFn, now: this.now })
      : null;

    const rawPartner = options.partnerId;
    const partnerText = typeof rawPartner === 'string' ? rawPartner.trim() : rawPartner;
    this.partnerId = partnerText === undefined || partnerText === null || partnerText === '' ? null : normalizePartnerId(partnerText);
    if (this.partnerId === null && partnerText !== undefined && partnerText !== null && partnerText !== '') {
      console.warn('[bestchange] BESTCHANGE_PARTNER_ID is not 1-12 digits; direction links carry no partner id');
    }
    this.cacheTtlSeconds = resolveCacheTtlSeconds(options.cacheTtlSeconds);

    const cooldownMs = (error: unknown) =>
      error instanceof BestChangeError && error.code === 'key_rejected' ? KEY_REJECTED_COOLDOWN_MS : FAILURE_COOLDOWN_MS;
    // Directory data changes rarely; an older copy is still correct ids/names, so it may be reused longer.
    this.currencies = new RefreshingValue(() => this.loadCurrencies(), {
      ttlMs: CURRENCIES_TTL_MS, maxStaleMs: 6 * CURRENCIES_TTL_MS, cooldownMs, now: this.now,
    });
    this.changers = new RefreshingValue(() => this.loadChangers(), {
      ttlMs: CHANGERS_TTL_MS, maxStaleMs: 6 * CHANGERS_TTL_MS, cooldownMs, now: this.now,
    });
    this.snapshot = new RefreshingValue(() => this.loadSnapshot(), {
      ttlMs: this.cacheTtlSeconds * 1000, maxStaleMs: SNAPSHOT_MAX_STALE_MS, cooldownMs, now: this.now,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async directory(): Promise<DirectoryResponse> {
    if (!this.client) return { status: 'not_configured' };
    try {
      const { value, fetchedAt } = await this.snapshot.get();
      return {
        status: 'ok',
        asOf: new Date(fetchedAt).toISOString(),
        methods: value.methods.map((m) => ({ id: m.id, label: m.label, kind: m.kind, available: m.available })),
        assets: value.receive.map((r) => ({ assetId: r.pair.assetId, networkId: r.pair.networkId, available: r.available })),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  async offers(query: OffersQuery): Promise<OffersResponse> {
    if (!this.client) return { status: 'not_configured' };
    let cached: Cached<Snapshot>;
    try {
      cached = await this.snapshot.get();
    } catch (error) {
      return this.failure(error);
    }
    const { value: snap, fetchedAt, stale } = cached;
    const method = snap.methods.find((m) => m.id === query.method);
    const receive = snap.receive.find((r) => r.pair.key === pairKey(query.asset, query.network));
    if (!method || !receive) return { status: 'invalid' };

    const rows = snap.rates.get(rateKey(method.currencyId, receive.currency.id)) ?? [];
    const best = new Map<number, { row: BestChangeRateRow; rub: number; rank: number | null }>();
    for (const row of rows) {
      const changer = snap.changers.get(row.changer);
      if (!changer || changer.active !== true) continue;
      const rub = rubPerUnit(row.rate);
      if (rub === null) continue;
      const rank = rubPerUnit(row.rankrate);
      const current = best.get(row.changer);
      const score = rank ?? rub;
      if (!current || score < (current.rank ?? current.rub) || (score === (current.rank ?? current.rub) && rub < current.rub)) {
        best.set(row.changer, { row, rub, rank });
      }
    }

    const offers: Offer[] = [];
    for (const [changerId, { row, rub, rank }] of best) {
      const changer = snap.changers.get(changerId)!;
      const minRub = nonNegative(row.inmin);
      const maxRub = positive(row.inmax); // inmax 0 ⇒ no stated maximum
      const fitsAmount = minRub === null && maxRub === null
        ? null
        : (minRub === null || query.amount >= minRub) && (maxRub === null || query.amount <= maxRub);
      const raw = receiveAmountFor(query.amount, rub);
      const url = pickExchangerClickUrl(changer.urls, changer.id);
      offers.push({
        id: String(changer.id),
        exchanger: { id: changer.id, name: changer.name, rating: changer.rating, reviews: changer.reviews },
        rubPerUnit: rub,
        rankRubPerUnit: rank,
        receiveAmount: raw === null ? null : floorTo(raw, receive.pair.displayDecimals),
        minRub,
        maxRub,
        reserve: nonNegative(row.reserve),
        marks: [...row.marks],
        fitsAmount,
        link: url ? { kind: 'exchanger', url } : null,
      });
    }
    offers.sort((a, b) => {
      if (a.rankRubPerUnit !== null && b.rankRubPerUnit !== null && a.rankRubPerUnit !== b.rankRubPerUnit) {
        return a.rankRubPerUnit - b.rankRubPerUnit;
      }
      if ((a.rankRubPerUnit === null) !== (b.rankRubPerUnit === null)) return a.rankRubPerUnit === null ? 1 : -1;
      if (a.rubPerUnit !== b.rubPerUnit) return a.rubPerUnit - b.rubPerUnit;
      return a.exchanger.id - b.exchanger.id;
    });

    const direction = buildDirectionUrl(method.urlname, receive.currency.urlname, this.partnerId);
    return {
      status: 'ok',
      asOf: new Date(fetchedAt).toISOString(),
      stale,
      query: { method: method.id, asset: receive.pair.assetId, network: receive.pair.networkId, amount: query.amount },
      directionLink: direction ? { url: direction } : null,
      offers: offers.slice(0, MAX_OFFERS),
    };
  }

  /** Seconds a client should wait before asking again after `unavailable`. */
  retryAfterSeconds(): number {
    return Math.max(5, Math.ceil(this.snapshot.cooldownRemainingMs() / 1000));
  }

  private failure(error: unknown): ExchangersErrorResponse {
    if (error instanceof BestChangeError) {
      // A key upstream does not accept is, for the page, a key that is not set up.
      if (error.code === 'key_rejected' || error.code === 'not_configured') return { status: 'not_configured' };
    } else {
      console.error('[bestchange] unexpected failure', { name: errorName(error) });
    }
    return { status: 'unavailable', retryAfter: this.retryAfterSeconds() };
  }

  private requireClient(): BestChangeApi {
    if (!this.client) throw new BestChangeError('not_configured');
    return this.client;
  }

  private async loadCurrencies(): Promise<BestChangeCurrency[]> {
    return parseCurrencies(await this.requireClient().getCurrencies('ru'));
  }

  private async loadChangers(): Promise<Map<number, BestChangeChanger>> {
    return parseChangers(await this.requireClient().getChangers('ru'));
  }

  private async loadSnapshot(): Promise<Snapshot> {
    // Sequential on purpose: at most one upstream request in flight.
    const currencies = (await this.currencies.get()).value;
    const changers = (await this.changers.get()).value;

    const receiveMap = resolveReceiveCurrencies(currencies);
    const receive = RECEIVE_PAIRS.filter((p) => receiveMap.has(p.key)).map((pair) => ({ pair, currency: receiveMap.get(pair.key)! }));

    // Fixed methods come first in resolveRubMethods; dynamic extras that would push
    // the batch past the documented 500-pair limit are left out.
    const methods: ResolvedRubMethod[] = [];
    for (const method of resolveRubMethods(currencies)) {
      if ((methods.length + 1) * receive.length > MAX_RATE_PAIRS) break;
      methods.push(method);
    }

    const pairs: RatePair[] = [];
    for (const m of methods) for (const r of receive) pairs.push([m.currencyId, r.currency.id]);
    const rates = pairs.length > 0 ? parseRates(await this.requireClient().getRates(pairs)) : new Map<string, BestChangeRateRow[]>();

    const usable = (fromId: number, toId: number) => (rates.get(rateKey(fromId, toId)) ?? []).some((row) => isUsableRow(row, changers));
    return {
      methods: methods.map((m) => ({ ...m, available: receive.some((r) => usable(m.currencyId, r.currency.id)) })),
      receive: receive.map((r) => ({ ...r, available: methods.some((m) => usable(m.currencyId, r.currency.id)) })),
      rates,
      changers,
    };
  }
}

/** Reads BESTCHANGE_* from an env object (server only; the key is never logged). */
export function bestChangeServiceFromEnv(env: NodeJS.ProcessEnv, extra: Omit<BestChangeServiceOptions, 'apiKey' | 'partnerId' | 'cacheTtlSeconds'> = {}): BestChangeService {
  return new BestChangeService({
    ...extra,
    apiKey: env.BESTCHANGE_API_KEY?.trim(),
    partnerId: env.BESTCHANGE_PARTNER_ID,
    cacheTtlSeconds: env.BESTCHANGE_CACHE_TTL_SECONDS,
  });
}
