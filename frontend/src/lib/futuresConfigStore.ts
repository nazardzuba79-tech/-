import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * ONE read of `/futures/config` per browser tab, shared by every consumer.
 *
 * The problem this solves, measured on the shipped build against the
 * fixture harness: a cold `/futures` fetched the same static endpoint
 * three times inside ~250 ms, because three components each called
 * `api.getFuturesConfig()` from their own mount effect —
 * `FuturesPage` (the listed contracts), `FuturesOrderForm` (leverage
 * bounds and tiers) and `FuturesTickerBar` (the funding interval). Two
 * more call sites did the same on `/markets` and the homepage. Five
 * copies of one answer, with no cache between them.
 *
 * The shape is the same one `futuresAccountStore` and `marketDataStore`
 * already use, minus everything this resource does not need:
 *
 *   - ONE in-flight request. A consumer mounting mid-flight joins the
 *     existing promise instead of issuing a second identical one.
 *   - The resolved value is reused by every later consumer, with no
 *     network at all — and on the SAME terms however it is asked for.
 *     `ensure()` and `load()` share one freshness test, so the homepage's
 *     imperative read cannot issue a request for an answer `/futures`
 *     already fetched a moment earlier. `refresh()` is the deliberate
 *     exception: it is defined to hit the network, so it goes straight to
 *     the request and never answers from the cache.
 *   - NO timer and NO polling loop. Nothing here schedules anything; a
 *     re-read only ever happens because a consumer asked and the held
 *     value was missing or older than STALE_AFTER_MS, or because someone
 *     called `refresh()` on purpose.
 *
 * Why there is no session isolation, unlike `futuresAccountStore`
 * -------------------------------------------------------------
 * `/futures/config` is the one futures route with NO auth middleware on
 * it (see `src/api/routes/futures.ts`: every other futures route carries
 * `requireAuthOrApiKey`, this one carries nothing). Its body is
 * `marketRegistry.list()` plus module constants — the listed contracts,
 * the leverage bounds, the funding interval, the high-leverage warning
 * threshold and the tier table. Not one field is derived from the caller,
 * so two different users, and a logged-out visitor, receive byte-identical
 * responses. There is no user state to leak on logout, and dropping the
 * value on a session change would only re-fetch the same bytes. The
 * homepage — which is public — reads it through this same store for
 * exactly that reason.
 *
 * NOTHING here reads, computes, adjusts or reinterprets a financial
 * figure. It moves the same bytes to the same consumers; the leverage
 * tiers, maintenance margin rates, funding interval and contract listing
 * are the server's, unchanged, and every calculation that uses them stays
 * exactly where it was.
 */

export type FuturesConfig = Awaited<ReturnType<typeof api.getFuturesConfig>>;

export interface FuturesConfigState {
  /**
   * `null` means NOT KNOWN — no successful read yet, or every read so far
   * failed. It is never a stand-in default: this store has no built-in
   * tier table, no leverage bounds and no funding interval of its own, so
   * a consumer that renders `—` for an unknown value keeps doing so.
   */
  config: FuturesConfig | null;
  /** No successful read yet, and a request is in flight. */
  loading: boolean;
  /** The last attempt failed. With `config !== null` this means "stale". */
  failed: boolean;
  /** True once an attempt has settled, so "failed" is distinguishable
   *  from "not asked yet". */
  loaded: boolean;
}

/**
 * How old a held value may be before the NEXT consumer to mount triggers a
 * background re-read. This is not a poll: nothing fires on a timer, and a
 * tab left sitting on /futures never re-reads. It exists only so that the
 * contract listing — the one field the backend derives from live market
 * data — cannot stay pinned for the whole life of a long-lived SPA
 * session. Before this store, every mount re-read it; five minutes keeps
 * that property to within a navigation, at one request instead of three.
 */
const STALE_AFTER_MS = 5 * 60_000;

type Listener = (state: FuturesConfigState) => void;

class FuturesConfigStore {
  private state: FuturesConfigState = { config: null, loading: false, failed: false, loaded: false };
  private fetchedAt = 0;
  private inFlight: Promise<FuturesConfig> | null = null;
  private listeners = new Set<Listener>();

  getState(): FuturesConfigState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Make sure a value is on its way, without duplicating work.
   *
   * Called from a consumer's mount effect. Cheap and idempotent: a fresh
   * value means no request at all, and an in-flight request is joined
   * rather than raced.
   */
  ensure(): void {
    if (this.isFresh()) return;
    void this.fetch().catch(() => {
      // Already recorded on the state as `failed`; this catch only stops
      // an unhandled rejection from a caller that did not want the promise.
    });
  }

  /**
   * The imperative form, for a caller that needs the value itself rather
   * than a subscription — the homepage reads it this way, inside a larger
   * effect that owns its own error state.
   *
   * It answers from the cache on exactly the same terms `ensure()` does.
   * Without that, `/futures` → homepage inside the freshness window issued
   * a second request for an answer the tab already held, which is the very
   * thing this store exists to stop: "one read per tab" has to mean the
   * same thing whichever way a consumer asks.
   *
   * REJECTS when the read fails — a failure stays a failure, so a caller
   * with its own error state can keep reporting it exactly as it did when
   * it called the API directly.
   */
  load(): Promise<FuturesConfig> {
    if (this.inFlight) return this.inFlight;
    // The exact cached object, not a copy: a consumer keying an effect on
    // it must not be re-run for having asked twice.
    if (this.isFresh()) return Promise.resolve(this.state.config as FuturesConfig);
    return this.fetch();
  }

  /**
   * Force a real re-read, whatever the cache holds. This is the explicit
   * retry seam — the one call that is DEFINED to hit the network — so it
   * must not be routed through `load()`, which would hand back the fresh
   * cache and quietly make the seam a no-op. An in-flight request is still
   * joined: forcing a read does not mean forcing a duplicate one.
   */
  refresh(): Promise<FuturesConfig> {
    return this.fetch();
  }

  /** Is the held value real and still inside the freshness window? */
  private isFresh(): boolean {
    return this.state.config !== null && Date.now() - this.fetchedAt <= STALE_AFTER_MS;
  }

  /**
   * The request itself, and the only place it is issued. One at a time:
   * every caller that arrives while it is in the air joins this promise
   * rather than starting a second one.
   */
  private fetch(): Promise<FuturesConfig> {
    if (this.inFlight) return this.inFlight;

    this.emit({ ...this.state, loading: this.state.config === null });

    const request = api
      .getFuturesConfig()
      .then((config) => {
        this.fetchedAt = Date.now();
        // Identity is kept when the payload has not actually changed, so a
        // re-read of an unchanged config does not re-run consumers'
        // effects or re-render them for nothing.
        const unchanged =
          this.state.config !== null && JSON.stringify(this.state.config) === JSON.stringify(config);
        this.emit({
          config: unchanged ? this.state.config : config,
          loading: false,
          failed: false,
          loaded: true,
        });
        return this.state.config as FuturesConfig;
      })
      .catch((error) => {
        // No fallback value, ever. `config` is left exactly as it was —
        // `null` if nothing ever loaded, which consumers render as unknown,
        // or the last good answer, which for a static config is still the
        // truest thing available and is now flagged stale.
        this.emit({ ...this.state, loading: false, failed: true, loaded: true });
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = request;
    return request;
  }

  private emit(next: FuturesConfigState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Test seam. */
  _resetForTests(): void {
    this.state = { config: null, loading: false, failed: false, loaded: false };
    this.fetchedAt = 0;
    this.inFlight = null;
    this.listeners.clear();
  }
}

export const futuresConfigStore = new FuturesConfigStore();

/**
 * Read the futures configuration from the one shared store.
 *
 * Every consumer gets the same object: the first to mount pays for the
 * request, the rest are served from memory. `config` stays `null` until a
 * read has actually succeeded.
 */
export function useFuturesConfig(): FuturesConfigState {
  const [state, setState] = useState<FuturesConfigState>(() => futuresConfigStore.getState());

  useEffect(() => {
    const unsubscribe = futuresConfigStore.subscribe(setState);
    futuresConfigStore.ensure();
    return unsubscribe;
  }, []);

  return state;
}
