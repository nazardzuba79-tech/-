import {
  HttpProviderClient,
  ProviderHealth,
  ProviderUnavailableError,
  backoffWithJitter,
  parseRetryAfter,
} from '../ProviderHealth';

/**
 * Deterministic: injected clock, injected sleep (recorded, never awaited
 * for real), injected random. Nothing here reaches the network.
 */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:45 GMT', now)).toBe(45_000);
  });

  it('treats an unparseable or absent header as "no guidance", not as zero', () => {
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });
});

describe('backoffWithJitter', () => {
  it('grows exponentially but never past the ceiling', () => {
    expect(backoffWithJitter(0, 250, 4_000, () => 1)).toBe(250);
    expect(backoffWithJitter(1, 250, 4_000, () => 1)).toBe(500);
    expect(backoffWithJitter(9, 250, 4_000, () => 1)).toBe(4_000);
  });

  it('is full-jitter: the delay is a random point inside the window, not the window', () => {
    expect(backoffWithJitter(3, 250, 4_000, () => 0)).toBe(0);
    expect(backoffWithJitter(3, 250, 4_000, () => 0.5)).toBe(1_000);
  });
});

describe('ProviderHealth circuit', () => {
  it('starts healthy and closed', () => {
    const health = new ProviderHealth('test');
    expect(health.snapshot()).toMatchObject({ state: 'CLOSED', healthy: true, consecutiveFailures: 0 });
    expect(health.canAttempt()).toBe(true);
  });

  it('opens after the failure threshold and refuses attempts during the cooldown', () => {
    const time = clock();
    const health = new ProviderHealth('test', { failureThreshold: 3, cooldownMs: 30_000, now: time.now });

    health.recordFailure({});
    health.recordFailure({});
    expect(health.canAttempt()).toBe(true); // still under the threshold
    health.recordFailure({});

    expect(health.snapshot()).toMatchObject({ state: 'OPEN', healthy: false, consecutiveFailures: 3 });
    expect(health.canAttempt()).toBe(false);
  });

  it('half-opens for a single probe once the cooldown elapses, and closes on success', () => {
    const time = clock();
    const transitions: string[] = [];
    const health = new ProviderHealth('test', {
      failureThreshold: 1,
      cooldownMs: 30_000,
      now: time.now,
      onStateChange: (_p, from, to) => transitions.push(`${from}->${to}`),
    });

    health.recordFailure({});
    expect(health.canAttempt()).toBe(false);

    time.advance(30_000);
    expect(health.canAttempt()).toBe(true); // the probe
    expect(health.snapshot().state).toBe('HALF_OPEN');

    health.recordSuccess();
    expect(health.snapshot()).toMatchObject({ state: 'CLOSED', healthy: true, consecutiveFailures: 0 });
    expect(transitions).toEqual(['CLOSED->OPEN', 'OPEN->HALF_OPEN', 'HALF_OPEN->CLOSED']);
  });

  it('doubles the cooldown when the probe fails, up to the configured ceiling', () => {
    const time = clock();
    const health = new ProviderHealth('test', { failureThreshold: 1, cooldownMs: 1_000, maxCooldownMs: 4_000, now: time.now });

    health.recordFailure({});
    time.advance(1_000);
    health.canAttempt(); // HALF_OPEN
    health.recordFailure({}); // probe failed -> 2s
    expect(health.retryAtMs).toBe(time.now() + 2_000);

    time.advance(2_000);
    health.canAttempt();
    health.recordFailure({}); // -> 4s (ceiling)
    expect(health.retryAtMs).toBe(time.now() + 4_000);

    time.advance(4_000);
    health.canAttempt();
    health.recordFailure({}); // stays at the ceiling
    expect(health.retryAtMs).toBe(time.now() + 4_000);
  });

  it('honours Retry-After over its own cooldown and counts the rate limit', () => {
    const time = clock();
    const health = new ProviderHealth('test', { failureThreshold: 10, cooldownMs: 1_000, now: time.now });

    health.recordFailure({ retryAfterMs: 120_000, rateLimited: true });

    // A single 429 opens the circuit immediately when the provider named a
    // wait — it told us exactly what it wants.
    expect(health.snapshot()).toMatchObject({ state: 'OPEN', rateLimitHits: 1 });
    expect(health.retryAtMs).toBe(time.now() + 120_000);
    expect(health.canAttempt()).toBe(false);
  });
});

describe('HttpProviderClient', () => {
  function make(fetchFn: jest.Mock, opts: Partial<Record<string, unknown>> = {}) {
    const time = clock();
    const slept: number[] = [];
    const health = new ProviderHealth('test', { now: time.now, ...(opts.healthOptions as object) });
    const client = new HttpProviderClient('Test', {
      fetchFn: fetchFn as unknown as typeof fetch,
      health,
      retries: (opts.retries as number) ?? 2,
      sleep: async (ms) => { slept.push(ms); },
      random: () => 1,
      now: time.now,
      ...(opts.clientOptions as object),
    });
    return { client, health, slept, time };
  }

  it('returns parsed JSON and records a success', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, { ok: true }));
    const { client, health } = make(fetchFn);

    await expect(client.getJson('https://x/y')).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(health.snapshot().healthy).toBe(true);
  });

  it('retries a 500 with backoff and succeeds on the second attempt', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, { recovered: true }));
    const { client, slept } = make(fetchFn);

    await expect(client.getJson('https://x/y')).resolves.toEqual({ recovered: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(slept).toHaveLength(1);
  });

  it('does NOT retry a 404 and does not blame the provider for it', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(404));
    const { client, health } = make(fetchFn);

    await expect(client.getJson('https://x/y')).rejects.toThrow('HTTP 404');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(health.snapshot().consecutiveFailures).toBe(0);
  });

  it('stops immediately on a 429 whose Retry-After exceeds the retry budget', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(429, {}, { 'retry-after': '600' }));
    const { client, health } = make(fetchFn);

    await expect(client.getJson('https://x/y')).rejects.toThrow('HTTP 429');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(health.snapshot()).toMatchObject({ state: 'OPEN', rateLimitHits: 1 });
  });

  it('refuses to touch the network at all while the circuit is open', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(429, {}, { 'retry-after': '600' }));
    const { client } = make(fetchFn);

    await expect(client.getJson('https://x/y')).rejects.toThrow();
    fetchFn.mockClear();

    await expect(client.getJson('https://x/y')).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('recovers after the cooldown: one probe, then normal service', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(429, {}, { 'retry-after': '30' }));
    const { client, health, time } = make(fetchFn);

    await expect(client.getJson('https://x/y')).rejects.toThrow();
    expect(health.snapshot().state).toBe('OPEN');

    time.advance(30_000);
    fetchFn.mockResolvedValue(response(200, { back: true }));
    await expect(client.getJson('https://x/y')).resolves.toEqual({ back: true });
    expect(health.snapshot()).toMatchObject({ state: 'CLOSED', healthy: true });
  });

  it('retries a transport error a bounded number of times, then gives up', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const { client } = make(fetchFn, { retries: 2 });

    await expect(client.getJson('https://x/y')).rejects.toThrow('Failed to reach Test');
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries, never unbounded
  });

  it('calls fetch with a single argument when there is no init', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, {}));
    const { client } = make(fetchFn);

    await client.getJson('https://x/y');
    expect(fetchFn).toHaveBeenCalledWith('https://x/y');
  });
});
