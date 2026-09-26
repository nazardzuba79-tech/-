import { useEffect, useState } from 'react';
import { API_BASE } from './api';
import { parseTestMarkets, SIMULATION_PREVIEW_PARAM, withSimulationPreview, type TestAsset } from './testMarkets';

/**
 * TEST MARKETS — the network half. One store per tab, the same idea as
 * lib/marketDataStore: one timer, one in-flight request, reference-counted,
 * polled at the fastest cadence any subscriber asked for.
 *
 * It is deliberately quieter than that store. Before the listing nothing
 * about a test market changes except its countdown, which is drawn from
 * the server clock locally — so the store makes ONE request and then
 * sleeps until the listing moment. After it, lists refresh once a minute
 * and only an open terminal on the pair asks for more.
 */

export const TEST_MARKET_LIST_INTERVAL_MS = 60_000;
export const TEST_MARKET_TERMINAL_INTERVAL_MS = 5_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The dev-only preview clock. Forwarded only by a build made with
 * VITE_SIMULATION_PREVIEW=1, and the server honours it only outside
 * production with TEST_MARKET_SIMULATION_PREVIEW=1 — a query string on the
 * live site changes nothing on either side.
 */
function simulationPreviewTime(): string | null {
  if (import.meta.env.VITE_SIMULATION_PREVIEW !== '1' || typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(SIMULATION_PREVIEW_PARAM);
  return value && value.length <= 40 ? value : null;
}

/** A test-market GET: public, uncached, with the dev-only preview clock when allowed. */
export async function fetchTestMarketJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(withSimulationPreview(url, simulationPreviewTime()), {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`test_market_http_${response.status}`);
  return response.json();
}

export interface TestMarketsState {
  loaded: boolean;
  error: boolean;
  assets: TestAsset[];
  /** Server time minus local time at receipt: countdowns follow the server. */
  clockOffsetMs: number;
}

type Listener = (state: TestMarketsState) => void;

class TestMarketStore {
  private state: TestMarketsState = { loaded: false, error: false, assets: [], clockOffsetMs: 0 };
  private subscribers = new Map<symbol, { listener: Listener; intervalMs: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private fetchedAt = 0;

  getState(): TestMarketsState {
    return this.state;
  }

  subscribe(listener: Listener, intervalMs = TEST_MARKET_LIST_INTERVAL_MS): () => void {
    const key = Symbol('test-market-subscriber');
    this.subscribers.set(key, { listener, intervalMs });
    listener(this.state);
    if (this.subscribers.size === 1 && typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    if (!this.state.loaded || (this.anyLive() && Date.now() - this.fetchedAt >= intervalMs)) void this.refresh();
    else this.schedule();
    return () => {
      this.subscribers.delete(key);
      if (this.subscribers.size > 0) return this.schedule();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    };
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (typeof document !== 'undefined' && document.hidden && this.state.loaded) return Promise.resolve();
    this.inFlight = fetchTestMarketJson(`${API_BASE}/market/test-assets`)
      .then((body) => {
        const snapshot = parseTestMarkets(body);
        if (!snapshot) throw new Error('test_market_shape');
        this.state = { loaded: true, error: false, assets: snapshot.assets, clockOffsetMs: snapshot.serverTime - Date.now() };
      })
      .catch(() => {
        // Last good stays: a failed refresh never empties a list.
        this.state = { ...this.state, loaded: true, error: true };
      })
      .finally(() => {
        this.inFlight = null;
        this.fetchedAt = Date.now();
        for (const { listener } of this.subscribers.values()) listener(this.state);
        this.schedule();
      });
    return this.inFlight;
  }

  private anyLive(): boolean {
    return this.state.assets.some((asset) => asset.state.phase === 'live');
  }

  private armedListings(): TestAsset[] {
    return this.state.assets.filter((asset) => asset.listingArmed);
  }

  private readonly onVisibility = () => {
    if (document.hidden || !this.subscribers.size) return;
    // Preview-only listings are intentionally static: visibility changes
    // must not start a clock or create background traffic.
    if (this.state.loaded && !this.anyLive() && this.armedListings().length === 0) return;
    // Live or armed pre-listing: a tab that slept through the listing moment must wake.
    const cadence = Math.min(...[...this.subscribers.values()].map((s) => s.intervalMs));
    if (Date.now() - this.fetchedAt >= cadence) void this.refresh();
  };

  /** While every asset is pre-listing the only refresh is at the listing. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.subscribers.size) return;
    const cadence = Math.min(...[...this.subscribers.values()].map((s) => s.intervalMs));
    let delay = Math.max(0, cadence - (Date.now() - this.fetchedAt));
    if (this.state.loaded && !this.state.error && this.state.assets.length > 0 && !this.anyLive()) {
      const armed = this.armedListings();
      // Unarmed preview: one initial request, then complete silence until a new deploy/reload arms it.
      if (armed.length === 0) return;
      const serverNow = Date.now() + this.state.clockOffsetMs;
      const nextListing = Math.min(...armed.map((asset) => Date.parse(asset.listingAt)));
      delay = Math.max(1_000, nextListing - serverNow + 1_000);
    }
    this.timer = setTimeout(() => void this.refresh(), Math.min(delay, MAX_TIMEOUT_MS));
  }
}

export const testMarketStore = new TestMarketStore();

// Preview builds only (VITE_SIMULATION_PREVIEW=1): moving the preview clock
// re-reads at once instead of waiting for the next poll. A production build
// replaces the flag with `undefined`, so this block is dropped from it.
if (import.meta.env.VITE_SIMULATION_PREVIEW === '1' && typeof window !== 'undefined') {
  window.addEventListener('voltex:test-market-preview', () => void testMarketStore.refresh());
}

/** Every test market. `enabled: false` subscribes to nothing. */
export function useTestMarkets(intervalMs = TEST_MARKET_LIST_INTERVAL_MS, enabled = true): TestMarketsState {
  const [state, setState] = useState<TestMarketsState>(() => testMarketStore.getState());
  useEffect(() => (enabled ? testMarketStore.subscribe(setState, intervalMs) : undefined), [intervalMs, enabled]);
  return state;
}

/** One test market, or nothing for an ordinary pair (which then costs no request). */
export function useTestMarket(pair: string | null, intervalMs = TEST_MARKET_TERMINAL_INTERVAL_MS) {
  const state = useTestMarkets(intervalMs, pair !== null);
  return {
    asset: pair ? state.assets.find((asset) => asset.pair === pair.toUpperCase()) ?? null : null,
    loaded: state.loaded,
    error: state.error,
    clockOffsetMs: state.clockOffsetMs,
  };
}
