/**
 * Best-effort country for a new account, as a convenience only.
 *
 * WHAT THIS IS NOT. It is not identity verification and it is not KYC. An
 * address geolocates to wherever the network says it is, which a VPN, a
 * corporate proxy or mobile carrier routing can move to another continent
 * entirely. Nothing here may ever be surfaced as "verified" — KYC has its own
 * model (KycSubmission.country, declared on a real document and reviewed by a
 * human), and this value must never be confused with it or promoted into it.
 *
 * WHAT IT IS FOR. Saving a new user from picking their country out of a long
 * list when the network already implies the answer. The user's own choice
 * always wins: this only ever fills a country that is still empty, and never
 * rewrites one that has been saved (see `backfillCountry`).
 */

/** ISO 3166-1 alpha-2, or null when nothing trustworthy is available. */
export type CountryCode = string | null;

/**
 * Just the two things this service reads off a request. Structural rather
 * than Express's `Request` so the service carries no framework dependency
 * and a test can hand it a plain object.
 */
export interface CountryRequest {
  get(name: string): string | undefined;
  ip?: string;
}

/**
 * Country headers set by a CDN/edge in front of the app. These are the
 * cheapest and most reliable source when one exists — the edge already
 * resolved the client's address, so there is no lookup, no latency and no
 * third party involved. Checked in this order.
 *
 * Only trustworthy because `trust proxy` is set (see index.ts) and the app is
 * reached through the edge; a header on a direct request is client-controlled,
 * which is why nothing security-relevant is ever derived from it. The worst a
 * forged header can do here is preset the country field the user can change.
 */
const EDGE_COUNTRY_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country',
  'fastly-client-country',
  'x-geo-country',
  'x-country-code',
];

/** Values an edge sends when it could not place the address. */
const UNKNOWN_EDGE_VALUES = new Set(['XX', 'T1', 'ZZ', '']);

/**
 * Accepts only a plausible ISO 3166-1 alpha-2 code and upper-cases it. The
 * column is a 2-character country code (see schema.prisma) and the profile
 * endpoint validates the same shape, so anything else is dropped rather than
 * stored and shown back to the user as their country.
 */
export function normalizeCountry(value: unknown): CountryCode {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (UNKNOWN_EDGE_VALUES.has(code)) return null;
  return code;
}

/** The country an edge already resolved for this request, if any. */
export function countryFromHeaders(req: CountryRequest): CountryCode {
  for (const header of EDGE_COUNTRY_HEADERS) {
    const code = normalizeCountry(req.get(header));
    if (code) return code;
  }
  return null;
}

/** Resolves an IP to a country. Injected, so nothing here is hard-wired to
 *  one provider and tests never touch the network. */
export type CountryLookup = (ip: string) => Promise<CountryCode>;

const LOOKUP_TIMEOUT_MS = 1_500;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 5_000;

/** Addresses no public geolocation service can say anything useful about. */
function isLookupableIp(ip: string): boolean {
  if (!ip) return false;
  const v4 = ip.replace(/^::ffff:/, '');
  if (v4 === '127.0.0.1' || v4 === '::1' || v4 === '0.0.0.0') return false;
  if (/^10\./.test(v4)) return false;
  if (/^192\.168\./.test(v4)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return false;
  if (/^169\.254\./.test(v4)) return false;
  if (/^(f[cd])/i.test(ip)) return false; // unique-local IPv6
  return true;
}

/**
 * An optional HTTP resolver, built only when GEOIP_LOOKUP_URL is configured.
 *
 * Deliberately opt-in and provider-agnostic: the URL carries a `{ip}`
 * placeholder, so a deployment can point it at whichever service it already
 * pays for (or none at all) without this file knowing anything about them.
 * No key ever reaches the browser — this runs server-side only. When the
 * variable is unset the whole path is off and header detection stands alone.
 */
export function httpCountryLookup(urlTemplate = process.env.GEOIP_LOOKUP_URL): CountryLookup | null {
  if (!urlTemplate) return null;
  return async (ip: string): Promise<CountryCode> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(urlTemplate.replace('{ip}', encodeURIComponent(ip)), {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (!body || typeof body !== 'object') return null;
      // The common response shapes, without committing to a provider.
      const record = body as Record<string, unknown>;
      return (
        normalizeCountry(record.country_code) ??
        normalizeCountry(record.countryCode) ??
        normalizeCountry(record.country)
      );
    } catch {
      // Timeout, DNS failure, malformed body — all the same answer: unknown.
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Header first, then the optional lookup, with a short TTL cache keyed by IP.
 *
 * Never throws and never rejects: every caller treats "no country" as a
 * perfectly normal outcome, so a failure here can never affect whether a
 * registration or a login succeeds.
 */
export class CountryDetectionService {
  private readonly cache = new Map<string, { code: CountryCode; at: number }>();

  constructor(private readonly lookup: CountryLookup | null = httpCountryLookup()) {}

  async detect(req: CountryRequest): Promise<CountryCode> {
    const fromEdge = countryFromHeaders(req);
    if (fromEdge) return fromEdge;

    const ip = req.ip ?? '';
    if (!this.lookup || !isLookupableIp(ip)) return null;

    const hit = this.cache.get(ip);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.code;

    let code: CountryCode = null;
    try {
      code = normalizeCountry(await this.lookup(ip));
    } catch {
      code = null;
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Cheap bound: drop the oldest insertion rather than growing forever.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(ip, { code, at: Date.now() });
    return code;
  }
}
