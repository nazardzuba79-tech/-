import { ProviderCache } from '../ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from '../ProviderHealth';
import { numeric, type VenueBasis, type VenueFunding, type VenueOpenInterest } from './types';

/**
 * OKX v5 public derivatives market data.
 *
 * Public, unauthenticated endpoints only — no key, no passphrase, no
 * signature, and no environment variable read anywhere in this file.
 *
 * Endpoint families:
 *
 *   GET /api/v5/public/open-interest?instType=SWAP&instId=…
 *   GET /api/v5/public/funding-rate?instId=…
 *   GET /api/v5/public/mark-price?instType=SWAP&instId=…
 *   GET /api/v5/market/index-tickers?instId=…
 *
 * ── The v5 envelope ─────────────────────────────────────────────────
 *
 * OKX answers HTTP 200 with `{ code, msg, data: [...] }` and signals
 * failure in `code` rather than in the status line. A client that only
 * checks `res.ok` would therefore treat an error as success and read
 * `data[0]` off an empty array. Every read here goes through `rows()`,
 * which requires `code === '0'` and a non-empty `data`, so an OKX-level
 * error becomes a thrown error the circuit and the cache can see.
 *
 * ── Long/short positioning ──────────────────────────────────────────
 *
 * Not implemented for OKX. Its public API does not expose an equivalent
 * of Binance's global/top account and position ratios, and inventing a
 * comparable figure from other endpoints would be exactly the kind of
 * derived-and-relabelled number this page exists not to publish. The
 * positioning module is therefore labelled Binance-only rather than
 * pretending to be cross-venue.
 *
 * NOT verified against the live API from this sandbox: the egress proxy
 * returns a 403 policy denial for CONNECT to www.okx.com. Covered by
 * deterministic mocked tests; see the production-verification list.
 */

export class OkxDerivativesError extends Error {}

const DEFAULT_BASE_URL = 'https://www.okx.com';

const OPEN_INTEREST_TTL_MS = 15_000;
const OPEN_INTEREST_STALE_MS = 120_000;
const FUNDING_TTL_MS = 60_000;
const FUNDING_STALE_MS = 600_000;
const PRICE_TTL_MS = 15_000;
const PRICE_STALE_MS = 120_000;

/** Base asset -> OKX perpetual swap instrument. Explicit, for the same
 *  reason as Binance's map: a generated id can name a contract that does
 *  not exist. */
const SWAP: Record<string, string> = {
  BTC: 'BTC-USDT-SWAP',
  ETH: 'ETH-USDT-SWAP',
  SOL: 'SOL-USDT-SWAP',
  XRP: 'XRP-USDT-SWAP',
  DOGE: 'DOGE-USDT-SWAP',
  ADA: 'ADA-USDT-SWAP',
  AVAX: 'AVAX-USDT-SWAP',
  LINK: 'LINK-USDT-SWAP',
  LTC: 'LTC-USDT-SWAP',
};

/** The spot index an OKX swap is marked against. */
const INDEX: Record<string, string> = {
  BTC: 'BTC-USDT',
  ETH: 'ETH-USDT',
  SOL: 'SOL-USDT',
  XRP: 'XRP-USDT',
  DOGE: 'DOGE-USDT',
  ADA: 'ADA-USDT',
  AVAX: 'AVAX-USDT',
  LINK: 'LINK-USDT',
  LTC: 'LTC-USDT',
};

export function okxContractFor(baseAsset: string): string | null {
  return SWAP[baseAsset.toUpperCase()] ?? null;
}

interface OkxOpenInterestRow {
  openInterestBase: number | null;
  openInterestUsd: number | null;
}

export class OkxDerivativesService {
  private readonly http: HttpProviderClient;
  private readonly health: ProviderHealth;
  private readonly openInterestCache: ProviderCache<OkxOpenInterestRow>;
  private readonly fundingCache: ProviderCache<{ fundingRate: number | null; nextFundingTime: number | null; fundingTime: number | null }>;
  private readonly markCache: ProviderCache<number | null>;
  private readonly indexCache: ProviderCache<number | null>;

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    options: { fetchFn?: typeof fetch; policy?: ProviderRequestPolicy; now?: () => number } = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('okx-derivatives', { onStateChange: logCircuitTransition, now: options.now })
    );
    this.http = new HttpProviderClient('OKX Derivatives', {
      health: this.health,
      fetchFn: options.fetchFn,
      now: options.now,
      retries: options.policy?.retries,
      baseDelayMs: options.policy?.baseDelayMs,
      maxDelayMs: options.policy?.maxDelayMs,
      sleep: options.policy?.sleep,
      wrapError: (message) => new OkxDerivativesError(message),
    });
    const cache = { now: options.now, maxEntries: 60 };
    this.openInterestCache = new ProviderCache({ ttlMs: OPEN_INTEREST_TTL_MS, maxStaleMs: OPEN_INTEREST_STALE_MS, ...cache });
    this.fundingCache = new ProviderCache({ ttlMs: FUNDING_TTL_MS, maxStaleMs: FUNDING_STALE_MS, ...cache });
    this.markCache = new ProviderCache({ ttlMs: PRICE_TTL_MS, maxStaleMs: PRICE_STALE_MS, ...cache });
    this.indexCache = new ProviderCache({ ttlMs: PRICE_TTL_MS, maxStaleMs: PRICE_STALE_MS, ...cache });
  }

  async getOpenInterest(baseAsset: string): Promise<VenueOpenInterest | null> {
    const contract = okxContractFor(baseAsset);
    if (contract === null) return null;
    const cached = await this.openInterestCache.fetch(contract, async () => {
      const row = await this.row(
        `/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(contract)}`
      );
      // `oiCcy` is open interest denominated in the base currency; `oiUsd`
      // is the notional when OKX supplies it. `oi` alone is a CONTRACT
      // count, which is not comparable with Binance's base units, so it is
      // deliberately not used as a base figure.
      return {
        openInterestBase: numeric(row.oiCcy),
        openInterestUsd: numeric(row.oiUsd),
      };
    });
    return {
      venue: 'okx',
      contract,
      baseAsset: baseAsset.toUpperCase(),
      openInterestBase: cached.value.openInterestBase,
      openInterestUsd: cached.value.openInterestUsd,
      fetchedAt: cached.fetchedAt,
      stale: cached.stale,
    };
  }

  async getFunding(baseAsset: string): Promise<VenueFunding | null> {
    const contract = okxContractFor(baseAsset);
    if (contract === null) return null;
    const cached = await this.fundingCache.fetch(contract, async () => {
      const row = await this.row(`/api/v5/public/funding-rate?instId=${encodeURIComponent(contract)}`);
      return {
        fundingRate: numeric(row.fundingRate),
        nextFundingTime: numeric(row.nextFundingTime),
        fundingTime: numeric(row.fundingTime),
      };
    });
    const { fundingTime, nextFundingTime } = cached.value;
    return {
      venue: 'okx',
      contract,
      fundingRate: cached.value.fundingRate,
      nextFundingTime,
      // Derived from the venue's OWN two timestamps rather than assumed:
      // if OKX tells us this settlement and the next one, the cadence is
      // arithmetic, not convention. Null when it cannot be computed.
      intervalHours:
        fundingTime !== null && nextFundingTime !== null && nextFundingTime > fundingTime
          ? Math.round((nextFundingTime - fundingTime) / 3_600_000)
          : null,
      fetchedAt: cached.fetchedAt,
      stale: cached.stale,
    };
  }

  async getBasis(baseAsset: string): Promise<VenueBasis | null> {
    const contract = okxContractFor(baseAsset);
    const index = INDEX[baseAsset.toUpperCase()];
    if (contract === null || index === undefined) return null;

    // Independent reads: a failed index must not erase a real mark price.
    const [mark, idx] = await Promise.all([
      this.markCache
        .fetch(contract, async () =>
          numeric((await this.row(`/api/v5/public/mark-price?instType=SWAP&instId=${encodeURIComponent(contract)}`)).markPx)
        )
        .catch(() => null),
      this.indexCache
        .fetch(index, async () =>
          numeric((await this.row(`/api/v5/market/index-tickers?instId=${encodeURIComponent(index)}`)).idxPx)
        )
        .catch(() => null),
    ]);

    if (mark === null && idx === null) return null;
    const markPrice = mark?.value ?? null;
    const indexPrice = idx?.value ?? null;
    return {
      venue: 'okx',
      contract,
      markPrice,
      indexPrice,
      basisPercent:
        markPrice !== null && indexPrice !== null && indexPrice !== 0
          ? ((markPrice - indexPrice) / indexPrice) * 100
          : null,
      fetchedAt: Math.min(mark?.fetchedAt ?? Infinity, idx?.fetchedAt ?? Infinity),
      stale: Boolean(mark?.stale || idx?.stale),
    };
  }

  /**
   * One `data[0]` row, with the v5 envelope enforced.
   *
   * `code !== '0'` is a provider failure even though the HTTP status was
   * 200, and an empty `data` is not a zero — both throw so the circuit
   * opens and the cache can serve a last-good value instead of a fiction.
   */
  private async row(path: string): Promise<Record<string, unknown>> {
    const body = (await this.http.getJson(`${this.baseUrl}${path}`)) as {
      code?: unknown;
      msg?: unknown;
      data?: unknown;
    };
    if (!body || typeof body !== 'object') throw new OkxDerivativesError('OKX returned a malformed body');
    if (String(body.code ?? '') !== '0') {
      // The venue's own message is short and non-sensitive; it never
      // carries a credential because this client never sends one.
      throw new OkxDerivativesError(`OKX responded with code ${String(body.code)}`);
    }
    const data = body.data;
    if (!Array.isArray(data) || data.length === 0) throw new OkxDerivativesError('OKX returned no rows');
    const row = data[0];
    if (!row || typeof row !== 'object') throw new OkxDerivativesError('OKX returned a malformed row');
    return row as Record<string, unknown>;
  }
}
