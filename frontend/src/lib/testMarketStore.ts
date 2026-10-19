import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener, browserFetch as fetch, browserFallbackFetch, trackBrowserRead } from './browserActivity';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE, getToken, onSessionChange } from './api';
import { fetchNrxPublic, isEdgeMarketUrl, isNrxPair, NRX_EDGE_BASE } from './nrxMarket';
import { isManagedListingPair, isPrivateTestPair, parseTestMarkets, registerManagedListings, registerPrivateTestMarkets, SIMULATION_PREVIEW_PARAM, withSimulationPreview, type TestAsset } from './testMarkets';
import { aithLeaseDeadline, aithReadClock, isAith } from '../../../src/shared/aithPublication';

/**
 * TEST MARKETS — the network half. One store per tab, the same idea as
 * lib/marketDataStore: one timer, one in-flight request, reference-counted,
 * polled at the fastest cadence any subscriber asked for.
 *
 * Fixed VTA/NRX markets are deliberately quieter: before listing, their
 * countdown follows the server clock locally and the store sleeps until
 * launch. The managed catalogue keeps the subscriber's cadence because
 * an administrator can publish another listing while all known rows are
 * still in the future. Only an open terminal asks for faster updates.
 */

export const TEST_MARKET_LIST_INTERVAL_MS = 60_000;
export const TEST_MARKET_TERMINAL_INTERVAL_MS = 5_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export { isEdgeMarketUrl };

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
  // Edge-served markets never fall back to Render or a venue.
  if (isEdgeMarketUrl(url)) return fetchNrxPublic(url, signal);
  const response = await fetch(withSimulationPreview(url, simulationPreviewTime()), {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`test_market_http_${response.status}`);
  return response.json();
}

/**
 * An authenticated read of the History20 private test API (owner and
 * allowlisted testers only). Never the edge, never a venue, never the
 * preview clock. Without a session it does not ask at all.
 */
/** The session token, or null where there is no browser storage (tests, prerender). */
function sessionToken(): string | null {
  try { return getToken(); } catch { return null; }
}

/** The private API's answer status; 404 means not a participant (or no such market), never an outage. */
export class PrivateTestHttpError extends Error {
  constructor(readonly status: number) { super(`private_test_http_${status}`); }
}

export async function fetchPrivateTestMarketJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const token = sessionToken();
  if (!token) throw new Error('private_test_no_session');
  // Optional for everyone but participants: its status never fails the wake barrier (the store tracks the whole read).
  const response = await browserFallbackFetch(url, {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new PrivateTestHttpError(response.status);
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

export class TestMarketStore {
  constructor(private readonly endpoint = `${API_BASE}/market/test-assets`, private readonly catalogue = false, private readonly privateSource = false) {}
  private state: TestMarketsState = { loaded: false, error: false, assets: [], clockOffsetMs: 0 };
  private subscribers = new Map<symbol, { listener: Listener; intervalMs: number }>();
  /** Follow the state without asking for it (see watch). */
  private readonly watchers = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private refreshAfterFlight = false;
  private fetchedAt = 0;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;
  private highestAithVersion = 0;
  /** Private source only: the server said this session is not a participant (404); ask again only after a session change. */
  private dormant = false;

  private expireAith(): void {
    const assets = this.state.assets.filter(asset => !isAith(asset.pair) || aithReadClock() < (asset.leaseDeadline ?? 0));
    if (assets.length === this.state.assets.length) return;
    this.state = { ...this.state, assets };
    this.publish();
  }

  private scheduleLease(): void {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    const asset = this.state.assets.find(asset => isAith(asset.pair));
    this.leaseTimer = asset ? setTimeout(() => this.expireAith(), Math.max(0, (asset.leaseDeadline ?? 0) - aithReadClock())) : null;
  }

  /** Forget everything (a session change): nothing this account was served may reach the next one. */
  reset(): void {
    this.controller?.abort();
    this.inFlight = null;
    if (this.privateSource) registerPrivateTestMarkets([]);
    this.dormant = false;
    this.state = { loaded: false, error: false, assets: [], clockOffsetMs: 0 };
    this.fetchedAt = 0;
    this.publish();
    if (this.subscribers.size > 0) void this.refresh();
  }

  private publish(): void {
    for (const { listener } of this.subscribers.values()) listener(this.state);
    for (const watcher of this.watchers) watcher(this.state);
  }

  /** Receive every state change and never cause a request: a list shows what a terminal already read. */
  watch(listener: Listener): () => void {
    this.watchers.add(listener);
    listener(this.getState());
    return () => { this.watchers.delete(listener); };
  }

  getState(): TestMarketsState {
    this.expireAith();
    return this.state;
  }

  subscribe(listener: Listener, intervalMs = TEST_MARKET_LIST_INTERVAL_MS): () => void {
    this.expireAith();
    const key = Symbol('test-market-subscriber');
    this.subscribers.set(key, { listener, intervalMs });
    listener(this.state);
    if (this.subscribers.size === 1 && typeof document !== 'undefined') addBrowserActivityListener(this.onVisibility);
    if (!this.state.loaded || (this.catalogue && this.subscribers.size === 1)
      || ((this.catalogue || this.anyLive()) && Date.now() - this.fetchedAt >= intervalMs)) void this.refresh();
    else this.schedule();
    return () => {
      this.subscribers.delete(key);
      if (this.subscribers.size > 0) return this.schedule();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.controller?.abort();
      if (typeof document !== 'undefined') removeBrowserActivityListener(this.onVisibility);
    };
  }

  refresh(): Promise<void> {
    if (this.privateSource && this.dormant) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (typeof document !== 'undefined' && isBrowserInactive() && this.state.loaded) return Promise.resolve();
    const controller = new AbortController();
    const requestStartedAt = aithReadClock();
    this.controller = controller;
    this.refreshAfterFlight = false;
    const read = this.privateSource
      // Not a participant (404) is an answer, not a failure: nothing to show, nothing to poll.
      ? fetchPrivateTestMarketJson(this.endpoint, controller.signal).catch((error: unknown) => {
        if (error instanceof PrivateTestHttpError && error.status === 404) { this.dormant = true; return { serverTime: Date.now(), assets: [] }; }
        throw error;
      })
      : fetchTestMarketJson(this.endpoint, controller.signal);
    // An optional private list never holds the page's wake barrier in error.
    this.inFlight = trackBrowserRead(read
      .then((body) => {
        if (controller.signal.aborted || this.refreshAfterFlight) return;
        const snapshot = parseTestMarkets(body, this.privateSource ? 'private' : 'public');
        if (!snapshot) throw new Error('test_market_shape');
        snapshot.assets = snapshot.assets.filter(asset => {
          if (!isAith(asset.pair)) return true;
          if (!asset.readLease || !asset.version || asset.version < this.highestAithVersion) return false;
          asset.leaseDeadline = aithLeaseDeadline(asset.readLease, requestStartedAt, snapshot.serverTime);
          if (aithReadClock() >= asset.leaseDeadline) return false;
          this.highestAithVersion = asset.version;
          return true;
        });
        if (this.privateSource) registerPrivateTestMarkets(snapshot.assets);
        else registerManagedListings(snapshot.assets);
        this.state = { loaded: true, error: false, assets: snapshot.assets, clockOffsetMs: snapshot.serverTime - Date.now() };
        this.scheduleLease();
      }), !this.privateSource)
      .catch(() => {
        if (controller.signal.aborted || this.refreshAfterFlight) return;
        // Private test markets fail closed and quietly: no session, not a participant (404)
        // or an outage all mean "nothing to show", never an alert to everyone else.
        if (this.privateSource) {
          registerPrivateTestMarkets([]);
          this.state = { ...this.state, loaded: true, error: false, assets: [] };
          return;
        }
        // AITH must fail closed; other markets retain their existing last-good policy.
        this.state = { ...this.state, loaded: true, error: true, assets: this.state.assets.filter(asset => !isAith(asset.pair)) };
        this.scheduleLease();
      })
      .finally(() => {
        this.inFlight = null;
        if (this.controller === controller) this.controller = null;
        if (this.refreshAfterFlight && this.subscribers.size > 0 && !isBrowserInactive()) {
          void this.refresh();
          return;
        }
        if (!controller.signal.aborted) this.fetchedAt = Date.now();
        this.publish();
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

  private readonly onVisibility = (event?: Event) => {
    this.expireAith();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (isBrowserInactive() || !this.subscribers.size) return;
    // Preview-only listings are intentionally static: visibility changes
    // must not start a clock or create background traffic.
    if (!this.catalogue && this.state.loaded && !this.anyLive() && this.armedListings().length === 0) return;
    // Live or armed pre-listing: a tab that slept through the listing moment must wake.
    const cadence = Math.min(this.catalogue && this.highestAithVersion > 0 ? 15_000 : Infinity, ...[...this.subscribers.values()].map((s) => s.intervalMs));
    if (event?.type === 'voltex:browser-activity' || Date.now() - this.fetchedAt >= cadence) {
      if (event?.type === 'voltex:browser-activity' && this.inFlight) this.refreshAfterFlight = true;
      void this.refresh();
    }
    else if (this.catalogue) this.schedule();
  };

  /** Fixed markets sleep until launch; a catalogue also discovers newly published rows. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.subscribers.size || isBrowserInactive() || (this.privateSource && this.dormant)) return;
    const cadence = Math.min(this.catalogue && this.highestAithVersion > 0 ? 15_000 : Infinity, ...[...this.subscribers.values()].map((s) => s.intervalMs));
    let delay = Math.max(0, cadence - (Date.now() - this.fetchedAt));
    if (this.state.loaded && !this.state.error && this.state.assets.length > 0 && !this.anyLive()) {
      const armed = this.armedListings();
      // Unarmed preview: one initial request, then complete silence until a new deploy/reload arms it.
      if (armed.length === 0 && !this.catalogue) return;
      if (armed.length > 0) {
        const serverNow = Date.now() + this.state.clockOffsetMs;
        const nextListing = Math.min(...armed.map((asset) => Date.parse(asset.listingAt)));
        const listingDelay = Math.max(1_000, nextListing - serverNow + 1_000);
        delay = this.catalogue ? Math.min(delay, listingDelay) : listingDelay;
      }
    }
    this.timer = setTimeout(() => void this.refresh(), Math.min(delay, MAX_TIMEOUT_MS));
  }
}

export const testMarketStore = new TestMarketStore();
export const nrxMarketStore = new TestMarketStore(`${NRX_EDGE_BASE}/market/nrx`);
/** Published managed listings (Admin → Listings), straight from the market edge. */
export const managedListingStore = new TestMarketStore(`${NRX_EDGE_BASE}/market/listings`, true);
/** History20 private test markets for this session (authenticated API; empty for everyone but participants). */
export const privateTestMarketStore = new TestMarketStore(`${API_BASE}/private-test/markets`, true, true);
onSessionChange(() => privateTestMarketStore.reset());
/** A deep link to a pair the tab has never seen learns whether it is a listing; re-read rarely, and at each listing moment. */
export const MANAGED_LISTING_DISCOVERY_INTERVAL_MS = 15 * 60_000;

const storeForPair = (pair: string) => (isNrxPair(pair) ? nrxMarketStore : isPrivateTestPair(pair) ? privateTestMarketStore
  : isManagedListingPair(pair) ? managedListingStore : testMarketStore);

/** The listing instant of a test market the tab has already read (epoch ms), or null: the chart's derived first bucket may open there. */
export function testMarketListingAt(pair: string): number | null {
  const wanted = pair.toUpperCase();
  const asset = storeForPair(pair).getState().assets.find(candidate => candidate.pair === wanted);
  const at = asset ? Date.parse(asset.listingAt) : NaN;
  return Number.isFinite(at) ? at : null;
}

export function refreshTestMarket(pair: string): Promise<void> {
  return storeForPair(pair).refresh();
}

// Preview builds only (VITE_SIMULATION_PREVIEW=1): moving the preview clock
// re-reads at once instead of waiting for the next poll. A production build
// replaces the flag with `undefined`, so this block is dropped from it.
if (import.meta.env.VITE_SIMULATION_PREVIEW === '1' && typeof window !== 'undefined') {
  window.addEventListener('voltex:test-market-preview', () => void testMarketStore.refresh());
}

/** Every test market. `enabled: false` subscribes to nothing. */
function useStore(store: TestMarketStore, intervalMs: number, enabled: boolean): TestMarketsState {
  const [state, setState] = useState<TestMarketsState>(() => store.getState());
  useEffect(() => (enabled ? store.subscribe(setState, intervalMs) : undefined), [store, intervalMs, enabled]);
  return state;
}

/** A store's state without any request of its own. */
function useWatchedStore(store: TestMarketStore, enabled: boolean): TestMarketsState {
  const [state, setState] = useState<TestMarketsState>(() => store.getState());
  useEffect(() => (enabled ? store.watch(setState) : undefined), [store, enabled]);
  return state;
}

export function useTestMarkets(intervalMs = TEST_MARKET_LIST_INTERVAL_MS, enabled = true, pair?: string): TestMarketsState {
  const kind = pair ? (isNrxPair(pair) ? 'nrx' : isPrivateTestPair(pair) ? 'private' : isManagedListingPair(pair) ? 'managed' : 'vta') : null;
  const vta = useStore(testMarketStore, intervalMs, enabled && (!kind || kind === 'vta'));
  const nrx = useStore(nrxMarketStore, intervalMs, enabled && (!kind || kind === 'nrx'));
  const managed = useStore(managedListingStore, intervalMs, enabled && (!kind || kind === 'managed'));
  // Only a private pair's own terminal asks (a participant's link; the server answers participants and nobody
  // else). Every list just shows what this session already found, so an ordinary page never sends the request.
  const privateAsked = useStore(privateTestMarketStore, intervalMs, enabled && kind === 'private' && sessionToken() !== null);
  const privateSeen = useWatchedStore(privateTestMarketStore, enabled && !kind);
  const privateTests = kind === 'private' ? privateAsked : privateSeen;
  // One array per store change, not per render: consumers memoise on it (useMarketTickers), and a
  // fresh array each render kept the Markets page re-rendering and starved route transitions.
  const assets = useMemo(() => [...vta.assets, ...nrx.assets, ...managed.assets, ...privateTests.assets], [vta.assets, nrx.assets, managed.assets, privateTests.assets]);
  if (kind) return kind === 'nrx' ? nrx : kind === 'private' ? privateTests : kind === 'managed' ? managed : vta;
  // The private list never decides whether the public markets loaded or failed.
  return { loaded: vta.loaded && nrx.loaded && managed.loaded, error: vta.error || nrx.error || managed.error,
    assets, clockOffsetMs: nrx.loaded ? nrx.clockOffsetMs : managed.loaded ? managed.clockOffsetMs : vta.clockOffsetMs };
}

/** The Trade page asks the edge once whether its pair is a managed listing (the store re-reads only rarely). */
export function useManagedListingDiscovery(enabled: boolean): TestMarketsState {
  return useStore(managedListingStore, MANAGED_LISTING_DISCOVERY_INTERVAL_MS, enabled);
}

/** The Trade page asks once whether its SIMUSDT pair is a private test market this session may open. */
export function usePrivateTestMarketDiscovery(enabled: boolean): TestMarketsState {
  return useStore(privateTestMarketStore, MANAGED_LISTING_DISCOVERY_INTERVAL_MS, enabled && sessionToken() !== null);
}

/** One test market, or nothing for an ordinary pair (which then costs no request). */
export function useTestMarket(pair: string | null, intervalMs = TEST_MARKET_TERMINAL_INTERVAL_MS) {
  const state = useTestMarkets(intervalMs, pair !== null, pair ?? undefined);
  return {
    asset: pair ? state.assets.find((asset) => asset.pair === pair.toUpperCase()) ?? null : null,
    loaded: state.loaded,
    error: state.error,
    clockOffsetMs: state.clockOffsetMs,
  };
}
