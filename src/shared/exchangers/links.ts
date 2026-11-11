/**
 * Strict outbound-link validators for «Обменники». Only two link shapes ever
 * leave VOLTEX, both on BestChange hosts:
 *   - exchanger link: https://<host>/click.php?id=<changer id>   (changers[].urls)
 *   - direction page: https://www.bestchange.ru/{from}-to-{to}.html[?p=<partner id>]
 * No VOLTEX token, user data or deposit address is ever added (#693).
 *
 * The raw string is screened character by character, parsed with WHATWG URL,
 * and then must round-trip unchanged (`url.href === raw`), so nothing the
 * parser would normalise (case, default port, dot segments, backslashes, IDN,
 * numeric IPs) can slip through. Components are then compared exactly.
 */
import { isUrlname } from './catalog';

export const BESTCHANGE_HOSTS: ReadonlySet<string> = new Set([
  'www.bestchange.ru',
  'bestchange.ru',
  'www.bestchange.com',
  'bestchange.com',
]);

export const DIRECTION_HOST = 'www.bestchange.ru';

const MAX_URL_LENGTH = 2048;
const MAX_ID_DIGITS = 12;

export function isBestChangeHost(host: unknown): boolean {
  return typeof host === 'string' && BESTCHANGE_HOSTS.has(host);
}

function isLowerAlnum(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
}

/** Lower-case DNS name, ≥ 2 labels, alphabetic TLD (so no IPv4), no punycode (xn--) labels, no IPv6. */
function isPlainDnsHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (label[0] === '-' || label[label.length - 1] === '-') return false;
    if (label.startsWith('xn--')) return false;
    for (let i = 0; i < label.length; i++) {
      const ch = label[i];
      if (!isLowerAlnum(ch) && ch !== '-') return false;
    }
  }
  const tld = labels[labels.length - 1];
  for (let i = 0; i < tld.length; i++) if (!(tld[i] >= 'a' && tld[i] <= 'z')) return false;
  return true;
}

/**
 * Parses an absolute https URL in canonical form, or returns null. Rejects:
 * non-strings, > 2048 chars, any whitespace/control/non-ASCII char, backslashes,
 * anything not starting with the literal "https://" (javascript:, data:, http:,
 * protocol-relative "//"), userinfo, any explicit port, IP / punycode / single-label
 * hosts, any fragment ('#'), an empty query ('?'), percent-encoding in the path
 * (e.g. %2F), and any
 * input the URL parser would rewrite.
 */
export function parseStrictHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f) return null;
    if (code === 0x5c /* \ */ || code === 0x23 /* # */) return null;
  }
  if (!raw.startsWith('https://') || raw.startsWith('https:///')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  if (url.hash !== '') return null;
  if (url.search === '' && raw.includes('?')) return null; // bare "?" survives href round-trip
  if (!isPlainDnsHostname(url.hostname)) return null;
  if (url.pathname.includes('%')) return null;
  if (url.href !== raw) return null;
  return url;
}

/** Canonical decimal changer id ("1163"), or null. Accepts a positive safe integer or its canonical string. */
function canonicalChangerId(id: unknown): string | null {
  if (typeof id === 'number') {
    return Number.isSafeInteger(id) && id > 0 && String(id).length <= MAX_ID_DIGITS ? String(id) : null;
  }
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_DIGITS || id[0] === '0') return null;
  for (let i = 0; i < id.length; i++) if (!(id[i] >= '0' && id[i] <= '9')) return null;
  return id;
}

/**
 * True only for `https://<BESTCHANGE_HOSTS>/click.php?id=<changerId>`: path
 * exactly /click.php, query exactly one `id` equal to the decimal changer id,
 * no fragment, userinfo or port.
 */
export function isExchangerClickUrl(url: unknown, changerId: number | string): boolean {
  const id = canonicalChangerId(changerId);
  if (!id) return false;
  const parsed = parseStrictHttpsUrl(url);
  if (!parsed) return false;
  return BESTCHANGE_HOSTS.has(parsed.hostname) && parsed.pathname === '/click.php' && parsed.search === `?id=${id}`;
}

/**
 * Picks the exchanger link from a BestChange `changers[].urls` object: `ru`,
 * falling back to `en`, each only if it passes isExchangerClickUrl. Else null.
 */
export function pickExchangerClickUrl(urls: unknown, changerId: number | string): string | null {
  if (typeof urls !== 'object' || urls === null || Array.isArray(urls)) return null;
  for (const lang of ['ru', 'en']) {
    if (!Object.prototype.hasOwnProperty.call(urls, lang)) continue;
    const candidate = (urls as Record<string, unknown>)[lang];
    if (typeof candidate === 'string' && isExchangerClickUrl(candidate, changerId)) return candidate;
  }
  return null;
}

/** Partner id for `?p=`: 1–12 ASCII digits (string or non-negative safe integer). Else null. */
export function normalizePartnerId(raw: unknown): string | null {
  const s = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : raw;
  if (typeof s !== 'string' || s.length < 1 || s.length > MAX_ID_DIGITS) return null;
  for (let i = 0; i < s.length; i++) if (!(s[i] >= '0' && s[i] <= '9')) return null;
  return s;
}

/** Splits "/{from}-to-{to}.html" into two valid urlnames (any "-to-" split that works). */
export function parseDirectionPath(pathname: string): { from: string; to: string } | null {
  if (!pathname.startsWith('/') || !pathname.endsWith('.html')) return null;
  const body = pathname.slice(1, -'.html'.length);
  let idx = body.indexOf('-to-');
  while (idx !== -1) {
    const from = body.slice(0, idx);
    const to = body.slice(idx + 4);
    if (isUrlname(from) && isUrlname(to)) return { from, to };
    idx = body.indexOf('-to-', idx + 1);
  }
  return null;
}

/**
 * `https://www.bestchange.ru/{from}-to-{to}.html`, with `?p=<partnerId>` when a
 * partner id is given. Returns null for an invalid urlname or an invalid
 * (non-empty) partner id. `undefined`, `null` and '' mean "no partner".
 */
export function buildDirectionUrl(fromUrlname: string, toUrlname: string, partnerId?: string | number | null): string | null {
  if (!isUrlname(fromUrlname) || !isUrlname(toUrlname)) return null;
  let query = '';
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    const p = normalizePartnerId(partnerId);
    if (!p) return null;
    query = `?p=${p}`;
  }
  const url = `https://${DIRECTION_HOST}/${fromUrlname}-to-${toUrlname}.html${query}`;
  return isDirectionUrl(url) ? url : null;
}

/**
 * True only for `https://<BESTCHANGE_HOSTS>/{from}-to-{to}.html` with no query
 * or exactly `?p=<1–12 digits>`; nothing else.
 */
export function isDirectionUrl(url: unknown): boolean {
  const parsed = parseStrictHttpsUrl(url);
  if (!parsed || !BESTCHANGE_HOSTS.has(parsed.hostname)) return false;
  if (!parseDirectionPath(parsed.pathname)) return false;
  if (parsed.search === '') return true;
  if (!parsed.search.startsWith('?p=')) return false;
  return normalizePartnerId(parsed.search.slice(3)) !== null;
}
