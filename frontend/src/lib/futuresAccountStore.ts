import { api, getToken, onSessionChange } from './api';

/**
 * ONE poll per authenticated Futures account resource, per browser tab.
 *
 * The problem this solves, measured on the shipped build against the
 * fixture harness (`scripts/qa-futures-account-harness.cjs`): the futures
 * terminal ran five independent `setInterval`s over three account
 * endpoints, because three components each fetched what they personally
 * needed.
 *
 *   /futures/positions   FuturesAccountSummary 5s
 *                        FuturesOrderForm      5s
 *                        FuturesPositionsPanel 4s     -> 39 requests/min
 *   /futures/balances    FuturesAccountSummary 5s
 *                        FuturesOrderForm      5s     -> 24 requests/min
 *   /futures/orders/me   FuturesOrderForm      5s     -> 12 requests/min
 *
 * 75 authenticated account requests per idle minute for three resources.
 * Worse than the count: the three copies of `positions` were fetched at
 * different instants, so the margin summary, the order form's exposure
 * preview and the positions table could each be showing a different
 * snapshot of the same account at the same moment.
 *
 * This is the client half of the coalescing the backend already does, and
 * a deliberate copy of `marketDataStore`'s proven shape:
 *
 *   - ONE timer per RESOURCE, no matter how many components subscribe.
 *   - ONE in-flight request per resource; a component mounting mid-flight
 *     joins it rather than starting its own.
 *   - Reference counted: the timer starts with the first subscriber and
 *     stops with the last, so a tab away from futures polls nothing.
 *   - Each resource polls at the FASTEST cadence any live subscriber asked
 *     for, so nobody is served staler data than they asked for.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It does not merge the four resources into one request. They have
 * genuinely different update rates and failure semantics: positions move
 * with every tick, position history changes only when something closes,
 * and a balances failure must not blank the positions table. They stay
 * four endpoints behind one store — sharing a cache, not a payload.
 *
 * NOTHING here computes, adjusts or reinterprets a financial figure. It
 * moves the same bytes the same components already received, and every
 * margin, liquidation, PnL and exposure calculation stays exactly where it
 * was.
 */

export type FuturesPosition = Awaited<ReturnType<typeof api.getFuturesPositions>>[number];
export type FuturesOrder = Awaited<ReturnType<typeof api.getMyFuturesOrders>>[number];
export type FuturesPositionHistoryRow = Awaited<ReturnType<typeof api.getFuturesPositionHistory>>[number];
export type FuturesBalance = Awaited<ReturnType<typeof api.getFuturesBalances>>[number];

export type ResourceKey = 'balances' | 'positions' | 'orders' | 'positionHistory';

/**
 * What a subscriber sees for one resource.
 *
 * `data` is `null` until a request has actually succeeded — it is NEVER an
 * empty array standing in for an unknown answer, and never a zero. A view
 * renders a dash for `null` and a real empty state only for `[]`, which
 * can only come from the server. `stale` marks last-good data being shown
 * after a later refresh failed, so a stable UI is not blanked by one bad
 * poll.
 */
export interface ResourceState<T> {
  data: T | null;
  /** No successful load yet, and a request is in flight. */
  loading: boolean;
  /** A refresh is in flight while `data` is already populated. */
  refreshing: boolean;
  /** The last attempt failed. With `data !== null` this means "stale". */
  failed: boolean;
  /** True once an attempt has settled, so "empty" is distinguishable from "not yet". */
  loaded: boolean;
  /** When the currently held `data` was fetched. 0 when there is none. */
  fetchedAt: number;
}

export interface FuturesAccountState {
  balances: ResourceState<FuturesBalance[]>;
  positions: ResourceState<FuturesPosition[]>;
  orders: ResourceState<FuturesOrder[]>;
  positionHistory: ResourceState<FuturesPositionHistoryRow[]>;
}

function emptyResource<T>(): ResourceState<T> {
  return { data: null, loading: false, refreshing: false, failed: false, loaded: false, fetchedAt: 0 };
}

function emptyState(): FuturesAccountState {
  return {
    balances: emptyResource<FuturesBalance[]>(),
    positions: emptyResource<FuturesPosition[]>(),
    orders: emptyResource<FuturesOrder[]>(),
    positionHistory: emptyResource<FuturesPositionHistoryRow[]>(),
  };
}

/** Floor on any resource's cadence — a guard against a caller asking for a
 *  request storm, not a change to anyone's current rate. */
const MIN_INTERVAL_MS = 2_000;
const DEFAULT_INTERVAL_MS = 5_000;

const FETCHERS: { [K in ResourceKey]: () => Promise<FuturesAccountState[K]['data']> } = {
  balances: () => api.getFuturesBalances(),
  positions: () => api.getFuturesPositions(),
  orders: () => api.getMyFuturesOrders('OPEN,PARTIALLY_FILLED'),
  positionHistory: () => api.getFuturesPositionHistory(),
};

type Listener = (state: FuturesAccountState) => void;

interface Subscriber {
  listener: Listener;
  /** Resource -> cadence this subscriber needs. A resource absent from the
   *  map is one this subscriber reads but does not want polled on its
   *  behalf. */
  wants: Partial<Record<ResourceKey, number>>;
}

interface ResourceRuntime {
  timer: ReturnType<typeof setInterval> | null;
  intervalMs: number;
  inFlight: Promise<void> | null;
  /** The session generation the in-flight request was issued under. */
  inFlightGeneration: number;
}

const RESOURCE_KEYS: ResourceKey[] = ['balances', 'positions', 'orders', 'positionHistory'];

class FuturesAccountStore {
  private state: FuturesAccountState = emptyState();
  private subscribers = new Map<symbol, Subscriber>();
  private runtime: Record<ResourceKey, ResourceRuntime> = {
    balances: { timer: null, intervalMs: DEFAULT_INTERVAL_MS, inFlight: null, inFlightGeneration: 0 },
    positions: { timer: null, intervalMs: DEFAULT_INTERVAL_MS, inFlight: null, inFlightGeneration: 0 },
    orders: { timer: null, intervalMs: DEFAULT_INTERVAL_MS, inFlight: null, inFlightGeneration: 0 },
    positionHistory: { timer: null, intervalMs: DEFAULT_INTERVAL_MS, inFlight: null, inFlightGeneration: 0 },
  };

  /**
   * Session generation. Incremented whenever the session changes, and
   * captured by every request when it is issued. A response whose
   * generation is no longer current is DROPPED, never committed — so a
   * request that left under the previous user cannot land in the next
   * user's state no matter how slow it was.
   */
  private generation = 0;
  /** The token the currently held state was fetched under. */
  private sessionToken: string | null = null;
  private sessionUnsubscribe: (() => void) | null = null;

  getState(): FuturesAccountState {
    return this.state;
  }

  /**
   * Subscribe, declaring which resources to keep polled and how fast.
   *
   *   subscribe(fn, { positions: 4000, balances: 5000 })
   *
   * Returns an unsubscribe function. The timers for those resources stop
   * when their last interested subscriber leaves.
   */
  subscribe(listener: Listener, wants: Partial<Record<ResourceKey, number>>): () => void {
    this.ensureSessionWatch();
    this.dropStateIfSessionChanged();

    const key = Symbol('futures-account-subscriber');
    this.subscribers.set(key, { listener, wants });

    // A late subscriber sees what is already known immediately rather than
    // waiting a whole interval for its first paint.
    listener(this.state);

    for (const resource of Object.keys(wants) as ResourceKey[]) {
      this.retime(resource);
      if (this.needsRefresh(resource)) void this.refresh(resource);
    }

    return () => {
      this.subscribers.delete(key);
      for (const resource of Object.keys(wants) as ResourceKey[]) this.retime(resource);
    };
  }

  /**
   * Refresh these resources now, once — the event-driven half.
   *
   * Called after an order is placed or cancelled, a position is closed, or
   * funds are transferred: the exact moments the account really did change
   * and the trader is looking. Before this, those moments were covered
   * only by whichever poll happened to fire next, so a completed transfer
   * could sit invisible for up to five seconds.
   *
   * In-flight deduplication still applies, so an invalidate landing on top
   * of a poll costs nothing.
   */
  invalidate(resources: ResourceKey[] = RESOURCE_KEYS): void {
    for (const resource of resources) void this.refresh(resource);
  }

  /**
   * Fetch one resource, shared. Concurrent callers join the in-flight
   * promise rather than issuing a second identical request.
   */
  refresh(resource: ResourceKey): Promise<void> {
    this.dropStateIfSessionChanged();
    const runtime = this.runtime[resource];
    if (runtime.inFlight) return runtime.inFlight;

    // No session, no account request. Without this, a logged-out tab left
    // on the page would poll for 401s.
    const token = getToken();
    if (!token) return Promise.resolve();

    const generation = this.generation;
    runtime.inFlightGeneration = generation;

    const current = this.state[resource];
    this.patch(resource, current.data === null ? { loading: true } : { refreshing: true });

    runtime.inFlight = (FETCHERS[resource]() as Promise<never[]>)
      .then((data) => {
        // Two independent guards, both required. The generation catches a
        // logout/login that happened while this was in the air; the token
        // comparison catches a session change by any path that did not go
        // through the notifier at all.
        if (generation !== this.generation || getToken() !== token) return;
        this.patch(resource, {
          data,
          loading: false,
          refreshing: false,
          failed: false,
          loaded: true,
          fetchedAt: Date.now(),
        });
      })
      .catch(() => {
        if (generation !== this.generation || getToken() !== token) return;
        // A failure keeps whatever was last known good on screen and flags
        // it stale. It never substitutes an empty array and never a zero:
        // `data` is left exactly as it was, which for a cold store is
        // `null` — an unknown, which the views render as a dash.
        this.patch(resource, { loading: false, refreshing: false, failed: true, loaded: true });
      })
      .finally(() => {
        if (runtime.inFlightGeneration === generation) runtime.inFlight = null;
      });

    return runtime.inFlight;
  }

  /**
   * Forget everything and stop every timer. Called on any session change,
   * which is the whole reason a module-level account store is safe here:
   * component state used to die with the unmount on logout, and shared
   * state does not, so it has to be dropped explicitly.
   */
  reset(): void {
    this.generation += 1;
    for (const resource of RESOURCE_KEYS) {
      const runtime = this.runtime[resource];
      if (runtime.timer !== null) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }
      runtime.inFlight = null;
    }
    this.state = emptyState();
    this.sessionToken = getToken();
    this.emit();
    // Whoever is still mounted now needs their resources re-polled under
    // the new session.
    for (const resource of RESOURCE_KEYS) {
      this.retime(resource);
      if (this.wantedIntervalFor(resource) !== null) void this.refresh(resource);
    }
  }

  private ensureSessionWatch(): void {
    if (this.sessionUnsubscribe) return;
    this.sessionToken = getToken();
    this.sessionUnsubscribe = onSessionChange(() => this.reset());
  }

  /** Belt and braces for a token that changed without the notifier firing
   *  (another tab writing localStorage, say). */
  private dropStateIfSessionChanged(): void {
    const token = getToken();
    if (token === this.sessionToken) return;
    this.reset();
  }

  private needsRefresh(resource: ResourceKey): boolean {
    const current = this.state[resource];
    if (!current.loaded) return true;
    return Date.now() - current.fetchedAt >= this.runtime[resource].intervalMs;
  }

  /** The fastest cadence any live subscriber asked for, or null when
   *  nobody wants this resource polled. */
  private wantedIntervalFor(resource: ResourceKey): number | null {
    let wanted: number | null = null;
    for (const { wants } of this.subscribers.values()) {
      const ms = wants[resource];
      if (ms === undefined) continue;
      const clamped = Math.max(MIN_INTERVAL_MS, ms);
      wanted = wanted === null ? clamped : Math.min(wanted, clamped);
    }
    return wanted;
  }

  private retime(resource: ResourceKey): void {
    const runtime = this.runtime[resource];
    const wanted = this.wantedIntervalFor(resource);

    if (wanted === null) {
      if (runtime.timer !== null) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }
      return;
    }

    if (runtime.timer !== null && wanted === runtime.intervalMs) return;
    runtime.intervalMs = wanted;
    if (runtime.timer !== null) clearInterval(runtime.timer);
    runtime.timer = setInterval(() => void this.refresh(resource), wanted);
  }

  private patch<K extends ResourceKey>(resource: K, changes: Partial<FuturesAccountState[K]>): void {
    this.state = { ...this.state, [resource]: { ...this.state[resource], ...changes } };
    this.emit();
  }

  private emit(): void {
    for (const { listener } of this.subscribers.values()) listener(this.state);
  }

  // ── Test seams ────────────────────────────────────────────────────
  _resetForTests(): void {
    for (const resource of RESOURCE_KEYS) {
      const runtime = this.runtime[resource];
      if (runtime.timer !== null) clearInterval(runtime.timer);
      runtime.timer = null;
      runtime.inFlight = null;
      runtime.intervalMs = DEFAULT_INTERVAL_MS;
    }
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = null;
    this.subscribers.clear();
    this.state = emptyState();
    this.generation = 0;
    this.sessionToken = null;
  }

  get _timerCount(): number {
    return RESOURCE_KEYS.reduce((n, r) => n + (this.runtime[r].timer === null ? 0 : 1), 0);
  }

  get _subscriberCount(): number {
    return this.subscribers.size;
  }

  _intervalOf(resource: ResourceKey): number | null {
    return this.runtime[resource].timer === null ? null : this.runtime[resource].intervalMs;
  }
}

export const futuresAccountStore = new FuturesAccountStore();
