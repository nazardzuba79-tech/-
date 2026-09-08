import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AnalyticsSnapshot } from '../../lib/api';

/**
 * The Analytics page's single dataset, behind ONE timer.
 *
 * Analytics is a page of ~15 modules. The obvious way to build it — each
 * card fetching what it needs — is exactly the "forest of polling loops"
 * the Market Data Gateway work was done to remove, so it is built the same
 * way `lib/marketDataStore` is: one shared subscription, one in-flight
 * request, reference-counted, cleaned up on unmount.
 *
 * Why a dedicated store rather than reusing `marketDataStore`: this is a
 * different logical dataset. `marketDataStore` polls all-market tickers at
 * 3-5s for terminals that need price ticks; Analytics needs market-wide
 * aggregates, sentiment and this venue's derivatives state, none of which
 * moves on that timescale. Polling them at ticker cadence would be waste.
 * Server-side they are the SAME cached gateway reads `/markets` already
 * makes, so the slower cadence here costs no additional upstream request —
 * see `AnalyticsDataService`.
 *
 * Nothing in this file converts a failure into a number. A failed refresh
 * keeps the last good snapshot on screen and flags `status: 'error'`; it
 * never blanks the page and never substitutes zeros.
 */

/**
 * 30s. Every section behind it is slow-moving: CoinGecko's `/global` is
 * cached 5 minutes server-side, Fear & Greed is republished once a day,
 * and funding settles on an 8-hour boundary. The only figure that moves
 * faster is mark price, and the futures terminal is where a trader watches
 * that. Polling faster would buy nothing.
 */
const DEFAULT_INTERVAL_MS = 30_000;
/** Floor, so no future caller can turn this into a hot loop. */
const MIN_INTERVAL_MS = 10_000;

export interface AnalyticsState {
  status: 'loading' | 'ready' | 'error';
  snapshot: AnalyticsSnapshot | null;
  /** True once a request has settled either way — lets a view tell "still
   *  loading" from "loaded, and there is nothing". */
  loaded: boolean;
  /** When this client last received a snapshot (epoch ms). Distinct from
   *  each section's own provider `fetchedAt`. */
  receivedAt: number | null;
}

const EMPTY: AnalyticsState = { status: 'loading', snapshot: null, loaded: false, receivedAt: null };

type Listener = (state: AnalyticsState) => void;

class AnalyticsStore {
  private state: AnalyticsState = EMPTY;
  private listeners = new Map<symbol, Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  getState(): AnalyticsState {
    return this.state;
  }

  subscribe(listener: Listener, intervalMs = DEFAULT_INTERVAL_MS): () => void {
    const key = Symbol('analytics-subscriber');
    this.listeners.set(key, listener);

    // A late subscriber renders from memory instead of waiting a full
    // interval, and without costing a request.
    if (this.state.loaded) listener(this.state);

    if (this.timer === null) {
      this.timer = setInterval(() => void this.refresh(), Math.max(MIN_INTERVAL_MS, intervalMs));
    }
    if (!this.state.loaded) void this.refresh();

    return () => {
      this.listeners.delete(key);
      // Reference-counted: the last subscriber leaving stops the timer, so
      // navigating away from Analytics polls nothing.
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Fetch once, shared. Concurrent callers join the in-flight promise. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = api
      .getAnalyticsOverview()
      .then((snapshot) => {
        this.emit({ status: 'ready', snapshot, loaded: true, receivedAt: Date.now() });
      })
      .catch(() => {
        // Keep whatever was last known good. The page shows its existing
        // figures with an error flag rather than emptying itself.
        this.emit({ ...this.state, status: 'error', loaded: true });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private emit(state: AnalyticsState): void {
    this.state = state;
    for (const listener of this.listeners.values()) listener(state);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test seams. */
  _resetForTests(): void {
    this.stop();
    this.listeners.clear();
    this.state = EMPTY;
    this.inFlight = null;
  }
  get _timerCount(): number {
    return this.timer === null ? 0 : 1;
  }
  get _subscriberCount(): number {
    return this.listeners.size;
  }
}

export const analyticsStore = new AnalyticsStore();

/** Subscribe the calling component to the shared Analytics dataset. */
export function useAnalyticsSnapshot(): AnalyticsState & { refresh: () => void } {
  const [state, setState] = useState<AnalyticsState>(() => analyticsStore.getState());
  useEffect(() => analyticsStore.subscribe(setState), []);
  return { ...state, refresh: () => void analyticsStore.refresh() };
}
