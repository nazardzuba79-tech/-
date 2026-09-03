import { ProviderCache } from '../ProviderCache';

/**
 * Deterministic throughout: the clock is injected, so nothing here sleeps
 * and nothing depends on wall-clock timing. No test in this file touches a
 * network — the "provider" is always a jest.fn.
 */
describe('ProviderCache', () => {
  function clock(start = 1_000_000) {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
  }

  it('calls the loader once for the first request and serves the cache inside the TTL', async () => {
    const time = clock();
    const cache = new ProviderCache<string>({ ttlMs: 5_000, now: time.now });
    const loader = jest.fn().mockResolvedValue('value');

    const first = await cache.fetch('k', loader);
    time.advance(4_999);
    const second = await cache.fetch('k', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first.value).toBe('value');
    expect(second.stale).toBe(false);
  });

  it('refreshes once the TTL has expired', async () => {
    const time = clock();
    const cache = new ProviderCache<string>({ ttlMs: 5_000, now: time.now });
    const loader = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    await cache.fetch('k', loader);
    time.advance(5_001);
    const refreshed = await cache.fetch('k', loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(refreshed.value).toBe('second');
  });

  it('collapses ten concurrent cold requests into ONE outbound load', async () => {
    const cache = new ProviderCache<string>({ ttlMs: 5_000 });
    let resolveLoad: (v: string) => void = () => {};
    const loader = jest.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve; }));

    const inFlight = Array.from({ length: 10 }, () => cache.fetch('k', loader));
    resolveLoad('shared');
    const results = await Promise.all(inFlight);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.value === 'shared')).toBe(true);
  });

  it('serves the last good value, flagged stale, when a refresh fails inside the stale window', async () => {
    const time = clock();
    const onStaleServe = jest.fn();
    const cache = new ProviderCache<string>({ ttlMs: 1_000, maxStaleMs: 10_000, now: time.now, onStaleServe });
    const loader = jest.fn().mockResolvedValueOnce('good').mockRejectedValue(new Error('provider down'));

    await cache.fetch('k', loader);
    time.advance(2_000);
    const served = await cache.fetch('k', loader);

    expect(served.value).toBe('good');
    expect(served.stale).toBe(true);
    expect(onStaleServe).toHaveBeenCalledWith('k', 2_000);
  });

  it('stops serving stale data once it is past the staleness budget, and surfaces the real error', async () => {
    const time = clock();
    const cache = new ProviderCache<string>({ ttlMs: 1_000, maxStaleMs: 5_000, now: time.now });
    const loader = jest.fn().mockResolvedValueOnce('good').mockRejectedValue(new Error('provider down'));

    await cache.fetch('k', loader);
    time.advance(6_001); // past ttl + maxStale

    await expect(cache.fetch('k', loader)).rejects.toThrow('provider down');
  });

  it('never serves stale data at all when no staleness budget is configured', async () => {
    const time = clock();
    const cache = new ProviderCache<string>({ ttlMs: 1_000, now: time.now });
    const loader = jest.fn().mockResolvedValueOnce('good').mockRejectedValue(new Error('down'));

    await cache.fetch('k', loader);
    time.advance(1_001);

    await expect(cache.fetch('k', loader)).rejects.toThrow('down');
  });

  it('propagates a first-ever failure rather than inventing a value', async () => {
    const cache = new ProviderCache<string>({ ttlMs: 1_000, maxStaleMs: 60_000 });
    await expect(cache.fetch('k', () => Promise.reject(new Error('cold failure')))).rejects.toThrow('cold failure');
  });

  it('evicts the least recently used key rather than growing without bound', async () => {
    const cache = new ProviderCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    await cache.fetch('a', () => Promise.resolve('a'));
    await cache.fetch('b', () => Promise.resolve('b'));
    await cache.fetch('a', () => Promise.resolve('a')); // 'a' is now the most recently used
    await cache.fetch('c', () => Promise.resolve('c'));

    expect(cache.size).toBe(2);
    expect(cache.peek('b')).toBeNull(); // 'b' was the LRU entry
    expect(cache.peek('a')?.value).toBe('a');
    expect(cache.peek('c')?.value).toBe('c');
  });

  it('peek never triggers a load and reports nothing once past the staleness budget', async () => {
    const time = clock();
    const cache = new ProviderCache<string>({ ttlMs: 1_000, maxStaleMs: 1_000, now: time.now });
    const loader = jest.fn().mockResolvedValue('v');

    await cache.fetch('k', loader);
    time.advance(1_500);
    expect(cache.peek('k')).toEqual({ value: 'v', fetchedAt: 1_000_000, stale: true });

    time.advance(1_000);
    expect(cache.peek('k')).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
