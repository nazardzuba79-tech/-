/**
 * The one caching primitive every outbound market-data provider goes
 * through.
 *
 * Before this existed, each service hand-rolled `{ data, expiresAt }` maps
 * with subtly different behaviour: only Kraken's ticker walk deduplicated
 * concurrent callers, only CoinGecko/Fear & Greed served a last-good value
 * when a refresh failed, and none of the per-symbol maps had any bound at
 * all. This class is those three behaviours in one place:
 *
 *   1. TTL — inside `ttlMs` a value is served with no outbound request.
 *   2. In-flight deduplication — N callers arriving on a cold/expired key
 *      share ONE loader promise. Homepage, Markets and the Trade pair list
 *      asking for the ticker snapshot in the same tick cost one provider
 *      request, not three.
 *   3. Stale-last-good — a failed refresh serves the previous value for up
 *      to `maxStaleMs` past expiry, flagged `stale: true` so the caller can
 *      decide (and so the API can say so) rather than silently presenting
 *      old numbers as current. Past that window the error propagates: for
 *      trading-adjacent data an honest failure beats an arbitrarily old
 *      price.
 *
 * Bounded on purpose (`maxEntries`, LRU by last read): the per-symbol
 * caches are keyed by whatever a client asks for, so an unbounded Map is a
 * memory leak an outsider can drive. This runs on one small Render
 * instance — nothing here may grow without a ceiling.
 */

export interface CachedValue<T> {
  value: T;
  /** When the underlying provider data was actually fetched (epoch ms). */
  fetchedAt: number;
  /** True when this was served past its TTL because a refresh failed. */
  stale: boolean;
}

export interface ProviderCacheOptions {
  /** How long a fetched value counts as fresh. */
  ttlMs: number;
  /**
   * How long past `ttlMs` a value may still be served if — and only if —
   * a refresh attempt fails. 0 disables stale serving entirely, which is
   * the right choice for anything a trade could be priced off.
   */
  maxStaleMs?: number;
  /** LRU ceiling. Defaults to 200 keys, which comfortably covers every
   *  listed pair without letting an arbitrary-symbol caller grow it. */
  maxEntries?: number;
  /** Injectable for deterministic tests. */
  now?: () => number;
  /** Called once per stale serve, so the app can log/measure degradation
   *  without this class knowing anything about logging. */
  onStaleServe?: (key: string, ageMs: number) => void;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class ProviderCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onStaleServe?: (key: string, ageMs: number) => void;

  constructor(options: ProviderCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxStaleMs = options.maxStaleMs ?? 0;
    this.maxEntries = options.maxEntries ?? 200;
    // Wrapped rather than captured by reference: a bare `Date.now`
    // binding cannot be replaced by a test's clock mock.
    this.now = options.now ?? (() => Date.now());
    this.onStaleServe = options.onStaleServe;
  }

  /** Cached value without triggering any fetch. Returns null when nothing
   *  usable is held — including a value already past TTL + maxStaleMs. */
  peek(key: string): CachedValue<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = this.now() - entry.fetchedAt;
    if (age > this.ttlMs + this.maxStaleMs) return null;
    return { value: entry.value, fetchedAt: entry.fetchedAt, stale: age > this.ttlMs };
  }

  /**
   * The main entry point: serve fresh, join an in-flight load, or run
   * `loader` — falling back to a stale value only if the loader fails and
   * the previous value is still inside the stale window.
   */
  async fetch(key: string, loader: () => Promise<T>): Promise<CachedValue<T>> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.fetchedAt <= this.ttlMs) {
      this.touch(key, entry);
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      // Deliberately shares the failure too: a joined caller sees the same
      // outcome the leader saw rather than firing its own duplicate
      // request at a provider that just failed.
      const value = await existing;
      const fetched = this.entries.get(key);
      return { value, fetchedAt: fetched?.fetchedAt ?? this.now(), stale: false };
    }

    const load = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);

    try {
      const value = await load;
      return { value, fetchedAt: this.entries.get(key)?.fetchedAt ?? this.now(), stale: false };
    } catch (err) {
      const previous = this.entries.get(key);
      if (previous) {
        const age = this.now() - previous.fetchedAt;
        if (age <= this.ttlMs + this.maxStaleMs) {
          this.onStaleServe?.(key, age);
          this.touch(key, previous);
          return { value: previous.value, fetchedAt: previous.fetchedAt, stale: true };
        }
      }
      throw err;
    }
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, fetchedAt: this.now() });
    this.evictIfNeeded();
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Map preserves insertion order, so re-inserting on read makes the
   *  first key the least recently used one. */
  private touch(key: string, entry: Entry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
