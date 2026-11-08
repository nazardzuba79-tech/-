/**
 * «Обменники» (/exchangers, Issue #694): pure page logic.
 *
 * Everything the page renders from the API passes through the validators
 * below first. The server is trusted for nothing it does not have to be:
 * every field is type-checked, every number range-checked, every outbound
 * link re-validated with the shared BestChange link rules, and a row that
 * fails is dropped instead of rendered. Unknown values stay `null` and are
 * shown as «Нет данных», never as zero.
 *
 * No I/O here (see lib/exchangersApi.ts), so Jest imports it directly.
 */
import {
  RECEIVE_PAIRS,
  RUB_METHODS,
  DYNAMIC_METHOD_PREFIX,
  NETWORKS,
  findAsset,
  findAssetNetwork,
  findRubMethod,
  isMethodIdShape,
  isSupportedPair,
  isUrlname,
  networkLabel,
} from '../../../../src/shared/exchangers/catalog';
import { buildDirectionUrl, isDirectionUrl, isExchangerClickUrl } from '../../../../src/shared/exchangers/links';
import { RUB_AMOUNT_MAX, RUB_AMOUNT_MIN, formatCrypto, formatRub, parseRubAmount } from '../../../../src/shared/exchangers/amount';
import { isOfferMark } from '../../../../src/shared/exchangers/types';
import type {
  AssetId,
  DirectoryAsset,
  DirectoryMethod,
  ExchangerReviews,
  MethodKind,
  NetworkId,
  Offer,
  OfferMark,
  OffersQuery,
} from '../../../../src/shared/exchangers/types';

// ---------------------------------------------------------------------------
// Results of one request, after validation
// ---------------------------------------------------------------------------

/** A non-OK answer the page has its own state for. `error` = network failure or a body that failed validation. */
export type ExchangersProblem =
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; retryAfter: number | null }
  | { kind: 'rate_limited'; retryAfter: number | null }
  | { kind: 'invalid' }
  | { kind: 'error' };

export interface DirectoryData {
  asOf: string | null;
  methods: DirectoryMethod[];
  assets: DirectoryAsset[];
}

export interface OffersData {
  asOf: string | null;
  /** True when the server answered from an older (≤ 5 min) copy of the rates. */
  delayed: boolean;
  query: OffersQuery;
  /** Already re-checked with isDirectionUrl; null otherwise. */
  directionUrl: string | null;
  offers: Offer[];
}

export type DirectoryResult = { kind: 'ok'; data: DirectoryData } | ExchangersProblem;
export type OffersResult = { kind: 'ok'; data: OffersData } | ExchangersProblem;

const MAX_METHODS = 64;
const MAX_OFFERS = 500;
/** Same ceiling as the server parser (src/services/exchangers/parse.ts MAX_TEXT), so no valid row is dropped here. */
const MAX_NAME_LENGTH = 200;
const MAX_LABEL_LENGTH = 80;
const METHOD_KINDS: readonly MethodKind[] = ['payment_system', 'bank', 'card'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown, min: number): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return undefined;
  return value;
}

function retryAfterOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(3600, Math.ceil(value));
}

function asOfOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

/** The four non-OK bodies the contract defines, or null when `raw` is none of them. */
function problemOf(raw: Record<string, unknown>): ExchangersProblem | null {
  switch (raw.status) {
    case 'not_configured':
      return { kind: 'not_configured' };
    case 'unavailable':
      return { kind: 'unavailable', retryAfter: retryAfterOf(raw.retryAfter) };
    case 'rate_limited':
      return { kind: 'rate_limited', retryAfter: retryAfterOf(raw.retryAfter) };
    case 'invalid':
      return { kind: 'invalid' };
    default:
      return null;
  }
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_LABEL_LENGTH) return null;
  // No control characters reach the screen.
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return null;
  return text;
}

/** GET /exchangers/directory body → typed result. A malformed row is dropped; a malformed body is `error`. */
export function validateDirectoryBody(raw: unknown): DirectoryResult {
  if (!isRecord(raw)) return { kind: 'error' };
  if (raw.status !== 'ok') return problemOf(raw) ?? { kind: 'error' };
  const asOf = asOfOf(raw.asOf);
  if (asOf === undefined || !Array.isArray(raw.methods) || !Array.isArray(raw.assets)) return { kind: 'error' };
  const methods: DirectoryMethod[] = [];
  const seenMethods = new Set<string>();
  for (const row of raw.methods.slice(0, MAX_METHODS)) {
    if (!isRecord(row) || !isMethodIdShape(row.id) || seenMethods.has(row.id)) continue;
    const label = cleanLabel(row.label);
    if (!label || typeof row.kind !== 'string' || !(METHOD_KINDS as readonly string[]).includes(row.kind)) continue;
    if (typeof row.available !== 'boolean') continue;
    seenMethods.add(row.id);
    methods.push({ id: row.id, label, kind: row.kind as MethodKind, available: row.available });
  }
  const assets: DirectoryAsset[] = [];
  const seenPairs = new Set<string>();
  for (const row of raw.assets.slice(0, RECEIVE_PAIRS.length * 2)) {
    if (!isRecord(row) || !isSupportedPair(row.assetId, row.networkId) || typeof row.available !== 'boolean') continue;
    const key = `${row.assetId}:${row.networkId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    assets.push({ assetId: row.assetId as AssetId, networkId: row.networkId as NetworkId, available: row.available });
  }
  return { kind: 'ok', data: { asOf, methods, assets } };
}

function reviewsOf(value: unknown): ExchangerReviews | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const key of ['positive', 'neutral', 'claim', 'closed'] as const) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return undefined;
    out[key] = n;
  }
  return out as unknown as ExchangerReviews;
}

/** One offer row, or null when any field breaks the contract. The link is re-checked, never trusted. */
export function validateOffer(raw: unknown): Offer | null {
  if (!isRecord(raw) || !isRecord(raw.exchanger)) return null;
  const ex = raw.exchanger;
  if (typeof ex.id !== 'number' || !Number.isSafeInteger(ex.id) || ex.id <= 0) return null;
  if (typeof raw.id !== 'string' || raw.id !== String(ex.id)) return null;
  if (typeof ex.name !== 'string') return null;
  const name = ex.name.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  const rating = finiteOrNull(ex.rating, Number.NEGATIVE_INFINITY);
  const reviews = reviewsOf(ex.reviews);
  if (rating === undefined || reviews === undefined) return null;
  if (typeof raw.rubPerUnit !== 'number' || !Number.isFinite(raw.rubPerUnit) || raw.rubPerUnit <= 0) return null;
  const rankRubPerUnit = finiteOrNull(raw.rankRubPerUnit, Number.MIN_VALUE);
  const receiveAmount = finiteOrNull(raw.receiveAmount, 0);
  const minRub = finiteOrNull(raw.minRub, 0);
  const maxRub = finiteOrNull(raw.maxRub, 0);
  const reserve = finiteOrNull(raw.reserve, 0);
  if ([rankRubPerUnit, receiveAmount, minRub, maxRub, reserve].some((v) => v === undefined)) return null;
  if (raw.fitsAmount !== null && typeof raw.fitsAmount !== 'boolean') return null;
  if (!Array.isArray(raw.marks)) return null;
  const marks: OfferMark[] = [];
  for (const mark of raw.marks) if (isOfferMark(mark) && !marks.includes(mark)) marks.push(mark);
  let link: Offer['link'] = null;
  if (isRecord(raw.link) && raw.link.kind === 'exchanger' && isExchangerClickUrl(raw.link.url, ex.id)) {
    link = { kind: 'exchanger', url: raw.link.url as string };
  }
  return {
    id: raw.id,
    exchanger: { id: ex.id, name, rating: rating as number | null, reviews: reviews as ExchangerReviews | null },
    rubPerUnit: raw.rubPerUnit,
    rankRubPerUnit: rankRubPerUnit as number | null,
    receiveAmount: receiveAmount as number | null,
    minRub: minRub as number | null,
    maxRub: maxRub as number | null,
    reserve: reserve as number | null,
    marks,
    fitsAmount: raw.fitsAmount as boolean | null,
    link,
  };
}

function sameQuery(a: unknown, b: OffersQuery): boolean {
  return isRecord(a) && a.method === b.method && a.asset === b.asset && a.network === b.network && a.amount === b.amount;
}

/**
 * GET /exchangers/offers body → typed result. The answer must be for the
 * query that was asked; an answer for anything else is `error`, so a slow
 * reply can never paint another direction's offers.
 */
export function validateOffersBody(raw: unknown, requested: OffersQuery): OffersResult {
  if (!isRecord(raw)) return { kind: 'error' };
  if (raw.status !== 'ok') return problemOf(raw) ?? { kind: 'error' };
  const asOf = asOfOf(raw.asOf);
  if (asOf === undefined || typeof raw.stale !== 'boolean' || !Array.isArray(raw.offers)) return { kind: 'error' };
  if (!sameQuery(raw.query, requested)) return { kind: 'error' };
  let directionUrl: string | null = null;
  if (isRecord(raw.directionLink) && isDirectionUrl(raw.directionLink.url)) directionUrl = raw.directionLink.url as string;
  const offers: Offer[] = [];
  const seen = new Set<string>();
  for (const row of raw.offers.slice(0, MAX_OFFERS)) {
    const offer = validateOffer(row);
    if (!offer || seen.has(offer.id)) continue;
    seen.add(offer.id);
    offers.push(offer);
  }
  return { kind: 'ok', data: { asOf, delayed: raw.stale, query: { ...requested }, directionUrl, offers } };
}

// ---------------------------------------------------------------------------
// Calculator options
// ---------------------------------------------------------------------------

export const KIND_LABEL: Record<MethodKind, string> = {
  payment_system: 'платёжная система',
  bank: 'банк',
  card: 'карта',
};

export interface MethodOption {
  id: string;
  label: string;
  kind: MethodKind;
  available: boolean;
}

export interface PairOption {
  assetId: AssetId;
  networkId: NetworkId;
  available: boolean;
}

export interface CalculatorOptions {
  methods: MethodOption[];
  pairs: PairOption[];
}

/**
 * Without a directory (the server has no BestChange key, or the directory
 * could not be read) the fixed catalogue is still selectable: it only builds
 * the BestChange direction link, never an offer.
 */
export function fallbackOptions(): CalculatorOptions {
  return {
    methods: RUB_METHODS.map((m) => ({ id: m.id, label: m.label, kind: m.kind, available: true })),
    pairs: RECEIVE_PAIRS.map((p) => ({ assetId: p.assetId, networkId: p.networkId, available: true })),
  };
}

/** Directory rows in catalogue order (fixed methods first, as the server lists them; pairs as RECEIVE_PAIRS). */
export function optionsFromDirectory(directory: DirectoryData): CalculatorOptions {
  const pairs: PairOption[] = [];
  for (const p of RECEIVE_PAIRS) {
    const row = directory.assets.find((a) => a.assetId === p.assetId && a.networkId === p.networkId);
    if (row) pairs.push({ assetId: row.assetId, networkId: row.networkId, available: row.available });
  }
  return { methods: directory.methods.map((m) => ({ ...m })), pairs };
}

export function methodOptionLabel(m: MethodOption): string {
  return `${m.label} · ${KIND_LABEL[m.kind]}${m.available ? '' : ' (нет предложений)'}`;
}

/** Assets that have at least one network in `pairs`, catalogue order. */
export function assetsIn(pairs: readonly PairOption[]): { assetId: AssetId; name: string; available: boolean }[] {
  const out: { assetId: AssetId; name: string; available: boolean }[] = [];
  for (const p of pairs) {
    const existing = out.find((a) => a.assetId === p.assetId);
    if (existing) existing.available = existing.available || p.available;
    else out.push({ assetId: p.assetId, name: findAsset(p.assetId)?.name ?? p.assetId, available: p.available });
  }
  return out;
}

export function networksFor(pairs: readonly PairOption[], assetId: AssetId): PairOption[] {
  return pairs.filter((p) => p.assetId === assetId);
}

/** «TRON (TRC-20)», «TRON (Native)», «Ethereum (ERC-20)», «BNB Smart Chain (BEP-20)», «TON». */
export function networkDisplay(assetId: AssetId, networkId: NetworkId): string {
  const entry = findAssetNetwork(assetId, networkId);
  if (entry && !entry.native && entry.standard === 'Jetton') return NETWORKS[networkId].label;
  return networkLabel(assetId, networkId);
}

/** The v0 network hints: TRX is never USDT TRC-20, and the network must match the wallet. */
export function networkHint(assetId: AssetId, networkId: NetworkId, multiple: boolean): string {
  const entry = findAssetNetwork(assetId, networkId);
  const network = NETWORKS[networkId].label;
  if (assetId === 'TRX') {
    return 'TRX — нативная монета сети TRON. Это не USDT TRC-20: чтобы получить USDT, выберите USDT и сеть TRON (TRC-20).';
  }
  if (assetId === 'USDT' && networkId === 'tron') {
    return 'USDT в сети TRON (стандарт TRC-20). Это токен, а не монета TRX. Адрес кошелька начинается с «T».';
  }
  if (entry?.native) return `${assetId} — нативная монета сети ${network}. Адрес кошелька должен принадлежать этой сети.`;
  if (multiple) {
    const standard = entry?.standard && entry.standard !== 'Jetton' ? ` (${entry.standard})` : '';
    return `Токен ${assetId} в сети ${network}${standard}. Отправка в другой сети может привести к потере средств.`;
  }
  return `Токен ${assetId} в сети ${network}.`;
}

/** Keeps the chosen network when the new asset has it, otherwise the first available one. */
export function pickNetwork(pairs: readonly PairOption[], assetId: AssetId, current: NetworkId): NetworkId | null {
  const list = networksFor(pairs, assetId);
  if (list.some((p) => p.networkId === current)) return current;
  return (list.find((p) => p.available) ?? list[0])?.networkId ?? null;
}

/** What the calculator holds while the visitor edits it. */
export interface CalculatorDraft {
  method: string;
  assetId: AssetId;
  networkId: NetworkId;
  amountText: string;
}

/** Snaps a draft onto what the options offer, preferring available entries. */
export function reconcileDraft(draft: CalculatorDraft, options: CalculatorOptions): CalculatorDraft {
  const methods = options.methods;
  const method =
    methods.find((m) => m.id === draft.method && m.available)?.id ??
    methods.find((m) => m.available)?.id ??
    methods.find((m) => m.id === draft.method)?.id ??
    methods[0]?.id ??
    draft.method;
  const pairs = options.pairs;
  const same = (p: { assetId: string; networkId: string }) => p.assetId === draft.assetId && p.networkId === draft.networkId;
  const pair =
    pairs.find((p) => same(p) && p.available) ??
    pairs.find((p) => p.assetId === draft.assetId && p.available) ??
    pairs.find((p) => p.available) ??
    pairs.find(same) ??
    pairs[0];
  return { ...draft, method, assetId: pair?.assetId ?? draft.assetId, networkId: pair?.networkId ?? draft.networkId };
}

/** The request for a draft, or null when any part is not a shape the server accepts. */
export function queryFromDraft(draft: CalculatorDraft): OffersQuery | null {
  const amount = parseRubAmount(draft.amountText);
  if (amount === null || !isMethodIdShape(draft.method) || !isSupportedPair(draft.assetId, draft.networkId)) return null;
  return { method: draft.method, asset: draft.assetId, network: draft.networkId, amount };
}


export const QUICK_AMOUNTS = [5_000, 10_000, 50_000, 100_000] as const;
export const DEFAULT_AMOUNT = 10_000;
export const AMOUNT_ERROR = `Введите сумму от ${RUB_AMOUNT_MIN} до ${new Intl.NumberFormat('ru-RU').format(RUB_AMOUNT_MAX)} ₽. Копейки — через запятую или точку.`;

/** Typing filter for the amount field: digits, spaces, one «,» or «.»; nothing else, at most 20 characters. */
export function sanitizeAmountInput(value: string): string {
  return value.replace(/[^\d\s.,  ]/g, '').slice(0, 20);
}

// ---------------------------------------------------------------------------
// Links (each one re-checked here, whatever the server said)
// ---------------------------------------------------------------------------

/** BestChange urlname of a method id: fixed RUB_METHODS entry or a `bc-<urlname>` extra. */
export function methodUrlname(methodId: string): string | null {
  const fixed = findRubMethod(methodId);
  if (fixed) return fixed.urlname;
  if (methodId.startsWith(DYNAMIC_METHOD_PREFIX)) {
    const urlname = methodId.slice(DYNAMIC_METHOD_PREFIX.length);
    return isUrlname(urlname) ? urlname : null;
  }
  return null;
}

/**
 * The section-level «Выбрать на BestChange» link: the server's direction link
 * when it passed isDirectionUrl, otherwise one built here from the catalogue
 * (first candidate urlname of the pair, no partner id), otherwise null.
 */
export function directionHref(methodId: string, assetId: AssetId, networkId: NetworkId, serverUrl: string | null): string | null {
  if (serverUrl && isDirectionUrl(serverUrl)) return serverUrl;
  const from = methodUrlname(methodId);
  const to = findAssetNetwork(assetId, networkId)?.match.urlnames[0];
  if (!from || !to) return null;
  return buildDirectionUrl(from, to);
}

export type OfferAction =
  | { kind: 'exchanger'; href: string }
  | { kind: 'direction'; href: string }
  | { kind: 'none' };

/**
 * «Перейти к обменнику» only for a BestChange click link of THIS exchanger
 * (isExchangerClickUrl with the offer's own exchanger id); otherwise
 * «Выбрать на BestChange» to a direction page that passes isDirectionUrl;
 * otherwise no link at all.
 */
export function offerAction(offer: Pick<Offer, 'link' | 'exchanger'>, directionUrl: string | null): OfferAction {
  const link = offer.link;
  if (link && link.kind === 'exchanger' && isExchangerClickUrl(link.url, offer.exchanger.id)) return { kind: 'exchanger', href: link.url };
  if (directionUrl && isDirectionUrl(directionUrl)) return { kind: 'direction', href: directionUrl };
  return { kind: 'none' };
}

/** Attributes every outbound link carries. Only the origin is sent as referrer. */
export const OUTBOUND_LINK = { target: '_blank', rel: 'noopener nofollow sponsored', referrerPolicy: 'origin' } as const;

// ---------------------------------------------------------------------------
// Sorting and filtering
// ---------------------------------------------------------------------------

export type SortKey = 'best' | 'rate' | 'reserve' | 'min' | 'reviews';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'best', label: 'Лучший курс с учётом комиссий' },
  { value: 'rate', label: 'Курс' },
  { value: 'reserve', label: 'Резерв' },
  { value: 'min', label: 'Мин. сумма' },
  { value: 'reviews', label: 'Отзывы' },
];

export function isSortKey(value: unknown): value is SortKey {
  return SORT_OPTIONS.some((o) => o.value === value);
}

export interface OfferFilters {
  search: string;
  fitsAmount: boolean;
  withReviews: boolean;
  noManualCheck: boolean;
}

export const DEFAULT_FILTERS: OfferFilters = { search: '', fitsAmount: false, withReviews: false, noManualCheck: false };

/** Marks that mean a person may check the order or the payer (BestChange marks). */
export const MANUAL_CHECK_MARKS: readonly OfferMark[] = ['manual', 'verifying', 'cardverify'];

/** true / false when known; null when the reserve or the receive amount is unknown. */
export function reserveCovers(offer: Offer): boolean | null {
  if (offer.reserve === null || offer.receiveAmount === null) return null;
  return offer.reserve >= offer.receiveAmount;
}

/** «Подходит под сумму»: limits AND reserve confirmed for the amount. Unknown is not assumed to fit. */
export function fitsConfirmed(offer: Offer): boolean {
  return offer.fitsAmount === true && reserveCovers(offer) === true;
}

export function reviewCount(offer: Offer): number | null {
  const r = offer.exchanger.reviews;
  return r ? r.positive + r.neutral + r.claim + r.closed : null;
}

export function filterOffers(offers: readonly Offer[], filters: OfferFilters): Offer[] {
  const query = filters.search.trim().toLocaleLowerCase('ru');
  return offers.filter((offer) => {
    if (query && !offer.exchanger.name.toLocaleLowerCase('ru').includes(query)) return false;
    if (filters.fitsAmount && !fitsConfirmed(offer)) return false;
    if (filters.withReviews && !((reviewCount(offer) ?? 0) > 0)) return false;
    if (filters.noManualCheck && offer.marks.some((m) => MANUAL_CHECK_MARKS.includes(m))) return false;
    return true;
  });
}

/** null always after known values, whatever the direction. */
function nullsLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

/**
 * Whether an offer can carry the «Лучший курс с учётом комиссий» crown (and the
 * calculator estimate): its receive amount is known, its limits do not exclude
 * the amount and its reserve is not known to be short of the receive amount.
 * Unknown limits or an unknown reserve do not disqualify it.
 */
export function crownEligible(offer: Offer): boolean {
  return offer.receiveAmount !== null && offer.fitsAmount !== false && reserveCovers(offer) !== false;
}

/**
 * Lower RUB per unit is better for the buyer. Ties fall back to the rate, then the name, so the order is stable.
 *
 * «Лучший курс с учётом комиссий» (`best`) puts the offers that can serve the
 * entered amount (crownEligible) first and the rest after them, each group in
 * BestChange rankrate order, so its first row is always the crowned offer.
 * The other sorts are explicit one-column orders («Курс», «Резерв», «Мин. сумма»,
 * «Отзывы») and are NOT grouped: mixing a hidden «fits first» key into them
 * would make e.g. «Мин. сумма» look unsorted. Hiding offers that do not fit is
 * what the «Подходит под сумму» filter is for.
 */
export function sortOffers(offers: readonly Offer[], sort: SortKey): Offer[] {
  const byRate = (a: Offer, b: Offer) => a.rubPerUnit - b.rubPerUnit || a.exchanger.name.localeCompare(b.exchanger.name, 'ru');
  const fitsFirst = (a: Offer, b: Offer) => Number(!crownEligible(a)) - Number(!crownEligible(b));
  const out = [...offers];
  switch (sort) {
    case 'best':
      return out.sort((a, b) => fitsFirst(a, b) || nullsLast(a.rankRubPerUnit, b.rankRubPerUnit, 1) || byRate(a, b));
    case 'rate':
      return out.sort(byRate);
    case 'reserve':
      return out.sort((a, b) => nullsLast(a.reserve, b.reserve, -1) || byRate(a, b));
    case 'min':
      return out.sort((a, b) => nullsLast(a.minRub, b.minRub, 1) || byRate(a, b));
    case 'reviews':
      return out.sort((a, b) => nullsLast(a.exchanger.reviews?.positive ?? null, b.exchanger.reviews?.positive ?? null, -1) || byRate(a, b));
  }
}

/**
 * The offer the calculator's estimate is taken from: best by rate including
 * commissions (rankrate), among offers whose receive amount is known, whose
 * limits do not exclude the amount and whose reserve is not known to be short
 * of the receive amount. null when there is none. Its receiveAmount is at the
 * offer's main rate (BestChange `rate`), without extra exchanger/network fees.
 */
export function bestOffer(offers: readonly Offer[]): Offer | null {
  return sortOffers(offers.filter(crownEligible), 'best')[0] ?? null;
}

export type ResultsStatusKind = 'idle' | 'loading' | 'ok' | ExchangersProblem['kind'];

/**
 * The one short line screen readers hear when the results change (the page's
 * only aria-live region): state, then «Показано N из M» and the update time.
 * The offers list itself is not live, so a refresh never re-reads every row.
 */
export function resultsStatusText(
  kind: ResultsStatusKind,
  counts: { shown: number; total: number },
  updated: string | null,
  delayed: boolean,
): string {
  switch (kind) {
    case 'idle':
      return '';
    case 'loading':
      return 'Загружаем предложения обменников…';
    case 'not_configured':
      return 'Сравнение курсов сейчас недоступно.';
    case 'unavailable':
      return 'Курсы BestChange временно недоступны.';
    case 'rate_limited':
      return 'Слишком много запросов, повторите позже.';
    case 'invalid':
      return 'Проверьте параметры обмена.';
    case 'error':
      return 'Не удалось загрузить предложения.';
    case 'ok': {
      const head =
        counts.total === 0
          ? 'По этому направлению предложений нет.'
          : counts.shown === 0
            ? `Под выбранные фильтры не подходит ни одно из ${counts.total} предложений.`
            : `Показано ${counts.shown} из ${counts.total} предложений.`;
      const time = updated ? ` Обновлено в ${updated}.` : '';
      return `${head}${time}${delayed ? ' Свежие курсы сейчас не получены.' : ''}`;
    }
  }
}

// ---------------------------------------------------------------------------
// BestChange marks (wording from the v0 prototype's marks.ts)
// ---------------------------------------------------------------------------

export interface MarkInfo {
  label: string;
  description: string;
  /** `caution`: can cost the user time, money or an extra check. */
  tone: 'neutral' | 'caution';
}

export const MARK_INFO: Record<OfferMark, MarkInfo> = {
  card2card: { label: 'Карта на карту', description: 'Средства принимаются переводом с карты на карту. Банк может взять свою комиссию.', tone: 'caution' },
  cardverify: { label: 'Верификация карты', description: 'Обменник может потребовать подтвердить банковскую карту.', tone: 'caution' },
  delay: { label: 'Возможна задержка', description: 'Обмен может задерживаться на некоторое время.', tone: 'caution' },
  delivery: { label: 'Доставка', description: 'В выбранном городе нет офиса, стоимость курьера включена в курс.', tone: 'neutral' },
  floating: { label: 'Плавающий курс', description: 'Обменник не фиксирует курс в заявке.', tone: 'caution' },
  manual: { label: 'Ручная обработка', description: 'Заявки обрабатываются вручную или полуавтоматически.', tone: 'neutral' },
  more: { label: 'Разные города', description: 'У обменника есть предложения в разных городах; показан самый выгодный курс.', tone: 'neutral' },
  official: { label: 'Оплата от компании', description: 'Обменник делает банковские переводы от юридического лица.', tone: 'neutral' },
  otherin: { label: 'Приём через сторонние ПС', description: 'Обменник принимает средства через сторонние платёжные системы.', tone: 'caution' },
  otherout: { label: 'Выплата через сторонние ПС', description: 'Обменник переводит средства через сторонние платёжные системы.', tone: 'caution' },
  percent: { label: 'Доп. комиссия', description: 'Обменник берёт дополнительную комиссию.', tone: 'caution' },
  purse: { label: 'Кошелёк', description: 'Кошелёк со встроенным обменником: нужна регистрация, прямого обмена нет.', tone: 'caution' },
  reg: { label: 'Нужна регистрация', description: 'Перед созданием заявки обменник требует регистрацию.', tone: 'caution' },
  unstable: { label: 'Курс скачет', description: 'Обнаружено резкое изменение курса. Будьте осторожны при создании заявки.', tone: 'caution' },
  verifying: { label: 'Проверка документов', description: 'Обменник может потребовать документы или приостановить выплату для проверки.', tone: 'caution' },
  atm: { label: 'Криптомат', description: 'Обмен проходит через криптомат: нужно физически прийти к аппарату в городе.', tone: 'caution' },
  language: { label: 'Другой язык', description: 'Обменник обслуживает клиентов на другом языке.', tone: 'neutral' },
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const UNKNOWN = 'Нет данных';

/** «12:34» in the visitor's time zone, or null for a missing/invalid time. */
export function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
}

/** «1,2 млн» style compact number for reserves. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

/** Rounds DOWN to `decimals` places (tolerating binary noise such as 11.999999999999998), so it never overstates. */
function floorTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f + 1e-9) / f;
}

/** Rounds UP to `decimals` places (tolerating binary noise such as 1000.0000000000001), so it never understates. */
function ceilTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.ceil(value * f - 1e-9) / f;
}

/**
 * Reserve of the receive asset, never overstated and never a positive reserve
 * shown as 0: below 1000 it is rounded down to the asset's display decimals
 * (shared catalogue), and a positive reserve smaller than one display unit is
 * shown as «< 0,000001»; from 1000 up it is the compact form («12,34 тыс.»)
 * rounded down to two places of its unit.
 */
export function formatReserve(value: number, assetId: AssetId): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1000) {
    const group = Math.min(4, Math.floor(Math.log10(value) / 3));
    const unit = 10 ** (3 * group);
    return formatCompact(floorTo(value / unit, 2) * unit);
  }
  const decimals = displayDecimals(assetId);
  const shown = floorTo(value, decimals);
  if (shown === 0 && value > 0) return `< ${formatCrypto(10 ** -decimals, decimals)}`;
  return formatCrypto(shown, decimals);
}

/**
 * «1 000 – 500 000 ₽» for an offer's limits. The minimum is rounded UP and the
 * maximum DOWN, so the shown range never includes an amount the exchanger
 * would reject; whole roubles unless that would empty the range, then kopecks.
 */
export function formatLimits(minRub: number | null, maxRub: number | null): string {
  const whole = minRub === null || maxRub === null || ceilTo(minRub, 0) <= floorTo(maxRub, 0);
  const decimals = whole ? 0 : 2;
  const min = minRub !== null ? formatRub(ceilTo(minRub, decimals), decimals) : '?';
  const max = maxRub !== null ? formatRub(floorTo(maxRub, decimals), decimals) : '?';
  return `${min} – ${max}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

/** Decimals for a RUB-per-unit rate: kopecks below 1000 ₽, whole roubles above. */
export function rateDecimals(rubPerUnitValue: number): number {
  return rubPerUnitValue < 1000 ? 2 : 0;
}

export function displayDecimals(assetId: AssetId): number {
  return findAsset(assetId)?.displayDecimals ?? 4;
}
