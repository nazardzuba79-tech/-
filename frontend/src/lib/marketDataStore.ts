import { api } from './api';
import type { MarketTicker, GlobalMarketSnapshot } from './api';

/**
 * ONE market-data poll for the whole browser tab.
 *
 * The problem this solves, measured on the shipped app: a single page view
 * could run six or more independent `setInterval`s against overlapping
 * market endpoints — the terminal ticker bar at 3s, the spot pair list at
 * 4s, the futures pair list at 4s, the futures ticker bar at 4s, the
 * markets table at 5s, its overview at 10s, its rankings at 60s, the top
 * gainers strip at 15s. Every one of them wanted some slice of the same
 * all-tickers snapshot. The backend's `ProviderCache` already collapsed
 * that into one *provider* request, so Kraken never saw the duplication —
 * but VOLTEX served every single one of those HTTP requests, and the count
 * scaled with both components on screen and users online.
 *
 * This store is the client-side half of the same idea the backend already
 * implements:
 *
 *   - ONE `setInterval` per tab, no matter how many components subscribe.
 *   - ONE in-flight request; subscribers mounting mid-flight join it
 *     rather than starting their own (the same in-flight deduplication
 *     `ProviderCache.fetch` does on the server).
 *   - Reference-counted: the timer starts on the first subscriber and is
 *     cleared on the last, so a tab sitting on a page with no market UI
 *     polls nothing at all.
 *   - The poll runs at the FASTEST cadence any live subscriber asked for,
 *     so the terminal still refreshes at its 3s while a background strip
 *     asking for 15s is simply served the same fresher data. Nobody gets
 *     slower data than they asked for.
 *
 * Freshness is carried through, not discarded: every snapshot reports its
 * `source`, `fetchedAt` and `stale` from the gateway, and an unavailable
 * section arrives as `available: false` with no value-carrying fields.
 * Components render a dash for that. **Nothing in this file turns a failed
 * request into a zero, an empty array, or a default price.**
 */

export interface EnvelopeMeta {
  source: string;
  fetchedAt: number;
  stale: boolean;
}

export type Section<T> = ({ available: true; value: T } & EnvelopeMeta) | { available: false; reason: string; detail?: string };

export interface MarketSnapshotResponse {
  tickers: Section<MarketTicker[]>;
  overview: Section<GlobalMarketSnapshot>;
  sentiment: Section<{ value: number; classification: string; updatedAt: number }>;
}

/** What a subscriber sees. `tickers` is a Map for O(1) per-pair lookup —
 *  a 500-row table doing `find()` per row is the other half of making the
 *  catalogue scale. */
export interface MarketState {
  status: 'loading' | 'ready' | 'error';
  tickers: Map<string, MarketTicker>;
  /** Present only when the tickers section was available. `null` means
   *  "no data", which is NOT the same as an empty market. */
  tickersMeta: EnvelopeMeta | null;
  overview: GlobalMarketSnapshot | null;
  overviewMeta: EnvelopeMeta | null;
  sentiment: { value: number; classification: string } | null;
  /** True once at least one poll has completed, successfully or not — lets
   *  a view distinguish "still loading" from "loaded, and there is nothing". */
  loaded: boolean;
}

const EMPTY_STATE: MarketState = {
  status: 'loading',
  tickers: new Map(),
  tickersMeta: null,
  overview: null,
  overviewMeta: null,
  sentiment: null,
  loaded: false,
};

/** Floor on the shared cadence. The backend ticker cache has a 5s TTL, so
 *  polling faster than this cannot return fresher data — it would only
 *  cost VOLTEX requests. 3s preserves the terminal's existing feel while
 *  staying just under that TTL. */
const MIN_INTERVAL_MS = 3_000;
const DEFAULT_INTERVAL_MS = 5_000;

type Listener = (state: MarketState) => void;

class MarketDataStore {
  private state: MarketState = EMPTY_STATE;
  /** When the last successful snapshot landed, so a late subscriber can be
   *  served from memory instead of triggering another request. */
  private lastLoadedAt = 0;
  private listeners = new Map<symbol, { listener: Listener; intervalMs: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs = DEFAULT_INTERVAL_MS;
  private inFlight: Promise<void> | null = null;

  getState(): MarketState {
    return this.state;
  }

  /**
   * Subscribe with the cadence this consumer needs. Returns an
   * unsubscribe function; the timer stops when the last one leaves.
   */
  subscribe(listener: Listener, intervalMs = DEFAULT_INTERVAL_MS): () => void {
    const key = Symbol('subscriber');
    this.listeners.set(key, { listener, intervalMs: Math.max(MIN_INTERVAL_MS, intervalMs) });

    // A late subscriber gets the current snapshot immediately rather than
    // waiting a full interval to render anything.
    if (this.state.loaded) listener(this.state);

    this.retimeAndStart();
    // Only fetch when there is nothing recent to serve. A component
    // mounting into an already-populated store is answered from memory:
    // measured in browser QA, a page whose components mount in sequence
    // was otherwise issuing one snapshot request per subscriber (five on
    // the terminal) before the first interval had even elapsed.
    if (this.needsRefresh()) void this.refresh();

    return () => {
      this.listeners.delete(key);
      if (this.listeners.size === 0) {
        this.stop();
      } else {
        this.retimeAndStart();
      }
    };
  }

  /** True when the held snapshot is missing or older than the current
   *  poll cadence. */
  private needsRefresh(): boolean {
    return !this.state.loaded || Date.now() - this.lastLoadedAt >= this.currentIntervalMs;
  }

  /**
   * Fetch once, shared. Concurrent callers join the in-flight promise
   * instead of issuing their own request — the client-side mirror of the
   * server's request coalescing.
   */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = api
      .getMarketSnapshot()
      .then((snapshot) => this.apply(snapshot))
      .catch(() => {
        // A transport failure keeps whatever was last known good on
        // screen and flags the status — it never blanks the numbers and
        // never substitutes zeros. `loaded` becomes true so a view can
        // tell "failed" from "still loading".
        this.emit({ ...this.state, status: 'error', loaded: true });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private apply(snapshot: MarketSnapshotResponse): void {
    this.lastLoadedAt = Date.now();
    const next: MarketState = { ...this.state, status: 'ready', loaded: true };

    if (snapshot.tickers.available) {
      const map = new Map<string, MarketTicker>();
      for (const ticker of snapshot.tickers.value) map.set(ticker.pair, ticker);
      next.tickers = map;
      next.tickersMeta = { source: snapshot.tickers.source, fetchedAt: snapshot.tickers.fetchedAt, stale: snapshot.tickers.stale };
    } else if (!this.state.loaded) {
      // Unavailable on a cold store: an empty map, and `tickersMeta`
      // stays null so a consumer can tell "no data" from "a market with
      // no rows". Once we have shown real rows we keep them rather than
      // wiping the list for one bad poll — the same "last known good"
      // behaviour the pair list already had.
      next.tickers = new Map();
      next.tickersMeta = null;
    }

    if (snapshot.overview.available) {
      next.overview = snapshot.overview.value;
      next.overviewMeta = {
        source: snapshot.overview.source,
        fetchedAt: snapshot.overview.fetchedAt,
        stale: snapshot.overview.stale,
      };
    } else if (!this.state.loaded) {
      next.overview = null;
      next.overviewMeta = null;
    }

    if (snapshot.sentiment.available) {
      next.sentiment = { value: snapshot.sentiment.value.value, classification: snapshot.sentiment.value.classification };
    } else if (!this.state.loaded) {
      next.sentiment = null;
    }

    this.emit(next);
  }

  private emit(state: MarketState): void {
    this.state = state;
    for (const { listener } of this.listeners.values()) listener(state);
  }

  /** Re-derive the shared cadence from whoever is currently subscribed. */
  private retimeAndStart(): void {
    const wanted = Math.min(...Array.from(this.listeners.values(), (l) => l.intervalMs));
    const next = Number.isFinite(wanted) ? wanted : DEFAULT_INTERVAL_MS;
    if (this.timer !== null && next === this.currentIntervalMs) return;
    this.currentIntervalMs = next;
    this.stop();
    this.timer = setInterval(() => void this.refresh(), next);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test seam — resets module state between cases. */
  _resetForTests(): void {
    this.stop();
    this.listeners.clear();
    this.state = EMPTY_STATE;
    this.inFlight = null;
    this.lastLoadedAt = 0;
    this.currentIntervalMs = DEFAULT_INTERVAL_MS;
  }

  /** Test seam — how many timers are running (must never exceed 1). */
  get _timerCount(): number {
    return this.timer === null ? 0 : 1;
  }

  get _subscriberCount(): number {
    return this.listeners.size;
  }
}

export const marketDataStore = new MarketDataStore();
