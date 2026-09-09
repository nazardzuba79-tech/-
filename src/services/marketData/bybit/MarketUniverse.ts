import type { CachedValue } from '../ProviderCache';
import type { BybitMarketDataService } from './BybitMarketDataService';
import type { MarketType, NormalizedInstrument } from './types';

/**
 * The provider-neutral market universe.
 *
 * "Universe" here means WHICH INSTRUMENTS EXIST — not which are tradable
 * on VOLTEX, and not what they cost. Those are three different questions
 * and conflating them is what produced the old 40-symbol ceiling: a list
 * that was simultaneously the discovery surface, the execution whitelist
 * and a scalability workaround.
 *
 * They are separated here:
 *
 *   A. DISCOVERABLE — every real instrument the venue lists. Hundreds of
 *      spot pairs, 500+ linear contracts. Visible, searchable, honest.
 *
 *   B. EXECUTABLE — the subset VOLTEX can actually price, margin, fund
 *      and liquidate with its existing financial stack. Decided in
 *      `FuturesMarketRegistry`, which owns that judgement, using the
 *      predicates below to answer only the "is this a real USDT perpetual"
 *      half of it.
 *
 * B is never larger than A, and an instrument is never promoted into B
 * because it appears in A.
 *
 * ── Two invariants ───────────────────────────────────────────────────
 *
 * 1. A failed refresh changes NOTHING. The previous good universe stays.
 *    An upstream outage — including a regional refusal — must not be able
 *    to turn hundreds of markets into an empty list.
 *
 * 2. Nothing is fabricated. When the universe has never loaded, it is
 *    empty and says so; it does not synthesise a placeholder instrument
 *    or a zero-priced market.
 */

/** What a refresh did, for logs and diagnostics. Never rendered to a
 *  customer — provider identity does not reach the product surface. */
export interface UniverseRefreshResult {
  ok: boolean;
  spotCount: number;
  linearCount: number;
  /** Whether the universe now held is stale-last-good rather than fresh. */
  stale: boolean;
  /** Set only when the refresh failed. The previous universe was kept. */
  error?: string;
}

export interface MarketUniverseSnapshot {
  instruments: NormalizedInstrument[];
  /**
   * When the PROVIDER actually produced this data (epoch ms), not when we
   * last looked at it. Null before the first successful load.
   *
   * Reading a stale-last-good value out of the cache does not advance
   * this: the data is exactly as old as it was, and stamping `now()` on it
   * is how old data starts looking freshly refreshed.
   */
  refreshedAt: number | null;
  /**
   * True when what we hold is stale-last-good rather than a fresh read.
   *
   * The universe is a COMBINATION of two provider reads, so it is only as
   * fresh as its stalest half: one stale side makes the whole snapshot
   * stale, because a caller cannot act on "the perpetuals are current but
   * the spot pairs are a day old" without knowing which is which.
   */
  stale: boolean;
  /** True once at least one refresh has succeeded. */
  loaded: boolean;
}

/** Is this a real, currently-trading, USDT-margined perpetual?
 *
 *  Every clause is load-bearing, and none of them is inferred from the
 *  symbol string:
 *
 *   - `linear_perpetual` excludes DATED LinearFutures, which expire and
 *     deliver. VOLTEX has no expiry, delivery or settlement machinery, so
 *     a dated contract driven by the perpetual engine would be a contract
 *     that never expires — a different financial instrument wearing the
 *     same name.
 *   - `Trading` excludes PreLaunch, Delivering, Settling and Closed. A
 *     PreLaunch contract has no order book to exit into.
 *   - quote AND settle must both be USDT. A USDC-settled contract is
 *     margined in a different asset, and VOLTEX's balances, margin and
 *     liquidation are all denominated in the settle asset.
 *   - inverse contracts are coin-margined and are excluded by market type
 *     rather than by hoping none appear.
 */
export function isExecutablePerpetualCandidate(instrument: NormalizedInstrument): boolean {
  return (
    instrument.marketType === 'linear_perpetual' &&
    instrument.status === 'Trading' &&
    instrument.quoteAsset === 'USDT' &&
    instrument.settleAsset === 'USDT'
  );
}

/** Is this a real, currently-trading spot instrument with usable order
 *  constraints? Filters must be present and positive — a null or zero tick
 *  size is not a tradable instrument, it is a malformed row. */
export function isUsableSpotInstrument(instrument: NormalizedInstrument): boolean {
  const { tickSize, qtyStep } = instrument.filters;
  return (
    instrument.marketType === 'spot' &&
    instrument.status === 'Trading' &&
    tickSize !== null &&
    tickSize > 0 &&
    qtyStep !== null &&
    qtyStep > 0
  );
}

export class MarketUniverse {
  private instruments: NormalizedInstrument[] = [];
  private refreshedAt: number | null = null;
  private stale = false;
  private loaded = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bybit: BybitMarketDataService,
    /** `now` is accepted so a test can drive one clock through the whole
     *  stack. This class no longer dates anything itself — freshness comes
     *  from the provider cache — so it is not read here. */
    private readonly options: { refreshMs?: number; now?: () => number } = {}
  ) {}

  snapshot(): MarketUniverseSnapshot {
    return {
      instruments: this.instruments,
      refreshedAt: this.refreshedAt,
      stale: this.stale,
      loaded: this.loaded,
    };
  }

  /** Instruments of one market type. Returns [] before the first load,
   *  which callers must read as "unknown", never as "none exist". */
  byType(marketType: MarketType): NormalizedInstrument[] {
    return this.instruments.filter((i) => i.marketType === marketType);
  }

  /** Real, currently-trading spot instruments. */
  spot(): NormalizedInstrument[] {
    return this.instruments.filter(isUsableSpotInstrument);
  }

  /** Real, currently-trading USDT perpetuals. Candidates for execution —
   *  NOT the executable set, which additionally requires VOLTEX to be able
   *  to price them. */
  perpetualCandidates(): NormalizedInstrument[] {
    return this.instruments.filter(isExecutablePerpetualCandidate);
  }

  /**
   * Rebuilds the universe from the provider.
   *
   * Both categories are fetched together and applied together: a partial
   * apply would delete every spot instrument the moment the linear request
   * failed. On any failure the previous universe is left exactly as it was
   * and the reason is reported.
   */
  /** What we currently hold, described honestly, for the failure paths. */
  private held(error: string): UniverseRefreshResult {
    return {
      ok: false,
      spotCount: this.instruments.filter((i) => i.marketType === 'spot').length,
      linearCount: this.instruments.filter((i) => i.marketType !== 'spot').length,
      stale: this.stale,
      error,
    };
  }

  async refresh(): Promise<UniverseRefreshResult> {
    let spot: CachedValue<NormalizedInstrument[]>;
    let linear: CachedValue<NormalizedInstrument[]>;
    try {
      [spot, linear] = await Promise.all([
        this.bybit.listSpotInstruments(),
        this.bybit.listLinearInstruments(),
      ]);
    } catch (err) {
      // The previous universe survives untouched. This is the single most
      // important line in the class: an outage must not empty the exchange.
      //
      // It is marked stale, though, and `refreshedAt` is NOT advanced: the
      // read failed even past the cache's stale budget, so what we still
      // serve is definitively old and has to say so.
      const error = err instanceof Error ? err.message : String(err);
      console.error('[MarketUniverse] Refresh failed, keeping previous universe:', error);
      if (this.loaded) this.stale = true;
      return this.held(error);
    }

    // An empty answer from a SUCCESSFUL request is still not a reason to
    // empty a universe that previously had content — a venue does not
    // delist everything at once, so this is far likelier to be an upstream
    // fault that happened to return 200. What we keep is not confirmed
    // current either, so it is marked stale for the same reason as above.
    if (spot.value.length === 0 && linear.value.length === 0 && this.loaded) {
      console.error('[MarketUniverse] Provider returned an empty universe, keeping previous listing');
      this.stale = true;
      return this.held('empty_universe');
    }

    this.instruments = [...spot.value, ...linear.value];
    // The provider's OWN fetch time, and the OLDER of the two halves: a
    // combination is only as fresh as its stalest constituent, and a
    // stale-last-good serve must not be re-dated to now.
    this.refreshedAt = Math.min(spot.fetchedAt, linear.fetchedAt);
    // One stale half makes the whole snapshot stale.
    this.stale = spot.stale || linear.stale;
    this.loaded = true;
    return { ok: true, spotCount: spot.value.length, linearCount: linear.value.length, stale: this.stale };
  }

  start(): void {
    void this.refresh();
    const every = this.options.refreshMs ?? 15 * 60_000;
    this.timer = setInterval(() => void this.refresh(), every);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
