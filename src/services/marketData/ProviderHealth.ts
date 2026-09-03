/**
 * Per-provider operational state and the retry policy that reads it.
 *
 * The problem this solves: every provider client here used to retry
 * nothing and know nothing. A rate-limited CoinGecko or a briefly
 * unreachable Kraken produced the same behaviour as a permanent outage —
 * every single request went out, failed, and the next caller did it again
 * immediately. That is exactly the shape that turns a soft 429 into a hard
 * IP ban.
 *
 * Three pieces, deliberately small:
 *
 *   ProviderHealth — counts consecutive failures, remembers last
 *     success/failure, and opens a circuit after a threshold. OPEN means
 *     "don't even try until the cooldown elapses"; the first attempt after
 *     it is HALF_OPEN — one probe, and a success closes the circuit again.
 *
 *   parseRetryAfter — a 429/503 that tells us when to come back is
 *     honoured literally, in preference to our own backoff guess.
 *
 *   HttpProviderClient — the shared outbound GET: bounded retries,
 *     exponential backoff with jitter, Retry-After respect, health
 *     recording, and a hard stop when the circuit is open.
 *
 * Nothing here logs a secret: the only thing that reaches a log line is the
 * provider name, an HTTP status, and timing.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderHealthSnapshot {
  provider: string;
  state: CircuitState;
  /** CLOSED with no recent failures. */
  healthy: boolean;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /** Epoch ms until which the circuit refuses attempts; null when closed. */
  cooldownUntil: number | null;
  /** Count of 429s seen since process start — the number that matters when
   *  deciding whether a provider budget is being exceeded. */
  rateLimitHits: number;
}

export interface ProviderHealthOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold?: number;
  /** First cooldown once open; doubles per subsequent failed probe. */
  cooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
  /** State-change hook — used for the one log line per transition, so a
   *  flapping provider doesn't produce a log per request. */
  onStateChange?: (provider: string, from: CircuitState, to: CircuitState) => void;
}

/** Thrown instead of making a request while a provider's circuit is open. */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAtMs: number
  ) {
    super(`${provider} is temporarily unavailable (circuit open)`);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderHealth {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private cooldownUntil: number | null = null;
  private cooldownMs: number;
  private rateLimitHits = 0;

  private readonly failureThreshold: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: ProviderHealthOptions['onStateChange'];

  constructor(
    public readonly provider: string,
    options: ProviderHealthOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 4;
    this.baseCooldownMs = options.cooldownMs ?? 30_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 5 * 60_000;
    this.cooldownMs = this.baseCooldownMs;
    // See ProviderCache: wrapped so a mocked clock actually applies.
    this.now = options.now ?? (() => Date.now());
    this.onStateChange = options.onStateChange;
  }

  /** False only while OPEN and still inside the cooldown. The first call
   *  after the cooldown elapses transitions to HALF_OPEN and returns true —
   *  that caller is the probe. */
  canAttempt(): boolean {
    if (this.state !== 'OPEN') return true;
    if (this.cooldownUntil !== null && this.now() >= this.cooldownUntil) {
      this.transition('HALF_OPEN');
      return true;
    }
    return false;
  }

  /** When the circuit will accept a probe. Meaningless while closed. */
  get retryAtMs(): number {
    return this.cooldownUntil ?? this.now();
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = this.now();
    this.cooldownUntil = null;
    this.cooldownMs = this.baseCooldownMs;
    if (this.state !== 'CLOSED') this.transition('CLOSED');
  }

  /**
   * `retryAfterMs` comes from the provider's own Retry-After header when it
   * sent one — always preferred over our doubling guess, because it is the
   * provider telling us exactly how long it wants to be left alone.
   */
  recordFailure(options: { retryAfterMs?: number; rateLimited?: boolean } = {}): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = this.now();
    if (options.rateLimited) this.rateLimitHits += 1;

    const probeFailed = this.state === 'HALF_OPEN';
    if (probeFailed) {
      // A failed probe doubles the wait rather than immediately probing
      // again — otherwise a hard-down provider gets one request per
      // cooldown forever at the shortest possible interval.
      this.cooldownMs = Math.min(this.cooldownMs * 2, this.maxCooldownMs);
    }

    if (probeFailed || this.consecutiveFailures >= this.failureThreshold || options.retryAfterMs !== undefined) {
      const wait = Math.max(options.retryAfterMs ?? 0, this.cooldownMs);
      this.cooldownUntil = this.now() + wait;
      if (this.state !== 'OPEN') this.transition('OPEN');
    }
  }

  snapshot(): ProviderHealthSnapshot {
    return {
      provider: this.provider,
      state: this.state,
      healthy: this.state === 'CLOSED' && this.consecutiveFailures === 0,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      cooldownUntil: this.state === 'CLOSED' ? null : this.cooldownUntil,
      rateLimitHits: this.rateLimitHits,
    };
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.onStateChange?.(this.provider, from, to);
  }
}

/**
 * RFC 7231 allows either delta-seconds or an HTTP-date. Both appear in the
 * wild; a value we can't parse is treated as absent rather than as zero,
 * which would defeat the point of the header.
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

/** Full jitter (AWS's own recommendation): a random point in [0, delay]
 *  rather than the delay itself, so N clients that failed together don't
 *  retry in lockstep and re-create the burst that failed. */
export function backoffWithJitter(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * The knobs a provider service exposes to its callers. Production uses the
 * defaults; tests inject `{ retries: 0 }` (or a no-op sleep) so a mocked
 * failure fails immediately instead of spending the real backoff.
 */
export interface ProviderRequestPolicy {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpProviderClientOptions {
  fetchFn?: typeof fetch;
  health: ProviderHealth;
  /** Attempts AFTER the first one. Bounded on purpose — there is no
   *  configuration here that produces an unbounded retry loop. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Wraps a provider-shaped failure in the caller's own error type, so
   *  existing route error handling (ExternalMarketDataError etc.) keeps
   *  working unchanged. */
  wrapError?: (message: string, cause?: unknown) => Error;
}

/** A response the provider itself said was a rate limit or a transient
 *  server-side fault — those are worth retrying; a 404 or a 400 is not. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class HttpProviderClient {
  private readonly fetchFn: typeof fetch;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly wrapError: (message: string, cause?: unknown) => Error;

  constructor(
    public readonly provider: string,
    private readonly options: HttpProviderClientOptions
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.retries = options.retries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.maxDelayMs = options.maxDelayMs ?? 4_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.wrapError = options.wrapError ?? ((message) => new Error(message));
  }

  get health(): ProviderHealth {
    return this.options.health;
  }

  /**
   * GET + JSON, with the whole policy applied. Throws
   * ProviderUnavailableError without touching the network while the
   * circuit is open — that is the point of the circuit.
   */
  async getJson(url: string, init?: RequestInit): Promise<unknown> {
    const health = this.options.health;
    if (!health.canAttempt()) {
      throw new ProviderUnavailableError(this.provider, health.retryAtMs);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await this.sleep(backoffWithJitter(attempt - 1, this.baseDelayMs, this.maxDelayMs, this.random));
      }

      let res: Response;
      try {
        // Called with one argument when there is no init, so a caller's
        // fetch double (and any assertion on how it was called) sees the
        // same shape it did before this client existed.
        res = init ? await this.fetchFn(url, init) : await this.fetchFn(url);
      } catch (err: any) {
        lastError = this.wrapError(`Failed to reach ${this.provider}: ${err?.message ?? err}`, err);
        continue; // a transport error is always worth one more bounded try
      }

      if (res.ok) {
        health.recordSuccess();
        return res.json();
      }

      const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'), this.now());
      lastError = this.wrapError(`${this.provider} responded with HTTP ${res.status}`);

      if (!isRetryableStatus(res.status)) {
        // A 4xx that isn't a rate limit is our request's fault, not the
        // provider being unwell — it must not count toward opening the
        // circuit for everyone else.
        throw lastError;
      }
      if (res.status === 429) {
        health.recordFailure({ retryAfterMs: retryAfterMs ?? undefined, rateLimited: true });
        // A provider that named a wait longer than our remaining budget is
        // not worth hammering — surface it now and let the cache serve.
        if (retryAfterMs !== null && retryAfterMs > this.maxDelayMs) throw lastError;
      }
      if (retryAfterMs !== null && res.status !== 429) {
        await this.sleep(Math.min(retryAfterMs, this.maxDelayMs));
      }
    }

    health.recordFailure({});
    throw lastError ?? this.wrapError(`${this.provider} request failed`);
  }
}

/**
 * Process-wide registry so /analytics (and any future ops view) can report
 * provider state without every service having to hand its health object
 * around. Registration is explicit — nothing is auto-discovered.
 */
class ProviderHealthRegistry {
  private readonly providers = new Map<string, ProviderHealth>();

  register(health: ProviderHealth): ProviderHealth {
    this.providers.set(health.provider, health);
    return health;
  }

  get(provider: string): ProviderHealth | null {
    return this.providers.get(provider) ?? null;
  }

  snapshot(): ProviderHealthSnapshot[] {
    return Array.from(this.providers.values()).map((h) => h.snapshot());
  }
}

export const providerHealthRegistry = new ProviderHealthRegistry();

/** One log line per circuit transition — enough to see a provider go down
 *  and come back in the Render logs, quiet enough to survive a bad hour. */
export function logCircuitTransition(provider: string, from: CircuitState, to: CircuitState): void {
  if (to === 'OPEN') console.warn(`[marketData] ${provider} circuit ${from} -> OPEN (backing off)`);
  else if (to === 'CLOSED') console.log(`[marketData] ${provider} circuit ${from} -> CLOSED (recovered)`);
  else console.log(`[marketData] ${provider} circuit ${from} -> ${to}`);
}
