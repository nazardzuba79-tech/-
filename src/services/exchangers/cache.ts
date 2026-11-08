/**
 * One cached value with single-flight refresh, stale-on-error and a failure
 * cooldown («Обменники», #694).
 *
 *   - inside `ttlMs` the value is served with no upstream call;
 *   - after that, the first caller starts ONE refresh and every concurrent caller
 *     joins it (never two refreshes in flight);
 *   - if the refresh fails, every caller (leader and joiners) gets the previous
 *     value flagged `stale: true` while it is younger than `ttlMs + maxStaleMs`,
 *     otherwise the error;
 *   - after a failure no new refresh starts for `cooldownMs`, so an outage never
 *     turns client traffic into upstream traffic.
 */
export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

export interface RefreshingValueOptions {
  ttlMs: number;
  maxStaleMs: number;
  /** Fixed, or chosen per failure (e.g. longer for a rejected key). */
  cooldownMs: number | ((error: unknown) => number);
  now?: () => number;
}

export class RefreshingValue<T> {
  private entry: { value: T; fetchedAt: number } | null = null;
  private inFlight: Promise<void> | null = null;
  private lastError: unknown = null;
  private cooldownUntil = 0;
  private readonly now: () => number;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly options: RefreshingValueOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Milliseconds until a refresh may be attempted again (0 when none is blocked). */
  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  async get(): Promise<Cached<T>> {
    const entry = this.entry;
    if (entry && this.now() - entry.fetchedAt <= this.options.ttlMs) {
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
    }
    if (!this.inFlight && this.now() < this.cooldownUntil) return this.staleOr(this.lastError);
    if (!this.inFlight) {
      this.inFlight = this.load().then(
        (value) => {
          this.entry = { value, fetchedAt: this.now() };
          this.lastError = null;
          this.cooldownUntil = 0;
          this.inFlight = null;
        },
        (error: unknown) => {
          this.lastError = error;
          const cooldown = this.options.cooldownMs;
          this.cooldownUntil = this.now() + (typeof cooldown === 'function' ? cooldown(error) : cooldown);
          this.inFlight = null;
          throw error;
        },
      );
    }
    try {
      await this.inFlight;
    } catch (error) {
      return this.staleOr(error);
    }
    const fresh = this.entry;
    if (!fresh) return this.staleOr(this.lastError);
    return { value: fresh.value, fetchedAt: fresh.fetchedAt, stale: false };
  }

  private staleOr(error: unknown): Cached<T> {
    const entry = this.entry;
    if (entry && this.now() - entry.fetchedAt <= this.options.ttlMs + this.options.maxStaleMs) {
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true };
    }
    throw error;
  }
}
