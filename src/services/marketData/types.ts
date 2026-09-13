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
  | 'bybit'
  | 'deribit'
  | 'coinglass'
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

export interface Envelope<T> {
  value: T;
  source: DataSource;
  /** Epoch ms when the provider produced (or we received) this reading. */
  fetchedAt: number;
  /** True means `value` is the last known good reading after a refresh
   *  failed. It is still real data; it is just older than its normal TTL. */
  stale: boolean;
}

export interface Unavailable {
  available: false;
  reason: UnavailableReason;
  detail?: string;
}

export type Availability<T> = ({ available: true } & Envelope<T>) | Unavailable;

/** Construct the value-carrying arm without allowing availability metadata
 *  to drift between callers. */
export function available<T>(envelope: Envelope<T>): Availability<T> {
  return { available: true, ...envelope };
}

/** Construct the value-free arm. There is intentionally no value parameter. */
export function unavailable(reason: UnavailableReason, detail?: string): Unavailable {
  return detail === undefined ? { available: false, reason } : { available: false, reason, detail };
}
