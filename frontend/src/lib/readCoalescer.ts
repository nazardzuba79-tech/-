/**
 * One request for identical reads that start within a short window.
 *
 * 2026-10-13 audit, Spot terminal idle at 1440×900: `/orders/me` was read
 * 30 times a minute — the chart (trigger lines) and the open-orders panel
 * each poll it every 4 s, and their timers run about 200 ms apart, so the
 * server answered the same question twice every tick. With the backend's
 * 120 requests/min per IP, two idle Spot tabs were already at the limit.
 *
 * The coalescer hands the second caller the first caller's promise when
 * the same key was started less than `windowMs` ago. It is a single-flight
 * window, not a cache: a settled promise is reused only inside the window,
 * a rejected one is dropped at once so the next read retries, and a caller
 * that must see the server's current state (after a cancel, a placement,
 * a drag) passes `fresh` and always gets its own request.
 */
export function createReadCoalescer<T>(windowMs: number, now: () => number = Date.now) {
  const inWindow = new Map<string, { startedAt: number; promise: Promise<T> }>();
  return function read(key: string, run: () => Promise<T>, fresh = false): Promise<T> {
    const startedAt = now();
    const current = inWindow.get(key);
    if (!fresh && current && startedAt - current.startedAt < windowMs) return current.promise;
    const promise = run();
    inWindow.set(key, { startedAt, promise });
    promise.catch(() => {
      if (inWindow.get(key)?.promise === promise) inWindow.delete(key);
    });
    return promise;
  };
}
