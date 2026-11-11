/**
 * Strict parsers for the three BestChange API v2 payloads «Обменники» uses
 * (shapes from https://bestchange.app/en/openapi.yaml, components.schemas).
 *
 * A payload whose ROOT is wrong throws BestChangeError('upstream') (fixed
 * message, nothing from the body). An individual ROW that is wrong is dropped,
 * so one odd entry cannot take the whole comparison down, and nothing
 * unvalidated is ever passed on.
 */
import type { BestChangeCurrencyLike, ExchangerReviews, OfferMark } from '../../shared/exchangers/types';
import { isOfferMark } from '../../shared/exchangers/types';
import { parseBcDecimal } from '../../shared/exchangers/normalize';
import { BestChangeError } from './errors';

const MAX_CURRENCIES = 10_000;
const MAX_CHANGERS = 10_000;
const MAX_RATE_ROWS_PER_PAIR = 2_000;
const MAX_TEXT = 200;

export interface BestChangeCurrency extends BestChangeCurrencyLike {
  viewname: string | null;
}

export interface BestChangeChanger {
  id: number;
  name: string;
  active: boolean;
  rating: number | null;
  reviews: ExchangerReviews | null;
  /** Raw `urls` (lang → url) restricted to string values; validated later by the shared link checks. */
  urls: Readonly<Record<string, string>>;
}

export interface BestChangeRateRow {
  changer: number;
  /** Raw numbers as BestChange sent them (orientation is normalised by the service). */
  rate: number;
  rankrate: number | null;
  reserve: number | null;
  inmin: number | null;
  inmax: number | null;
  marks: OfferMark[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Printable single-line text, trimmed, 1..MAX_TEXT chars; otherwise null. */
function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(trimmed)) return null;
  return trimmed;
}

/** Non-negative integer counter from a number or a numeric string ("390"). */
function counter(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function rootArray(json: unknown, key: string, max: number): unknown[] {
  if (!isRecord(json)) throw new BestChangeError('upstream');
  const list = own(json, key);
  if (!Array.isArray(list) || list.length > max) throw new BestChangeError('upstream');
  return list;
}

/** `GET /v2/{key}/currencies/{lang}` → `{ currencies: Currency[] }`. */
export function parseCurrencies(json: unknown): BestChangeCurrency[] {
  const out: BestChangeCurrency[] = [];
  const seen = new Set<number>();
  for (const item of rootArray(json, 'currencies', MAX_CURRENCIES)) {
    if (!isRecord(item)) continue;
    const id = own(item, 'id');
    const name = cleanText(own(item, 'name'));
    const urlname = own(item, 'urlname');
    const code = own(item, 'code');
    const crypto = own(item, 'crypto');
    const cash = own(item, 'cash');
    if (!isPositiveId(id) || seen.has(id) || name === null) continue;
    if (typeof urlname !== 'string' || urlname.length === 0 || urlname.length > MAX_TEXT) continue;
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_TEXT) continue;
    if (typeof crypto !== 'boolean' || typeof cash !== 'boolean') continue;
    seen.add(id);
    out.push({ id, name, urlname, code, crypto, cash, viewname: cleanText(own(item, 'viewname')) });
  }
  return out;
}

function parseReviews(value: unknown): ExchangerReviews | null {
  if (!isRecord(value)) return null;
  const positive = counter(own(value, 'positive'));
  const neutral = counter(own(value, 'neutral'));
  const claim = counter(own(value, 'claim'));
  const closed = counter(own(value, 'closed'));
  if (positive === null || neutral === null || claim === null || closed === null) return null;
  return { positive, neutral, claim, closed };
}

function parseRating(value: unknown): number | null {
  const n = typeof value === 'string' ? parseBcDecimal(value) : typeof value === 'number' ? value : null;
  return n !== null && Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

function parseUrls(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const lang of ['ru', 'en']) {
    const url = own(value, lang);
    if (typeof url === 'string' && url.length <= 2048) out[lang] = url;
  }
  return out;
}

/** `GET /v2/{key}/changers/{lang}` → `{ changers: Changer[] }`, keyed by changer id. */
export function parseChangers(json: unknown): Map<number, BestChangeChanger> {
  const out = new Map<number, BestChangeChanger>();
  for (const item of rootArray(json, 'changers', MAX_CHANGERS)) {
    if (!isRecord(item)) continue;
    const id = own(item, 'id');
    const name = cleanText(own(item, 'name'));
    if (!isPositiveId(id) || out.has(id) || name === null) continue;
    out.set(id, {
      id,
      name,
      // Only an explicit `true` counts: the docs say active === "participates in monitoring".
      active: own(item, 'active') === true,
      rating: parseRating(own(item, 'rating')),
      reviews: parseReviews(own(item, 'reviews')),
      urls: parseUrls(own(item, 'urls')),
    });
  }
  return out;
}

const PAIR_KEY = /^([1-9]\d{0,9})-([1-9]\d{0,9})$/;

/** "12-34" → [12, 34]; anything else (city triples, junk) → null. */
export function parsePairKey(key: string): readonly [number, number] | null {
  const m = PAIR_KEY.exec(key);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) ? [from, to] : null;
}

function parseRateRow(item: unknown): BestChangeRateRow | null {
  if (!isRecord(item)) return null;
  const changer = own(item, 'changer');
  const rate = parseBcDecimal(own(item, 'rate'));
  if (!isPositiveId(changer) || rate === null) return null;
  const marksRaw = own(item, 'marks');
  const marks: OfferMark[] = [];
  if (Array.isArray(marksRaw)) {
    for (const mark of marksRaw) if (isOfferMark(mark) && !marks.includes(mark)) marks.push(mark);
  }
  return {
    changer,
    rate,
    rankrate: parseBcDecimal(own(item, 'rankrate')),
    reserve: parseBcDecimal(own(item, 'reserve')),
    inmin: parseBcDecimal(own(item, 'inmin')),
    inmax: parseBcDecimal(own(item, 'inmax')),
    marks,
  };
}

/**
 * `GET /v2/{key}/rates/{a-b+c-d…}` → `{ rates: { "<from>-<to>": ExchangeRate[] } }`.
 * Returns a map keyed by the canonical "from-to" string. Keys of any other shape
 * are ignored. An empty `rates` array is accepted as "no rows" (an empty map
 * serialised by a PHP-style encoder).
 */
export function parseRates(json: unknown): Map<string, BestChangeRateRow[]> {
  if (!isRecord(json)) throw new BestChangeError('upstream');
  const rates = own(json, 'rates');
  const out = new Map<string, BestChangeRateRow[]>();
  if (Array.isArray(rates) && rates.length === 0) return out;
  if (!isRecord(rates)) throw new BestChangeError('upstream');
  for (const key of Object.keys(rates)) {
    const pair = parsePairKey(key);
    const list = rates[key];
    if (!pair || !Array.isArray(list)) continue;
    const rows: BestChangeRateRow[] = [];
    for (const item of list.slice(0, MAX_RATE_ROWS_PER_PAIR)) {
      const row = parseRateRow(item);
      if (row) rows.push(row);
    }
    out.set(`${pair[0]}-${pair[1]}`, rows);
  }
  return out;
}
