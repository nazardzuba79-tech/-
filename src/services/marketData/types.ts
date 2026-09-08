/**
 * The shared vocabulary every market-data consumer speaks.
 *
 * Two things live here, and nothing else:
 *
 *   1. `DataSource` — who a number came from. Not decoration: a mark price
 *      sourced from VOLTEX's own book and one sourced from OKX are
 *      different facts about different venues, and the difference has to
 *      survive all the way to the UI.
 *
 *   2. `Envelope<T>` / `Availability<T>` — the freshness and availability
 *      contract. `ProviderCache` has always tracked `fetchedAt`/`stale`
 *      internally; before this it stopped at the service boundary and the
 *      frontend had no way to tell a live price from a two-minute-old one
 *      served through the stale window. Now it travels with the value.
 *
 * The rule these types exist to enforce, stated once:
 *
 *   a real zero is 0.
 *   no data is `available: false` — never 0, never null-coerced-to-0.
 *   a provider failure inside the stale budget is the last good value with
 *     `stale: true`.
 *   a provider failure outside the stale budget is `available: false`.
 *
 * `Unavailable` deliberately carries NO value-carrying fields. That is not
 * a style choice — it is what makes it impossible for a caller to plot an
 * absent metric as zero, because there is no field there to plot. The same
 * shape `AnalyticsDataService` already uses, lifted here so every surface
 * shares it.
 */

/**
 * Every venue or vendor a number in this system can come from.
 *
 * `voltex` means this exchange's own book, positions or settlement — the
 * only source that is authoritative for VOLTEX financial state. Everything
 * else is reference data about somebody else's market.
 */
export type DataSource =
  | 'kraken'
  | 'coingecko'
  | 'alternative.me'
  | 'twelvedata'
  | 'binance'
  | 'okx'
  | 'voltex';

/** Whether a source describes VOLTEX itself or an external venue. Used to
 *  keep reference derivatives data out of VOLTEX financial calculations —
 *  see `docs/MARKET_DATA_ARCHITECTURE.md`. */
export function isVoltexSource(source: DataSource): boolean {
  return source === 'voltex';
}

export type UnavailableReason =
  | 'provider_unavailable'
  | 'provider_not_configured'
  | 'unsupported_metric'
  | 'no_data';

/**
 * A value plus where it came from and how old it is.
 *
 * `stale: true` means the provider failed and this is the previous good
 * value, still inside its staleness budget. It is deliberately not an
 * error: a 40-second-old market cap is far more useful than a dash. It is
 * also deliberately not silent: the flag reaches the client so a view can
 * dim a number instead of presenting it as live.
 */
export interface Envelope<T> {
  value: T;
  source: DataSource;
  /** When the provider data was actually retrieved (epoch ms). */
  fetchedAt: number;
  /** Served past its TTL because a refresh failed. */
  stale: boolean;
}

/** The wire form of an envelope's metadata, without the value — what gets
 *  attached to a REST response as `meta`. */
export interface EnvelopeMeta {
  source: DataSource;
  fetchedAt: number;
  stale: boolean;
}

export interface Unavailable {
  available: false;
  reason: UnavailableReason;
  /** Short, non-sensitive explanation. Safe to show an operator; never
   *  contains a key, a URL with credentials, or a raw provider body. */
  detail?: string;
}

/** Either the data (with its provenance) or an explicit, value-free
 *  statement that it is not available. */
export type Availability<T> = ({ available: true } & Envelope<T>) | Unavailable;

export function envelope<T>(value: T, source: DataSource, fetchedAt: number, stale: boolean): Envelope<T> {
  return { value, source, fetchedAt, stale };
}

export function meta<T>(e: Envelope<T>): EnvelopeMeta {
  return { source: e.source, fetchedAt: e.fetchedAt, stale: e.stale };
}

export function available<T>(e: Envelope<T>): Availability<T> {
  return { available: true, ...e };
}

export function unavailable(reason: UnavailableReason, detail?: string): Unavailable {
  return detail === undefined ? { available: false, reason } : { available: false, reason, detail };
}

/**
 * What a provider can actually answer. Capabilities are declared, never
 * inferred: asking Twelve Data for an order book or Kraken spot for
 * cross-venue open interest is a programming error, and this makes it one
 * the gateway can refuse in a single place instead of each caller
 * discovering it as a runtime 404.
 */
export type MarketDataCapability =
  | 'asset_catalogue'
  | 'tradable_markets'
  | 'ticker'
  | 'tickers'
  | 'candles'
  | 'order_book'
  | 'recent_trades'
  | 'market_overview'
  | 'sentiment'
  | 'cfd_quotes';

export class CapabilityUnsupportedError extends Error {
  constructor(
    public readonly capability: MarketDataCapability,
    public readonly provider?: string
  ) {
    super(
      provider
        ? `${provider} does not support the "${capability}" capability`
        : `No configured provider supports the "${capability}" capability`
    );
    this.name = 'CapabilityUnsupportedError';
  }
}
