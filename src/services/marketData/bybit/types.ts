/**
 * Provider-neutral market-universe types.
 *
 * These describe an INSTRUMENT — a thing that exists and can be quoted —
 * and deliberately not a price. The universe changes on the timescale of
 * listings; prices change every second. Keeping them in separate types is
 * what lets the universe be cached for minutes while tickers are cached
 * for seconds, and what stops a price outage from emptying the exchange.
 *
 * Nothing here is Bybit-shaped. The Bybit adapter produces these; the
 * registries and the API consume these. A second provider slots in by
 * producing the same shapes.
 */

/** What kind of market an instrument is. Kept explicit rather than
 *  inferred from the symbol string: a dated future and a perpetual can
 *  share a base asset and must never share an execution path. */
export type MarketType =
  | 'spot'
  /** USDT/USDC-settled perpetual swap. No expiry. */
  | 'linear_perpetual'
  /** USDT/USDC-settled DATED future. Has an expiry and a delivery price. */
  | 'linear_futures'
  /** Coin-margined. VOLTEX has no inverse engine; carried for completeness
   *  so an inverse contract can never be silently read as a linear one. */
  | 'inverse' // Legacy wire compatibility only; new adapters emit explicit types.
  | 'inverse_perpetual'
  | 'inverse_futures';

/** Whether the venue is currently matching orders on the instrument.
 *  `PreLaunch` in particular is NOT tradable and must never be admitted. */
export type InstrumentStatus = 'Trading' | 'PreLaunch' | 'Delivering' | 'Closed' | 'Settling' | 'Unknown';

/**
 * Order-entry constraints, as published by the venue.
 *
 * Every field is `number | null`. Null means the venue did not publish it,
 * and null must never be read as zero — a zero tick size or a zero minimum
 * quantity would each be a live order-validation bug rather than a missing
 * field.
 */
export interface InstrumentFilters {
  tickSize: number | null;
  qtyStep: number | null;
  minOrderQty: number | null;
  maxOrderQty: number | null;
  /** Quote-currency notional bounds, where the venue publishes them. */
  minNotional: number | null;
  maxNotional: number | null;
  pricePrecision: number | null;
  qtyPrecision: number | null;
}

/**
 * One instrument, normalized.
 *
 * `symbol` is VOLTEX canonical ("BTC/USDT"). `providerSymbol` is what the
 * venue calls it ("BTCUSDT"). Both are kept: the canonical form is what
 * every VOLTEX subsystem keys on, and the provider form is what any future
 * request for this instrument has to send back upstream. Deriving one from
 * the other by string surgery is exactly the heuristic this type exists to
 * avoid — `base`/`quote`/`settle` all come from provider metadata.
 */
export interface NormalizedInstrument {
  symbol: string;
  providerSymbol: string;
  provider: 'bybit';
  marketType: MarketType;
  baseAsset: string;
  quoteAsset: string;
  /** The asset PnL settles in. Null for spot, where it is not a concept. */
  settleAsset: string | null;
  status: InstrumentStatus;
  /** Epoch ms. Null when the venue publishes no meaningful value — a
   *  perpetual's delivery time is legitimately absent, not zero. */
  launchTime: number | null;
  deliveryTime: number | null;
  filters: InstrumentFilters;
  /** The venue's own leverage ceiling. Reference only: VOLTEX's leverage
   *  is governed by its own tier table, never by a venue's. */
  providerMaxLeverage: number | null;
  /** Funding cadence in minutes, where the venue publishes one. */
  fundingIntervalMinutes: number | null;
}

/**
 * A bulk price snapshot row, normalized.
 *
 * `changePercent24h` is a PERCENTAGE ("2.10" means +2.10%), matching the
 * rest of VOLTEX. Bybit publishes a FRACTION (0.021), and converting at
 * the adapter boundary rather than at each call site is deliberate: the
 * same off-by-100 bug already shipped once in this codebase.
 */
export interface NormalizedTicker {
  symbol: string;
  providerSymbol: string;
  marketType: MarketType;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Provider volume; inverse is quote-asset contracts, not base-asset volume. */
  volume24h: number | null;
  /** Historical field name; inverse turnover is denominated in the base asset. */
  quoteVolume24h: number | null;
  volumeAsset?: string;
  turnoverAsset?: string;
  changePercent24h: number | null;
  /** Derivatives only; null on spot, where they do not exist. */
  indexPrice: number | null;
  markPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  openInterestValue?: number | null;
  fundingIntervalMinutes?: number | null;
  providerEventAt?: number | null;
}

/** Reference only. This is intentionally not the execution MarketTicker. */
export interface LiveTicker extends NormalizedTicker {
  id: string;
  pair: string;
  provider: 'bybit';
  baseAsset: string;
  quoteAsset: string;
  settleAsset: string | null;
  openInterestValue: number | null;
  fundingIntervalMinutes: number | null;
  providerEventAt: number | null;
  sequence: number | null;
  receivedAt: number;
  fetchedAt: number;
  stale: boolean;
}
