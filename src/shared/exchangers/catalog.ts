/**
 * «Обменники» catalogue: the RUB payment methods and the receive asset/network
 * pairs VOLTEX offers, plus pure resolvers that map them onto the live
 * BestChange `currencies` directory.
 *
 * BestChange numeric currency ids are NEVER hard-coded here. The `match` rules
 * below are candidate `code`/`urlname` values; they are matched against the
 * live directory at runtime (crypto === true, cash === false) and any pair that
 * does not match exactly one currency is hidden. Nothing is guessed.
 */
import type { AssetId, BestChangeCurrencyLike, MethodKind, NetworkId } from './types';

// ---------------------------------------------------------------------------
// RUB methods
// ---------------------------------------------------------------------------

export interface RubMethod {
  id: string;
  /** BestChange `urlname` of the RUB currency (also used in direction URLs). */
  urlname: string;
  label: string;
  kind: MethodKind;
}

/** Fixed set, docs/EXCHANGERS_694.md "RUB methods". Shown only if the live directory has the urlname. */
export const RUB_METHODS: readonly RubMethod[] = [
  // Labels of the two generic directions are BestChange's own names for them (page titles checked 2026-11-11):
  // `sbp` is «Карта и СБП без P2P», `visa-mastercard-rub` is «Карта банка и СБП».
  { id: 'sbp', urlname: 'sbp', label: 'Карта и СБП без P2P', kind: 'payment_system' },
  { id: 'sberbank', urlname: 'sberbank', label: 'Сбербанк', kind: 'bank' },
  { id: 'tbank', urlname: 'tinkoff', label: 'Т-Банк', kind: 'bank' },
  { id: 'alfabank', urlname: 'alfaclick', label: 'Альфа-Банк', kind: 'bank' },
  { id: 'vtb', urlname: 'vtb', label: 'ВТБ', kind: 'bank' },
  { id: 'card', urlname: 'visa-mastercard-rub', label: 'Карта банка и СБП', kind: 'card' },
  { id: 'mir', urlname: 'mir', label: 'Карта Мир', kind: 'card' },
];

/** BestChange `urlname` shape (also the only shape allowed into a direction URL). */
export const URLNAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isUrlname(value: unknown): value is string {
  return typeof value === 'string' && URLNAME_PATTERN.test(value);
}

export const DYNAMIC_METHOD_PREFIX = 'bc-';

/** Id for a dynamic RUB method that is not in RUB_METHODS. */
export function dynamicMethodId(urlname: string): string {
  return `${DYNAMIC_METHOD_PREFIX}${urlname}`;
}

/** True for a fixed RUB_METHODS id or a well-formed `bc-<urlname>` id. Shape only. */
export function isMethodIdShape(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (RUB_METHODS.some((m) => m.id === value)) return true;
  return value.startsWith(DYNAMIC_METHOD_PREFIX) && isUrlname(value.slice(DYNAMIC_METHOD_PREFIX.length));
}

export function findRubMethod(id: string): RubMethod | undefined {
  return RUB_METHODS.find((m) => m.id === id);
}

// JS `\b` is ASCII-only even with the `u` flag, so «Мир» needs an explicit Unicode letter boundary.
const CARD_NAME = /карт|card|visa|mastercard|(?:^|[^\p{L}])мир(?:[^\p{L}]|$)|\bmir\b/iu;
const PAYMENT_SYSTEM_NAME = /сбп|\bsbp\b|qiwi|юmoney|yoomoney|кошел[её]к|wallet|payeer|webmoney|advcash|perfect money/iu;

/** Kind of a dynamic extra: `bank` unless its BestChange name says card or payment system. */
export function inferMethodKind(name: string): MethodKind {
  if (CARD_NAME.test(name)) return 'card';
  if (PAYMENT_SYSTEM_NAME.test(name)) return 'payment_system';
  return 'bank';
}

export interface ResolvedRubMethod extends RubMethod {
  currencyId: number;
  /** True for RUB_METHODS entries, false for dynamic extras. */
  fixed: boolean;
}

function isFiatNonCash(c: BestChangeCurrencyLike): boolean {
  return c.crypto === false && c.cash === false;
}

const MAX_LABEL_LENGTH = 80;

/**
 * RUB methods present in the live directory: every RUB_METHODS entry whose
 * urlname exists as a non-crypto, non-cash currency, then every other
 * non-crypto, non-cash currency whose `code` ends in `RUB`, labelled with the
 * API's own `name`. Cash is excluded (it needs a city id). Each currency id is
 * used at most once. Availability (rate rows exist) is decided by the caller.
 */
export function resolveRubMethods(currencies: readonly BestChangeCurrencyLike[]): ResolvedRubMethod[] {
  const out: ResolvedRubMethod[] = [];
  const usedIds = new Set<number>();
  const usedUrlnames = new Set<string>();
  for (const method of RUB_METHODS) {
    const c = currencies.find((x) => x.urlname === method.urlname && isFiatNonCash(x));
    usedUrlnames.add(method.urlname);
    if (!c || usedIds.has(c.id)) continue;
    usedIds.add(c.id);
    out.push({ ...method, currencyId: c.id, fixed: true });
  }
  for (const c of currencies) {
    if (!isFiatNonCash(c) || usedIds.has(c.id) || usedUrlnames.has(c.urlname)) continue;
    if (typeof c.code !== 'string' || !c.code.toUpperCase().endsWith('RUB')) continue;
    if (!isUrlname(c.urlname)) continue;
    const label = typeof c.name === 'string' ? c.name.trim() : '';
    if (!label || label.length > MAX_LABEL_LENGTH) continue;
    usedIds.add(c.id);
    usedUrlnames.add(c.urlname);
    out.push({ id: dynamicMethodId(c.urlname), urlname: c.urlname, label, kind: inferMethodKind(label), currencyId: c.id, fixed: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Receive assets and networks
// ---------------------------------------------------------------------------

export interface Network {
  id: NetworkId;
  label: string;
}

/** Candidate BestChange identifiers for one asset/network pair (see file header). */
export interface CurrencyMatchRule {
  /** Matched against `currencies[].code` (primary), case-insensitive, exact. */
  codes: readonly string[];
  /** Matched against `currencies[].urlname` (fallback), exact. */
  urlnames: readonly string[];
}

export interface AssetNetwork {
  networkId: NetworkId;
  /** True for the network's native coin (TRX on TRON), false for a token (USDT TRC-20). */
  native: boolean;
  /** Token standard, tokens only. */
  standard?: string;
  /** Display label, e.g. "USDT TRC-20" or "TRX". */
  label: string;
  match: CurrencyMatchRule;
}

export interface CryptoAsset {
  id: AssetId;
  name: string;
  /** Decimal places used when displaying amounts of this asset. */
  displayDecimals: number;
  networks: readonly AssetNetwork[];
}

export const NETWORKS: Readonly<Record<NetworkId, Network>> = {
  tron: { id: 'tron', label: 'TRON' },
  ethereum: { id: 'ethereum', label: 'Ethereum' },
  bsc: { id: 'bsc', label: 'BNB Smart Chain' },
  ton: { id: 'ton', label: 'TON' },
  bitcoin: { id: 'bitcoin', label: 'Bitcoin' },
  litecoin: { id: 'litecoin', label: 'Litecoin' },
  solana: { id: 'solana', label: 'Solana' },
};

// Candidate codes/urlnames: matched against the live directory, unmatched pairs are hidden.
export const ASSETS: readonly CryptoAsset[] = [
  {
    id: 'USDT',
    name: 'Tether',
    displayDecimals: 2,
    networks: [
      { networkId: 'tron', native: false, standard: 'TRC-20', label: 'USDT TRC-20', match: { codes: ['USDTTRC20'], urlnames: ['tether-trc20'] } },
      { networkId: 'ethereum', native: false, standard: 'ERC-20', label: 'USDT ERC-20', match: { codes: ['USDTERC20'], urlnames: ['tether-erc20'] } },
      { networkId: 'bsc', native: false, standard: 'BEP-20', label: 'USDT BEP-20', match: { codes: ['USDTBEP20'], urlnames: ['tether-bep20'] } },
      { networkId: 'ton', native: false, standard: 'Jetton', label: 'USDT TON', match: { codes: ['USDTTON'], urlnames: ['tether-ton'] } },
    ],
  },
  { id: 'BTC', name: 'Bitcoin', displayDecimals: 6, networks: [{ networkId: 'bitcoin', native: true, label: 'BTC', match: { codes: ['BTC'], urlnames: ['bitcoin'] } }] },
  { id: 'ETH', name: 'Ethereum', displayDecimals: 5, networks: [{ networkId: 'ethereum', native: true, label: 'ETH', match: { codes: ['ETH'], urlnames: ['ethereum'] } }] },
  { id: 'TRX', name: 'Tron', displayDecimals: 2, networks: [{ networkId: 'tron', native: true, label: 'TRX', match: { codes: ['TRX'], urlnames: ['tron'] } }] },
  { id: 'TON', name: 'Toncoin', displayDecimals: 3, networks: [{ networkId: 'ton', native: true, label: 'TON', match: { codes: ['TON'], urlnames: ['ton', 'toncoin'] } }] },
  {
    id: 'USDC',
    name: 'USD Coin',
    displayDecimals: 2,
    networks: [
      { networkId: 'ethereum', native: false, standard: 'ERC-20', label: 'USDC ERC-20', match: { codes: ['USDCERC20'], urlnames: ['usd-coin-erc20'] } },
      { networkId: 'solana', native: false, standard: 'SPL', label: 'USDC SPL', match: { codes: ['USDCSOL'], urlnames: ['usd-coin-sol'] } },
    ],
  },
  { id: 'LTC', name: 'Litecoin', displayDecimals: 4, networks: [{ networkId: 'litecoin', native: true, label: 'LTC', match: { codes: ['LTC'], urlnames: ['litecoin'] } }] },
  { id: 'SOL', name: 'Solana', displayDecimals: 4, networks: [{ networkId: 'solana', native: true, label: 'SOL', match: { codes: ['SOL'], urlnames: ['solana'] } }] },
];

export function isAssetId(value: unknown): value is AssetId {
  return typeof value === 'string' && ASSETS.some((a) => a.id === value);
}

export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NETWORKS, value);
}

/** `${assetId}:${networkId}`, e.g. "USDT:tron" vs "TRX:tron". */
export function pairKey(assetId: AssetId, networkId: NetworkId): string {
  return `${assetId}:${networkId}`;
}

export function findAsset(id: string): CryptoAsset | undefined {
  return ASSETS.find((a) => a.id === id);
}

export function findAssetNetwork(assetId: string, networkId: string): AssetNetwork | undefined {
  return findAsset(assetId)?.networks.find((n) => n.networkId === networkId);
}

export function isSupportedPair(assetId: unknown, networkId: unknown): boolean {
  return typeof assetId === 'string' && typeof networkId === 'string' && findAssetNetwork(assetId, networkId) !== undefined;
}

/** "TRON (Native)" for TRX, "TRON (TRC-20)" for USDT; bare network label for an unknown pair. */
export function networkLabel(assetId: AssetId, networkId: NetworkId): string {
  const base = NETWORKS[networkId]?.label ?? networkId;
  const entry = findAssetNetwork(assetId, networkId);
  if (!entry) return base;
  return entry.native ? `${base} (Native)` : `${base} (${entry.standard ?? 'Token'})`;
}

export interface ReceivePair {
  key: string;
  assetId: AssetId;
  networkId: NetworkId;
  label: string;
  native: boolean;
  standard?: string;
  displayDecimals: number;
  match: CurrencyMatchRule;
}

/** ASSETS flattened into asset/network pairs, catalogue order. */
export const RECEIVE_PAIRS: readonly ReceivePair[] = ASSETS.flatMap((a) =>
  a.networks.map((n) => ({
    key: pairKey(a.id, n.networkId),
    assetId: a.id,
    networkId: n.networkId,
    label: n.label,
    native: n.native,
    ...(n.standard ? { standard: n.standard } : {}),
    displayDecimals: a.displayDecimals,
    match: n.match,
  })),
);

function matchPair(pair: ReceivePair, candidates: readonly BestChangeCurrencyLike[]): BestChangeCurrencyLike | undefined {
  for (const code of pair.match.codes) {
    const want = code.toUpperCase();
    const hit = candidates.filter((c) => typeof c.code === 'string' && c.code.toUpperCase() === want);
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return undefined; // ambiguous code: hide, never guess
  }
  for (const urlname of pair.match.urlnames) {
    const hit = candidates.filter((c) => c.urlname === urlname);
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return undefined;
  }
  return undefined;
}

/**
 * Maps each catalogue pair to exactly one live crypto currency. Only
 * `crypto === true && cash === false` currencies with a valid urlname are
 * considered; `code` is tried first, then `urlname`. A currency id claimed by
 * more than one pair is dropped for all of them, so e.g. TRX:tron and USDT:tron
 * can never share a BestChange currency. Unmatched pairs are absent.
 */
export function resolveReceiveCurrencies(currencies: readonly BestChangeCurrencyLike[]): Map<string, BestChangeCurrencyLike> {
  const candidates = currencies.filter(
    (c) => c.crypto === true && c.cash === false && Number.isSafeInteger(c.id) && c.id > 0 && isUrlname(c.urlname),
  );
  const claimed = new Map<string, BestChangeCurrencyLike>();
  const owners = new Map<number, number>();
  for (const pair of RECEIVE_PAIRS) {
    const c = matchPair(pair, candidates);
    if (!c) continue;
    claimed.set(pair.key, c);
    owners.set(c.id, (owners.get(c.id) ?? 0) + 1);
  }
  const out = new Map<string, BestChangeCurrencyLike>();
  for (const [key, c] of claimed) if (owners.get(c.id) === 1) out.set(key, c);
  return out;
}
